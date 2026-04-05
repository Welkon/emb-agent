#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROFILES_DIR = path.join(ROOT, 'profiles');
const PACKS_DIR = path.join(ROOT, 'packs');
const AGENTS_DIR = path.join(ROOT, 'agents');
const COMMANDS_DIR = path.join(ROOT, 'commands');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const templateCli = require(path.join(ROOT, 'scripts', 'template.cjs'));
const attachProjectCli = require(path.join(ROOT, 'scripts', 'attach-project.cjs'));
const ingestTruthCli = require(path.join(ROOT, 'scripts', 'ingest-truth.cjs'));
const ingestDocCli = require(path.join(ROOT, 'scripts', 'ingest-doc.cjs'));
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const scheduler = require(path.join(ROOT, 'lib', 'scheduler.cjs'));
const toolCatalog = require(path.join(ROOT, 'lib', 'tool-catalog.cjs'));
const toolRuntime = require(path.join(ROOT, 'lib', 'tool-runtime.cjs'));
const chipCatalog = require(path.join(ROOT, 'lib', 'chip-catalog.cjs'));
const adapterSources = require(path.join(ROOT, 'lib', 'adapter-sources.cjs'));

const RUNTIME_CONFIG = runtime.loadRuntimeConfig(ROOT);

const REVIEW_AGENT_NAMES = [
  'hw-scout',
  'bug-hunter',
  'sys-reviewer',
  'release-checker'
];

const DEFAULT_ARCH_REVIEW_PATTERNS = [
  '芯片选型',
  '器件选型',
  'mcu选型',
  'soc选型',
  '方案预审',
  '架构预审',
  '系统预审',
  '选型评审',
  '尸检预演',
  '立项评审',
  '原型转量产',
  'PoC转量产',
  'chip selection',
  'mcu selection',
  'soc selection',
  'architecture review',
  'arch review',
  'pre-mortem',
  'proof of concept'
];

function resolveProjectRoot() {
  return path.resolve(process.cwd());
}

function getProjectExtDir() {
  return path.join(resolveProjectRoot(), 'emb-agent');
}

function getProjectProfilesDir() {
  return path.join(getProjectExtDir(), 'profiles');
}

function getProjectPacksDir() {
  return path.join(getProjectExtDir(), 'packs');
}

function getProjectStatePaths() {
  return runtime.getProjectStatePaths(ROOT, resolveProjectRoot(), RUNTIME_CONFIG);
}

function getProjectConfig() {
  return runtime.loadProjectConfig(resolveProjectRoot(), RUNTIME_CONFIG);
}

function normalizeSession(session, paths) {
  return runtime.normalizeSession(session, paths, RUNTIME_CONFIG, getProjectConfig());
}

function readDefaultSession(paths) {
  return runtime.loadDefaultSession(ROOT, paths, RUNTIME_CONFIG, getProjectConfig());
}

function initProjectLayout() {
  runtime.ensureDir(getProjectExtDir());
  runtime.ensureDir(path.join(getProjectExtDir(), 'cache'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'cache', 'docs'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'cache', 'adapter-sources'));
  runtime.ensureDir(getProjectProfilesDir());
  runtime.ensureDir(getProjectPacksDir());
  runtime.ensureDir(path.join(getProjectExtDir(), 'adapters'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'extensions'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'extensions', 'tools'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'extensions', 'tools', 'specs'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'extensions', 'tools', 'families'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'extensions', 'tools', 'devices'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'extensions', 'chips'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'extensions', 'chips', 'devices'));
  runtime.ensureDir(path.join(resolveProjectRoot(), 'docs'));
}

function ensureSession() {
  const paths = getProjectStatePaths();
  runtime.ensureProjectStateStorage(paths);

  if (!fs.existsSync(paths.sessionPath)) {
    const session = readDefaultSession(paths);
    runtime.writeJson(paths.sessionPath, session);
    return session;
  }

  const session = normalizeSession(runtime.readJson(paths.sessionPath), paths);
  runtime.writeJson(paths.sessionPath, session);
  return session;
}

function loadSession() {
  return ensureSession();
}

function saveSession(session) {
  const paths = getProjectStatePaths();
  runtime.ensureProjectStateStorage(paths);
  const next = normalizeSession(session, paths);
  next.updated_at = new Date().toISOString();
  runtime.writeJson(paths.sessionPath, next);
}

function loadHandoff() {
  const paths = getProjectStatePaths();
  runtime.ensureProjectStateStorage(paths);
  if (!fs.existsSync(paths.handoffPath)) {
    return null;
  }
  return runtime.validateHandoff(runtime.readJson(paths.handoffPath), RUNTIME_CONFIG);
}

function saveHandoff(handoff) {
  const paths = getProjectStatePaths();
  runtime.ensureProjectStateStorage(paths);
  runtime.writeJson(paths.handoffPath, runtime.validateHandoff(handoff, RUNTIME_CONFIG));
}

function clearHandoff() {
  const paths = getProjectStatePaths();
  runtime.ensureProjectStateStorage(paths);
  if (fs.existsSync(paths.handoffPath)) {
    fs.unlinkSync(paths.handoffPath);
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockPath) {
  const start = Date.now();

  while (true) {
    try {
      runtime.ensureDir(path.dirname(lockPath));
      const fd = fs.openSync(lockPath, 'wx');
      return fd;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      if (runtime.cleanupStaleLock(lockPath, RUNTIME_CONFIG.lock_stale_ms)) {
        continue;
      }

      if (Date.now() - start > RUNTIME_CONFIG.lock_timeout_ms) {
        throw new Error('Session lock timeout');
      }

      sleepMs(20);
    }
  }
}

function releaseLock(lockFd, lockPath) {
  fs.closeSync(lockFd);
  if (fs.existsSync(lockPath)) {
    fs.unlinkSync(lockPath);
  }
}

function updateSession(mutator) {
  const paths = getProjectStatePaths();
  const lockFd = acquireLock(paths.lockPath);

  try {
    const session = loadSession();
    mutator(session);
    saveSession(session);
    return loadSession();
  } finally {
    releaseLock(lockFd, paths.lockPath);
  }
}

function resolveYamlPath(projectDir, builtInDir, name) {
  const projectPath = path.join(projectDir, `${name}.yaml`);
  if (fs.existsSync(projectPath)) {
    return projectPath;
  }

  const builtInPath = path.join(builtInDir, `${name}.yaml`);
  if (fs.existsSync(builtInPath)) {
    return builtInPath;
  }

  return '';
}

function loadProfile(name) {
  const filePath = resolveYamlPath(getProjectProfilesDir(), PROFILES_DIR, name);
  if (!filePath) {
    throw new Error(`Profile not found: ${name}`);
  }
  return runtime.validateProfile(name, runtime.parseSimpleYaml(filePath));
}

function loadPack(name) {
  const filePath = resolveYamlPath(getProjectPacksDir(), PACKS_DIR, name);
  if (!filePath) {
    throw new Error(`Pack not found: ${name}`);
  }
  return runtime.validatePack(name, runtime.parseSimpleYaml(filePath));
}

function loadMarkdown(dirPath, name, kind) {
  const filePath = path.join(dirPath, `${name}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${kind} not found: ${name}`);
  }

  return {
    name,
    path: path.relative(process.cwd(), filePath),
    content: runtime.readText(filePath)
  };
}

