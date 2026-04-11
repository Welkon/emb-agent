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
  path,
  process
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

function runHook(rawInput) {
  return hookDispatch.runHookWithProjectContext(rawInput, ({ data, projectRoot }) => {
    const cli = require(path.join(__dirname, '..', 'bin', 'emb-agent.cjs'));
    const resume = cli.buildResumeContext();
    const lines = buildUpdateLines();
    const specLines = buildInjectedSpecLines(projectRoot, resume);

    if (resume.handoff) {
      const nextAction = resume.handoff.next_action || 'run resume first to restore the working state';
      lines.unshift(
        '## Emb-Agent Session Reminder',
        '',
        `Found an unconsumed handoff. Run this first: ${resume.context_hygiene.resume_cli}`,
        `Next step: ${nextAction}`,
        `Suggested chain: ${resume.context_hygiene.clear_hint}`,
        ...specLines
      );
    }

    if (!resume.handoff && resume.task) {
      const implementFiles = (((resume.task.context || {}).implement) || [])
        .slice(0, 4)
        .map(item => item.path)
        .filter(Boolean);

      lines.unshift(
        '## Emb-Agent Session Reminder',
        '',
        `Current active task: ${resume.task.name} (${resume.task.title})`,
        `Status: ${resume.task.status} / Type: ${resume.task.type}`,
        implementFiles.length > 0
          ? `Re-read the task implement context first: ${implementFiles.join(', ')}`
          : 'Run task context list <name> first to confirm the local context for the current task.',
        ...specLines
      );
    }

    if (lines.length === 0) {
      return '';
    }

    if (lines[0] !== '## Emb-Agent Session Reminder') {
      lines.unshift('## Emb-Agent Session Reminder', '');
    }

    lines.push('');
    return lines.join('\n');
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
