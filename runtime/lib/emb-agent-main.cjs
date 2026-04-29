#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.resolve(ROOT, '..');
const runtimeHost = require(path.join(ROOT, 'lib', 'runtime-host.cjs'));
const SOURCE_LAYOUT = runtimeHost.isSourceRuntimeLayout(ROOT);
const PROFILES_DIR = path.join(ROOT, 'profiles');
const AGENTS_DIR = SOURCE_LAYOUT ? path.join(SOURCE_ROOT, 'agents') : path.join(ROOT, 'agents');
const COMMANDS_DIR = SOURCE_LAYOUT ? path.join(SOURCE_ROOT, 'commands', 'emb') : path.join(ROOT, 'commands');
const COMMAND_DOCS_DIR = SOURCE_LAYOUT ? path.join(SOURCE_ROOT, 'commands', 'emb') : path.join(ROOT, 'command-docs');
const SKILLS_DIR = SOURCE_LAYOUT ? path.join(SOURCE_ROOT, 'skills') : path.join(ROOT, 'skills');
const MEMORY_DIR = SOURCE_LAYOUT ? path.join(SOURCE_ROOT, 'memory') : path.join(ROOT, 'memory');
const { TEMPLATES_DIR } = require(path.join(ROOT, 'lib', 'template-registry.cjs'));
const templateCli = require(path.join(ROOT, 'scripts', 'template.cjs'));
const adapterDeriveCli = require(path.join(ROOT, 'scripts', 'adapter-derive.cjs'));
const supportAnalysisCli = require(path.join(ROOT, 'scripts', 'support-analysis.cjs'));
const attachProjectCli = require(path.join(ROOT, 'scripts', 'attach-project.cjs'));
const ingestTruthCli = require(path.join(ROOT, 'scripts', 'ingest-truth.cjs'));
const ingestDocCli = require(path.join(ROOT, 'scripts', 'ingest-doc.cjs'));
const ingestSchematicCli = require(path.join(ROOT, 'scripts', 'ingest-schematic.cjs'));
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const scheduler = require(path.join(ROOT, 'lib', 'scheduler.cjs'));
const toolCatalog = require(path.join(ROOT, 'lib', 'tool-catalog.cjs'));
const toolRuntime = require(path.join(ROOT, 'lib', 'tool-runtime.cjs'));
const toolSuggestionHelpers = require(path.join(ROOT, 'lib', 'tool-suggestions.cjs'));
const chipCatalog = require(path.join(ROOT, 'lib', 'chip-catalog.cjs'));
const adapterSources = require(path.join(ROOT, 'lib', 'adapter-sources.cjs'));
const docCache = require(path.join(ROOT, 'lib', 'doc-cache.cjs'));
const permissionGateHelpers = require(path.join(ROOT, 'lib', 'permission-gates.cjs'));
const noteReportHelpers = require(path.join(ROOT, 'lib', 'note-reports.cjs'));
const dispatchHelpers = require(path.join(ROOT, 'lib', 'dispatch-orchestrator.cjs'));
const runtimeEventHelpers = require(path.join(ROOT, 'lib', 'runtime-events.cjs'));
const sessionFlowHelpers = require(path.join(ROOT, 'lib', 'session-flow.cjs'));
const referenceLookupHelpers = require(path.join(ROOT, 'lib', 'reference-lookup.cjs'));
const hardwareTruthHelpers = require(path.join(ROOT, 'lib', 'hardware-truth.cjs'));
const projectConfigHelpers = require(path.join(ROOT, 'lib', 'project-config.cjs'));
const stateCommandHelpers = require(path.join(ROOT, 'lib', 'state-commands.cjs'));
const actionContractHelpers = require(path.join(ROOT, 'lib', 'action-contracts.cjs'));
const commandGroupHelpers = require(path.join(ROOT, 'lib', 'command-groups.cjs'));
const cliEntryHelpers = require(path.join(ROOT, 'lib', 'cli-entrypoints.cjs'));
const cliRouterHelpers = require(path.join(ROOT, 'lib', 'cli-router.cjs'));
const taskCommandHelpers = require(path.join(ROOT, 'lib', 'task-commands.cjs'));
const projectStateStoreHelpers = require(path.join(ROOT, 'lib', 'project-state-store.cjs'));
const settingsCommandHelpers = require(path.join(ROOT, 'lib', 'settings-command.cjs'));
const sessionReportCommandHelpers = require(path.join(ROOT, 'lib', 'session-report-command.cjs'));
const transcriptCommandHelpers = require(path.join(ROOT, 'lib', 'transcript-command.cjs'));
const healthUpdateCommandHelpers = require(path.join(ROOT, 'lib', 'health-update-command.cjs'));
const executorCommandHelpers = require(path.join(ROOT, 'lib', 'executor-command.cjs'));
const externalAgentHelpers = require(path.join(ROOT, 'lib', 'external-agent.cjs'));
const commandVisibility = require(path.join(ROOT, 'lib', 'command-visibility.cjs'));
const workflowAuthoringHelpers = require(path.join(ROOT, 'lib', 'workflow-authoring.cjs'));
const capabilityMaterializerHelpers = require(path.join(ROOT, 'lib', 'capability-materializer.cjs'));
const capabilityRuntimeHelpers = require(path.join(ROOT, 'lib', 'capability-runtime.cjs'));
const scaffoldAuthoringHelpers = require(path.join(ROOT, 'lib', 'scaffold-authoring.cjs'));
const subAgentRuntimeHelpers = require(path.join(ROOT, 'lib', 'sub-agent-runtime.cjs'));
const skillRuntimeHelpers = require(path.join(ROOT, 'lib', 'skill-runtime.cjs'));
const memoryRuntimeHelpers = require(path.join(ROOT, 'lib', 'memory-runtime.cjs'));
const workflowRegistry = require(path.join(ROOT, 'lib', 'workflow-registry.cjs'));
const workflowImportHelpers = require(path.join(ROOT, 'lib', 'workflow-import.cjs'));