function readScalarLine(content, prefix) {
  const line = String(content || '')
    .split(/\r?\n/)
    .find(item => item.startsWith(prefix));

  if (!line) {
    return '';
  }

  return line
    .slice(prefix.length)
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

function loadHardwareIdentity(projectRoot) {
  const hwPath = path.join(projectRoot, 'emb-agent', 'hw.yaml');
  const content = fs.existsSync(hwPath) ? runtime.readText(hwPath) : '';

  return {
    file: path.relative(projectRoot, hwPath),
    vendor: readScalarLine(content, '  vendor: '),
    model: readScalarLine(content, '  model: '),
    package: readScalarLine(content, '  package: ')
  };
}

function findChipProfileByModel(model) {
  const normalized = String(model || '').trim();
  if (!normalized) {
    return null;
  }

  try {
    return chipCatalog.loadChip(ROOT, normalized);
  } catch {
    const matched = chipCatalog
      .listChips(ROOT)
      .find(item => item.name.toLowerCase() === normalized.toLowerCase());

    if (!matched) {
      return null;
    }

    return chipCatalog.loadChip(ROOT, matched.name);
  }
}

function buildSuggestedTools(chipProfile) {
  if (!chipProfile || !Array.isArray(chipProfile.related_tools) || chipProfile.related_tools.length === 0) {
    return [];
  }

  return runtime.unique(chipProfile.related_tools)
    .map(toolName => {
      try {
        const spec = toolCatalog.loadToolSpec(ROOT, toolName);
        const adapter = toolRuntime.loadExternalAdapter(ROOT, toolName);

        return {
          name: spec.name,
          description: spec.description,
          tool_kind: spec.kind,
          chip: chipProfile.name,
          family: chipProfile.family,
          discovered_from: 'chip-profile',
          status: adapter ? 'ready' : 'adapter-required',
          implementation: adapter ? 'external-adapter' : 'abstract-only',
          adapter_path: adapter ? adapter.file_path : ''
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function enrichWithToolSuggestions(output, resolved) {
  const hardwareIdentity = resolved && resolved.hardware ? resolved.hardware.identity : null;
  const chipProfile = resolved && resolved.hardware ? resolved.hardware.chip_profile : null;
  const suggestedTools = (resolved && resolved.effective && resolved.effective.suggested_tools) || [];

  if (!suggestedTools.length && !chipProfile && !(hardwareIdentity && hardwareIdentity.model)) {
    return output;
  }

  return {
    ...output,
    hardware: {
      mcu: hardwareIdentity || { file: 'emb-agent/hw.yaml', vendor: '', model: '', package: '' },
      chip_profile: chipProfile
        ? {
            name: chipProfile.name,
            vendor: chipProfile.vendor,
            family: chipProfile.family,
            package: chipProfile.package,
            runtime_model: chipProfile.runtime_model
          }
        : null
    },
    suggested_tools: suggestedTools
  };
}

function resolveSession() {
  const session = loadSession();
  const profile = loadProfile(session.project_profile);
  const packs = session.active_packs.map(loadPack);
  const projectConfig = getProjectConfig();
  const hardwareIdentity = loadHardwareIdentity(session.project_root || resolveProjectRoot());
  const chipProfile = findChipProfileByModel(hardwareIdentity.model);
  const suggestedTools = buildSuggestedTools(chipProfile);
  const agents = runtime.unique([
    ...(profile.default_agents || []),
    ...packs.flatMap(pack => pack.default_agents || [])
  ]);

  const reviewAgents = runtime.unique(
    agents.filter(name => REVIEW_AGENT_NAMES.includes(name))
  );

  return {
    session,
    profile,
    project_config: projectConfig,
    packs,
    hardware: {
      identity: hardwareIdentity,
      chip_profile: chipProfile
    },
    effective: {
      agents,
      review_agents: reviewAgents,
      focus_areas: runtime.unique(packs.flatMap(pack => pack.focus_areas || [])),
      review_axes: runtime.unique([
        ...(profile.review_axes || []),
        ...packs.flatMap(pack => pack.extra_review_axes || [])
      ]),
      note_targets: runtime.unique([
        ...(profile.notes_targets || []),
        ...packs.flatMap(pack => pack.preferred_notes || [])
      ]),
      search_priority: profile.search_priority || [],
      guardrails: profile.guardrails || [],
      resource_priority: profile.resource_priority || [],
      suggested_tools: suggestedTools,
      arch_review_triggers:
        projectConfig &&
        projectConfig.arch_review &&
        Array.isArray(projectConfig.arch_review.trigger_patterns) &&
        projectConfig.arch_review.trigger_patterns.length > 0
          ? projectConfig.arch_review.trigger_patterns
          : (profile.arch_review_triggers || []).length > 0
            ? profile.arch_review_triggers
            : DEFAULT_ARCH_REVIEW_PATTERNS
    }
  };
}

function getPreferences(session) {
  return runtime.normalizePreferences((session && session.preferences) || {}, RUNTIME_CONFIG);
}

function buildStatus() {
  const resolved = resolveSession();
  const projectConfig = getProjectConfig();
  const handoff = loadHandoff();
  const contextHygiene = buildContextHygiene(resolved, handoff, 'status');

  return enrichWithToolSuggestions({
    session_version: resolved.session.session_version,
    project_root: resolved.session.project_root,
    project_name: resolved.session.project_name,
    project_profile: resolved.session.project_profile,
    active_packs: resolved.session.active_packs,
    focus: resolved.session.focus || '',
    preferences: getPreferences(resolved.session),
    project_defaults: projectConfig,
    agents: resolved.effective.agents,
    review_axes: resolved.effective.review_axes,
    note_targets: resolved.effective.note_targets,
    arch_review_triggers: resolved.effective.arch_review_triggers,
    open_questions: resolved.session.open_questions,
    known_risks: resolved.session.known_risks,
    last_files: resolved.session.last_files,
    context_hygiene: contextHygiene
  }, resolved);
}

function selectNestedField(source, fieldPath) {
  if (!fieldPath) {
    return source;
  }

  const parts = fieldPath
    .split('.')
    .map(item => item.trim())
    .filter(Boolean);

  let current = source;

  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      throw new Error(`Unknown field path: ${fieldPath}`);
    }
    current = current[part];
  }

  return current;
}

function parseProjectShowArgs(tokens) {
  const result = {
    effective: false,
    field: ''
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--effective') {
      result.effective = true;
      continue;
    }

    if (token === '--field') {
      result.field = tokens[index + 1] || '';
      index += 1;
      if (!result.field) {
        throw new Error('Missing path after --field');
      }
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return result;
}

function parseProjectSetArgs(tokens) {
  const result = {
    field: '',
    value: ''
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--field') {
      result.field = tokens[index + 1] || '';
      index += 1;
      if (!result.field) {
        throw new Error('Missing path after --field');
      }
      continue;
    }

    if (token === '--value') {
      result.value = tokens[index + 1] || '';
      index += 1;
      if (result.value === '') {
        throw new Error('Missing value after --value');
      }
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!result.field) {
    throw new Error('Missing --field');
  }
  if (result.value === '') {
    throw new Error('Missing --value');
  }

  return result;
}

function parseAdapterSourceAddArgs(tokens) {
  const result = {
    type: '',
    location: '',
    branch: '',
    subdir: '',
    enabled: true
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--type') {
      result.type = tokens[index + 1] || '';
      index += 1;
      if (!result.type) {
        throw new Error('Missing value after --type');
      }
      continue;
    }

    if (token === '--location') {
      result.location = tokens[index + 1] || '';
      index += 1;
      if (!result.location) {
        throw new Error('Missing value after --location');
      }
      continue;
    }

    if (token === '--branch') {
      result.branch = tokens[index + 1] || '';
      index += 1;
      if (!result.branch) {
        throw new Error('Missing value after --branch');
      }
      continue;
    }

    if (token === '--subdir') {
      result.subdir = tokens[index + 1] || '';
      index += 1;
      if (!result.subdir) {
        throw new Error('Missing value after --subdir');
      }
      continue;
    }

    if (token === '--disabled') {
      result.enabled = false;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!result.type) {
    throw new Error('Missing --type');
  }
  if (!result.location) {
    throw new Error('Missing --location');
  }

  return result;
}

function parseAdapterSyncArgs(tokens) {
  const result = {
    all: false,
    target: 'project',
    force: false
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--all') {
      result.all = true;
      continue;
    }

    if (token === '--to') {
      result.target = tokens[index + 1] || '';
      index += 1;
      if (!result.target) {
        throw new Error('Missing value after --to');
      }
      continue;
    }

    if (token === '--force') {
      result.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return result;
}

function parseProjectValue(raw) {
  const value = String(raw).trim();

  if (!value) {
    return '';
  }

  if (
    value.startsWith('{') ||
    value.startsWith('[') ||
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    /^-?\d+(\.\d+)?$/.test(value) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      // fall through to raw string
    }
  }

  return value;
}

function assignNestedField(target, fieldPath, value) {
  const parts = fieldPath
    .split('.')
    .map(item => item.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error('Field path is empty');
  }

  let current = target;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

function buildProjectShow(includeEffective, fieldPath) {
  const resolved = resolveSession();
  const projectConfig = getProjectConfig();
  const output = {
    path: path.join(resolveProjectRoot(), 'emb-agent', 'project.json'),
    config: projectConfig
  };

  if (includeEffective) {
    output.effective = {
      project_profile: resolved.session.project_profile,
      active_packs: resolved.session.active_packs,
      preferences: getPreferences(resolved.session),
      agents: resolved.effective.agents,
      review_agents: resolved.effective.review_agents,
      review_axes: resolved.effective.review_axes,
      note_targets: resolved.effective.note_targets,
      suggested_tools: resolved.effective.suggested_tools,
      arch_review_triggers: resolved.effective.arch_review_triggers
    };
  }

  if (!fieldPath) {
    return output;
  }

  return {
    path: output.path,
    field: fieldPath,
    value: selectNestedField(output, fieldPath)
  };
}

function buildProjectConfigSeed() {
  const resolved = resolveSession();
  const existing = getProjectConfig();

  if (existing) {
    return existing;
  }

  return runtime.validateProjectConfig(
    {
      project_profile: resolved.session.project_profile,
      active_packs: resolved.session.active_packs,
      adapter_sources: [],
      preferences: getPreferences(resolved.session),
      integrations: {},
      arch_review: {}
    },
    RUNTIME_CONFIG
  );
}

function syncSessionWithProjectConfig(validated) {
  return updateSession(current => {
    current.project_profile = validated.project_profile || current.project_profile;
    current.active_packs = validated.active_packs;
    current.preferences = validated.preferences;
  });
}

function writeProjectConfig(validated) {
  initProjectLayout();
  const projectConfigPath = path.join(resolveProjectRoot(), 'emb-agent', 'project.json');
  runtime.writeJson(projectConfigPath, validated);
  const session = syncSessionWithProjectConfig(validated);

  return {
    path: projectConfigPath,
    config: validated,
    session: {
      project_profile: session.project_profile,
      active_packs: session.active_packs,
      preferences: session.preferences
    }
  };
}

function setProjectConfigValue(fieldPath, rawValue) {
  const nextConfig = JSON.parse(JSON.stringify(buildProjectConfigSeed()));

  assignNestedField(nextConfig, fieldPath, parseProjectValue(rawValue));
  const validated = runtime.validateProjectConfig(nextConfig, RUNTIME_CONFIG);
  const saved = writeProjectConfig(validated);

  return {
    path: saved.path,
    field: fieldPath,
    value: selectNestedField(validated, fieldPath),
    config: validated,
    session: saved.session
  };
}

function buildAdapterStatus(name) {
  const projectConfig = buildProjectConfigSeed();
  const sources = adapterSources.listSourceStatus(ROOT, resolveProjectRoot(), projectConfig);

  if (!name) {
    return {
      project_root: resolveProjectRoot(),
      adapter_sources: sources
    };
  }

  const matched = sources.find(item => item.name === name);
  if (!matched) {
    throw new Error(`Adapter source not found: ${name}`);
  }

  return matched;
}

function addAdapterSource(name, tokens) {
  const sourceName = String(name || '').trim();
  if (!sourceName) {
    throw new Error('Missing source name');
  }

  const parsed = parseAdapterSourceAddArgs(tokens);
  const nextConfig = JSON.parse(JSON.stringify(buildProjectConfigSeed()));
  const nextSource = runtime.validateAdapterSource(
    {
      name: sourceName,
      ...parsed
    },
    0
  );
  const sources = nextConfig.adapter_sources || [];
  const existingIndex = sources.findIndex(item => item.name === sourceName);

  if (existingIndex >= 0) {
    sources[existingIndex] = nextSource;
  } else {
    sources.push(nextSource);
  }

  const validated = runtime.validateProjectConfig(nextConfig, RUNTIME_CONFIG);
  const saved = writeProjectConfig(validated);

  return {
    action: existingIndex >= 0 ? 'updated' : 'added',
    source: nextSource,
    path: saved.path,
    config: saved.config,
    session: saved.session
  };
}

function removeAdapterSource(name) {
  const sourceName = String(name || '').trim();
  if (!sourceName) {
    throw new Error('Missing source name');
  }

  const nextConfig = JSON.parse(JSON.stringify(buildProjectConfigSeed()));
  const sources = nextConfig.adapter_sources || [];
  const existing = sources.find(item => item.name === sourceName);

  if (!existing) {
    throw new Error(`Adapter source not found: ${sourceName}`);
  }

  nextConfig.adapter_sources = sources.filter(item => item.name !== sourceName);
  const validated = runtime.validateProjectConfig(nextConfig, RUNTIME_CONFIG);
  const saved = writeProjectConfig(validated);

  return {
    action: 'removed',
    source: existing,
    cleanup: [
      adapterSources.removeSyncedSource(ROOT, resolveProjectRoot(), sourceName, 'project'),
      adapterSources.removeSyncedSource(ROOT, resolveProjectRoot(), sourceName, 'runtime')
    ],
    path: saved.path,
    config: saved.config,
    session: saved.session
  };
}

function syncNamedAdapterSource(name, options) {
  const sourceName = String(name || '').trim();
  if (!sourceName) {
    throw new Error('Missing source name');
  }

  initProjectLayout();
  const projectConfig = buildProjectConfigSeed();
  const source = adapterSources.findSource(projectConfig, sourceName);

  if (!source) {
    throw new Error(`Adapter source not found: ${sourceName}`);
  }

  return adapterSources.syncAdapterSource(ROOT, resolveProjectRoot(), source, options || {});
}

function syncAllAdapterSources(options) {
  initProjectLayout();
  const projectConfig = buildProjectConfigSeed();

  return {
    project_root: resolveProjectRoot(),
    target: (options && options.target) || 'project',
    results: adapterSources.syncAllAdapterSources(
      ROOT,
      resolveProjectRoot(),
      projectConfig,
      options || {}
    )
  };
}

function buildReviewContext() {
  const resolved = resolveSession();

  return {
    project_root: resolved.session.project_root,
    focus: resolved.session.focus || '',
    profile: resolved.profile.name,
    packs: resolved.session.active_packs,
    runtime_model: resolved.profile.runtime_model || '',
    concurrency_model: resolved.profile.concurrency_model || '',
    review_agents: resolved.effective.review_agents,
    review_axes: resolved.effective.review_axes,
    focus_areas: resolved.effective.focus_areas,
    guardrails: resolved.effective.guardrails,
    arch_review_triggers: resolved.effective.arch_review_triggers,
    known_risks: resolved.session.known_risks,
    open_questions: resolved.session.open_questions,
    last_files: resolved.session.last_files
  };
}

function shouldSuggestArchReview(resolved) {
  const session = resolved.session;
  const texts = runtime.unique([
    session.focus || '',
    ...(session.open_questions || []),
    ...(session.known_risks || [])
  ]).filter(Boolean);
  const patterns = runtime.unique(resolved.effective.arch_review_triggers || []).filter(Boolean);

  return texts.some(text =>
    patterns.some(pattern => text.toLowerCase().includes(String(pattern).toLowerCase()))
  );
}

function buildArchReviewContext() {
  const review = buildReviewContext();

  return {
    ...review,
    mode: 'heavyweight_architecture_review',
    suggested_agent: 'emb-arch-reviewer',
    recommended_template: {
      name: 'architecture-review',
      output: 'docs/ARCH-REVIEW.md',
      cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs template fill architecture-review --force'
    },
    checkpoints: [
      'Deep Requirement Interrogation',
      'Trinity Diagram Protocol',
      'Scenario Simulation',
      'Evaluation Matrix',
      'Pre-Mortem'
    ],
    trigger_patterns: review.arch_review_triggers,
    warning: '这是显式重型审查入口，只在选型、方案预审、PoC 转量产或失败预演场景使用'
  };
}

function buildNextCommand(resolved, handoff) {
  const session = resolved.session;
  const preferences = getPreferences(session);
  const openQuestions = session.open_questions || [];
  const knownRisks = session.known_risks || [];
  const lastFiles = session.last_files || [];
  const focus = session.focus || '';
  const hasActiveContext =
    focus.trim() !== '' ||
    lastFiles.length > 0 ||
    openQuestions.length > 0 ||
    knownRisks.length > 0 ||
    Boolean(handoff);

  if (openQuestions.length > 0) {
    return {
      command: 'debug',
      reason: `存在未决问题，先围绕 "${openQuestions[0]}" 收敛根因`
    };
  }

  if (preferences.review_mode === 'always') {
    return {
      command: 'review',
      reason: '当前偏好要求先做 review，再决定执行路径'
    };
  }

  if (shouldSuggestArchReview(resolved)) {
    return {
      command: 'arch-review',
      reason: '当前上下文带有选型或方案预审信号，先做一次系统级架构审查'
    };
  }

  if (shouldSuggestReview(resolved)) {
    return {
      command: 'review',
      reason:
        preferences.review_mode === 'always'
          ? '当前偏好要求先做 review，再决定执行路径'
          : '当前 review 信号成立，先做结构性 review 再决定执行路径'
    };
  }

  if (shouldSuggestPlan(resolved)) {
    return {
      command: 'plan',
      reason:
        preferences.plan_mode === 'always'
          ? '当前偏好要求先做 micro-plan 再执行'
          : '当前已进入复杂任务信号，先做 micro-plan 再执行'
    };
  }

  if (!hasActiveContext) {
    return {
      command: 'scan',
      reason: '当前还没有有效工作上下文，先做一次最小 scan'
    };
  }

  if (lastFiles.length === 0) {
    return {
      command: 'scan',
      reason: '当前没有最近文件记录，先补一次 scan 锁定真实改动点'
    };
  }

  return {
    command: 'do',
    reason: '上下文已经足够，直接进入最小执行'
  };
}

function buildContextHygiene(resolved, handoff, currentCommand) {
  const session = resolved.session;
  const focus = session.focus || '';
  const openQuestions = session.open_questions || [];
  const knownRisks = session.known_risks || [];
  const lastFiles = session.last_files || [];
  const command = (currentCommand || session.last_command || '').trim();
  const heavyCommands = ['plan', 'review', 'debug', 'arch-review'];
  const reasons = [];
  let score = 0;

  if (lastFiles.length >= 5) {
    score += 2;
    reasons.push(`最近文件已累计 ${lastFiles.length} 个，说明上下文跨度开始变大`);
  } else if (lastFiles.length >= 3) {
    score += 1;
    reasons.push(`最近文件已有 ${lastFiles.length} 个，继续深挖前最好先收口`);
  }

  if (openQuestions.length >= 2) {
    score += 2;
    reasons.push(`当前还有 ${openQuestions.length} 个未决问题`);
  } else if (openQuestions.length === 1) {
    score += 1;
    reasons.push('当前仍有未决问题挂起');
  }

  if (knownRisks.length >= 2) {
    score += 2;
    reasons.push(`当前还有 ${knownRisks.length} 个已知风险待跟踪`);
  } else if (knownRisks.length === 1) {
    score += 1;
    reasons.push('当前已有风险项挂起');
  }

  if (focus.trim() !== '' && heavyCommands.includes(command)) {
    score += 1;
    reasons.push(`最近命令是 ${command}，且仍围绕 focus 深挖`);
  }

  if (handoff) {
    score += 2;
    reasons.push('已存在 pause handoff，可像 GSD 一样清空后直接 resume');
  }

  let level = 'stable';
  if (handoff || score >= 5) {
    level = 'suggest-clearing';
  } else if (score >= 2) {
    level = 'consider-clearing';
  }

  let recommendation = '当前上下文还轻，不需要主动清除。';
  if (level === 'consider-clearing') {
    recommendation = handoff
      ? '上下文开始变重；如果准备切换任务或继续深挖，可以直接清除上下文，随后执行 resume 接回。'
      : '上下文开始变重；如果准备切换任务或继续深挖，建议先执行 pause，再清除上下文，后续用 resume 接回。';
  } else if (level === 'suggest-clearing') {
    recommendation = handoff
      ? '当前上下文已变重，且已有 handoff；建议现在清除上下文，随后执行 resume 接回。'
      : '当前上下文已变重，建议现在先执行 pause，然后清除上下文，后续用 resume 接回。';
  }

  return {
    level,
    reasons,
    recommendation,
    pause_cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs pause',
    resume_cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs resume',
    clear_hint: handoff ? 'clear -> resume' : 'pause -> clear -> resume',
    handoff_ready: Boolean(handoff)
  };
}

function buildGuidance(resolved, handoff) {
  const session = resolved.session;
  const focus = session.focus || '';
  const openQuestions = session.open_questions || [];
  const knownRisks = session.known_risks || [];
  const lastFiles = session.last_files || [];
  const suggestedFlow = handoff && handoff.suggested_flow
    ? handoff.suggested_flow
    : suggestFlow(resolved);
  const next = buildNextCommand(resolved, handoff);
  const contextHygiene = buildContextHygiene(resolved, handoff, next.command);

  return {
    suggested_flow: suggestedFlow,
    next,
    next_actions: runtime.unique([
      handoff && handoff.next_action ? `按 handoff 恢复: ${handoff.next_action}` : '',
      ...(handoff ? handoff.human_actions_pending.map(action => `需要人工动作: ${action}`) : []),
      focus ? `先围绕 focus "${focus}" 继续` : '',
      lastFiles[0] ? `先重读 ${lastFiles[0]}` : '',
      openQuestions[0] ? `优先确认问题: ${openQuestions[0]}` : '',
      knownRisks[0] ? `复查风险: ${knownRisks[0]}` : '',
      contextHygiene.level === 'consider-clearing'
        ? `上下文提醒: ${contextHygiene.recommendation}`
        : '',
      contextHygiene.level === 'suggest-clearing'
        ? `上下文提醒: ${contextHygiene.recommendation}`
        : '',
      `建议流程: ${suggestedFlow}`,
      `建议命令: ${next.command} (${next.reason})`
    ])
  };
}

function buildResumeContext() {
  const resolved = resolveSession();
  const handoff = loadHandoff();
  const guidance = buildGuidance(resolved, handoff);
  const contextHygiene = buildContextHygiene(resolved, handoff, 'resume');

  return enrichWithToolSuggestions({
    summary: {
      project_root: resolved.session.project_root,
      profile: resolved.session.project_profile,
      packs: resolved.session.active_packs,
      focus: resolved.session.focus || '',
      preferences: getPreferences(resolved.session),
      suggested_flow: guidance.suggested_flow,
      resume_source: handoff ? 'handoff' : 'session',
      paused_at: resolved.session.paused_at || '',
      last_command: resolved.session.last_command || '',
      last_resumed_at: resolved.session.last_resumed_at || ''
    },
    effective: {
      agents: resolved.effective.agents,
      review_agents: resolved.effective.review_agents,
      review_axes: resolved.effective.review_axes,
      note_targets: resolved.effective.note_targets
    },
    handoff: handoff
      ? {
          timestamp: handoff.timestamp,
          status: handoff.status,
          next_action: handoff.next_action,
          context_notes: handoff.context_notes,
          human_actions_pending: handoff.human_actions_pending,
          last_files: handoff.last_files
        }
      : null,
    carry_over: {
      last_files: resolved.session.last_files || [],
      open_questions: resolved.session.open_questions || [],
      known_risks: resolved.session.known_risks || []
    },
    context_hygiene: contextHygiene,
    next_actions: guidance.next_actions
  }, resolved);
}

function buildNextContext() {
  const resolved = resolveSession();
  const handoff = loadHandoff();
  const guidance = buildGuidance(resolved, handoff);
  const contextHygiene = buildContextHygiene(resolved, handoff, guidance.next.command);

  return enrichWithToolSuggestions({
    current: {
      project_root: resolved.session.project_root,
      profile: resolved.profile.name,
      packs: resolved.session.active_packs,
      focus: resolved.session.focus || '',
      preferences: getPreferences(resolved.session),
      last_command: resolved.session.last_command || '',
      suggested_flow: guidance.suggested_flow,
      resume_source: handoff ? 'handoff' : 'session',
      last_files: resolved.session.last_files || [],
      open_questions: resolved.session.open_questions || [],
      known_risks: resolved.session.known_risks || []
    },
    handoff: handoff
      ? {
          next_action: handoff.next_action,
          context_notes: handoff.context_notes,
          human_actions_pending: handoff.human_actions_pending,
          timestamp: handoff.timestamp
        }
      : null,
    next: {
      command: guidance.next.command,
      reason: guidance.next.reason,
      skill: `$emb-${guidance.next.command}`,
      cli: `node ~/.codex/emb-agent/bin/emb-agent.cjs ${guidance.next.command}`
    },
    context_hygiene: contextHygiene,
    next_actions: guidance.next_actions
  }, resolved);
}

function shouldSuggestPlan(resolved) {
  const session = resolved.session;
  const focus = session.focus || '';
  const mode = getPreferences(session).plan_mode;

  if (mode === 'always') {
    return true;
  }
  if (mode === 'never') {
    return false;
  }

  return (
    (session.known_risks || []).length > 0 ||
    (session.last_files || []).length > 1 ||
    (focus && focus.length > 0)
  );
}

function shouldSuggestReview(resolved) {
  const session = resolved.session;
  const mode = getPreferences(session).review_mode;
  const isComplexRuntime = resolved.profile.runtime_model !== 'main_loop_plus_isr';
  const hasWideReviewSurface =
    (resolved.effective.review_agents || []).length > 2 ||
    (resolved.effective.review_axes || []).length > 6;

  if (mode === 'always') {
    return true;
  }
  if (mode === 'never') {
    return false;
  }

  return isComplexRuntime && hasWideReviewSurface;
}

function suggestFlow(resolved) {
  const session = resolved.session;
  const preferences = getPreferences(session);
  const openQuestions = session.open_questions || [];
  const hasActiveContext =
    (session.focus || '').trim() !== '' ||
    (session.last_files || []).length > 0 ||
    openQuestions.length > 0 ||
    (session.known_risks || []).length > 0;

  if (openQuestions.length > 0) {
    return 'scan -> debug -> do -> verify';
  }
  if (preferences.review_mode === 'always') {
    return 'scan -> review -> do -> verify';
  }
  if (shouldSuggestArchReview(resolved)) {
    return 'scan -> arch-review -> plan -> do -> verify';
  }
  if (shouldSuggestReview(resolved)) {
    return 'scan -> review -> do -> verify';
  }
  if (shouldSuggestPlan(resolved)) {
    return 'scan -> plan -> do -> verify';
  }
  return 'scan -> do -> verify';
}

function buildPausePayload(noteText) {
  const resolved = resolveSession();
  const suggestedFlow = suggestFlow(resolved);
  const focus = resolved.session.focus || '';
  const nextAction = noteText && noteText.trim()
    ? noteText.trim()
    : (
        suggestedFlow.includes('debug')
          ? '先围绕未决问题执行 debug，再决定是否进入 do'
          : suggestedFlow.includes('plan')
            ? '先执行 plan，锁定真值、约束、风险和步骤'
            : suggestedFlow.includes('review')
              ? '先执行 review，确认结构风险后再动手'
              : '先执行 scan，再直接推进 do'
      );

  return {
    version: '1.0',
    timestamp: new Date().toISOString(),
    status: 'paused',
    focus,
    profile: resolved.profile.name,
    packs: resolved.session.active_packs,
    last_command: resolved.session.last_command || '',
    suggested_flow: suggestedFlow,
    next_action: nextAction,
    context_notes: noteText || '',
    human_actions_pending: [],
    last_files: resolved.session.last_files || [],
    open_questions: resolved.session.open_questions || [],
    known_risks: resolved.session.known_risks || []
  };
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function runTemplateScript(args) {
  templateCli.runTemplateCli(args);
}

function getTemplateConfig() {
  return runtime.validateTemplateConfig(
    runtime.readJson(path.join(TEMPLATES_DIR, 'config.json'))
  );
}

function usage() {
  const text = [
    'emb-agent usage:',
    '  init [--profile <name>] [--pack <name>] [--mcu <name>] [--board <name>] [--target <name>] [--goal <text>] [--force]',
    '  ingest hardware [--mcu <name>] [--board <name>] [--target <name>] [--truth <text>] [--constraint <text>] [--unknown <text>] [--source <path>]',
    '  ingest requirements [--goal <text>] [--feature <text>] [--constraint <text>] [--accept <text>] [--failure <text>] [--unknown <text>] [--source <path>]',
    '  ingest doc --file <path> [--provider mineru] [--kind datasheet] [--title <text>] [--pages <range>] [--language ch|en] [--ocr] [--force] [--to hardware|requirements]',
    '  ingest apply doc <doc-id> --to hardware|requirements [--only field1,field2] [--force]',
    '  ingest apply doc <doc-id> --from-last-diff',
    '  ingest apply doc <doc-id> --preset <name>',
    '  doc list',
    '  doc show <doc-id> [--preset <name>] [--apply-ready]',
    '  doc diff <doc-id> --to hardware|requirements [--only field1,field2] [--force] [--save-as <name>]',
    '  status',
    '  next',
    '  pause [note]',
    '  pause show',
    '  pause clear',
    '  resume',
    '  resolve',
    '  config show',
    '  project show [--effective] [--field <path>]',
    '  project set --field <path> --value <json-or-string>',
    '  scan',
    '  scan save <target> <summary> [--fact <text>] [--question <text>] [--read <text>]',
    '  plan',
    '  plan save <summary> [--target <target>] [--risk <text>] [--step <text>] [--verify <text>]',
    '  arch-review',
    '  do',
    '  debug',
    '  review',
    '  review save <summary> [--scope <text>] [--finding <text>] [--check <text>]',
    '  note',
    '  note add <target> <summary> [--kind <kind>] [--evidence <text>] [--unverified <text>]',
    '  dispatch show <action>',
    '  dispatch next',
    '  schedule show <action>',
    '  template list',
    '  template show <name>',
    '  template fill <name> [--output <path>] [--field KEY=VALUE] [--force]',
    '  review context',
    '  review axes',
    '  note targets',
    '  adapter status [<name>]',
    '  adapter source list',
    '  adapter source show <name>',
    '  adapter source add <name> --type path|git --location <path-or-url> [--branch <name>] [--subdir <path>] [--disabled]',
    '  adapter source remove <name>',
    '  adapter sync <name> [--to project|runtime] [--force]',
    '  adapter sync --all [--to project|runtime] [--force]',
    '  tool list',
    '  tool show <name>',
    '  tool run <name> [--family <name>] [--device <name>] [tool options]',
    '  tool family list',
    '  tool family show <name>',
    '  tool device list',
    '  tool device show <name>',
    '  chip list',
    '  chip show <name>',
    '  agents list',
    '  agents show <name>',
    '  commands list',
    '  commands show <name>',
    '  profile list',
    '  profile show <name>',
    '  profile set <name>',
    '  prefs show',
    '  prefs set <key> <value>',
    '  prefs reset',
    '  pack list',
    '  pack show <name>',
    '  pack add <name>',
    '  pack remove <name>',
    '  pack clear',
    '  focus get',
    '  focus set <text>',
    '  last-files list',
    '  last-files add <path>',
    '  last-files remove <path>',
    '  last-files clear',
    '  question list',
    '  question add <text>',
    '  question remove <text>',
    '  question clear',
    '  risk list',
    '  risk add <text>',
    '  risk remove <text>',
    '  risk clear',
    '  session show'
  ].join('\n');

  process.stdout.write(text + '\n');
}

function runInitCommand(tokens, aliasUsed) {
  const rest = tokens || [];
  if (rest.includes('--help') || rest.includes('-h')) {
    usage();
    return null;
  }

  const hasInitOptions = rest.some(token =>
    [
      '--profile',
      '--pack',
      '--mcu',
      '--board',
      '--target',
      '--goal',
      '--force'
    ].includes(token)
  );
  const existingProjectConfig = path.join(resolveProjectRoot(), 'emb-agent', 'project.json');

  if (fs.existsSync(existingProjectConfig) && !hasInitOptions) {
    initProjectLayout();
    const session = ensureSession();
    return {
      initialized: true,
      reused_existing: true,
      init_alias: aliasUsed || 'init',
      session_version: session.session_version,
      project_root: session.project_root,
      project_dir: path.relative(process.cwd(), getProjectExtDir()) || 'emb-agent',
      project_profile: session.project_profile,
      active_packs: session.active_packs
    };
  }

  const attached = attachProjectCli.attachProject(rest);
  initProjectLayout();
  const session = updateSession(current => {
    current.last_command = 'init';
    current.last_files = runtime
      .unique([...(attached.detected.code || []), ...(attached.detected.projects || []), ...(current.last_files || [])])
      .slice(0, RUNTIME_CONFIG.max_last_files);
  });

  return {
    ...attached,
    initialized: true,
    init_alias: aliasUsed || 'init',
    session: {
      project_profile: session.project_profile,
      active_packs: session.active_packs,
      last_files: session.last_files
    }
  };
}

function requireRestText(rest, label) {
  const value = rest.join(' ').trim();
  if (!value) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function requirePreferenceKey(key) {
  const keys = Object.keys(RUNTIME_CONFIG.default_preferences || {});
  if (!keys.includes(key)) {
    throw new Error(`Unknown preference key: ${key}`);
  }
  return key;
}

function parseNoteAddArgs(tokens) {
  const result = {
    target: tokens[0] || '',
    summaryParts: [],
    evidence: [],
    unverified: [],
    kind: ''
  };

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--evidence') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --evidence');
      result.evidence.push(value);
      index += 1;
      continue;
    }

    if (token === '--unverified') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --unverified');
      result.unverified.push(value);
      index += 1;
      continue;
    }

    if (token === '--kind') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --kind');
      result.kind = value;
      index += 1;
      continue;
    }

    result.summaryParts.push(token);
  }

  if (!result.target) {
    throw new Error('Missing note target');
  }

  return {
    target: result.target,
    summary: result.summaryParts.join(' ').trim(),
    evidence: result.evidence,
    unverified: result.unverified,
    kind: result.kind.trim()
  };
}

function normalizeTargetAlias(targetPath) {
  const normalized = targetPath.replace(/\\/g, '/');
  const base = path.basename(normalized, path.extname(normalized)).toLowerCase();

  if (base === 'hardware-logic') return 'hardware';
  if (base === 'debug-notes') return 'debug';
  if (base === 'connectivity') return 'connectivity';
  if (base === 'release-notes') return 'release';
  if (base === 'arch') return 'arch';
  return base;
}

function resolveKnownDocTarget(rawTarget) {
  const normalized = rawTarget.trim().toLowerCase();
  const aliases = {
    hardware: 'docs/HARDWARE-LOGIC.md',
    debug: 'docs/DEBUG-NOTES.md',
    connectivity: 'docs/CONNECTIVITY.md',
    release: 'docs/RELEASE-NOTES.md',
    review: 'docs/REVIEW-REPORT.md',
    arch: 'docs/ARCH.md'
  };

  if (aliases[normalized]) {
    return aliases[normalized];
  }

  return rawTarget.trim();
}

function resolveNoteTarget(resolved, rawTarget) {
  const targets = resolved.effective.note_targets || [];
  const target = resolveKnownDocTarget(rawTarget);

  if (targets.includes(target)) {
    return target;
  }

  const normalized = target.toLowerCase();
  const matches = targets.filter(item => {
    const alias = normalizeTargetAlias(item);
    return alias === normalized || path.basename(item).toLowerCase() === normalized;
  });

  if (matches.length === 1) {
    return matches[0];
  }

  throw new Error(`Unknown note target: ${rawTarget}`);
}

function ensureNoteTargetDoc(targetPath) {
  const absolutePath = path.resolve(process.cwd(), targetPath);

  if (fs.existsSync(absolutePath)) {
    return { created: false, path: absolutePath, template: '' };
  }

  const templates = getTemplateConfig();
  const templateEntry = Object.entries(templates).find(([, meta]) => meta.default_output === targetPath);

  if (templateEntry) {
    const [templateName, meta] = templateEntry;
    const context = templateCli.buildContext({});
    const content = templateCli.applyTemplate(
      runtime.readText(path.join(TEMPLATES_DIR, meta.source)),
      context
    );
    runtime.ensureDir(path.dirname(absolutePath));
    fs.writeFileSync(absolutePath, content, 'utf8');
    return { created: true, path: absolutePath, template: templateName };
  }

  runtime.ensureDir(path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, `# ${path.basename(targetPath)}\n`, 'utf8');
  return { created: true, path: absolutePath, template: '' };
}

function buildNoteEntry(noteInput) {
  const timestamp = new Date().toISOString();
  const lines = [
    `### ${timestamp}${noteInput.kind ? ` | ${noteInput.kind}` : ''}`,
    `- Summary: ${noteInput.summary}`
  ];

  if (noteInput.evidence.length > 0) {
    lines.push('- Evidence:');
    for (const item of noteInput.evidence) {
      lines.push(`  - ${item}`);
    }
  }

  if (noteInput.unverified.length > 0) {
    lines.push('- Unverified:');
    for (const item of noteInput.unverified) {
      lines.push(`  - ${item}`);
    }
  }

  return lines.join('\n') + '\n';
}

function appendNoteEntryToDoc(content, entry) {
  const marker = '## Emb-Agent Notes';
  const normalized = content.endsWith('\n') ? content : `${content}\n`;

  if (!normalized.includes(marker)) {
    return `${normalized.trimEnd()}\n\n${marker}\n\n${entry}`;
  }

  return normalized.replace(marker, `${marker}\n\n${entry.trimEnd()}`);
}

function parseReviewSaveArgs(tokens) {
  const result = {
    summaryParts: [],
    findings: [],
    checks: [],
    scope: ''
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--finding') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --finding');
      result.findings.push(value);
      index += 1;
      continue;
    }

    if (token === '--check') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --check');
      result.checks.push(value);
      index += 1;
      continue;
    }

    if (token === '--scope') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --scope');
      result.scope = value;
      index += 1;
      continue;
    }

    result.summaryParts.push(token);
  }

  return {
    summary: result.summaryParts.join(' ').trim(),
    findings: result.findings,
    checks: result.checks,
    scope: result.scope.trim()
  };
}

