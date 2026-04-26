#!/usr/bin/env node
// emb-hook-version: {{EMB_VERSION}}

'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const runtime = require('../lib/runtime.cjs');
const sessionReportStoreHelpers = require('../lib/session-report-store.cjs');

const sessionReportStore = sessionReportStoreHelpers.createSessionReportStoreHelpers({
  fs,
  path,
  runtime
});

function findProjectRoot(startDir) {
  let current = path.resolve(startDir || process.cwd());

  while (true) {
    if (fs.existsSync(path.join(current, '.emb-agent'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return '';
    }
    current = parent;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function readText(filePath) {
  try {
    return String(fs.readFileSync(filePath, 'utf8') || '').trim();
  } catch {
    return '';
  }
}

function getGitBranch(projectRoot) {
  if (!projectRoot || !fs.existsSync(path.join(projectRoot, '.git'))) {
    return '';
  }

  try {
    return String(childProcess.execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }) || '').trim();
  } catch {
    return '';
  }
}

function getDeveloper(projectRoot) {
  const payload = readJson(path.join(projectRoot, '.emb-agent', '.developer'));
  return String(payload.name || '').trim();
}

function getCurrentTask(projectRoot) {
  const taskName = readText(path.join(projectRoot, '.emb-agent', '.current-task'));
  if (!taskName) {
    return null;
  }

  const manifest = readJson(path.join(projectRoot, '.emb-agent', 'tasks', taskName, 'task.json'));
  if (!manifest || typeof manifest !== 'object') {
    return null;
  }

  return {
    name: taskName,
    title: String(manifest.title || manifest.name || taskName).trim(),
    status: String(manifest.status || '').trim(),
    priority: String(manifest.priority || 'P2').trim(),
    package: String(manifest.package || '').trim()
  };
}

function getProjectPackageState(projectRoot) {
  const payload = readJson(path.join(projectRoot, '.emb-agent', 'project.json'));
  return {
    default_package: String(payload.default_package || '').trim(),
    active_package: String(payload.active_package || '').trim()
  };
}

function parseSimpleYaml(filePath) {
  try {
    const content = String(fs.readFileSync(filePath, 'utf8') || '');
    const lines = content.split('\n');
    const result = {};
    let listKey = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;
      const key = trimmed.substring(0, colonIdx).trim();
      let value = trimmed.substring(colonIdx + 1).trim();
      if (value === '' || value === '|') {
        listKey = key;
        result[key] = [];
        continue;
      }
      if (trimmed.startsWith('- ') && listKey) {
        result[listKey].push(trimmed.substring(2).trim());
        continue;
      }
      listKey = '';
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

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

function getWorkflowState(projectRoot, task) {
  const hwPath = path.join(projectRoot, '.emb-agent', 'hw.yaml');
  const hwConfig = fs.existsSync(hwPath) ? parseSimpleYaml(hwPath) : null;
  return resolveWorkflowState(hwConfig, task);
}

function countTasks(projectRoot) {
  const tasksDir = path.join(projectRoot, '.emb-agent', 'tasks');
  if (!fs.existsSync(tasksDir) || !fs.statSync(tasksDir).isDirectory()) {
    return 0;
  }

  return fs.readdirSync(tasksDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'archive')
    .filter(entry => fs.existsSync(path.join(tasksDir, entry.name, 'task.json')))
    .length;
}

function getSessionCheckpoint(projectRoot, branch) {
  try {
    return sessionReportStore.buildSessionReportContinuity(
      path.join(projectRoot, '.emb-agent'),
      {
        cwd: projectRoot,
        current_branch: branch
      }
    );
  } catch {
    return {
      present: false,
      branch_status: 'none',
      preferred: null
    };
  }
}

function colorize(code, text) {
  return `\u001b[${code}m${text}\u001b[0m`;
}

function formatContextPercent(raw) {
  const value = Number(raw || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 'ctx 0%';
  }
  if (value >= 90) {
    return `context ${colorize(31, `${Math.round(value)}%`)}`;
  }
  if (value >= 70) {
    return `context ${colorize(33, `${Math.round(value)}%`)}`;
  }
  return `context ${colorize(32, `${Math.round(value)}%`)}`;
}

function formatDuration(rawMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(rawMs || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h${minutes}m`;
  }
  return `${minutes}m`;
}

function buildStatusLine(input) {
  const cwd = String((input && input.cwd) || process.cwd()).trim() || process.cwd();
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    return '';
  }

  const task = getCurrentTask(projectRoot);
  const workflowState = getWorkflowState(projectRoot, task);
  const developer = getDeveloper(projectRoot);
  const branch = getGitBranch(projectRoot);
  const taskCount = countTasks(projectRoot);
  const packageState = getProjectPackageState(projectRoot);
  const sessionCheckpoint = getSessionCheckpoint(projectRoot, branch);
  const model = String(
    (input && input.model && (input.model.display_name || input.model.name)) ||
    input.model ||
    ''
  ).trim();
  const contextPercent =
    (input && input.context_window && input.context_window.used_percentage) ||
    (input && input.contextWindow && input.contextWindow.used_percentage) ||
    0;
  const durationMs =
    (input && input.cost && input.cost.total_duration_ms) ||
    (input && input.duration_ms) ||
    0;

  const sep = ` ${colorize(90, '·')} `;
  const infoParts = [];

  if (model) {
    infoParts.push(model);
  }
  infoParts.push(formatContextPercent(contextPercent));
  if (branch) {
    infoParts.push(colorize(35, branch));
  }
  if (sessionCheckpoint.present) {
    if (sessionCheckpoint.branch_status === 'mismatch') {
      infoParts.push(colorize(33, 'snapshot!'));
    } else if (sessionCheckpoint.branch_status === 'match') {
      infoParts.push(colorize(32, 'snapshot'));
    } else {
      infoParts.push(colorize(90, 'snapshot?'));
    }
  }
  const packageName = task && task.package
    ? task.package
    : (packageState.active_package || packageState.default_package || '');
  if (packageName) {
    infoParts.push(colorize(36, `pkg:${packageName}`));
  }
  infoParts.push(formatDuration(durationMs));
  if (developer) {
    infoParts.push(colorize(32, developer));
  }
  if (taskCount > 0) {
    infoParts.push(`${taskCount} task(s)`);
  }

  const lines = [];

  const stateLabels = {
    unknown: 'no hardware',
    hw_declared: 'chip identified',
    datasheet_ingested: 'datasheet read',
    bootstrap_ready: 'tools ready',
    implementing: 'building',
    board_verified: 'verified',
    resolved: 'done'
  };
  const stateColors = {
    unknown: 31,
    hw_declared: 33,
    datasheet_ingested: 33,
    bootstrap_ready: 32,
    implementing: 36,
    board_verified: 35,
    resolved: 32
  };
  const stateColor = stateColors[workflowState] || 90;
  const stateLabel = stateLabels[workflowState] || workflowState;
  lines.push(`${colorize(stateColor, `[${stateLabel}]`)}`);

  if (task) {
    lines.push(`${colorize(36, `[${task.priority || 'P2'}]`)} ${task.title} ${colorize(33, `(${task.status || 'unknown'})`)}`);
  }
  lines.push(infoParts.join(sep));
  return `${lines.join('\n')}\n`;
}

function readStdin(callback) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    if (!raw.trim()) {
      callback({});
      return;
    }
    try {
      callback(JSON.parse(raw));
    } catch {
      callback({});
    }
  });
}

if (require.main === module) {
  readStdin(input => {
    const output = buildStatusLine(input);
    if (output) {
      process.stdout.write(output);
    }
  });
}

module.exports = {
  buildStatusLine
};
