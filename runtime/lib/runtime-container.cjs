'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function createRuntimeContainer(options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, '..'));
  const sourceRoot = path.resolve(rootDir, '..');
  const runtimeHost = require(path.join(rootDir, 'lib', 'runtime-host.cjs'));
  const sourceLayout = runtimeHost.isSourceRuntimeLayout(rootDir);
  const runtime = require(path.join(rootDir, 'lib', 'runtime.cjs'));
  const externalAgentHelpers = require(path.join(rootDir, 'lib', 'external-agent.cjs'));

  return {
    childProcess,
    fs,
    os,
    path,
    ROOT: rootDir,
    SOURCE_ROOT: sourceRoot,
    runtimeHost,
    SOURCE_LAYOUT: sourceLayout,
    PROFILES_DIR: path.join(rootDir, 'profiles'),
    AGENTS_DIR: sourceLayout ? path.join(sourceRoot, 'agents') : path.join(rootDir, 'agents'),
    COMMANDS_DIR: sourceLayout ? path.join(sourceRoot, 'commands', 'emb') : path.join(rootDir, 'commands'),
    COMMAND_DOCS_DIR: sourceLayout ? path.join(sourceRoot, 'commands', 'emb') : path.join(rootDir, 'command-docs'),
    SKILLS_DIR: sourceLayout ? path.join(sourceRoot, 'skills') : path.join(rootDir, 'skills'),
    MEMORY_DIR: sourceLayout ? path.join(sourceRoot, 'memory') : path.join(rootDir, 'memory'),
    TEMPLATES_DIR: require(path.join(rootDir, 'lib', 'template-registry.cjs')).TEMPLATES_DIR,
    templateCli: require(path.join(rootDir, 'scripts', 'template.cjs')),
    adapterDeriveCli: require(path.join(rootDir, 'scripts', 'adapter-derive.cjs')),
    supportAnalysisCli: require(path.join(rootDir, 'scripts', 'support-analysis.cjs')),
    attachProjectCli: require(path.join(rootDir, 'scripts', 'attach-project.cjs')),
    ingestTruthCli: require(path.join(rootDir, 'scripts', 'ingest-truth.cjs')),
    ingestDocCli: require(path.join(rootDir, 'scripts', 'ingest-doc.cjs')),
    ingestSchematicCli: require(path.join(rootDir, 'scripts', 'ingest-schematic.cjs')),
    ingestBoardCli: require(path.join(rootDir, 'scripts', 'ingest-board.cjs')),
    runtime,
    scheduler: require(path.join(rootDir, 'lib', 'scheduler.cjs')),
    toolCatalog: require(path.join(rootDir, 'lib', 'tool-catalog.cjs')),
    toolRuntime: require(path.join(rootDir, 'lib', 'tool-runtime.cjs')),
    toolSuggestionHelpers: require(path.join(rootDir, 'lib', 'tool-suggestions.cjs')),
    chipCatalog: require(path.join(rootDir, 'lib', 'chip-catalog.cjs')),
    adapterCommandRuntimeHelpers: require(path.join(rootDir, 'lib', 'adapter-command-runtime.cjs')),
    adapterSources: require(path.join(rootDir, 'lib', 'adapter-sources.cjs')),
    docCache: require(path.join(rootDir, 'lib', 'doc-cache.cjs')),
    permissionGateHelpers: require(path.join(rootDir, 'lib', 'permission-gates.cjs')),
    noteReportHelpers: require(path.join(rootDir, 'lib', 'note-reports.cjs')),
    noteReportRuntimeHelpers: require(path.join(rootDir, 'lib', 'note-report-runtime.cjs')),
    contextProtocolRuntimeHelpers: require(path.join(rootDir, 'lib', 'context-protocol-runtime.cjs')),
    dispatchHelpers: require(path.join(rootDir, 'lib', 'dispatch-orchestrator.cjs')),
    runtimeEventHelpers: require(path.join(rootDir, 'lib', 'runtime-events.cjs')),
    sessionFlowHelpers: require(path.join(rootDir, 'lib', 'session-flow.cjs')),
    referenceLookupHelpers: require(path.join(rootDir, 'lib', 'reference-lookup.cjs')),
    boardEvidence: require(path.join(rootDir, 'lib', 'board-evidence.cjs')),
    hardwareTruthHelpers: require(path.join(rootDir, 'lib', 'hardware-truth.cjs')),
    catalogLoaderHelpers: require(path.join(rootDir, 'lib', 'catalog-loaders.cjs')),
    projectConfigHelpers: require(path.join(rootDir, 'lib', 'project-config.cjs')),
    stateCommandHelpers: require(path.join(rootDir, 'lib', 'state-commands.cjs')),
    actionContractHelpers: require(path.join(rootDir, 'lib', 'action-contracts.cjs')),
    commandGroupHelpers: require(path.join(rootDir, 'lib', 'command-groups.cjs')),
    cliEntryHelpers: require(path.join(rootDir, 'lib', 'cli-entrypoints.cjs')),
    cliRouterHelpers: require(path.join(rootDir, 'lib', 'cli-router.cjs')),
    taskCommandHelpers: require(path.join(rootDir, 'lib', 'task-commands.cjs')),
    projectStateStoreHelpers: require(path.join(rootDir, 'lib', 'project-state-store.cjs')),
    settingsCommandHelpers: require(path.join(rootDir, 'lib', 'settings-command.cjs')),
    sessionReportCommandHelpers: require(path.join(rootDir, 'lib', 'session-report-command.cjs')),
    transcriptCommandHelpers: require(path.join(rootDir, 'lib', 'transcript-command.cjs')),
    healthUpdateCommandHelpers: require(path.join(rootDir, 'lib', 'health-update-command.cjs')),
    executorCommandHelpers: require(path.join(rootDir, 'lib', 'executor-command.cjs')),
    commandVisibility: require(path.join(rootDir, 'lib', 'command-visibility.cjs')),
    workflowAuthoringHelpers: require(path.join(rootDir, 'lib', 'workflow-authoring.cjs')),
    capabilityMaterializerHelpers: require(path.join(rootDir, 'lib', 'capability-materializer.cjs')),
    capabilityRuntimeHelpers: require(path.join(rootDir, 'lib', 'capability-runtime.cjs')),
    scaffoldAuthoringHelpers: require(path.join(rootDir, 'lib', 'scaffold-authoring.cjs')),
    subAgentRuntimeHelpers: require(path.join(rootDir, 'lib', 'sub-agent-runtime.cjs')),
    skillRuntimeHelpers: require(path.join(rootDir, 'lib', 'skill-runtime.cjs')),
    memoryRuntimeHelpers: require(path.join(rootDir, 'lib', 'memory-runtime.cjs')),
    knowledgeRuntimeHelpers: require(path.join(rootDir, 'lib', 'knowledge-runtime.cjs')),
    workflowRegistry: require(path.join(rootDir, 'lib', 'workflow-registry.cjs')),
    workflowImportHelpers: require(path.join(rootDir, 'lib', 'workflow-import.cjs')),
    RUNTIME_CONFIG: runtime.loadRuntimeConfig(rootDir),
    externalAgent: externalAgentHelpers.createExternalAgentHelpers({
      runtime,
      runtimeHostHelpers: runtimeHost
    })
  };
}

module.exports = {
  createRuntimeContainer
};
