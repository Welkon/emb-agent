#!/usr/bin/env node
// emb-hook-version: {{EMB_VERSION}}

'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const hookDispatchHelpers = require('../lib/hook-dispatch.cjs');
const hookTrustHelpers = require('../lib/hook-trust.cjs');
const runtimeHostHelpers = require('../lib/runtime-host.cjs');
const updateCheckHelpers = require('../lib/update-check.cjs');
const coreProtocolHelpers = require('../lib/core-protocols.cjs');
const runtime = require('../lib/runtime.cjs');
const workflowRegistry = require('../lib/workflow-registry.cjs');
const sessionReportStoreHelpers = require('../lib/session-report-store.cjs');
const specLoader = require('../lib/spec-loader.cjs');

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HOOK_VERSION = '{{EMB_VERSION}}';
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);
const hookDispatch = hookDispatchHelpers.createHookDispatchHelpers({
  fs,
  path,
  process,
  runtimeHost: RUNTIME_HOST
});
const sessionReportStore = sessionReportStoreHelpers.createSessionReportStoreHelpers({
  fs,
  path,
  runtime
});

function getRuntimeRoot() {
  return RUNTIME_HOST.runtimeRoot;
}

function getStateRoot() {
  return RUNTIME_HOST.stateRoot;
}

function getUpdateCachePath() {
  return updateCheckHelpers.getUpdateCachePath(path, getStateRoot());
}

function readInstalledVersion() {
  return updateCheckHelpers.readInstalledVersion(fs, path, getRuntimeRoot());
}

function parseVersion(version) {
  return updateCheckHelpers.parseVersion(version);
}

function compareVersions(left, right) {
  return updateCheckHelpers.compareVersions(left, right);
}

function readUpdateCache() {
  return updateCheckHelpers.readUpdateCache(fs, getUpdateCachePath());
}

function isUpdateCacheStale(cache) {
  return updateCheckHelpers.isUpdateCacheStale(cache, UPDATE_CHECK_INTERVAL_MS);
}

function triggerUpdateCheck(cache) {
  const cachePath = getUpdateCachePath();
  runtime.ensureDir(path.dirname(cachePath));
  const installed = readInstalledVersion();

  return updateCheckHelpers.triggerUpdateCheck({
    fs,
    path,
    childProcess,
    process,
    cachePath,
    installed,
    packageName: 'emb-agent',
    intervalMs: UPDATE_CHECK_INTERVAL_MS,
    cache
  });
}

function detectStaleInstall() {
  const installed = readInstalledVersion();
  const hookVersion = process.env.EMB_AGENT_FORCE_HOOK_VERSION || HOOK_VERSION;
  return updateCheckHelpers.detectStaleInstall(installed, hookVersion);
}

function buildUpdateLines() {
  const lines = [];
  const staleInstall = detectStaleInstall();
  const cache = readUpdateCache();
  triggerUpdateCheck(cache);

  if (staleInstall) {
    lines.push(`Detected stale install: hooks=${staleInstall.hook}, runtime=${staleInstall.installed}`);
    lines.push('Re-run emb-agent install to keep hooks / runtime / agents in sync.');
  }

  if (cache && cache.update_available && cache.latest) {
    lines.push(`Found a newer emb-agent version: ${cache.installed || 'unknown'} -> ${cache.latest}`);
    lines.push('Manual release mode is active; run the release check and reinstall manually when needed.');
  }

  return lines;
}

function buildInjectedWorkflowSpecLines(projectRoot, resume) {
  const registry = workflowRegistry.loadWorkflowRegistry(getRuntimeRoot(), {
    projectExtDir: runtime.getProjectExtDir(projectRoot)
  });
  const specs = workflowRegistry.resolveAutoInjectedSpecs(registry, {
    profile: resume && resume.summary ? resume.summary.profile : '',
    specs: resume && resume.summary ? (resume.summary.specs || []) : [],
    task: resume ? resume.task : null,
    handoff: resume ? resume.handoff : null
  }, { limit: 5 });

  if (specs.length === 0) {
    return [];
  }

  return [
    'Auto-injected workflow specs:',
    ...specs.map(item => {
      const reason = item.reasons.join(', ');
      return `- ${item.name} (${item.display_path}): ${item.summary}${reason ? ` [${reason}]` : ''}`;
    })
  ];
}

