#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const runtimeHostHelpers = require(path.join(ROOT, 'lib', 'runtime-host.cjs'));
const terminalUiHelpers = require(path.join(ROOT, 'lib', 'terminal-ui.cjs'));
const defaultWorkflowSourceHelpers = require(path.join(ROOT, 'lib', 'default-workflow-source.cjs'));
const workflowImportHelpers = require(path.join(ROOT, 'lib', 'workflow-import.cjs'));
const workflowRegistry = require(path.join(ROOT, 'lib', 'workflow-registry.cjs'));

const RUNTIME_CONFIG = runtime.loadRuntimeConfig(ROOT);
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHost(ROOT);
const workflowImport = workflowImportHelpers.createWorkflowImportHelpers({
  childProcess: require('child_process'),
  fs,
  os: require('os'),
  path,
  process,
  runtime,
  workflowRegistry
});
const BOOTSTRAP_TASK_NAME = '00-bootstrap-project';
const BOOTSTRAP_TASK_CHANNELS = ['implement', 'check', 'debug'];
const PROJECT_AGENTS_PATH = 'AGENTS.md';
const WORKTREE_CONFIG_PATH = path.join('.emb-agent', 'worktree.yaml');

function createPromptStyler(hostProcess) {
  const targetProcess = hostProcess || process;
  const ui = terminalUiHelpers.createTerminalUi({
    process: {
      env: targetProcess.env || process.env || {},
      argv: targetProcess.argv || process.argv || [],
      stdout: targetProcess.stdout || process.stdout,
      stderr: targetProcess.stdout || targetProcess.stderr || process.stderr
    }
  });

  return ui && ui.chalk
    ? ui.chalk
    : {
        blue: text => String(text),
        cyan: text => String(text),
        dim: text => String(text),
        gray: text => String(text),
        green: text => String(text),
        red: text => String(text),
        yellow: text => String(text),
        white: text => String(text),
        bold: text => String(text)
      };
}

function writePromptOutput(hostProcess, text) {
  const output = hostProcess && hostProcess.stdout ? hostProcess.stdout : process.stdout;
  if (!output || typeof output.write !== 'function') {
    return;
  }
  output.write(String(text || ''));
}

function isInteractivePromptAvailable(hostProcess) {
  const targetProcess = hostProcess || process;
  return Boolean(
    targetProcess &&
    targetProcess.stdin &&
    targetProcess.stdin.isTTY &&
    targetProcess.stdout &&
    targetProcess.stdout.isTTY
  );
}

function getInteractiveInputPath(hostProcess) {
  const targetProcess = hostProcess || process;
  if (targetProcess && targetProcess.platform) {
    return targetProcess.platform === 'win32' ? 'CONIN$' : '/dev/tty';
  }
  return process.platform === 'win32' ? 'CONIN$' : '/dev/tty';
}

function readInteractiveLineSync(hostProcess) {
  const inputPath = getInteractiveInputPath(hostProcess);
  const fd = fs.openSync(inputPath, 'rs');
  const buffer = Buffer.alloc(1);
  let collected = '';

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, 1, null);
      if (bytesRead <= 0) {
        break;
      }
      const char = buffer.toString('utf8', 0, bytesRead);
      if (char === '\n') {
        break;
      }
      if (char !== '\r') {
        collected += char;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return collected.trim();
}

function buildWorkflowSpecPrompt(entries, options = {}) {
  const hostProcess = options.process || process;
  const chalk = createPromptStyler(hostProcess);
  const choiceLines = [
    `  ${chalk.cyan('0.')} ${chalk.white('Skip for now')} ${chalk.gray('(continue without workflow specs)')}`
  ];

  entries.forEach((entry, index) => {
    const description = String(entry.description || '').trim();
    choiceLines.push(
      `  ${chalk.cyan(`${index + 1}.`)} ${chalk.white(entry.name)}${description ? ` ${chalk.gray(`- ${description}`)}` : ''}`
    );
  });

  return [
    chalk.cyan(chalk.bold('emb-agent init')),
    chalk.gray('  Select workflow specs for this project.'),
    chalk.gray('  Press Enter to continue without extra specs, or use comma-separated numbers for multiple specs.'),
    '',
    chalk.blue('▶ Select Workflow Specs'),
    '',
    ...choiceLines,
    '',
    chalk.yellow('Choice [0] > ')
  ].join('\n');
}

function parseWorkflowSpecSelection(answer, entries) {
  const trimmed = String(answer || '').trim();
  if (!trimmed || trimmed === '0') {
    return [];
  }

  const tokens = trimmed
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return [];
  }

  const names = [];

  tokens.forEach(token => {
    if (token === '0') {
      return;
    }

    const index = Number.parseInt(token, 10);
    if (!Number.isFinite(index) || index < 1 || index > entries.length) {
      throw new Error(`Invalid workflow spec selection: ${token}`);
    }

    names.push(entries[index - 1].name);
  });

  return runtime.unique(names);
}