const RUNTIME_CONFIG = runtime.loadRuntimeConfig(ROOT);
const externalAgent = externalAgentHelpers.createExternalAgentHelpers({
  runtime,
  runtimeHostHelpers: runtimeHost
});

const REVIEW_AGENT_NAMES = [
  'hw-scout',
  'bug-hunter',
  'sys-reviewer',
  'release-checker'
];

const DEFAULT_ARCH_REVIEW_PATTERNS = [
  'chip selection',
  'device selection',
  'mcu selection',
  'soc selection',
  'solution preflight',
  'architecture preflight',
  'system preflight',
  'selection review',
  'pre-mortem',
  'project kickoff review',
  'prototype to production',
  'PoC to production',
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
  return runtime.getProjectExtDir(resolveProjectRoot());
}

function getProjectProfilesDir() {
  return path.join(getProjectExtDir(), 'profiles');
}

function getProjectStatePaths() {
  return runtime.getProjectStatePaths(ROOT, resolveProjectRoot(), RUNTIME_CONFIG);
}

function loadWorkflowCatalog() {
  return workflowRegistry.loadWorkflowRegistry(ROOT, {
    projectExtDir: getProjectExtDir()
  });
}

function getProjectConfig() {
  return runtime.loadProjectConfig(resolveProjectRoot(), RUNTIME_CONFIG);
}

function hasConfiguredQualityGates(projectConfig) {
  const gates =
    projectConfig && projectConfig.quality_gates && typeof projectConfig.quality_gates === 'object'
      ? projectConfig.quality_gates
      : {};
  return Boolean(
    (Array.isArray(gates.required_skills) && gates.required_skills.length > 0) ||
    (Array.isArray(gates.required_executors) && gates.required_executors.length > 0) ||
    (Array.isArray(gates.required_signoffs) && gates.required_signoffs.length > 0)
  );
}

function applyProfileQualityGateDefaults(profile, projectConfig, explicitProfileName = '') {
  if (
    !projectConfig ||
    hasConfiguredQualityGates(projectConfig) ||
    !String(explicitProfileName || '').trim()
  ) {
    return projectConfig;
  }

  const defaults =
    profile && profile.default_quality_gates && typeof profile.default_quality_gates === 'object'
      ? runtime.validateQualityGates(profile.default_quality_gates)
      : null;
  const hasDefaults =
    defaults &&
    (
      defaults.required_skills.length > 0 ||
      defaults.required_executors.length > 0 ||
      defaults.required_signoffs.length > 0
    );

  if (!hasDefaults) {
    return projectConfig;
  }

  return runtime.validateProjectConfig(
    {
      ...projectConfig,
      quality_gates: defaults
    },
    RUNTIME_CONFIG
  );
}

function normalizeSession(session, paths) {
  return runtime.normalizeSession(session, paths, RUNTIME_CONFIG, getProjectConfig());
}

function readDefaultSession(paths) {
  return runtime.loadDefaultSession(ROOT, paths, RUNTIME_CONFIG, getProjectConfig());
}

function initProjectLayout() {
  return runtime.initProjectLayout(resolveProjectRoot());
}

function getRuntimeHost() {
  return runtimeHost.resolveRuntimeHost(ROOT);
}

