#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.resolve(ROOT, '..');
const runtimeHost = require(path.join(ROOT, 'lib', 'runtime-host.cjs'));
const SOURCE_LAYOUT = runtimeHost.isSourceRuntimeLayout(ROOT);
const PROFILES_DIR = path.join(ROOT, 'profiles');
const PACKS_DIR = path.join(ROOT, 'packs');
const AGENTS_DIR = SOURCE_LAYOUT ? path.join(SOURCE_ROOT, 'agents') : path.join(ROOT, 'agents');
const COMMANDS_DIR = SOURCE_LAYOUT ? path.join(SOURCE_ROOT, 'commands', 'emb') : path.join(ROOT, 'commands');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const templateCli = require(path.join(ROOT, 'scripts', 'template.cjs'));
const adapterDeriveCli = require(path.join(ROOT, 'scripts', 'adapter-derive.cjs'));
const attachProjectCli = require(path.join(ROOT, 'scripts', 'attach-project.cjs'));
const ingestTruthCli = require(path.join(ROOT, 'scripts', 'ingest-truth.cjs'));
const ingestDocCli = require(path.join(ROOT, 'scripts', 'ingest-doc.cjs'));
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const scheduler = require(path.join(ROOT, 'lib', 'scheduler.cjs'));
const toolCatalog = require(path.join(ROOT, 'lib', 'tool-catalog.cjs'));
const toolRuntime = require(path.join(ROOT, 'lib', 'tool-runtime.cjs'));
const toolSuggestionHelpers = require(path.join(ROOT, 'lib', 'tool-suggestions.cjs'));
const chipCatalog = require(path.join(ROOT, 'lib', 'chip-catalog.cjs'));
const adapterSources = require(path.join(ROOT, 'lib', 'adapter-sources.cjs'));
const noteReportHelpers = require(path.join(ROOT, 'lib', 'note-reports.cjs'));
const dispatchHelpers = require(path.join(ROOT, 'lib', 'dispatch-orchestrator.cjs'));
const sessionFlowHelpers = require(path.join(ROOT, 'lib', 'session-flow.cjs'));
const projectConfigHelpers = require(path.join(ROOT, 'lib', 'project-config.cjs'));
const stateCommandHelpers = require(path.join(ROOT, 'lib', 'state-commands.cjs'));
const actionContractHelpers = require(path.join(ROOT, 'lib', 'action-contracts.cjs'));
const commandGroupHelpers = require(path.join(ROOT, 'lib', 'command-groups.cjs'));
const cliEntryHelpers = require(path.join(ROOT, 'lib', 'cli-entrypoints.cjs'));
const cliRouterHelpers = require(path.join(ROOT, 'lib', 'cli-router.cjs'));
const threadCommandHelpers = require(path.join(ROOT, 'lib', 'thread-commands.cjs'));
const forensicsCommandHelpers = require(path.join(ROOT, 'lib', 'forensics-command.cjs'));
const projectStateStoreHelpers = require(path.join(ROOT, 'lib', 'project-state-store.cjs'));
const settingsCommandHelpers = require(path.join(ROOT, 'lib', 'settings-command.cjs'));
const sessionReportCommandHelpers = require(path.join(ROOT, 'lib', 'session-report-command.cjs'));
const managerCommandHelpers = require(path.join(ROOT, 'lib', 'manager-command.cjs'));
const healthUpdateCommandHelpers = require(path.join(ROOT, 'lib', 'health-update-command.cjs'));

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
  runtime.ensureDir(path.join(getProjectExtDir(), 'threads'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'reports'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'reports', 'forensics'));
  runtime.ensureDir(path.join(getProjectExtDir(), 'reports', 'sessions'));
  runtime.ensureDir(getProjectProfilesDir());
  runtime.ensureDir(getProjectPacksDir());
  runtime.ensureDir(path.join(getProjectExtDir(), 'adapters'));
  runtime.ensureDir(path.join(resolveProjectRoot(), 'docs'));
}

