'use strict';

function getUpdateCachePath(path, stateRoot) {
  if (process.env.EMB_AGENT_UPDATE_CACHE_PATH) {
    return path.resolve(process.env.EMB_AGENT_UPDATE_CACHE_PATH);
  }
  return path.join(stateRoot, 'cache', 'update-check.json');
}

function readInstalledVersion(fs, path, runtimeRoot) {
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

function readUpdateCache(fs, cachePath) {
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

function isUpdateCacheStale(cache, intervalMs) {
  if (!cache || !cache.checked_at) {
    return true;
  }

  return Date.now() - Number(cache.checked_at) > intervalMs;
}

function detectStaleInstall(installed, hookVersion) {
  if (!installed || !hookVersion || String(hookVersion).includes('{')) {
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

function triggerUpdateCheck(deps) {
  const {
    fs,
    path,
    childProcess,
    process,
    cachePath,
    installed,
    packageName,
    intervalMs,
    cache,
    force,
    skipEnvVar
  } = deps;

  if (process.env[skipEnvVar || 'EMB_AGENT_SKIP_UPDATE_CHECK'] === '1') {
    return {
      triggered: false,
      reason: 'skip-env'
    };
  }

  if (!force && !isUpdateCacheStale(cache, intervalMs)) {
    return {
      triggered: false,
      reason: 'fresh-cache'
    };
  }

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });

  const child = childProcess.spawn(
    process.execPath,
    [
      '-e',
      `
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cachePath = ${JSON.stringify(cachePath)};
const installed = ${JSON.stringify(installed)};
const packageName = ${JSON.stringify(packageName || 'emb-agent')};

let latest = '';
let error = '';
try {
  latest = execSync(\`npm view \${packageName} version\`, {
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

  return {
    triggered: true,
    reason: force ? 'forced' : 'stale-cache'
  };
}

module.exports = {
  compareVersions,
  detectStaleInstall,
  getUpdateCachePath,
  isUpdateCacheStale,
  parseVersion,
  readInstalledVersion,
  readUpdateCache,
  triggerUpdateCheck
};