function promptWorkflowSpecSelection(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length <= 1) {
    return [];
  }

  if (typeof options.promptWorkflowSpecChoices === 'function') {
    const prompted = options.promptWorkflowSpecChoices(entries);
    if (Array.isArray(prompted)) {
      return runtime.unique(prompted.map(item => String(item || '').trim()).filter(Boolean));
    }
    return parseWorkflowSpecSelection(prompted, entries);
  }

  const hostProcess = options.process || process;
  if (!isInteractivePromptAvailable(hostProcess)) {
    return [];
  }

  while (true) {
    writePromptOutput(hostProcess, `${buildWorkflowSpecPrompt(entries, options)}\n`);
    try {
      return parseWorkflowSpecSelection(readInteractiveLineSync(hostProcess), entries);
    } catch (error) {
      const chalk = createPromptStyler(hostProcess);
      writePromptOutput(hostProcess, `${chalk.yellow(`! ${error.message}`)}\n`);
    }
  }
}

function usage() {
  process.stdout.write(
    [
      'init-project usage:',
      '  node scripts/init-project.cjs',
      '  node scripts/init-project.cjs --project <repo-root>',
      '  node scripts/init-project.cjs --project <repo-root> --profile <name> [--spec <name> ...] [--runtime <external|codex|claude|cursor>|--external|--codex|--claude|--cursor] [-u <name>] [-r <source>] [--registry-branch <name>] [--registry-subdir <path>]',
      '  node scripts/init-project.cjs --force'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const result = {
    project: '',
    profile: '',
    specs: [],
    runtime: '',
    runtimeSet: false,
    user: '',
    userSet: false,
    registry: '',
    registryBranch: '',
    registrySubdir: '',
    force: false,
    help: false
  };

  function setRuntime(value, token) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      throw new Error(`Missing value after ${token}`);
    }
    if (!['external', 'codex', 'claude', 'cursor'].includes(normalized)) {
      throw new Error(`Unsupported runtime: ${value}`);
    }
    if (result.runtimeSet && result.runtime !== normalized) {
      throw new Error(`Conflicting runtime options: ${result.runtime} vs ${normalized}`);
    }
    result.runtime = normalized;
    result.runtimeSet = true;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--project') {
      result.project = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--profile') {
      result.profile = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--spec') {
      result.specs.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--runtime') {
      setRuntime(argv[index + 1] || '', '--runtime');
      index += 1;
      continue;
    }
    if (token === '--external') {
      setRuntime('external', '--external');
      continue;
    }
    if (token === '--codex') {
      setRuntime('codex', '--codex');
      continue;
    }
    if (token === '--claude') {
      setRuntime('claude', '--claude');
      continue;
    }
    if (token === '--cursor') {
      setRuntime('cursor', '--cursor');
      continue;
    }
    if (token === '--user' || token === '-u') {
      result.user = argv[index + 1] || '';
      result.userSet = true;
      index += 1;
      continue;
    }
    if (token === '--registry' || token === '-r') {
      result.registry = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--registry-branch') {
      result.registryBranch = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--registry-subdir') {
      result.registrySubdir = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--force') {
      result.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (argv.includes('--project') && !result.project) {
    throw new Error('Missing path after --project');
  }
  if (argv.includes('--profile') && !result.profile) {
    throw new Error('Missing name after --profile');
  }
  if (result.specs.includes('')) {
    throw new Error('Missing name after --spec');
  }
  if ((argv.includes('--user') || argv.includes('-u')) && !result.user) {
    throw new Error('Missing name after --user/-u');
  }
  if ((argv.includes('--registry') || argv.includes('-r')) && !result.registry) {
    throw new Error('Missing source after --registry/-r');
  }
  if (argv.includes('--registry-branch') && !result.registryBranch) {
    throw new Error('Missing name after --registry-branch');
  }
  if (argv.includes('--registry-subdir') && !result.registrySubdir) {
    throw new Error('Missing path after --registry-subdir');
  }

  return result;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeMonorepoPath(value) {
  return String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/g, '').replace(/\/+$/g, '');
}

function readPackageNameFromDir(projectRoot, relativeDir) {
  const packageJsonPath = path.join(projectRoot, relativeDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const parsed = runtime.readJson(packageJsonPath);
      const rawName = String(parsed.name || '').trim();
      if (rawName) {
        return rawName.split('/').pop();
      }
    } catch {}
  }

  return path.basename(relativeDir);
}

function detectPackageType(projectRoot, relativeDir) {
  if (fs.existsSync(path.join(projectRoot, relativeDir, 'package.json'))) {
    return 'node';
  }
  if (fs.existsSync(path.join(projectRoot, relativeDir, 'Cargo.toml'))) {
    return 'rust';
  }
  if (fs.existsSync(path.join(projectRoot, relativeDir, 'pyproject.toml'))) {
    return 'python';
  }
  if (fs.existsSync(path.join(projectRoot, relativeDir, 'go.mod'))) {
    return 'go';
  }
  return 'unknown';
}

function expandWorkspacePattern(projectRoot, pattern) {
  const normalized = normalizeMonorepoPath(pattern);
  if (!normalized || normalized === '.') {
    return [];
  }

  if (!normalized.includes('*')) {
    const absolutePath = path.join(projectRoot, normalized);
    return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()
      ? [normalized]
      : [];
  }

  if (!normalized.endsWith('/*')) {
    return [];
  }

  const baseDir = normalized.slice(0, -2);
  const absoluteBaseDir = path.join(projectRoot, baseDir);
  if (!fs.existsSync(absoluteBaseDir) || !fs.statSync(absoluteBaseDir).isDirectory()) {
    return [];
  }

  return fs.readdirSync(absoluteBaseDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => normalizeMonorepoPath(path.posix.join(baseDir, entry.name)));
}

