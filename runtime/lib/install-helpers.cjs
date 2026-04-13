'use strict';

const commandVisibility = require('./command-visibility.cjs');

function createInstallHelpers(deps) {
  const {
    fs,
    os,
    path,
    process,
    readline,
    promptInstallerChoices,
    installTargets,
    runtimeHost,
    commandsSrc,
    agentsSrc,
    runtimeSrc,
    runtimeHooksSrc,
    packageVersion
  } = deps;

  const MANAGED_MARKER_START = '# EMB-AGENT managed start';
  const MANAGED_MARKER_END = '# EMB-AGENT managed end';
  const AGENT_PREFIX = 'emb-';
  const TEXT_FILE_EXTENSIONS = new Set(['.cjs', '.js', '.json', '.md', '.txt', '.tpl', '.yaml', '.yml']);
  const DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS =
    Number(runtimeHost && runtimeHost.DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS) || 15000;
  const SANDBOX_BY_AGENT = {
    'emb-fw-doer': 'workspace-write',
    'emb-bug-hunter': 'workspace-write',
    'emb-hw-scout': 'read-only',
    'emb-sys-reviewer': 'read-only',
    'emb-release-checker': 'read-only'
  };

  function usage() {
    process.stdout.write(
      [
        'emb-agent usage:',
        '  emb-agent --global',
        '  emb-agent --local',
        '  emb-agent --claude --local',
        '  emb-agent --codex --local',
        '  emb-agent --runtime claude --local',
        '  emb-agent --runtime codex --local',
        '  emb-agent --global --developer <name>',
        '  emb-agent --global --config-dir <path>',
        '  emb-agent --local --uninstall',
        '  emb-agent                  Launch interactive installer',
        '  emb-agent --help',
        '',
        'Options:',
        '  --claude                Install for Claude Code explicitly',
        '  --codex                 Install for Codex explicitly (default)',
        '  --runtime <name>        Select runtime target (codex, claude; others reserved)',
        '  --developer <name>      Required developer name to seed new projects',
        '  --global                Install to runtime config home',
        '  --local                 Install to current project runtime dir (recommended for Codex)',
        '  --config-dir <path>     Override target runtime directory',
        '  --subagent-bridge-cmd <command>',
        '                          Configure host sub-agent bridge command',
        '  --subagent-bridge-timeout-ms <ms>',
        '                          Set host sub-agent bridge timeout in milliseconds',
        '  --default-adapter-source-location <url>',
        '                          Persist the default git adapter source location for bootstrap/health',
        '  --default-adapter-source-branch <name>',
        '                          Optional default branch for the adapter source',
        '  --default-adapter-source-subdir <path>',
        '                          Optional subdirectory under the adapter source repository',
        '  --uninstall             Remove emb-agent managed files from the target',
        '  --force                 Overwrite existing emb-agent runtime',
        '  --help                  Show this help'
      ].join('\n') + '\n'
    );
  }

  function getSupportedInstallTargets() {
    return installTargets
      .listInstallTargets()
      .filter(target => target.supported)
      .sort((left, right) => {
        const leftOrder = Number(left.order) || 999;
        const rightOrder = Number(right.order) || 999;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return left.label.localeCompare(right.label);
      });
  }

  function parsePositiveInteger(rawValue, flagName) {
    const input = String(rawValue || '').trim();
    if (!input) {
      throw new Error(`Missing value after ${flagName}`);
    }

    const parsed = Number.parseInt(input, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${flagName} expects a positive integer`);
    }

    return parsed;
  }

  function getDefaultInstallLocation(runtimeName) {
    const runtime = String(runtimeName || '').trim().toLowerCase();
    return runtime === 'claude' || runtime === 'codex' ? 'local' : 'global';
  }

  function parseArgs(argv) {
    const result = {
      global: false,
      local: false,
      runtime: '',
      developer: '',
      configDir: '',
      subagentBridgeCmd: '',
      subagentBridgeTimeoutMs: DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS,
      defaultAdapterSourceLocation: '',
      defaultAdapterSourceBranch: '',
      defaultAdapterSourceSubdir: '',
      uninstall: false,
      force: false,
      help: false
    };

    function setRuntime(name) {
      if (result.runtime && result.runtime !== name) {
        throw new Error(`Use one runtime target, received both ${result.runtime} and ${name}`);
      }
      result.runtime = name;
    }

    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];

      if (token === '--help' || token === '-h') {
        result.help = true;
        continue;
      }
      if (token === '--global' || token === '-g') {
        result.global = true;
        continue;
      }
      if (token === '--local' || token === '-l') {
        result.local = true;
        continue;
      }
      if (token === '--claude') {
        setRuntime('claude');
        continue;
      }
      if (token === '--codex') {
        setRuntime('codex');
        continue;
      }
      if (token === '--runtime') {
        const runtime = (argv[index + 1] || '').trim().toLowerCase();
        if (!runtime) {
          throw new Error('Missing runtime name after --runtime');
        }
        setRuntime(runtime);
        index += 1;
        continue;
      }
      if (token === '--developer') {
        result.developer = (argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--uninstall' || token === '-u') {
        result.uninstall = true;
        continue;
      }
      if (token === '--force') {
        result.force = true;
        continue;
      }
      if (token === '--config-dir') {
        result.configDir = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--subagent-bridge-cmd') {
        result.subagentBridgeCmd = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--subagent-bridge-timeout-ms') {
        result.subagentBridgeTimeoutMs = parsePositiveInteger(argv[index + 1], '--subagent-bridge-timeout-ms');
        index += 1;
        continue;
      }
      if (token === '--default-adapter-source-location') {
        result.defaultAdapterSourceLocation = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--default-adapter-source-branch') {
        result.defaultAdapterSourceBranch = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--default-adapter-source-subdir') {
        result.defaultAdapterSourceSubdir = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      throw new Error(`Unknown argument: ${token}`);
    }

    if (argv.includes('--config-dir') && !result.configDir) {
      throw new Error('Missing path after --config-dir');
    }
    if (argv.includes('--developer') && !result.developer) {
      throw new Error('Missing name after --developer');
    }
    if (argv.includes('--subagent-bridge-cmd') && !result.subagentBridgeCmd) {
      throw new Error('Missing command after --subagent-bridge-cmd');
    }
    if (argv.includes('--subagent-bridge-timeout-ms') && !result.subagentBridgeCmd) {
      throw new Error('--subagent-bridge-timeout-ms requires --subagent-bridge-cmd');
    }
    if (argv.includes('--default-adapter-source-location') && !result.defaultAdapterSourceLocation) {
      throw new Error('Missing value after --default-adapter-source-location');
    }
    if (argv.includes('--default-adapter-source-branch') && !result.defaultAdapterSourceBranch) {
      throw new Error('Missing value after --default-adapter-source-branch');
    }
    if (argv.includes('--default-adapter-source-subdir') && !result.defaultAdapterSourceSubdir) {
      throw new Error('Missing value after --default-adapter-source-subdir');
    }
    if (result.global && result.local) {
      throw new Error('Use either --global or --local, not both');
    }
    if (!result.runtime) {
      result.runtime = 'codex';
    }
    if (!result.global && !result.local) {
      const defaultLocation = getDefaultInstallLocation(result.runtime);
      result.global = defaultLocation !== 'local';
      result.local = defaultLocation === 'local';
    }
    if (!result.uninstall && !result.help && !result.developer) {
      throw new Error('Developer name is required during install. Pass --developer <name>.');
    }

    return result;
  }

  function isInteractiveInstall(argv) {
    return !Array.isArray(argv) || argv.length === 0;
  }

  function buildInteractiveRuntimePrompt(targets) {
    const lines = ['emb-agent installer', '', 'Which runtime would you like to install for?', ''];

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const globalDir = path.join(os.homedir(), ...(target.defaultGlobalDirParts || [target.localDirName]));
      lines.push(`  ${index + 1}) ${target.label} (${globalDir.replace(os.homedir(), '~')})`);
    }

    return `${lines.join('\n')}\n\nChoice [1]: `;
  }

  function buildInteractiveLocationPrompt(target) {
    const globalDir = path.join(os.homedir(), ...(target.defaultGlobalDirParts || [target.localDirName]));
    const defaultLocation = getDefaultInstallLocation(target && target.name);
    const defaultChoice = defaultLocation === 'local' ? '2' : '1';
    return [
      '',
      'Where would you like to install?',
      '',
      `  1) Global (${globalDir.replace(os.homedir(), '~')})`,
      `  2) Local  (./${target.localDirName})`,
      '',
      `Choice [${defaultChoice}]: `
    ].join('\n');
  }

  function buildInteractiveDeveloperPrompt() {
    return [
      '',
      'Enter the developer name to seed new projects.',
      'This value is required and will be reused by init.',
      '',
      'Developer name: '
    ].join('\n');
  }

  function promptLine(question) {
    if (!readline) {
      throw new Error('Interactive install requires readline support');
    }

    return new Promise(resolve => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      let answered = false;
      rl.on('close', () => {
        if (!answered) {
          resolve('');
        }
      });

      rl.question(question, answer => {
        answered = true;
        rl.close();
        resolve(String(answer || '').trim());
      });
    });
  }

  async function promptInteractiveInstallArgs() {
    const targets = getSupportedInstallTargets();
    if (targets.length === 0) {
      throw new Error('No supported runtime targets are available for installation');
    }

    if (!process.stdin || !process.stdin.isTTY) {
      throw new Error('Non-interactive install requires --developer <name>.');
    }

    if (typeof promptInstallerChoices === 'function') {
      const prompted = await promptInstallerChoices(targets);
      const runtime = String(prompted && prompted.runtime ? prompted.runtime : targets[0].name).trim().toLowerCase();
      const location = String(
        prompted && prompted.location ? prompted.location : getDefaultInstallLocation(runtime)
      ).trim().toLowerCase();
      const developer = String(prompted && prompted.developer ? prompted.developer : '').trim();
      const subagentBridgeCmd = String(prompted && prompted.subagentBridgeCmd ? prompted.subagentBridgeCmd : '').trim();
      const subagentBridgeTimeoutProvided =
        prompted && prompted.subagentBridgeTimeoutMs !== undefined && prompted.subagentBridgeTimeoutMs !== null;
      if (!developer) {
        throw new Error('Interactive install requires developer name.');
      }
      if (!subagentBridgeCmd && subagentBridgeTimeoutProvided) {
        throw new Error('Interactive sub-agent bridge timeout requires a bridge command.');
      }

      return {
        global: location !== 'local',
        local: location === 'local',
        runtime,
        developer,
        configDir: '',
        subagentBridgeCmd,
        subagentBridgeTimeoutMs:
          subagentBridgeTimeoutProvided
            ? parsePositiveInteger(prompted.subagentBridgeTimeoutMs, 'subagentBridgeTimeoutMs')
            : DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS,
        uninstall: false,
        force: false,
        help: false
      };
    }

    const runtimeAnswer = await promptLine(buildInteractiveRuntimePrompt(targets));
    let selectedIndex = Number.parseInt(runtimeAnswer || '1', 10);
    if (!Number.isFinite(selectedIndex) || selectedIndex < 1 || selectedIndex > targets.length) {
      selectedIndex = 1;
    }
    const target = targets[selectedIndex - 1];

    const defaultLocation = getDefaultInstallLocation(target.name);
    const locationAnswer = await promptLine(buildInteractiveLocationPrompt(target));
    const resolvedLocationAnswer = String(locationAnswer || (defaultLocation === 'local' ? '2' : '1')).trim();
    const isLocal = resolvedLocationAnswer === '2';
    const developer = await promptLine(buildInteractiveDeveloperPrompt());
    if (!developer) {
      throw new Error('Developer name is required during install.');
    }

    return {
      global: !isLocal,
      local: isLocal,
      runtime: target.name,
      developer,
      configDir: '',
      subagentBridgeCmd: '',
      subagentBridgeTimeoutMs: DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS,
      uninstall: false,
      force: false,
      help: false
    };
  }

  async function resolveArgs(argv) {
    if (isInteractiveInstall(argv)) {
      return promptInteractiveInstallArgs();
    }

    return parseArgs(argv);
  }

  function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  function copyDir(sourceDir, targetDir) {
    ensureDir(targetDir);
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        copyDir(sourcePath, targetPath);
      } else {
        try {
          fs.copyFileSync(sourcePath, targetPath);
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            continue;
          }
          throw error;
        }
      }
    }
  }

  function shouldProcessTextFile(filePath) {
    return TEXT_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  }

  function copyFileWithReplacement(sourcePath, targetPath, installRoot, target) {
    if (!shouldProcessTextFile(sourcePath)) {
      fs.copyFileSync(sourcePath, targetPath);
      return;
    }

    const raw = fs.readFileSync(sourcePath, 'utf8');
    fs.writeFileSync(targetPath, replaceInstallPaths(raw, installRoot, target));
  }

  function copyDirWithReplacement(sourceDir, targetDir, installRoot, target) {
    ensureDir(targetDir);
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        copyDirWithReplacement(sourcePath, targetPath, installRoot, target);
      } else {
        copyFileWithReplacement(sourcePath, targetPath, installRoot, target);
      }
    }
  }

  function removeDirIfExists(dirPath) {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }

  function getRuntimeTarget(args) {
    const target = installTargets.resolveInstallTarget(args.runtime || 'codex');

    if (!target.supported) {
      throw new Error(`Runtime target "${target.name}" is not supported yet: ${target.notSupportedReason}`);
    }

    return target;
  }

  function getTargetDir(args) {
    return installTargets.resolveTargetDir(getRuntimeTarget(args), args);
  }

  function getInstalledRuntimePath(targetDir, target) {
    return path.resolve(targetDir, target.runtimeDirName).replace(/\\/g, '/');
  }

  function replaceInstallPaths(content, targetDir, target) {
    const runtimePath = `${getInstalledRuntimePath(targetDir, target)}/`;
    let next = content;

    for (const pattern of installTargets.getManagedRuntimePathPatterns(target)) {
      next = next.replace(pattern, runtimePath);
    }

    return next.replace(/\{\{EMB_VERSION\}\}/g, packageVersion);
  }

  function extractFrontmatterAndBody(content) {
    if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
      return { frontmatter: '', body: content.trim() };
    }

    const endIndex = content.indexOf('\n---', 3);
    if (endIndex === -1) {
      return { frontmatter: '', body: content.trim() };
    }

    const frontmatter = content.slice(4, endIndex).trim();
    const body = content.slice(endIndex + 4).trim();
    return { frontmatter, body };
  }

  function extractFrontmatterField(frontmatter, fieldName) {
    const pattern = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
    const match = frontmatter.match(pattern);
    if (!match) return '';
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  }

  function toSingleLine(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  function listManagedAgentFiles() {
    return fs
      .readdirSync(agentsSrc)
      .filter(name => name.startsWith(AGENT_PREFIX) && name.endsWith('.md'))
      .map(name => name.replace(/\.md$/, ''))
      .sort();
  }

  function listManagedCodexSkillNames() {
    return fs
      .readdirSync(commandsSrc)
      .filter(name => name.endsWith('.md'))
      .map(name => name.replace(/\.md$/, ''))
      .filter(name => commandVisibility.isPublicCommandName(name))
      .map(name => `emb-${name}`)
      .sort();
  }

  function listManagedPublicCommandNames() {
    return fs
      .readdirSync(commandsSrc)
      .filter(name => name.endsWith('.md'))
      .map(name => name.replace(/\.md$/, ''))
      .filter(name => commandVisibility.isPublicCommandName(name))
      .sort();
  }

  function generateAgentToml(agentName, content) {
    const { frontmatter, body } = extractFrontmatterAndBody(content);
    const resolvedName = extractFrontmatterField(frontmatter, 'name') || agentName;
    const description = toSingleLine(
      extractFrontmatterField(frontmatter, 'description') || `emb-agent ${resolvedName}`
    );
    const sandboxMode = SANDBOX_BY_AGENT[resolvedName] || 'read-only';

    return [
      `name = ${JSON.stringify(resolvedName)}`,
      `description = ${JSON.stringify(description)}`,
      `sandbox_mode = "${sandboxMode}"`,
      `developer_instructions = '''`,
      body.trim(),
      `'''`,
      ''
    ].join('\n');
  }

  function stripManagedConfigBlock(content) {
    const pattern = new RegExp(
      `${MANAGED_MARKER_START}[\\s\\S]*?${MANAGED_MARKER_END}\\n?`,
      'g'
    );
    return content.replace(pattern, '').trim();
  }

  function mergeManagedConfig(configPath, block) {
    let current = '';
    if (fs.existsSync(configPath)) {
      current = fs.readFileSync(configPath, 'utf8');
      current = stripManagedConfigBlock(current);
    }

    const next = current
      ? `${current}\n\n${block}\n`
      : `${block}\n`;

    fs.writeFileSync(configPath, next);
  }

  function detectLineEnding(content) {
    return content.includes('\r\n') ? '\r\n' : '\n';
  }

  function normalizeCodexHooksAssignments(content) {
    return content.replace(
      /^(\s*(?:features\.)?(?:"codex_hooks"|codex_hooks)\s*=\s*)(?:false|true|".*"|'.*')(\s*(?:#.*)?)$/gm,
      '$1true$2'
    );
  }

  function hasEnabledCodexHooks(content) {
    return (
      /^\s*(?:"codex_hooks"|codex_hooks)\s*=\s*true(?:\s*#.*)?$/m.test(content) ||
      /^\s*features\.(?:"codex_hooks"|codex_hooks)\s*=\s*true(?:\s*#.*)?$/m.test(content)
    );
  }

  function ensureCodexHooksFeature(configPath) {
    let content = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
    const eol = detectLineEnding(content);
    let next = normalizeCodexHooksAssignments(content);

    if (hasEnabledCodexHooks(next)) {
      if (next !== content) {
        fs.writeFileSync(configPath, next, 'utf8');
      }
      return;
    }

    if (/^\[features\](?:\s*#.*)?$/m.test(next)) {
      next = next.replace(/^\[features\](?:\s*#.*)?$/m, match => `${match}${eol}codex_hooks = true`);
    } else if (/^\s*features\.[^=\n]+\s*=.+$/m.test(next)) {
      next = `features.codex_hooks = true${eol}${next}`;
    } else {
      next = next.trim()
        ? `[features]${eol}codex_hooks = true${eol}${eol}${next}`
        : `[features]${eol}codex_hooks = true${eol}`;
    }

    fs.writeFileSync(configPath, next, 'utf8');
  }

  function buildConfigBlock(targetDir, target, agents) {
    const agentsDir = path.join(targetDir, target.agentsDirName || 'agents').replace(/\\/g, '/');
    const hooksDir = path.join(targetDir, target.runtimeDirName, 'hooks').replace(/\\/g, '/');
    const lines = [MANAGED_MARKER_START, ''];

    for (const agent of agents) {
      lines.push(`[agents.${agent.name}]`);
      lines.push(`description = ${JSON.stringify(agent.description)}`);
      lines.push(`config_file = "${agentsDir}/${agent.name}.toml"`);
      lines.push('');
    }

    lines.push('[[hooks]]');
    lines.push('event = "SessionStart"');
    lines.push(`command = "node ${hooksDir}/emb-session-start.js"`);
    lines.push('');
    lines.push('[[hooks]]');
    lines.push('event = "PostToolUse"');
    lines.push(`command = "node ${hooksDir}/emb-context-monitor.js"`);
    lines.push('');
    lines.push(MANAGED_MARKER_END);
    return lines.join('\n');
  }

  function readJsonObject(filePath) {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  function writeJsonObject(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  }

  function buildClaudeHookCommand(targetDir, target, hookFileName, isLocal) {
    const hookPath = isLocal
      ? path.join('.', target.localDirName, target.runtimeDirName, 'hooks', hookFileName)
      : path.join(targetDir, target.runtimeDirName, 'hooks', hookFileName);
    return `node "${hookPath.replace(/\\/g, '/')}"`;
  }

  function ensureClaudeSettingsHooks(settingsPath, targetDir, target, isLocal) {
    const settings = readJsonObject(settingsPath);
    const next = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};

    if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) {
      next.hooks = {};
    }
    if (!Array.isArray(next.hooks.SessionStart)) {
      next.hooks.SessionStart = [];
    }
    if (!Array.isArray(next.hooks.PostToolUse)) {
      next.hooks.PostToolUse = [];
    }

    const sessionStartCommand = buildClaudeHookCommand(targetDir, target, 'emb-session-start.js', isLocal);
    const contextMonitorCommand = buildClaudeHookCommand(targetDir, target, 'emb-context-monitor.js', isLocal);

    const hasSessionStartHook = next.hooks.SessionStart.some(entry =>
      entry && Array.isArray(entry.hooks) && entry.hooks.some(hook =>
        hook && typeof hook.command === 'string' && hook.command.includes('emb-session-start.js')
      )
    );

    if (!hasSessionStartHook) {
      next.hooks.SessionStart.push({
        hooks: [
          {
            type: 'command',
            command: sessionStartCommand
          }
        ]
      });
    }

    const hasContextMonitorHook = next.hooks.PostToolUse.some(entry =>
      entry && Array.isArray(entry.hooks) && entry.hooks.some(hook =>
        hook && typeof hook.command === 'string' && hook.command.includes('emb-context-monitor.js')
      )
    );

    if (!hasContextMonitorHook) {
      next.hooks.PostToolUse.push({
        matcher: 'Bash|Edit|Write|MultiEdit|Agent|Task',
        hooks: [
          {
            type: 'command',
            command: contextMonitorCommand,
            timeout: 10
          }
        ]
      });
    }

    writeJsonObject(settingsPath, next);
  }

  function stripClaudeManagedHooks(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !settings.hooks) {
      return settings;
    }

    const next = { ...settings, hooks: { ...settings.hooks } };

    for (const eventName of ['SessionStart', 'PostToolUse']) {
      const entries = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
      const filtered = entries
        .map(entry => {
          if (!entry || !Array.isArray(entry.hooks)) {
            return entry;
          }

          const hooks = entry.hooks.filter(hook => {
            if (!hook || typeof hook.command !== 'string') {
              return true;
            }
            return !hook.command.includes('emb-session-start.js') && !hook.command.includes('emb-context-monitor.js');
          });

          if (hooks.length === 0) {
            return null;
          }

          return { ...entry, hooks };
        })
        .filter(Boolean);

      if (filtered.length > 0) {
        next.hooks[eventName] = filtered;
      } else {
        delete next.hooks[eventName];
      }
    }

    if (Object.keys(next.hooks).length === 0) {
      delete next.hooks;
    }

    return next;
  }

  function installCodexAgents(targetDir, target) {
    const agentsDir = path.join(targetDir, target.agentsDirName || 'agents');
    ensureDir(agentsDir);

    const agentFiles = fs.readdirSync(agentsSrc).filter(name => name.startsWith(AGENT_PREFIX) && name.endsWith('.md'));
    const installed = [];

    for (const file of agentFiles) {
      const sourcePath = path.join(agentsSrc, file);
      const agentName = file.replace(/\.md$/, '');
      const raw = fs.readFileSync(sourcePath, 'utf8');
      const content = replaceInstallPaths(raw, targetDir, target);
      const toml = generateAgentToml(agentName, content);
      fs.writeFileSync(path.join(agentsDir, `${agentName}.toml`), toml);

      const { frontmatter } = extractFrontmatterAndBody(content);
      installed.push({
        name: extractFrontmatterField(frontmatter, 'name') || agentName,
        description: toSingleLine(
          extractFrontmatterField(frontmatter, 'description') || `emb-agent ${agentName}`
        )
      });
    }

    const configPath = path.join(targetDir, target.configFileName || 'config.toml');
    mergeManagedConfig(configPath, buildConfigBlock(targetDir, target, installed));
    ensureCodexHooksFeature(configPath);
    return installed.length;
  }

  function installMarkdownAgents(targetDir, target, args) {
    const agentsDir = path.join(targetDir, target.agentsDirName || 'agents');
    ensureDir(agentsDir);

    const agentFiles = fs.readdirSync(agentsSrc).filter(name => name.startsWith(AGENT_PREFIX) && name.endsWith('.md'));
    for (const agentName of listManagedAgentFiles()) {
      const mdPath = path.join(agentsDir, `${agentName}.md`);
      if (fs.existsSync(mdPath)) {
        fs.unlinkSync(mdPath);
      }
    }

    for (const file of agentFiles) {
      const sourcePath = path.join(agentsSrc, file);
      const raw = fs.readFileSync(sourcePath, 'utf8');
      const content = replaceInstallPaths(raw, targetDir, target);
      fs.writeFileSync(path.join(agentsDir, file), content, 'utf8');
    }

    ensureClaudeSettingsHooks(
      path.join(targetDir, target.configFileName || 'settings.json'),
      targetDir,
      target,
      Boolean(args && args.local)
    );

    return agentFiles.length;
  }

  function generateClaudeCommandContent(commandName, content, runtimeDir) {
    const { frontmatter, body } = extractFrontmatterAndBody(content);
    const commandLabel = extractFrontmatterField(frontmatter, 'name') || `emb-${commandName}`;
    const description = toSingleLine(
      extractFrontmatterField(frontmatter, 'description') || `Run emb-agent ${commandName}`
    );
    const runtimeCli = runtimeHost.resolveRuntimeHost(runtimeDir).cliCommand;

    return [
      `# ${commandLabel}`,
      '',
      description,
      '',
      '## Invocation',
      '',
      `- When this command matches the user intent, run \`${runtimeCli} ${commandName}\` with any required extra arguments.`,
      '- Use the runtime output as the source of truth for follow-up actions.',
      '',
      '## Original Guidance',
      '',
      body.trim(),
      ''
    ].join('\n');
  }

  function installClaudeCommands(targetDir, target, runtimeDir) {
    if (!target || target.name !== 'claude') {
      return 0;
    }

    const commandsRoot = path.join(targetDir, 'commands', 'emb');
    ensureDir(commandsRoot);

    for (const commandName of listManagedPublicCommandNames()) {
      const commandPath = path.join(commandsRoot, `${commandName}.md`);
      if (fs.existsSync(commandPath)) {
        fs.unlinkSync(commandPath);
      }
    }

    let installed = 0;

    for (const file of fs.readdirSync(commandsSrc).filter(name => name.endsWith('.md')).sort()) {
      const commandName = file.replace(/\.md$/, '');
      if (!commandVisibility.isPublicCommandName(commandName)) {
        continue;
      }

      const raw = fs.readFileSync(path.join(commandsSrc, file), 'utf8');
      const rendered = replaceInstallPaths(raw, targetDir, target);
      fs.writeFileSync(
        path.join(commandsRoot, `${commandName}.md`),
        generateClaudeCommandContent(commandName, rendered, runtimeDir),
        'utf8'
      );
      installed += 1;
    }

    return installed;
  }

  function generateCodexSkillContent(commandName, content, runtimeDir) {
    const { frontmatter, body } = extractFrontmatterAndBody(content);
    const skillName = extractFrontmatterField(frontmatter, 'name') || `emb-${commandName}`;
    const description = toSingleLine(
      extractFrontmatterField(frontmatter, 'description') || `Run emb-agent ${commandName}`
    );
    const runtimeCli = runtimeHost.resolveRuntimeHost(runtimeDir).cliCommand;

    return [
      '---',
      `name: ${skillName}`,
      `description: ${JSON.stringify(description)}`,
      '---',
      '',
      `# ${skillName}`,
      '',
      `This Codex skill mirrors the emb-agent public command \`${commandName}\`.`,
      '',
      '## Invocation',
      '',
      `- When this skill matches the user intent, run \`${runtimeCli} ${commandName}\` with any required extra arguments.`,
      '- Use the runtime output as the source of truth for the next step instead of improvising a parallel workflow.',
      '',
      '## Original Guidance',
      '',
      body.trim(),
      ''
    ].join('\n');
  }

  function installCodexSkills(targetDir, target, runtimeDir) {
    if (!target || target.name !== 'codex') {
      return 0;
    }

    const skillsRoot = path.join(targetDir, 'skills');
    ensureDir(skillsRoot);

    for (const skillName of listManagedCodexSkillNames()) {
      removeDirIfExists(path.join(skillsRoot, skillName));
    }

    let installed = 0;

    for (const file of fs.readdirSync(commandsSrc).filter(name => name.endsWith('.md')).sort()) {
      const commandName = file.replace(/\.md$/, '');
      if (!commandVisibility.isPublicCommandName(commandName)) {
        continue;
      }

      const raw = fs.readFileSync(path.join(commandsSrc, file), 'utf8');
      const rendered = replaceInstallPaths(raw, targetDir, target);
      const skillName = `emb-${commandName}`;
      const skillDir = path.join(skillsRoot, skillName);
      ensureDir(skillDir);
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        generateCodexSkillContent(commandName, rendered, runtimeDir),
        'utf8'
      );
      installed += 1;
    }

    return installed;
  }

  function installAgents(targetDir, target, args) {
    if (target.agentMode === 'markdown' || target.hookMode === 'claude-settings') {
      return installMarkdownAgents(targetDir, target, args);
    }

    return installCodexAgents(targetDir, target);
  }

  function installRuntime(targetDir, target, args) {
    const runtimeDir = path.join(targetDir, target.runtimeDirName);
    const runtimeCommandsDir = path.join(runtimeDir, 'commands');
    const runtimeCommandDocsDir = path.join(runtimeDir, 'command-docs');
    const runtimeAgentsDir = path.join(runtimeDir, 'agents');
    const runtimeToolsDir = path.join(runtimeDir, 'tools');
    const runtimeChipsDir = path.join(runtimeDir, 'chips');
    const runtimeHooksDir = path.join(runtimeDir, 'hooks');

    if (fs.existsSync(runtimeDir)) {
      removeDirIfExists(runtimeDir);
    }

    ensureDir(runtimeDir);
    copyDirWithReplacement(path.join(runtimeSrc, 'bin'), path.join(runtimeDir, 'bin'), targetDir, target);
    ensureDir(runtimeHooksDir);
    for (const file of fs.readdirSync(runtimeHooksSrc)) {
      const sourcePath = path.join(runtimeHooksSrc, file);
      if (fs.statSync(sourcePath).isDirectory()) {
        copyDirWithReplacement(sourcePath, path.join(runtimeHooksDir, file), targetDir, target);
        continue;
      }
      const raw = fs.readFileSync(sourcePath, 'utf8');
      fs.writeFileSync(path.join(runtimeHooksDir, file), replaceInstallPaths(raw, targetDir, target));
    }
    copyDirWithReplacement(path.join(runtimeSrc, 'lib'), path.join(runtimeDir, 'lib'), targetDir, target);
    copyDirWithReplacement(path.join(runtimeSrc, 'scripts'), path.join(runtimeDir, 'scripts'), targetDir, target);
    copyDirWithReplacement(path.join(runtimeSrc, 'scaffolds'), path.join(runtimeDir, 'scaffolds'), targetDir, target);
    copyDirWithReplacement(path.join(runtimeSrc, 'templates'), path.join(runtimeDir, 'templates'), targetDir, target);
    copyDir(path.join(runtimeSrc, 'registry'), path.join(runtimeDir, 'registry'));
    copyDir(path.join(runtimeSrc, 'profiles'), path.join(runtimeDir, 'profiles'));
    copyDir(path.join(runtimeSrc, 'packs'), path.join(runtimeDir, 'packs'));
    copyDir(path.join(runtimeSrc, 'specs'), path.join(runtimeDir, 'specs'));
    copyDir(path.join(runtimeSrc, 'tools'), runtimeToolsDir);
    copyDir(path.join(runtimeSrc, 'chips'), runtimeChipsDir);
    copyDir(path.join(runtimeSrc, 'state'), path.join(runtimeDir, 'state'));
    fs.copyFileSync(path.join(runtimeSrc, 'config.json'), path.join(runtimeDir, 'config.json'));
    const runtimeConfigPath = path.join(runtimeDir, 'config.json');
    const runtimeConfig = readJsonObject(runtimeConfigPath);
    runtimeConfig.developer = {
      name: String((args && args.developer) || '').trim(),
      runtime: target.name
    };
    if (args && args.local) {
      runtimeConfig.project_state_dir = 'state/projects';
      runtimeConfig.legacy_project_state_dir = 'state/projects';
    }
    if (
      (args && args.defaultAdapterSourceLocation) ||
      (args && args.defaultAdapterSourceBranch) ||
      (args && args.defaultAdapterSourceSubdir)
    ) {
      runtimeConfig.default_adapter_source = {
        type: 'git',
        location: String((args && args.defaultAdapterSourceLocation) || '').trim(),
        branch: String((args && args.defaultAdapterSourceBranch) || '').trim(),
        subdir: String((args && args.defaultAdapterSourceSubdir) || '').trim()
      };
    }
    writeJsonObject(runtimeConfigPath, runtimeConfig);
    fs.writeFileSync(
      path.join(runtimeDir, 'HOST.json'),
      JSON.stringify(runtimeHost.createInstallHostMetadata(targetDir, target, args), null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(path.join(runtimeDir, 'VERSION'), `${packageVersion}\n`, 'utf8');
    ensureDir(path.join(runtimeDir, 'adapters'));

    ensureDir(runtimeCommandsDir);
    ensureDir(runtimeCommandDocsDir);
    for (const file of fs.readdirSync(commandsSrc).filter(name => name.endsWith('.md'))) {
      const raw = fs.readFileSync(path.join(commandsSrc, file), 'utf8');
      const rendered = replaceInstallPaths(raw, targetDir, target);
      const commandName = file.replace(/\.md$/, '');
      fs.writeFileSync(path.join(runtimeCommandDocsDir, file), rendered, 'utf8');
      if (commandVisibility.isPublicCommandName(commandName)) {
        fs.writeFileSync(path.join(runtimeCommandsDir, file), rendered, 'utf8');
      }
    }

    ensureDir(runtimeAgentsDir);
    for (const file of fs.readdirSync(agentsSrc).filter(name => name.startsWith(AGENT_PREFIX) && name.endsWith('.md'))) {
      const targetName = file.replace(/^emb-/, '');
      const raw = fs.readFileSync(path.join(agentsSrc, file), 'utf8');
      fs.writeFileSync(path.join(runtimeAgentsDir, targetName), replaceInstallPaths(raw, targetDir, target), 'utf8');
    }

    return runtimeDir;
  }

  function buildEnvExampleContent() {
    return [
      '# emb-agent integration secrets',
      '# Optional: set MinerU API token here, then copy to .env if needed.',
      'MINERU_API_KEY=',
      ''
    ].join('\n');
  }

  function installEnvExample(filePath) {
    if (fs.existsSync(filePath)) {
      return false;
    }

    fs.writeFileSync(filePath, buildEnvExampleContent(), 'utf8');
    return true;
  }

  function buildEnvHintLines(envExamplePath) {
    const envPath = envExamplePath.replace(/\.example$/, '');
    if (fs.existsSync(envPath)) {
      return [];
    }

    return [
      `Tip: create ${envPath} from .env.example if you want MinerU API tokens managed locally.`,
      'Tip: set MINERU_API_KEY in that .env when switching MinerU to api/v4.'
    ];
  }

  function uninstall(targetDir, target) {
    const agentsDir = path.join(targetDir, target.agentsDirName || 'agents');

    for (const agentName of listManagedAgentFiles()) {
      const extension = target.agentMode === 'markdown' ? '.md' : '.toml';
      const agentPath = path.join(agentsDir, `${agentName}${extension}`);
      if (fs.existsSync(agentPath)) {
        fs.unlinkSync(agentPath);
      }
    }

    if (target.name === 'codex') {
      const skillsRoot = path.join(targetDir, 'skills');
      for (const skillName of listManagedCodexSkillNames()) {
        removeDirIfExists(path.join(skillsRoot, skillName));
      }
    }
    if (target.name === 'claude') {
      const commandsRoot = path.join(targetDir, 'commands', 'emb');
      for (const commandName of listManagedPublicCommandNames()) {
        const commandPath = path.join(commandsRoot, `${commandName}.md`);
        if (fs.existsSync(commandPath)) {
          fs.unlinkSync(commandPath);
        }
      }
      removeDirIfExists(commandsRoot);
    }

    removeDirIfExists(path.join(targetDir, target.runtimeDirName));

    const configPath = path.join(targetDir, target.configFileName || 'config.toml');
    if (fs.existsSync(configPath)) {
      if (target.hookMode === 'claude-settings') {
        const cleanedSettings = stripClaudeManagedHooks(readJsonObject(configPath));
        if (cleanedSettings && Object.keys(cleanedSettings).length > 0) {
          writeJsonObject(configPath, cleanedSettings);
        } else {
          fs.unlinkSync(configPath);
        }
      } else {
        const cleaned = stripManagedConfigBlock(fs.readFileSync(configPath, 'utf8'));
        if (cleaned) {
          fs.writeFileSync(configPath, `${cleaned}\n`);
        } else {
          fs.unlinkSync(configPath);
        }
      }
    }
  }

  async function main(argv) {
    const args = await resolveArgs(argv || process.argv.slice(2));

    if (args.help) {
      usage();
      return;
    }

    const target = getRuntimeTarget(args);
    const targetDir = getTargetDir(args);
    ensureDir(targetDir);

    if (args.uninstall) {
      uninstall(targetDir, target);
      process.stdout.write(`Uninstalled emb-agent managed files for ${target.label} from: ${targetDir}\n`);
      return;
    }

    const runtimeDir = installRuntime(targetDir, target, args);
    const installedRuntimeHost = runtimeHost.resolveRuntimeHost(runtimeDir);
    const agentCount = installAgents(targetDir, target, args);
    const codexSkillCount = installCodexSkills(targetDir, target, runtimeDir);
    const claudeCommandCount = installClaudeCommands(targetDir, target, runtimeDir);
    const envExamplePath = path.join(args.local ? process.cwd() : targetDir, '.env.example');
    const envExampleCreated = installEnvExample(envExamplePath);
    const envHintLines = buildEnvHintLines(envExamplePath);
    const lines = [
      `Installed emb-agent runtime for ${target.label} to: ${runtimeDir}`,
      `Installed ${agentCount} ${target.agentLabel || `${target.label} agents`} under: ${path.join(targetDir, target.agentsDirName || 'agents')}`,
      ...(codexSkillCount > 0
        ? [`Installed ${codexSkillCount} Codex skills under: ${path.join(targetDir, 'skills')}`]
        : []),
      ...(claudeCommandCount > 0
        ? [`Installed ${claudeCommandCount} Claude commands under: ${path.join(targetDir, 'commands', 'emb')}`]
        : []),
      `Updated ${target.label} config: ${path.join(targetDir, target.configFileName || 'config.toml')}`,
      `Developer identity: ${args.developer} (${target.name})`,
      ...(args.subagentBridgeCmd
        ? [`Sub-agent bridge: ${args.subagentBridgeCmd} (timeout: ${args.subagentBridgeTimeoutMs} ms)`]
        : []),
      ...(args.defaultAdapterSourceLocation
        ? [`Default adapter source: ${args.defaultAdapterSourceLocation}`]
        : []),
      `${envExampleCreated ? 'Created' : 'Kept'} env example: ${envExamplePath}`,
      ...envHintLines,
      'Startup automation is installed automatically. If it does not seem active yet, restart the host once and rerun init/next. Use EMB_AGENT_WORKSPACE_TRUST=0|1 only for debugging.',
      'Next steps:',
      `  Restart ${target.restartLabel || target.label} to pick up new commands and agents.`,
      `  In a project repo, open a ${target.label} session and run: init`,
      '  Then continue with: next'
    ];

    process.stdout.write(lines.join('\n') + '\n');
  }

  return {
    usage,
    getSupportedInstallTargets,
    parseArgs,
    isInteractiveInstall,
    buildInteractiveRuntimePrompt,
    buildInteractiveLocationPrompt,
    promptInteractiveInstallArgs,
    resolveArgs,
    getRuntimeTarget,
    getTargetDir,
    installRuntime,
    installEnvExample,
    installAgents,
    uninstall,
    main
  };
}

module.exports = {
  createInstallHelpers
};
