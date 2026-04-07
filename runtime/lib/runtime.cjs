'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_EXT_DIR_NAME = '.emb-agent';
const LEGACY_PROJECT_EXT_DIR_NAME = 'emb-agent';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function moveFile(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));

  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error && error.code === 'EXDEV') {
      fs.copyFileSync(sourcePath, targetPath);
      fs.unlinkSync(sourcePath);
      return;
    }
    throw error;
  }
}

function copyPathRecursive(sourcePath, targetPath) {
  const stats = fs.statSync(sourcePath);

  if (stats.isDirectory()) {
    ensureDir(targetPath);
    for (const name of fs.readdirSync(sourcePath)) {
      copyPathRecursive(path.join(sourcePath, name), path.join(targetPath, name));
    }
    return;
  }

  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function removePathIfEmpty(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const stats = fs.statSync(filePath);
  if (stats.isDirectory()) {
    if (fs.readdirSync(filePath).length === 0) {
      fs.rmdirSync(filePath);
    }
    return;
  }

  fs.unlinkSync(filePath);
}

function mergeDirectoryInto(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    return;
  }

  ensureDir(targetDir);

  for (const name of fs.readdirSync(sourceDir)) {
    const sourcePath = path.join(sourceDir, name);
    const targetPath = path.join(targetDir, name);
    const sourceStats = fs.statSync(sourcePath);

    if (sourceStats.isDirectory()) {
      if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
        mergeDirectoryInto(sourcePath, targetPath);
        removePathIfEmpty(sourcePath);
        continue;
      }

      try {
        fs.renameSync(sourcePath, targetPath);
      } catch (error) {
        if (error && error.code === 'EXDEV') {
          copyPathRecursive(sourcePath, targetPath);
          fs.rmSync(sourcePath, { recursive: true, force: true });
          continue;
        }
        throw error;
      }
      continue;
    }

    if (fs.existsSync(targetPath)) {
      continue;
    }

    moveFile(sourcePath, targetPath);
  }

  removePathIfEmpty(sourceDir);
}

function buildProjectExtDir(projectRoot) {
  return path.join(path.resolve(projectRoot), PROJECT_EXT_DIR_NAME);
}

function getLegacyProjectExtDir(projectRoot) {
  return path.join(path.resolve(projectRoot), LEGACY_PROJECT_EXT_DIR_NAME);
}

function getProjectExtDir(projectRoot) {
  return migrateLegacyProjectExtDir(projectRoot);
}

function getProjectAssetRelativePath(...parts) {
  const normalized = parts
    .flat()
    .map(item => String(item || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);

  return [PROJECT_EXT_DIR_NAME].concat(normalized).join('/');
}

function normalizeProjectRelativePath(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const normalized = text.replace(/\\/g, '/');

  if (normalized === LEGACY_PROJECT_EXT_DIR_NAME) {
    return PROJECT_EXT_DIR_NAME;
  }

  if (normalized.startsWith(`${LEGACY_PROJECT_EXT_DIR_NAME}/`)) {
    return `${PROJECT_EXT_DIR_NAME}/${normalized.slice(LEGACY_PROJECT_EXT_DIR_NAME.length + 1)}`;
  }

  return normalized;
}

function migrateLegacyProjectExtDir(projectRoot) {
  const currentDir = buildProjectExtDir(projectRoot);
  const legacyDir = getLegacyProjectExtDir(projectRoot);

  if (!fs.existsSync(legacyDir)) {
    return currentDir;
  }

  if (!fs.existsSync(currentDir)) {
    try {
      fs.renameSync(legacyDir, currentDir);
      return currentDir;
    } catch (error) {
      if (!error || error.code !== 'EXDEV') {
        throw error;
      }

      copyPathRecursive(legacyDir, currentDir);
      fs.rmSync(legacyDir, { recursive: true, force: true });
      return currentDir;
    }
  }

  mergeDirectoryInto(legacyDir, currentDir);
  if (fs.existsSync(legacyDir) && fs.statSync(legacyDir).isDirectory() && fs.readdirSync(legacyDir).length === 0) {
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }
  return currentDir;
}

function resolveProjectDataPath(projectRoot, ...parts) {
  const currentPath = path.join(buildProjectExtDir(projectRoot), ...parts);
  if (fs.existsSync(currentPath)) {
    return currentPath;
  }

  const legacyPath = path.join(getLegacyProjectExtDir(projectRoot), ...parts);
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }

  return currentPath;
}

