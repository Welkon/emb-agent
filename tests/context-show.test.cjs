'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureCliJson(args) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await cli.main(args);
  } finally {
    process.stdout.write = originalWrite;
  }

  return JSON.parse(stdout);
}

test('context show aggregates live session, bootstrap, next, health, and stored reports', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-context-show-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['focus', 'set', 'timer bring-up']);
    await cli.main(['question', 'add', 'is pwm resume stable after sleep']);
    await cli.main(['session', 'record', 'capture bring-up checkpoint']);

    const context = await captureCliJson(['context', 'show']);

    assert.equal(context.entry, 'context');
    assert.equal(context.summary.focus, 'timer bring-up');
    assert.equal(context.summary.stored_reports, 1);
    assert.ok(context.status);
    assert.ok(context.next);
    assert.ok(context.start);
    assert.ok(context.bootstrap);
    assert.ok(context.health);
    assert.ok(context.session_state);
    assert.ok(context.reports);
    assert.equal(context.reports.reports.length, 1);
    assert.ok(context.latest_report);
    assert.equal(context.latest_report.summary, 'capture bring-up checkpoint');
    assert.equal(context.reports.reports[0].summary, 'capture bring-up checkpoint');
    assert.equal(typeof context.next.next.command, 'string');
    assert.ok(context.next.next.command.length > 0);
    assert.equal(context.health.command, 'health');
  } finally {
    process.chdir(currentCwd);
  }
});
