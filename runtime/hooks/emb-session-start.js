#!/usr/bin/env node
// emb-hook-version: {{EMB_VERSION}}

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HOOK_VERSION = '{{EMB_VERSION}}';

function getRuntimeRoot() {
  return path.resolve(__dirname, '..');
}

function getCodexHome() {
  return path.resolve(getRuntimeRoot(), '..');
}

function isSourceRuntimeLayout() {
  const runtimeRoot = getRuntimeRoot();
  return path.basename(runtimeRoot) === 'runtime' && fs.existsSync(path.resolve(runtimeRoot, '..', 'package.json'));
}

function getStateRoot() {
  if (isSourceRuntimeLayout()) {
    return path.join(getCodexHome(), '.tmp', 'state', 'emb-agent');
  }
  return path.join(getCodexHome(), 'state', 'emb-agent');
}

function getUpdateCachePath() {
  return path.join(getStateRoot(), 'cache', 'update-check.json');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readInstalledVersion() {
  const runtimeRoot = getRuntimeRoot();
  const versionFile = path.join(runtimeRoot, 'VERSION');
  if (fs.existsSync(versionFile)) {
    return fs.readFileSync(versionFile, 'utf8').trim();
  }

  const packageFile = path.resolve(runtimeRoot, '..', 'package.json');
  if (fs.existsSync(packageFile)) {
    try {
      return JSON.parse(fs.readFileSync(packageFile, 'utf8')).version || '';
    } catch {
      return '';
    }
  }

  return '';
}

function parseVersion(version) {
  return String(version || '')
    .trim()
    .split('.')
    .map(part => Number(part.replace(/[^0-9].*$/, '')) || 0);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const size = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < size; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function readUpdateCache() {
  const cachePath = getUpdateCachePath();
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

function isUpdateCacheStale(cache) {
  if (!cache || !cache.checked_at) {
    return true;
  }
  return Date.now() - Number(cache.checked_at) > UPDATE_CHECK_INTERVAL_MS;
}

function triggerUpdateCheck(cache) {
  if (process.env.EMB_AGENT_SKIP_UPDATE_CHECK === '1') {
    return;
  }
  if (!isUpdateCacheStale(cache)) {
    return;
  }

  const cachePath = getUpdateCachePath();
  ensureDir(path.dirname(cachePath));
  const installed = readInstalledVersion();

  const child = spawn(
    process.execPath,
    [
      '-e',
      `
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cachePath = ${JSON.stringify(cachePath)};
const installed = ${JSON.stringify(installed)};

let latest = '';
let error = '';
try {
  latest = execSync('npm view emb-agent version', {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true
  }).trim();
} catch (err) {
  error = err && err.message ? err.message : 'npm view failed';
}

const result = {
  installed,
  latest,
  checked_at: Date.now(),
  update_available: Boolean(installed && latest && installed !== latest),
  status: latest ? 'ok' : 'unavailable',
  error
};

fs.mkdirSync(path.dirname(cachePath), { recursive: true });
fs.writeFileSync(cachePath, JSON.stringify(result, null, 2) + '\\n', 'utf8');
      `
    ],
    {
      stdio: 'ignore',
      windowsHide: true,
      detached: true
    }
  );

  child.unref();
}

function detectStaleInstall() {
  const installed = readInstalledVersion();
  const hookVersion = process.env.EMB_AGENT_FORCE_HOOK_VERSION || HOOK_VERSION;
  if (!installed || !hookVersion || hookVersion.includes('{')) {
    return null;
  }
  if (compareVersions(hookVersion, installed) === 0) {
    return null;
  }

  return {
    installed,
    hook: hookVersion
  };
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