function initProjectLayout(projectRoot) {
  const projectExtDir = migrateLegacyProjectExtDir(projectRoot);

  ensureDir(projectExtDir);
  ensureDir(path.join(projectExtDir, 'cache'));
  ensureDir(path.join(projectExtDir, 'cache', 'docs'));
  ensureDir(path.join(projectExtDir, 'cache', 'adapter-sources'));
  ensureDir(path.join(projectExtDir, 'tasks'));
  ensureDir(path.join(projectExtDir, 'threads'));
  ensureDir(path.join(projectExtDir, 'reports'));
  ensureDir(path.join(projectExtDir, 'reports', 'forensics'));
  ensureDir(path.join(projectExtDir, 'reports', 'sessions'));
  ensureDir(path.join(projectExtDir, 'profiles'));
  ensureDir(path.join(projectExtDir, 'packs'));
  ensureDir(path.join(projectExtDir, 'adapters'));
  ensureDir(path.join(projectExtDir, 'specs'));
  ensureDir(path.join(projectExtDir, 'workspace'));
  ensureDir(path.join(path.resolve(projectRoot), 'docs'));

  return projectExtDir;
}

function parseScalar(raw) {
  const value = raw.trim();

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseSimpleYaml(filePath) {
  const lines = readText(filePath).split(/\r?\n/);
  const result = {};
  let currentListKey = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (line.startsWith('  - ')) {
      if (!currentListKey) {
        throw new Error(`Invalid YAML list item without key in ${filePath}`);
      }
      result[currentListKey].push(parseScalar(line.slice(4)));
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) {
      throw new Error(`Unsupported YAML syntax in ${filePath}: ${line}`);
    }

    const key = match[1];
    const rawValue = match[2] || '';

    if (rawValue === '') {
      result[key] = [];
      currentListKey = key;
    } else {
      result[key] = parseScalar(rawValue);
      currentListKey = null;
    }
  }

  return result;
}

function listNames(dirPath, extension) {
  return fs
    .readdirSync(dirPath)
    .filter(name => name.endsWith(extension))
    .map(name => name.slice(0, -extension.length))
    .sort();
}

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function removeValue(values, value) {
  return (values || []).filter(item => item !== value);
}

function expectObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function ensureString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function ensureOptionalString(value, label) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function ensureStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  const result = value.filter(item => item !== '');
  for (const item of result) {
    if (typeof item !== 'string') {
      throw new Error(`${label} must contain only strings`);
    }
  }
  return result;
}

function ensureBoolean(value, label, fallback) {
  if (value === undefined || value === null || value === '') {
    return Boolean(fallback);
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function normalizeActiveThread(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      name: '',
      title: '',
      status: '',
      path: '',
      updated_at: ''
    };
  }

  return {
    name: ensureOptionalString(value.name, 'active_thread.name'),
    title: ensureOptionalString(value.title, 'active_thread.title'),
    status: ensureOptionalString(value.status, 'active_thread.status'),
    path: normalizeProjectRelativePath(ensureOptionalString(value.path, 'active_thread.path')),
    updated_at: ensureOptionalString(value.updated_at, 'active_thread.updated_at')
  };
}

function normalizeActiveTask(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      name: '',
      title: '',
      status: '',
      path: '',
      updated_at: ''
    };
  }

  return {
    name: ensureOptionalString(value.name, 'active_task.name'),
    title: ensureOptionalString(value.title, 'active_task.title'),
    status: ensureOptionalString(value.status, 'active_task.status'),
    path: normalizeProjectRelativePath(ensureOptionalString(value.path, 'active_task.path')),
    updated_at: ensureOptionalString(value.updated_at, 'active_task.updated_at')
  };
}

