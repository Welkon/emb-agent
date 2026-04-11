'use strict';

function createSkillRuntimeHelpers(deps) {
  const {
    childProcess,
    fs,
    path,
    process,
    runtime,
    runtimeHost,
    resolveProjectRoot,
    getProjectExtDir,
    builtInSkillsDir,
    builtInDisplayRoot
  } = deps;

  const DISCOVERY_ITEM_LIMIT = 250;
  const DISCOVERY_TOTAL_LIMIT = 2400;
  const FALLBACK_ALLOWED_TOOLS = [];

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function parseScalar(raw) {
    const value = String(raw || '').trim();
    if (!value) {
      return '';
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    if (/^-?\d+$/u.test(value)) {
      return Number(value);
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('\'') && value.endsWith('\''))
    ) {
      return value.slice(1, -1);
    }
    return value;
  }

  function parseFrontmatter(content) {
    const source = String(content || '');
    if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
      return {
        metadata: {},
        body: source
      };
    }

    const endMarker = source.indexOf('\n---', 4);
    if (endMarker === -1) {
      return {
        metadata: {},
        body: source
      };
    }

    const rawHead = source.slice(4, endMarker).replace(/\r/g, '');
    const body = source.slice(endMarker + 4).replace(/^\r?\n/, '');
    const metadata = {};
    let currentListKey = '';

    for (const line of rawHead.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      if (line.startsWith('  - ')) {
        if (!currentListKey) {
          continue;
        }
        metadata[currentListKey].push(parseScalar(line.slice(4)));
        continue;
      }

      const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/u);
      if (!match) {
        currentListKey = '';
        continue;
      }

      const key = match[1];
      const rawValue = match[2] || '';
      if (!rawValue) {
        metadata[key] = [];
        currentListKey = key;
        continue;
      }

      metadata[key] = parseScalar(rawValue);
      currentListKey = '';
    }

    return {
      metadata,
      body
    };
  }

  function toStringArray(value) {
    return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
  }

  function truncateText(value, limit) {
    const text = String(value || '').trim();
    if (!text || text.length <= limit) {
      return text;
    }
    return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
  }

  function normalizeSkillName(value, fallback) {
    const text = String(value || fallback || '').trim();
    if (!text) {
      throw new Error('Skill name is required');
    }
    return text;
  }

  function normalizeExecutionMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'isolated' || normalized === 'fork') {
      return 'isolated';
    }
    return 'inline';
  }

  function slugify(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'skill';
  }

  function walkMarkdownFiles(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return [];
    }

    const files = [];
    const queue = [dirPath];

    while (queue.length > 0) {
      const current = queue.shift();
      for (const name of fs.readdirSync(current)) {
        const filePath = path.join(current, name);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          queue.push(filePath);
          continue;
        }
        if (name.endsWith('.md')) {
          files.push(filePath);
        }
      }
    }

    return files.sort();
  }

  function getDisplayPath(filePath, sourceRoot) {
    const root = sourceRoot || builtInDisplayRoot || builtInSkillsDir;
    return path.relative(root, filePath).replace(/\\/g, '/');
  }

  function getRuntimeHost() {
    return typeof runtimeHost === 'function' ? runtimeHost() : runtimeHost;
  }

  function buildSkillSourceRoots() {
    const host = getRuntimeHost();
    return [
      {
        source: 'built-in',
        dir: builtInSkillsDir,
        display_root: builtInDisplayRoot || builtInSkillsDir
      },
      {
        source: 'user',
        dir: host && host.runtimeHome ? path.join(host.runtimeHome, 'skills') : '',
        display_root: host && host.runtimeHome ? host.runtimeHome : builtInDisplayRoot || builtInSkillsDir
      },
      {
        source: 'project',
        dir: path.join(getProjectExtDir(), 'skills'),
        display_root: resolveProjectRoot()
      },
      {
        source: 'local',
        dir: path.join(getProjectExtDir(), 'skills-local'),
        display_root: resolveProjectRoot()
      }
    ];
  }

  function buildSkillMetadata(filePath, sourceRoot) {
    const raw = runtime.readText(filePath);
    const parsed = parseFrontmatter(raw);
    const metadata = parsed.metadata || {};
    const skillName = normalizeSkillName(metadata.name, path.basename(filePath, '.md'));
    const description = String(metadata.description || '').trim();
    const whenToUse = String(metadata.when_to_use || '').trim();
    const allowedTools = toStringArray(metadata.allowed_tools || metadata['allowed-tools'] || FALLBACK_ALLOWED_TOOLS);
    const hooks = toStringArray(metadata.hooks || []);
    const executionMode = normalizeExecutionMode(metadata.execution_mode || metadata.execution || '');
    const source = sourceRoot && sourceRoot.source ? sourceRoot.source : 'project';

    return {
      name: skillName,
      description,
      when_to_use: whenToUse,
      discovery_text: truncateText(
        [description, whenToUse].filter(Boolean).join(' | ') || skillName,
        DISCOVERY_ITEM_LIMIT
      ),
      allowed_tools: allowedTools,
      hooks,
      execution_mode: executionMode,
      source,
      file_path: filePath,
      display_path: getDisplayPath(filePath, sourceRoot ? sourceRoot.display_root : builtInDisplayRoot),
      content: parsed.body,
      raw_content: raw
    };
  }

  function listSkillEntries() {
    const seenPaths = new Set();
    const byName = new Map();

    buildSkillSourceRoots().forEach(sourceRoot => {
      walkMarkdownFiles(sourceRoot.dir).forEach(filePath => {
        let realPath = filePath;
        try {
          realPath = fs.realpathSync(filePath);
        } catch {
          realPath = filePath;
        }
        if (seenPaths.has(realPath)) {
          return;
        }
        seenPaths.add(realPath);

        const entry = buildSkillMetadata(filePath, sourceRoot);
        if (!byName.has(entry.name)) {
          byName.set(entry.name, entry);
        }
      });
    });

    return Array.from(byName.values()).sort((left, right) => {
      const sourceWeight = value => {
        if (value === 'built-in') return 1;
        if (value === 'user') return 2;
        if (value === 'project') return 3;
        return 4;
      };
      return sourceWeight(left.source) - sourceWeight(right.source) || left.name.localeCompare(right.name);
    });
  }

  function degradeDiscovery(entries) {
    let used = 0;
    return entries.map(entry => {
      const next = { ...entry };
      const sourcePriority = entry.source === 'built-in' ? 'privileged' : 'external';
      const full = truncateText([entry.description, entry.when_to_use].filter(Boolean).join(' | ') || entry.name, DISCOVERY_ITEM_LIMIT);
      const nameOnly = entry.name;
      let discoveryText = full;

      if (sourcePriority === 'external' && used + discoveryText.length > DISCOVERY_TOTAL_LIMIT) {
        discoveryText = truncateText(entry.description || entry.when_to_use || entry.name, DISCOVERY_ITEM_LIMIT);
      }
      if (sourcePriority === 'external' && used + discoveryText.length > DISCOVERY_TOTAL_LIMIT) {
        discoveryText = nameOnly;
      }

      used += discoveryText.length;
      next.discovery_text = discoveryText;
      return next;
    });
  }

  function listSkills() {
    return degradeDiscovery(listSkillEntries()).map(entry => ({
      name: entry.name,
      description: entry.description,
      when_to_use: entry.when_to_use,
      discovery_text: entry.discovery_text,
      execution_mode: entry.execution_mode,
      source: entry.source,
      path: entry.display_path,
      allowed_tools: entry.allowed_tools,
      hooks: entry.hooks
    }));
  }

  function loadSkill(name) {
    const normalized = String(name || '').trim();
    if (!normalized) {
      throw new Error('Missing skill name');
    }

    const matched = listSkillEntries().find(entry => entry.name === normalized);
    if (!matched) {
      throw new Error(`Skill not found: ${name}`);
    }

    return {
      name: matched.name,
      description: matched.description,
      when_to_use: matched.when_to_use,
      execution_mode: matched.execution_mode,
      source: matched.source,
      path: matched.display_path,
      allowed_tools: matched.allowed_tools,
      hooks: matched.hooks,
      content: matched.content,
      discovery_text: matched.discovery_text
    };
  }

  function parseSkillRunArgs(tokens) {
    const argv = Array.isArray(tokens) ? tokens : [];
    const options = {
      name: '',
      isolated: false,
      user_input: ''
    };

    let index = 0;
    options.name = argv[index] || '';
    index += 1;

    const inputParts = [];
    for (; index < argv.length; index += 1) {
      const token = argv[index];
      if (token === '--isolated') {
        options.isolated = true;
        continue;
      }
      inputParts.push(token);
    }

    options.user_input = inputParts.join(' ').trim();
    if (!options.name) {
      throw new Error('Missing skill name');
    }

    return options;
  }

  function normalizeBridgeWorkerResult(skill, payload, bridgeResponse, bridgeError) {
    const response = isObject(bridgeResponse) ? bridgeResponse : {};
    const worker = isObject(response.worker_result) ? response.worker_result : {};
    const status = bridgeError ? 'bridge-error' : (worker.status || response.status || 'ok');
    return {
      agent: worker.agent || `emb-skill-${slugify(skill.name)}`,
      phase: worker.phase || 'skill',
      status,
      summary: worker.summary || response.summary || bridgeError || '',
      output_kind: worker.output_kind || 'skill',
      fresh_context: true,
      updated_at: worker.updated_at || new Date().toISOString(),
      skill: skill.name,
      prompt_preview: truncateText(payload.launch.prompt, 280)
    };
  }

  function invokeIsolatedSkill(skill, userInput) {
    const host = getRuntimeHost();
    const bridge = host && host.subagentBridge ? host.subagentBridge : { available: false };
    const worker = {
      agent: `emb-skill-${slugify(skill.name)}`,
      role: 'skill',
      phase: 'skill',
      blocking: true,
      context_mode: 'fresh-self-contained',
      fresh_context_required: true,
      purpose: `Execute isolated skill ${skill.name}`,
      ownership: 'Complete only the requested isolated skill execution and return a compact result',
      expected_output: [
        'Return the distilled skill result for the main thread',
        'Keep conclusions explicit and scoped to the provided skill'
      ],
      tool_scope: {
        role_profile: 'skill',
        allows_write: false,
        allows_delegate: false,
        allows_background_work: false,
        preferred_tools: skill.allowed_tools || [],
        disallowed_tools: ['spawn', 'orchestration-state-write']
      }
    };
    const payload = {
      version: '1.0',
      host: {
        name: host ? host.name : '',
        label: host ? host.label : '',
        subagent_bridge: bridge
      },
      session: {
        project_root: resolveProjectRoot(),
        focus: '',
        project_profile: ''
      },
      orchestration: {
        source: 'skills',
        requested_action: `skills run ${skill.name}`,
        resolved_action: `skill:${skill.name}`,
        entered_via: 'skills run',
        execution_kind: 'skill-isolated',
        workflow: {
          strategy: 'skill-isolated'
        },
        dispatch_contract: {
          delegation_pattern: 'fork',
          pattern_constraints: {
            allowed_patterns: ['fork'],
            disallowed_patterns: ['coordinator', 'swarm'],
            max_depth: 1,
            workers_may_delegate: false
          }
        }
      },
      launch: {
        worker,
        instructions: {
          name: skill.name,
          path: skill.path,
          content: skill.content
        },
        prompt: [
          `# emb skill: ${skill.name}`,
          '',
          skill.content || '',
          '',
          '## User Input',
          userInput || '(none)',
          '',
          '## Output Contract',
          'Return compact JSON with status, summary, output_kind, findings, and recommended_next_step.'
        ].join('\n')
      }
    };

    if (!bridge.available || !bridge.command || !Array.isArray(bridge.command_argv) || bridge.command_argv.length === 0) {
      if (bridge.available && bridge.mode === 'mock') {
        return {
          status: 'ok',
          bridge: {
            available: true,
            invoked: true,
            source: bridge.source || 'env',
            command: bridge.command,
            status: 'ok'
          },
          worker_result: normalizeBridgeWorkerResult(skill, payload, {
            status: 'ok',
            worker_result: {
              agent: worker.agent,
              phase: worker.phase,
              status: 'ok',
              summary: `${skill.name} completed isolated execution`,
              output_kind: 'skill',
              fresh_context: true,
              updated_at: new Date().toISOString()
            }
          })
        };
      }

      return {
        status: 'blocked-no-host-bridge',
        bridge: {
          available: Boolean(bridge.available),
          invoked: false,
          source: bridge.source || 'none',
          command: bridge.command || '',
          status: 'bridge-unavailable'
        },
        worker_result: normalizeBridgeWorkerResult(skill, payload, {
          status: 'blocked',
          summary: 'Host sub-agent bridge is not configured for isolated skills'
        })
      };
    }

    const result = childProcess.spawnSync(bridge.command_argv[0], bridge.command_argv.slice(1), {
      cwd: resolveProjectRoot(),
      input: JSON.stringify(payload, null, 2),
      encoding: 'utf8',
      timeout: bridge.timeout_ms || 15000,
      env: {
        ...process.env,
        EMB_AGENT_WORKER_AGENT: worker.agent,
        EMB_AGENT_WORKER_PHASE: worker.phase
      }
    });

    if (result.error) {
      return {
        status: 'bridge-error',
        bridge: {
          available: true,
          invoked: true,
          source: bridge.source || 'env',
          command: bridge.command,
          status: 'bridge-error',
          error: result.error.message
        },
        worker_result: normalizeBridgeWorkerResult(skill, payload, null, result.error.message)
      };
    }

    let parsed = {};
    try {
      parsed = result.stdout ? JSON.parse(String(result.stdout)) : {};
    } catch {
      parsed = {
        status: result.status === 0 ? 'ok' : 'failed',
        summary: String(result.stdout || '').trim().slice(0, 400)
      };
    }

    return {
      status: result.status === 0 ? 'ok' : 'failed',
      bridge: {
        available: true,
        invoked: true,
        source: bridge.source || 'env',
        command: bridge.command,
        status: result.status === 0 ? 'ok' : 'failed',
        exit_code: result.status,
        stderr: String(result.stderr || '').trim()
      },
      worker_result: normalizeBridgeWorkerResult(skill, payload, parsed)
    };
  }

  function runSkill(tokens) {
    const options = parseSkillRunArgs(tokens);
    const skill = loadSkill(options.name);
    const mode = options.isolated ? 'isolated' : skill.execution_mode;

    if (mode === 'isolated') {
      const isolated = invokeIsolatedSkill(skill, options.user_input);
      return {
        command: 'skills run',
        skill: {
          name: skill.name,
          source: skill.source,
          path: skill.path,
          execution_mode: skill.execution_mode
        },
        execution: {
          mode: 'isolated',
          user_input: options.user_input
        },
        isolated
      };
    }

    return {
      command: 'skills run',
      skill: {
        name: skill.name,
        source: skill.source,
        path: skill.path,
        execution_mode: skill.execution_mode,
        allowed_tools: skill.allowed_tools,
        hooks: skill.hooks
      },
      execution: {
        mode: 'inline',
        user_input: options.user_input
      },
      prompt: [
        `# emb skill: ${skill.name}`,
        '',
        skill.content || '',
        '',
        '## User Input',
        options.user_input || '(none)'
      ].join('\n')
    };
  }

  return {
    listSkills,
    loadSkill,
    runSkill
  };
}

module.exports = {
  createSkillRuntimeHelpers
};