function buildSessionReportLines(projectRoot, currentBranch) {
  const storedContinuity = sessionReportStore.readStoredSessionContinuity(
    runtime.getProjectExtDir(projectRoot),
    {
      cwd: projectRoot
    }
  );
  const continuity = sessionReportStore.buildSessionReportContinuity(
    runtime.getProjectExtDir(projectRoot),
    {
      cwd: projectRoot,
      current_branch: currentBranch
    }
  );

  if (!continuity.present || !continuity.preferred) {
    return [];
  }

  const report = continuity.preferred;
  const lines = [
    storedContinuity && storedContinuity.markdown_file
      ? `Continuity file: ${storedContinuity.markdown_file}`
      : '',
    `Latest session checkpoint: ${report.summary || report.id}`,
    `Checkpoint file: ${report.markdown_file || report.json_file || '(unknown)'}`
  ].filter(Boolean);

  if (report.generated_at) {
    lines.push(`Checkpoint recorded: ${report.generated_at}`);
  }
  if (report.next_command) {
    lines.push(`Checkpoint next command: ${report.next_command}`);
  }
  if (report.next_reason) {
    lines.push(`Checkpoint reason: ${report.next_reason}`);
  }

  if (continuity.branch_status === 'match') {
    lines.push(`Checkpoint branch: ${report.git_branch} (matches current branch)`);
  } else if (continuity.branch_status === 'mismatch') {
    lines.push(`Checkpoint branch: ${report.git_branch} (current branch: ${continuity.current_branch || 'unknown'})`);
  } else if (report.git_branch) {
    lines.push(`Checkpoint branch: ${report.git_branch}`);
  }

  return lines;
}

const WORKFLOW_STATES = [
  'unknown',
  'hw_declared',
  'datasheet_ingested',
  'bootstrap_ready',
  'implementing',
  'board_verified',
  'resolved'
];

const WORKFLOW_NEXT = {
  unknown: { command: 'declare hardware', reason: 'Hardware not yet declared. Run declare hardware to set MCU, package, and constraints.' },
  hw_declared: { command: 'ingest doc', reason: 'Hardware declared. Ingest datasheet or schematic to populate chip truth.' },
  datasheet_ingested: { command: 'bootstrap run --confirm', reason: 'Datasheet ingested. Run bootstrap to initialize project.' },
  bootstrap_ready: { command: 'next', reason: 'Project bootstrapped. Follow next command for the shortest path.' },
  implementing: { command: 'capability run do', reason: 'Task in progress. Execute the current capability.' },
  board_verified: { command: 'verify', reason: 'Board verified. Run verify to close quality gates.' },
  resolved: { command: 'next', reason: 'Task resolved. Run next for the next task.' }
};

function resolveWorkflowState(hwConfig, activeTask) {
  if (!hwConfig || !hwConfig.chip) {
    return 'unknown';
  }
  if (!hwConfig.datasheets || !Array.isArray(hwConfig.datasheets) || hwConfig.datasheets.length === 0) {
    return 'hw_declared';
  }
  if (!activeTask) {
    return 'bootstrap_ready';
  }
  if (activeTask.status === 'completed' || activeTask.status === 'rejected') {
    return 'resolved';
  }
  if (activeTask.status === 'review') {
    return 'board_verified';
  }
  return 'implementing';
}

function buildWorkflowStateLines(projectRoot) {
  const hwPath = runtime.resolveProjectDataPath(projectRoot, 'hw.yaml');
  const hwConfig = (fs.existsSync(hwPath)) ? runtime.parseSimpleYaml(hwPath) : null;

  const state = resolveWorkflowState(hwConfig, null);
  const nextStep = WORKFLOW_NEXT[state] || WORKFLOW_NEXT.unknown;

  return [
    `<workflow-state status="${state}">`,
    `Current state: ${state}`,
    `Next step: ${nextStep.command}`,
    `Reason: ${nextStep.reason}`,
    '</workflow-state>'
  ];
}

function buildSpecInjectionLines(projectRoot) {
  const specLoaderHelpers = specLoader.createSpecLoaderHelpers({ fs, path });
  const specsDir = path.join(runtime.getProjectExtDir(projectRoot), 'specs');

  if (!fs.existsSync(specsDir)) {
    return [];
  }

  const hwPath = runtime.resolveProjectDataPath(projectRoot, 'hw.yaml');
  const hwConfig = (fs.existsSync(hwPath)) ? runtime.parseSimpleYaml(hwPath) : {};

  return specLoaderHelpers.getSpecIndexLines(specsDir, [], hwConfig, []);
}

