#!/usr/bin/env node

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const {
  childProcess,
  fs,
  os,
  SOURCE_ROOT,
  runtimeHost,
  SOURCE_LAYOUT,
  PROFILES_DIR,
  AGENTS_DIR,
  COMMANDS_DIR,
  COMMAND_DOCS_DIR,
  SKILLS_DIR,
  MEMORY_DIR,
  TEMPLATES_DIR,
  templateCli,
  adapterDeriveCli,
  supportAnalysisCli,
  attachProjectCli,
  ingestTruthCli,
  ingestDocCli,
  ingestSchematicCli,
  ingestBoardCli,
  runtime,
  scheduler,
  toolCatalog,
  toolRuntime,
  toolSuggestionHelpers,
  chipCatalog,
  adapterCommandRuntimeHelpers,
  adapterSources,
  docCache,
  permissionGateHelpers,
  noteReportHelpers,
  noteReportRuntimeHelpers,
  contextProtocolRuntimeHelpers,
  dispatchHelpers,
  runtimeEventHelpers,
  sessionFlowHelpers,
  referenceLookupHelpers,
  boardEvidence,
  hardwareTruthHelpers,
  catalogLoaderHelpers,
  projectConfigHelpers,
  stateCommandHelpers,
  actionContractHelpers,
  commandGroupHelpers,
  cliEntryHelpers,
  cliRouterHelpers,
  taskCommandHelpers,
  projectStateStoreHelpers,
  settingsCommandHelpers,
  sessionReportCommandHelpers,
  transcriptCommandHelpers,
  healthUpdateCommandHelpers,
  executorCommandHelpers,
  commandVisibility,
  workflowAuthoringHelpers,
  capabilityMaterializerHelpers,
  capabilityRuntimeHelpers,
  scaffoldAuthoringHelpers,
  subAgentRuntimeHelpers,
  skillRuntimeHelpers,
  memoryRuntimeHelpers,
  workflowRegistry,
  workflowImportHelpers,
  RUNTIME_CONFIG,
  externalAgent
} = require(path.join(ROOT, 'lib', 'runtime-container.cjs')).createRuntimeContainer({ rootDir: ROOT });

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

function getProjectStatePaths() {
  return runtime.getProjectStatePaths(ROOT, resolveProjectRoot(), RUNTIME_CONFIG);
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

const {
  findChipProfileByModel,
  getProjectProfilesDir,
  listSpecNames,
  loadCommandMarkdown,
  loadMarkdown,
  loadProfile,
  loadSelectedSpec,
  loadSpec
} = catalogLoaderHelpers.createCatalogLoaders({
  fs,
  path,
  ROOT,
  SOURCE_ROOT,
  SOURCE_LAYOUT,
  PROFILES_DIR,
  COMMANDS_DIR,
  COMMAND_DOCS_DIR,
  runtime,
  workflowRegistry,
  chipCatalog,
  getProjectExtDir
});

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

function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

const {
  runAdapterAnalysisInit,
  runAdapterDerive,
  runAdapterExport,
  runAdapterGenerate,
  runAdapterPublish
} = adapterCommandRuntimeHelpers.createAdapterCommandRuntime({
  ROOT,
  adapterDeriveCli,
  supportAnalysisCli,
  adapterSources,
  permissionGateHelpers,
  resolveProjectRoot,
  getProjectConfig,
  parseAdapterExportArgs,
  parseAdapterPublishArgs
});

const {
  saveReviewReport,
  saveScanReport,
  savePlanReport,
  confirmVerifySignoff,
  rejectVerifySignoff,
  saveVerifyReport,
  addNoteEntry
} = noteReportRuntimeHelpers.createNoteReportRuntime({
  fs,
  path,
  process,
  noteReportHelpers,
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
  ingestSchematicCli,
  ingestBoardCli
});

const {
  buildContextOverview,
  buildStartContext,
  buildExternalStartProtocol,
  buildExternalNextProtocol,
  buildExternalStatusProtocol,
  buildExternalHealthProtocol,
  buildExternalDispatchNextProtocol,
  buildExternalInitProtocol
} = contextProtocolRuntimeHelpers.createContextProtocolRuntime({
  fs,
  runtime,
  runtimeEventHelpers,
  externalAgent,
  boardEvidence,
  resolveProjectRoot,
  getRuntimeHost,
  resolveSession,
  buildCurrentSessionView,
  buildStatus,
  buildNextContext,
  buildBootstrapReport,
  buildHealthReport,
  loadContextSummary,
  runInitCommand,
  buildInitGuidance,
  buildBootstrapSummary,
  buildResumeContext,
  getActiveTask,
  loadHandoff,
  buildTaskIntake,
  buildStartWorkflow,
  buildDispatchContext: (...args) => buildDispatchContext(...args)
});

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
  querySchematic(projectRoot, subject, args) {
    return referenceLookupHelpers.querySchematic(projectRoot, subject, args, {
      runtime,
      ingestSchematicCli
    });
  },
  queryBoard(projectRoot, subject, args) {
    return referenceLookupHelpers.queryBoard(projectRoot, subject, args, {
      runtime,
      ingestBoardCli
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
