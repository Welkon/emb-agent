#!/usr/bin/env node
// emb-hook-version: {{EMB_VERSION}}

'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const runtimeHostHelpers = require('../lib/runtime-host.cjs');
const updateCheckHelpers = require('../lib/update-check.cjs');

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HOOK_VERSION = '{{EMB_VERSION}}';
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);

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
    lines.push(`检测到 stale install: hooks=${staleInstall.hook}, runtime=${staleInstall.installed}`);
    lines.push('建议重新运行 emb-agent 安装，确保 hooks / runtime / skills 同步。');
  }

  if (cache && cache.update_available && cache.latest) {
    lines.push(`发现 emb-agent 新版本: ${cache.installed || 'unknown'} -> ${cache.latest}`);
    lines.push('当前采用手动发布模式；需要时手动执行 release 检查并重新安装。');
  }

  return lines;
}

function runHook(rawInput) {
  const data = typeof rawInput === 'string'
    ? (rawInput.trim() ? JSON.parse(rawInput) : {})
    : (rawInput || {});
  const cwd = data.cwd || process.cwd();
  const projectRoot = path.resolve(cwd);
  const cli = require(path.join(__dirname, '..', 'bin', 'emb-agent.cjs'));
  const previousCwd = process.cwd();

  try {
    process.chdir(projectRoot);
    const resume = cli.buildResumeContext();
    const lines = buildUpdateLines();

    function buildWorkspaceRefreshHint(workspace, carryOver) {
      if (!workspace || !workspace.name) {
        return null;
      }

      const snapshot = workspace.snapshot || {
        last_files: [],
        open_questions: [],
        known_risks: [],
        refreshed_at: ''
      };
      const reasons = [];

      if (!snapshot.refreshed_at) {
        reasons.push('workspace 还没 refresh');
      }
      if ((carryOver.last_files || []).length > 0 && (snapshot.last_files || []).length === 0) {
        reasons.push('最近文件还没沉到 workspace snapshot');
      }
      if ((carryOver.open_questions || []).some(item => !(snapshot.open_questions || []).includes(item))) {
        reasons.push('未决问题还没沉到 workspace snapshot');
      }
      if ((carryOver.known_risks || []).some(item => !(snapshot.known_risks || []).includes(item))) {
        reasons.push('已知风险还没沉到 workspace snapshot');
      }

      return reasons.length > 0
        ? {
            reasons,
            cli: `node ${RUNTIME_HOST.runtimeRoot}/bin/emb-agent.cjs workspace refresh ${workspace.name}`
          }
        : null;
    }

    if (resume.handoff) {
      const nextAction = resume.handoff.next_action || '先执行 resume 恢复现场';
      lines.unshift(
        '## Emb-Agent Session Reminder',
        '',
        `发现未消费的 handoff，优先执行: ${resume.context_hygiene.resume_cli}`,
        `下一步: ${nextAction}`,
        `建议链路: ${resume.context_hygiene.clear_hint}`
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
        `当前活跃 task: ${resume.task.name} (${resume.task.title})`,
        `状态: ${resume.task.status} / 类型: ${resume.task.type}`,
        implementFiles.length > 0
          ? `建议先回读 task implement context: ${implementFiles.join(', ')}`
          : '建议先执行 task context list <name>，确认当前 task 的局部上下文。'
      );
    }

    if (!resume.handoff && !resume.task && resume.workspace) {
      const refreshHint = buildWorkspaceRefreshHint(resume.workspace, resume.carry_over || {});
      lines.unshift(
        '## Emb-Agent Session Reminder',
        '',
        `当前活跃 workspace: ${resume.workspace.name} (${resume.workspace.title})`,
        `类型: ${resume.workspace.type} / 状态: ${resume.workspace.status}`,
        `建议先回读 workspace notes: ${resume.workspace.notes_path || resume.workspace.path}`,
        refreshHint
          ? `建议先同步 workspace: ${refreshHint.cli}`
          : 'workspace 已有 refresh 快照，可直接沿当前工作面继续'
      );
      if (refreshHint) {
        lines.splice(5, 0, `原因: ${refreshHint.reasons[0]}`);
      }
    }

    if (lines.length === 0) {
      return '';
    }

    if (lines[0] !== '## Emb-Agent Session Reminder') {
      lines.unshift('## Emb-Agent Session Reminder', '');
    }

    lines.push('');
    return lines.join('\n');
  } finally {
    process.chdir(previousCwd);
  }
}

let input = '';

if (require.main === module) {
  const stdinTimeout = setTimeout(() => process.exit(0), 5000);

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    input += chunk;
  });

  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);

    try {
      const output = runHook(input);
      if (output) {
        process.stdout.write(output);
      }
    } catch {
      process.exit(0);
    }
  });
}

module.exports = {
  buildUpdateLines,
  compareVersions,
  detectStaleInstall,
  getUpdateCachePath,
  isUpdateCacheStale,
  readInstalledVersion,
  readUpdateCache,
  runHook,
  triggerUpdateCheck
};