function buildReviewReportEntry(resolved, reviewInput) {
  const reviewOutput = scheduler.buildReviewOutput(resolved);
  const timestamp = new Date().toISOString();
  const lines = [
    `### ${timestamp}`,
    `- Summary: ${reviewInput.summary}`,
    `- Profile: ${reviewOutput.scope.profile}`,
    `- Packs: ${(reviewOutput.scope.packs || []).join(', ') || '-'}`,
    `- Scope: ${reviewInput.scope || reviewOutput.scope.focus || 'structural review'}`,
    '- Review axes:'
  ];

  for (const axis of reviewOutput.axes || []) {
    lines.push(`  - ${axis}`);
  }

  if (reviewInput.findings.length > 0) {
    lines.push('- Findings:');
    for (const finding of reviewInput.findings) {
      lines.push(`  - ${finding}`);
    }
  }

  lines.push('- Required checks:');
  for (const item of runtime.unique([
    ...reviewInput.checks,
    ...(reviewOutput.required_checks || [])
  ])) {
    lines.push(`  - ${item}`);
  }

  if ((reviewOutput.scope.focus_areas || []).length > 0) {
    lines.push('- Focus areas:');
    for (const area of reviewOutput.scope.focus_areas) {
      lines.push(`  - ${area}`);
    }
  }

  if ((reviewOutput.scheduler.supporting_agents || []).length > 0 || reviewOutput.scheduler.primary_agent) {
    lines.push(
      `- Review agents: ${runtime.unique([
        reviewOutput.scheduler.primary_agent,
        ...(reviewOutput.scheduler.supporting_agents || [])
      ]).join(', ')}`
    );
  }

  if ((reviewOutput.scheduler.output_shape || []).length > 0) {
    lines.push(`- Output shape: ${reviewOutput.scheduler.output_shape.join(', ')}`);
  }

  if ((reviewOutput.scheduler.safety_checks || []).length > 0) {
    lines.push('- Safety checks:');
    for (const item of reviewOutput.scheduler.safety_checks) {
      lines.push(`  - ${item}`);
    }
  }

  if ((reviewOutput.scheduler.focus_order || []).length > 0) {
    lines.push('- Focus order:');
    for (const item of reviewOutput.scheduler.focus_order) {
      lines.push(`  - ${item}`);
    }
  }

  if ((reviewOutput.scheduler.suggested_steps || []).length > 0) {
    lines.push('- Suggested steps:');
    for (const item of reviewOutput.scheduler.suggested_steps) {
      lines.push(`  - ${item}`);
    }
  }

  if ((reviewOutput.scheduler.packs || []).length > 0) {
    lines.push(`- Scheduler packs: ${reviewOutput.scheduler.packs.join(', ')}`);
  }

  if ((reviewOutput.scheduler.profile || '')) {
    lines.push(`- Scheduler profile: ${reviewOutput.scheduler.profile}`);
  }

  if ((reviewOutput.scope.runtime_model || '')) {
    lines.push(`- Runtime model: ${reviewOutput.scope.runtime_model}`);
  }

  if ((reviewOutput.scope.concurrency_model || '')) {
    lines.push(`- Concurrency model: ${reviewOutput.scope.concurrency_model}`);
  }

  lines.push('- Note targets:');
  for (const target of reviewOutput.scheduler.output_shape ? (resolved.effective.note_targets || []) : []) {
    lines.push(`  - ${target}`);
  }

  return lines.join('\n') + '\n';
}

