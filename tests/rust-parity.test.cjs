'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const statuslineHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-statusline.js'));
const contextMonitorHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-context-monitor.js'));

function hasCargo() {
  try {
    childProcess.execFileSync('cargo', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runRust(args, cwd = repoRoot, input = '') {
  return childProcess.execFileSync('cargo', ['run', '-q', '-p', 'emb-agent-rs', '--', ...args], {
    cwd,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe']
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

test('rust hook resolver emits a unified source-layout command plan', { skip: !hasCargo() }, () => {
  const plan = JSON.parse(runRust(['hook', 'resolve', '--host', 'pi', '--hook', 'session-start', '--runtime-dir', 'runtime', '--json']));
  assert.equal(plan.hook, 'session-start');
  assert.equal(plan.host, 'pi');
  assert.equal(plan.runtime, 'rust');
  assert.equal(plan.reason, 'source-runtime-default');
  assert.match(plan.command, /hook session-start --host pi/);
  assert.match(plan.fallback, /node runtime\/hooks\/emb-session-start\.js/);

  const contextMonitor = JSON.parse(runRust(['hook', 'resolve', '--host', 'cursor', '--hook', 'context-monitor', '--runtime-dir', 'runtime', '--json']));
  assert.equal(contextMonitor.hook, 'context-monitor');
  assert.equal(contextMonitor.host, 'cursor');
  assert.equal(contextMonitor.runtime, 'rust');
  assert.equal(contextMonitor.reason, 'source-runtime-default');
  assert.match(contextMonitor.command, /hook context-monitor/);
  assert.match(contextMonitor.fallback, /node runtime\/hooks\/emb-context-monitor\.js/);
});

test('rust context-monitor hook emits pi-compatible critical context warning', { skip: !hasCargo() }, () => {
  const root = makeProject();
  try {
    const input = {
      cwd: root,
      event: 'PostToolUse',
      workspace_trusted: true,
      context_window: {
        remaining_percentage: 18
      }
    };
    const nodeMetrics = contextMonitorHook.parseContextMetrics(input);
    assert.equal(nodeMetrics.remaining, 18);
    assert.equal(nodeMetrics.used, 82);

    const output = runRust(['hook', 'context-monitor'], repoRoot, JSON.stringify(input));
    assert.notEqual(output, '');
    const payload = JSON.parse(output);
    assert.equal(payload.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(payload.hookSpecificOutput.additionalContext, /EMB CONTEXT CRITICAL/);
    assert.match(payload.hookSpecificOutput.additionalContext, /pause/);
    assert.match(payload.hookSpecificOutput.additionalContext, /host clear\/new-context control/);

    const repeated = runRust(['hook', 'context-monitor'], repoRoot, JSON.stringify(input));
    assert.equal(repeated, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rust hook diagnostics reports all hook plans and fallback state', { skip: !hasCargo() }, () => {
  const diagnostics = JSON.parse(runRust(['diagnostics', 'hooks', '--json', '--host', 'pi', '--runtime-dir', 'runtime']));
  assert.equal(diagnostics.status, 'ok');
  assert.equal(diagnostics.runtime, 'emb-agent-rs-spike');
  assert.equal(diagnostics.host, 'pi');
  assert.equal(diagnostics.source_runtime, true);
  assert.equal(typeof diagnostics.rust_binary, 'string');
  assert.equal(typeof diagnostics.rust_binary_exists, 'boolean');
  assert.equal(diagnostics.hooks.session_start.runtime, 'rust');
  assert.equal(diagnostics.hooks.statusline.runtime, 'rust');
  assert.equal(diagnostics.hooks.context_monitor.runtime, 'rust');
  assert.equal(diagnostics.hooks.context_monitor.reason, 'source-runtime-default');
});
