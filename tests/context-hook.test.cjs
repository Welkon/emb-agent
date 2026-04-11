'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const contextMonitor = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-context-monitor.js'));

test('context monitor hook emits only when session context is heavy', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-hook-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    const light = contextMonitor.runHook({ cwd: tempProject, event: 'PostToolUse' });
    assert.equal(light, '');

    for (let index = 1; index <= 5; index += 1) {
      const fileName = `src/h${index}.c`;
      fs.mkdirSync(path.dirname(fileName), { recursive: true });
      fs.writeFileSync(fileName, `// h${index}\n`, 'utf8');
      cli.main(['last-files', 'add', fileName]);
    }

    cli.main(['question', 'add', 'timer edge stable?']);
    cli.main(['question', 'add', 'wakeup jitter acceptable?']);
    cli.main(['risk', 'add', 'shared timer drifts after divider switch']);
    cli.main(['risk', 'add', 'debounce path overlaps wake edge']);

    const heavy = contextMonitor.runHook({ cwd: tempProject, event: 'PostToolUse' });
    assert.notEqual(heavy.trim(), '');
    const payload = JSON.parse(heavy);
    assert.equal(payload.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(payload.hookSpecificOutput.additionalContext, /EMB CONTEXT WARNING|EMB CONTEXT NOTICE/);
    assert.match(payload.hookSpecificOutput.additionalContext, /pause -> clear -> resume/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('context monitor prioritizes live context metrics and warns to pause', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-hook-metrics-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    const output = contextMonitor.runHook({
      cwd: tempProject,
      event: 'PostToolUse',
      context_window: {
        remaining_percentage: 18
      }
    });

    assert.notEqual(output.trim(), '');
    const payload = JSON.parse(output);
    assert.match(payload.hookSpecificOutput.additionalContext, /EMB CONTEXT CRITICAL/);
    assert.match(payload.hookSpecificOutput.additionalContext, /pause/);
    assert.match(payload.hookSpecificOutput.additionalContext, /clear -> resume|pause -> clear -> resume/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('context monitor shouldEmit debounces same severity and allows escalation', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-hook-debounce-'));

  assert.equal(contextMonitor.shouldEmit(tempProject, 'warning'), true);

  for (let index = 0; index < 4; index += 1) {
    assert.equal(contextMonitor.shouldEmit(tempProject, 'warning'), false);
  }

  assert.equal(contextMonitor.shouldEmit(tempProject, 'critical'), true);
});

test('context monitor skips all output when workspace trust is not established', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-hook-untrusted-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    const output = contextMonitor.runHook({
      cwd: tempProject,
      event: 'PostToolUse',
      workspace: {
        trusted: false
      },
      context_window: {
        remaining_percentage: 18
      }
    });

    assert.equal(output, '');
  } finally {
    process.chdir(currentCwd);
  }
});