function appendSectionEntry(content, marker, entry) {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;

  if (!normalized.includes(marker)) {
    return `${normalized.trimEnd()}\n\n${marker}\n\n${entry}`;
  }

  return normalized.replace(marker, `${marker}\n\n${entry.trimEnd()}`);
}

function findSummaryLine(entry) {
  const match = entry.match(/^- Summary:\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function splitSectionEntries(sectionContent) {
  const trimmed = sectionContent.trim();
  if (!trimmed) {
    return [];
  }

  return trimmed
    .split(/(?=^###\s)/m)
    .map(item => item.trim())
    .filter(Boolean);
}

function upsertSectionEntry(content, marker, entry) {
  const normalized = content.endsWith('\n') ? content : `${content}\n`;
  const summary = findSummaryLine(entry);

  if (!normalized.includes(marker)) {
    return `${normalized.trimEnd()}\n\n${marker}\n\n${entry}`;
  }

  const markerIndex = normalized.indexOf(marker);
  const before = normalized.slice(0, markerIndex + marker.length);
  const after = normalized.slice(markerIndex + marker.length);
  const entries = splitSectionEntries(after).filter(item => {
    if (!summary) {
      return true;
    }
    return findSummaryLine(item) !== summary;
  });

  const nextEntries = [entry.trimEnd(), ...entries];
  return `${before}\n\n${nextEntries.join('\n\n')}\n`;
}

function saveReviewReport(tokens) {
  const reviewInput = parseReviewSaveArgs(tokens);

  if (!reviewInput.summary) {
    throw new Error('Missing review summary');
  }

  const resolved = resolveSession();
  const target = 'docs/REVIEW-REPORT.md';
  const ensured = ensureNoteTargetDoc(target);
  const content = runtime.readText(ensured.path);
  const nextContent = upsertSectionEntry(
    content,
    '## Emb-Agent Reviews',
    buildReviewReportEntry(resolved, reviewInput)
  );

  fs.writeFileSync(ensured.path, nextContent, 'utf8');

  updateSession(current => {
    current.last_command = 'review save';
    current.last_files = runtime
      .unique([target, ...(current.last_files || [])])
      .slice(0, RUNTIME_CONFIG.max_last_files);
  });

  return {
    target,
    created: ensured.created,
    template: ensured.template,
    summary: reviewInput.summary,
    findings: reviewInput.findings,
    checks: reviewInput.checks,
    scope: reviewInput.scope || ''
  };
}

function parseScanSaveArgs(tokens) {
  const result = {
    target: tokens[0] || '',
    summaryParts: [],
    facts: [],
    questions: [],
    reads: []
  };

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--fact') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --fact');
      result.facts.push(value);
      index += 1;
      continue;
    }

    if (token === '--question') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --question');
      result.questions.push(value);
      index += 1;
      continue;
    }

    if (token === '--read') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --read');
      result.reads.push(value);
      index += 1;
      continue;
    }

    result.summaryParts.push(token);
  }

  return {
    target: result.target,
    summary: result.summaryParts.join(' ').trim(),
    facts: result.facts,
    questions: result.questions,
    reads: result.reads
  };
}