function parseGitmodules(projectRoot) {
  const gitmodulesPath = path.join(projectRoot, '.gitmodules');
  if (!fs.existsSync(gitmodulesPath)) {
    return [];
  }

  const matches = [];
  const content = fs.readFileSync(gitmodulesPath, 'utf8');
  const pattern = /^\s*path\s*=\s*(.+)\s*$/gm;
  let match = pattern.exec(content);
  while (match) {
    matches.push(normalizeMonorepoPath(match[1]));
    match = pattern.exec(content);
  }
  return matches.filter(Boolean);
}

function detectMonorepoPackages(projectRoot) {
  const byPath = new Map();
  const submodulePaths = new Set(parseGitmodules(projectRoot));

  function addPackage(relativeDir) {
    const normalizedPath = normalizeMonorepoPath(relativeDir);
    if (!normalizedPath || normalizedPath === '.' || byPath.has(normalizedPath)) {
      return;
    }
    const absolutePath = path.join(projectRoot, normalizedPath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
      return;
    }

    byPath.set(normalizedPath, {
      name: readPackageNameFromDir(projectRoot, normalizedPath),
      path: normalizedPath,
      type: detectPackageType(projectRoot, normalizedPath),
      submodule: submodulePaths.has(normalizedPath)
    });
  }

  const pnpmWorkspacePath = path.join(projectRoot, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmWorkspacePath)) {
    const parsed = runtime.parseSimpleYaml(pnpmWorkspacePath);
    const packages = Array.isArray(parsed.packages) ? parsed.packages : [];
    packages.forEach(pattern => {
      expandWorkspacePattern(projectRoot, pattern).forEach(addPackage);
    });
  }

  const packageJsonPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const parsed = runtime.readJson(packageJsonPath);
      const workspaces = Array.isArray(parsed.workspaces)
        ? parsed.workspaces
        : Array.isArray(parsed.workspaces && parsed.workspaces.packages)
          ? parsed.workspaces.packages
          : [];
      workspaces.forEach(pattern => {
        expandWorkspacePattern(projectRoot, pattern).forEach(addPackage);
      });
    } catch {}
  }

  submodulePaths.forEach(addPackage);

  const packages = Array.from(byPath.values())
    .sort((left, right) => left.path.localeCompare(right.path));
  const defaultPackage =
    packages.find(item => item.submodule !== true) ||
    packages[0] ||
    null;

  return {
    packages,
    default_package: defaultPackage ? defaultPackage.name : ''
  };
}

function loadBuiltInProfile(name) {
  return runtime.validateProfile(
    name,
    runtime.parseSimpleYaml(path.join(ROOT, 'profiles', `${name}.yaml`))
  );
}

function loadWorkflowCatalog(projectRoot) {
  return workflowRegistry.loadWorkflowRegistry(ROOT, {
    projectExtDir: runtime.getProjectExtDir(projectRoot)
  });
}

function listCatalogSpecNames(workflowCatalog) {
  return new Set(
    ((workflowCatalog && workflowCatalog.specs) || [])
      .map(item => String(item && item.name ? item.name : '').trim())
      .filter(Boolean)
  );
}

function findMissingExplicitWorkflowSpecs(workflowCatalog, explicitSpecs) {
  if (!Array.isArray(explicitSpecs) || explicitSpecs.length === 0) {
    return [];
  }

  const known = listCatalogSpecNames(workflowCatalog);
  return explicitSpecs.filter(name => !known.has(name));
}

function shouldAttemptDefaultWorkflowImport(initOptions, options, workflowCatalog, explicitSpecs) {
  if (initOptions.registry) {
    return false;
  }

  if (findMissingExplicitWorkflowSpecs(workflowCatalog, explicitSpecs).length > 0) {
    return true;
  }

  const selectableSpecs = (workflowCatalog.specs || []).filter(item => item.selectable === true);
  if (selectableSpecs.length > 0) {
    return false;
  }

  return typeof options.promptWorkflowSpecChoices === 'function' ||
    isInteractivePromptAvailable(options.process || process);
}

