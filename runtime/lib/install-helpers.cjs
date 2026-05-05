'use strict';

const commandVisibility = require('./command-visibility.cjs');
const defaultWorkflowSourceHelpers = require('./default-workflow-source.cjs');
const defaultSkillSourceHelpers = require('./default-skill-source.cjs');
const { DEFAULT_SKILL_SOURCE_LOCATION } = defaultSkillSourceHelpers;

function createInstallHelpers(deps) {
  const {
    fs,
    os,
    path,
    process,
    readline,
    promptInstallerChoices,
    previewWorkflowSource,
    previewSkillSource,
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
  const INTERACTIVE_CANCELLED_MESSAGE = 'Interactive install cancelled.';
  const INTERACTIVE_SELECTION_CHANGE_SOURCE = Symbol('interactive-selection-change-source');
  let cachedSkillSourcePreviewer = null;
  let cachedWorkflowSourcePreviewer = null;

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
        '  --registry <source>',
        '                          Import project specs from path or git source during local bootstrap',
        '  --registry-branch <name>',
        '                          Optional branch for the workflow registry source',
        '  --registry-subdir <path>',
        '                          Optional subdirectory under the workflow registry source repository',
        '  --spec <name>',
        '                          Activate the named spec during local bootstrap (repeatable)',
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
      registry: '',
      registryBranch: '',
      registrySubdir: '',
      specs: [],
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
      if (token === '--registry' || token === '-r') {
        result.registry = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--registry-branch') {
        result.registryBranch = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--registry-subdir') {
        result.registrySubdir = String(argv[index + 1] || '').trim();
        index += 1;
        continue;
      }
      if (token === '--spec') {
        result.specs.push(String(argv[index + 1] || '').trim());
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
    if ((argv.includes('--registry') || argv.includes('-r')) && !result.registry) {
      throw new Error('Missing value after --registry/-r');
    }
    if (argv.includes('--registry-branch') && !result.registryBranch) {
      throw new Error('Missing value after --registry-branch');
    }
    if (argv.includes('--registry-subdir') && !result.registrySubdir) {
      throw new Error('Missing value after --registry-subdir');
    }
    if (argv.includes('--spec') && result.specs.some(item => !item)) {
      throw new Error('Missing value after --spec');
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

  function buildInteractiveSkillSourcePrompt() {
    const { chalk } = createPromptStyler();
    return renderInteractiveSection(
      chalk,
      '▶',
      'Skill Source',
      [
        'Provide a path, npm:, pypi:, or git source for the initial skill bundle.',
        `Press enter to use the default repository: ${DEFAULT_SKILL_SOURCE_LOCATION}`,
        'Type `skip` to continue without installing initial skills.'
      ],
      [],
      'Skill source > '
    );
  }

  function buildInteractiveWorkflowSourcePrompt(defaultSource = resolveInstallerDefaultWorkflowSource()) {
    const { chalk } = createPromptStyler();
    const defaultTarget = [
      defaultSource.location,
      defaultSource.subdir ? `subdir=${defaultSource.subdir}` : '',
      defaultSource.branch ? `branch=${defaultSource.branch}` : ''
    ].filter(Boolean).join(', ');

    return renderInteractiveSection(
      chalk,
      '▶',
      'Spec Source',
      [
        'Provide a path or git source for the external specs used during project bootstrap.',
        `Press enter to use the default repository: ${defaultTarget}`,
        'Type `skip` to continue without importing external specs.'
      ],
      [],
      'Spec source > '
    );
  }

  function buildInteractiveWorkflowSelectionPrompt(preview, options = {}) {
    const specs = Array.isArray(preview && preview.specs) ? preview.specs : [];
    return buildInteractiveNamedSelectionPrompt({
      title: 'Spec Selection',
      context_label: 'Source',
      context_value: preview && preview.source && preview.source.location ? preview.source.location : 'spec source',
      entries: specs,
      detail_key: 'summary',
      skip_label: 'Skip external spec import',
      empty_instruction: 'Press enter or type `skip` to continue without importing external specs.',
      all_instruction: 'Type `all` to activate every selectable spec from that source.',
      source_change_instruction: 'Type `source` to use a different spec source.',
      allow_source_change: options.allow_source_change
    });
  }

  function buildInteractiveSkillSelectionPrompt(preview, options = {}) {
    const skills = Array.isArray(preview && preview.skills) ? preview.skills : [];
    return buildInteractiveNamedSelectionPrompt({
      title: 'Skill Selection',
      context_label: 'Plugin',
      context_value: preview && preview.plugin && preview.plugin.name ? preview.plugin.name : 'skill bundle',
      entries: skills,
      detail_key: 'description',
      skip_label: 'Skip initial skill installation',
      empty_instruction: 'Press enter or type `skip` to skip initial skill installation.',
      all_instruction: 'Type `all` to enable every published skill from that bundle.',
      source_change_instruction: 'Type `source` to use a different skill bundle source.',
      allow_source_change: options.allow_source_change
    });
  }

  function buildInteractiveNamedSelectionPrompt(options = {}) {
    const { chalk } = createPromptStyler();
    const entries = Array.isArray(options.entries) ? options.entries : [];
    const detailKey = String(options.detail_key || 'description').trim() || 'description';
    const allowSourceChange = Boolean(options.allow_source_change);
    const choiceLines = [
      `  ${chalk.cyan('skip.')} ${chalk.white(String(options.skip_label || 'Skip').trim() || 'Skip')}`,
      '',
      ...entries.map((entry, index) => {
        const detail = summarizeInteractiveSkillSelectionDescription(entry && entry[detailKey]);
        const suffix = detail ? ` ${chalk.gray(`- ${detail}`)}` : '';
        return `  ${chalk.cyan(`${index + 1}.`)} ${chalk.white(entry.name)}${suffix}`;
      })
    ];

    const descriptionLines = [
      `${String(options.context_label || 'Source').trim() || 'Source'}: ${options.context_value || ''}`,
      String(options.empty_instruction || 'Press enter or type `skip` to skip.'),
      'Use space-separated numbers to enable a subset.',
      String(options.all_instruction || 'Type `all` to enable every item.')
    ];
    if (allowSourceChange) {
      descriptionLines.push(String(options.source_change_instruction || 'Type `source` to use a different source.'));
    }

    return renderInteractiveSection(
      chalk,
      '▶',
      String(options.title || 'Selection').trim() || 'Selection',
      descriptionLines,
      choiceLines,
      allowSourceChange ? 'Choice [skip/all/source] > ' : 'Choice [skip/all] > '
    );
  }

  function summarizeInteractiveSkillSelectionDescription(value, maxLength = 140) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return '';
    }

    const sentenceMatch = normalized.match(/^(.+?[.?!。！？])(?:\s|$)/);
    const preferred = sentenceMatch && sentenceMatch[1] && sentenceMatch[1].length <= maxLength
      ? sentenceMatch[1]
      : normalized;

    if (preferred.length <= maxLength) {
      return preferred;
    }
    return `${preferred.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  function normalizeInteractiveSkillSources(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item || '').trim()).filter(Boolean);
    }

    const source = String(value || '').trim();
    return source ? [source] : [];
  }

  function normalizeInteractiveSkillNames(value) {
    if (Array.isArray(value)) {
      return value
        .flatMap(item => String(item || '').split(','))
        .map(item => item.trim())
        .filter(Boolean);
    }

    return String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  function normalizeInteractiveWorkflowSpecs(value) {
    if (Array.isArray(value)) {
      return value
        .flatMap(item => String(item || '').split(','))
        .map(item => item.trim())
        .filter(Boolean);
    }

    return String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  function readInteractiveBoolean(value, defaultValue) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      return defaultValue;
    }

    if (normalized === 'y' || normalized === 'yes' || normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'n' || normalized === 'no' || normalized === 'false' || normalized === '0') {
      return false;
    }

    return defaultValue;
  }

  function resolveInstallerDefaultWorkflowSource() {
    const runtime = require(path.join(runtimeSrc, 'lib', 'runtime.cjs'));
    const runtimeConfig = runtime.loadRuntimeConfig(runtimeSrc);
    return defaultWorkflowSourceHelpers.resolveDefaultWorkflowSource(runtimeConfig, process.env);
  }

  function buildInstallerWorkflowSourceConfig(source, options = {}) {
    const defaultSource = resolveInstallerDefaultWorkflowSource();
    const location = String(source || '').trim() || defaultSource.location;
    const useDefaultSource = location === defaultSource.location;
    const branch =
      String(options.branch || '').trim() ||
      (useDefaultSource ? String(defaultSource.branch || '').trim() : '');
    const subdir =
      String(options.subdir || '').trim() ||
      (useDefaultSource ? String(defaultSource.subdir || '').trim() : '');

    return {
      location,
      branch,
      subdir
    };
  }

  function resolveInteractiveWorkflowArgs(prompted) {
    const installSpecsProvided = prompted && (
      Object.prototype.hasOwnProperty.call(prompted, 'installSpecs') ||
      Object.prototype.hasOwnProperty.call(prompted, 'installWorkflows')
    );
    const explicitRegistry = String(prompted && prompted.registry ? prompted.registry : '').trim();
    const explicitRegistryBranch = String(
      prompted && prompted.registryBranch ? prompted.registryBranch : ''
    ).trim();
    const explicitRegistrySubdir = String(
      prompted && prompted.registrySubdir ? prompted.registrySubdir : ''
    ).trim();
    const requestedSpecs = normalizeInteractiveWorkflowSpecs(prompted && prompted.specs);
    const installSpecs = installSpecsProvided
      ? readInteractiveBoolean(
          prompted && Object.prototype.hasOwnProperty.call(prompted, 'installSpecs')
            ? prompted.installSpecs
            : prompted.installWorkflows,
          false
        )
      : Boolean(explicitRegistry || explicitRegistryBranch || explicitRegistrySubdir || requestedSpecs.length > 0);

    if (!installSpecs) {
      return {
        registry: '',
        registryBranch: '',
        registrySubdir: '',
        specs: []
      };
    }

    const resolvedSource = buildInstallerWorkflowSourceConfig(explicitRegistry, {
      branch: explicitRegistryBranch,
      subdir: explicitRegistrySubdir
    });

    return {
      registry: resolvedSource.location,
      registryBranch: resolvedSource.branch,
      registrySubdir: resolvedSource.subdir,
      specs: requestedSpecs
    };
  }

  function resolveInteractiveSkillArgs(prompted) {
    const installSkillsProvided =
      prompted && Object.prototype.hasOwnProperty.call(prompted, 'installSkills');
    const requestedSkillSources = normalizeInteractiveSkillSources(prompted && prompted.skillSources);
    const requestedSkillNames = normalizeInteractiveSkillNames(prompted && prompted.skillNames);
    const installSkills = installSkillsProvided
      ? readInteractiveBoolean(prompted.installSkills, false)
      : requestedSkillSources.length > 0 || requestedSkillNames.length > 0;

    if (!installSkills) {
      return {
        skillSources: [],
        skillNames: []
      };
    }

    return {
      skillSources: requestedSkillSources.length > 0 ? requestedSkillSources : [DEFAULT_SKILL_SOURCE_LOCATION],
      skillNames: requestedSkillNames
    };
  }

  function parseInteractiveWorkflowSelection(value, preview) {
    return parseInteractiveNamedSelection(value, preview && preview.specs, {
      item_label: 'spec',
      all_mode: 'names'
    });
  }

  function parseInteractiveSkillSelection(value, preview) {
    return parseInteractiveNamedSelection(value, preview && preview.skills, {
      item_label: 'skill',
      all_mode: 'empty'
    });
  }

  function parseInteractiveNamedSelection(value, entries, options = {}) {
    const items = Array.isArray(entries) ? entries : [];
    if (items.length === 0) {
      return null;
    }

    const tokens = String(value || '')
      .split(/[,\s]+/)
      .map(item => item.trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      return null;
    }

    const selected = [];
    let requestedSkip = false;
    let requestedAll = false;
    const itemLabel = String(options.item_label || 'selection').trim() || 'selection';

    tokens.forEach(token => {
      const normalized = token.toLowerCase();
      if (normalized === 'skip' || token === '0') {
        requestedSkip = true;
        return;
      }
      if (normalized === 'all') {
        requestedAll = true;
        return;
      }

      const index = Number.parseInt(token, 10);
      if (Number.isFinite(index) && String(index) === token && index >= 1 && index <= items.length) {
        selected.push(items[index - 1].name);
        return;
      }

      const matched = items.find(entry => entry && entry.name === token);
      if (!matched) {
        throw new Error(`Unknown ${itemLabel} selection: ${token}`);
      }
      selected.push(matched.name);
    });

    if (requestedSkip && (requestedAll || selected.length > 0)) {
      throw new Error(`Skip cannot be combined with ${itemLabel} selections.`);
    }
    if (requestedSkip) {
      return null;
    }
    if (requestedAll) {
      return options.all_mode === 'empty'
        ? []
        : items.map(entry => entry.name);
    }

    return Array.from(new Set(selected));
  }

  function supportsInteractiveSkillSelectionKeyboardUi() {
    return Boolean(
      process.stdin &&
      process.stdin.isTTY &&
      process.stdout &&
      process.stdout.isTTY &&
      typeof process.stdin.setRawMode === 'function' &&
      typeof process.stdin.on === 'function' &&
      (typeof process.stdin.off === 'function' || typeof process.stdin.removeListener === 'function')
    );
  }

  function promptInteractiveSelectionWithKeys(entries, renderUi, options = {}) {
    const items = Array.isArray(entries) ? entries : [];
    if (items.length === 0) {
      return Promise.resolve(null);
    }

    const stdin = process.stdin;
    const stdout = process.stdout;
    const allowSourceChange = Boolean(options.allow_source_change);

    return new Promise((resolve, reject) => {
      const state = {
        cursorIndex: items.length > 0 ? 1 : 0,
        selected: new Set()
      };
      const previousRawMode = Boolean(stdin.isRaw);
      let settled = false;
      const totalChoices = items.length + 1;

      function cleanup() {
        if (typeof stdin.setRawMode === 'function') {
          stdin.setRawMode(previousRawMode);
        }
        if (typeof stdin.pause === 'function') {
          stdin.pause();
        }
        if (typeof stdin.off === 'function') {
          stdin.off('data', handleKeypress);
        } else if (typeof stdin.removeListener === 'function') {
          stdin.removeListener('data', handleKeypress);
        }
        if (stdout && typeof stdout.write === 'function') {
          stdout.write('\x1b[?25h\x1b[?1049l');
        }
      }

      function settleWith(action, value) {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        action(value);
      }

      function render() {
        if (!stdout || typeof stdout.write !== 'function') {
          return;
        }
        stdout.write('\x1b[2J\x1b[H');
        stdout.write(`${renderUi(state, options)}\n`);
      }

      function toggleCurrentEntry() {
        if (state.cursorIndex === 0) {
          return;
        }
        const currentEntry = items[state.cursorIndex - 1];
        if (!currentEntry) {
          return;
        }
        if (state.selected.has(currentEntry.name)) {
          state.selected.delete(currentEntry.name);
          return;
        }
        state.selected.add(currentEntry.name);
      }

      function toggleAllEntries() {
        if (state.selected.size === items.length) {
          state.selected.clear();
          return;
        }
        items.forEach(entry => {
          state.selected.add(entry.name);
        });
      }

      function finalizeSelection() {
        if (state.cursorIndex === 0) {
          settleWith(resolve, null);
          return;
        }
        const ordered = items
          .filter(entry => state.selected.has(entry.name))
          .map(entry => entry.name);
        settleWith(resolve, ordered.length > 0 ? ordered : null);
      }

      function handleKeypress(chunk) {
        const input = String(chunk || '');
        if (input === '\u001b[A') {
          state.cursorIndex = (state.cursorIndex - 1 + totalChoices) % totalChoices;
          render();
          return;
        }
        if (input === '\u001b[B') {
          state.cursorIndex = (state.cursorIndex + 1) % totalChoices;
          render();
          return;
        }
        if (input === ' ') {
          toggleCurrentEntry();
          render();
          return;
        }
        if (input === '\r' || input === '\n') {
          finalizeSelection();
          return;
        }
        if (input === '0') {
          settleWith(resolve, null);
          return;
        }
        if (input === '\u0003' || input === '\u0004' || input === '\u001b') {
          settleWith(reject, new Error(INTERACTIVE_CANCELLED_MESSAGE));
          return;
        }

        const normalized = input.toLowerCase();
        if (normalized === 'a') {
          toggleAllEntries();
          render();
          return;
        }
        if (allowSourceChange && normalized === 's') {
          settleWith(resolve, INTERACTIVE_SELECTION_CHANGE_SOURCE);
        }
      }

      try {
        if (stdout && typeof stdout.write === 'function') {
          stdout.write('\x1b[?1049h\x1b[?25l');
        }
        if (typeof stdin.setEncoding === 'function') {
          stdin.setEncoding('utf8');
        }
        stdin.setRawMode(true);
        if (typeof stdin.resume === 'function') {
          stdin.resume();
        }
        stdin.on('data', handleKeypress);
        render();
      } catch (error) {
        settleWith(reject, error);
      }
    });
  }

  function renderInteractiveNamedSelectionKeyboardUi(options = {}, state) {
    const { chalk } = createPromptStyler();
    const entries = Array.isArray(options.entries) ? options.entries : [];
    const detailKey = String(options.detail_key || 'description').trim() || 'description';
    const allowSourceChange = Boolean(options.allow_source_change);
    const selected = state && state.selected instanceof Set ? state.selected : new Set();
    const cursorIndex = Number.isInteger(state && state.cursorIndex) ? state.cursorIndex : 0;
    const totalChoices = entries.length + 1;
    const choiceLines = [
      (() => {
        const isActive = cursorIndex === 0;
        const cursor = isActive ? chalk.cyan('›') : ' ';
        const renderedLabel = isActive
          ? chalk.bold(chalk.white(String(options.skip_label || 'Skip').trim() || 'Skip'))
          : chalk.white(String(options.skip_label || 'Skip').trim() || 'Skip');
        return `  ${cursor} ${chalk.cyan('skip')} ${renderedLabel}`;
      })(),
      ...entries.map((entry, index) => {
        const entryIndex = index + 1;
        const isActive = entryIndex === cursorIndex;
        const isSelected = selected.has(entry.name);
        const cursor = isActive ? chalk.cyan('›') : ' ';
        const marker = isSelected ? chalk.green('●') : chalk.gray('○');
        const detail = summarizeInteractiveSkillSelectionDescription(entry && entry[detailKey]);
        const renderedName = isActive ? chalk.bold(chalk.white(entry.name)) : chalk.white(entry.name);
        const suffix = detail ? ` ${chalk.gray(`- ${detail}`)}` : '';
        return `  ${cursor} ${marker} ${renderedName}${suffix}`;
      })
    ];

    const descriptionLines = [
      `${String(options.context_label || 'Source').trim() || 'Source'}: ${options.context_value || ''}`,
      `Use ↑/↓ to move and Space to toggle the highlighted ${options.item_noun || 'entry'}.`,
      'Press Enter to confirm the current selection.',
      `Highlight \`skip\` and press Enter to continue without ${options.skip_action || 'continuing'}.`,
      `Press Enter with no selected ${options.item_plural || 'entries'} to ${options.empty_action || 'skip'}.`,
      String(options.toggle_all_instruction || 'Press `a` to toggle every entry.')
    ];
    if (allowSourceChange) {
      descriptionLines.push(String(options.source_change_instruction || 'Press `s` to use a different source.'));
    }
    descriptionLines.push('Press `Esc`, `Ctrl+C`, or `Ctrl+D` to cancel installation.');

    return [
      ...buildPromptHeader(chalk),
      renderInteractiveSection(
        chalk,
        '▶',
        String(options.title || 'Selection').trim() || 'Selection',
        descriptionLines,
        choiceLines,
        totalChoices > 1 ? '↑/↓=move  Space=toggle  Enter=confirm' : 'Enter=confirm'
      )
    ].join('\n');
  }

  function renderInteractiveWorkflowSelectionKeyboardUi(preview, state, options = {}) {
    const specs = Array.isArray(preview && preview.specs) ? preview.specs : [];
    return renderInteractiveNamedSelectionKeyboardUi({
      title: 'Spec Selection',
      context_label: 'Source',
      context_value: preview && preview.source && preview.source.location ? preview.source.location : 'spec source',
      entries: specs,
      detail_key: 'summary',
      skip_label: 'Skip external spec import',
      item_noun: 'spec',
      item_plural: 'specs',
      skip_action: 'importing external specs',
      empty_action: 'skip external spec import',
      toggle_all_instruction: 'Press `a` to toggle every selectable spec from that source.',
      source_change_instruction: 'Press `s` to use a different spec source.',
      allow_source_change: options.allow_source_change
    }, state);
  }

  function renderInteractiveSkillSelectionKeyboardUi(preview, state, options = {}) {
    const skills = Array.isArray(preview && preview.skills) ? preview.skills : [];
    return renderInteractiveNamedSelectionKeyboardUi({
      title: 'Skill Selection',
      context_label: 'Plugin',
      context_value: preview && preview.plugin && preview.plugin.name ? preview.plugin.name : 'skill bundle',
      entries: skills,
      detail_key: 'description',
      skip_label: 'Skip initial skill installation',
      item_noun: 'skill',
      item_plural: 'skills',
      skip_action: 'installing initial skills',
      empty_action: 'skip initial skill installation',
      toggle_all_instruction: 'Press `a` to toggle every published skill from that bundle.',
      source_change_instruction: 'Press `s` to use a different skill bundle source.',
      allow_source_change: options.allow_source_change
    }, state);
  }

  function promptInteractiveWorkflowSelectionWithKeys(preview, options = {}) {
    return promptInteractiveSelectionWithKeys(
      preview && preview.specs,
      state => renderInteractiveWorkflowSelectionKeyboardUi(preview, state, options),
      options
    );
  }

  function promptInteractiveSkillSelectionWithKeys(preview, options = {}) {
    return promptInteractiveSelectionWithKeys(
      preview && preview.skills,
      state => renderInteractiveSkillSelectionKeyboardUi(preview, state, options),
      options
    );
  }

  function getSkillSourcePreviewer() {
    if (typeof previewSkillSource === 'function') {
      return previewSkillSource;
    }
    if (cachedSkillSourcePreviewer) {
      return cachedSkillSourcePreviewer;
    }

    const runtime = require(path.join(runtimeSrc, 'lib', 'runtime.cjs'));
    const skillRuntime = require(path.join(runtimeSrc, 'lib', 'skill-runtime.cjs'));
    const runtimeConfig = runtime.loadRuntimeConfig(runtimeSrc);
    const sourceRoot = path.resolve(runtimeSrc, '..');
    const helper = skillRuntime.createSkillRuntimeHelpers({
      childProcess: require('child_process'),
      fs,
      path,
      process,
      runtime,
      runtimeConfig,
      runtimeHost: () => runtimeHost.resolveRuntimeHost(runtimeSrc),
      resolveProjectRoot: () => path.resolve(process.cwd()),
      getProjectExtDir: () => runtime.getProjectExtDir(path.resolve(process.cwd())),
      updateSession() {},
      builtInSkillsDir: path.join(sourceRoot, 'skills'),
      builtInDisplayRoot: sourceRoot
    });
    cachedSkillSourcePreviewer = helper.previewSkillSource;
    return cachedSkillSourcePreviewer;
  }

  function getWorkflowSourcePreviewer() {
    if (typeof previewWorkflowSource === 'function') {
      return previewWorkflowSource;
    }
    if (cachedWorkflowSourcePreviewer) {
      return cachedWorkflowSourcePreviewer;
    }

    const runtime = require(path.join(runtimeSrc, 'lib', 'runtime.cjs'));
    const workflowImportHelpers = require(path.join(runtimeSrc, 'lib', 'workflow-import.cjs'));
    const workflowRegistry = require(path.join(runtimeSrc, 'lib', 'workflow-registry.cjs'));
    const workflowImport = workflowImportHelpers.createWorkflowImportHelpers({
      childProcess: require('child_process'),
      fs,
      os,
      path,
      process,
      runtime,
      workflowRegistry
    });

    cachedWorkflowSourcePreviewer = (source, options = {}) => {
      const staged = workflowImport.stageWorkflowRegistrySource(source, options);

      try {
        const sourceLayout = workflowImport.resolveWorkflowSourceLayout(staged.root, options);

        try {
          const registry = sourceLayout.registry;
          return {
            source: {
              location: String(source || '').trim(),
              branch: String(options.branch || '').trim(),
              subdir: String(options.subdir || '').trim()
            },
            specs: (registry.specs || [])
              .filter(entry => entry && entry.selectable === true)
              .map(entry => ({
                name: entry.name,
                title: entry.title,
                summary: entry.summary
              }))
          };
        } finally {
          sourceLayout.cleanup();
        }
      } finally {
        staged.cleanup();
      }
    };

    return cachedWorkflowSourcePreviewer;
  }

  function resolveInstallerDefaultSkillSource() {
    const runtime = require(path.join(runtimeSrc, 'lib', 'runtime.cjs'));
    const runtimeConfig = runtime.loadRuntimeConfig(runtimeSrc);
    return defaultSkillSourceHelpers.resolveDefaultSkillSource(runtimeConfig, process.env);
  }

  function buildInstallerSkillSourceArgv(source) {
    const resolvedSource = String(source || '').trim();
    const defaultSource = resolveInstallerDefaultSkillSource();
    if (resolvedSource && resolvedSource === defaultSource.location) {
      return defaultSkillSourceHelpers.buildSkillSourceInstallArgv(defaultSource);
    }
    return [resolvedSource];
  }

  function previewInteractiveSkillSource(source, selectedSkillNames) {
    const previewer = getSkillSourcePreviewer();
    const argv = [...buildInstallerSkillSourceArgv(source), '--scope', 'project'];
    (Array.isArray(selectedSkillNames) ? selectedSkillNames : []).forEach(name => {
      argv.push('--skill', name);
    });
    return Promise.resolve(previewer(argv));
  }

  function previewInteractiveWorkflowSource(source, options = {}) {
    const previewer = getWorkflowSourcePreviewer();
    return Promise.resolve(previewer(source, options));
  }

  function formatInteractiveWorkflowSourceWarning(error) {
    const message = String(error && error.message ? error.message : '').trim();
    if (/Workflow registry source must be a non-empty string/i.test(message)) {
      return 'That spec source is not valid. Enter another source or type `skip` to continue without external specs.';
    }
    if (/Workflow registry not found under source root/i.test(message)) {
      return 'That source does not publish emb-agent specs. Enter another source or type `skip` to continue without external specs.';
    }
    if (/Workflow registry source was not found or is not accessible\./i.test(message)) {
      return 'That spec source was not found or is not accessible. Enter another source or type `skip` to continue without external specs.';
    }
    if (/Could not reach workflow registry source\. Check your network connection and try again\./i.test(message)) {
      return 'That spec source cannot be reached right now. Check the network connection, enter another source, or type `skip` to continue without external specs.';
    }
    if (/Workflow registry source download timed out\./i.test(message)) {
      return 'That spec source timed out while loading. Enter another source or type `skip` to continue without external specs.';
    }
    if (/required local dependency is not available in this environment/i.test(message)) {
      return 'That spec source cannot be inspected from this environment right now. Enter another source or type `skip` to continue without external specs.';
    }
    if (/Failed to clone workflow registry source|Could not download workflow registry source/i.test(message)) {
      return 'That spec source could not be inspected right now. Enter another source or type `skip` to continue without external specs.';
    }
    return message || 'Could not inspect that spec source. Enter another source or type `skip` to continue without external specs.';
  }

  function formatInteractiveSkillSourceWarning(error) {
    const message = String(error && error.message ? error.message : '').trim();
    if (/Skill source path does not exist:/i.test(message)) {
      return 'That skill source path was not found. Enter another source or type `skip` to continue without initial skills.';
    }
    if (/No installable skill bundle was found under /i.test(message)) {
      return 'That source does not publish an emb-agent skill bundle. Enter another source or type `skip` to continue without initial skills.';
    }
    if (/does not expose skill\(s\):/i.test(message)) {
      return message;
    }
    if (/Skill source was not found or is not accessible\./i.test(message)) {
      return 'That skill source was not found or is not accessible. Enter another source or type `skip` to continue without initial skills.';
    }
    if (/Could not reach skill source\. Check your network connection and try again\./i.test(message)) {
      return 'That skill source cannot be reached right now. Check the network connection, enter another source, or type `skip` to continue without initial skills.';
    }
    if (/Skill source download timed out\./i.test(message)) {
      return 'That skill source timed out while loading. Enter another source or type `skip` to continue without initial skills.';
    }
    if (/required local dependency is not available in this environment/i.test(message)) {
      return 'That skill source cannot be inspected from this environment right now. Enter another source or type `skip` to continue without initial skills.';
    }
    if (/git clone failed|npm install failed|pip install failed/i.test(message)) {
      return 'That skill source could not be inspected right now. Enter another source or type `skip` to continue without initial skills.';
    }
    return message || 'Could not inspect that skill source. Enter another source or type `skip` to continue without initial skills.';
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

    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      let answered = false;
      let settled = false;

      function resolveOnce(value) {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      }

      function rejectOnce(error) {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      }

      rl.on('close', () => {
        if (!answered) {
          rejectOnce(new Error(INTERACTIVE_CANCELLED_MESSAGE));
        }
      });
      rl.on('SIGINT', () => {
        answered = false;
        rl.close();
        rejectOnce(new Error(INTERACTIVE_CANCELLED_MESSAGE));
      });

      rl.question(question, answer => {
        answered = true;
        rl.close();
        resolveOnce(String(answer || '').trim());
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
        const interactiveWorkflows =
        location === 'local'
          ? resolveInteractiveWorkflowArgs(prompted)
          : { registry: '', registryBranch: '', registrySubdir: '', specs: [] };
      const interactiveSkills = resolveInteractiveSkillArgs(prompted);
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
        registry: interactiveWorkflows.registry,
        registryBranch: interactiveWorkflows.registryBranch,
        registrySubdir: interactiveWorkflows.registrySubdir,
        specs: interactiveWorkflows.specs,
        skillSources: interactiveSkills.skillSources,
        skillNames: interactiveSkills.skillNames,
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

    let registry = '';
    let registryBranch = '';
    let registrySubdir = '';
    let specs = [];
    let resolvedWorkflowPreview = null;
    let skipWorkflowImport = false;

    async function promptForWorkflowSourceOverride() {
      const defaultWorkflowSource = resolveInstallerDefaultWorkflowSource();

      while (!resolvedWorkflowPreview) {
        const workflowSourceInput = await promptLine(buildInteractiveWorkflowSourcePrompt(defaultWorkflowSource));
        const normalizedInput = String(workflowSourceInput || '').trim();
        if (normalizedInput.toLowerCase() === 'skip') {
          skipWorkflowImport = true;
          return;
        }

        const sourceConfig = buildInstallerWorkflowSourceConfig(normalizedInput, {});
        try {
          resolvedWorkflowPreview = await previewInteractiveWorkflowSource(sourceConfig.location, {
            branch: sourceConfig.branch,
            subdir: sourceConfig.subdir
          });

          registry = sourceConfig.location;
          registryBranch = sourceConfig.branch;
          registrySubdir = sourceConfig.subdir;
          writePromptConfirmation('Spec source:', registry);
          writePromptConfirmation(
            'Available specs:',
            `${resolvedWorkflowPreview.specs.length} selectable spec${resolvedWorkflowPreview.specs.length === 1 ? '' : 's'}`
          );
        } catch (error) {
          writePromptWarning(formatInteractiveWorkflowSourceWarning(error));
        }
      }
    }

    if (isLocal) {
      const defaultWorkflowSource = resolveInstallerDefaultWorkflowSource();

      try {
        resolvedWorkflowPreview = await previewInteractiveWorkflowSource(defaultWorkflowSource.location, {
          branch: defaultWorkflowSource.branch,
          subdir: defaultWorkflowSource.subdir
        });
        registry = defaultWorkflowSource.location;
        registryBranch = defaultWorkflowSource.branch;
        registrySubdir = defaultWorkflowSource.subdir;
        writePromptConfirmation('Spec source:', registry);
        writePromptConfirmation(
          'Available specs:',
          `${resolvedWorkflowPreview.specs.length} selectable spec${resolvedWorkflowPreview.specs.length === 1 ? '' : 's'}`
        );
      } catch (error) {
        writePromptWarning(formatInteractiveWorkflowSourceWarning(error));
        await promptForWorkflowSourceOverride();
      }

      while (resolvedWorkflowPreview && !skipWorkflowImport) {
        if (
          supportsInteractiveSkillSelectionKeyboardUi() &&
          Array.isArray(resolvedWorkflowPreview.specs) &&
          resolvedWorkflowPreview.specs.length > 1
        ) {
          const selectedSpecs = await promptInteractiveWorkflowSelectionWithKeys(resolvedWorkflowPreview, {
            allow_source_change: true
          });
          if (selectedSpecs === INTERACTIVE_SELECTION_CHANGE_SOURCE) {
            resolvedWorkflowPreview = null;
            registry = '';
            registryBranch = '';
            registrySubdir = '';
            specs = [];
            await promptForWorkflowSourceOverride();
            continue;
          }
          if (selectedSpecs === null) {
            skipWorkflowImport = true;
            break;
          }
          specs = selectedSpecs;
          writePromptConfirmation('Spec selection:', specs.join(', '));
          break;
        }

        try {
          const selectionInput = await promptLine(
            buildInteractiveWorkflowSelectionPrompt(resolvedWorkflowPreview, {
              allow_source_change: true
            })
          );
          const normalizedSelectionInput = String(selectionInput || '').trim().toLowerCase();
          if (!normalizedSelectionInput || normalizedSelectionInput === 'skip') {
            skipWorkflowImport = true;
            break;
          }
          if (normalizedSelectionInput === 'source') {
            resolvedWorkflowPreview = null;
            registry = '';
            registryBranch = '';
            registrySubdir = '';
            specs = [];
            await promptForWorkflowSourceOverride();
            continue;
          }

          const selectedSpecs = parseInteractiveWorkflowSelection(selectionInput, resolvedWorkflowPreview);
          if (selectedSpecs === null) {
            skipWorkflowImport = true;
            break;
          }
          specs = selectedSpecs;
          writePromptConfirmation(
            'Spec selection:',
            specs.length > 0 ? specs.join(', ') : 'all selectable specs'
          );
          break;
        } catch (error) {
          writePromptWarning(error.message);
        }
      }

      if (!resolvedWorkflowPreview || skipWorkflowImport) {
        registry = '';
        registryBranch = '';
        registrySubdir = '';
        specs = [];
        writePromptConfirmation('Specs:', 'Skip external spec import');
      }
    }

    let skillSources = [];
    let skillNames = [];
    let resolvedPreview = null;
    let skipInitialSkills = false;

    async function promptForSkillSourceOverride() {
      while (!resolvedPreview) {
        const skillSourceInput = await promptLine(buildInteractiveSkillSourcePrompt());
        const normalizedInput = String(skillSourceInput || '').trim();
        if (normalizedInput.toLowerCase() === 'skip') {
          skipInitialSkills = true;
          return;
        }

        const skillSource = normalizedInput || DEFAULT_SKILL_SOURCE_LOCATION;
        try {
          resolvedPreview = await previewInteractiveSkillSource(skillSource, []);
          skillSources = [skillSource];
          writePromptConfirmation('Skill source:', skillSource);
          writePromptConfirmation(
            'Skill bundle:',
            `${resolvedPreview.plugin.name} (${resolvedPreview.skills.length} skill${resolvedPreview.skills.length === 1 ? '' : 's'})`
          );
        } catch (error) {
          writePromptWarning(formatInteractiveSkillSourceWarning(error));
        }
      }
    }

    try {
      resolvedPreview = await previewInteractiveSkillSource(DEFAULT_SKILL_SOURCE_LOCATION, []);
      skillSources = [DEFAULT_SKILL_SOURCE_LOCATION];
      writePromptConfirmation('Skill source:', DEFAULT_SKILL_SOURCE_LOCATION);
      writePromptConfirmation(
        'Skill bundle:',
        `${resolvedPreview.plugin.name} (${resolvedPreview.skills.length} skill${resolvedPreview.skills.length === 1 ? '' : 's'})`
      );
    } catch (error) {
      writePromptWarning(formatInteractiveSkillSourceWarning(error));
      await promptForSkillSourceOverride();
    }

    while (resolvedPreview && !skipInitialSkills) {
      if (supportsInteractiveSkillSelectionKeyboardUi()) {
        const selectedSkillNames = await promptInteractiveSkillSelectionWithKeys(resolvedPreview, {
          allow_source_change: true
        });
        if (selectedSkillNames === INTERACTIVE_SELECTION_CHANGE_SOURCE) {
          resolvedPreview = null;
          skillSources = [];
          skillNames = [];
          await promptForSkillSourceOverride();
          continue;
        }
        if (selectedSkillNames === null) {
          skipInitialSkills = true;
          break;
        }
        skillNames = selectedSkillNames;
        writePromptConfirmation('Skill selection:', skillNames.join(', '));
        break;
      }

      try {
        const selectionInput = await promptLine(
          buildInteractiveSkillSelectionPrompt(resolvedPreview, {
            allow_source_change: true
          })
        );
        const normalizedSelectionInput = String(selectionInput || '').trim().toLowerCase();
        if (!normalizedSelectionInput || normalizedSelectionInput === 'skip') {
          skipInitialSkills = true;
          break;
        }
        if (normalizedSelectionInput === 'source') {
          resolvedPreview = null;
          skillSources = [];
          skillNames = [];
          await promptForSkillSourceOverride();
          continue;
        }

        const selectedSkillNames = parseInteractiveSkillSelection(selectionInput, resolvedPreview);
        if (selectedSkillNames === null) {
          skipInitialSkills = true;
          break;
        }
        skillNames = selectedSkillNames;
        writePromptConfirmation(
          'Skill selection:',
          skillNames.length > 0 ? skillNames.join(', ') : 'all published skills'
        );
        break;
      } catch (error) {
        writePromptWarning(error.message);
      }
    }

    if (!resolvedPreview || skipInitialSkills) {
      skillSources = [];
      skillNames = [];
      writePromptConfirmation('Skills:', 'Skip initial bundle install');
    }

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
      registry,
      registryBranch,
      registrySubdir,
      specs,
      skillSources,
      skillNames,
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
    if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
      return;
    }
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

  function installRuntimeDependencies(runtimeDir) {
    const sourceNodeModulesDir = path.join(path.resolve(runtimeSrc, '..'), 'node_modules');
    if (!fs.existsSync(sourceNodeModulesDir)) {
      throw new Error(`Runtime dependencies are not installed under: ${sourceNodeModulesDir}`);
    }

    copyDir(sourceNodeModulesDir, path.join(runtimeDir, 'node_modules'));
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
    const guardrails = buildCodexSkillGuardrails(commandName, runtimeCli);

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
      ...(guardrails.length > 0
        ? [
            '',
            '## Guardrails',
            '',
            ...guardrails
          ]
        : []),
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
    const guardrails = buildCodexSkillGuardrails(commandName, runtimeCli);

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
      ...(guardrails.length > 0
        ? [
            '',
            '## Guardrails',
            '',
            ...guardrails
          ]
        : []),
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

  function buildCodexSkillGuardrails(commandName, runtimeCli) {
    const startBrief = `${runtimeCli} start --brief`;
    const nextBrief = `${runtimeCli} next --brief`;

    if (commandName === 'start') {
      return [
        `- Prefer \`${startBrief}\` as the first routing check when you only need the shortest safe next action.`,
        '- Treat `immediate.command` as authoritative. If it is not `next`, do that first instead of chaining directly into workflow capabilities.',
        '- If `task_intake.recommended_entry` is present and there is no active task, create and activate the task before mutation work.'
      ];
    }

    if (commandName === 'next') {
      return [
        `- Before forcing \`${commandName}\`, run \`${startBrief}\` whenever bootstrap, source intake, or task state might still be unresolved.`,
        '- If `start --brief` returns an `immediate.command` other than `next`, follow that command first. Do not use `$emb-next` to bypass source intake, bootstrap, or task intake.',
        `- After the entry route is clear, run \`${nextBrief}\` and obey the returned recommendation.`,
        '- If `next.gated_by_health` is `true` or `next.command` is `health`, close the health blocker first instead of continuing into workflow capabilities.'
      ];
    }

    return [];
  }

  function installSharedCodexSkills(targetDir, target, runtimeDir, args) {
    if (!target || target.name !== 'codex' || !(args && args.local)) {
      return 0;
    }

    const skillsRoot = path.join(path.resolve(targetDir, '..'), '.agents', 'skills');
    for (const skillName of listManagedCodexSkillNames()) {
      removeDirIfExists(path.join(skillsRoot, skillName));
    }
    removeDirIfEmpty(skillsRoot);
    removeDirIfEmpty(path.dirname(skillsRoot));
    return 0;
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
    copyDir(path.join(path.resolve(runtimeSrc, '..'), 'skills'), path.join(runtimeDir, 'skills'));
    copyDir(path.join(runtimeSrc, 'specs'), path.join(runtimeDir, 'specs'));
    copyDir(path.join(runtimeSrc, 'tools'), runtimeToolsDir);
    copyDir(path.join(runtimeSrc, 'chips'), runtimeChipsDir);
    installRuntimeDependencies(runtimeDir);
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
    if (args.registry) {
      initArgs.push('--registry', args.registry);
    }
    if (args.registryBranch) {
      initArgs.push('--registry-branch', args.registryBranch);
    }
    if (args.registrySubdir) {
      initArgs.push('--registry-subdir', args.registrySubdir);
    }
    (Array.isArray(args.specs) ? args.specs : []).forEach(name => {
      initArgs.push('--spec', name);
    });

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
      specs: workflowSetup.activeSpecs
    };
    const projectConfig = initProject.buildProjectConfig(projectRoot, resolvedInitArgs, {
      workflowCatalog: workflowSetup.workflowCatalog,
      activeSpecs: workflowSetup.activeSpecs
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

      writeTerminalLine('');
      writeTerminalLine(
        `${chalk.bold(chalk.cyan('  ╭──────────────────────────────────────────╮'))}`
      );
      writeTerminalLine(
        `${chalk.bold(chalk.cyan('  │'))}  ${chalk.bold('emb-agent')} ${chalk.dim(`v${packageVersion}`)}  ${chalk.dim('— hardware-first AI workflow')}  ${chalk.bold(chalk.cyan('│'))}`
      );
      writeTerminalLine(
        `${chalk.bold(chalk.cyan('  ╰──────────────────────────────────────────╯'))}`
      );
      writeTerminalLine('');
      writeTerminalLine(`${chalk.cyan('  Runtime:')}  ${chalk.white(target.label)}`);
      writeTerminalLine(`${chalk.cyan('  Location:')} ${chalk.white(args.local ? 'project (local)' : 'global config')}`);
      writeTerminalLine(`${chalk.cyan('  Target:')}   ${chalk.dim(targetDir)}`);
      writeTerminalLine(`${chalk.cyan('  Profile:')}  ${chalk.white(installProfile.name)}`);
      if (args.developer) {
        writeTerminalLine(`${chalk.cyan('  Developer:')} ${chalk.white(args.developer)}`);
      }
      if (args.subagentBridgeCmd) {
        writeTerminalLine(
          `${chalk.cyan('  Bridge:')}   ${chalk.dim(args.subagentBridgeCmd)} (${args.subagentBridgeTimeoutMs} ms)`
        );
      }
      writeTerminalLine('');
    }

    function complete(target, runtimeDir, projectBootstrap, installProfile) {
      if (!ui || !ui.enabled) {
        return;
      }

      writeTerminalLine('');
      writeTerminalLine(chalk.bold(chalk.green('  ✔ Installation complete')));
      writeTerminalLine('');
      writeTerminalLine(chalk.dim('  ── Installed ──'));
      writeTerminalLine(`${chalk.green('  ●')} ${chalk.white('Runtime')}        ${chalk.dim(runtimeDir)}`);
      writeTerminalLine(`${chalk.green('  ●')} ${chalk.white('Host config')}     ${chalk.dim(path.join(targetDir, target.configFileName || 'config.toml'))}`);
      if (target.hookMode === 'codex-json') {
        writeTerminalLine(`${chalk.green('  ●')} ${chalk.white('Hooks')}          ${chalk.dim(path.join(targetDir, target.hooksConfigFileName || 'hooks.json'))}`);
      }
      if (projectBootstrap && projectBootstrap.bootstrap_task && projectBootstrap.bootstrap_task.path) {
        writeTerminalLine(`${chalk.green('  ●')} ${chalk.white('Project')}        ${chalk.dim(projectBootstrap.project_root)}`);
      }
      writeTerminalLine('');
      writeTerminalLine(chalk.dim('  ── Next steps ──'));
      writeTerminalLine(`  ${chalk.cyan('1.')} Restart ${chalk.white(target.restartLabel || target.label)} to pick up new commands and hooks`);
      writeTerminalLine(`  ${chalk.cyan('2.')} Open a project session — startup context injects automatically`);
      if (projectBootstrap) {
        writeTerminalLine(`  ${chalk.cyan('3.')} Follow the recommended next command from the injected context`);
      }
      writeTerminalLine('');
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

  async function installInitialSkills(runtimeDir, args) {
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

    return Promise.all(
      sources.map(source => installedRuntime.installSkillSource([...buildInstallerSkillSourceArgv(source), ...sharedArgs]))
    );
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
      const uninstallActivity = reporter.activity('Removing managed files');
      try {
        uninstall(targetDir, target, args);
        uninstallActivity.succeed('Managed files removed');
      } catch (error) {
        uninstallActivity.fail('Removing managed files', error);
        throw error;
      }
      reporter.removed(target, targetDir);
      process.stdout.write(`Uninstalled emb-agent managed files for ${target.label} from: ${targetDir}\n`);
      return;
    }

    const runtimeActivity = reporter.activity('Preparing runtime files');
    let runtimeDir;
    try {
      runtimeDir = installRuntime(targetDir, target, args);
      runtimeActivity.succeed('Runtime files ready');
    } catch (error) {
      runtimeActivity.fail('Installing emb-agent runtime files', error);
      throw error;
    }
    const installedRuntimeHost = runtimeHost.resolveRuntimeHost(runtimeDir);
    const integrationActivity = reporter.activity('Setting up host integration (agents, hooks, commands)');
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
          ? `Host integration ready (${installedSurfaceCount} artifacts)`
          : 'Host integration metadata installed'
      );
    } catch (error) {
      integrationActivity.fail('Installing host agents, hooks, and commands', error);
      throw error;
    }

    const envActivity = reporter.activity('Writing .env.example');
    const envExamplePath = path.join(args.local ? process.cwd() : targetDir, '.env.example');
    let envExampleCreated;
    try {
      envExampleCreated = installEnvExample(envExamplePath);
      envActivity.succeed(envExampleCreated ? '.env.example created' : '.env.example kept');
    } catch (error) {
      envActivity.fail('Preparing local environment template', error);
      throw error;
    }

    let projectBootstrap = null;
    if (args.local) {
      const bootstrapActivity = reporter.activity('Bootstrapping project scaffold (.emb-agent/)');
      try {
        projectBootstrap = bootstrapProjectIfNeeded(args);
        bootstrapActivity.succeed(
          projectBootstrap ? 'Project scaffold ready' : 'Project scaffold skipped (already exists)'
        );
      } catch (error) {
        bootstrapActivity.fail('Bootstrapping local emb-agent project', error);
        throw error;
      }
    }

    let installedSkillBundles = [];
    if (Array.isArray(args.skillSources) && args.skillSources.length > 0) {
      const skillsActivity = reporter.activity('Installing skill bundles');
      try {
        installedSkillBundles = await installInitialSkills(runtimeDir, args);
        skillsActivity.succeed(
          installedSkillBundles.length > 0
            ? `${installedSkillBundles.length} skill bundle${installedSkillBundles.length > 1 ? 's' : ''} installed`
            : 'No skill bundles selected'
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
      ...(installedRuntimeHost.subagentBridge && installedRuntimeHost.subagentBridge.available
        ? [
            `Sub-agent bridge: ${installedRuntimeHost.subagentBridge.command} (timeout: ${installedRuntimeHost.subagentBridge.timeout_ms} ms)`
          ]
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