function parsePlanSaveArgs(tokens) {
  const result = {
    target: '',
    summaryParts: [],
    risks: [],
    steps: [],
    verification: []
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--target') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --target');
      result.target = value;
      index += 1;
      continue;
    }

    if (token === '--risk') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --risk');
      result.risks.push(value);
      index += 1;
      continue;
    }

    if (token === '--step') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --step');
      result.steps.push(value);
      index += 1;
      continue;
    }

    if (token === '--verify') {
      const value = tokens[index + 1] || '';
      if (!value) throw new Error('Missing value after --verify');
      result.verification.push(value);
      index += 1;
      continue;
    }

    result.summaryParts.push(token);
  }

  return {
    target: result.target.trim(),
    summary: result.summaryParts.join(' ').trim(),
    risks: result.risks,
    steps: result.steps,
    verification: result.verification
  };
}

function buildScanEntry(scanOutput, scanInput) {
  const timestamp = new Date().toISOString();
  const lines = [
    `### ${timestamp}`,
    `- Summary: ${scanInput.summary}`
  ];

  lines.push('- Relevant files:');
  for (const item of scanOutput.relevant_files || []) {
    lines.push(`  - ${item}`);
  }

  lines.push('- Key facts:');
  for (const item of runtime.unique([...(scanInput.facts || []), ...(scanOutput.key_facts || [])])) {
    lines.push(`  - ${item}`);
  }

  lines.push('- Open questions:');
  for (const item of runtime.unique([...(scanInput.questions || []), ...(scanOutput.open_questions || [])])) {
    lines.push(`  - ${item}`);
  }

  lines.push('- Next reads:');
  for (const item of runtime.unique([...(scanInput.reads || []), ...(scanOutput.next_reads || [])])) {
    lines.push(`  - ${item}`);
  }

  if (scanOutput.scheduler && scanOutput.scheduler.focus_order && scanOutput.scheduler.focus_order.length > 0) {
    lines.push('- Focus order:');
    for (const item of scanOutput.scheduler.focus_order) {
      lines.push(`  - ${item}`);
    }
  }

  return lines.join('\n') + '\n';
}

