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

test('next --brief returns condensed next context', async () => {
  const output = await captureCliJson(['next', '--brief']);

  assert.equal(output.output_mode, 'brief');
  assert.ok(output.current);
  assert.ok(output.next);
  assert.ok(output.action_card);
  assert.ok(Array.isArray(output.next_actions));
  assert.ok(output.next_actions.length <= 5);
  assert.ok(output.runtime_events);
  assert.equal(output.runtime_events.status, 'pending');
  assert.ok(output.runtime_events.total >= 1);
  assert.ok(Array.isArray(output.runtime_events.types));
  assert.ok(output.runtime_events.types.includes('workflow-next'));
});

test('action --brief surfaces unified action cards and followups', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-brief-action-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const output = await captureCliJson(['scan', '--brief']);

    assert.equal(output.output_mode, 'brief');
    assert.ok(output.action_card);
    assert.equal(output.action_card.stage, 'scan');
    assert.ok(Array.isArray(output.next_actions));
    assert.ok(output.next_actions.length > 0);
  } finally {
    process.chdir(currentCwd);
  }
});