const {
  ensureSession,
  loadSession,
  saveSession,
  loadHandoff,
  saveHandoff,
  clearHandoff,
  updateSession
} = projectStateStoreHelpers.createProjectStateStoreHelpers({
  fs,
  path,
  runtime,
  RUNTIME_CONFIG,
  getProjectStatePaths,
  normalizeSession,
  readDefaultSession
});

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

function normalizeHardwareSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function compactHardwareSlug(value) {
  return normalizeHardwareSlug(value).replace(/-/g, '');
}

function findChipProfileByModel(model, packageName) {
  const normalizedModel = String(model || '').trim();
  const normalizedPackage = String(packageName || '').trim();
  if (!normalizedModel) {
    return null;
  }

  const candidates = runtime.unique([
    normalizedModel,
    compactHardwareSlug(normalizedModel),
    normalizedPackage ? compactHardwareSlug(`${normalizedModel}${normalizedPackage}`) : '',
    normalizedPackage ? compactHardwareSlug(`${normalizedModel}-${normalizedPackage}`) : ''
  ].filter(Boolean));

  for (const candidate of candidates) {
    try {
      return chipCatalog.loadChip(ROOT, candidate);
    } catch {
      // keep trying fallback candidates
    }
  }

  const matched = chipCatalog
    .listChips(ROOT)
    .find(item => {
      const itemName = String(item.name || '').toLowerCase();
      return candidates.some(candidate => itemName === String(candidate).toLowerCase());
    });

  if (!matched) {
    return null;
  }

  return chipCatalog.loadChip(ROOT, matched.name);
}

const {
  buildSuggestedTools,
  buildToolRecommendations,
  buildToolExecutionFromNext,
  enrichWithToolSuggestions
} = toolSuggestionHelpers.createToolSuggestionHelpers({
  ROOT,
  runtime,
  toolCatalog,
  toolRuntime
});