function buildPlanEntry(planOutput, planInput) {
  const timestamp = new Date().toISOString();
  const lines = [
    `### ${timestamp}`,
    `- Summary: ${planInput.summary}`,
    `- Goal: ${planOutput.goal}`
  ];

  lines.push('- Truth sources:');
  for (const item of planOutput.truth_sources || []) {
    lines.push(`  - ${item}`);
  }

  lines.push('- Constraints:');
  for (const item of planOutput.constraints || []) {
    lines.push(`  - ${item}`);
  }

  lines.push('- Risks:');
  for (const item of runtime.unique([...(planInput.risks || []), ...(planOutput.risks || [])])) {
    lines.push(`  - ${item}`);
  }

  lines.push('- Steps:');
  for (const item of runtime.unique([...(planInput.steps || []), ...(planOutput.steps || [])])) {
    lines.push(`  - ${item}`);
  }

  lines.push('- Verification:');
  for (const item of runtime.unique([...(planInput.verification || []), ...(planOutput.verification || [])])) {
    lines.push(`  - ${item}`);
  }

  if (planOutput.scheduler && (planOutput.scheduler.focus_order || []).length > 0) {
    lines.push('- Focus order:');
    for (const item of planOutput.scheduler.focus_order) {
      lines.push(`  - ${item}`);
    }
  }

  if (planOutput.scheduler && planOutput.scheduler.primary_agent) {
    lines.push(`- Primary agent: ${planOutput.scheduler.primary_agent}`);
  }

  return lines.join('\n') + '\n';
}

function syncHardwareTruthFromScan(target, scanInput) {
  if (target !== 'docs/HARDWARE-LOGIC.md') {
    return false;
  }

  if (
    (scanInput.facts || []).length === 0 &&
    (scanInput.questions || []).length === 0 &&
    (scanInput.reads || []).length === 0
  ) {
    return false;
  }

  ingestTruthCli.ingestHardware(resolveProjectRoot(), {
    mcu: '',
    board: '',
    target: '',
    truths: scanInput.facts || [],
    constraints: [],
    unknowns: scanInput.questions || [],
    sources: scanInput.reads || [],
    force: false
  });

  return true;
}

function saveScanReport(tokens) {
  const scanInput = parseScanSaveArgs(tokens);

  if (!scanInput.target) {
    throw new Error('Missing scan target');
  }
  if (!scanInput.summary) {
    throw new Error('Missing scan summary');
  }

  const resolved = resolveSession();
  const target = resolveKnownDocTarget(scanInput.target);
  const ensured = ensureNoteTargetDoc(target);
  const scanOutput = scheduler.buildScanOutput(resolved);
  const content = runtime.readText(ensured.path);
  const nextContent = upsertSectionEntry(
    content,
    '## Emb-Agent Scans',
    buildScanEntry(scanOutput, scanInput)
  );

  fs.writeFileSync(ensured.path, nextContent, 'utf8');
  const syncedTruth = syncHardwareTruthFromScan(target, scanInput);

  updateSession(current => {
    current.last_command = 'scan save';
    current.last_files = runtime
      .unique([target, syncedTruth ? 'emb-agent/hw.yaml' : '', ...(current.last_files || [])])
      .slice(0, RUNTIME_CONFIG.max_last_files);
  });

  return {
    target,
    created: ensured.created,
    template: ensured.template,
    summary: scanInput.summary,
    facts: scanInput.facts,
    questions: scanInput.questions,
    reads: scanInput.reads,
    synced_truth: syncedTruth
  };
}

function syncRequirementsFromPlan(planInput) {
  if (!planInput.summary && (planInput.verification || []).length === 0) {
    return false;
  }

  ingestTruthCli.ingestRequirements(resolveProjectRoot(), {
    goals: planInput.summary ? [planInput.summary] : [],
    features: [],
    constraints: [],
    acceptance: planInput.verification || [],
    failurePolicy: [],
    unknowns: [],
    sources: [],
    force: false
  });

  return true;
}

function savePlanReport(tokens) {
  const planInput = parsePlanSaveArgs(tokens);

  if (!planInput.summary) {
    throw new Error('Missing plan summary');
  }

  const resolved = resolveSession();
  const target = resolveKnownDocTarget(planInput.target || 'debug');
  const ensured = ensureNoteTargetDoc(target);
  const planOutput = scheduler.buildPlanOutput(resolved);
  const content = runtime.readText(ensured.path);
  const nextContent = upsertSectionEntry(
    content,
    '## Emb-Agent Plans',
    buildPlanEntry(planOutput, planInput)
  );

  fs.writeFileSync(ensured.path, nextContent, 'utf8');
  const syncedReq = syncRequirementsFromPlan(planInput);

  updateSession(current => {
    current.last_command = 'plan save';
    current.last_files = runtime
      .unique([target, syncedReq ? 'emb-agent/req.yaml' : '', ...(current.last_files || [])])
      .slice(0, RUNTIME_CONFIG.max_last_files);
  });

  return {
    target,
    created: ensured.created,
    template: ensured.template,
    summary: planInput.summary,
    risks: planInput.risks,
    steps: planInput.steps,
    verification: planInput.verification,
    synced_requirements: syncedReq
  };
}

function addNoteEntry(tokens) {
  const noteInput = parseNoteAddArgs(tokens);

  if (!noteInput.summary) {
    throw new Error('Missing note summary');
  }

  const resolved = resolveSession();
  const target = resolveNoteTarget(resolved, noteInput.target);
  const ensured = ensureNoteTargetDoc(target);
  const content = runtime.readText(ensured.path);
  const nextContent = upsertSectionEntry(
    content,
    '## Emb-Agent Notes',
    buildNoteEntry(noteInput)
  );

  fs.writeFileSync(ensured.path, nextContent, 'utf8');
  const syncedTruth =
    target === 'docs/HARDWARE-LOGIC.md' &&
    noteInput.kind === 'hardware_truth'
      ? (() => {
          ingestTruthCli.ingestHardware(resolveProjectRoot(), {
            mcu: '',
            board: '',
            target: '',
            truths: [noteInput.summary],
            constraints: [],
            unknowns: noteInput.unverified || [],
            sources: noteInput.evidence || [],
            force: false
          });
          return true;
        })()
      : false;

  updateSession(current => {
    current.last_command = 'note add';
    current.last_files = runtime
      .unique([target, syncedTruth ? 'emb-agent/hw.yaml' : '', ...(current.last_files || [])])
      .slice(0, RUNTIME_CONFIG.max_last_files);
  });

  return {
    target,
    created: ensured.created,
    template: ensured.template,
    kind: noteInput.kind || '',
    summary: noteInput.summary,
    evidence: noteInput.evidence,
    unverified: noteInput.unverified,
    synced_truth: syncedTruth
  };
}

function buildActionOutput(action) {
  const resolved = resolveSession();
  const handoff = loadHandoff();
  let output;

  if (action === 'scan') {
    output = scheduler.buildScanOutput(resolved);
  } else if (action === 'plan') {
    output = scheduler.buildPlanOutput(resolved);
  } else if (action === 'do') {
    output = scheduler.buildDoOutput(resolved);
  } else if (action === 'debug') {
    output = scheduler.buildDebugOutput(resolved);
  } else if (action === 'review') {
    output = scheduler.buildReviewOutput(resolved);
  } else if (action === 'note') {
    output = scheduler.buildNoteOutput(resolved);
  } else {
    throw new Error(`Unsupported action: ${action}`);
  }

  return enrichWithToolSuggestions({
    ...output,
    agent_execution: output.scheduler && output.scheduler.agent_execution
      ? output.scheduler.agent_execution
      : scheduler.buildAgentExecution(action, resolved),
    context_hygiene: buildContextHygiene(resolved, handoff, action)
  }, resolved);
}

function buildArchReviewDispatchContext() {
  const context = buildArchReviewContext();

  return {
    requested_action: 'arch-review',
    resolved_action: 'arch-review',
    reason: context.warning,
    skill: '$emb-arch-review',
    cli: 'node ~/.codex/emb-agent/bin/emb-agent.cjs arch-review',
    dispatch_ready: true,
    agent_execution: {
      available: true,
      spawn_available: true,
      recommended: true,
      inline_ok: false,
      mode: 'primary-recommended',
      reason: '显式架构预审应直接交给 emb-arch-reviewer 主导。',
      primary_agent: context.suggested_agent,
      supporting_agents: runtime.unique(context.review_agents || []),
      dispatch_contract: {
        launch_via: 'installed-codex-agent',
        auto_invoke_when_recommended: true,
        primary_first: true,
        parallel_safe: runtime.unique(context.review_agents || []),
        do_not_parallelize: [
          '不要把架构预审拆成多个相互竞争的可写 agent',
          '不要跳过事实核对直接输出选型结论'
        ],
        integration_owner: '当前主线程',
        integration_steps: [
          '先启动 emb-arch-reviewer 产出主审查结论',
          '必要时再让 review agents 补硬件、结构或发布侧证据',
          '最终由主线程整合成 architecture review 结论'
        ],
        primary: {
          agent: context.suggested_agent,
          role: 'primary',
          blocking: true,
          purpose: '执行系统级架构预审、方案比较和 pre-mortem',
          ownership: '负责主审查结论，不替代具体实现改动',
          when: '显式进入 arch-review 时立即启动',
          spawn_fallback: {
            supported: true,
            preferred_launch: context.suggested_agent,
            fallback_tool: 'spawn_agent',
            fallback_agent_type: 'default',
            role: 'primary',
            instructions_source_cli: `node ~/.codex/emb-agent/bin/emb-agent.cjs agents show ${context.suggested_agent}`,
            prompt_contract: [
              `先读取 ${context.suggested_agent} 的 agent 指令`,
              '再结合 dispatch_contract 提供的上下文与输出要求执行',
              '输出后由主线程整合成 architecture review'
            ]
          },
          expected_output: [
            '给出三套方案、评价矩阵和 pre-mortem',
            '区分已确认事实、工程推断和经验警告'
          ],
          context_bundle: {
            trigger_patterns: context.trigger_patterns || [],
            checkpoints: context.checkpoints || [],
            review_axes: context.review_axes || [],
            note_targets: context.note_targets || []
          },
          start_when: '立即启动'
        },
        supporting: runtime.unique(context.review_agents || []).map(agent => ({
          agent,
          role: 'supporting',
          blocking: false,
          purpose: '为架构预审补充结构、硬件或发布侧证据',
          ownership: '只补侧证据，不覆盖主审查结论',
          when: '主线程发现需要补侧证据时再启动',
          spawn_fallback: {
            supported: true,
            preferred_launch: agent,
            fallback_tool: 'spawn_agent',
            fallback_agent_type: 'explorer',
            role: 'supporting',
            instructions_source_cli: `node ~/.codex/emb-agent/bin/emb-agent.cjs agents show ${agent}`,
            prompt_contract: [
              `先读取 ${agent} 的 agent 指令`,
              '再结合 dispatch_contract 提供的上下文与输出要求执行',
              '输出后由主线程整合成 architecture review 侧证据'
            ]
          },
          expected_output: ['补充证据、约束或待验证风险'],
          context_bundle: {
            review_axes: context.review_axes || [],
            note_targets: context.note_targets || []
          },
          start_when: '按需启动'
        }))
      }
    },
    context_hygiene: context.context_hygiene || null,
    action_context: context
  };
}

