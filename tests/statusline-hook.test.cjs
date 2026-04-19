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

  fs.mkdirSync(taskDir, { recursive: true });
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
  assert.match(output, /pkg:fw/);
  assert.match(output, /felix/);
  assert.match(output, /1 task\(s\)/);
});
