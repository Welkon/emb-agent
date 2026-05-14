'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const statuslineHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-statusline.js'));

function hasCargo() {
  try {
    childProcess.execFileSync('cargo', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runRust(args, cwd = repoRoot) {
  return childProcess.execFileSync('cargo', ['run', '-q', '-p', 'emb-agent-rs', '--', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-rust-parity-'));
  const embDir = path.join(root, '.emb-agent');
  const taskDir = path.join(embDir, 'tasks', 'adc-task');
  const wikiDir = path.join(embDir, 'wiki', 'chips');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(embDir, 'project.json'), JSON.stringify({
    default_package: 'fw',
    active_package: 'fw'
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(embDir, '.developer'), JSON.stringify({ name: 'felix' }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(embDir, '.current-task'), 'adc-task\n', 'utf8');
  fs.writeFileSync(path.join(embDir, 'hw.yaml'), [
    'mcu:',
    '  vendor: Espressif',
    '  model: ESP32-C3',
    '  package: QFN32',
    ''
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(taskDir, 'task.json'), JSON.stringify({
    name: 'adc-task',
    title: 'Exercise ADC path',
    status: 'in_progress',
    priority: 'P1',
    package: 'fw'
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(wikiDir, 'esp32-c3.md'), '# ESP32-C3\n', 'utf8');
  childProcess.execFileSync('git', ['init', '-b', 'feat/rust-parity'], {
    cwd: root,
    stdio: 'ignore'
  });
  return root;
}

test('rust start --brief --json captures the same lightweight project facts', { skip: !hasCargo() }, () => {
  const root = makeProject();
  try {
    const payload = JSON.parse(runRust(['start', '--brief', '--json', '--cwd', root]));
    assert.equal(payload.status, 'ok');
    assert.equal(payload.runtime, 'emb-agent-rs-spike');
    assert.equal(payload.summary.initialized, true);
    assert.equal(payload.summary.project_root, fs.realpathSync(root));
    assert.equal(payload.summary.mcu_model, 'ESP32-C3');
    assert.equal(payload.summary.mcu_package, 'QFN32');
    assert.equal(payload.summary.open_tasks, 1);
    assert.equal(payload.summary.wiki_pages, 1);
    assert.equal(payload.summary.active_task.name, 'adc-task');
    assert.equal(payload.summary.active_task.title, 'Exercise ADC path');
    assert.equal(payload.summary.active_task.priority, 'P1');
    assert.equal(payload.immediate.command, 'do');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rust statusline preserves core statusline semantics from node hook', { skip: !hasCargo() }, () => {
  const root = makeProject();
  try {
    const nodeLine = statuslineHook.buildStatusLine({
      cwd: root,
      cost: { total_duration_ms: 60000 }
    });
    const rustLine = runRust(['statusline', '--cwd', root]);

    assert.match(nodeLine, /Exercise ADC path/);
    assert.match(nodeLine, /\[P1\]/);
    assert.match(nodeLine, /1 open task\(s\)/);
    assert.match(nodeLine, /feat\/rust-parity/);

    assert.match(rustLine, /Exercise ADC path/);
    assert.match(rustLine, /\[P1\]/);
    assert.match(rustLine, /1 task\(s\)/);
    assert.match(rustLine, /feat\/rust-parity/);
    assert.match(rustLine, /ESP32-C3 QFN32/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rust session-start hook payload is pi-compatible and self-contained', { skip: !hasCargo() }, () => {
  const root = makeProject();
  try {
    const payload = JSON.parse(runRust(['hook', 'session-start', '--cwd', root, '--host', 'pi']));
    assert.equal(payload.hookSpecificOutput.hookEventName, 'SessionStart');
    const context = payload.hookSpecificOutput.additionalContext;
    assert.match(context, /emb-agent Rust spike context is injected/);
    assert.match(context, /Project root:/);
    assert.match(context, /MCU: ESP32-C3/);
    assert.match(context, /MCU package: QFN32/);
    assert.match(context, /Active task: adc-task \(Exercise ADC path\)/);
    assert.match(context, /Recommended next command: do/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
