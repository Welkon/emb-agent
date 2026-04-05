'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('manager view aggregates next handoff settings threads and reports', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['settings', 'set', 'profile', 'rtos-iot']);
    cli.main(['thread', 'add', 'Track OTA rollback issue']);
    cli.main(['pause', 'resume ota rollback']);
    cli.main(['forensics', 'why ota flow keeps drifting']);
    cli.main(['session-report', 'capture ota status']);

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.equal(manager.mode, 'manager-lite');
    assert.equal(manager.session.profile, 'rtos-iot');
    assert.equal(manager.handoff.next_action, 'resume ota rollback');
    assert.equal(manager.threads.open, 1);
    assert.ok(manager.reports.forensics.length >= 1);
    assert.ok(manager.reports.sessions.length >= 1);
    assert.ok(manager.recommended_actions.some(item => item.type === 'resume'));
    assert.ok(manager.recommended_actions.some(item => item.type === 'session-report'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