const {
  ensureSession,
  loadSession,
  saveSession,
  loadHandoff,
  saveHandoff,
  clearHandoff,
  loadContextSummary,
  saveContextSummary,
  clearContextSummary,
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

function getCatalogSpecEntry(name, options = {}) {
  const entry = (loadWorkflowCatalog().specs || []).find(item => item.name === name);
  if (!entry) {
    throw new Error(`Spec not found: ${name}`);
  }
  if (options.selectable === true && entry.selectable !== true) {
    throw new Error(`Spec is not selectable: ${name}`);
  }
  return entry;
}

function buildSpecView(entry, options = {}) {
  const includeContent = options.includeContent !== false;
  return {
    name: entry.name,
    title: entry.title || entry.name,
    path: entry.display_path,
    scope: entry.scope,
    summary: entry.summary,
    auto_inject: entry.auto_inject,
    selectable: entry.selectable === true,
    priority: entry.priority,
    apply_when: entry.apply_when,
    focus_areas: entry.focus_areas || [],
    extra_review_axes: entry.extra_review_axes || [],
    preferred_notes: entry.preferred_notes || [],
    default_agents: entry.default_agents || [],
    ...(includeContent ? { content: runtime.readText(entry.absolute_path) } : {})
  };
}

function listSpecNames(options = {}) {
  const selectableOnly = options.selectable === true;
  return runtime.unique(
    (loadWorkflowCatalog().specs || [])
      .filter(item => (selectableOnly ? item.selectable === true : true))
      .map(item => item.name)
  );
}

function loadSpec(name) {
  const entry = getCatalogSpecEntry(name);
  return buildSpecView(entry, { includeContent: true });
}

function loadSelectedSpec(name) {
  const entry = getCatalogSpecEntry(name, { selectable: true });

  return buildSpecView(entry, { includeContent: true });
}

function loadMarkdown(dirPath, name, kind) {
  const filePath = path.join(dirPath, `${name}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${kind} not found: ${name}`);
  }

  const displayRoot = SOURCE_LAYOUT ? SOURCE_ROOT : ROOT;

  return {
    name,
    path: path.relative(displayRoot, filePath).replace(/\\/g, '/'),
    content: runtime.readText(filePath)
  };
}

function loadCommandMarkdown(name) {
  const resolvedName = name;
  const fileName = `${resolvedName}.md`;
  const publicPath = path.join(COMMANDS_DIR, fileName);
  if (fs.existsSync(publicPath)) {
    const command = loadMarkdown(COMMANDS_DIR, resolvedName, 'Command');
    return {
      ...command,
      name
    };
  }

  const hiddenPath = path.join(COMMAND_DOCS_DIR, fileName);
  if (fs.existsSync(hiddenPath)) {
    const displayRoot = SOURCE_LAYOUT ? SOURCE_ROOT : ROOT;
    return {
      name,
      path: path.relative(displayRoot, hiddenPath).replace(/\\/g, '/'),
      content: runtime.readText(hiddenPath)
    };
  }

  throw new Error(`Command not found: ${name}`);
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
  buildRecommendedSources,
  buildSuggestedTools,
  buildToolRecommendations,
  buildToolExecutionFromNext,
  buildToolExecutionFromRecommendation,
  enrichWithToolSuggestions
} = toolSuggestionHelpers.createToolSuggestionHelpers({
  ROOT,
  runtime,
  toolCatalog,
  toolRuntime
});