function normalizeActiveWorkspace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      name: '',
      title: '',
      type: '',
      status: '',
      path: '',
      updated_at: ''
    };
  }

  return {
    name: ensureOptionalString(value.name, 'active_workspace.name'),
    title: ensureOptionalString(value.title, 'active_workspace.title'),
    type: ensureOptionalString(value.type, 'active_workspace.type'),
    status: ensureOptionalString(value.status, 'active_workspace.status'),
    path: normalizeProjectRelativePath(ensureOptionalString(value.path, 'active_workspace.path')),
    updated_at: ensureOptionalString(value.updated_at, 'active_workspace.updated_at')
  };
}

function normalizeDiagnostics(value) {
  const source = (!value || typeof value !== 'object' || Array.isArray(value)) ? {} : value;
  const latestForensics =
    !source.latest_forensics || typeof source.latest_forensics !== 'object' || Array.isArray(source.latest_forensics)
      ? {}
      : source.latest_forensics;

  return {
    latest_forensics: {
      report_file: normalizeProjectRelativePath(
        ensureOptionalString(latestForensics.report_file, 'diagnostics.latest_forensics.report_file')
      ),
      problem: ensureOptionalString(latestForensics.problem, 'diagnostics.latest_forensics.problem'),
      linked_thread: normalizeProjectRelativePath(
        ensureOptionalString(latestForensics.linked_thread, 'diagnostics.latest_forensics.linked_thread')
      ),
      highest_severity: ensureOptionalString(
        latestForensics.highest_severity,
        'diagnostics.latest_forensics.highest_severity'
      ),
      generated_at: ensureOptionalString(latestForensics.generated_at, 'diagnostics.latest_forensics.generated_at')
    }
  };
}

function ensurePositiveInteger(value, label, fallback) {
  const next = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(next) || next < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return next;
}

const DEFAULT_PREFERENCES = Object.freeze({
  truth_source_mode: 'hardware_first',
  plan_mode: 'auto',
  review_mode: 'auto',
  verification_mode: 'lean'
});

function ensureChoice(value, label, choices, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  if (!choices.includes(value)) {
    throw new Error(`${label} must be one of: ${choices.join(', ')}`);
  }
  return value;
}

function normalizePreferences(preferences, runtimeConfig) {
  if (preferences === undefined || preferences === null) {
    preferences = {};
  }

  expectObject(preferences, 'preferences');

  const defaults =
    runtimeConfig && runtimeConfig.default_preferences
      ? runtimeConfig.default_preferences
      : DEFAULT_PREFERENCES;

  return {
    truth_source_mode: ensureChoice(
      preferences.truth_source_mode,
      'preferences.truth_source_mode',
      ['hardware_first', 'code_first'],
      defaults.truth_source_mode
    ),
    plan_mode: ensureChoice(
      preferences.plan_mode,
      'preferences.plan_mode',
      ['auto', 'always', 'never'],
      defaults.plan_mode
    ),
    review_mode: ensureChoice(
      preferences.review_mode,
      'preferences.review_mode',
      ['auto', 'always', 'never'],
      defaults.review_mode
    ),
    verification_mode: ensureChoice(
      preferences.verification_mode,
      'preferences.verification_mode',
      ['lean', 'strict'],
      defaults.verification_mode
    )
  };
}

