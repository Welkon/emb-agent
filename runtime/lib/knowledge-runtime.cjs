'use strict';

const knowledgeGraphState = require('./knowledge-graph-state.cjs');
const knowledgeFollowups = require('./knowledge-followups.cjs');
const registerWriteArtifact = require('./register-write-artifact.cjs');

function createKnowledgeRuntimeHelpers(deps) {
  const {
    fs,
    path,
    process,
    runtime,
    getProjectExtDir,
    getProjectConfig,
    updateSession,
    permissionGateHelpers
  } = deps;

  const WIKI_DIRS = ['sources', 'chips', 'peripherals', 'board', 'decisions', 'risks', 'queries'];

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled';
  }

  function titleFromSlug(value) {
    return String(value || '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, match => match.toUpperCase());
  }

  function getWikiDir() {
    return path.join(getProjectExtDir(), 'wiki');
  }

  function getWikiPath(...parts) {
    return path.join(getWikiDir(), ...parts);
  }

  function getWikiRelativePath(...parts) {
    return runtime.getProjectAssetRelativePath('wiki', ...parts);
  }

  function getGraphDir() {
    return path.join(getProjectExtDir(), 'graph');
  }

  function getGraphPath(...parts) {
    return path.join(getGraphDir(), ...parts);
  }

  function getGraphRelativePath(...parts) {
    return runtime.getProjectAssetRelativePath('graph', ...parts);
  }

  function ensureKnowledgeDirs() {
    const wikiDir = getWikiDir();
    runtime.ensureDir(wikiDir);
    WIKI_DIRS.forEach(name => runtime.ensureDir(path.join(wikiDir, name)));
    return wikiDir;
  }

  function ensureGraphDirs() {
    const graphDir = getGraphDir();
    runtime.ensureDir(graphDir);
    runtime.ensureDir(path.join(graphDir, 'cache'));
    return graphDir;
  }

  function readTextIfExists(filePath) {
    return fs.existsSync(filePath) ? String(fs.readFileSync(filePath, 'utf8') || '') : '';
  }

  function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      return JSON.parse(String(fs.readFileSync(filePath, 'utf8') || '{}'));
    } catch {
      return null;
    }
  }

  function buildGraphNodeId(type, value) {
    return `${type}:${String(value || '').trim().replace(/^\.emb-agent\//, '')}`;
  }

  function buildGraphEdge(from, to, type, options = {}) {
    return {
      from,
      to,
      type,
      basis: options.basis || 'EXTRACTED',
      status: options.status || 'confirmed',
      confidence: typeof options.confidence === 'number' ? options.confidence : 1,
      source: options.source || '',
      summary: options.summary || ''
    };
  }

  function extractFrontmatter(content) {
    const source = String(content || '');
    if (!source.startsWith('---\n')) {
      return {};
    }
    const end = source.indexOf('\n---', 4);
    if (end === -1) {
      return {};
    }
    const block = source.slice(4, end).split('\n');
    const out = {};
    block.forEach(line => {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    });
    return out;
  }

  function extractTitle(relativePath, content) {
    const frontmatter = extractFrontmatter(content);
    if (frontmatter.title) return frontmatter.title;
    const heading = String(content || '').split('\n').find(line => /^#\s+/.test(line.trim()));
    if (heading) return heading.replace(/^#\s+/, '').trim();
    return titleFromSlug(path.basename(relativePath, '.md'));
  }

  function extractSummary(content) {
    const frontmatter = extractFrontmatter(content);
    if (frontmatter.summary) return frontmatter.summary;
    const lines = String(content || '').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed === '---' ||
        trimmed.startsWith('title:') ||
        trimmed.startsWith('summary:') ||
        trimmed.startsWith('tags:') ||
        trimmed.startsWith('created:') ||
        trimmed.startsWith('updated:') ||
        trimmed.startsWith('#')
      ) {
        continue;
      }
      return trimmed.replace(/^[-*]\s+/, '').slice(0, 180);
    }
    return '';
  }

  function listMarkdownPages() {
    const wikiDir = getWikiDir();
    if (!fs.existsSync(wikiDir)) {
      return [];
    }

    const pages = [];
    function walk(dirPath) {
      fs.readdirSync(dirPath, { withFileTypes: true }).forEach(entry => {
        const filePath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walk(filePath);
          return;
        }
        if (!entry.isFile() || !entry.name.endsWith('.md')) {
          return;
        }
        const relativePath = path.relative(wikiDir, filePath).replace(/\\/g, '/');
        if (relativePath === 'index.md' || relativePath === 'log.md') {
          return;
        }
        const content = readTextIfExists(filePath);
        pages.push({
          path: relativePath,
          title: extractTitle(relativePath, content),
          summary: extractSummary(content),
          category: relativePath.includes('/') ? relativePath.split('/')[0] : 'pages'
        });
      });
    }
    walk(wikiDir);
    return pages.sort((a, b) => a.path.localeCompare(b.path));
  }

  function buildIndexMarkdown(pages) {
    const grouped = new Map();
    (pages || []).forEach(page => {
      const category = page.category || 'pages';
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(page);
    });

    const lines = [
      '# Knowledge Index',
      '',
      'LLM-maintained engineering wiki for persistent source synthesis, decisions, risks, and reusable project knowledge.',
      '',
      '## Overview',
      '',
      `- Total pages: ${(pages || []).length}`,
      `- Last rebuilt: ${new Date().toISOString()}`,
      ''
    ];

    WIKI_DIRS.forEach(category => {
      const entries = grouped.get(category) || [];
      lines.push(`## ${titleFromSlug(category)}`, '');
      if (entries.length === 0) {
        lines.push('- No pages yet.', '');
        return;
      }
      entries.forEach(page => {
        const summary = page.summary ? ` - ${page.summary}` : '';
        lines.push(`- [[${page.path.replace(/\.md$/, '')}]]${summary}`);
      });
      lines.push('');
    });

    const extraCategories = [...grouped.keys()].filter(category => !WIKI_DIRS.includes(category));
    extraCategories.forEach(category => {
      lines.push(`## ${titleFromSlug(category)}`, '');
      grouped.get(category).forEach(page => {
        const summary = page.summary ? ` - ${page.summary}` : '';
        lines.push(`- [[${page.path.replace(/\.md$/, '')}]]${summary}`);
      });
      lines.push('');
    });

    return `${lines.join('\n').trim()}\n`;
  }

  function buildInitialLogMarkdown() {
    return [
      '# Knowledge Log',
      '',
      'Append-only record of emb-agent knowledge wiki maintenance.',
      '',
      `## [${new Date().toISOString().slice(0, 10)}] init | Knowledge wiki`,
      '- Initialized persistent wiki structure.',
      ''
    ].join('\n');
  }

  function writeIndex() {
    const pages = listMarkdownPages();
    const indexMarkdown = buildIndexMarkdown(pages);
    fs.writeFileSync(getWikiPath('index.md'), indexMarkdown, 'utf8');
    return {
      path: getWikiRelativePath('index.md'),
      pages,
      content: indexMarkdown
    };
  }

  function appendLog(kind, title, lines) {
    const logPath = getWikiPath('log.md');
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, buildInitialLogMarkdown(), 'utf8');
    }
    const entryLines = [
      '',
      `## [${new Date().toISOString().slice(0, 10)}] ${kind} | ${title}`,
      ...(lines || []).map(line => `- ${line}`),
      ''
    ];
    fs.appendFileSync(logPath, entryLines.join('\n'), 'utf8');
  }

  function initKnowledgeWiki() {
    ensureKnowledgeDirs();
    const created = [];
    const indexPath = getWikiPath('index.md');
    const logPath = getWikiPath('log.md');
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, buildInitialLogMarkdown(), 'utf8');
      created.push(getWikiRelativePath('log.md'));
    }
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, buildIndexMarkdown(listMarkdownPages()), 'utf8');
      created.push(getWikiRelativePath('index.md'));
    }
    WIKI_DIRS.forEach(name => {
      created.push(getWikiRelativePath(name));
    });
    updateSession(current => {
      current.last_command = 'knowledge init';
    });
    return {
      initialized: true,
      wiki_dir: getWikiRelativePath(),
      index_file: getWikiRelativePath('index.md'),
      log_file: getWikiRelativePath('log.md'),
      directories: WIKI_DIRS.map(name => getWikiRelativePath(name)),
      created: runtime.unique(created)
    };
  }

  function parseFlagValue(args, flag) {
    const index = args.indexOf(flag);
    if (index === -1) return '';
    return args[index + 1] || '';
  }

  function removeFlagValue(args, flag) {
    const out = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === flag) {
        i += 1;
        continue;
      }
      out.push(args[i]);
    }
    return out;
  }

  function parseKnowledgeWriteArgs(rest, defaults = {}) {
    let args = Array.isArray(rest) ? rest.slice() : [];
    const explicitConfirmation = args.includes('--confirm');
    const force = args.includes('--force');
    const kind = parseFlagValue(args, '--kind') || defaults.kind || 'query';
    const summary = parseFlagValue(args, '--summary');
    const body = parseFlagValue(args, '--body');
    const titleOverride = parseFlagValue(args, '--title');
    const links = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--link' && args[i + 1]) {
        links.push(args[i + 1]);
        i += 1;
      }
    }
    ['--kind', '--summary', '--body', '--title', '--link'].forEach(flag => {
      args = removeFlagValue(args, flag);
    });
    args = args.filter(token => token !== '--confirm' && token !== '--force');
    const title = titleOverride || args.join(' ').trim();
    return {
      title,
      kind,
      summary,
      body,
      links,
      explicit_confirmation: explicitConfirmation,
      force
    };
  }

  function normalizeKnowledgeKind(kind) {
    const value = String(kind || '').trim().toLowerCase();
    if (value === 'decision' || value === 'decisions') return 'decisions';
    if (value === 'risk' || value === 'risks') return 'risks';
    if (value === 'source' || value === 'sources') return 'sources';
    if (value === 'chip' || value === 'chips') return 'chips';
    if (value === 'peripheral' || value === 'peripherals') return 'peripherals';
    if (value === 'board') return 'board';
    return 'queries';
  }

  function buildKnowledgePage(parsed, source = 'query') {
    const category = normalizeKnowledgeKind(parsed.kind);
    const slug = slugify(parsed.title);
    const relativePath = `${category}/${slug}.md`;
    const title = parsed.title.trim();
    const summary = parsed.summary || `Persistent ${source} synthesis for ${title}.`;
    const linkedLines = parsed.links.length > 0
      ? parsed.links.map(item => `- [[${String(item).replace(/\.md$/, '')}]]`)
      : ['- No links recorded yet.'];
    const body = parsed.body || 'Record the durable answer, evidence, contradictions, and follow-up questions here.';
    const content = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `summary: "${summary.replace(/"/g, '\\"')}"`,
      `kind: "${category}"`,
      'status: "draft"',
      `created: "${new Date().toISOString()}"`,
      '---',
      '',
      `# ${title}`,
      '',
      '## Summary',
      '',
      summary,
      '',
      '## Synthesis',
      '',
      body,
      '',
      '## Links',
      '',
      ...linkedLines,
      '',
      '## Evidence And Gaps',
      '',
      '- Evidence: not recorded yet.',
      '- Gaps: review before promoting any claim to project truth.',
      ''
    ].join('\n');
    return {
      category,
      slug,
      relative_path: relativePath,
      display_path: getWikiRelativePath(relativePath),
      file_path: getWikiPath(relativePath),
      title,
      summary,
      content
    };
  }

  function buildConfirmationPreview(page, actionName) {
    return {
      status: 'confirmation-required',
      write_mode: 'preview',
      action: actionName,
      target: page.display_path,
      summary: page.summary,
      content: page.content,
      next_steps: [
        `Re-run with --confirm to write ${page.display_path}`
      ]
    };
  }

  function evaluateKnowledgeWritePermission(actionName, explicitConfirmation) {
    return permissionGateHelpers.evaluateExecutionPermission({
      action_kind: 'write',
      action_name: actionName,
      risk: 'normal',
      explicit_confirmation: explicitConfirmation === true,
      permissions: (getProjectConfig() && getProjectConfig().permissions) || {}
    });
  }

  function saveKnowledgePage(parsed, actionName, logKind) {
    if (!parsed.title) {
      throw new Error('Missing knowledge title');
    }
    ensureKnowledgeDirs();
    const page = buildKnowledgePage(parsed, logKind);
    if (!parsed.explicit_confirmation) {
      return buildConfirmationPreview(page, actionName);
    }
    const permissionDecision = evaluateKnowledgeWritePermission(actionName, true);
    if (permissionDecision.decision !== 'allow') {
      return permissionGateHelpers.applyPermissionDecision(
        buildConfirmationPreview(page, actionName),
        permissionDecision
      );
    }
    if (fs.existsSync(page.file_path) && !parsed.force) {
      throw new Error(`Knowledge page already exists: ${page.display_path}. Re-run with --force to overwrite.`);
    }
    runtime.ensureDir(path.dirname(page.file_path));
    fs.writeFileSync(page.file_path, page.content, 'utf8');
    const index = writeIndex();
    appendLog(logKind, page.title, [
      `Wrote [[${page.relative_path.replace(/\.md$/, '')}]]`,
      `Updated ${index.path}`,
      'Review before promoting any claim into hw.yaml or req.yaml.'
    ]);
    updateSession(current => {
      current.last_command = `knowledge ${logKind}`;
      current.last_files = runtime.unique([
        page.display_path,
        index.path,
        getWikiRelativePath('log.md'),
        ...(current.last_files || [])
      ]).slice(0, 8);
    });
    return permissionGateHelpers.applyPermissionDecision({
      status: 'written',
      write_mode: 'confirmed-write',
      action: actionName,
      page: {
        title: page.title,
        path: page.display_path,
        summary: page.summary
      },
      index_file: index.path,
      log_file: getWikiRelativePath('log.md')
    }, permissionDecision);
  }

  function draftFormulaRegistryFromToolOutput(action, rest) {
    if (action !== 'draft') {
      throw new Error(`Unknown knowledge formula command: ${action}`);
    }
    const args = Array.isArray(rest) ? rest.slice() : [];
    const sourceArg = parseFlagValue(args, '--from-tool-output') || parseFlagValue(args, '--from');
    if (!sourceArg) {
      throw new Error('Missing --from-tool-output <file>');
    }
    const explicitConfirmation = args.includes('--confirm');
    const force = args.includes('--force');
    const cleanSource = String(sourceArg).trim().replace(/\\/g, '/');
    const sourcePath = path.isAbsolute(cleanSource)
      ? cleanSource
      : (
        cleanSource.startsWith('.emb-agent/')
          ? path.resolve(process.cwd(), cleanSource)
          : path.resolve(getProjectExtDir(), cleanSource.replace(/^\.emb-agent\//, ''))
      );
    const sourceRelative = path.relative(process.cwd(), sourcePath).replace(/\\/g, '/');
    const sourceDisplay = sourceRelative && !sourceRelative.startsWith('..')
      ? sourceRelative
      : runtime.getProjectAssetRelativePath(path.relative(getProjectExtDir(), sourcePath).replace(/\\/g, '/'));
    const toolOutput = readJsonIfExists(sourcePath);
    if (!toolOutput || typeof toolOutput !== 'object' || Array.isArray(toolOutput)) {
      throw new Error(`Tool output JSON not found or invalid: ${sourceArg}`);
    }

    const foundRegisterWrites = registerWriteArtifact.findRegisterWriteCandidate(toolOutput);
    const selected = foundRegisterWrites ? foundRegisterWrites.candidate : null;
    const registerWrites = foundRegisterWrites ? foundRegisterWrites.register_writes : null;
    const registers = registerWriteArtifact.normalizeRegisterNames(registerWrites);
    if (registers.length === 0) {
      throw new Error('No register writes found in tool output');
    }

    const inputOptions = toolOutput.inputs && toolOutput.inputs.options && typeof toolOutput.inputs.options === 'object'
      ? toolOutput.inputs.options
      : {};
    const chip = String(
      parseFlagValue(args, '--chip') ||
      toolOutput.chip ||
      currentHardwareChip() ||
      toolOutput.device ||
      inputOptions.chip ||
      inputOptions.device ||
      'project'
    ).trim();
    const chipSlug = slugify(chip);
    const toolName = String(toolOutput.tool || toolOutput.name || path.basename(sourcePath, '.json')).trim();
    const selectedObject = selected || toolOutput;
    const peripheral = String(
      selectedObject.timer ||
      selectedObject.pwm ||
      selectedObject.adc ||
      selectedObject.comparator ||
      toolName.replace(/-?calc$/i, '')
    ).trim();
    const formulas = [];
    const clockHz = inputOptions['clock-hz'] || inputOptions.clock_hz || toolOutput.clock_hz || selectedObject.clock_hz || '';
    const periodValue = Number(selectedObject.period_value ?? selectedObject.reload_value);
    const periodOffset = Number.isFinite(Number(selectedObject.ticks)) && Number.isFinite(periodValue)
      ? Number(selectedObject.ticks) - periodValue
      : 1;
    const periodTerm = Number.isFinite(periodOffset) && periodOffset !== 1
      ? `(period_value + ${periodOffset})`
      : '(period_value + 1)';
    const commonEvidence = {
      source: sourceDisplay,
      section: `${toolName} selected candidate`
    };
    if (selectedObject.actual_us !== undefined && Number.isFinite(periodValue)) {
      const includesPostscaler = selectedObject.postscaler !== undefined;
      formulas.push({
        id: `${chipSlug}.${slugify(peripheral || 'timer')}.period`,
        label: `${chip} ${peripheral || 'timer'} period`,
        peripheral: peripheral || 'timer',
        expression: includesPostscaler
          ? `(prescaler * postscaler * ${periodTerm} * 1000000) / clock_hz`
          : `(prescaler * ${periodTerm} * 1000000) / clock_hz`,
        variables: {
          clock_hz: clockHz ? `Input clock frequency in Hz; selected value ${clockHz}.` : 'Input clock frequency in Hz.',
          prescaler: `Selected prescaler value${selectedObject.prescaler === undefined ? '.' : ` ${selectedObject.prescaler}.`}`,
          ...(includesPostscaler ? { postscaler: `Selected postscaler value ${selectedObject.postscaler}.` } : {}),
          period_value: `Selected period/reload register value ${selectedObject.period_value ?? selectedObject.reload_value}.`
        },
        registers,
        evidence: commonEvidence,
        status: 'draft'
      });
    } else if (selectedObject.actual_hz !== undefined && Number.isFinite(periodValue)) {
      formulas.push({
        id: `${chipSlug}.${slugify(peripheral || 'pwm')}.frequency`,
        label: `${chip} ${peripheral || 'pwm'} frequency`,
        peripheral: peripheral || 'pwm',
        expression: `clock_hz / (prescaler * ${periodTerm})`,
        variables: {
          clock_hz: clockHz ? `Input clock frequency in Hz; selected value ${clockHz}.` : 'Input clock frequency in Hz.',
          prescaler: `Selected prescaler value${selectedObject.prescaler === undefined ? '.' : ` ${selectedObject.prescaler}.`}`,
          period_value: `Selected period register value ${selectedObject.period_value}.`
        },
        registers,
        evidence: commonEvidence,
        status: 'draft'
      });
      if (selectedObject.duty_value !== undefined || selectedObject.duty_steps !== undefined) {
        const dutyOffset = Number.isFinite(Number(selectedObject.duty_steps)) && Number.isFinite(Number(selectedObject.duty_value))
          ? Number(selectedObject.duty_steps) - Number(selectedObject.duty_value)
          : 0;
        const dutyTerm = dutyOffset === 0 ? 'duty_value' : `(duty_value + ${dutyOffset})`;
        formulas.push({
          id: `${chipSlug}.${slugify(peripheral || 'pwm')}.duty`,
          label: `${chip} ${peripheral || 'pwm'} duty`,
          peripheral: peripheral || 'pwm',
          expression: `(${dutyTerm} / ${periodTerm}) * 100`,
          variables: {
            duty_value: `Selected duty register value ${selectedObject.duty_value}.`,
            period_value: `Selected period register value ${selectedObject.period_value}.`
          },
          registers,
          evidence: commonEvidence,
          status: 'draft'
        });
      }
    }
    if (formulas.length === 0) {
      formulas.push({
        id: `${chipSlug}.${slugify(peripheral || toolName)}.register-write`,
        label: `${chip} ${peripheral || toolName} register write`,
        peripheral: peripheral || toolName,
        expression: 'Derived by saved tool output; inspect evidence before reuse.',
        variables: Object.fromEntries(
          Object.entries(selectedObject)
            .filter(([, value]) => typeof value === 'number' || typeof value === 'string')
            .slice(0, 12)
            .map(([key, value]) => [key, `Selected tool output value ${value}.`])
        ),
        registers,
        evidence: commonEvidence,
        status: 'draft'
      });
    }

    const registry = {
      version: 'emb-agent.formulas/1',
      chip,
      status: 'draft',
      source: sourceDisplay,
      formulas
    };
    const formulasDir = path.join(getProjectExtDir(), 'formulas');
    const targetPath = path.join(formulasDir, `${chipSlug}.json`);
    const targetDisplay = runtime.getProjectAssetRelativePath('formulas', `${chipSlug}.json`);
    const nextSteps = knowledgeFollowups.buildFormulaDraftFollowups({
      formulaId: formulas[0].id,
      firstRegister: registers[0]
    });
    if (!explicitConfirmation) {
      return {
        status: 'confirmation-required',
        write_mode: 'preview',
        action: 'knowledge-formula-draft',
        source: sourceDisplay,
        target: targetDisplay,
        formula_count: formulas.length,
        registry,
        next_steps: [`Re-run with --confirm to write ${targetDisplay}`]
      };
    }
    const permissionDecision = evaluateKnowledgeWritePermission('knowledge-formula-draft', true);
    if (permissionDecision.decision !== 'allow') {
      return permissionGateHelpers.applyPermissionDecision({
        status: 'confirmation-required',
        write_mode: 'preview',
        action: 'knowledge-formula-draft',
        source: sourceDisplay,
        target: targetDisplay,
        formula_count: formulas.length,
        registry,
        next_steps: [`Re-run with --confirm to write ${targetDisplay}`]
      }, permissionDecision);
    }
    runtime.ensureDir(formulasDir);
    const existing = readJsonIfExists(targetPath);
    if (existing && !Array.isArray(existing.formulas) && !force) {
      throw new Error(`Formula registry is invalid: ${targetDisplay}. Re-run with --force to overwrite.`);
    }
    const byId = new Map();
    (existing && Array.isArray(existing.formulas) ? existing.formulas : []).forEach(item => {
      if (item && item.id) {
        byId.set(String(item.id), item);
      }
    });
    formulas.forEach(item => byId.set(item.id, item));
    const writtenRegistry = {
      version: 'emb-agent.formulas/1',
      chip: (existing && existing.chip) || chip,
      status: (existing && existing.status) || 'draft',
      source: (existing && existing.source) || sourceDisplay,
      formulas: [...byId.values()]
    };
    fs.writeFileSync(targetPath, JSON.stringify(writtenRegistry, null, 2) + '\n', 'utf8');
    ensureKnowledgeDirs();
    appendLog('formula', `Draft formula registry for ${chip}`, [
      `Wrote ${targetDisplay}`,
      `Source ${sourceDisplay}`,
      'Run knowledge graph refresh before relying on graph navigation.'
    ]);
    updateSession(current => {
      current.last_command = 'knowledge formula draft';
      current.last_files = runtime.unique([
        targetDisplay,
        sourceDisplay,
        getWikiRelativePath('log.md'),
        ...(current.last_files || [])
      ]).slice(0, 8);
    });
    return permissionGateHelpers.applyPermissionDecision({
      status: 'written',
      write_mode: 'confirmed-write',
      action: 'knowledge-formula-draft',
      source: sourceDisplay,
      target: targetDisplay,
      formula_count: formulas.length,
      formulas,
      next_steps: nextSteps
    }, permissionDecision);
  }

  function readKnowledgeIndex(options = {}) {
    const wikiDir = getWikiDir();
    if (!fs.existsSync(wikiDir)) {
      return {
        initialized: false,
        wiki_dir: getWikiRelativePath(),
        next_steps: ['knowledge init']
      };
    }
    if (options.rebuild === true) {
      const index = writeIndex();
      appendLog('lint', 'Rebuild index', [`Updated ${index.path}`]);
      return {
        initialized: true,
        rebuilt: true,
        index_file: index.path,
        pages: index.pages,
        content: index.content
      };
    }
    const indexPath = getWikiPath('index.md');
    return {
      initialized: true,
      index_file: getWikiRelativePath('index.md'),
      pages: listMarkdownPages(),
      content: readTextIfExists(indexPath)
    };
  }

  function readKnowledgeLog(rest) {
    const tailArg = parseFlagValue(rest || [], '--tail');
    const tail = tailArg ? Number(tailArg) : 20;
    const logPath = getWikiPath('log.md');
    if (!fs.existsSync(logPath)) {
      return {
        initialized: false,
        log_file: getWikiRelativePath('log.md'),
        entries: [],
        next_steps: ['knowledge init']
      };
    }
    const content = readTextIfExists(logPath);
    const entries = content
      .split('\n')
      .filter(line => /^## \[/.test(line))
      .slice(Number.isFinite(tail) && tail > 0 ? -tail : -20);
    return {
      initialized: true,
      log_file: getWikiRelativePath('log.md'),
      entries,
      content
    };
  }

  function extractWikiLinks(content) {
    const links = [];
    const wikiPattern = /\[\[([^\]]+)\]\]/g;
    const mdPattern = /\]\(([^)]+\.md)\)/g;
    let match = wikiPattern.exec(content);
    while (match) {
      links.push(match[1].replace(/\.md$/, ''));
      match = wikiPattern.exec(content);
    }
    match = mdPattern.exec(content);
    while (match) {
      links.push(match[1].replace(/^\.?\//, '').replace(/\.md$/, ''));
      match = mdPattern.exec(content);
    }
    return runtime.unique(links);
  }

  function readHardwareChipSlug() {
    const hwPath = path.join(getProjectExtDir(), 'hw.yaml');
    if (!fs.existsSync(hwPath)) {
      return '';
    }
    const parsed = runtime.parseSimpleYaml(hwPath);
    return parsed && parsed.chip ? slugify(parsed.chip) : '';
  }

  function lintKnowledgeWiki() {
    const wikiDir = getWikiDir();
    const issues = [];
    if (!fs.existsSync(wikiDir)) {
      return {
        status: 'missing',
        issues: [
          {
            severity: 'warn',
            code: 'wiki-missing',
            summary: 'Knowledge wiki has not been initialized.',
            recommendation: 'Run knowledge init.'
          }
        ],
        next_steps: ['knowledge init']
      };
    }
    WIKI_DIRS.forEach(dirName => {
      if (!fs.existsSync(path.join(wikiDir, dirName))) {
        issues.push({
          severity: 'warn',
          code: 'missing-directory',
          path: getWikiRelativePath(dirName),
          summary: `Missing knowledge directory: ${dirName}`,
          recommendation: 'Run knowledge init.'
        });
      }
    });
    ['index.md', 'log.md'].forEach(fileName => {
      if (!fs.existsSync(path.join(wikiDir, fileName))) {
        issues.push({
          severity: 'warn',
          code: 'missing-control-file',
          path: getWikiRelativePath(fileName),
          summary: `Missing knowledge control file: ${fileName}`,
          recommendation: 'Run knowledge init.'
        });
      }
    });

    const pages = listMarkdownPages();
    const pageKeys = new Set(pages.map(page => page.path.replace(/\.md$/, '')));
    const inbound = new Map();
    pages.forEach(page => inbound.set(page.path.replace(/\.md$/, ''), 0));
    pages.forEach(page => {
      const content = readTextIfExists(getWikiPath(page.path));
      extractWikiLinks(content).forEach(link => {
        const normalized = link.replace(/^wiki\//, '').replace(/\.md$/, '');
        if (inbound.has(normalized)) {
          inbound.set(normalized, inbound.get(normalized) + 1);
        }
      });
    });
    [...inbound.entries()]
      .filter(([key, count]) => count === 0 && !key.startsWith('sources/'))
      .forEach(([key]) => {
        issues.push({
          severity: 'info',
          code: 'orphan-page',
          path: getWikiRelativePath(`${key}.md`),
          summary: 'Knowledge page has no inbound wiki links.',
          recommendation: 'Add cross-references or confirm the page should remain standalone.'
        });
      });

    const indexContent = readTextIfExists(getWikiPath('index.md'));
    pages.forEach(page => {
      const key = page.path.replace(/\.md$/, '');
      if (indexContent && !indexContent.includes(`[[${key}]]`)) {
        issues.push({
          severity: 'warn',
          code: 'unindexed-page',
          path: getWikiRelativePath(page.path),
          summary: 'Knowledge page is not listed in index.md.',
          recommendation: 'Run knowledge index --rebuild.'
        });
      }
    });

    const chipSlug = readHardwareChipSlug();
    if (chipSlug && !pageKeys.has(`chips/${chipSlug}`)) {
      issues.push({
        severity: 'info',
        code: 'missing-chip-page',
        path: getWikiRelativePath(`chips/${chipSlug}.md`),
        summary: 'Hardware truth declares a chip but no matching chip wiki page exists.',
        recommendation: `Run knowledge save-query --kind chip "${chipSlug}" --confirm after reviewing source evidence.`
      });
    }

    const status = issues.some(item => item.severity === 'warn') ? 'warn' : 'ok';
    updateSession(current => {
      current.last_command = 'knowledge lint';
    });
    return {
      status,
      wiki_dir: getWikiRelativePath(),
      page_count: pages.length,
      issues,
      next_steps: issues.length > 0
        ? runtime.unique(issues.map(item => item.recommendation).filter(Boolean)).slice(0, 5)
        : []
    };
  }

  function showKnowledgePage(target) {
    if (!target) {
      throw new Error('Missing knowledge page path');
    }
    const cleanTarget = String(target || '').replace(/^\.emb-agent\/wiki\//, '').replace(/\.md$/, '');
    const filePath = getWikiPath(`${cleanTarget}.md`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Knowledge page not found: ${target}`);
    }
    return {
      path: getWikiRelativePath(`${cleanTarget}.md`),
      content: readTextIfExists(filePath)
    };
  }

  function listFilesRecursive(dirPath, predicate) {
    if (!fs.existsSync(dirPath)) {
      return [];
    }
    const files = [];
    function walk(currentDir) {
      fs.readdirSync(currentDir, { withFileTypes: true }).forEach(entry => {
        const filePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(filePath);
          return;
        }
        if (entry.isFile() && (!predicate || predicate(filePath))) {
          files.push(filePath);
        }
      });
    }
    walk(dirPath);
    return files.sort();
  }

  function pushGraphNode(nodes, node) {
    const existing = nodes.get(node.id);
    if (existing) {
      nodes.set(node.id, {
        ...existing,
        ...node,
        sources: runtime.unique([...(existing.sources || []), ...(node.sources || [])])
      });
      return node.id;
    }
    nodes.set(node.id, {
      ...node,
      sources: runtime.unique(node.sources || [])
    });
    return node.id;
  }

  function pushGraphEdge(edges, edge) {
    const key = `${edge.from}\u0000${edge.type}\u0000${edge.to}\u0000${edge.source || ''}`;
    if (!edges.has(key)) {
      edges.set(key, edge);
    }
  }

  function addFileNode(nodes, relativePath, summary) {
    return pushGraphNode(nodes, {
      id: buildGraphNodeId('file', relativePath),
      type: 'file',
      label: relativePath,
      path: relativePath,
      summary: summary || '',
      status: 'confirmed',
      sources: [relativePath]
    });
  }

  function addTruthFileGraph(nodes, edges, relativePath, summary) {
    const projectExtDir = getProjectExtDir();
    const filePath = path.join(projectExtDir, relativePath);
    if (!fs.existsSync(filePath)) {
      return;
    }
    const displayPath = runtime.getProjectAssetRelativePath(relativePath);
    const fileNode = addFileNode(nodes, displayPath, summary);
    const content = readTextIfExists(filePath);
    const parsed = relativePath.endsWith('.json')
      ? readJsonIfExists(filePath)
      : runtime.parseSimpleYaml(filePath);

    if (relativePath === 'hw.yaml') {
      const chip = parsed && parsed.chip ? String(parsed.chip).trim() : '';
      const pkg = parsed && parsed.package ? String(parsed.package).trim() : '';
      if (chip) {
        const chipNode = pushGraphNode(nodes, {
          id: buildGraphNodeId('chip', slugify(chip)),
          type: 'chip',
          label: chip,
          summary: 'Chip declared in hardware truth.',
          status: 'confirmed',
          sources: [displayPath]
        });
        pushGraphEdge(edges, buildGraphEdge(fileNode, chipNode, 'declares', {
          source: displayPath,
          summary: 'hw.yaml declares chip identity.'
        }));
      }
      if (pkg) {
        const packageNode = pushGraphNode(nodes, {
          id: buildGraphNodeId('package', slugify(pkg)),
          type: 'package',
          label: pkg,
          summary: 'Package declared in hardware truth.',
          status: 'confirmed',
          sources: [displayPath]
        });
        pushGraphEdge(edges, buildGraphEdge(fileNode, packageNode, 'declares', {
          source: displayPath,
          summary: 'hw.yaml declares package identity.'
        }));
      }
      const signalMatches = [...content.matchAll(/(?:name|signal):\s*"?([^"\n#]+)"?/g)]
        .map(match => match[1].trim())
        .filter(Boolean);
      signalMatches.forEach(signal => {
        const signalNode = pushGraphNode(nodes, {
          id: buildGraphNodeId('signal', slugify(signal)),
          type: 'signal',
          label: signal,
          summary: 'Signal mentioned in hardware truth.',
          status: 'confirmed',
          sources: [displayPath]
        });
        pushGraphEdge(edges, buildGraphEdge(fileNode, signalNode, 'mentions', {
          source: displayPath
        }));
      });
    }

    if (relativePath === 'req.yaml') {
      ['goal', 'goals', 'interface', 'interfaces', 'acceptance', 'risk', 'risks'].forEach(key => {
        const pattern = new RegExp(`(?:^|\\n)\\s*${key}:\\s*"?([^"\\n#]+)"?`, 'g');
        [...content.matchAll(pattern)].forEach(match => {
          const value = match[1].trim();
          if (!value) return;
          const reqNode = pushGraphNode(nodes, {
            id: buildGraphNodeId(`requirement-${key}`, slugify(value)),
            type: key.includes('risk') ? 'risk' : 'requirement',
            label: value,
            summary: `Requirement ${key} mentioned in req.yaml.`,
            status: 'confirmed',
            sources: [displayPath]
          });
          pushGraphEdge(edges, buildGraphEdge(fileNode, reqNode, 'declares', {
            source: displayPath
          }));
        });
      });
    }
  }

  function addWikiGraph(nodes, edges) {
    const pages = listMarkdownPages();
    const pageByKey = new Map(pages.map(page => [page.path.replace(/\.md$/, ''), page]));
    pages.forEach(page => {
      const displayPath = getWikiRelativePath(page.path);
      const pageNode = pushGraphNode(nodes, {
        id: buildGraphNodeId('wiki', page.path.replace(/\.md$/, '')),
        type: 'wiki_page',
        label: page.title,
        path: displayPath,
        summary: page.summary,
        status: 'draft',
        sources: [displayPath]
      });
      const content = readTextIfExists(getWikiPath(page.path));
      extractWikiLinks(content).forEach(link => {
        const normalized = link.replace(/^wiki\//, '').replace(/\.md$/, '');
        const targetPage = pageByKey.get(normalized);
        const targetNode = targetPage
          ? buildGraphNodeId('wiki', normalized)
          : pushGraphNode(nodes, {
              id: buildGraphNodeId('concept', slugify(normalized)),
              type: 'concept',
              label: normalized,
              summary: 'Mentioned by a wiki link but no matching wiki page exists.',
              status: 'candidate',
              sources: [displayPath]
            });
        pushGraphEdge(edges, buildGraphEdge(pageNode, targetNode, targetPage ? 'links_to' : 'mentions', {
          source: displayPath,
          basis: targetPage ? 'EXTRACTED' : 'AMBIGUOUS',
          status: targetPage ? 'confirmed' : 'candidate',
          confidence: targetPage ? 1 : 0.45
        }));
      });
      const frontmatter = extractFrontmatter(content);
      if (frontmatter.kind) {
        const kindNode = pushGraphNode(nodes, {
          id: buildGraphNodeId('knowledge-kind', frontmatter.kind),
          type: 'knowledge_kind',
          label: frontmatter.kind,
          summary: 'Knowledge page category.',
          status: 'confirmed',
          sources: [displayPath]
        });
        pushGraphEdge(edges, buildGraphEdge(pageNode, kindNode, 'classified_as', {
          source: displayPath
        }));
      }
    });
  }

  function addFormulaGraph(nodes, edges) {
    const formulasDir = path.join(getProjectExtDir(), 'formulas');
    listFilesRecursive(formulasDir, filePath => /\.json$/i.test(filePath)).forEach(filePath => {
      const parsed = readJsonIfExists(filePath);
      if (!parsed || !Array.isArray(parsed.formulas)) {
        return;
      }
      const relativePath = path.relative(getProjectExtDir(), filePath).replace(/\\/g, '/');
      const displayPath = runtime.getProjectAssetRelativePath(relativePath);
      const fileNode = addFileNode(nodes, displayPath, 'Structured formula registry.');
      const chip = String(parsed.chip || parsed.device || '').trim();
      const chipNode = chip
        ? pushGraphNode(nodes, {
            id: buildGraphNodeId('chip', slugify(chip)),
            type: 'chip',
            label: chip,
            summary: 'Chip referenced by formula registry.',
            status: 'draft',
            sources: [displayPath]
          })
        : '';
      if (chipNode) {
        pushGraphEdge(edges, buildGraphEdge(fileNode, chipNode, 'targets_chip', {
          source: displayPath,
          status: 'draft'
        }));
      }

      parsed.formulas.forEach(item => {
        const id = String(item.id || item.name || '').trim();
        if (!id) {
          return;
        }
        const formulaNode = pushGraphNode(nodes, {
          id: buildGraphNodeId('formula', id),
          type: 'formula',
          label: item.label || id,
          path: displayPath,
          summary: item.summary || item.expression || '',
          expression: item.expression || '',
          status: item.status || parsed.status || 'draft',
          sources: [displayPath]
        });
        pushGraphEdge(edges, buildGraphEdge(fileNode, formulaNode, 'declares', {
          source: displayPath,
          status: item.status || parsed.status || 'draft',
          summary: 'Formula registry declares formula.'
        }));
        if (chipNode) {
          pushGraphEdge(edges, buildGraphEdge(formulaNode, chipNode, 'belongs_to_chip', {
            source: displayPath,
            status: item.status || parsed.status || 'draft'
          }));
        }
        const peripheral = String(item.peripheral || item.module || '').trim();
        if (peripheral) {
          const peripheralNode = pushGraphNode(nodes, {
            id: buildGraphNodeId('peripheral', slugify(`${chip || 'project'}-${peripheral}`)),
            type: 'peripheral',
            label: peripheral,
            summary: 'Peripheral referenced by formula registry.',
            status: item.status || parsed.status || 'draft',
            sources: [displayPath]
          });
          pushGraphEdge(edges, buildGraphEdge(formulaNode, peripheralNode, 'belongs_to_peripheral', {
            source: displayPath,
            status: item.status || parsed.status || 'draft'
          }));
        }
        (item.registers || []).forEach(register => {
          const registerName = String(register || '').trim();
          if (!registerName) return;
          const registerNode = pushGraphNode(nodes, {
            id: buildGraphNodeId('register', slugify(`${chip || 'project'}-${registerName}`)),
            type: 'register',
            label: registerName,
            summary: 'Register used by formula.',
            status: item.status || parsed.status || 'draft',
            sources: [displayPath]
          });
          pushGraphEdge(edges, buildGraphEdge(formulaNode, registerNode, 'uses_register', {
            source: displayPath,
            status: item.status || parsed.status || 'draft'
          }));
        });
        const variables = item.variables && typeof item.variables === 'object' ? item.variables : {};
        Object.keys(variables).forEach(name => {
          const parameterNode = pushGraphNode(nodes, {
            id: buildGraphNodeId('parameter', slugify(`${id}-${name}`)),
            type: 'parameter',
            label: name,
            summary: String(variables[name] || ''),
            status: item.status || parsed.status || 'draft',
            sources: [displayPath]
          });
          pushGraphEdge(edges, buildGraphEdge(formulaNode, parameterNode, 'uses_parameter', {
            source: displayPath,
            status: item.status || parsed.status || 'draft'
          }));
        });
        const evidence = item.evidence && typeof item.evidence === 'object' ? item.evidence : {};
        const evidenceSource = String(evidence.source || parsed.source || '').trim();
        if (evidenceSource) {
          const evidenceNode = addFileNode(nodes, evidenceSource, evidence.section || 'Formula evidence source.');
          pushGraphEdge(edges, buildGraphEdge(formulaNode, evidenceNode, 'evidenced_by', {
            source: displayPath,
            status: item.status || parsed.status || 'draft',
            summary: evidence.section || ''
          }));
        }
      });
    });
  }

  function currentHardwareChip() {
    const hwPath = path.join(getProjectExtDir(), 'hw.yaml');
    if (!fs.existsSync(hwPath)) {
      return '';
    }
    const parsed = runtime.parseSimpleYaml(hwPath) || {};
    return String(parsed.chip || parsed.model || parsed.device || '').trim();
  }

  function registerNodeIdFor(chip, registerName) {
    return buildGraphNodeId('register', slugify(`${chip || 'project'}-${registerName}`));
  }

  function linkToolRunToMatchingFormulas(nodes, edges, toolRunNode, registerNodeIds, source) {
    const registerSet = new Set(registerNodeIds);
    [...edges.values()]
      .filter(edge => edge.type === 'uses_register' && registerSet.has(edge.to))
      .forEach(edge => {
        const formulaNode = nodes.get(edge.from);
        if (!formulaNode || formulaNode.type !== 'formula') {
          return;
        }
        pushGraphEdge(edges, buildGraphEdge(toolRunNode, edge.from, 'uses_formula', {
          source,
          status: 'draft',
          basis: 'INFERRED',
          confidence: 0.75,
          summary: 'Tool run writes a register used by this formula.'
        }));
      });
  }

  function addToolRunGraph(nodes, edges) {
    const runsDir = path.join(getProjectExtDir(), 'runs');
    const projectChip = currentHardwareChip();
    listFilesRecursive(runsDir, filePath => /\.json$/i.test(filePath)).forEach(filePath => {
      const parsed = readJsonIfExists(filePath);
      if (!parsed || typeof parsed !== 'object') {
        return;
      }
      const relativePath = path.relative(getProjectExtDir(), filePath).replace(/\\/g, '/');
      const displayPath = runtime.getProjectAssetRelativePath(relativePath);
      const registerWrites = registerWriteArtifact.findRegisterWrites(parsed);
      const registerNames = registerWriteArtifact.normalizeRegisterNames(registerWrites);
      const toolName = String(parsed.tool || parsed.name || path.basename(filePath, '.json')).trim();
      const chip = String(
        parsed.chip ||
        projectChip ||
        parsed.device ||
        (parsed.inputs && parsed.inputs.options && (parsed.inputs.options.chip || parsed.inputs.options.device)) ||
        ''
      ).trim();
      const fileNode = addFileNode(nodes, displayPath, 'Saved tool run output.');
      const toolRunNode = pushGraphNode(nodes, {
        id: buildGraphNodeId('tool-run', relativePath),
        type: 'tool_run',
        label: toolName,
        path: displayPath,
        summary: registerNames.length > 0
          ? `Tool run ${toolName} writes ${registerNames.join(', ')}.`
          : `Tool run ${toolName}.`,
        status: parsed.status || 'draft',
        sources: [displayPath]
      });
      pushGraphEdge(edges, buildGraphEdge(fileNode, toolRunNode, 'declares', {
        source: displayPath,
        status: parsed.status || 'draft'
      }));
      if (chip) {
        const chipNode = pushGraphNode(nodes, {
          id: buildGraphNodeId('chip', slugify(chip)),
          type: 'chip',
          label: chip,
          summary: 'Chip targeted by saved tool run output.',
          status: projectChip && slugify(projectChip) === slugify(chip) ? 'confirmed' : 'draft',
          sources: [displayPath]
        });
        pushGraphEdge(edges, buildGraphEdge(toolRunNode, chipNode, 'targets_chip', {
          source: displayPath,
          status: parsed.status || 'draft'
        }));
      }
      const registerNodeIds = registerNames.map(registerName => {
        const registerNode = pushGraphNode(nodes, {
          id: registerNodeIdFor(chip, registerName),
          type: 'register',
          label: registerName,
          summary: 'Register written by saved tool run output.',
          status: parsed.status || 'draft',
          sources: [displayPath]
        });
        pushGraphEdge(edges, buildGraphEdge(toolRunNode, registerNode, 'writes_register', {
          source: displayPath,
          status: parsed.status || 'draft'
        }));
        return registerNode;
      });
      linkToolRunToMatchingFormulas(nodes, edges, toolRunNode, registerNodeIds, displayPath);
    });
  }

  function extractSnippetRegisters(content) {
    return [...String(content || '').matchAll(/^- `([^`]+)`:\s+mask /gm)]
      .map(match => match[1].trim())
      .filter(Boolean);
  }

  function normalizeProjectAssetPath(value) {
    const text = String(value || '').trim().replace(/\\/g, '/');
    return text.replace(/^\.emb-agent\//, '');
  }

  function addFirmwareSnippetGraph(nodes, edges) {
    const snippetsDir = path.join(getProjectExtDir(), 'firmware-snippets');
    const projectChip = currentHardwareChip();
    listFilesRecursive(snippetsDir, filePath => /\.md$/i.test(filePath)).forEach(filePath => {
      const content = readTextIfExists(filePath);
      const frontmatter = extractFrontmatter(content);
      const relativePath = path.relative(getProjectExtDir(), filePath).replace(/\\/g, '/');
      const displayPath = runtime.getProjectAssetRelativePath(relativePath);
      const registerNames = extractSnippetRegisters(content);
      const sourceToolOutput = normalizeProjectAssetPath(frontmatter.source_tool_output || '');
      const fileNode = addFileNode(nodes, displayPath, 'Firmware snippet review artifact.');
      const snippetNode = pushGraphNode(nodes, {
        id: buildGraphNodeId('firmware-snippet', relativePath),
        type: 'firmware_snippet',
        label: frontmatter.title || extractTitle(relativePath, content),
        path: displayPath,
        summary: registerNames.length > 0
          ? `Firmware snippet artifact touching ${registerNames.join(', ')}.`
          : extractSummary(content),
        status: frontmatter.status || 'draft',
        sources: [displayPath]
      });
      pushGraphEdge(edges, buildGraphEdge(fileNode, snippetNode, 'declares', {
        source: displayPath,
        status: frontmatter.status || 'draft'
      }));
      if (sourceToolOutput) {
        const toolRunNode = buildGraphNodeId('tool-run', sourceToolOutput);
        if (!nodes.has(toolRunNode)) {
          pushGraphNode(nodes, {
            id: toolRunNode,
            type: 'tool_run',
            label: path.basename(sourceToolOutput, '.json'),
            path: runtime.getProjectAssetRelativePath(sourceToolOutput),
            summary: 'Saved tool run output referenced by firmware snippet artifact.',
            status: 'draft',
            sources: [displayPath]
          });
        }
        pushGraphEdge(edges, buildGraphEdge(toolRunNode, snippetNode, 'materialized_by', {
          source: displayPath,
          status: frontmatter.status || 'draft',
          summary: 'Saved tool run output was materialized as a firmware snippet review artifact.'
        }));
      }
      registerNames.forEach(registerName => {
        const registerNode = pushGraphNode(nodes, {
          id: registerNodeIdFor(projectChip, registerName),
          type: 'register',
          label: registerName,
          summary: 'Register referenced by firmware snippet artifact.',
          status: frontmatter.status || 'draft',
          sources: [displayPath]
        });
        pushGraphEdge(edges, buildGraphEdge(snippetNode, registerNode, 'writes_register', {
          source: displayPath,
          status: frontmatter.status || 'draft'
        }));
      });
    });
  }

  function addTaskGraph(nodes, edges) {
    const tasksDir = path.join(getProjectExtDir(), 'tasks');
    listFilesRecursive(tasksDir, filePath => path.basename(filePath) === 'task.json').forEach(filePath => {
      const task = readJsonIfExists(filePath);
      if (!task || !task.name) {
        return;
      }
      const relativeTaskPath = runtime.getProjectAssetRelativePath(
        path.relative(getProjectExtDir(), filePath).replace(/\\/g, '/')
      );
      const taskNode = pushGraphNode(nodes, {
        id: buildGraphNodeId('task', task.name),
        type: 'task',
        label: task.title || task.name,
        path: relativeTaskPath,
        summary: task.description || '',
        status: task.status || 'unknown',
        sources: [relativeTaskPath]
      });
      (task.related_files || []).forEach(file => {
        const fileNode = addFileNode(nodes, file, 'Task related file.');
        pushGraphEdge(edges, buildGraphEdge(taskNode, fileNode, 'depends_on', {
          source: relativeTaskPath,
          status: task.status || 'unknown'
        }));
      });
    });
  }

  function addSessionReportGraph(nodes, edges) {
    const indexPath = path.join(getProjectExtDir(), 'reports', 'sessions', 'INDEX.md');
    if (!fs.existsSync(indexPath)) {
      return;
    }
    const displayPath = runtime.getProjectAssetRelativePath('reports', 'sessions', 'INDEX.md');
    const indexNode = addFileNode(nodes, displayPath, 'Session report index.');
    const content = readTextIfExists(indexPath);
    [...content.matchAll(/\]\(([^)]+report-[^)]+\.md)\)/g)].forEach(match => {
      const reportPath = match[1].replace(/^\.?\//, '');
      const reportNode = pushGraphNode(nodes, {
        id: buildGraphNodeId('report', reportPath),
        type: 'report',
        label: path.basename(reportPath, '.md'),
        path: reportPath,
        summary: 'Stored session report.',
        status: 'confirmed',
        sources: [displayPath]
      });
      pushGraphEdge(edges, buildGraphEdge(indexNode, reportNode, 'indexes', {
        source: displayPath
      }));
    });
  }

  function addSchematicGraph(nodes, edges) {
    const projectExtDir = getProjectExtDir();
    listFilesRecursive(projectExtDir, filePath => /\.json$/i.test(filePath) && /schematic|netlist|parsed/i.test(filePath))
      .slice(0, 20)
      .forEach(filePath => {
        const parsed = readJsonIfExists(filePath);
        if (!parsed || (!Array.isArray(parsed.components) && !Array.isArray(parsed.nets))) {
          return;
        }
        const relativePath = runtime.getProjectAssetRelativePath(path.relative(projectExtDir, filePath).replace(/\\/g, '/'));
        const artifactNode = addFileNode(nodes, relativePath, 'Schematic analysis artifact.');
        (parsed.components || []).slice(0, 200).forEach(component => {
          const ref = component.ref || component.designator || component.id || '';
          if (!ref) return;
          const componentNode = pushGraphNode(nodes, {
            id: buildGraphNodeId('component', ref),
            type: 'component',
            label: ref,
            summary: component.value || component.libref || '',
            status: 'candidate',
            sources: [relativePath]
          });
          pushGraphEdge(edges, buildGraphEdge(artifactNode, componentNode, 'contains', {
            source: relativePath,
            status: 'candidate'
          }));
        });
        (parsed.nets || []).slice(0, 200).forEach(net => {
          const name = net.name || net.id || '';
          if (!name) return;
          const netNode = pushGraphNode(nodes, {
            id: buildGraphNodeId('net', name),
            type: 'net',
            label: name,
            summary: 'Schematic net.',
            status: 'candidate',
            sources: [relativePath]
          });
          pushGraphEdge(edges, buildGraphEdge(artifactNode, netNode, 'contains', {
            source: relativePath,
            status: 'candidate'
          }));
        });
      });
  }

  function buildGraphManifest(files) {
    return knowledgeGraphState.buildKnowledgeGraphManifest(process.cwd(), {
      fs,
      path,
      runtime,
      getProjectExtDir
    }, files);
  }

  function getGraphTrackedFiles() {
    return knowledgeGraphState.listKnowledgeGraphTrackedFiles(process.cwd(), {
      fs,
      path,
      runtime,
      getProjectExtDir
    });
  }

  function readGraphFreshness(graph) {
    return knowledgeGraphState.readKnowledgeGraphFreshness(process.cwd(), graph, {
      fs,
      path,
      runtime,
      getProjectExtDir
    });
  }

  function ensureWikiStubs() {
    try {
      const hwPath = path.join(getProjectExtDir(), 'hw.yaml');
      if (!fs.existsSync(hwPath)) return;
      const hwText = fs.readFileSync(hwPath, 'utf8');

      function readIndentedKey(text, prefix) {
        const line = text.split(/\r?\n/).find(l => l.startsWith(prefix));
        if (!line) return '';
        return line.slice(prefix.length).trim().replace(/^["']|["']$/g, '');
      }

      const model = readIndentedKey(hwText, '  model:');
      const vendor = readIndentedKey(hwText, '  vendor:');
      const pkg = readIndentedKey(hwText, '  package:');
      const chipSlug = model ? model.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-') : '';

      if (chipSlug && !fs.existsSync(getWikiPath('chips', `${chipSlug}.md`))) {
        const chipPage = [
          `# ${model} (${vendor || ''})`,
          '',
          `Package: ${pkg || 'unknown'}`,
          '',
          '## Registers',
          '',
          '> Document register map discovered from datasheet here.',
          '',
          '## Peripherals',
          '',
          '> List confirmed peripherals and their configurations.',
          '',
          '## Constraints',
          '',
          '> Record timing, voltage, and pin-mapping constraints.',
          ''
        ].join('\n');
        runtime.ensureDir(path.dirname(getWikiPath('chips', `${chipSlug}.md`)));
        fs.writeFileSync(getWikiPath('chips', `${chipSlug}.md`), chipPage, 'utf8');
      }

      if (!fs.existsSync(getWikiPath('sources', 'firmware-analysis.md'))) {
        const sourcesPage = [
          '# Firmware Analysis',
          '',
          '> Document firmware structure, key routines, and configuration constants.',
          '',
          '## Architecture',
          '',
          '> main() flow, interrupt handlers, module relationships.',
          '',
          '## Key Constants',
          '',
          '> All #define values that control behavior.',
          '',
          '## State Variables',
          '',
          '> Global flags and their write sites.',
          ''
        ].join('\n');
        runtime.ensureDir(path.dirname(getWikiPath('sources', 'firmware-analysis.md')));
        fs.writeFileSync(getWikiPath('sources', 'firmware-analysis.md'), sourcesPage, 'utf8');
      }
    } catch { /* stubs are best-effort */ }
  }

  function buildKnowledgeGraph() {
    ensureKnowledgeDirs();
    ensureGraphDirs();
    const nodes = new Map();
    const edges = new Map();
    addTruthFileGraph(nodes, edges, 'project.json', 'Project configuration truth.');
    addTruthFileGraph(nodes, edges, 'hw.yaml', 'Hardware truth.');
    addTruthFileGraph(nodes, edges, 'req.yaml', 'Requirement truth.');
    addWikiGraph(nodes, edges);
    addFormulaGraph(nodes, edges);
    addToolRunGraph(nodes, edges);
    addFirmwareSnippetGraph(nodes, edges);
    addTaskGraph(nodes, edges);
    addSessionReportGraph(nodes, edges);
    addSchematicGraph(nodes, edges);

    const nodeList = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
    const edgeList = [...edges.values()].sort((a, b) => `${a.from}:${a.type}:${a.to}`.localeCompare(`${b.from}:${b.type}:${b.to}`));
    const trackedFiles = getGraphTrackedFiles();
    const graph = {
      version: 'emb-agent.graph/1',
      generated_at: new Date().toISOString(),
      graph_dir: getGraphRelativePath(),
      stats: {
        nodes: nodeList.length,
        edges: edgeList.length,
        ambiguous_edges: edgeList.filter(edge => edge.basis === 'AMBIGUOUS').length
      },
      nodes: nodeList,
      edges: edgeList,
      manifest: buildGraphManifest(trackedFiles)
    };
    const graphPath = getGraphPath('graph.json');
    const reportPath = getGraphPath('GRAPH_REPORT.md');
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf8');
    fs.writeFileSync(reportPath, buildGraphReportMarkdown(graph), 'utf8');
    fs.writeFileSync(getGraphPath('cache', 'manifest.json'), JSON.stringify(graph.manifest, null, 2) + '\n', 'utf8');
    ensureWikiStubs();
    appendLog('graph', 'Build knowledge graph', [
      `Wrote ${getGraphRelativePath('graph.json')}`,
      `Wrote ${getGraphRelativePath('GRAPH_REPORT.md')}`,
      `Nodes: ${graph.stats.nodes}; edges: ${graph.stats.edges}`
    ]);
    updateSession(current => {
      current.last_command = 'knowledge graph build';
      current.last_files = runtime.unique([
        getGraphRelativePath('GRAPH_REPORT.md'),
        getGraphRelativePath('graph.json'),
        ...(current.last_files || [])
      ]).slice(0, 8);
    });
    return {
      status: 'built',
      graph_file: getGraphRelativePath('graph.json'),
      report_file: getGraphRelativePath('GRAPH_REPORT.md'),
      manifest_file: getGraphRelativePath('cache', 'manifest.json'),
      stats: graph.stats
    };
  }

  function loadKnowledgeGraph(options = {}) {
    const graphPath = getGraphPath('graph.json');
    if (!fs.existsSync(graphPath)) {
      if (options.buildIfMissing) {
        buildKnowledgeGraph();
      } else {
        return null;
      }
    }
    return readJsonIfExists(graphPath);
  }

  function graphDegrees(graph) {
    const degrees = new Map();
    (graph.nodes || []).forEach(node => degrees.set(node.id, 0));
    (graph.edges || []).forEach(edge => {
      degrees.set(edge.from, (degrees.get(edge.from) || 0) + 1);
      degrees.set(edge.to, (degrees.get(edge.to) || 0) + 1);
    });
    return degrees;
  }

  function buildGraphReportMarkdown(graph) {
    const degrees = graphDegrees(graph);
    const nodeById = new Map((graph.nodes || []).map(node => [node.id, node]));
    const hotNodes = [...degrees.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, degree]) => ({ node: nodeById.get(id), degree }))
      .filter(item => item.node);
    const ambiguousEdges = (graph.edges || []).filter(edge => edge.basis === 'AMBIGUOUS').slice(0, 10);
    const types = {};
    (graph.nodes || []).forEach(node => {
      types[node.type] = (types[node.type] || 0) + 1;
    });
    const lines = [
      '# Knowledge Graph Report',
      '',
      `Generated: ${graph.generated_at}`,
      '',
      '## Summary',
      '',
      `- Nodes: ${graph.stats.nodes}`,
      `- Edges: ${graph.stats.edges}`,
      `- Ambiguous edges: ${graph.stats.ambiguous_edges}`,
      '',
      '## Node Types',
      '',
      ...Object.keys(types).sort().map(type => `- ${type}: ${types[type]}`),
      '',
      '## Hot Nodes',
      ''
    ];
    if (hotNodes.length === 0) {
      lines.push('- No connected nodes yet.');
    } else {
      hotNodes.forEach(item => {
        lines.push(`- ${item.node.id} (${item.degree}) - ${item.node.summary || item.node.label || ''}`);
      });
    }
    lines.push('', '## Ambiguous Edges', '');
    if (ambiguousEdges.length === 0) {
      lines.push('- No ambiguous edges recorded.');
    } else {
      ambiguousEdges.forEach(edge => {
        lines.push(`- ${edge.from} --${edge.type}--> ${edge.to}: ${edge.summary || 'review needed'}`);
      });
    }
    lines.push('', '## Suggested Queries', '');
    ['chip', 'risk', 'task', 'timer', 'pin'].forEach(term => {
      lines.push(`- knowledge graph query ${term}`);
    });
    lines.push('', '## Suggested Explanations', '');
    if (hotNodes.length === 0) {
      lines.push('- No graph nodes are connected enough to explain yet.');
    } else {
      hotNodes.slice(0, 5).forEach(item => {
        lines.push(`- knowledge graph explain ${item.node.id}`);
      });
    }
    lines.push('');
    return `${lines.join('\n').trim()}\n`;
  }

  function readKnowledgeGraphReport() {
    const graph = loadKnowledgeGraph({ buildIfMissing: false });
    const reportPath = getGraphPath('GRAPH_REPORT.md');
    if (!graph || !fs.existsSync(reportPath)) {
      return {
        initialized: false,
        graph_file: getGraphRelativePath('graph.json'),
        report_file: getGraphRelativePath('GRAPH_REPORT.md'),
        next_steps: ['knowledge graph refresh']
      };
    }
    const freshness = readGraphFreshness(graph);
    return {
      initialized: true,
      graph_file: getGraphRelativePath('graph.json'),
      report_file: getGraphRelativePath('GRAPH_REPORT.md'),
      manifest_file: freshness.manifest_file,
      stats: graph.stats,
      stale: freshness.stale,
      changed_files: freshness.changed_files,
      added_files: freshness.added_files,
      modified_files: freshness.modified_files,
      removed_files: freshness.removed_files,
      next_steps: freshness.stale ? ['knowledge graph refresh'] : [],
      content: readTextIfExists(reportPath)
    };
  }

  function queryKnowledgeGraph(term) {
    const query = String(term || '').trim().toLowerCase();
    if (!query) {
      throw new Error('Missing graph query text');
    }
    const graph = loadKnowledgeGraph({ buildIfMissing: true });
    const nodes = (graph.nodes || []).filter(node => {
      const haystack = [node.id, node.type, node.label, node.path, node.summary, node.status].join(' ').toLowerCase();
      return haystack.includes(query);
    });
    const matchedNodeIds = new Set(nodes.map(node => node.id));
    const edges = (graph.edges || []).filter(edge => {
      const haystack = [edge.from, edge.to, edge.type, edge.basis, edge.status, edge.summary, edge.source].join(' ').toLowerCase();
      return haystack.includes(query) || matchedNodeIds.has(edge.from) || matchedNodeIds.has(edge.to);
    });
    return {
      query,
      graph_file: getGraphRelativePath('graph.json'),
      nodes: nodes.slice(0, 25),
      edges: edges.slice(0, 50),
      total_matches: {
        nodes: nodes.length,
        edges: edges.length
      }
    };
  }

  function scoreGraphExplainNode(node, query) {
    const normalized = String(query || '').trim().toLowerCase();
    const id = String(node.id || '').toLowerCase();
    const label = String(node.label || '').toLowerCase();
    const pathText = String(node.path || '').toLowerCase();
    const sourceText = (node.sources || []).join(' ').toLowerCase();
    const summary = String(node.summary || '').toLowerCase();
    if (id === normalized || label === normalized || pathText === normalized) return 100;
    if (id.endsWith(`:${normalized}`) || id.endsWith(`-${normalized}`)) return 90;
    if (label.includes(normalized)) return 80;
    if (pathText.includes(normalized) || sourceText.includes(normalized)) return 70;
    if (id.includes(normalized)) return 60;
    if (summary.includes(normalized)) return 40;
    return 0;
  }

  function describeGraphEvidence(edge, direction, otherNode) {
    if (edge.summary) {
      return edge.summary;
    }
    const otherLabel = otherNode ? otherNode.label || otherNode.id || '' : '';
    const relation = String(edge.type || '').replace(/_/g, ' ');
    if (direction === 'inbound') {
      return otherLabel ? `${otherLabel} ${relation} this node.` : `Inbound ${relation} relationship.`;
    }
    return otherLabel ? `This node ${relation} ${otherLabel}.` : `Outbound ${relation} relationship.`;
  }

  function explainKnowledgeGraph(term) {
    const query = String(term || '').trim();
    if (!query) {
      throw new Error('Missing graph explain text');
    }
    const graph = loadKnowledgeGraph({ buildIfMissing: true });
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    const scored = nodes
      .map(node => ({ node, score: scoreGraphExplainNode(node, query) }))
      .filter(item => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.node.type === 'file' && b.node.type !== 'file') return 1;
        if (b.node.type === 'file' && a.node.type !== 'file') return -1;
        return String(a.node.id || '').localeCompare(String(b.node.id || ''));
      });

    if (scored.length === 0) {
      return {
        query,
        found: false,
        graph_file: getGraphRelativePath('graph.json'),
        reason: 'node-not-found',
        candidates: [],
        next_steps: [
          `knowledge graph query ${query}`,
          'knowledge graph report'
        ]
      };
    }

    const matched = scored[0].node;
    const inbound = edges.filter(edge => edge.to === matched.id);
    const outbound = edges.filter(edge => edge.from === matched.id);
    const relatedNodeIds = runtime.unique([
      ...inbound.map(edge => edge.from),
      ...outbound.map(edge => edge.to)
    ]);
    const relatedNodes = relatedNodeIds
      .map(id => nodeById.get(id))
      .filter(Boolean)
      .map(node => ({
        id: node.id,
        type: node.type,
        label: node.label || '',
        path: node.path || '',
        summary: node.summary || ''
      }))
      .slice(0, 25);
    const evidence = [
      ...inbound.map(edge => {
        const otherNode = nodeById.get(edge.from);
        return {
          direction: 'inbound',
          from: edge.from,
          to: edge.to,
          relation: edge.type,
          source: edge.source || '',
          basis: edge.basis || '',
          status: edge.status || '',
          confidence: typeof edge.confidence === 'number' ? edge.confidence : null,
          why: describeGraphEvidence(edge, 'inbound', otherNode)
        };
      }),
      ...outbound.map(edge => {
        const otherNode = nodeById.get(edge.to);
        return {
          direction: 'outbound',
          from: edge.from,
          to: edge.to,
          relation: edge.type,
          source: edge.source || '',
          basis: edge.basis || '',
          status: edge.status || '',
          confidence: typeof edge.confidence === 'number' ? edge.confidence : null,
          why: describeGraphEvidence(edge, 'outbound', otherNode)
        };
      })
    ].slice(0, 50);
    const sources = runtime.unique([
      ...(matched.sources || []),
      matched.path || '',
      ...evidence.map(item => item.source),
      ...relatedNodes.flatMap(node => [node.path, ...(node.sources || [])])
    ].filter(Boolean));
    const nextSteps = runtime.unique([
      `knowledge graph query ${matched.label || query}`,
      relatedNodes.length > 0 ? `knowledge graph path ${matched.id} ${relatedNodes[0].id}` : '',
      'knowledge graph lint'
    ].filter(Boolean));

    return {
      query,
      found: true,
      graph_file: getGraphRelativePath('graph.json'),
      matched: {
        id: matched.id,
        type: matched.type,
        label: matched.label || '',
        path: matched.path || '',
        summary: matched.summary || '',
        status: matched.status || '',
        sources: matched.sources || []
      },
      summary: {
        inbound_edges: inbound.length,
        outbound_edges: outbound.length,
        related_nodes: relatedNodeIds.length,
        sources
      },
      evidence,
      related_nodes: relatedNodes,
      candidates: scored.slice(1, 6).map(item => ({
        id: item.node.id,
        type: item.node.type,
        label: item.node.label || '',
        path: item.node.path || '',
        score: item.score
      })),
      next_steps: nextSteps
    };
  }

  function shortestGraphPath(from, to) {
    const source = String(from || '').trim();
    const target = String(to || '').trim();
    if (!source || !target) {
      throw new Error('Missing graph path endpoints');
    }
    const graph = loadKnowledgeGraph({ buildIfMissing: true });
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    const resolveIds = value => nodes
      .filter(node => node.id === value || node.id.includes(value) || String(node.label || '').toLowerCase().includes(value.toLowerCase()))
      .map(node => node.id);
    const starts = resolveIds(source);
    const targets = new Set(resolveIds(target));
    if (starts.length === 0 || targets.size === 0) {
      return {
        found: false,
        from: source,
        to: target,
        reason: starts.length === 0 ? 'from-not-found' : 'to-not-found',
        path: []
      };
    }
    const adjacency = new Map();
    edges.forEach(edge => {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
      adjacency.get(edge.from).push({ next: edge.to, edge });
      adjacency.get(edge.to).push({ next: edge.from, edge });
    });
    const queue = starts.map(id => ({ id, path: [id], via: [] }));
    const seen = new Set(starts);
    while (queue.length > 0) {
      const current = queue.shift();
      if (targets.has(current.id)) {
        return {
          found: true,
          from: source,
          to: target,
          path: current.path,
          edges: current.via
        };
      }
      (adjacency.get(current.id) || []).forEach(item => {
        if (seen.has(item.next)) return;
        seen.add(item.next);
        queue.push({
          id: item.next,
          path: [...current.path, item.next],
          via: [...current.via, item.edge]
        });
      });
    }
    return {
      found: false,
      from: source,
      to: target,
      reason: 'no-path',
      path: []
    };
  }

  function lintKnowledgeGraph() {
    const graph = loadKnowledgeGraph({ buildIfMissing: false });
    if (!graph) {
      return {
        status: 'missing',
        issues: [
          {
            severity: 'warn',
            code: 'graph-missing',
            summary: 'Knowledge graph has not been built.',
            recommendation: 'Run knowledge graph refresh.'
          }
        ],
        next_steps: ['knowledge graph refresh']
      };
    }
    const issues = [];
    const freshness = readGraphFreshness(graph);
    if (freshness.stale) {
      issues.push({
        severity: 'warn',
        code: 'graph-stale',
        summary: 'Knowledge graph tracked files changed after the last build.',
        changed_files: freshness.changed_files.slice(0, 25),
        recommendation: 'Run knowledge graph refresh.'
      });
    }
    const degrees = graphDegrees(graph);
    (graph.nodes || [])
      .filter(node => node.type === 'wiki_page' && (degrees.get(node.id) || 0) === 0)
      .forEach(node => {
        issues.push({
          severity: 'info',
          code: 'graph-orphan-wiki-page',
          node: node.id,
          path: node.path || '',
          summary: 'Wiki page has no graph edges.',
          recommendation: 'Add wiki links or rebuild after related truth/tasks exist.'
        });
      });
    (graph.edges || [])
      .filter(edge => edge.basis === 'AMBIGUOUS')
      .forEach(edge => {
        issues.push({
          severity: 'warn',
          code: 'ambiguous-edge',
          edge: `${edge.from} ${edge.type} ${edge.to}`,
          summary: edge.summary || 'Ambiguous graph relationship requires review.',
          recommendation: 'Review the linked wiki page or source artifact.'
        });
      });
    const hasChip = (graph.nodes || []).some(node => node.type === 'chip');
    const hasChipWiki = (graph.nodes || []).some(node => node.type === 'wiki_page' && String(node.path || '').includes('/chips/'));
    if (hasChip && !hasChipWiki) {
      issues.push({
        severity: 'info',
        code: 'chip-without-wiki-page',
        summary: 'Graph has a chip node but no chip wiki page.',
        recommendation: 'Run knowledge save-query --kind chip <chip> --confirm after reviewing evidence.'
      });
    }
    return {
      status: issues.some(item => item.severity === 'warn') ? 'warn' : 'ok',
      graph_file: getGraphRelativePath('graph.json'),
      report_file: getGraphRelativePath('GRAPH_REPORT.md'),
      manifest_file: freshness.manifest_file,
      stats: graph.stats,
      stale: freshness.stale,
      changed_files: freshness.changed_files,
      issues,
      next_steps: issues.length > 0
        ? runtime.unique(issues.map(item => item.recommendation).filter(Boolean)).slice(0, 5)
        : []
    };
  }

  function handleKnowledgeGraphCommands(action, rest) {
    const args = Array.isArray(rest) ? rest : [];
    if (!action || action === 'build' || action === 'update') {
      return buildKnowledgeGraph();
    }
    if (action === 'refresh') {
      const graph = loadKnowledgeGraph({ buildIfMissing: false });
      const reportPath = getGraphPath('GRAPH_REPORT.md');
      if (!graph || !fs.existsSync(reportPath)) {
        const built = buildKnowledgeGraph();
        return {
          ...built,
          status: 'built',
          refreshed: true,
          reason: graph ? 'report-missing' : 'graph-missing'
        };
      }
      const freshness = readGraphFreshness(graph);
      if (freshness.stale) {
        const built = buildKnowledgeGraph();
        return {
          ...built,
          status: 'built',
          refreshed: true,
          reason: 'stale',
          changed_files: freshness.changed_files,
          added_files: freshness.added_files,
          modified_files: freshness.modified_files,
          removed_files: freshness.removed_files
        };
      }
      updateSession(current => {
        current.last_command = 'knowledge graph refresh';
        current.last_files = runtime.unique([
          getGraphRelativePath('GRAPH_REPORT.md'),
          getGraphRelativePath('graph.json'),
          ...(current.last_files || [])
        ]).slice(0, 8);
      });
      return {
        status: 'fresh',
        skipped: true,
        graph_file: getGraphRelativePath('graph.json'),
        report_file: getGraphRelativePath('GRAPH_REPORT.md'),
        manifest_file: freshness.manifest_file,
        stats: graph.stats,
        stale: false,
        changed_files: [],
        next_steps: []
      };
    }
    if (action === 'report') {
      return readKnowledgeGraphReport();
    }
    if (action === 'query') {
      return queryKnowledgeGraph(args.join(' '));
    }
    if (action === 'explain') {
      return explainKnowledgeGraph(args.join(' '));
    }
    if (action === 'path') {
      return shortestGraphPath(args[0], args[1]);
    }
    if (action === 'lint') {
      return lintKnowledgeGraph();
    }
    throw new Error(`Unknown knowledge graph command: ${action}`);
  }

  function handleKnowledgeCommands(cmd, subcmd, rest) {
    if (cmd !== 'knowledge') {
      return undefined;
    }
    if (!subcmd || subcmd === 'init') {
      return initKnowledgeWiki();
    }
    if (subcmd === 'index') {
      return readKnowledgeIndex({ rebuild: (rest || []).includes('--rebuild') });
    }
    if (subcmd === 'log') {
      return readKnowledgeLog(rest || []);
    }
    if (subcmd === 'lint') {
      return lintKnowledgeWiki();
    }
    if (subcmd === 'show') {
      return showKnowledgePage(rest[0]);
    }
    if (subcmd === 'graph') {
      return handleKnowledgeGraphCommands(rest[0], rest.slice(1));
    }
    if (subcmd === 'formula') {
      return draftFormulaRegistryFromToolOutput(rest[0], rest.slice(1));
    }
    if (subcmd === 'save-query') {
      return saveKnowledgePage(
        parseKnowledgeWriteArgs(rest, { kind: 'query' }),
        'knowledge-save-query',
        'query'
      );
    }
    if (subcmd === 'ingest') {
      return saveKnowledgePage(
        parseKnowledgeWriteArgs(rest, { kind: 'source' }),
        'knowledge-ingest',
        'ingest'
      );
    }
    throw new Error(`Unknown knowledge command: ${subcmd}`);
  }

  return {
    handleKnowledgeCommands,
    initKnowledgeWiki,
    lintKnowledgeWiki,
    readKnowledgeIndex,
    readKnowledgeLog,
    buildKnowledgeGraph,
    lintKnowledgeGraph,
    explainKnowledgeGraph,
    queryKnowledgeGraph,
    saveKnowledgePage
  };
}

module.exports = {
  createKnowledgeRuntimeHelpers
};