function buildDispatchContext(requestedAction) {
  const action = (requestedAction || '').trim();

  if (!action) {
    throw new Error('Missing action name');
  }

  if (action === 'next') {
    const next = buildNextContext();
    const resolvedAction = next.next.command;

    if (resolvedAction === 'arch-review') {
      const archDispatch = buildArchReviewDispatchContext();
      return {
        source: 'next',
        requested_action: 'next',
        resolved_action: resolvedAction,
        reason: next.next.reason,
        skill: archDispatch.skill,
        cli: archDispatch.cli,
        dispatch_ready: archDispatch.dispatch_ready,
        agent_execution: archDispatch.agent_execution,
        context_hygiene: next.context_hygiene,
        next_actions: next.next_actions,
        current: next.current,
        handoff: next.handoff,
        action_context: archDispatch.action_context
      };
    }

    const output = buildActionOutput(resolvedAction);
    return {
      source: 'next',
      requested_action: 'next',
      resolved_action: resolvedAction,
      reason: next.next.reason,
      skill: next.next.skill,
      cli: next.next.cli,
      dispatch_ready: Boolean(output.agent_execution && output.agent_execution.available),
      agent_execution: output.agent_execution || null,
      context_hygiene: next.context_hygiene,
      next_actions: next.next_actions,
      current: next.current,
      handoff: next.handoff,
      action_context: output
    };
  }

  if (action === 'arch-review') {
    return {
      source: 'action',
      ...buildArchReviewDispatchContext()
    };
  }

  const output = buildActionOutput(action);

  return {
    source: 'action',
    requested_action: action,
    resolved_action: action,
    reason: `direct dispatch for ${action}`,
    skill: `$emb-${action}`,
    cli: `node ~/.codex/emb-agent/bin/emb-agent.cjs ${action}`,
    dispatch_ready: Boolean(output.agent_execution && output.agent_execution.available),
    agent_execution: output.agent_execution || null,
    context_hygiene: output.context_hygiene || null,
    action_context: output
  };
}

async function runIngestCommand(subcmd, rest, options) {
  let ingested;
  let lastFiles;

  if (subcmd === 'apply') {
    ingested = await ingestDocCli.applyDoc(rest, {
      projectRoot: resolveProjectRoot(),
      ...(options || {})
    });
    lastFiles = ingested.last_files || [];
  } else if (subcmd === 'doc') {
    ingested = await ingestDocCli.ingestDoc(rest, {
      projectRoot: resolveProjectRoot(),
      ...(options || {})
    });
    lastFiles = ingested.last_files || [];
  } else {
    ingested = ingestTruthCli.ingestTruth([subcmd, ...rest]);
    const truthFile = ingested.domain === 'hardware' ? 'emb-agent/hw.yaml' : 'emb-agent/req.yaml';
    lastFiles = [truthFile];
  }

  const session = updateSession(current => {
    current.last_command = `ingest ${ingested.domain}`;
    current.last_files = runtime
      .unique([...(lastFiles || []), ...(current.last_files || [])])
      .slice(0, RUNTIME_CONFIG.max_last_files);
  });

  return {
    ...ingested,
    session: {
      last_command: session.last_command,
      last_files: session.last_files
    }
  };
}