function resolveSession() {
  const session = loadSession();
  const rawProjectConfig = getProjectConfig();
  const explicitProfileName = session.project_profile || (rawProjectConfig && rawProjectConfig.project_profile) || '';
  const effectiveProfileName = explicitProfileName || RUNTIME_CONFIG.default_profile;
  const profile = loadProfile(effectiveProfileName);
  const selectedSpecs = (session.active_specs || []).map(loadSelectedSpec);
  const projectConfig = applyProfileQualityGateDefaults(profile, rawProjectConfig, explicitProfileName);
  const hardwareIdentity = hardwareTruthHelpers.loadHardwareTruth(runtime, session.project_root || resolveProjectRoot());
  const chipProfile = findChipProfileByModel(hardwareIdentity.model, hardwareIdentity.package);
  const recommendedSources = buildRecommendedSources(chipProfile);
  const suggestedTools = buildSuggestedTools(chipProfile);
  const toolRecommendations = buildToolRecommendations(chipProfile, suggestedTools, hardwareIdentity);
  const agents = runtime.unique([
    ...(profile.default_agents || []),
    ...selectedSpecs.flatMap(spec => spec.default_agents || [])
  ]);

  const reviewAgents = runtime.unique(
    agents.filter(name => REVIEW_AGENT_NAMES.includes(name))
  );

  return {
    session,
    profile,
    project_config: projectConfig,
    selected_specs: selectedSpecs,
    hardware: {
      identity: hardwareIdentity,
      chip_profile: chipProfile
    },
    effective: {
      agents,
      review_agents: reviewAgents,
      focus_areas: runtime.unique(selectedSpecs.flatMap(spec => spec.focus_areas || [])),
      review_axes: runtime.unique([
        ...(profile.review_axes || []),
        ...selectedSpecs.flatMap(spec => spec.extra_review_axes || [])
      ]),
      note_targets: runtime.unique([
        ...(profile.notes_targets || []),
        ...selectedSpecs.flatMap(spec => spec.preferred_notes || [])
      ]),
      search_priority: profile.search_priority || [],
      guardrails: profile.guardrails || [],
      resource_priority: profile.resource_priority || [],
      recommended_sources: recommendedSources,
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
  getActiveTask,
  handleTaskCommands
} = taskCommandHelpers.createTaskCommandHelpers({
  childProcess,
  fs,
  path,
  runtime,
  resolveProjectRoot,
  getProjectExtDir,
  getProjectConfig,
  loadSession,
  resolveSession,
  updateSession,
  requireRestText,
  docCache,
  adapterSources,
  rootDir: ROOT
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
  buildWorkflowStage,
  shouldSuggestPlan,
  shouldSuggestReview,
  suggestFlow,
  buildPausePayload,
  buildPauseContextSummary,
  buildCompressContextSummary
} = sessionFlowHelpers.createSessionFlowHelpers({
  runtime,
  RUNTIME_CONFIG,
  DEFAULT_ARCH_REVIEW_PATTERNS,
  getRuntimeHost: () => runtimeHost.resolveRuntimeHost(ROOT),
  buildInitGuidance: (...args) => buildInitGuidance(...args),
  resolveSession,
  getProjectStatePaths,
  getHealthReport: () => buildHealthReport(),
  getProjectConfig,
  loadHandoff,
  loadContextSummary,
  enrichWithToolSuggestions,
  getActiveTask,
  listSkills: (...args) => listSkills(...args)
});

const {
  selectNestedField,
  parseProjectShowArgs,
  parseProjectSetArgs,
  parseAdapterSourceAddArgs,
  parseAdapterSyncArgs,
  parseAdapterExportArgs,
  parseAdapterPublishArgs,
  parseAdapterBootstrapArgs,
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
  bootstrapAdapterSource,
  syncNamedAdapterSource,
  syncAllAdapterSources
} = projectConfigHelpers.createProjectConfigHelpers({
  path,
  process,
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
  buildSettingsView,
  handleSettingsCommands
} = settingsCommandHelpers.createSettingsCommandHelpers({
  runtime,
  RUNTIME_CONFIG,
  getRuntimeHost: () => runtimeHost.resolveRuntimeHost(ROOT),
  loadSession,
  updateSession,
  loadProfile,
  loadSpec,
  getProjectConfig
});

const {
  listExecutors,
  showExecutor,
  runExecutor,
  handleExecutorCommands
} = executorCommandHelpers.createExecutorCommandHelpers({
  path,
  process,
  childProcess,
  runtime,
  resolveProjectRoot,
  getProjectConfig,
  updateSession
});

const {
  runSubAgentBridge,
  collectSubAgentBridgeJobs
} = subAgentRuntimeHelpers.createSubAgentRuntimeHelpers({
  fs,
  path,
  process,
  childProcess,
  runtimeHost: getRuntimeHost,
  runtime,
  resolveSession,
  loadMarkdown,
  AGENTS_DIR,
  getProjectStatePaths
});

const {
  buildHealthReport,
  buildBootstrapReport,
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
  loadSpec,
  findChipProfileByModel,
  resolveSession,
  buildToolExecutionFromRecommendation,
  ingestDocCli,
  attachProjectCli,
  adapterSources,
  rootDir: ROOT,
  getRuntimeHost,
  updateSession
});

const {
  listSkills,
  loadSkill,
  runSkill,
  parseSkillListArgs,
  installSkillSource,
  enableInstalledSkill,
  disableInstalledSkill,
  removeInstalledSkill
} = skillRuntimeHelpers.createSkillRuntimeHelpers({
  childProcess,
  fs,
  path,
  process,
  runtime,
  runtimeConfig: RUNTIME_CONFIG,
  runtimeHost: getRuntimeHost,
  resolveProjectRoot,
  getProjectExtDir,
  updateSession,
  builtInSkillsDir: SKILLS_DIR,
  builtInDisplayRoot: SOURCE_LAYOUT ? SOURCE_ROOT : ROOT
});

const {
  loadInstructionLayers,
  listAutoMemory,
  loadMemoryEntry,
  rememberMemory,
  extractMemory,
  auditMemory,
  promoteMemory,
  parseMemoryRememberArgs,
  parseMemoryExtractArgs,
  parseMemoryPromoteArgs,
  maybeAutoExtractOnPause,
  maybeAutoExtractOnSessionReport
} = memoryRuntimeHelpers.createMemoryRuntimeHelpers({
  fs,
  path,
  runtime,
  runtimeHost: getRuntimeHost,
  resolveProjectRoot,
  getProjectExtDir,
  resolveSession,
  updateSession,
  builtInMemoryDir: MEMORY_DIR,
  builtInDisplayRoot: SOURCE_LAYOUT ? SOURCE_ROOT : ROOT
});

const {
  runSessionReport,
  listStoredSessionReports,
  buildCurrentSessionView,
  writeSessionContinuityArtifacts,
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
  getProjectStatePaths,
  updateSession,
  maybeAutoExtractOnSessionReport
});

const {
  handleTranscriptCommands
} = transcriptCommandHelpers.createTranscriptCommandHelpers({
  fs,
  os,
  path,
  runtime,
  getProjectExtDir,
  updateSession,
  getRuntimeHost
});

const {
  handleWorkflowCommands
} = workflowAuthoringHelpers.createWorkflowAuthoringHelpers({
  fs,
  childProcess,
  os,
  path,
  process,
  ROOT,
  runtime,
  workflowRegistry,
  workflowImport: workflowImportHelpers.createWorkflowImportHelpers({
    childProcess,
    fs,
    os,
    path,
    process,
    runtime,
    workflowRegistry
  }),
  capabilityMaterializer: capabilityMaterializerHelpers.createCapabilityMaterializerHelpers({
    fs,
    path,
    runtime,
    workflowRegistry,
    getProjectExtDir
  }),
  templateCli,
  getProjectExtDir,
  loadSpec,
  updateSession
});

const {
  handleScaffoldCommands
} = scaffoldAuthoringHelpers.createScaffoldAuthoringHelpers({
  fs,
  path,
  process,
  ROOT,
  runtime,
  templateCli,
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
  AGENTS_DIR,
  COMMANDS_DIR,
  commandVisibility,
  RUNTIME_CONFIG,
  getProjectProfilesDir,
  listSpecNames,
  loadProfile,
  loadSpec,
  loadCommandMarkdown,
  loadMarkdown,
  loadSession,
  updateSession,
  getProjectStatePaths,
  getPreferences,
  getProjectConfig,
  requireRestText,
  requirePreferenceKey,
  handleScaffoldCommands,
  handleWorkflowCommands,
  handleHealthUpdateCommands,
  handleTaskCommands,
  handleExecutorCommands,
  handleSettingsCommands,
  handleSessionReportCommands,
  handleTranscriptCommands,
  listSkills,
  loadSkill,
  runSkill,
  parseSkillListArgs,
  installSkillSource,
  enableInstalledSkill,
  disableInstalledSkill,
  removeInstalledSkill,
  loadInstructionLayers,
  listAutoMemory,
  loadMemoryEntry,
  rememberMemory,
  extractMemory,
  auditMemory,
  promoteMemory,
  parseMemoryRememberArgs,
  parseMemoryExtractArgs,
  parseMemoryPromoteArgs
});

function buildContextOverview() {
  const resolved = resolveSession();
  const sessionView = buildCurrentSessionView();
  const status = buildStatus();
  const next = buildNextContext();
  const start = buildStartContext();
  const bootstrap = buildBootstrapReport();
  const health = buildHealthReport();

  return {
    entry: 'context',
    project_root: resolved && resolved.session ? resolved.session.project_root : resolveProjectRoot(),
    summary: {
      profile: resolved && resolved.session ? resolved.session.project_profile : '',
      specs: resolved && resolved.session ? resolved.session.active_specs || [] : [],
      focus: resolved && resolved.session ? resolved.session.focus || '' : '',
      last_command: resolved && resolved.session ? resolved.session.last_command || '' : '',
      active_task:
        status && status.active_task && status.active_task.name
          ? {
              name: status.active_task.name,
              title: status.active_task.title || '',
              status: status.active_task.status || ''
            }
          : null,
      handoff_present: Boolean(sessionView && sessionView.handoff),
      stored_reports:
        sessionView &&
        sessionView.reports &&
        Array.isArray(sessionView.reports.reports)
          ? sessionView.reports.reports.length
          : 0,
      latest_report_present: Boolean(sessionView && sessionView.latest_report)
    },
    session_state: sessionView ? sessionView.session_state : null,
    memory_summary: loadContextSummary(),
    handoff: sessionView ? sessionView.handoff : null,
    continuity: sessionView ? sessionView.continuity || null : null,
    latest_report: sessionView ? sessionView.latest_report || null : null,
    reports: sessionView ? sessionView.reports : { reports: [] },
    status,
    next,
    start,
    bootstrap,
    health
  };
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function applyAdapterWritePermission(result, actionName, explicitConfirmation) {
  const permissionDecision = permissionGateHelpers.evaluateExecutionPermission({
    action_kind: 'write',
    action_name: actionName,
    risk: 'normal',
    explicit_confirmation: explicitConfirmation === true,
    permissions: (getProjectConfig() && getProjectConfig().permissions) || {}
  });

  return {
    permission: permissionDecision,
    result: permissionGateHelpers.applyPermissionDecision(result, permissionDecision)
  };
}

function runAdapterDerive(args) {
  const parsed = adapterDeriveCli.parseArgs(args || []);
  if (parsed.help) {
    return adapterDeriveCli.deriveProfiles(args, {
      runtimeRoot: ROOT,
      projectRoot: resolveProjectRoot()
    });
  }

  const actionName =
    parsed.target === 'runtime'
      ? 'support-derive-runtime'
      : parsed.target === 'path'
        ? 'support-derive-path'
        : 'support-derive-project';
  const blocked = applyAdapterWritePermission({
    status: 'permission-pending',
    target: parsed.target,
    output_root: parsed.outputRoot || '',
    family: parsed.family,
    device: parsed.device,
    chip: parsed.chip,
    tools: parsed.tools
  }, actionName, parsed.explicit_confirmation);

  if (blocked.permission.decision !== 'allow') {
    return blocked.result;
  }

  return permissionGateHelpers.applyPermissionDecision(adapterDeriveCli.deriveProfiles(args, {
    runtimeRoot: ROOT,
    projectRoot: resolveProjectRoot()
  }), blocked.permission);
}

function runAdapterGenerate(args) {
  const parsed = adapterDeriveCli.parseArgs(args || []);
  if (parsed.help) {
    return adapterDeriveCli.deriveProfiles(args, {
      runtimeRoot: ROOT,
      projectRoot: resolveProjectRoot()
    });
  }

  const blocked = applyAdapterWritePermission({
    status: 'permission-pending',
    target: parsed.target,
    output_root: parsed.outputRoot || '',
    family: parsed.family,
    device: parsed.device,
    chip: parsed.chip,
    tools: parsed.tools
  }, 'support-generate', parsed.explicit_confirmation);

  if (blocked.permission.decision !== 'allow') {
    return blocked.result;
  }

  return permissionGateHelpers.applyPermissionDecision(adapterDeriveCli.deriveProfiles(args, {
    runtimeRoot: ROOT,
    projectRoot: resolveProjectRoot()
  }), blocked.permission);
}

function runAdapterAnalysisInit(args) {
  const parsed = supportAnalysisCli.parseInitArgs(args || []);
  if (parsed.help) {
    return supportAnalysisCli.initAnalysis(args, {
      projectRoot: resolveProjectRoot()
    });
  }

  const blocked = applyAdapterWritePermission({
    status: 'permission-pending',
    target: 'project',
    output_root: parsed.output || '',
    family: parsed.family,
    device: parsed.device,
    chip: parsed.chip || parsed.model,
    tools: []
  }, 'support-analysis-init', true);

  if (blocked.permission.decision !== 'allow') {
    return blocked.result;
  }

  return permissionGateHelpers.applyPermissionDecision(supportAnalysisCli.initAnalysis(args, {
    projectRoot: resolveProjectRoot()
  }), blocked.permission);
}

function buildDerivedSupportTransferInspection(parsed) {
  return adapterDeriveCli.inspectDerivedSupport({
    projectRoot: resolveProjectRoot(),
    family: parsed.family,
    device: parsed.device,
    chip: parsed.chip
  });
}

function runAdapterExport(args) {
  const parsed = parseAdapterExportArgs(args || []);
  const inspection = buildDerivedSupportTransferInspection(parsed);
  const actionName = parsed.output_root ? 'support-export-path' : 'support-export-source';
  const blocked = applyAdapterWritePermission({
    status: 'permission-pending',
    target: parsed.output_root ? 'path' : 'source',
    output_root: parsed.output_root || '',
    family: inspection.family,
    device: inspection.device,
    chip: inspection.chip,
    tools: inspection.tools || []
  }, actionName, parsed.explicit_confirmation);

  if (blocked.permission.decision !== 'allow') {
    return blocked.result;
  }

  return permissionGateHelpers.applyPermissionDecision(adapterSources.exportDerivedSupport(
    ROOT,
    resolveProjectRoot(),
    getProjectConfig(),
    {
      sourceName: parsed.source_name,
      outputRoot: parsed.output_root,
      force: parsed.force,
      inspection
    }
  ), blocked.permission);
}

function runAdapterPublish(args) {
  const parsed = parseAdapterPublishArgs(args || []);
  const inspection = buildDerivedSupportTransferInspection(parsed);
  const actionName = parsed.output_root ? 'support-publish-path' : 'support-publish-source';
  const blocked = applyAdapterWritePermission({
    status: 'permission-pending',
    target: parsed.output_root ? 'path' : 'source',
    output_root: parsed.output_root || '',
    family: inspection.family,
    device: inspection.device,
    chip: inspection.chip,
    tools: inspection.tools || []
  }, actionName, parsed.explicit_confirmation);

  if (blocked.permission.decision !== 'allow') {
    return blocked.result;
  }

  return permissionGateHelpers.applyPermissionDecision(adapterSources.publishDerivedSupport(
    ROOT,
    resolveProjectRoot(),
    getProjectConfig(),
    {
      sourceName: parsed.source_name,
      outputRoot: parsed.output_root,
      force: parsed.force,
      inspection
    }
  ), blocked.permission);
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
  parseVerifySaveArgs,
  parseVerifySignoffArgs,
  buildVerifyEntry,
  confirmVerifySignoff,
  rejectVerifySignoff,
  saveVerifyReport,
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
  buildNextContext,
  updateSession
});

const {
  buildInitGuidance,
  buildBootstrapSummary,
  buildStartWorkflow,
  buildTaskIntake,
  buildUsagePayload,
  usage,
  runInitCommand,
  runIngestCommand
} = cliEntryHelpers.createCliEntryHelpers({
  fs,
  path,
  process,
  ROOT,
  runtime,
  RUNTIME_CONFIG,
  resolveProjectRoot,
  getProjectExtDir,
  initProjectLayout,
  ensureSession,
  updateSession,
  capabilityMaterializer: capabilityMaterializerHelpers.createCapabilityMaterializerHelpers({
    fs,
    path,
    runtime,
    workflowRegistry,
    getProjectExtDir
  }),
  attachProjectCli,
  chipCatalog,
  ingestTruthCli,
  ingestDocCli,
  ingestSchematicCli
});

function buildStartContext() {
  const projectRoot = resolveProjectRoot();
  if (!fs.existsSync(runtime.resolveProjectDataPath(projectRoot, 'project.json'))) {
    runInitCommand([], 'start');
  }
  const initialized = fs.existsSync(runtime.resolveProjectDataPath(projectRoot, 'project.json'));
  const resolved = initialized ? resolveSession() : null;
  const initGuidance = buildInitGuidance(projectRoot);
  const bootstrap = buildBootstrapSummary(initGuidance);
  const bootstrapReport = initialized ? buildBootstrapReport() : null;
  const nextContext = initialized ? buildNextContext() : null;
  const resumeContext = initialized ? buildResumeContext() : null;
  const activeTask = getActiveTask();
  const handoff = loadHandoff();
  const bootstrapPending = Boolean(
    initialized &&
    bootstrap &&
    (
      bootstrap.status !== 'ready-for-next' ||
      (bootstrap.command && bootstrap.command !== 'next')
    )
  );
  const bootstrapCommand = bootstrapPending && bootstrap && bootstrap.command
    ? bootstrap.command
    : '';
  const taskIntake = buildTaskIntake({
    activeTask,
    hasHandoff: Boolean(handoff),
    bootstrapPending
  });
  const immediateCommand = handoff
    ? 'resume'
    : bootstrapCommand
      ? bootstrapCommand
    : activeTask
      ? 'next'
      : initialized
        ? 'task add <summary>'
        : 'start';
  const immediateReason = handoff
    ? 'An unconsumed handoff exists and should be restored before any new work.'
    : bootstrapCommand
      ? bootstrap.summary
    : activeTask
      ? 'An active task already exists. Continue that task before starting new work.'
      : initialized
        ? 'The emb-agent project bootstrap already exists. Create and activate a task before execution.'
        : 'The emb-agent project has just been initialized in this workspace.';

  return runtimeEventHelpers.appendRuntimeEvent({
    entry: 'start',
    summary: {
      project_root: projectRoot,
      initialized,
      active_task: activeTask
        ? {
            name: activeTask.name,
            title: activeTask.title,
            status: activeTask.status,
            package: activeTask.package || '',
            worktree_path: activeTask.worktree_path,
            prd_path: `.emb-agent/tasks/${activeTask.name}/prd.md`
          }
        : null,
      handoff_present: Boolean(handoff),
      default_package: resolved && resolved.session ? resolved.session.default_package || '' : '',
      active_package: resolved && resolved.session ? resolved.session.active_package || '' : '',
      hardware_identity: initGuidance.selected_identity
    },
    immediate: {
      command: immediateCommand,
      reason: immediateReason,
      cli: `${getRuntimeHost().cliCommand} ${immediateCommand}`
    },
    task_intake: taskIntake,
    workflow: {
      mode: 'linear-default',
      steps: buildStartWorkflow(initGuidance, {
        initialized,
        activeTask,
        hasHandoff: Boolean(handoff)
      })
    },
    bootstrap: bootstrapReport
      ? {
          ...bootstrap,
          quickstart: bootstrapReport.quickstart || null,
          next_stage: bootstrapReport.next_stage || null,
          action_card: bootstrapReport.action_card || null
        }
      : bootstrap,
    next: nextContext
      ? {
          command: nextContext.next.command,
          reason: nextContext.next.reason,
          workflow_stage: nextContext.workflow_stage,
          cli: nextContext.next.cli
        }
      : null,
    resume: resumeContext
      ? {
          context_hygiene: resumeContext.context_hygiene,
          handoff: resumeContext.handoff,
          task: resumeContext.task
        }
      : null
  }, {
    type: 'workflow-start',
    category: 'workflow',
    status: bootstrapCommand ? 'pending' : 'ok',
    severity: bootstrapCommand ? 'normal' : 'info',
    summary: immediateReason,
    action: immediateCommand,
    command: `${getRuntimeHost().cliCommand} ${immediateCommand}`,
    source: 'emb-agent-main',
    details: {
      initialized,
      handoff_present: Boolean(handoff),
      active_task: activeTask ? activeTask.name : ''
    }
  });
}

function buildExternalStartProtocol() {
  return externalAgent.buildStartProtocol(getRuntimeHost(), buildStartContext());
}

function buildExternalNextProtocol() {
  return externalAgent.buildNextProtocol(getRuntimeHost(), buildNextContext());
}

function buildExternalStatusProtocol() {
  return externalAgent.buildStatusProtocol(getRuntimeHost(), buildStatus());
}

function buildExternalHealthProtocol() {
  return externalAgent.buildHealthProtocol(getRuntimeHost(), buildHealthReport());
}

function buildExternalDispatchNextProtocol() {
  return externalAgent.buildDispatchNextProtocol(getRuntimeHost(), buildDispatchContext('next'));
}

function buildExternalInitProtocol(tokens, aliasUsed) {
  const initialized = runInitCommand(tokens, aliasUsed);
  return initialized ? externalAgent.buildInitProtocol(getRuntimeHost(), initialized) : null;
}

const referenceLookupCli = {
  lookupDocs(projectRoot, args) {
    return referenceLookupHelpers.lookupDocs(projectRoot, args, {
      runtime,
      ingestSchematicCli
    });
  },
  lookupComponents(projectRoot, args) {
    return referenceLookupHelpers.lookupComponents(projectRoot, args, {
      runtime,
      runtimeConfig: RUNTIME_CONFIG,
      ingestSchematicCli
    });
  },
  fetchDocument(projectRoot, args, options) {
    return referenceLookupHelpers.fetchDocument(projectRoot, args, options);
  }
};

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
  buildHealthReport: () => buildHealthReport(),
  buildContextHygiene,
  enrichWithToolSuggestions,
  buildArchReviewContext,
  buildWorkflowStage,
  getActiveTask
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

const capabilityMaterializer = capabilityMaterializerHelpers.createCapabilityMaterializerHelpers({
  fs,
  path,
  runtime,
  workflowRegistry,
  getProjectExtDir
});

const {
  handleCapabilityCommands,
  executeCapability
} = capabilityRuntimeHelpers.createCapabilityRuntimeHelpers({
  updateSession,
  buildActionOutput,
  buildArchReviewContext,
  buildNextContext,
  buildStartContext,
  buildStatus,
  getActiveTask,
  handleCatalogAndStateCommands,
  capabilityMaterializer
});

const {
  handleDocCommands,
  handleActionCommands,
  handleDispatchCommands,
  handleAdapterToolChipCommands,
  executeDispatchCommand,
  executeOrchestratorCommand
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
  getActiveTask,
  updateSession,
  buildNextContext,
  buildStartContext,
  runSubAgentBridge,
  collectSubAgentBridgeJobs,
  buildActionOutput,
  executeCapability,
  buildReviewContext,
  buildArchReviewContext,
  buildDispatchContext,
  buildOrchestratorContext,
  buildAdapterStatus,
  addAdapterSource,
  removeAdapterSource,
  bootstrapAdapterSource,
  parseAdapterSyncArgs,
  syncNamedAdapterSource,
  syncAllAdapterSources,
  runAdapterDerive,
  runAdapterGenerate,
  runAdapterAnalysisInit,
  runAdapterExport,
  runAdapterPublish,
  handleCatalogAndStateCommands,
  handleCapabilityCommands,
  saveScanReport,
    savePlanReport,
    saveReviewReport,
    confirmVerifySignoff,
    rejectVerifySignoff,
    saveVerifyReport,
    addNoteEntry,
    ingestDocCli,
    referenceLookupCli
});

const {
  run: runCliRouter
} = cliRouterHelpers.createCliRouter({
  process,
  buildUsagePayload,
  usage,
  printJson,
  runInitCommand,
  buildExternalInitProtocol,
  runIngestCommand,
  buildStartContext,
  buildExternalStartProtocol,
  buildStatus,
  buildExternalStatusProtocol,
  buildExternalHealthProtocol,
  buildBootstrapReport,
  updateSession,
  buildNextContext,
  buildExternalNextProtocol,
  buildExternalDispatchNextProtocol,
  buildDispatchContext,
  executeDispatchCommand,
  executeOrchestratorCommand,
  loadHandoff,
  loadContextSummary,
  clearHandoff,
  clearContextSummary,
  buildPausePayload,
  buildPauseContextSummary,
  maybeAutoExtractOnPause,
  writeSessionContinuityArtifacts,
  buildContextOverview,
  buildCompressContextSummary,
  saveHandoff,
  saveContextSummary,
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
  handleDispatchCommands,
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
  executeCapability,
  buildDispatchContext,
  buildOrchestratorContext,
  buildContextHygiene,
  buildGuidance,
  buildStartContext,
  buildExternalStartProtocol,
  buildNextContext,
  buildExternalNextProtocol,
  buildPausePayload,
  buildCompressContextSummary,
  buildStatus,
  buildExternalStatusProtocol,
  buildExternalHealthProtocol,
  buildExternalDispatchNextProtocol,
  buildHealthReport,
  buildBootstrapReport,
  buildUpdateView,
  buildProjectShow,
  buildAdapterStatus,
  listExecutors,
  showExecutor,
  runExecutor,
  setProjectConfigValue,
  addAdapterSource,
  removeAdapterSource,
  bootstrapAdapterSource,
  syncNamedAdapterSource,
  syncAllAdapterSources,
  runAdapterDerive,
  runAdapterGenerate,
  runAdapterAnalysisInit,
  runAdapterExport,
  runAdapterPublish,
  parseProjectShowArgs,
  parseProjectSetArgs,
  parseAdapterSourceAddArgs,
  parseAdapterBootstrapArgs,
  parseAdapterSyncArgs,
  buildResumeContext,
  buildContextOverview,
  buildArchReviewContext,
  buildReviewContext,
  runSessionReport,
  listStoredSessionReports,
  listSkills,
  loadSkill,
  runSkill,
  installSkillSource,
  enableInstalledSkill,
  disableInstalledSkill,
  removeInstalledSkill,
  loadInstructionLayers,
  listAutoMemory,
  loadMemoryEntry,
  rememberMemory,
  extractMemory,
  auditMemory,
  promoteMemory,
  runSubAgentBridge,
  collectSubAgentBridgeJobs,
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
