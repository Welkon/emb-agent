'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const sessionStartHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-session-start.js'));

test('session start hook only reminds when an unconsumed handoff exists', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-start-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    const empty = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    assert.equal(empty, '');

    cli.main(['pause', 'resume irq race first']);
    const reminder = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    assert.match(reminder, /Emb-Agent Session Reminder/);
    assert.match(reminder, /发现未消费的 handoff/);
    assert.match(reminder, /node ~\/\.codex\/emb-agent\/bin\/emb-agent\.cjs resume/);
    assert.match(reminder, /resume irq race first/);
  } finally {
    process.chdir(currentCwd);
  }
});