function validateMineruIntegration(config) {
  const source = config === undefined || config === null ? {} : config;
  expectObject(source, 'integrations.mineru');
  const mode = ensureChoice(source.mode, 'integrations.mineru.mode', ['auto', 'agent', 'api'], 'auto');

  return {
    mode,
    base_url:
      ensureOptionalString(source.base_url, 'integrations.mineru.base_url') ||
      (mode === 'api' ? 'https://mineru.net/api/v4' : mode === 'agent' ? 'https://mineru.net/api/v1/agent' : ''),
    api_key: ensureOptionalString(source.api_key, 'integrations.mineru.api_key'),
    api_key_env: ensureOptionalString(source.api_key_env, 'integrations.mineru.api_key_env') || 'MINERU_API_KEY',
    model_version:
      ensureOptionalString(source.model_version, 'integrations.mineru.model_version') ||
      (mode === 'api' ? 'vlm' : ''),
    language: ensureChoice(
      source.language,
      'integrations.mineru.language',
      ['ch', 'en'],
      'ch'
    ),
    enable_table: ensureBoolean(source.enable_table, 'integrations.mineru.enable_table', true),
    is_ocr: ensureBoolean(source.is_ocr, 'integrations.mineru.is_ocr', false),
    enable_formula: ensureBoolean(
      source.enable_formula,
      'integrations.mineru.enable_formula',
      true
    ),
    poll_interval_ms: ensurePositiveInteger(
      source.poll_interval_ms,
      'integrations.mineru.poll_interval_ms',
      3000
    ),
    timeout_ms: ensurePositiveInteger(
      source.timeout_ms,
      'integrations.mineru.timeout_ms',
      300000
    ),
    auto_api_page_threshold: ensurePositiveInteger(
      source.auto_api_page_threshold,
      'integrations.mineru.auto_api_page_threshold',
      12
    ),
    auto_api_file_size_kb: ensurePositiveInteger(
      source.auto_api_file_size_kb,
      'integrations.mineru.auto_api_file_size_kb',
      4096
    )
  };
}

function validateIntegrations(config) {
  const source = config === undefined || config === null ? {} : config;
  expectObject(source, 'integrations');

  return {
    mineru: validateMineruIntegration(source.mineru)
  };
}

function validateArchReviewConfig(config) {
  const source = config === undefined || config === null ? {} : config;
  expectObject(source, 'arch_review');

  return {
    trigger_patterns: ensureStringArray(source.trigger_patterns || [], 'arch_review.trigger_patterns')
  };
}

function validateAdapterSource(source, index) {
  const label = `adapter_sources[${index}]`;
  const input = source === undefined || source === null ? {} : source;
  expectObject(input, label);

  return {
    name: ensureString(input.name, `${label}.name`),
    type: ensureChoice(input.type, `${label}.type`, ['path', 'git'], 'path'),
    location: ensureString(input.location, `${label}.location`),
    branch: ensureOptionalString(input.branch, `${label}.branch`),
    subdir: ensureOptionalString(input.subdir, `${label}.subdir`),
    enabled: ensureBoolean(input.enabled, `${label}.enabled`, true)
  };
}

function validateAdapterSources(config) {
  if (config === undefined || config === null) {
    return [];
  }
  if (!Array.isArray(config)) {
    throw new Error('adapter_sources must be an array');
  }

  const normalized = config.map((item, index) => validateAdapterSource(item, index));
  const seen = new Set();

  normalized.forEach(item => {
    if (seen.has(item.name)) {
      throw new Error(`adapter_sources contains duplicate name: ${item.name}`);
    }
    seen.add(item.name);
  });

  return normalized;
}

function validateProjectConfig(config, runtimeConfig) {
  expectObject(config, 'Project config');

  return {
    project_profile: ensureOptionalString(config.project_profile, 'project_profile'),
    active_packs: ensureStringArray(config.active_packs || [], 'active_packs'),
    adapter_sources: validateAdapterSources(config.adapter_sources || []),
    preferences: normalizePreferences(config.preferences || {}, runtimeConfig),
    integrations: validateIntegrations(config.integrations || {}),
    arch_review: validateArchReviewConfig(config.arch_review || {})
  };
}

function loadProjectConfig(projectRoot, runtimeConfig) {
  const filePath = resolveProjectDataPath(projectRoot, 'project.json');
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return validateProjectConfig(readJson(filePath), runtimeConfig);
}

