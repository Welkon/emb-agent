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
const runtime = require('../lib/runtime.cjs');
const workflowRegistry = require('../lib/workflow-registry.cjs');

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HOOK_VERSION = '{{EMB_VERSION}}';
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);
const hookDispatch = hookDispatchHelpers.createHookDispatchHelpers({
  fs,
  path,
  process,
  runtimeHost: RUNTIME_HOST
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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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
  ensureDir(path.dirname(cachePath));
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

function buildInjectedSpecLines(projectRoot, resume) {
  const registry = workflowRegistry.loadWorkflowRegistry(getRuntimeRoot(), {
    projectExtDir: runtime.getProjectExtDir(projectRoot)
  });
  const specs = workflowRegistry.resolveAutoInjectedSpecs(registry, {
    profile: resume && resume.summary ? resume.summary.profile : '',
    packs: resume && resume.summary ? resume.summary.packs : [],
    task: resume ? resume.task : null,
    handoff: resume ? resume.handoff : null
  }, { limit: 5 });

  if (specs.length === 0) {
    return [];
  }

  return [
    'Auto-injected specs:',
    ...specs.map(item => {
      const reason = item.reasons.join(', ');
      return `- ${item.name} (${item.display_path}): ${item.summary}${reason ? ` [${reason}]` : ''}`;
    })
  ];
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
    const updateLines = buildUpdateLines();
    const specLines = buildInjectedSpecLines(projectRoot, resume);
    const message = buildSessionContext(projectRoot, start, resume, {
      initializedDuringHook: !hadProjectConfig && fs.existsSync(projectConfigPath),
      updateLines,
      specLines
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