function prepareProjectWorkflowSetup(projectRoot, args, options = {}) {
  const initOptions = args || {};
  runtime.initProjectLayout(projectRoot);

  let workflowRegistryImport = initOptions.registry
    ? workflowImport.importProjectWorkflowRegistry(projectRoot, initOptions.registry, {
        branch: initOptions.registryBranch,
        subdir: initOptions.registrySubdir,
        project_profile: initOptions.profile,
        selected_specs: initOptions.specs,
        force: options.force === true || initOptions.force === true
      })
    : null;
  const explicitSpecs = runtime.unique(((initOptions.specs || [])).filter(Boolean));
  let workflowCatalog = loadWorkflowCatalog(projectRoot);
  const missingExplicitSpecs = findMissingExplicitWorkflowSpecs(workflowCatalog, explicitSpecs);

  if (shouldAttemptDefaultWorkflowImport(initOptions, options, workflowCatalog, explicitSpecs)) {
    const defaultWorkflowSource = defaultWorkflowSourceHelpers.resolveDefaultWorkflowSource(
      RUNTIME_CONFIG,
      process.env
    );

    try {
      workflowRegistryImport = workflowImport.importProjectWorkflowRegistry(
        projectRoot,
        defaultWorkflowSource.location,
        {
          branch: defaultWorkflowSource.branch,
          subdir: defaultWorkflowSource.subdir,
          project_profile: initOptions.profile,
          selected_specs: initOptions.specs,
          force: options.force === true || initOptions.force === true
        }
      );
      workflowCatalog = loadWorkflowCatalog(projectRoot);
    } catch (error) {
      if (missingExplicitSpecs.length > 0) {
        const label = missingExplicitSpecs.length === 1 ? 'spec' : 'specs';
        throw new Error(
          `Could not load required workflow ${label} (${missingExplicitSpecs.join(', ')}) from the default workflow source: ${error.message}`
        );
      }
    }
  }

  const remainingMissingSpecs = findMissingExplicitWorkflowSpecs(workflowCatalog, explicitSpecs);
  if (remainingMissingSpecs.length > 0) {
    const label = remainingMissingSpecs.length === 1 ? 'spec' : 'specs';
    throw new Error(`Workflow ${label} not found: ${remainingMissingSpecs.join(', ')}`);
  }

  const selectableSpecs = (workflowCatalog.specs || []).filter(item => item.selectable === true);
  const activeSpecs = explicitSpecs.length > 0
    ? explicitSpecs
    : promptWorkflowSpecSelection(selectableSpecs, options);

  return {
    workflowCatalog,
    workflowRegistryImport,
    activeSpecs
  };
}

function loadSelectableSpecForProject(projectRoot, name, registry) {
  const catalog = registry || loadWorkflowCatalog(projectRoot);
  const entry = (catalog.specs || []).find(item => item.name === name);
  if (!entry || entry.selectable !== true) {
    throw new Error(`Selectable spec not found: ${name}`);
  }
  return entry;
}

function ensureSelectableSpecExists(projectRoot, name, registry) {
  const entry = loadSelectableSpecForProject(projectRoot, name, registry);
  if (!entry || !entry.absolute_path) {
    throw new Error(`Spec not found: ${name}`);
  }
  return entry;
}

function buildTemplateIndex(registry) {
  const templates = (registry && Array.isArray(registry.templates)) ? registry.templates : [];
  const byName = {};
  const byOutput = {};

  templates.forEach(entry => {
    if (!entry || !entry.name || !entry.absolute_path) {
      return;
    }
    byName[entry.name] = entry;
    if (entry.default_output) {
      byOutput[entry.default_output] = entry.name;
    }
  });

  return {
    byName,
    byOutput
  };
}

function applyTemplate(content, context) {
  return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(context, key) ? String(context[key]) : '';
  });
}

function buildTemplateContext(projectRoot, projectConfig) {
  const developer = runtime.validateDeveloperConfig(projectConfig.developer || {});
  return {
    DATE: new Date().toISOString().slice(0, 10),
    PROJECT_NAME: path.basename(projectRoot),
    BOARD_NAME: '',
    MCU_NAME: '',
    TARGET_NAME: '',
    PROFILE: projectConfig.project_profile,
    SPECS: projectConfig.active_specs.join(','),
    VERSION: String(RUNTIME_CONFIG.session_version || 1),
    SLUG: 'new-item',
    RUNTIME_MODEL: 'main_loop_plus_isr',
    CONCURRENCY_MODEL: 'interrupt_shared_state',
    RESOURCE_1: 'rom',
    RESOURCE_2: 'ram',
    SEARCH_1: 'hardware_truth',
    SEARCH_2: 'entry_points',
    GUARDRAIL_1: 'thin_isr',
    GUARDRAIL_2: 'prefer_direct_state',
    AXIS_1: 'timing_path',
    AXIS_2: 'shared_state',
    NOTE_TARGET_1: 'docs/DEBUG-NOTES.md',
    NOTE_TARGET_2: 'docs/HARDWARE-LOGIC.md',
    AGENT_1: 'hw-scout',
    AGENT_2: 'fw-doer',
    FOCUS_1: 'timing',
    FOCUS_2: 'signal_integrity',
    SIGNAL_1: 'INPUT_1',
    PIN_1: 'PA0',
    DIR_1: 'input',
    STATE_1: 'pull-high',
    NOTE_1: '',
    SIGNAL_2: 'OUTPUT_1',
    PIN_2: 'PA1',
    DIR_2: 'output',
    STATE_2: 'low',
    NOTE_2: '',
    GOAL_1: 'Define the first deliverable target for the current project',
    FEATURE_1: 'Complete the most critical board-level behavior or feature closure',
    REQ_CONSTRAINT_1: 'Prefer reusing the existing codebase and hardware truth before expanding architecture',
    ACCEPTANCE_1: 'The current goal can be confirmed at board level or through a minimal verification path',
    FAILURE_POLICY_1: 'When hardware or requirements are unconfirmed, record an unknown first instead of guessing',
    REQ_UNKNOWN_1: 'Customer or production requirements still need confirmation',
    DEVELOPER_NAME: developer.name,
    DEVELOPER_RUNTIME: developer.runtime
  };
}