function mergeRuntimeDefaults(runtimeConfig, projectConfig) {
  if (!projectConfig) {
    return runtimeConfig;
  }

  return {
    ...runtimeConfig,
    default_profile: projectConfig.project_profile || runtimeConfig.default_profile,
    default_packs:
      projectConfig.active_packs && projectConfig.active_packs.length > 0
        ? projectConfig.active_packs
        : runtimeConfig.default_packs,
    default_preferences: projectConfig.preferences || runtimeConfig.default_preferences
  };
}

function validateRuntimeConfig(config) {
  expectObject(config, 'Runtime config');

  const normalized = {
    runtime_version: Number(config.runtime_version || 1),
    session_version: Number(config.session_version || 1),
    default_profile: ensureString(config.default_profile || 'baremetal-8bit', 'default_profile'),
    default_packs: ensureStringArray(config.default_packs || [], 'default_packs'),
    default_preferences: normalizePreferences(config.default_preferences || {}, {
      default_preferences: DEFAULT_PREFERENCES
    }),
    project_state_dir: ensureString(
      config.project_state_dir || '../state/emb-agent/projects',
      'project_state_dir'
    ),
    legacy_project_state_dir: ensureString(
      config.legacy_project_state_dir || 'state/projects',
      'legacy_project_state_dir'
    ),
    lock_timeout_ms: Number(config.lock_timeout_ms || 2000),
    lock_stale_ms: Number(config.lock_stale_ms || 15000),
    max_last_files: Number(config.max_last_files || 12)
  };

  if (!Number.isInteger(normalized.runtime_version) || normalized.runtime_version < 1) {
    throw new Error('runtime_version must be a positive integer');
  }
  if (!Number.isInteger(normalized.session_version) || normalized.session_version < 1) {
    throw new Error('session_version must be a positive integer');
  }
  if (!Number.isInteger(normalized.lock_timeout_ms) || normalized.lock_timeout_ms < 100) {
    throw new Error('lock_timeout_ms must be an integer >= 100');
  }
  if (!Number.isInteger(normalized.lock_stale_ms) || normalized.lock_stale_ms < normalized.lock_timeout_ms) {
    throw new Error('lock_stale_ms must be an integer >= lock_timeout_ms');
  }
  if (!Number.isInteger(normalized.max_last_files) || normalized.max_last_files < 1) {
    throw new Error('max_last_files must be a positive integer');
  }

  return normalized;
}

function loadRuntimeConfig(rootDir) {
  return validateRuntimeConfig(readJson(path.join(rootDir, 'config.json')));
}

function validateTemplateConfig(config) {
  expectObject(config, 'Template config');
  const normalized = {};

  for (const [name, meta] of Object.entries(config)) {
    expectObject(meta, `Template ${name}`);
    normalized[name] = {
      source: ensureString(meta.source, `Template ${name} source`),
      description: ensureString(meta.description, `Template ${name} description`),
      default_output: ensureOptionalString(meta.default_output, `Template ${name} default_output`)
    };
  }

  return normalized;
}

function validateProfile(name, profile) {
  expectObject(profile, `Profile ${name}`);
  return {
    name: ensureString(profile.name || name, `Profile ${name} name`),
    runtime_model: ensureString(profile.runtime_model, `Profile ${name} runtime_model`),
    concurrency_model: ensureString(profile.concurrency_model, `Profile ${name} concurrency_model`),
    resource_priority: ensureStringArray(profile.resource_priority || [], `Profile ${name} resource_priority`),
    search_priority: ensureStringArray(profile.search_priority || [], `Profile ${name} search_priority`),
    guardrails: ensureStringArray(profile.guardrails || [], `Profile ${name} guardrails`),
    review_axes: ensureStringArray(profile.review_axes || [], `Profile ${name} review_axes`),
    notes_targets: ensureStringArray(profile.notes_targets || [], `Profile ${name} notes_targets`),
    default_agents: ensureStringArray(profile.default_agents || [], `Profile ${name} default_agents`),
    arch_review_triggers: ensureStringArray(
      profile.arch_review_triggers || [],
      `Profile ${name} arch_review_triggers`
    )
  };
}

