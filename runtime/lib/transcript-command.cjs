'use strict';

function createTranscriptCommandHelpers(deps) {
  const {
    fs,
    os,
    path,
    runtime,
    getProjectExtDir,
    updateSession,
    getRuntimeHost
  } = deps;

  const SUPPORTED_PROVIDERS = new Set(['generic', 'codex', 'claude', 'cursor']);

  function normalizeProvider(value) {
    const provider = String(value || 'generic').trim().toLowerCase();
    if (!SUPPORTED_PROVIDERS.has(provider)) {
      throw new Error(`Unsupported transcript provider: ${provider}`);
    }
    return provider;
  }

  function parseArgs(argv) {
    const result = {
      provider: 'generic',
      id: '',
      file: '',
      from: '',
      reviewed_file: '',
      output_dir: '',
      explicit_confirmation: false,
      allow_unreviewed: false,
      accept_review: false
    };

    for (let index = 0; index < (argv || []).length; index += 1) {
      const token = argv[index];
      if (token === '--provider') {
        result.provider = normalizeProvider(argv[index + 1] || '');
        index += 1;
        continue;
      }
      if (token === '--id') {
        result.id = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--file') {
        result.file = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--from') {
        result.from = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--reviewed-file') {
        result.reviewed_file = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--output-dir') {
        result.output_dir = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--confirm') {
        result.explicit_confirmation = true;
        continue;
      }
      if (token === '--allow-unreviewed') {
        result.allow_unreviewed = true;
        continue;
      }
      if (token === '--accept') {
        result.accept_review = true;
        continue;
      }
      if (token === '--help' || token === '-h') {
        result.help = true;
        continue;
      }
      throw new Error(`Unknown transcript argument: ${token}`);
    }

    result.provider = normalizeProvider(result.provider);
    return result;
  }

  function buildHelp() {
    return {
      command: 'transcript',
      purpose: 'Import and analyze host conversation transcripts as recovery-only context.',
      warning: 'This is not the normal session continuity path. It imports host-private transcript data into reviewable .emb-agent/imports artifacts.',
      commands: [
        'transcript import --provider codex --id <session-id>',
        'transcript import --provider claude --file <transcript>',
        'transcript import --provider cursor --file <transcript>',
        'transcript import --provider generic --file <jsonl|json|md|txt>',
        'transcript analyze --from <analysis-or-transcript-json>',
        'transcript review --from <analysis-json> --accept',
        'transcript review --from <analysis-json> --reviewed-file <reviewed-analysis-json>',
        'transcript apply --from <analysis-json> --confirm'
      ],
      providers: Array.from(SUPPORTED_PROVIDERS),
      analysis_policy: 'Rule-based parsing is a prepass only. Host AI must review the generated ai_review_file before applying transcript-derived signals.'
    };
  }

  function readJsonl(filePath) {
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function normalizeMessage(role, text, timestamp) {
    const normalizedRole = String(role || 'unknown').trim() || 'unknown';
    const normalizedText = String(text || '').trim();
    if (!normalizedText) {
      return null;
    }
    if (shouldIgnoreMessage(normalizedRole, normalizedText)) {
      return null;
    }
    return {
      role: normalizedRole,
      timestamp: String(timestamp || ''),
      text: normalizedText
    };
  }

  function shouldIgnoreMessage(role, text) {
    const normalizedRole = String(role || '').toLowerCase();
    const body = String(text || '').trim();
    if (normalizedRole === 'developer' || normalizedRole === 'system' || normalizedRole === 'tool') {
      return true;
    }
    if (
      body.startsWith('# AGENTS.md instructions') ||
      body.startsWith('<permissions instructions>') ||
      body.includes('<emb-agent-session-context>') ||
      body.includes('<skills_instructions>') ||
      body.includes('<collaboration_mode>') ||
      body.includes('<personality_spec>') ||
      body.includes('<current-state>')
    ) {
      return true;
    }
    if (body === '<turn_aborted>' || body.includes('The user interrupted the previous turn on purpose')) {
      return true;
    }
    return false;
  }

  function extractTextFromContent(content) {
    if (typeof content === 'string') {
      return content;
    }
    if (!Array.isArray(content)) {
      return '';
    }
    return content
      .map(item => {
        if (!item || typeof item !== 'object') return '';
        if (typeof item.text === 'string') return item.text;
        if (typeof item.input_text === 'string') return item.input_text;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  function parseCodexSessionJsonl(filePath, expectedId) {
    const messages = [];
    const seen = new Set();

    readJsonl(filePath).forEach(entry => {
      const timestamp = entry.timestamp || '';
      const payload = entry.payload && typeof entry.payload === 'object' ? entry.payload : {};
      let message = null;

      if (entry.type === 'response_item' && payload.type === 'message') {
        if (String(payload.role || '').toLowerCase() === 'assistant' && payload.phase !== 'final_answer') {
          return;
        }
        message = normalizeMessage(payload.role, extractTextFromContent(payload.content), timestamp);
      } else if (entry.type === 'event_msg' && payload.type === 'user_message') {
        message = normalizeMessage('user', payload.message || '', timestamp);
      } else if (entry.type === 'event_msg' && payload.type === 'agent_message' && payload.phase === 'final_answer') {
        message = normalizeMessage('assistant', payload.message || '', timestamp);
      } else if (entry.session_id === expectedId && entry.text) {
        message = normalizeMessage('user', entry.text, entry.ts ? new Date(Number(entry.ts) * 1000).toISOString() : '');
      }

      if (!message) {
        return;
      }
      const key = `${message.role}\n${message.text}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      messages.push(message);
    });

    return messages;
  }

  function findFiles(root, predicate, options = {}) {
    const maxDepth = Number.isInteger(options.max_depth) ? options.max_depth : 6;
    const results = [];

    function walk(dir, depth) {
      if (depth > maxDepth || results.length >= 32) {
        return;
      }
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.forEach(entry => {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath, depth + 1);
          return;
        }
        if (entry.isFile() && predicate(entryPath, entry.name)) {
          results.push(entryPath);
        }
      });
    }

    walk(root, 0);
    return results;
  }

  function getDefaultHostHome(provider) {
    const envName = provider === 'codex'
      ? 'CODEX_HOME'
      : provider === 'claude'
        ? 'CLAUDE_HOME'
        : provider === 'cursor'
          ? 'CURSOR_HOME'
          : '';
    if (envName && process.env[envName]) {
      return path.resolve(process.env[envName]);
    }
    if (provider === 'codex') return path.join(os.homedir(), '.codex');
    if (provider === 'claude') return path.join(os.homedir(), '.claude');
    if (provider === 'cursor') return path.join(os.homedir(), '.cursor');
    return process.cwd();
  }

  function getHostHome(provider) {
    const host = typeof getRuntimeHost === 'function' ? getRuntimeHost() : null;
    if (
      host &&
      host.name === provider &&
      host.runtimeHome &&
      host.sourceLayout !== true &&
      fs.existsSync(host.runtimeHome)
    ) {
      return host.runtimeHome;
    }
    return getDefaultHostHome(provider);
  }

  function loadCodexById(id) {
    if (!id) {
      throw new Error('transcript import --provider codex requires --id or --file');
    }
    const candidateHomes = takeUnique([
      getHostHome('codex'),
      getDefaultHostHome('codex')
    ], 4);

    for (const home of candidateHomes) {
      const sessionsRoot = path.join(home, 'sessions');
      const sessionFiles = findFiles(
        sessionsRoot,
        (filePath, name) => name.includes(id) && name.endsWith('.jsonl'),
        { max_depth: 8 }
      );
      const sourceFile = sessionFiles[0] || '';
      if (sourceFile) {
        return {
          source_file: sourceFile,
          messages: parseCodexSessionJsonl(sourceFile, id)
        };
      }
    }

    for (const home of candidateHomes) {
      const historyPath = path.join(home, 'history.jsonl');
      if (!fs.existsSync(historyPath)) {
        continue;
      }
      const messages = parseCodexSessionJsonl(historyPath, id);
      if (messages.length > 0) {
        return {
          source_file: historyPath,
          messages
        };
      }
    }

    throw new Error(`Codex transcript not found for id: ${id}`);
  }

  function parseGenericJson(value, timestamp) {
    if (Array.isArray(value)) {
      return value
        .map(item => {
          if (!item || typeof item !== 'object') return null;
          return normalizeMessage(item.role || item.author || 'unknown', item.text || item.message || item.content || '', item.timestamp || timestamp);
        })
        .filter(Boolean);
    }
    if (value && typeof value === 'object') {
      if (Array.isArray(value.messages)) return parseGenericJson(value.messages, timestamp);
      if (Array.isArray(value.conversation)) return parseGenericJson(value.conversation, timestamp);
      const message = normalizeMessage(value.role || value.author || 'unknown', value.text || value.message || value.content || '', value.timestamp || timestamp);
      return message ? [message] : [];
    }
    return [];
  }

  function loadFileTranscript(provider, filePath) {
    const resolved = path.resolve(filePath || '');
    if (!resolved || !fs.existsSync(resolved)) {
      throw new Error(`Transcript file not found: ${filePath}`);
    }

    const ext = path.extname(resolved).toLowerCase();
    if (ext === '.jsonl') {
      const entries = readJsonl(resolved);
      const codexMessages = entries.flatMap(entry => {
        const tempPath = '';
        if (entry && (entry.type === 'response_item' || entry.type === 'event_msg' || entry.session_id)) {
          return [];
        }
        return parseGenericJson(entry);
      });
      const hostMessages = parseCodexSessionJsonl(resolved, '');
      return {
        source_file: resolved,
        messages: hostMessages.length > 0 ? hostMessages : codexMessages
      };
    }

    if (ext === '.json') {
      return {
        source_file: resolved,
        messages: parseGenericJson(runtime.readJson(resolved))
      };
    }

    const text = fs.readFileSync(resolved, 'utf8');
    return {
      source_file: resolved,
      messages: [normalizeMessage('transcript', text, '')].filter(Boolean)
    };
  }

  function loadTranscript(input) {
    const provider = normalizeProvider(input.provider);
    if (input.file) {
      const loaded = loadFileTranscript(provider, input.file);
      return {
        provider,
        source_id: input.id || path.basename(loaded.source_file || input.file),
        source_file: loaded.source_file,
        messages: loaded.messages
      };
    }
    if (provider === 'codex') {
      const loaded = loadCodexById(input.id);
      return {
        provider,
        source_id: input.id,
        source_file: loaded.source_file,
        messages: loaded.messages
      };
    }
    throw new Error(`transcript import --provider ${provider} requires --file`);
  }

  function normalizeLine(text) {
    return String(text || '')
      .replace(/\s+/gu, ' ')
      .trim();
  }

  function includesAny(text, patterns) {
    return patterns.some(pattern => pattern.test(text));
  }

  function takeUnique(items, limit) {
    const seen = new Set();
    const next = [];
    (items || []).forEach(item => {
      const text = normalizeLine(item);
      if (!text || seen.has(text)) {
        return;
      }
      seen.add(text);
      next.push(text);
    });
    return next.slice(0, limit);
  }

  function isAssistantAnalysisNoise(line) {
    const body = normalizeLine(line);
    if (!body) return true;
    if (
      body.includes('](/') ||
      body.includes('```') ||
      body.startsWith('- [') ||
      body.startsWith('#') ||
      body.startsWith('|') ||
      body.startsWith('主要改动') ||
      body.startsWith('验证') ||
      body.startsWith('编译') ||
      body.startsWith('搜索') ||
      body.startsWith('下一步') ||
      body.startsWith('接下来') ||
      body.startsWith('我会') ||
      body.startsWith('现在我会') ||
      body.startsWith('已按') ||
      body.startsWith('已做') ||
      body.startsWith('拆分文件已经写入') ||
      body.startsWith('依据：') ||
      body.startsWith('这版改在')
    ) {
      return true;
    }
    return false;
  }

  function isCodePasteLine(line) {
    return /^(#define|case\s+|default:|if\s*\(|for\s*\(|while\s*\(|return\b|\}\s*|[A-Za-z_][A-Za-z0-9_]*\s*=)/u.test(normalizeLine(line));
  }

  function isHeadingLikeLine(line) {
    const body = normalizeLine(line);
    return body.length <= 24 && /逻辑$/u.test(body);
  }

  function buildAnalysisEntries(messages) {
    const entries = [];
    const counts = new Map();

    messages.forEach(message => {
      const role = String(message.role || '').toLowerCase();
      const maxLineLength = role === 'assistant' ? 360 : 600;
      normalizeLine(message.text)
        .split(/(?<=[。！？!?])\s*/u)
        .map(normalizeLine)
        .filter(line => line && line.length <= maxLineLength)
        .forEach(line => {
          if (role === 'assistant' && isAssistantAnalysisNoise(line)) {
            return;
          }
          entries.push({ line, role });
          counts.set(line, (counts.get(line) || 0) + 1);
        });
    });

    return { entries, counts };
  }

  function buildSemanticReview(transcript) {
    return {
      required: true,
      status: 'pending',
      reviewer: 'host-ai',
      reason: 'Transcript parsing can remove host noise deterministically, but facts, preferences, risks, and next actions require semantic judgment by the active AI assistant.',
      instructions: [
        'Review the transcript messages and heuristic prepass before applying recovery signals.',
        'Promote only user-confirmed or evidence-backed facts.',
        'Keep guesses, assistant implementation notes, and code paste fragments as candidates or discard them.',
        'Do not mutate project truth files from transcript evidence without a separate explicit truth update.'
      ]
    };
  }

  function analyzeTranscript(transcript) {
    const messages = Array.isArray(transcript.messages) ? transcript.messages : [];
    const { entries, counts } = buildAnalysisEntries(messages);
    const lines = entries.map(entry => entry.line);

    const hardwareFacts = [];
    const preferences = [];
    const questions = [];
    const risks = [];
    const trials = [];
    const pinStates = [];
    const powerSleepChecklist = [];

    const hardwarePattern = /(R[ABCD]\d|P[ABCD]\d|PWM|SS8550|USB|Type-?C|VBUS|红灯|按键|高电平|低电平|高阻|开漏|比较器|满电|低功耗|uA|μA|mA|\d(?:\.\d+)?V)/iu;
    const preferencePattern = /(不要|必须|应该|不应该|优先|禁止|先.+再|使用notebook|用 notebook|不要helper|不要 helper)/iu;
    const questionPattern = /([?？]$|有没有|会不会|多少|确认|查询|是不是|应该.*吗|行吗)/iu;
    const riskPattern = /(问题|偏高|偶发|还是|没灭|没亮|做不了|失败|风险|漏电|倒灌|反灌|不亮|不灭|需要按一下|无法|不能)/iu;
    const trialPattern = /(实测|现在|已经|这一步|尝试|改成方案|retry|可以了|能亮|能灭|没亮|不亮|不灭)/iu;
    const powerPattern = /(低功耗|sleep|休眠|WDT|Timer|PWM|比较器|ADC|上拉|下拉|uA|μA|待机功耗)/iu;
    const factStatePattern = /(改成|接|输出|检测|实测|已经|设置|达到|亮|灭|高阻|下拉|上拉|导致|判定|插入|拔|关断|为)/iu;

    entries.forEach(({ line, role }) => {
      const fromAssistant = role === 'assistant';
      const fromUserLike = !fromAssistant;
      const isQuestion = questionPattern.test(line);
      const isCodePaste = isCodePasteLine(line);

      if (line.includes('#define RED_LED_ON') && /(不要|这个不要)/iu.test(line)) {
        preferences.push('不要 RED_LED_ON/RED_LED_OFF 宏');
      }

      if (isCodePaste) {
        return;
      }

      if (fromUserLike && !isQuestion && !isHeadingLikeLine(line) && includesAny(line, [hardwarePattern]) && includesAny(line, [factStatePattern])) {
        hardwareFacts.push(line);
      }
      if (fromUserLike && preferencePattern.test(line)) {
        preferences.push(line);
      }
      if (fromUserLike && isQuestion) {
        questions.push(line);
      }
      if (fromUserLike && riskPattern.test(line)) {
        risks.push(line);
      }
      if (fromUserLike && trialPattern.test(line)) {
        trials.push(line);
      }
      if (powerPattern.test(line)) {
        powerSleepChecklist.push(line);
      }

      const pinMatches = line.match(/\bR[ABCD]\d\b|\bP[ABCD]\d\b/giu) || [];
      pinMatches.forEach(pin => {
        pinStates.push(`${pin.toUpperCase()}: ${line}`);
      });
    });

    const repeatedSymptoms = Array.from(counts.entries())
      .filter(([line, count]) => count > 1 && !isCodePasteLine(line))
      .map(([line, count]) => `${count}x ${line}`);

    return {
      version: '1.0',
      analysis_method: 'heuristic-prepass',
      generated_at: new Date().toISOString(),
      provider: transcript.provider || 'generic',
      source_id: transcript.source_id || '',
      source_file: transcript.source_file || '',
      message_count: messages.length,
      semantic_review: buildSemanticReview(transcript),
      confirmed_facts: takeUnique(hardwareFacts, 24),
      candidate_facts: takeUnique(lines.filter(line => hardwarePattern.test(line) && !isCodePasteLine(line) && !isHeadingLikeLine(line)), 24),
      user_preferences: takeUnique(preferences, 16),
      open_questions: takeUnique(questions, 16),
      open_risks: takeUnique(risks, 16),
      hardware_trials: takeUnique(trials, 20),
      repeated_symptoms: takeUnique(repeatedSymptoms, 12),
      pin_state_candidates: takeUnique(pinStates, 24),
      power_sleep_checklist: takeUnique(powerSleepChecklist, 16),
      recommended_next: buildRecommendedNext({
        risks,
        repeatedSymptoms,
        powerSleepChecklist,
        questions
      })
    };
  }

  function buildRecommendedNext(inputs) {
    if ((inputs.repeatedSymptoms || []).length > 0) {
      return {
        route: 'debug-forensics',
        reason: 'Repeated transcript symptoms should be treated as a debug loop, not another implementation pass.'
      };
    }
    if ((inputs.powerSleepChecklist || []).length > 0) {
      return {
        route: 'power-sleep-checklist',
        reason: 'Low-power or sleep terms were found; inspect peripheral shutdown, GPIO state, wake sources, and external leakage.'
      };
    }
    if ((inputs.risks || []).length > 0) {
      return {
        route: 'review-before-do',
        reason: 'Open risks were extracted from the transcript.'
      };
    }
    if ((inputs.questions || []).length > 0) {
      return {
        route: 'scan-first',
        reason: 'Open questions remain in the imported transcript.'
      };
    }
    return {
      route: 'session-record',
      reason: 'Transcript produced recoverable context; review before applying.'
    };
  }

  function buildSlug(provider, sourceId) {
    const raw = `${provider}-${sourceId || new Date().toISOString()}`;
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96) || 'transcript';
  }

  function getImportDir(input) {
    const base = input.output_dir
      ? path.resolve(input.output_dir)
      : path.join(getProjectExtDir(), 'imports');
    return base;
  }

  function buildMarkdown(analysis) {
    const lines = [
      '# Transcript Analysis',
      '',
      `provider: ${analysis.provider || ''}`,
      `source_id: ${analysis.source_id || ''}`,
      `source_file: ${analysis.source_file || ''}`,
      `message_count: ${analysis.message_count || 0}`,
      `analysis_method: ${analysis.analysis_method || 'heuristic-prepass'}`,
      `semantic_review: ${analysis.semantic_review && analysis.semantic_review.required ? 'required' : 'not-required'}`,
      '',
      '## Recommended Next',
      '',
      `route: ${(analysis.recommended_next || {}).route || ''}`,
      `reason: ${(analysis.recommended_next || {}).reason || ''}`
    ];

    [
      ['Confirmed Facts', analysis.confirmed_facts],
      ['Candidate Facts', analysis.candidate_facts],
      ['User Preferences', analysis.user_preferences],
      ['Open Questions', analysis.open_questions],
      ['Open Risks', analysis.open_risks],
      ['Hardware Trials', analysis.hardware_trials],
      ['Repeated Symptoms', analysis.repeated_symptoms],
      ['Pin State Candidates', analysis.pin_state_candidates],
      ['Power Sleep Checklist', analysis.power_sleep_checklist]
    ].forEach(([title, items]) => {
      lines.push('', `## ${title}`, '');
      const list = Array.isArray(items) ? items : [];
      if (list.length === 0) {
        lines.push('- (none)');
        return;
      }
      list.forEach(item => lines.push(`- ${item}`));
    });

    return lines.join('\n') + '\n';
  }

  function summarizeMessagesForReview(transcript) {
    const messages = Array.isArray(transcript.messages) ? transcript.messages : [];
    return messages
      .filter(message => {
        const role = String(message.role || '').toLowerCase();
        return role === 'user' || role === 'transcript' || role === 'assistant';
      })
      .slice(0, 80)
      .map((message, index) => {
        const role = String(message.role || 'unknown');
        const text = String(message.text || '').trim();
        const clipped = text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
        return `### ${index + 1}. ${role}\n\n${clipped}`;
      })
      .join('\n\n');
  }

  function buildAiReviewMarkdown(transcript, analysis) {
    const review = analysis.semantic_review || buildSemanticReview(transcript);
    return [
      '# Transcript AI Review',
      '',
      'This file is for the active AI assistant to review transcript-derived recovery signals.',
      'The JSON analysis is a heuristic prepass, not the final semantic authority.',
      '',
      '## Review Contract',
      '',
      `status: ${review.status || 'pending'}`,
      `reviewer: ${review.reviewer || 'host-ai'}`,
      `reason: ${review.reason || ''}`,
      '',
      '## Instructions',
      '',
      ...(Array.isArray(review.instructions) && review.instructions.length > 0
        ? review.instructions.map(item => `- ${item}`)
        : ['- Review before applying.']),
      '',
      '## Heuristic Output To Review',
      '',
      '```json',
      JSON.stringify({
        confirmed_facts: analysis.confirmed_facts || [],
        candidate_facts: analysis.candidate_facts || [],
        user_preferences: analysis.user_preferences || [],
        open_questions: analysis.open_questions || [],
        open_risks: analysis.open_risks || [],
        hardware_trials: analysis.hardware_trials || [],
        pin_state_candidates: analysis.pin_state_candidates || [],
        power_sleep_checklist: analysis.power_sleep_checklist || [],
        recommended_next: analysis.recommended_next || {}
      }, null, 2),
      '```',
      '',
      '## Transcript Messages',
      '',
      summarizeMessagesForReview(transcript) || '(none)',
      ''
    ].join('\n');
  }

  function writeImportArtifacts(transcript, analysis, input) {
    const slug = buildSlug(transcript.provider, transcript.source_id || path.basename(transcript.source_file || ''));
    const importsDir = getImportDir(input);
    const transcriptPath = path.join(importsDir, 'transcripts', `${slug}.json`);
    const analysisPath = path.join(importsDir, 'analysis', `${slug}.json`);
    const markdownPath = path.join(importsDir, 'analysis', `${slug}.md`);
    const aiReviewPath = path.join(importsDir, 'analysis', `${slug}.ai-review.md`);

    runtime.writeJson(transcriptPath, transcript);
    runtime.writeJson(analysisPath, analysis);
    runtime.ensureDir(path.dirname(markdownPath));
    fs.writeFileSync(markdownPath, buildMarkdown(analysis), 'utf8');
    fs.writeFileSync(aiReviewPath, buildAiReviewMarkdown(transcript, analysis), 'utf8');

    return {
      transcript_file: path.relative(process.cwd(), transcriptPath),
      analysis_file: path.relative(process.cwd(), analysisPath),
      markdown_file: path.relative(process.cwd(), markdownPath),
      ai_review_file: path.relative(process.cwd(), aiReviewPath)
    };
  }

  function buildDiagnosticsRecord(analysis, files) {
    const semanticReview = analysis.semantic_review || {
      required: true,
      status: 'pending',
      reviewer: 'host-ai'
    };
    return {
      provider: analysis.provider || '',
      source_id: analysis.source_id || '',
      source_file: analysis.source_file || '',
      analysis_file: files && files.analysis_file ? files.analysis_file : '',
      ai_review_file: files && files.ai_review_file ? files.ai_review_file : '',
      generated_at: new Date().toISOString(),
      confirmed_facts: (analysis.confirmed_facts || []).slice(0, 12),
      user_preferences: (analysis.user_preferences || []).slice(0, 8),
      pin_state_candidates: (analysis.pin_state_candidates || []).slice(0, 12),
      semantic_review: {
        required: semanticReview.required !== false,
        status: semanticReview.status || 'pending',
        reviewer: semanticReview.reviewer || 'host-ai'
      },
      recommended_next: analysis.recommended_next || null
    };
  }

  function recordTranscriptDiagnostics(current, analysis, files) {
    current.diagnostics = current.diagnostics || {};
    const previous =
      current.diagnostics.latest_transcript_import &&
      typeof current.diagnostics.latest_transcript_import === 'object'
        ? current.diagnostics.latest_transcript_import
        : {};
    const next = buildDiagnosticsRecord(analysis, files);
    if (!next.ai_review_file && previous.ai_review_file) {
      next.ai_review_file = previous.ai_review_file;
    }
    current.diagnostics.latest_transcript_import = next;
  }

  function isSemanticReviewAccepted(analysis) {
    const review =
      analysis && analysis.semantic_review && typeof analysis.semantic_review === 'object'
        ? analysis.semantic_review
        : null;
    return Boolean(review && review.status === 'accepted');
  }

  function markAnalysisReviewed(analysis) {
    const source = analysis && typeof analysis === 'object' ? analysis : {};
    const review = source.semantic_review && typeof source.semantic_review === 'object'
      ? source.semantic_review
      : {};
    return {
      ...source,
      analysis_method: 'ai-reviewed',
      reviewed_at: new Date().toISOString(),
      semantic_review: {
        ...review,
        required: true,
        status: 'accepted',
        reviewer: review.reviewer || 'host-ai'
      },
      session_signals: source.session_signals || {
        open_questions: (source.open_questions || []).slice(),
        known_risks: [
          ...((source.open_risks || []).slice()),
          ...((source.repeated_symptoms || []).map(item => `repeated transcript symptom: ${item}`))
        ],
        focus: ''
      },
      truth_candidates: source.truth_candidates || {
        hardware: (source.confirmed_facts || []).slice(),
        requirements: (source.user_preferences || []).slice()
      },
      task_candidates: source.task_candidates || {
        suggested_task: '',
        verification_needed: (source.open_risks || []).slice()
      },
      discarded_items: Array.isArray(source.discarded_items) ? source.discarded_items : []
    };
  }

  function buildReviewedMarkdown(analysis) {
    return [
      '# Transcript Reviewed Analysis',
      '',
      `provider: ${analysis.provider || ''}`,
      `source_id: ${analysis.source_id || ''}`,
      `analysis_method: ${analysis.analysis_method || ''}`,
      `semantic_review: ${(analysis.semantic_review || {}).status || ''}`,
      '',
      '## Session Signals',
      '',
      '```json',
      JSON.stringify(analysis.session_signals || {}, null, 2),
      '```',
      '',
      '## Truth Candidates',
      '',
      '```json',
      JSON.stringify(analysis.truth_candidates || {}, null, 2),
      '```',
      ''
    ].join('\n');
  }

  function writeReviewedArtifacts(analysis, input) {
    const slug = buildSlug(analysis.provider || input.provider, analysis.source_id || path.basename(input.from || 'reviewed'));
    const importsDir = getImportDir(input);
    const reviewedPath = path.join(importsDir, 'analysis', `${slug}.reviewed.json`);
    const reviewedMarkdownPath = path.join(importsDir, 'analysis', `${slug}.reviewed.md`);

    runtime.writeJson(reviewedPath, analysis);
    runtime.ensureDir(path.dirname(reviewedMarkdownPath));
    fs.writeFileSync(reviewedMarkdownPath, buildReviewedMarkdown(analysis), 'utf8');

    return {
      reviewed_analysis_file: path.relative(process.cwd(), reviewedPath),
      reviewed_markdown_file: path.relative(process.cwd(), reviewedMarkdownPath)
    };
  }

  function readTranscriptOrAnalysis(filePath) {
    const resolved = path.resolve(filePath || '');
    if (!resolved || !fs.existsSync(resolved)) {
      throw new Error(`Transcript analysis source not found: ${filePath}`);
    }
    const data = runtime.readJson(resolved);
    if (data && Array.isArray(data.messages)) {
      return {
        kind: 'transcript',
        transcript: data
      };
    }
    return {
      kind: 'analysis',
      analysis: data
    };
  }

  function importTranscript(rest) {
    const input = parseArgs(rest);
    if (input.help) return buildHelp();
    const transcript = loadTranscript(input);
    const analysis = analyzeTranscript(transcript);
    const files = writeImportArtifacts(transcript, analysis, input);

    updateSession(current => {
      current.last_command = 'transcript import';
      recordTranscriptDiagnostics(current, analysis, files);
    });

    return {
      imported: true,
      applied: false,
      provider: transcript.provider,
      source_id: transcript.source_id,
      source_file: transcript.source_file,
      message_count: transcript.messages.length,
      files,
      analysis,
      guidance: {
        default_behavior: 'review-only',
        review_file: files.ai_review_file,
        review_required: true,
        apply_cli: `transcript apply --from ${files.analysis_file} --confirm`
      }
    };
  }

  function analyzeTranscriptCommand(rest) {
    const input = parseArgs(rest);
    if (input.help) return buildHelp();
    let transcript = null;
    let analysis = null;

    if (input.from) {
      const loaded = readTranscriptOrAnalysis(input.from);
      if (loaded.kind === 'analysis') {
        analysis = loaded.analysis;
        transcript = {
          provider: analysis.provider || input.provider,
          source_id: analysis.source_id || path.basename(input.from),
          source_file: analysis.source_file || input.from,
          messages: []
        };
      } else {
        transcript = loaded.transcript;
        analysis = analyzeTranscript(transcript);
      }
    } else {
      transcript = loadTranscript(input);
      analysis = analyzeTranscript(transcript);
    }

    const files = writeImportArtifacts(transcript, analysis, input);
    updateSession(current => {
      current.last_command = 'transcript analyze';
      recordTranscriptDiagnostics(current, analysis, files);
    });

    return {
      analyzed: true,
      applied: false,
      provider: analysis.provider,
      source_id: analysis.source_id,
      files,
      analysis,
      guidance: {
        default_behavior: 'review-only',
        review_file: files.ai_review_file,
        review_required: true,
        apply_cli: `transcript apply --from ${files.analysis_file} --confirm`
      }
    };
  }

  function reviewTranscriptAnalysis(rest) {
    const input = parseArgs(rest);
    if (input.help) return buildHelp();
    if (!input.from) {
      throw new Error('transcript review requires --from <analysis-json>');
    }

    const loaded = readTranscriptOrAnalysis(input.from);
    const baseAnalysis = loaded.kind === 'analysis'
      ? loaded.analysis
      : analyzeTranscript(loaded.transcript);

    if (!input.accept_review && !input.reviewed_file) {
      const semanticReview = baseAnalysis.semantic_review || buildSemanticReview({
        provider: baseAnalysis.provider,
        source_id: baseAnalysis.source_id,
        source_file: baseAnalysis.source_file,
        messages: []
      });
      return {
        reviewed: false,
        status: 'semantic-review-pending',
        provider: baseAnalysis.provider,
        source_id: baseAnalysis.source_id,
        analysis_file: path.relative(process.cwd(), path.resolve(input.from)),
        semantic_review: {
          ...semanticReview,
          required: true,
          status: semanticReview.status || 'pending'
        },
        required_action: 'Active AI must review the generated ai-review artifact, then rerun transcript review with --accept or --reviewed-file.',
        accept_cli: `transcript review --from ${input.from} --accept`
      };
    }

    let reviewedAnalysis = null;
    if (input.reviewed_file) {
      reviewedAnalysis = runtime.readJson(path.resolve(input.reviewed_file));
      if (!reviewedAnalysis || typeof reviewedAnalysis !== 'object' || Array.isArray(reviewedAnalysis)) {
        throw new Error(`Reviewed analysis must be a JSON object: ${input.reviewed_file}`);
      }
      reviewedAnalysis = markAnalysisReviewed({
        ...baseAnalysis,
        ...reviewedAnalysis,
        provider: reviewedAnalysis.provider || baseAnalysis.provider,
        source_id: reviewedAnalysis.source_id || baseAnalysis.source_id,
        source_file: reviewedAnalysis.source_file || baseAnalysis.source_file
      });
    } else {
      reviewedAnalysis = markAnalysisReviewed(baseAnalysis);
    }

    const files = writeReviewedArtifacts(reviewedAnalysis, input);
    updateSession(current => {
      current.last_command = 'transcript review';
      recordTranscriptDiagnostics(current, reviewedAnalysis, {
        analysis_file: files.reviewed_analysis_file,
        ai_review_file: ''
      });
    });

    return {
      reviewed: true,
      applied: false,
      provider: reviewedAnalysis.provider,
      source_id: reviewedAnalysis.source_id,
      files,
      analysis: reviewedAnalysis,
      guidance: {
        default_behavior: 'reviewed-but-not-applied',
        apply_cli: `transcript apply --from ${files.reviewed_analysis_file} --confirm`
      }
    };
  }

  function applyTranscriptAnalysis(rest) {
    const input = parseArgs(rest);
    if (input.help) return buildHelp();
    if (!input.from) {
      throw new Error('transcript apply requires --from <analysis-json>');
    }
    if (!input.explicit_confirmation) {
      return {
        applied: false,
        status: 'permission-pending',
        reason: 'transcript apply writes imported transcript findings into live session state; rerun with --confirm after AI/human review of the analysis file',
        required_cli: `transcript apply --from ${input.from} --confirm`
      };
    }

    const loaded = readTranscriptOrAnalysis(input.from);
    const analysis = loaded.kind === 'analysis'
      ? loaded.analysis
      : analyzeTranscript(loaded.transcript);

    if (!isSemanticReviewAccepted(analysis) && !input.allow_unreviewed) {
      return {
        applied: false,
        status: 'semantic-review-pending',
        reason: 'transcript apply requires an AI-reviewed analysis by default; run transcript review first or pass --allow-unreviewed explicitly.',
        required_cli: `transcript review --from ${input.from} --accept`,
        override_cli: `transcript apply --from ${input.from} --confirm --allow-unreviewed`
      };
    }

    const sessionSignals =
      analysis.session_signals && typeof analysis.session_signals === 'object' && !Array.isArray(analysis.session_signals)
        ? analysis.session_signals
        : {};
    const signalQuestions = Array.isArray(sessionSignals.open_questions)
      ? sessionSignals.open_questions
      : (analysis.open_questions || []);
    const signalRisks = Array.isArray(sessionSignals.known_risks)
      ? sessionSignals.known_risks
      : [
          ...((analysis.open_risks || []).slice()),
          ...((analysis.repeated_symptoms || []).map(item => `repeated transcript symptom: ${item}`))
        ];

    updateSession(current => {
      current.last_command = 'transcript apply';
      current.open_questions = runtime.unique([
        ...(current.open_questions || []),
        ...(signalQuestions.slice(0, 8))
      ]);
      current.known_risks = runtime.unique([
        ...(current.known_risks || []),
        ...(signalRisks.slice(0, 12))
      ]);
      recordTranscriptDiagnostics(current, analysis, {
        analysis_file: path.relative(process.cwd(), path.resolve(input.from)),
        ai_review_file: ''
      });
    });

    return {
      applied: true,
      provider: analysis.provider,
      source_id: analysis.source_id,
      added: {
        open_questions: signalQuestions.slice(0, 8),
        known_risks: signalRisks.slice(0, 12),
        diagnostics: 'latest_transcript_import'
      },
      warning: 'Transcript signals were stored under diagnostics for review; semantic judgment belongs to the active AI/human reviewer, and project truth files were not modified automatically.'
    };
  }

  function handleTranscriptCommands(cmd, subcmd, rest) {
    if (cmd !== 'transcript') {
      return undefined;
    }
    if (!subcmd || subcmd === 'help' || subcmd === '--help') {
      return buildHelp();
    }
    if (subcmd === 'import') {
      return importTranscript(rest);
    }
    if (subcmd === 'analyze') {
      return analyzeTranscriptCommand(rest);
    }
    if (subcmd === 'review') {
      return reviewTranscriptAnalysis(rest);
    }
    if (subcmd === 'apply') {
      return applyTranscriptAnalysis(rest);
    }
    throw new Error(`Unknown transcript subcommand: ${subcmd}`);
  }

  return {
    parseArgs,
    loadTranscript,
    analyzeTranscript,
    handleTranscriptCommands
  };
}

module.exports = {
  createTranscriptCommandHelpers
};
