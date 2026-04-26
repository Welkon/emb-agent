'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const statuslineHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-statusline.js'));

test('statusline hook returns empty output outside emb-agent projects', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-statusline-empty-'));
  const output = statuslineHook.buildStatusLine({ cwd: tempDir });
  assert.equal(output, '');
});

test('statusline hook summarizes current task, branch, and developer', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-statusline-'));
  const embDir = path.join(tempProject, '.emb-agent');
  const taskDir = path.join(embDir, 'tasks', 'demo-task');
  const reportsDir = path.join(embDir, 'reports', 'sessions');

  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(embDir, '.current-task'), 'demo-task\n', 'utf8');
  fs.writeFileSync(
    path.join(embDir, 'project.json'),
    JSON.stringify({ default_package: 'app', active_package: 'fw' }, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(embDir, '.developer'),
    JSON.stringify({ name: 'felix', runtime: 'claude' }, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(taskDir, 'task.json'),
    JSON.stringify({
      name: 'demo-task',
      title: 'Exercise ADC path',
      status: 'in_progress',
      priority: 'P1',
      package: 'fw'
    }, null, 2) + '\n',
    'utf8'
  );
  childProcess.execFileSync('git', ['init', '-b', 'feat/statusline'], {
    cwd: tempProject,
    stdio: 'ignore'
  });
  fs.writeFileSync(
    path.join(reportsDir, 'report-20260420-100000.json'),
    JSON.stringify({
      id: 'report-20260420-100000',
      generated_at: '2026-04-20T10:00:00.000Z',
      summary: 'capture adc checkpoint',
      git_branch: 'feat/statusline',
      markdown_file: '.emb-agent/reports/sessions/report-20260420-100000.md',
      json_file: '.emb-agent/reports/sessions/report-20260420-100000.json'
    }, null, 2) + '\n',
    'utf8'
  );

  const output = statuslineHook.buildStatusLine({
    cwd: tempProject,
    model: { display_name: 'Claude Sonnet' },
    context_window: { used_percentage: 42 },
    cost: { total_duration_ms: 120000 }
  });

  assert.match(output, /\[P1\]/);
  assert.match(output, /Exercise ADC path/);
  assert.match(output, /in_progress/);
  assert.match(output, /Claude Sonnet/);
  assert.match(output, /feat\/statusline/);
  assert.match(output, /snapshot/);
  assert.match(output, /pkg:fw/);
  assert.match(output, /felix/);
  assert.match(output, /1 task\(s\)/);
});

test('statusline hook warns when the latest session checkpoint is from another branch', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-statusline-mismatch-'));
  const embDir = path.join(tempProject, '.emb-agent');
  const reportsDir = path.join(embDir, 'reports', 'sessions');

  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(embDir, 'project.json'),
    JSON.stringify({ default_package: 'fw', active_package: 'fw' }, null, 2) + '\n',
    'utf8'
  );
  childProcess.execFileSync('git', ['init', '-b', 'feat/current'], {
    cwd: tempProject,
    stdio: 'ignore'
  });
  fs.writeFileSync(
    path.join(reportsDir, 'report-20260420-110000.json'),
    JSON.stringify({
      id: 'report-20260420-110000',
      generated_at: '2026-04-20T11:00:00.000Z',
      summary: 'capture timer checkpoint',
      git_branch: 'main',
      markdown_file: '.emb-agent/reports/sessions/report-20260420-110000.md',
      json_file: '.emb-agent/reports/sessions/report-20260420-110000.json'
    }, null, 2) + '\n',
    'utf8'
  );

  const output = statuslineHook.buildStatusLine({
    cwd: tempProject,
    model: { display_name: 'GPT-5' },
    context_window: { used_percentage: 20 },
    cost: { total_duration_ms: 60000 }
  });

  assert.match(output, /feat\/current/);
  assert.match(output, /snapshot!/);
});