function createTemplateFile(templateName, outputPath, context, force, templatesByName) {
  const meta =
    templatesByName && Object.prototype.hasOwnProperty.call(templatesByName, templateName)
      ? templatesByName[templateName]
      : null;
  if (!meta || !meta.absolute_path) {
    throw new Error(`Template not found: ${templateName}`);
  }

  if (fs.existsSync(outputPath) && !force) {
    return false;
  }

  const content = applyTemplate(
    runtime.readText(meta.absolute_path),
    context
  );
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, content, 'utf8');
  return true;
}

function buildProjectConfig(projectRoot, args, options = {}) {
  const project_profile = args.profile || '';
  if (project_profile) {
    loadBuiltInProfile(project_profile);
  }
  runtime.initProjectLayout(projectRoot);
  const workflowCatalog = options.workflowCatalog || loadWorkflowCatalog(projectRoot);
  const monorepo = detectMonorepoPackages(projectRoot);
  const active_specs = runtime.unique(
    (Array.isArray(options.activeSpecs) ? options.activeSpecs : args.specs || []).filter(Boolean)
  );

  active_specs.forEach(name => ensureSelectableSpecExists(projectRoot, name, workflowCatalog));

  return runtime.validateProjectConfig(
      {
        project_profile,
        active_specs,
      packages: monorepo.packages,
      default_package: monorepo.default_package,
      active_package: monorepo.default_package,
      chip_support_sources: [],
      executors: {},
      quality_gates: {
        required_skills: [],
        required_executors: [],
        required_signoffs: []
      },
      developer: {
        name: args.user || (RUNTIME_CONFIG.developer && RUNTIME_CONFIG.developer.name) || '',
        runtime: args.runtime || (RUNTIME_CONFIG.developer && RUNTIME_CONFIG.developer.runtime) || ''
      },
      preferences: RUNTIME_CONFIG.default_preferences,
      arch_review: {
        trigger_patterns: []
      },
      integrations: {
        mineru: {
          mode: 'auto',
          base_url: '',
          api_key: '',
          api_key_env: 'MINERU_API_KEY',
          model_version: '',
          language: 'ch',
          enable_table: true,
          is_ocr: false,
          enable_formula: true,
          poll_interval_ms: 3000,
          timeout_ms: 300000,
          auto_api_page_threshold: 12,
          auto_api_file_size_kb: 4096
        },
        szlcsc: {
          enabled: false,
          base_url: 'https://ips.lcsc.com',
          api_key: '',
          api_key_env: 'SZLCSC_API_KEY',
          api_secret: '',
          api_secret_env: 'SZLCSC_API_SECRET',
          match_type: 'fuzzy',
          page_size: 5,
          max_matches_per_component: 5,
          only_available: false,
          currency: '',
          timeout_ms: 15000
        }
      }
    },
    RUNTIME_CONFIG
  );
}

