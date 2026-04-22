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
    packageVersion,
    initProject,
    createTerminalUi
  } = deps;

  const MANAGED_MARKER_START = '# EMB-AGENT managed start';
  const MANAGED_MARKER_END = '# EMB-AGENT managed end';
  const AGENT_PREFIX = 'emb-';
  const TEXT_FILE_EXTENSIONS = new Set(['.cjs', '.js', '.json', '.md', '.txt', '.tpl', '.yaml', '.yml']);
  const DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS =
    Number(runtimeHost && runtimeHost.DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS) || 15000;
  const INSTALL_PROFILES = Object.freeze({
    core: {
      name: 'core',
      includeScaffolds: false
    },
    workflow: {
      name: 'workflow',
      includeScaffolds: true
    }
  });
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
        '  emb-agent --cursor --local',
        '  emb-agent --runtime claude --local',
        '  emb-agent --runtime codex --local',
        '  emb-agent --runtime cursor --local',
        '  emb-agent --global --developer <name>',
        '  emb-agent --global --config-dir <path>',
        '  emb-agent --local --uninstall',
        '  emb-agent                  Launch interactive installer',
        '  emb-agent --help',
        '',
        'Options:',
        '  --claude                Install for Claude Code explicitly',
        '  --codex                 Install for Codex explicitly (default)',
        '  --cursor                Install for Cursor explicitly',
        '  --runtime <name>        Select runtime target (codex, claude, cursor; others reserved)',
        '  --developer <name>      Required developer name to seed new projects',
        '  --global                Install to runtime config home',
        '  --local                 Install to current project runtime dir and bootstrap .emb-agent/',
        '  --profile <name>        Install profile: core (default), workflow',
        '  --color[=<mode>]        Color mode: always, auto (default), never',
        '  --no-color              Disable ANSI colors while keeping installer feedback',
        '  --config-dir <path>     Override target runtime directory',
        '  --subagent-bridge-cmd <command>',
        '                          Configure host sub-agent bridge command',
        '  --subagent-bridge-timeout-ms <ms>',
        '                          Set host sub-agent bridge timeout in milliseconds',
        '  --default-chip-support-source-location <url>',
        '                          Persist the default git chip support source location for bootstrap/health',
        '  --default-chip-support-source-branch <name>',
        '                          Optional default branch for the chip support source',
        '  --default-chip-support-source-subdir <path>',
        '                          Optional subdirectory under the chip support source repository',
        '  --skill-source <source>',
        '                          Install an initial skill bundle from path, npm:, pypi:, or git source',
        '  --skill <name>',
        '                          Enable only the named skill from the installed bundle (repeatable)',
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
    return runtime === 'claude' || runtime === 'codex' || runtime === 'cursor'
      ? 'local'
      : 'global';
  }

  function normalizeInstallProfile(value, flagName) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      if (flagName) {
        throw new Error(`Missing value after ${flagName}`);
      }
      return 'core';
    }
    if (!Object.prototype.hasOwnProperty.call(INSTALL_PROFILES, normalized)) {
      throw new Error(`Unsupported install profile: ${value}`);
    }
    return normalized;
  }

  function normalizeColorMode(value, flagName, defaultMode = 'auto') {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      if (flagName) {
        throw new Error(`Missing value after ${flagName}`);
      }
      return defaultMode;
    }
    if (normalized !== 'always' && normalized !== 'auto' && normalized !== 'never') {
      throw new Error(`Unsupported color mode: ${value}`);
    }
    return normalized;
  }

  function getInstallProfile(args) {
    const profileName = normalizeInstallProfile(args && args.profile, '');
    return INSTALL_PROFILES[profileName];
  }

  function parseArgs(argv) {
    const result = {
      global: false,
      local: false,
      runtime: '',
      developer: '',
      profile: 'core',
      color: 'auto',
      interactive: false,
      configDir: '',
      subagentBridgeCmd: '',
      subagentBridgeTimeoutMs: DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS,
      defaultAdapterSourceLocation: '',
      defaultAdapterSourceBranch: '',
      defaultAdapterSourceSubdir: '',
      skillSources: [],
      skillNames: [],
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
      if (token === '--cursor') {
        setRuntime('cursor');
        continue;
      }
      if (token === '--runtime') {
        const runtime = (argv[index + 1] || '').trim().toLowerCase();
        if (!runtime) {
          throw new Error('Missing runtime name after --runtime');
        }
        if (runtime === 'external') {
          throw new Error('Runtime target "external" is no longer installable');
        }
        setRuntime(runtime);
        index += 1;
        continue;
      }
      if (token === '--external') {
        throw new Error('Install flag "--external" has been removed');
      }
      if (token === '--developer') {
        result.developer = (argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--profile') {
        result.profile = normalizeInstallProfile(argv[index + 1], '--profile');
        index += 1;
        continue;
      }
      if (token === '--color') {
        const next = String(argv[index + 1] || '').trim().toLowerCase();
        if (next === 'always' || next === 'auto' || next === 'never') {
          result.color = normalizeColorMode(next, '--color');
          index += 1;
          continue;
        }
        result.color = 'always';
        continue;
      }
      if (token.startsWith('--color=')) {
        result.color = normalizeColorMode(token.slice('--color='.length), '--color');
        continue;
      }
      if (token === '--no-color') {
        result.color = 'never';
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
      if (token === '--default-chip-support-source-location') {
        result.defaultAdapterSourceLocation = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--default-chip-support-source-branch') {
        result.defaultAdapterSourceBranch = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--default-chip-support-source-subdir') {
        result.defaultAdapterSourceSubdir = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--skill-source') {
        result.skillSources.push(String(argv[index + 1] || '').trim());
        index += 1;
        continue;
      }
      if (token === '--skill') {
        result.skillNames.push(String(argv[index + 1] || '').trim());
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
    if (argv.includes('--profile') && !result.profile) {
      throw new Error('Missing value after --profile');
    }
    if (argv.includes('--subagent-bridge-cmd') && !result.subagentBridgeCmd) {
      throw new Error('Missing command after --subagent-bridge-cmd');
    }
    if (argv.includes('--subagent-bridge-timeout-ms') && !result.subagentBridgeCmd) {
      throw new Error('--subagent-bridge-timeout-ms requires --subagent-bridge-cmd');
    }
    if (argv.includes('--default-chip-support-source-location') && !result.defaultAdapterSourceLocation) {
      throw new Error('Missing value after --default-chip-support-source-location');
    }
    if (argv.includes('--default-chip-support-source-branch') && !result.defaultAdapterSourceBranch) {
      throw new Error('Missing value after --default-chip-support-source-branch');
    }
    if (argv.includes('--default-chip-support-source-subdir') && !result.defaultAdapterSourceSubdir) {
      throw new Error('Missing value after --default-chip-support-source-subdir');
    }
    if (argv.includes('--skill-source') && result.skillSources.some(item => !item)) {
      throw new Error('Missing value after --skill-source');
    }
    if (argv.includes('--skill') && result.skillNames.some(item => !item)) {
      throw new Error('Missing value after --skill');
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

  function createPromptStyler() {
    const fallbackChalk = {
      bold: text => String(text),
      blue: text => String(text),
      cyan: text => String(text),
      dim: text => String(text),
      gray: text => String(text),
      green: text => String(text),
      red: text => String(text),
      yellow: text => String(text),
      white: text => String(text)
    };

    if (typeof createTerminalUi !== 'function') {
      return {
        enabled: false,
        chalk: fallbackChalk
      };
    }

    const output = process.stdout || process.stderr;
    const ui = createTerminalUi({
      process: {
        env: process.env || {},
        argv: process.argv || [],
        stdout: output,
        stderr: output
      }
    });

    return {
      enabled: Boolean(ui && ui.enabled),
      chalk: ui && ui.chalk ? ui.chalk : fallbackChalk
    };
  }

  function writePromptOutput(text) {
    const output = process.stdout;
    if (!output || typeof output.write !== 'function') {
      return;
    }
    output.write(String(text || ''));
  }

  function buildPromptHeader(chalk) {
    return [
      chalk.cyan(chalk.bold('emb-agent installer')),
      chalk.gray('  Embedded workflow bootstrap for Codex, Claude Code, and Cursor'),
      ''
    ];
  }

  function renderInteractiveSection(chalk, icon, title, descriptionLines, choiceLines, promptLabel) {
    const lines = [
      chalk.blue(`${icon} ${title}`)
    ];

    for (const line of descriptionLines || []) {
      if (line) {
        lines.push(chalk.gray(`  ${line}`));
      }
    }

    if (Array.isArray(choiceLines) && choiceLines.length > 0) {
      lines.push('');
      choiceLines.forEach(item => {
        lines.push(item);
      });
    }

    lines.push('');
    lines.push(chalk.yellow(promptLabel));
    return lines.join('\n');
  }

  function buildInteractiveRuntimePrompt(targets) {
    const { chalk } = createPromptStyler();
    const choiceLines = [];

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const globalDir = path.join(os.homedir(), ...(target.defaultGlobalDirParts || [target.localDirName]));
      choiceLines.push(
        `  ${chalk.cyan(`${index + 1}.`)} ${chalk.white(target.label)} ${chalk.gray(`(${globalDir.replace(os.homedir(), '~')})`)}`
      );
    }

    return [
      ...buildPromptHeader(chalk),
      renderInteractiveSection(
        chalk,
        '▶',
        'Select Runtime',
        ['Choose the host runtime that emb-agent should integrate with.'],
        choiceLines,
        'Choice [1] > '
      )
    ].join('\n');
  }

  function buildInteractiveLocationPrompt(target) {
    const { chalk } = createPromptStyler();
    const globalDir = path.join(os.homedir(), ...(target.defaultGlobalDirParts || [target.localDirName]));
    const defaultLocation = getDefaultInstallLocation(target && target.name);
    const defaultChoice = defaultLocation === 'local' ? '2' : '1';
    const recommended = defaultLocation === 'local' ? '  Recommended for this runtime' : '';

    return renderInteractiveSection(
      chalk,
      '▶',
      'Install Location',
      [
        `Target runtime: ${target.label}`,
        'Project-scoped installs are easier to test and keep isolated.'
      ],
      [
        `  ${chalk.cyan('1.')} ${chalk.white('Global')} ${chalk.gray(`(${globalDir.replace(os.homedir(), '~')})`)}`,
        `  ${chalk.cyan('2.')} ${chalk.white('Local')} ${chalk.gray(`(./${target.localDirName})`)}${chalk.green(recommended)}`
      ],
      `Choice [${defaultChoice}] > `
    );
  }

  function buildInteractiveDeveloperPrompt() {
    const { chalk } = createPromptStyler();
    return renderInteractiveSection(
      chalk,
      '▶',
      'Developer Identity',
      [
        'Enter the developer name used to seed new emb-agent projects.',
        'Tip: use your git username or the name you want embedded in project metadata.'
      ],
      [],
      'Developer name > '
    );
  }

  function writePromptConfirmation(label, value) {
    const { chalk } = createPromptStyler();
    writePromptOutput(`${chalk.green('✓')} ${chalk.cyan(label)} ${chalk.gray(value)}\n`);
  }

  function writePromptWarning(message) {
    const { chalk } = createPromptStyler();
    writePromptOutput(`${chalk.yellow('!')} ${chalk.yellow(message)}\n`);
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
      const profile = normalizeInstallProfile(prompted && prompted.profile ? prompted.profile : 'core', '');
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
        profile,
        interactive: true,
        configDir: '',
        subagentBridgeCmd,
        subagentBridgeTimeoutMs:
          subagentBridgeTimeoutProvided
            ? parsePositiveInteger(prompted.subagentBridgeTimeoutMs, 'subagentBridgeTimeoutMs')
            : DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS,
        defaultAdapterSourceLocation: '',
        defaultAdapterSourceBranch: '',
        defaultAdapterSourceSubdir: '',
        skillSources: [],
        skillNames: [],
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
    writePromptConfirmation('Runtime:', target.label);

    const defaultLocation = getDefaultInstallLocation(target.name);
    const locationAnswer = await promptLine(buildInteractiveLocationPrompt(target));
    const resolvedLocationAnswer = String(locationAnswer || (defaultLocation === 'local' ? '2' : '1')).trim();
    const isLocal = resolvedLocationAnswer === '2';
    writePromptConfirmation('Location:', isLocal ? 'Local project' : 'Global config');

    let developer = await promptLine(buildInteractiveDeveloperPrompt());
    while (!developer) {
      writePromptWarning('Developer name is required');
      developer = await promptLine(buildInteractiveDeveloperPrompt());
    }
    writePromptConfirmation('Developer:', developer);

    return {
      global: !isLocal,
      local: isLocal,
      runtime: target.name,
      developer,
      profile: 'core',
      interactive: true,
      configDir: '',
      subagentBridgeCmd: '',
      subagentBridgeTimeoutMs: DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS,
      defaultAdapterSourceLocation: '',
      defaultAdapterSourceBranch: '',
      defaultAdapterSourceSubdir: '',
      skillSources: [],
      skillNames: [],
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

  function removeDirIfEmpty(dirPath) {
    if (!fs.existsSync(dirPath)) {
      return;
    }
    try {
      if (fs.statSync(dirPath).isDirectory() && fs.readdirSync(dirPath).length === 0) {
        fs.rmdirSync(dirPath);
      }
    } catch {
      // Best-effort cleanup only.
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

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function renderRuntimeTemplate(templateName, replacements, targetDir, target) {
    const templatePath = path.join(runtimeSrc, 'templates', templateName);
    let content = replaceInstallPaths(fs.readFileSync(templatePath, 'utf8'), targetDir, target);

    for (const [key, value] of Object.entries(replacements || {})) {
      content = content.replace(new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, 'g'), String(value));
    }

    return content;
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

  function buildConfigBlock(targetDir, target, agents) {
    const agentsDir = path.join(targetDir, target.agentsDirName || 'agents').replace(/\\/g, '/');
    const lines = [];

    for (const agent of agents) {
      lines.push(`[agents.${agent.name}]`);
      lines.push(`description = ${JSON.stringify(agent.description)}`);
      lines.push(`config_file = "${agentsDir}/${agent.name}.toml"`);
      lines.push('');
    }

    return lines.join('\n').trim();
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

  function buildJsonHostHookCommand(targetDir, target, hookFileName, isLocal) {
    const hookPath = isLocal
      ? path.join('.', target.localDirName, target.runtimeDirName, 'hooks', hookFileName)
      : path.join(targetDir, target.runtimeDirName, 'hooks', hookFileName);
    return `node "${hookPath.replace(/\\/g, '/')}"`;
  }

  function ensureJsonHostHooks(settingsPath, targetDir, target, isLocal) {
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

    const sessionStartCommand = buildJsonHostHookCommand(targetDir, target, 'emb-session-start.js', isLocal);
    const contextMonitorCommand = buildJsonHostHookCommand(targetDir, target, 'emb-context-monitor.js', isLocal);
    const statusLineCommand = buildJsonHostHookCommand(targetDir, target, 'emb-statusline.js', isLocal);

    if (target && target.name === 'claude') {
      const existingStatusLine = next.statusLine;
      const statusLineManaged =
        existingStatusLine &&
        typeof existingStatusLine === 'object' &&
        !Array.isArray(existingStatusLine) &&
        typeof existingStatusLine.command === 'string' &&
        existingStatusLine.command.includes('emb-statusline.js');

      if (!existingStatusLine || statusLineManaged) {
        next.statusLine = {
          type: 'command',
          command: statusLineCommand
        };
      }
    }

    const hasSessionStartHook = next.hooks.SessionStart.some(entry =>
      entry &&
      (
        (typeof entry.command === 'string' && entry.command.includes('emb-session-start.js')) ||
        (
          Array.isArray(entry.hooks) &&
          entry.hooks.some(hook =>
            hook && typeof hook.command === 'string' && hook.command.includes('emb-session-start.js')
          )
        )
      )
    );

    if (!hasSessionStartHook) {
      if (target.hookMode === 'cursor-settings') {
        next.hooks.SessionStart.push({
          command: sessionStartCommand
        });
      } else {
        next.hooks.SessionStart.push({
          hooks: [
            {
              type: 'command',
              command: sessionStartCommand
            }
          ]
        });
      }
    }

    const hasContextMonitorHook = next.hooks.PostToolUse.some(entry =>
      entry &&
      (
        (typeof entry.command === 'string' && entry.command.includes('emb-context-monitor.js')) ||
        (
          Array.isArray(entry.hooks) &&
          entry.hooks.some(hook =>
            hook && typeof hook.command === 'string' && hook.command.includes('emb-context-monitor.js')
          )
        )
      )
    );

    if (!hasContextMonitorHook) {
      if (target.hookMode === 'cursor-settings') {
        next.hooks.PostToolUse.push({
          matcher: 'Bash|Edit|Write|MultiEdit|Agent|Task',
          command: contextMonitorCommand,
          timeout: 10
        });
      } else {
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
    }

    writeJsonObject(settingsPath, next);
  }

  function stripJsonHostManagedHooks(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || !settings.hooks) {
      if (
        settings &&
        typeof settings === 'object' &&
        !Array.isArray(settings) &&
        settings.statusLine &&
        typeof settings.statusLine === 'object' &&
        typeof settings.statusLine.command === 'string' &&
        settings.statusLine.command.includes('emb-statusline.js')
      ) {
        const next = { ...settings };
        delete next.statusLine;
        return next;
      }
      return settings;
    }

    const next = { ...settings, hooks: { ...settings.hooks } };

    if (
      next.statusLine &&
      typeof next.statusLine === 'object' &&
      typeof next.statusLine.command === 'string' &&
      next.statusLine.command.includes('emb-statusline.js')
    ) {
      delete next.statusLine;
    }

    for (const eventName of ['SessionStart', 'PostToolUse']) {
      const entries = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
      const filtered = entries
        .map(entry => {
          if (!entry || typeof entry !== 'object') {
            return entry;
          }

          if (typeof entry.command === 'string') {
            if (entry.command.includes('emb-session-start.js') || entry.command.includes('emb-context-monitor.js')) {
              return null;
            }
            return entry;
          }

          if (!Array.isArray(entry.hooks)) {
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
    mergeManagedConfig(
      configPath,
      renderRuntimeTemplate(
        'codex-config.toml.tpl',
        {
          AGENT_BLOCKS: buildConfigBlock(targetDir, target, installed)
        },
        targetDir,
        target
      )
    );
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

    ensureJsonHostHooks(
      path.join(targetDir, target.configFileName || 'settings.json'),
      targetDir,
      target,
      Boolean(args && args.local)
    );

    return agentFiles.length;
  }

  function installCodexHooks(targetDir, target, args) {
    const hooksPath = path.join(targetDir, target.hooksConfigFileName || 'hooks.json');
    const current = stripJsonHostManagedHooks(readJsonObject(hooksPath));
    const next =
      current && typeof current === 'object' && !Array.isArray(current)
        ? { ...current }
        : {};
    const rendered = JSON.parse(
      renderRuntimeTemplate(
        'codex-hooks.json.tpl',
        {
          SESSION_START_COMMAND: JSON.stringify(
            buildJsonHostHookCommand(targetDir, target, 'emb-session-start.js', Boolean(args && args.local))
          ),
          POST_TOOL_USE_COMMAND: JSON.stringify(
            buildJsonHostHookCommand(targetDir, target, 'emb-context-monitor.js', Boolean(args && args.local))
          )
        },
        targetDir,
        target
      )
    );

    if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) {
      next.hooks = {};
    }

    for (const [eventName, entries] of Object.entries(rendered.hooks || {})) {
      const existingEntries = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
      next.hooks[eventName] = existingEntries.concat(entries);
    }

    writeJsonObject(hooksPath, next);
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

  function generateCursorCommandContent(commandName, content, runtimeDir) {
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

  function installCursorCommands(targetDir, target, runtimeDir) {
    if (!target || target.name !== 'cursor') {
      return 0;
    }

    const commandsRoot = path.join(targetDir, 'commands');
    ensureDir(commandsRoot);

    for (const commandName of listManagedPublicCommandNames()) {
      const commandPath = path.join(commandsRoot, `emb-${commandName}.md`);
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
        path.join(commandsRoot, `emb-${commandName}.md`),
        generateCursorCommandContent(commandName, rendered, runtimeDir),
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

  function generateSharedSkillContent(commandName, content, runtimeDir) {
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
      `This shared skill routes matching requests to the emb-agent command \`${commandName}\`.`,
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

  function installSharedCodexSkills(targetDir, target, runtimeDir, args) {
    if (!target || target.name !== 'codex' || !(args && args.local)) {
      return 0;
    }

    const skillsRoot = path.join(path.resolve(targetDir, '..'), '.agents', 'skills');
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
        generateSharedSkillContent(commandName, rendered, runtimeDir),
        'utf8'
      );
      installed += 1;
    }

    return installed;
  }

  function installAgents(targetDir, target, args) {
    if (target.agentMode === 'none' || target.hookMode === 'none') {
      return 0;
    }

    if (target.agentMode === 'markdown' || target.hookMode === 'claude-settings') {
      return installMarkdownAgents(targetDir, target, args);
    }

    return installCodexAgents(targetDir, target);
  }

  function installRuntime(targetDir, target, args) {
    const installProfile = getInstallProfile(args);
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
    if (installProfile.includeScaffolds) {
      copyDirWithReplacement(path.join(runtimeSrc, 'scaffolds'), path.join(runtimeDir, 'scaffolds'), targetDir, target);
    }
    copyDirWithReplacement(path.join(runtimeSrc, 'templates'), path.join(runtimeDir, 'templates'), targetDir, target);
    copyDir(path.join(runtimeSrc, 'registry'), path.join(runtimeDir, 'registry'));
    copyDir(path.join(runtimeSrc, 'profiles'), path.join(runtimeDir, 'profiles'));
    copyDir(path.join(runtimeSrc, 'packs'), path.join(runtimeDir, 'packs'));
    copyDir(path.join(runtimeSrc, 'specs'), path.join(runtimeDir, 'specs'));
    copyDir(path.join(runtimeSrc, 'tools'), runtimeToolsDir);
    copyDir(path.join(runtimeSrc, 'chips'), runtimeChipsDir);
    ensureDir(path.join(runtimeDir, 'state'));
    ensureDir(path.join(runtimeDir, 'state', 'projects'));
    fs.copyFileSync(
      path.join(runtimeSrc, 'state', 'default-session.json'),
      path.join(runtimeDir, 'state', 'default-session.json')
    );
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
      runtimeConfig.default_chip_support_source = {
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
    ensureDir(path.join(runtimeDir, 'chip-support'));

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

  function bootstrapProjectIfNeeded(args) {
    if (!args || !args.local || !initProject) {
      return null;
    }

    const projectRoot = process.cwd();
    const initArgs = ['--project', projectRoot];

    if (args.runtime) {
      initArgs.push('--runtime', args.runtime);
    }
    if (args.developer) {
      initArgs.push('--user', args.developer);
    }

    const parsedInitArgs = initProject.parseArgs(initArgs);
    const workflowSetup = initProject.prepareProjectWorkflowSetup(projectRoot, parsedInitArgs, {
      force: false,
      process: {
        ...process,
        stdin: { isTTY: false },
        stdout: { isTTY: false, write() { return true; } }
      }
    });
    const resolvedInitArgs = {
      ...parsedInitArgs,
      packs: workflowSetup.activePacks
    };
    const projectConfig = initProject.buildProjectConfig(projectRoot, resolvedInitArgs, {
      workflowCatalog: workflowSetup.workflowCatalog,
      activePacks: workflowSetup.activePacks
    });
    return initProject.scaffoldProject(projectRoot, projectConfig, false, {
      ...resolvedInitArgs,
      workflowRegistryImport: workflowSetup.workflowRegistryImport
    });
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

  function createInstallReporter(args) {
    if (typeof createTerminalUi !== 'function') {
      return {
        enabled: false,
        announce() {},
        activity() {
          return {
            succeed() {},
            fail() {}
          };
        },
        complete() {},
        removed() {}
      };
    }

    const ui = createTerminalUi({
      process,
      colorMode: args && args.color
    });
    const chalk = ui && ui.chalk ? ui.chalk : {
      bold: text => String(text),
      cyan: text => String(text),
      dim: text => String(text),
      green: text => String(text),
      yellow: text => String(text)
    };

    function writeTerminalLine(line = '') {
      if (!ui || !ui.enabled || !process.stderr || typeof process.stderr.write !== 'function') {
        return;
      }
      process.stderr.write(`${line}\n`);
    }

    function activity(text) {
      return ui && typeof ui.createActivity === 'function'
        ? ui.createActivity(text)
        : {
            succeed() {},
            fail() {}
          };
    }

    function announce(target, args, targetDir, installProfile) {
      if (!ui || !ui.enabled) {
        return;
      }

      writeTerminalLine(chalk.bold('emb-agent installer'));
      writeTerminalLine(`${chalk.cyan('  Runtime:')} ${target.label}`);
      writeTerminalLine(
        `${chalk.cyan('  Location:')} ${args.local ? 'local project' : 'global config'}`
      );
      writeTerminalLine(`${chalk.cyan('  Target:')} ${targetDir}`);
      writeTerminalLine(`${chalk.cyan('  Profile:')} ${installProfile.name}`);
      if (args.developer) {
        writeTerminalLine(`${chalk.cyan('  Developer:')} ${args.developer}`);
      }
      if (args.subagentBridgeCmd) {
        writeTerminalLine(
          `${chalk.cyan('  Bridge:')} ${args.subagentBridgeCmd} (${args.subagentBridgeTimeoutMs} ms)`
        );
      }
      writeTerminalLine(chalk.dim(''));
    }

    function complete(target, runtimeDir, projectBootstrap, installProfile) {
      if (!ui || !ui.enabled) {
        return;
      }

      writeTerminalLine(chalk.green('Installation complete'));
      writeTerminalLine(`${chalk.cyan('  Runtime Dir:')} ${runtimeDir}`);
      writeTerminalLine(`${chalk.cyan('  Profile:')} ${installProfile.name}`);
      if (projectBootstrap && projectBootstrap.bootstrap_task && projectBootstrap.bootstrap_task.path) {
        writeTerminalLine(
          `${chalk.cyan('  Bootstrap Task:')} ${path.join(projectBootstrap.project_root, projectBootstrap.bootstrap_task.path)}`
        );
      }
      writeTerminalLine(
        `${chalk.cyan('  Next:')} Restart ${target.restartLabel || target.label}, then open a new session`
      );
      writeTerminalLine(chalk.dim(''));
    }

    function removed(target, targetDir) {
      if (!ui || !ui.enabled) {
        return;
      }

      writeTerminalLine(chalk.green('Uninstall complete'));
      writeTerminalLine(`${chalk.cyan('  Runtime:')} ${target.label}`);
      writeTerminalLine(`${chalk.cyan('  Removed From:')} ${targetDir}`);
      writeTerminalLine(chalk.dim(''));
    }

    return {
      enabled: Boolean(ui && ui.enabled),
      announce,
      activity,
      complete,
      removed
    };
  }

  function uninstall(targetDir, target, args) {
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
      removeDirIfEmpty(skillsRoot);
      if (args && args.local) {
        const sharedSkillsRoot = path.join(path.resolve(targetDir, '..'), '.agents', 'skills');
        for (const skillName of listManagedCodexSkillNames()) {
          removeDirIfExists(path.join(sharedSkillsRoot, skillName));
        }
        removeDirIfEmpty(sharedSkillsRoot);
        removeDirIfEmpty(path.dirname(sharedSkillsRoot));
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
      removeDirIfEmpty(commandsRoot);
      removeDirIfEmpty(path.dirname(commandsRoot));
    }
    if (target.name === 'cursor') {
      const commandsRoot = path.join(targetDir, 'commands');
      for (const commandName of listManagedPublicCommandNames()) {
        const commandPath = path.join(commandsRoot, `emb-${commandName}.md`);
        if (fs.existsSync(commandPath)) {
          fs.unlinkSync(commandPath);
        }
      }
      removeDirIfEmpty(commandsRoot);
    }

    removeDirIfExists(path.join(targetDir, target.runtimeDirName));

    const configPath = path.join(targetDir, target.configFileName || 'config.toml');
    if (fs.existsSync(configPath)) {
      if (target.hookMode === 'claude-settings' || target.hookMode === 'cursor-settings') {
        const cleanedSettings = stripJsonHostManagedHooks(readJsonObject(configPath));
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

    if (target.hookMode === 'codex-json') {
      const hooksConfigPath = path.join(targetDir, target.hooksConfigFileName || 'hooks.json');
      if (fs.existsSync(hooksConfigPath)) {
        const cleanedHooks = stripJsonHostManagedHooks(readJsonObject(hooksConfigPath));
        if (
          cleanedHooks &&
          typeof cleanedHooks === 'object' &&
          !Array.isArray(cleanedHooks) &&
          Object.keys(cleanedHooks).length > 0
        ) {
          writeJsonObject(hooksConfigPath, cleanedHooks);
        } else {
          fs.unlinkSync(hooksConfigPath);
        }
      }
    }
  }

  function installInitialSkills(runtimeDir, args) {
    const sources = Array.isArray(args && args.skillSources) ? args.skillSources.filter(Boolean) : [];
    if (sources.length === 0) {
      return [];
    }

    const installedRuntime = require(path.join(runtimeDir, 'lib', 'emb-agent-main.cjs'));
    const sharedArgs = [
      '--scope',
      args && args.local ? 'project' : 'user',
      ...(args && args.force ? ['--force'] : []),
      ...((args && Array.isArray(args.skillNames) ? args.skillNames : []).flatMap(name => ['--skill', name]))
    ];

    return sources.map(source => installedRuntime.installSkillSource([source, ...sharedArgs]));
  }

  async function main(argv) {
    const args = await resolveArgs(argv || process.argv.slice(2));

    if (args.help) {
      usage();
      return;
    }

    const target = getRuntimeTarget(args);
    const targetDir = getTargetDir(args);
    const installProfile = getInstallProfile(args);
    const reporter = createInstallReporter(args);
    ensureDir(targetDir);

    reporter.announce(target, args, targetDir, installProfile);

    if (args.uninstall) {
      const uninstallActivity = reporter.activity('Removing emb-agent managed files');
      try {
        uninstall(targetDir, target, args);
        uninstallActivity.succeed('Removed emb-agent managed files');
      } catch (error) {
        uninstallActivity.fail('Removing emb-agent managed files', error);
        throw error;
      }
      reporter.removed(target, targetDir);
      process.stdout.write(`Uninstalled emb-agent managed files for ${target.label} from: ${targetDir}\n`);
      return;
    }

    const runtimeActivity = reporter.activity('Installing emb-agent runtime files');
    let runtimeDir;
    try {
      runtimeDir = installRuntime(targetDir, target, args);
      runtimeActivity.succeed('Installed emb-agent runtime files');
    } catch (error) {
      runtimeActivity.fail('Installing emb-agent runtime files', error);
      throw error;
    }
    const installedRuntimeHost = runtimeHost.resolveRuntimeHost(runtimeDir);
    const integrationActivity = reporter.activity('Installing host agents, hooks, and commands');
    let agentCount;
    let codexSkillCount;
    let sharedSkillCount;
    let claudeCommandCount;
    let cursorCommandCount;
    try {
      agentCount = installAgents(targetDir, target, args);
      if (target.hookMode === 'codex-json') {
        installCodexHooks(targetDir, target, args);
      }
      codexSkillCount = installCodexSkills(targetDir, target, runtimeDir);
      sharedSkillCount = installSharedCodexSkills(targetDir, target, runtimeDir, args);
      claudeCommandCount = installClaudeCommands(targetDir, target, runtimeDir);
      cursorCommandCount = installCursorCommands(targetDir, target, runtimeDir);
      const installedSurfaceCount =
        agentCount + codexSkillCount + sharedSkillCount + claudeCommandCount + cursorCommandCount;
      integrationActivity.succeed(
        installedSurfaceCount > 0
          ? `Installed ${installedSurfaceCount} host integration artifacts`
          : 'Installed host integration metadata'
      );
    } catch (error) {
      integrationActivity.fail('Installing host agents, hooks, and commands', error);
      throw error;
    }

    const envActivity = reporter.activity('Preparing local environment template');
    const envExamplePath = path.join(args.local ? process.cwd() : targetDir, '.env.example');
    let envExampleCreated;
    try {
      envExampleCreated = installEnvExample(envExamplePath);
      envActivity.succeed(`${envExampleCreated ? 'Created' : 'Kept'} env example`);
    } catch (error) {
      envActivity.fail('Preparing local environment template', error);
      throw error;
    }

    let projectBootstrap = null;
    if (args.local) {
      const bootstrapActivity = reporter.activity('Bootstrapping local emb-agent project');
      try {
        projectBootstrap = bootstrapProjectIfNeeded(args);
        bootstrapActivity.succeed(
          projectBootstrap ? 'Bootstrapped local emb-agent project' : 'Skipped local project bootstrap'
        );
      } catch (error) {
        bootstrapActivity.fail('Bootstrapping local emb-agent project', error);
        throw error;
      }
    }

    let installedSkillBundles = [];
    if (Array.isArray(args.skillSources) && args.skillSources.length > 0) {
      const skillsActivity = reporter.activity('Installing initial skill bundles');
      try {
        installedSkillBundles = installInitialSkills(runtimeDir, args);
        skillsActivity.succeed(
          installedSkillBundles.length > 0
            ? `Installed ${installedSkillBundles.length} initial skill bundle${installedSkillBundles.length > 1 ? 's' : ''}`
            : 'Skipped initial skill bundle install'
        );
      } catch (error) {
        skillsActivity.fail('Installing initial skill bundles', error);
        throw error;
      }
    }

    const envHintLines = buildEnvHintLines(envExamplePath);
    const lines = [
      `Installed emb-agent runtime for ${target.label} to: ${runtimeDir}`,
      `Install profile: ${installProfile.name}`,
      ...(agentCount > 0
        ? [`Installed ${agentCount} ${target.agentLabel || `${target.label} agents`} under: ${path.join(targetDir, target.agentsDirName || 'agents')}`]
        : []),
      ...(codexSkillCount > 0
        ? [`Installed ${codexSkillCount} Codex skills under: ${path.join(targetDir, 'skills')}`]
        : []),
      ...(sharedSkillCount > 0
        ? [`Installed ${sharedSkillCount} shared skills under: ${path.join(path.resolve(targetDir, '..'), '.agents', 'skills')}`]
        : []),
      ...(claudeCommandCount > 0
        ? [`Installed ${claudeCommandCount} Claude commands under: ${path.join(targetDir, 'commands', 'emb')}`]
        : []),
      ...(cursorCommandCount > 0
        ? [`Installed ${cursorCommandCount} Cursor commands under: ${path.join(targetDir, 'commands')}`]
        : []),
      ...(target.managesHostConfig === false
        ? [`External runtime metadata: ${path.join(runtimeDir, 'HOST.json')}`]
        : [
            `Updated ${target.label} config: ${path.join(targetDir, target.configFileName || 'config.toml')}`,
            ...(target.hookMode === 'codex-json'
              ? [`Installed ${target.label} hooks config: ${path.join(targetDir, target.hooksConfigFileName || 'hooks.json')}`]
              : [])
          ]),
      `Developer identity: ${args.developer} (${target.name})`,
      ...(args.subagentBridgeCmd
        ? [`Sub-agent bridge: ${args.subagentBridgeCmd} (timeout: ${args.subagentBridgeTimeoutMs} ms)`]
        : []),
      ...(args.defaultAdapterSourceLocation
        ? [`Default chip support source: ${args.defaultAdapterSourceLocation}`]
        : []),
      ...installedSkillBundles.map(bundle => {
        const enabledCount = Array.isArray(bundle.selected_skills) ? bundle.selected_skills.length : 0;
        return `Installed skill bundle: ${bundle.plugin.name} (${enabledCount} enabled skill${enabledCount === 1 ? '' : 's'})`;
      }),
      ...(projectBootstrap
        ? [
            `Bootstrapped emb-agent project in: ${projectBootstrap.project_root}`,
            'Project entry files: AGENTS.md, .emb-agent/project.json, .emb-agent/hw.yaml, .emb-agent/req.yaml',
            `Bootstrap task: ${path.join(projectBootstrap.project_root, projectBootstrap.bootstrap_task.path)}`
          ]
        : []),
      `${envExampleCreated ? 'Created' : 'Kept'} env example: ${envExamplePath}`,
      ...envHintLines,
      ...(!installProfile.includeScaffolds
        ? ['Advanced scaffold assets were skipped in core profile. Reinstall with --profile workflow to include them.']
        : []),
      'Startup automation is installed automatically. If it does not seem active yet, restart the host once and open a new session. Use EMB_AGENT_WORKSPACE_TRUST=0|1 only for debugging.',
      'Next steps:',
      `  Restart ${target.restartLabel || target.label} to pick up new commands and agents.`,
      `  In a project repo, open a ${target.label} session. emb-agent will inject the startup context automatically.`,
      `  ${projectBootstrap ? 'Then continue with the recommended next command from the injected startup context.' : 'Then continue with the recommended next command.'}`
    ];

    reporter.complete(target, runtimeDir, projectBootstrap, installProfile);
    if (!reporter.enabled) {
      process.stdout.write(lines.join('\n') + '\n');
    }
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
    getInstallProfile,
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