function resolveSession() {
  const session = loadSession();
  const profile = loadProfile(session.project_profile);
  const packs = session.active_packs.map(loadPack);
  const projectConfig = getProjectConfig();
  const hardwareIdentity = loadHardwareIdentity(session.project_root || resolveProjectRoot());
  const chipProfile = findChipProfileByModel(hardwareIdentity.model, hardwareIdentity.package);
  const suggestedTools = buildSuggestedTools(chipProfile);
  const toolRecommendations = buildToolRecommendations(chipProfile, suggestedTools);
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
      tool_recommendations: toolRecommendations,
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

const {
  listThreads,
  upsertForensicsThread,
  handleThreadCommands
} = threadCommandHelpers.createThreadCommandHelpers({
  fs,
  path,
  runtime,
  resolveProjectRoot,
  getProjectExtDir,
  loadSession,
  updateSession,
  requireRestText
});

const {
  getPreferences,
  buildStatus,
  buildReviewContext,
  shouldSuggestArchReview,
  buildArchReviewContext,
  buildNextCommand,
  buildContextHygiene,
  buildGuidance,
  buildResumeContext,
  buildNextContext,
  shouldSuggestPlan,
  shouldSuggestReview,
  suggestFlow,
  buildPausePayload
} = sessionFlowHelpers.createSessionFlowHelpers({
  runtime,
  RUNTIME_CONFIG,
  DEFAULT_ARCH_REVIEW_PATTERNS,
  resolveSession,
  getProjectConfig,
  loadHandoff,
  enrichWithToolSuggestions,
  listThreads
});

const {
  selectNestedField,
  parseProjectShowArgs,
  parseProjectSetArgs,
  parseAdapterSourceAddArgs,
  parseAdapterSyncArgs,
  parseProjectValue,
  assignNestedField,
  buildProjectShow,
  buildProjectConfigSeed,
  syncSessionWithProjectConfig,
  writeProjectConfig,
  setProjectConfigValue,
  buildAdapterStatus,
  addAdapterSource,
  removeAdapterSource,
  syncNamedAdapterSource,
  syncAllAdapterSources
} = projectConfigHelpers.createProjectConfigHelpers({
  path,
  runtime,
  adapterSources,
  ROOT,
  RUNTIME_CONFIG,
  resolveProjectRoot,
  resolveSession,
  getProjectConfig,
  initProjectLayout,
  updateSession,
  getPreferences
});

const {
  handleForensicsCommands
} = forensicsCommandHelpers.createForensicsCommandHelpers({
  fs,
  path,
  childProcess,
  runtime,
  resolveProjectRoot,
  getProjectExtDir,
  loadSession,
  loadHandoff,
  resolveSession,
  buildContextHygiene,
  upsertForensicsThread,
  updateSession
});

const {
  buildSettingsView,
  handleSettingsCommands
} = settingsCommandHelpers.createSettingsCommandHelpers({
  runtime,
  RUNTIME_CONFIG,
  loadSession,
  updateSession,
  loadProfile,
  loadPack,
  getProjectConfig
});

const {
  handleSessionReportCommands
} = sessionReportCommandHelpers.createSessionReportCommandHelpers({
  fs,
  path,
  runtime,
  resolveSession,
  loadHandoff,
  buildNextContext,
  buildResumeContext,
  getProjectExtDir,
  updateSession
});

const {
  handleManagerCommands
} = managerCommandHelpers.createManagerCommandHelpers({
  fs,
  path,
  runtime,
  getProjectExtDir,
  loadSession,
  loadHandoff,
  buildNextContext,
  buildResumeContext,
  buildToolExecutionFromNext,
  buildSettingsView,
  listThreads
});

const {
  buildHealthReport,
  buildUpdateView,
  handleHealthUpdateCommands
} = healthUpdateCommandHelpers.createHealthUpdateCommandHelpers({
  fs,
  path,
  process,
  childProcess,
  runtime,
  RUNTIME_CONFIG,
  resolveProjectRoot,
  getProjectExtDir,
  getProjectStatePaths,
  getProjectConfig,
  normalizeSession,
  loadProfile,
  loadPack,
  findChipProfileByModel,
  updateSession
});

const {
  handleCatalogAndStateCommands
} = stateCommandHelpers.createStateCommandHelpers({
  fs,
  path,
  process,
  runtime,
  PROFILES_DIR,
  PACKS_DIR,
  AGENTS_DIR,
  COMMANDS_DIR,
  RUNTIME_CONFIG,
  getProjectProfilesDir,
  getProjectPacksDir,
  loadProfile,
  loadPack,
  loadMarkdown,
  loadSession,
  updateSession,
  getPreferences,
  getProjectConfig,
  requireRestText,
  requirePreferenceKey,
  handleHealthUpdateCommands,
  handleThreadCommands,
  handleForensicsCommands,
  handleSettingsCommands,
  handleSessionReportCommands,
  handleManagerCommands
});

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function runTemplateScript(args) {
  templateCli.runTemplateCli(args);
}

function runAdapterDerive(args) {
  return adapterDeriveCli.deriveProfiles(args, {
    runtimeRoot: ROOT,
    projectRoot: resolveProjectRoot()
  });
}

function getTemplateConfig() {
  return runtime.validateTemplateConfig(
    runtime.readJson(path.join(TEMPLATES_DIR, 'config.json'))
  );
}

const {
  parseNoteAddArgs,
  normalizeTargetAlias,
  resolveKnownDocTarget,
  resolveNoteTarget,
  ensureNoteTargetDoc,
  buildNoteEntry,
  appendNoteEntryToDoc,
  parseReviewSaveArgs,
  buildReviewReportEntry,
  appendSectionEntry,
  findSummaryLine,
  splitSectionEntries,
  upsertSectionEntry,
  saveReviewReport,
  parseScanSaveArgs,
  parsePlanSaveArgs,
  buildScanEntry,
  buildPlanEntry,
  syncHardwareTruthFromScan,
  saveScanReport,
  syncRequirementsFromPlan,
  savePlanReport,
  addNoteEntry
} = noteReportHelpers.createNoteReportHelpers({
  fs,
  path,
  process,
  runtime,
  scheduler,
  ingestTruthCli,
  templateCli,
  TEMPLATES_DIR,
  RUNTIME_CONFIG,
  resolveProjectRoot,
  resolveSession,
  getTemplateConfig,
  updateSession
});

const {
  usage,
  runInitCommand,
  runIngestCommand
} = cliEntryHelpers.createCliEntryHelpers({
  fs,
  path,
  process,
  runtime,
  RUNTIME_CONFIG,
  resolveProjectRoot,
  getProjectExtDir,
  initProjectLayout,
  ensureSession,
  updateSession,
  attachProjectCli,
  ingestTruthCli,
  ingestDocCli
});

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

const {
  buildActionOutput,
  buildArchReviewDispatchContext
} = actionContractHelpers.createActionContractHelpers({
  runtime,
  scheduler,
  resolveSession,
  loadHandoff,
  buildContextHygiene,
  enrichWithToolSuggestions,
  buildArchReviewContext
});

const {
  buildDispatchContext,
  buildOrchestratorStrategy,
  buildOrchestratorSteps,
  buildOrchestratorContext
} = dispatchHelpers.createDispatchHelpers({
  resolveSession,
  loadHandoff,
  buildGuidance,
  getPreferences,
  enrichWithToolSuggestions,
  buildToolExecutionFromNext,
  buildNextContext,
  buildActionOutput,
  buildArchReviewDispatchContext
});

const {
  handleDocCommands,
  handleActionCommands,
  handleDispatchAndTemplateCommands,
  handleAdapterToolChipCommands
} = commandGroupHelpers.createCommandGroupHelpers({
  runtime,
  scheduler,
  toolCatalog,
  toolRuntime,
  chipCatalog,
  ROOT,
  RUNTIME_CONFIG,
  resolveProjectRoot,
  resolveSession,
  updateSession,
  buildActionOutput,
  buildReviewContext,
  buildArchReviewContext,
  buildDispatchContext,
  buildOrchestratorContext,
  buildAdapterStatus,
  addAdapterSource,
  removeAdapterSource,
  parseAdapterSyncArgs,
  syncNamedAdapterSource,
  syncAllAdapterSources,
  runAdapterDerive,
  saveScanReport,
  savePlanReport,
  saveReviewReport,
  addNoteEntry,
  runTemplateScript,
  ingestDocCli
});

const {
  run: runCliRouter
} = cliRouterHelpers.createCliRouter({
  process,
  usage,
  printJson,
  runInitCommand,
  runIngestCommand,
  buildStatus,
  updateSession,
  buildNextContext,
  loadHandoff,
  clearHandoff,
  buildPausePayload,
  saveHandoff,
  buildResumeContext,
  resolveSession,
  RUNTIME_CONFIG,
  parseProjectShowArgs,
  buildProjectShow,
  parseProjectSetArgs,
  setProjectConfigValue,
  handleCatalogAndStateCommands,
  handleDocCommands,
  handleActionCommands,
  handleDispatchAndTemplateCommands,
  handleAdapterToolChipCommands
});

async function main(argv) {
  await runCliRouter(argv || process.argv.slice(2));
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
  buildOrchestratorContext,
  buildContextHygiene,
  buildGuidance,
  buildNextContext,
  buildPausePayload,
  buildStatus,
  buildHealthReport,
  buildUpdateView,
  buildProjectShow,
  buildAdapterStatus,
  setProjectConfigValue,
  addAdapterSource,
  removeAdapterSource,
  syncNamedAdapterSource,
  syncAllAdapterSources,
  runAdapterDerive,
  parseProjectShowArgs,
  parseProjectSetArgs,
  parseAdapterSourceAddArgs,
  parseAdapterSyncArgs,
  buildResumeContext,
  buildArchReviewContext,
  buildReviewContext,
  adapterSources,
  adapterDeriveCli,
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