function validatePack(name, pack) {
  expectObject(pack, `Pack ${name}`);
  return {
    name: ensureString(pack.name || name, `Pack ${name} name`),
    focus_areas: ensureStringArray(pack.focus_areas || [], `Pack ${name} focus_areas`),
    extra_review_axes: ensureStringArray(pack.extra_review_axes || [], `Pack ${name} extra_review_axes`),
    preferred_notes: ensureStringArray(pack.preferred_notes || [], `Pack ${name} preferred_notes`),
    default_agents: ensureStringArray(pack.default_agents || [], `Pack ${name} default_agents`)
  };
}

function getProjectKey(projectRoot) {
  return crypto.createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 12);
}

function getProjectStatePaths(rootDir, cwd, runtimeConfig) {
  const projectRoot = path.resolve(cwd);
  const projectKey = getProjectKey(projectRoot);
  const stateDir = path.resolve(rootDir, runtimeConfig.project_state_dir);
  const legacyStateDir = path.resolve(
    rootDir,
    runtimeConfig.legacy_project_state_dir || 'state/projects'
  );

  return {
    projectRoot,
    projectKey,
    stateDir,
    legacyStateDir,
    sessionPath: path.join(stateDir, `${projectKey}.json`),
    handoffPath: path.join(stateDir, `${projectKey}.handoff.json`),
    lockPath: path.join(stateDir, `${projectKey}.lock`),
    legacySessionPath: path.join(legacyStateDir, `${projectKey}.json`),
    legacyHandoffPath: path.join(legacyStateDir, `${projectKey}.handoff.json`),
    legacyLockPath: path.join(legacyStateDir, `${projectKey}.lock`)
  };
}

function ensureProjectStateStorage(paths) {
  ensureDir(paths.stateDir);

  const migrations = [
    [paths.legacySessionPath, paths.sessionPath],
    [paths.legacyHandoffPath, paths.handoffPath],
    [paths.legacyLockPath, paths.lockPath]
  ];

  for (const [legacyPath, currentPath] of migrations) {
    if (!legacyPath || legacyPath === currentPath) {
      continue;
    }
    if (!fs.existsSync(legacyPath) || fs.existsSync(currentPath)) {
      continue;
    }
    moveFile(legacyPath, currentPath);
  }

  if (
    paths.legacyStateDir &&
    paths.legacyStateDir !== paths.stateDir &&
    fs.existsSync(paths.legacyStateDir) &&
    fs.readdirSync(paths.legacyStateDir).length === 0
  ) {
    fs.rmSync(paths.legacyStateDir, { recursive: true, force: true });
  }
}

function normalizeSession(session, paths, runtimeConfig, projectConfig) {
  const next = { ...(session || {}) };
  const defaults = mergeRuntimeDefaults(runtimeConfig, projectConfig);

  next.session_version = defaults.session_version;
  next.project_root = paths.projectRoot;
  next.project_key = paths.projectKey;
  next.project_name = path.basename(paths.projectRoot);
  next.project_profile =
    typeof next.project_profile === 'string' && next.project_profile.trim()
      ? next.project_profile
      : defaults.default_profile;
  next.active_packs = unique(
    Array.isArray(next.active_packs) && next.active_packs.length > 0
      ? ensureStringArray(next.active_packs, 'active_packs')
      : defaults.default_packs
  );
  next.preferences = normalizePreferences(next.preferences || {}, defaults);
  next.focus = typeof next.focus === 'string' ? next.focus : '';
  next.last_files = ensureStringArray(next.last_files || [], 'last_files')
    .map(normalizeProjectRelativePath)
    .slice(0, defaults.max_last_files);
  next.open_questions = ensureStringArray(next.open_questions || [], 'open_questions');
  next.known_risks = ensureStringArray(next.known_risks || [], 'known_risks');
  next.active_workspace = normalizeActiveWorkspace(next.active_workspace || {});
  next.active_thread = normalizeActiveThread(next.active_thread || {});
  next.active_task = normalizeActiveTask(next.active_task || {});
  next.diagnostics = normalizeDiagnostics(next.diagnostics || {});
  next.last_command = ensureOptionalString(next.last_command, 'last_command');
  next.paused_at = ensureOptionalString(next.paused_at, 'paused_at');
  next.last_resumed_at = ensureOptionalString(next.last_resumed_at, 'last_resumed_at');
  next.created_at =
    typeof next.created_at === 'string' && next.created_at
      ? next.created_at
      : new Date().toISOString();
  next.updated_at =
    typeof next.updated_at === 'string' && next.updated_at
      ? next.updated_at
      : new Date().toISOString();

  return next;
}

