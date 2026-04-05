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