function buildSessionContext(projectRoot, start, resume, options) {
  const settings = options && typeof options === 'object' ? options : {};
  const lines = [
    '<emb-agent-session-context>',
    'emb-agent startup context is already injected for this session.',
    'Do not ask the user to run start just to load bootstrap state.',
    'Use the injected state below as the source of truth and continue from the recommended next step.',
    '</emb-agent-session-context>',
    '',
    '<current-state>',
    `Project root: ${projectRoot}`,
    settings.initializedDuringHook
      ? 'Repository bootstrap: initialized automatically during SessionStart'
      : 'Repository bootstrap: already initialized',
    `Recommended next command: ${start.immediate.command}`,
    `Recommended CLI: ${start.immediate.cli}`,
    `Reason: ${start.immediate.reason}`
  ];

  if (start.bootstrap) {
    lines.push(`Bootstrap status: ${start.bootstrap.status}`);
    if (start.bootstrap.stage) {
      lines.push(`Bootstrap stage: ${start.bootstrap.stage}`);
    }
    if (start.bootstrap.summary) {
      lines.push(`Bootstrap summary: ${start.bootstrap.summary}`);
    }
  }

  if (resume && resume.handoff) {
    lines.push(`Pending handoff: ${resume.handoff.next_action || 'resume the existing handoff before new work'}`);
  }

  if (resume && resume.task) {
    const implementFiles = (((resume.task.context || {}).implement) || [])
      .slice(0, 4)
      .map(item => item.path)
      .filter(Boolean);
    const prdPath = resume.task.artifacts && resume.task.artifacts.prd
      ? resume.task.artifacts.prd
      : `.emb-agent/tasks/${resume.task.name}/prd.md`;

    lines.push(`Active task: ${resume.task.name} (${resume.task.title})`);
    lines.push(`Task status: ${resume.task.status} / Type: ${resume.task.type}`);
    lines.push(`Task PRD: ${prdPath}`);
    lines.push(
      implementFiles.length > 0
        ? `Task implement context: ${implementFiles.join(', ')}`
        : `Task implement context: run task context list ${resume.task.name}`
    );
  }

  if (
    !summaryHasActiveTask(start) &&
    start.task_intake &&
    typeof start.task_intake === 'object' &&
    start.task_intake.summary
  ) {
    lines.push(
      `${
        start.task_intake.status === 'blocked-by-bootstrap'
          ? 'Task intake after bootstrap'
          : 'Task intake'
      }: ${start.task_intake.summary}`
    );
  }

  if (Array.isArray(settings.sessionReportLines) && settings.sessionReportLines.length > 0) {
    lines.push(...settings.sessionReportLines);
  }
  if (Array.isArray(settings.specLines) && settings.specLines.length > 0) {
    lines.push(...settings.specLines);
  }
  if (Array.isArray(settings.updateLines) && settings.updateLines.length > 0) {
    lines.push(...settings.updateLines);
  }

  lines.push('</current-state>', '');
  lines.push('<ready>');
  lines.push('Startup context is already injected above.');
  lines.push('Only suggest running start when the user explicitly wants to re-render the entry context manually.');
  lines.push('If bootstrap is incomplete, guide the user through the shortest next step instead of redirecting back to start.');
  lines.push('</ready>');

  return lines.join('\n');
}

function summaryHasActiveTask(start) {
  return Boolean(
    start &&
    start.summary &&
    typeof start.summary === 'object' &&
    start.summary.active_task &&
    typeof start.summary.active_task === 'object' &&
    start.summary.active_task.name
  );
}

function buildHostSessionStartPayload(data, message) {
  const eventName = data && (data.hook_event_name || data.event)
    ? String(data.hook_event_name || data.event)
    : 'SessionStart';

  if (RUNTIME_HOST.name === 'cursor') {
    return {
      additional_context: message
    };
  }

  if (RUNTIME_HOST.name === 'codex') {
    return {
      suppressOutput: true,
      systemMessage: `emb-agent context injected (${message.length} chars)`,
      hookSpecificOutput: {
        hookEventName: eventName,
        additionalContext: message
      }
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: message
    }
  };
}

function runHook(rawInput) {
  return hookDispatch.runHookWithProjectContext(rawInput, ({ data, projectRoot }) => {
    const cli = require(path.join(__dirname, '..', 'bin', 'emb-agent.cjs'));
    const projectConfigPath = runtime.resolveProjectDataPath(projectRoot, 'project.json');
    const hadProjectConfig = fs.existsSync(projectConfigPath);
    const start = cli.buildStartContext();
    const resume = start.summary && start.summary.initialized ? cli.buildResumeContext() : { handoff: null, task: null };
    const session = typeof cli.loadSession === 'function' ? cli.loadSession() : null;
    const updateLines = buildUpdateLines();
    const coreProtocolLines = coreProtocolHelpers.buildCoreProtocolLines();
    const workflowSpecLines = buildInjectedWorkflowSpecLines(projectRoot, resume);
    const workflowStateLines = buildWorkflowStateLines(projectRoot);
    const constraintSpecLines = buildSpecInjectionLines(projectRoot);
    const sessionReportLines = buildSessionReportLines(
      projectRoot,
      session && session.git_branch ? session.git_branch : ''
    );
    const message = buildSessionContext(projectRoot, start, resume, {
      initializedDuringHook: !hadProjectConfig && fs.existsSync(projectConfigPath),
      updateLines,
      specLines: [...coreProtocolLines, ...workflowSpecLines, ...workflowStateLines, ...constraintSpecLines],
      sessionReportLines
    });

    if (!message) {
      return '';
    }

    return JSON.stringify(buildHostSessionStartPayload(data, message));
  });
}

if (require.main === module) {
  hookDispatch.runHookCli(runHook);
}

module.exports = {
  buildInjectedWorkflowSpecLines,
  buildUpdateLines,
  compareVersions,
  detectStaleInstall,
  getUpdateCachePath,
  isUpdateCacheStale,
  readInstalledVersion,
  readUpdateCache,
  hookDispatch,
  hookTrustHelpers,
  runHook,
  triggerUpdateCheck
};