function loadDefaultSession(rootDir, paths, runtimeConfig, projectConfig) {
  const defaultSessionPath = path.join(rootDir, 'state', 'default-session.json');
  const raw = fs.existsSync(defaultSessionPath) ? readJson(defaultSessionPath) : {};
  const seeded = {
    ...raw
  };

  if (projectConfig) {
    if (projectConfig.project_profile) {
      seeded.project_profile = projectConfig.project_profile;
    }
    if (projectConfig.active_packs && projectConfig.active_packs.length > 0) {
      seeded.active_packs = projectConfig.active_packs;
    }
    seeded.preferences = {
      ...(raw.preferences || {}),
      ...(projectConfig.preferences || {})
    };
  }

  return normalizeSession(seeded, paths, runtimeConfig, projectConfig);
}

function cleanupStaleLock(lockPath, staleMs) {
  if (!fs.existsSync(lockPath)) {
    return false;
  }

  const stats = fs.statSync(lockPath);
  if (Date.now() - stats.mtimeMs <= staleMs) {
    return false;
  }

  fs.unlinkSync(lockPath);
  return true;
}

function validateHandoff(handoff, runtimeConfig) {
  expectObject(handoff, 'Handoff');

  return {
    version: ensureString(handoff.version || '1.0', 'handoff.version'),
    timestamp: ensureOptionalString(handoff.timestamp, 'handoff.timestamp'),
    status: ensureString(handoff.status || 'paused', 'handoff.status'),
    focus: ensureOptionalString(handoff.focus, 'handoff.focus'),
    profile: ensureOptionalString(handoff.profile, 'handoff.profile'),
    packs: ensureStringArray(handoff.packs || [], 'handoff.packs'),
    last_command: ensureOptionalString(handoff.last_command, 'handoff.last_command'),
    suggested_flow: ensureOptionalString(handoff.suggested_flow, 'handoff.suggested_flow'),
    next_action: ensureOptionalString(handoff.next_action, 'handoff.next_action'),
    context_notes: ensureOptionalString(handoff.context_notes, 'handoff.context_notes'),
    human_actions_pending: ensureStringArray(
      handoff.human_actions_pending || [],
      'handoff.human_actions_pending'
    ),
    last_files: ensureStringArray(handoff.last_files || [], 'handoff.last_files')
      .map(normalizeProjectRelativePath)
      .slice(0, runtimeConfig.max_last_files),
    open_questions: ensureStringArray(handoff.open_questions || [], 'handoff.open_questions'),
    known_risks: ensureStringArray(handoff.known_risks || [], 'handoff.known_risks')
  };
}

module.exports = {
  cleanupStaleLock,
  ensureDir,
  ensureProjectStateStorage,
  getLegacyProjectExtDir,
  getProjectAssetRelativePath,
  getProjectExtDir,
  getProjectKey,
  getProjectStatePaths,
  initProjectLayout,
  listNames,
  loadDefaultSession,
  loadProjectConfig,
  loadRuntimeConfig,
  mergeRuntimeDefaults,
  migrateLegacyProjectExtDir,
  normalizeSession,
  normalizeProjectRelativePath,
  normalizePreferences,
  parseSimpleYaml,
  readJson,
  readText,
  removeValue,
  resolveProjectDataPath,
  requireFile,
  unique,
  validateAdapterSource,
  validateAdapterSources,
  validateHandoff,
  validatePack,
  validateProfile,
  validateProjectConfig,
  validateTemplateConfig,
  writeJson
};