async function main(argv) {
  const args = argv || process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    usage();
    process.exit(0);
  }

  const [cmd, subcmd, ...rest] = args;

  if (cmd === 'init') {
    const initialized = runInitCommand(args.slice(1), 'init');
    if (initialized) {
      printJson(initialized);
    }
    return;
  }

  if (cmd === 'attach') {
    const initialized = runInitCommand(args.slice(1), 'attach');
    if (initialized) {
      initialized.legacy_alias = true;
      printJson(initialized);
    }
    return;
  }

  if (cmd === 'ingest') {
    printJson(await runIngestCommand(subcmd, rest));
    return;
  }

  if (cmd === 'status') {
    printJson(buildStatus());
    return;
  }

  if (cmd === 'next') {
    const session = updateSession(current => {
      current.last_command = 'next';
    });
    const context = buildNextContext();
    context.current.last_command = session.last_command || '';
    printJson(context);
    return;
  }

  if (cmd === 'pause' && subcmd === 'show') {
    printJson(loadHandoff());
    return;
  }

  if (cmd === 'pause' && subcmd === 'clear') {
    clearHandoff();
    const session = updateSession(current => {
      current.last_command = 'pause clear';
      current.paused_at = '';
    });
    printJson({
      cleared: true,
      handoff: null,
      session
    });
    return;
  }

  if (cmd === 'pause') {
    const noteText = [subcmd, ...rest].filter(Boolean).join(' ').trim();
    const handoff = buildPausePayload(noteText);
    saveHandoff(handoff);
    const session = updateSession(current => {
      current.last_command = 'pause';
      current.paused_at = handoff.timestamp;
    });
    printJson({
      paused: true,
      handoff,
      session
    });
    return;
  }

  if (cmd === 'resume') {
    const session = updateSession(current => {
      current.last_command = 'resume';
      current.last_resumed_at = new Date().toISOString();
    });
    const context = buildResumeContext();
    context.summary.last_command = session.last_command || '';
    context.summary.last_resumed_at = session.last_resumed_at || '';
    printJson(context);
    return;
  }

  if (cmd === 'resolve') {
    printJson(resolveSession());
    return;
  }

  if (cmd === 'config' && subcmd === 'show') {
    printJson(RUNTIME_CONFIG);
    return;
  }

  if (cmd === 'project' && subcmd === 'show') {
    const showArgs = parseProjectShowArgs(rest);
    printJson(buildProjectShow(showArgs.effective, showArgs.field));
    return;
  }

  if (cmd === 'project' && subcmd === 'set') {
    const setArgs = parseProjectSetArgs(rest);
    printJson(setProjectConfigValue(setArgs.field, setArgs.value));
    return;
  }

  if (cmd === 'doc' && subcmd === 'list') {
    const docs = ingestDocCli.listDocs(resolveProjectRoot());
    updateSession(current => {
      current.last_command = 'doc list';
    });
    printJson(docs);
    return;
  }

  if (cmd === 'doc' && subcmd === 'show') {
    const showArgs = ingestDocCli.parseShowArgs(rest);
    const docView = ingestDocCli.showDoc(resolveProjectRoot(), showArgs.docId, {
      preset: showArgs.preset,
      applyReady: showArgs.applyReady
    });
    updateSession(current => {
      current.last_command = 'doc show';
      current.last_files = runtime
        .unique([
          docView.entry.artifacts && docView.entry.artifacts.markdown,
          docView.entry.artifacts && docView.entry.artifacts.metadata,
          docView.entry.artifacts && docView.entry.artifacts.source,
          ...(current.last_files || [])
        ])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });
    printJson(docView);
    return;
  }

  if (cmd === 'doc' && subcmd === 'diff') {
    if (!rest[0]) throw new Error('Missing doc id');
    const diffArgs = ingestDocCli.parseDiffArgs(['doc', ...rest]);
    const diffView = ingestDocCli.diffDoc(
      resolveProjectRoot(),
      diffArgs.docId,
      diffArgs.to,
      diffArgs.only,
      diffArgs.force
    );
    ingestDocCli.rememberLastDiff(resolveProjectRoot(), diffView);
    const savedPreset = diffArgs.saveAs
      ? ingestDocCli.saveDiffPreset(resolveProjectRoot(), diffArgs.saveAs, diffView)
      : null;
    updateSession(current => {
      current.last_command = 'doc diff';
      current.last_files = runtime
        .unique([
          diffView.draft,
          diffView.target,
          ...(current.last_files || [])
        ])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });
    printJson(savedPreset ? { ...diffView, saved_preset: savedPreset } : diffView);
    return;
  }

  if (cmd === 'scan' && subcmd === 'save') {
    printJson(saveScanReport(rest));
    return;
  }

  if (cmd === 'scan') {
    updateSession(current => {
      current.last_command = 'scan';
    });
    printJson(buildActionOutput('scan'));
    return;
  }

  if (cmd === 'plan' && subcmd === 'save') {
    printJson(savePlanReport(rest));
    return;
  }

  if (cmd === 'plan') {
    updateSession(current => {
      current.last_command = 'plan';
    });
    printJson(buildActionOutput('plan'));
    return;
  }

  if (cmd === 'arch-review') {
    updateSession(current => {
      current.last_command = 'arch-review';
    });
    printJson(buildArchReviewContext());
    return;
  }

  if (cmd === 'do') {
    updateSession(current => {
      current.last_command = 'do';
    });
    printJson(buildActionOutput('do'));
    return;
  }

  if (cmd === 'debug') {
    updateSession(current => {
      current.last_command = 'debug';
    });
    printJson(buildActionOutput('debug'));
    return;
  }

  if (cmd === 'schedule' && subcmd === 'show') {
    if (!rest[0]) throw new Error('Missing action name');
    printJson(scheduler.buildSchedule(rest[0], resolveSession()));
    return;
  }

  if (cmd === 'dispatch' && subcmd === 'show') {
    if (!rest[0]) throw new Error('Missing action name');
    printJson(buildDispatchContext(rest[0]));
    return;
  }

  if (cmd === 'dispatch' && subcmd === 'next') {
    printJson(buildDispatchContext('next'));
    return;
  }

  if (cmd === 'template' && subcmd === 'list') {
    runTemplateScript(['list']);
    return;
  }

  if (cmd === 'template' && subcmd === 'show') {
    if (!rest[0]) throw new Error('Missing template name');
    runTemplateScript(['show', rest[0]]);
    return;
  }

  if (cmd === 'template' && subcmd === 'fill') {
    if (!rest[0]) throw new Error('Missing template name');
    runTemplateScript(['fill', rest[0], ...rest.slice(1)]);
    return;
  }

  if (cmd === 'review' && subcmd === 'context') {
    printJson(buildReviewContext());
    return;
  }

  if (cmd === 'review' && subcmd === 'axes') {
    printJson({ review_axes: resolveSession().effective.review_axes });
    return;
  }

  if (cmd === 'review' && subcmd === 'save') {
    printJson(saveReviewReport(rest));
    return;
  }

  if (cmd === 'review' && !subcmd) {
    updateSession(current => {
      current.last_command = 'review';
    });
    printJson(buildActionOutput('review'));
    return;
  }

  if (cmd === 'note' && subcmd === 'targets') {
    printJson({ note_targets: resolveSession().effective.note_targets });
    return;
  }

  if (cmd === 'adapter' && subcmd === 'status') {
    printJson(buildAdapterStatus(rest[0] || ''));
    return;
  }

  if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'list') {
    printJson(buildAdapterStatus());
    return;
  }

  if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'show') {
    if (!rest[1]) throw new Error('Missing source name');
    printJson(buildAdapterStatus(rest[1]));
    return;
  }

  if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'add') {
    if (!rest[1]) throw new Error('Missing source name');
    printJson(addAdapterSource(rest[1], rest.slice(2)));
    return;
  }

  if (cmd === 'adapter' && subcmd === 'source' && rest[0] === 'remove') {
    if (!rest[1]) throw new Error('Missing source name');
    printJson(removeAdapterSource(rest[1]));
    return;
  }

  if (cmd === 'adapter' && subcmd === 'sync') {
    if (rest[0] === '--all') {
      const parsedAll = parseAdapterSyncArgs(rest);
      printJson(syncAllAdapterSources(parsedAll));
      return;
    }

    if (!rest[0] || rest[0].startsWith('--')) {
      throw new Error('Missing source name');
    }

    printJson(syncNamedAdapterSource(rest[0], parseAdapterSyncArgs(rest.slice(1))));
    return;
  }

  if (cmd === 'tool' && subcmd === 'list') {
    printJson(toolCatalog.listToolSpecs(ROOT));
    return;
  }

  if (cmd === 'tool' && subcmd === 'show') {
    if (!rest[0]) throw new Error('Missing tool name');
    printJson(toolCatalog.loadToolSpec(ROOT, rest[0]));
    return;
  }

  if (cmd === 'tool' && subcmd === 'run') {
    if (!rest[0]) throw new Error('Missing tool name');
    printJson(toolRuntime.runTool(ROOT, rest[0], rest.slice(1)));
    return;
  }

  if (cmd === 'tool' && subcmd === 'family' && rest[0] === 'list') {
    printJson(toolCatalog.listFamilies(ROOT));
    return;
  }

  if (cmd === 'tool' && subcmd === 'family' && rest[0] === 'show') {
    if (!rest[1]) throw new Error('Missing family name');
    printJson(toolCatalog.loadFamily(ROOT, rest[1]));
    return;
  }

  if (cmd === 'tool' && subcmd === 'device' && rest[0] === 'list') {
    printJson(toolCatalog.listDevices(ROOT));
    return;
  }

  if (cmd === 'tool' && subcmd === 'device' && rest[0] === 'show') {
    if (!rest[1]) throw new Error('Missing device name');
    printJson(toolCatalog.loadDevice(ROOT, rest[1]));
    return;
  }

  if (cmd === 'chip' && subcmd === 'list') {
    printJson(chipCatalog.listChips(ROOT));
    return;
  }

  if (cmd === 'chip' && subcmd === 'show') {
    if (!rest[0]) throw new Error('Missing chip name');
    printJson(chipCatalog.loadChip(ROOT, rest[0]));
    return;
  }

  if (cmd === 'note' && subcmd === 'add') {
    printJson(addNoteEntry(rest));
    return;
  }

  if (cmd === 'note' && !subcmd) {
    updateSession(current => {
      current.last_command = 'note';
    });
    printJson(buildActionOutput('note'));
    return;
  }

  if (cmd === 'session' && subcmd === 'show') {
    printJson(loadSession());
    return;
  }

  if (cmd === 'agents' && subcmd === 'list') {
    printJson(runtime.listNames(AGENTS_DIR, '.md'));
    return;
  }

  if (cmd === 'agents' && subcmd === 'show') {
    if (!rest[0]) throw new Error('Missing agent name');
    printJson(loadMarkdown(AGENTS_DIR, rest[0], 'Agent'));
    return;
  }

  if (cmd === 'commands' && subcmd === 'list') {
    printJson(runtime.listNames(COMMANDS_DIR, '.md'));
    return;
  }

  if (cmd === 'commands' && subcmd === 'show') {
    if (!rest[0]) throw new Error('Missing command name');
    printJson(loadMarkdown(COMMANDS_DIR, rest[0], 'Command'));
    return;
  }

  if (cmd === 'profile' && subcmd === 'list') {
    const builtIn = runtime.listNames(PROFILES_DIR, '.yaml');
    const projectProfilesDir = getProjectProfilesDir();
    const projectLocal = fs.existsSync(projectProfilesDir)
      ? runtime.listNames(projectProfilesDir, '.yaml')
      : [];
    printJson(runtime.unique([...projectLocal, ...builtIn]));
    return;
  }

  if (cmd === 'profile' && subcmd === 'show') {
    if (!rest[0]) throw new Error('Missing profile name');
    printJson(loadProfile(rest[0]));
    return;
  }

  if (cmd === 'profile' && subcmd === 'set') {
    if (!rest[0]) throw new Error('Missing profile name');
    loadProfile(rest[0]);
    const session = updateSession(current => {
      current.project_profile = rest[0];
    });
    printJson(session);
    return;
  }

  if (cmd === 'prefs' && subcmd === 'show') {
    printJson({ preferences: getPreferences(loadSession()) });
    return;
  }

  if (cmd === 'prefs' && subcmd === 'set') {
    if (!rest[0]) throw new Error('Missing preference key');
    if (!rest[1]) throw new Error('Missing preference value');
    const key = requirePreferenceKey(rest[0]);
    const value = rest[1];
    const session = updateSession(current => {
      current.preferences = runtime.normalizePreferences(
        {
          ...(current.preferences || {}),
          [key]: value
        },
        RUNTIME_CONFIG
      );
    });
    printJson(session);
    return;
  }

  if (cmd === 'prefs' && subcmd === 'reset') {
    const session = updateSession(current => {
      current.preferences = runtime.normalizePreferences(
        {},
        runtime.mergeRuntimeDefaults(RUNTIME_CONFIG, getProjectConfig())
      );
    });
    printJson(session);
    return;
  }

  if (cmd === 'pack' && subcmd === 'list') {
    const builtIn = runtime.listNames(PACKS_DIR, '.yaml');
    const projectPacksDir = getProjectPacksDir();
    const projectLocal = fs.existsSync(projectPacksDir)
      ? runtime.listNames(projectPacksDir, '.yaml')
      : [];
    printJson(runtime.unique([...projectLocal, ...builtIn]));
    return;
  }

  if (cmd === 'pack' && subcmd === 'show') {
    if (!rest[0]) throw new Error('Missing pack name');
    printJson(loadPack(rest[0]));
    return;
  }

  if (cmd === 'pack' && subcmd === 'add') {
    if (!rest[0]) throw new Error('Missing pack name');
    loadPack(rest[0]);
    const session = updateSession(current => {
      current.active_packs = runtime.unique([...(current.active_packs || []), rest[0]]);
    });
    printJson(session);
    return;
  }

  if (cmd === 'pack' && subcmd === 'remove') {
    if (!rest[0]) throw new Error('Missing pack name');
    const session = updateSession(current => {
      current.active_packs = runtime.removeValue(current.active_packs || [], rest[0]);
    });
    printJson(session);
    return;
  }

  if (cmd === 'pack' && subcmd === 'clear') {
    const session = updateSession(current => {
      current.active_packs = [];
    });
    printJson(session);
    return;
  }

  if (cmd === 'focus' && subcmd === 'get') {
    const session = loadSession();
    printJson({ focus: session.focus || '' });
    return;
  }

  if (cmd === 'focus' && subcmd === 'set') {
    const nextFocus = requireRestText(rest, 'focus text');
    const session = updateSession(current => {
      current.focus = nextFocus;
    });
    printJson(session);
    return;
  }

  if (cmd === 'last-files' && subcmd === 'list') {
    printJson({ last_files: loadSession().last_files });
    return;
  }

  if (cmd === 'last-files' && subcmd === 'add') {
    const filePath = requireRestText(rest, 'file path');
    runtime.requireFile(path.resolve(process.cwd(), filePath), 'File');
    const session = updateSession(current => {
      current.last_files = runtime
        .unique([filePath, ...(current.last_files || [])])
        .slice(0, RUNTIME_CONFIG.max_last_files);
    });
    printJson(session);
    return;
  }

  if (cmd === 'last-files' && subcmd === 'clear') {
    const session = updateSession(current => {
      current.last_files = [];
    });
    printJson(session);
    return;
  }

  if (cmd === 'last-files' && subcmd === 'remove') {
    const filePath = requireRestText(rest, 'file path');
    const session = updateSession(current => {
      current.last_files = runtime.removeValue(current.last_files || [], filePath);
    });
    printJson(session);
    return;
  }

  if (cmd === 'question' && subcmd === 'list') {
    printJson({ open_questions: loadSession().open_questions });
    return;
  }

  if (cmd === 'question' && subcmd === 'add') {
    const question = requireRestText(rest, 'question text');
    const session = updateSession(current => {
      current.open_questions = runtime.unique([...(current.open_questions || []), question]);
    });
    printJson(session);
    return;
  }

  if (cmd === 'question' && subcmd === 'remove') {
    const question = requireRestText(rest, 'question text');
    const session = updateSession(current => {
      current.open_questions = runtime.removeValue(current.open_questions || [], question);
    });
    printJson(session);
    return;
  }

  if (cmd === 'question' && subcmd === 'clear') {
    const session = updateSession(current => {
      current.open_questions = [];
    });
    printJson(session);
    return;
  }

  if (cmd === 'risk' && subcmd === 'list') {
    printJson({ known_risks: loadSession().known_risks });
    return;
  }

  if (cmd === 'risk' && subcmd === 'add') {
    const risk = requireRestText(rest, 'risk text');
    const session = updateSession(current => {
      current.known_risks = runtime.unique([...(current.known_risks || []), risk]);
    });
    printJson(session);
    return;
  }

  if (cmd === 'risk' && subcmd === 'remove') {
    const risk = requireRestText(rest, 'risk text');
    const session = updateSession(current => {
      current.known_risks = runtime.removeValue(current.known_risks || [], risk);
    });
    printJson(session);
    return;
  }

  if (cmd === 'risk' && subcmd === 'clear') {
    const session = updateSession(current => {
      current.known_risks = [];
    });
    printJson(session);
    return;
  }

  usage();
  process.exitCode = 1;
}

module.exports = {
  addNoteEntry,
  savePlanReport,
  saveScanReport,
  saveReviewReport,
  main,
  runIngestCommand,
  buildActionOutput,
  buildDispatchContext,
  buildContextHygiene,
  buildGuidance,
  buildNextContext,
  buildPausePayload,
  buildStatus,
  buildProjectShow,
  buildAdapterStatus,
  setProjectConfigValue,
  addAdapterSource,
  removeAdapterSource,
  syncNamedAdapterSource,
  syncAllAdapterSources,
  parseProjectShowArgs,
  parseProjectSetArgs,
  parseAdapterSourceAddArgs,
  parseAdapterSyncArgs,
  buildResumeContext,
  buildArchReviewContext,
  buildReviewContext,
  adapterSources,
  toolCatalog,
  toolRuntime,
  chipCatalog,
  loadHandoff,
  resolveSession,
  loadSession,
  shouldSuggestArchReview,
  shouldSuggestPlan,
  shouldSuggestReview,
  scheduler
};

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`emb-agent error: ${error.message}\n`);
    process.exit(1);
  });
}