function ensureGitignoreRule(projectRoot, rule) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const normalizedRule = String(rule || '').trim().replace(/\\/g, '/');
  if (!normalizedRule) {
    return;
  }

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${normalizedRule}\n`, 'utf8');
    return;
  }

  const content = fs.readFileSync(gitignorePath, 'utf8');
  const lines = content.split(/\r?\n/).map(item => item.trim());
  if (lines.includes(normalizedRule)) {
    return;
  }

  const needsNewline = content.length > 0 && !content.endsWith('\n');
  fs.writeFileSync(
    gitignorePath,
    `${content}${needsNewline ? '\n' : ''}${normalizedRule}\n`,
    'utf8'
  );
}

function buildDocsPlan(projectRoot, projectConfig, registry) {
  const profile = projectConfig.project_profile
    ? loadBuiltInProfile(projectConfig.project_profile)
    : { notes_targets: [] };
  const workflowCatalog = registry || loadWorkflowCatalog(projectRoot);
  const selectedSpecs = projectConfig.active_specs.map(name => loadSelectableSpecForProject(projectRoot, name, workflowCatalog));
  const noteTargets = runtime.unique([
    ...(profile.notes_targets || []),
    ...selectedSpecs.flatMap(spec => spec.preferred_notes || [])
  ]);

  const { byOutput } = buildTemplateIndex(workflowCatalog);

  return noteTargets
    .map(target => ({
      output: target,
      template: byOutput[target] || ''
    }))
    .filter(item => item.template);
}

function buildTruthPlan() {
  return [
    { output: runtime.getProjectAssetRelativePath('hw.yaml'), template: 'hw-truth' },
    { output: runtime.getProjectAssetRelativePath('req.yaml'), template: 'req-truth' }
  ];
}

function buildProjectAgentsGuide() {
  return [
    '<!-- EMB-AGENT:START -->',
    '# emb-agent Instructions',
    '',
    'These instructions are for AI assistants working in this project.',
    '',
    'Use the `start` command when starting a new session to:',
    '- Initialize the project if needed',
    '- Understand current project truth',
    '- Get the shortest next step',
    '',
    'Use `.emb-agent/` to learn:',
    '- Project truth (`project.json`, `hw.yaml`, `req.yaml`)',
    '- Task workflow (`tasks/`)',
    '- Project-local specs (`specs/`)',
    '',
    "If you're using Codex, project-scoped helpers may also live in:",
    '- `.codex/skills/` for emb-agent command mirrors',
    '- `.codex/agents/` for optional custom agents',
    '',
    'When writing or routing work in this project:',
    '- Keep guidance hardware-first and name the real blocker.',
    '- Give the exact next command or file before adding extra structure.',
    '- Treat skills, hooks, and wrappers as integration surfaces; they must not override emb-agent runtime gates.',
    '- Avoid generic AI or project-management wording when a concrete board action, artifact, or truth file is known.',
    '',
    "Keep this managed block so future emb-agent updates can refresh the instructions.",
    '',
    '<!-- EMB-AGENT:END -->',
    ''
  ].join('\n');
}

function ensureProjectAgentsGuide(projectRoot, force) {
  const filePath = path.join(projectRoot, PROJECT_AGENTS_PATH);
  const existedBefore = fs.existsSync(filePath);

  if (existedBefore && !force) {
    return {
      path: PROJECT_AGENTS_PATH,
      created: false,
      updated: false,
      reused: true
    };
  }

  fs.writeFileSync(filePath, buildProjectAgentsGuide(), 'utf8');

  return {
    path: PROJECT_AGENTS_PATH,
    created: !existedBefore,
    updated: existedBefore && force,
    reused: false
  };
}

function buildDefaultWorktreeConfig() {
  return [
    '# emb-agent task worktree configuration',
    '# Relative paths are resolved from the project root',
    '',
    '# Worktree storage directory',
    'worktree_dir: ../emb-agent-worktrees',
    '',
    '# Files or directories to copy into each created worktree',
    'copy:',
    '  - .emb-agent/.developer',
    '',
    '# Commands to run after creating a worktree',
    'post_create:',
    '  # - npm install',
    '  # - pnpm install --frozen-lockfile',
    ''
  ].join('\n');
}

function ensureWorktreeConfig(projectRoot, force) {
  const filePath = path.join(projectRoot, WORKTREE_CONFIG_PATH);
  const existedBefore = fs.existsSync(filePath);

  if (existedBefore && !force) {
    return {
      path: WORKTREE_CONFIG_PATH,
      created: false,
      updated: false,
      reused: true
    };
  }

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buildDefaultWorktreeConfig(), 'utf8');

  return {
    path: WORKTREE_CONFIG_PATH,
    created: !existedBefore,
    updated: existedBefore && force,
    reused: false
  };
}

function buildBootstrapDocsPlan(projectRoot, projectConfig, registry) {
  return [
    { output: path.join('docs', 'MCU-FOUNDATION-CHECKLIST.md'), template: 'mcu-foundation-checklist' },
    ...buildDocsPlan(projectRoot, projectConfig, registry)
  ];
}

function buildTaskId(timestamp, slug) {
  const date = String(timestamp || new Date().toISOString()).slice(5, 10);
  return `${date.replace('-', '-')}-${slug}`;
}

function buildBootstrapTaskNotes(projectConfig, docsPlan) {
  const noteTargets = docsPlan.map(item => item.output);

  return [
    'Bootstrap checklist created by init-project.',
    'Init now creates the minimum emb-agent project skeleton first; note templates are deferred until you decide they are needed.',
    '',
    'Suggested order:',
    '1. Confirm goals and constraints in .emb-agent/req.yaml.',
    '2. If the chip/package are already known, record them in .emb-agent/hw.yaml. Otherwise leave hw.yaml unknown until a candidate is chosen.',
    '3. Fill only the note templates that matter for this project.',
    `4. Continue with ${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['next'])}.`,
    '',
    `Project profile: ${projectConfig.project_profile || '-'}`,
    `Active specs: ${projectConfig.active_specs.join(', ') || '-'}`,
    '',
    'Deferred note targets:',
    ...noteTargets.map(target => `- ${target}`)
  ].join('\n');
}

function buildBootstrapTaskSubtasks(docsPlan) {
  return [
    {
      name: 'Confirm goals and constraints in .emb-agent/req.yaml',
      status: 'pending'
    },
    {
      name: 'If already known, record chip and package in .emb-agent/hw.yaml',
      status: 'pending'
    },
    ...docsPlan.map(item => ({
      name: `Decide whether to create ${item.output}`,
      status: 'pending'
    }))
  ];
}

function writeJsonl(filePath, entries) {
  const lines = (entries || []).map(entry => JSON.stringify(entry));
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf8');
}

function ensureBootstrapTask(projectRoot, projectConfig, docsPlan, force) {
  const taskDir = path.join(runtime.getProjectExtDir(projectRoot), 'tasks', BOOTSTRAP_TASK_NAME);
  const taskPath = path.join(taskDir, 'task.json');
  const existedBefore = fs.existsSync(taskPath);
  const relatedFiles = runtime.unique([
    runtime.getProjectAssetRelativePath('hw.yaml'),
    runtime.getProjectAssetRelativePath('req.yaml'),
    ...docsPlan.map(item => item.output)
  ]);
  const now = new Date().toISOString();
  const developer = runtime.validateDeveloperConfig(projectConfig.developer || {});
  const manifest = {
    id: buildTaskId(now, BOOTSTRAP_TASK_NAME),
    name: BOOTSTRAP_TASK_NAME,
    title: 'Bootstrap project notes',
    description: 'Review minimum project truth and decide which note templates should be created next.',
    status: 'planning',
    dev_type: 'docs',
    scope: 'bootstrap',
    priority: 'P1',
    creator: developer.name,
    assignee: developer.name,
    createdAt: now,
    completedAt: null,
    branch: '',
    base_branch: 'main',
    worktree_path: null,
    current_phase: 1,
    next_action: [
      { phase: 1, action: 'implement' },
      { phase: 2, action: 'check' },
      { phase: 3, action: 'finish' },
      { phase: 4, action: 'create-pr' }
    ],
    commit: '',
    pr_url: '',
    subtasks: buildBootstrapTaskSubtasks(docsPlan),
    parent: null,
    children: [],
    relatedFiles,
    notes: buildBootstrapTaskNotes(projectConfig, docsPlan),
    type: 'implement',
    goal: 'Bootstrap project notes and truth sources',
    focus: '',
    references: relatedFiles,
    open_questions: [],
    known_risks: [],
    bindings: {
      hardware: {
        identity: {
          vendor: '',
          model: '',
          package: '',
          file: runtime.getProjectAssetRelativePath('hw.yaml')
        },
        chip_profile: null
      },
      docs: [],
      adapters: [],
      tools: []
    },
    injected_specs: [],
    context: Object.fromEntries(
      BOOTSTRAP_TASK_CHANNELS.map(channel => [
        channel,
        path.relative(projectRoot, path.join(taskDir, `${channel}.jsonl`)).replace(/\\/g, '/')
      ])
    ),
    created_at: now,
    updated_at: now,
    updatedAt: now
  };

  const contextEntries = {
    implement: [
      {
        kind: 'file',
        path: runtime.getProjectAssetRelativePath('hw.yaml'),
        reason: 'Confirm hardware truth first'
      },
      {
        kind: 'file',
        path: runtime.getProjectAssetRelativePath('req.yaml'),
        reason: 'Confirm project goal and constraints'
      },
      ...docsPlan.map(item => ({
        kind: 'file',
        path: item.output,
        reason: `Deferred template target (${item.template})`
      }))
    ],
    check: [
      {
        kind: 'file',
        path: runtime.getProjectAssetRelativePath('hw.yaml'),
        reason: 'Verify hardware truth stayed current'
      },
      {
        kind: 'file',
        path: runtime.getProjectAssetRelativePath('req.yaml'),
        reason: 'Verify requirements truth stayed current'
      }
    ],
    debug: docsPlan.map(item => ({
      kind: 'file',
      path: item.output,
      reason: 'Create only if a debugging or workflow gap appears'
    }))
  };

  if (existedBefore && !force) {
    return {
      name: BOOTSTRAP_TASK_NAME,
      path: path.relative(projectRoot, taskPath).replace(/\\/g, '/'),
      created: false,
      updated: false,
      reused: true,
      related_files: relatedFiles
    };
  }

  ensureDir(taskDir);
  runtime.writeJson(taskPath, manifest);
  BOOTSTRAP_TASK_CHANNELS.forEach(channel => {
    writeJsonl(path.join(taskDir, `${channel}.jsonl`), contextEntries[channel]);
  });

  return {
    name: BOOTSTRAP_TASK_NAME,
    path: path.relative(projectRoot, taskPath).replace(/\\/g, '/'),
    created: !existedBefore,
    updated: existedBefore && force,
    reused: false,
    related_files: relatedFiles
  };
}

function scaffoldProject(projectRoot, projectConfig, force, options) {
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root not found: ${projectRoot}`);
  }

  const projectConfigDir = runtime.initProjectLayout(projectRoot);
  const projectConfigPath = path.join(projectConfigDir, 'project.json');
  const developerPath = path.join(projectConfigDir, '.developer');
  const currentTaskPath = path.join(projectConfigDir, '.current-task');
  const srcDirPath = path.join(projectRoot, 'src');
  const initOptions = options || {};
  const shouldUpdateDeveloper = Boolean(initOptions.userSet || initOptions.runtimeSet);

  const created = [];
  const updated = [];
  const reused = [];
  let effectiveProjectConfig = projectConfig;

  if (!fs.existsSync(projectConfigPath) || force) {
    fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2) + '\n', 'utf8');
    created.push(path.relative(projectRoot, projectConfigPath));
  } else {
    if (shouldUpdateDeveloper) {
      const existing = runtime.validateProjectConfig(runtime.readJson(projectConfigPath), RUNTIME_CONFIG);
      const nextDeveloper = runtime.validateDeveloperConfig({
        ...(existing.developer || {}),
        ...(initOptions.userSet ? { name: initOptions.user || '' } : {}),
        ...(initOptions.runtimeSet ? { runtime: initOptions.runtime || '' } : {})
      });
      effectiveProjectConfig = runtime.validateProjectConfig(
        {
          ...existing,
          developer: nextDeveloper
        },
        RUNTIME_CONFIG
      );
      fs.writeFileSync(projectConfigPath, JSON.stringify(effectiveProjectConfig, null, 2) + '\n', 'utf8');
      updated.push(path.relative(projectRoot, projectConfigPath));
    } else {
      reused.push(path.relative(projectRoot, projectConfigPath));
    }
  }

  const developerPayload = runtime.validateDeveloperConfig(
    (effectiveProjectConfig && effectiveProjectConfig.developer) || {}
  );
  const developerExisted = fs.existsSync(developerPath);
  const shouldWriteDeveloperMarker = force || shouldUpdateDeveloper || !developerExisted;

  if (shouldWriteDeveloperMarker) {
    fs.writeFileSync(
      developerPath,
      JSON.stringify(
        {
          name: developerPayload.name,
          runtime: developerPayload.runtime,
          updated_at: new Date().toISOString()
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    if (developerExisted) {
      updated.push(path.relative(projectRoot, developerPath));
    } else {
      created.push(path.relative(projectRoot, developerPath));
    }
  } else {
    reused.push(path.relative(projectRoot, developerPath));
  }

  ensureGitignoreRule(projectRoot, runtime.getProjectAssetRelativePath('.developer'));

  const currentTaskExisted = fs.existsSync(currentTaskPath);
  if (!currentTaskExisted || force) {
    fs.writeFileSync(currentTaskPath, '', 'utf8');
    if (currentTaskExisted) {
      updated.push(path.relative(projectRoot, currentTaskPath));
    } else {
      created.push(path.relative(projectRoot, currentTaskPath));
    }
  } else {
    reused.push(path.relative(projectRoot, currentTaskPath));
  }

  if (!fs.existsSync(srcDirPath)) {
    ensureDir(srcDirPath);
    created.push(path.relative(projectRoot, srcDirPath));
  } else if (fs.statSync(srcDirPath).isDirectory()) {
    reused.push(path.relative(projectRoot, srcDirPath));
  } else {
    throw new Error(`src path exists but is not a directory: ${srcDirPath}`);
  }

  const context = buildTemplateContext(projectRoot, effectiveProjectConfig);
  const workflowCatalog = loadWorkflowCatalog(projectRoot);
  const templateIndex = buildTemplateIndex(workflowCatalog);
  const truthPlan = buildTruthPlan();
  const bootstrapDocsPlan = buildBootstrapDocsPlan(projectRoot, effectiveProjectConfig, workflowCatalog);
  const projectAgentsGuide = ensureProjectAgentsGuide(projectRoot, force);
  const worktreeConfig = ensureWorktreeConfig(projectRoot, force);
  let workflowRegistryImport = null;

  for (const item of truthPlan) {
    const outputPath = path.join(projectRoot, item.output);
    if (createTemplateFile(item.template, outputPath, context, force, templateIndex.byName)) {
      created.push(path.relative(projectRoot, outputPath));
    } else {
      reused.push(path.relative(projectRoot, outputPath));
    }
  }

  if (projectAgentsGuide.created) {
    created.push(projectAgentsGuide.path);
  } else if (projectAgentsGuide.updated) {
    updated.push(projectAgentsGuide.path);
  } else {
    reused.push(projectAgentsGuide.path);
  }

  if (worktreeConfig.created) {
    created.push(worktreeConfig.path);
  } else if (worktreeConfig.updated) {
    updated.push(worktreeConfig.path);
  } else {
    reused.push(worktreeConfig.path);
  }

  const bootstrapTask = ensureBootstrapTask(projectRoot, effectiveProjectConfig, bootstrapDocsPlan, force);
  if (bootstrapTask.created) {
    created.push(bootstrapTask.path);
  } else if (bootstrapTask.updated) {
    updated.push(bootstrapTask.path);
  } else {
    reused.push(bootstrapTask.path);
  }

  workflowRegistryImport = initOptions.workflowRegistryImport || null;

  return {
    project_root: projectRoot,
    project_config: path.relative(projectRoot, projectConfigPath),
    defaults: effectiveProjectConfig,
    bootstrap_task: bootstrapTask,
    workflow_registry_import: workflowRegistryImport,
    created,
    updated,
    reused
  };
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));

  if (args.help) {
    usage();
    return;
  }

  const projectRoot = path.resolve(args.project || process.cwd());
  const workflowSetup = prepareProjectWorkflowSetup(projectRoot, args, {
    force: args.force
  });
  const resolvedArgs = {
    ...args,
    specs: workflowSetup.activeSpecs
  };
  const projectConfig = buildProjectConfig(projectRoot, resolvedArgs, {
    workflowCatalog: workflowSetup.workflowCatalog,
    activeSpecs: workflowSetup.activeSpecs
  });
  const result = scaffoldProject(projectRoot, projectConfig, args.force, {
    ...resolvedArgs,
    workflowRegistryImport: workflowSetup.workflowRegistryImport
  });

  process.stdout.write(
    JSON.stringify(
      {
        ...result,
        next_steps: [
          `Ask the agent to record goals and constraints in ${runtime.getProjectAssetRelativePath('req.yaml')} first. If chip/package are already known, add them to ${runtime.getProjectAssetRelativePath('hw.yaml')}; otherwise leave them unknown for now.`,
          runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['next'])
        ]
      },
      null,
      2
    ) + '\n'
  );
}

module.exports = {
  buildDocsPlan,
  buildBootstrapDocsPlan,
  buildTruthPlan,
  buildProjectConfig,
  buildWorkflowSpecPrompt,
  buildTemplateContext,
  applyTemplate,
  parseWorkflowSpecSelection,
  prepareProjectWorkflowSetup,
  promptWorkflowSpecSelection,
  scaffoldProject,
  main,
  parseArgs
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`init-project error: ${error.message}\n`);
    process.exit(1);
  }
}
