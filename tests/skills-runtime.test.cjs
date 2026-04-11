'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureJson(args) {
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

test('skills list and show expose lazily discovered built-in skills', async () => {
  const listed = await captureJson(['skills', 'list']);
  const shown = await captureJson(['skills', 'show', 'remember']);

  assert.ok(Array.isArray(listed));
  assert.ok(listed.some(item => item.name === 'remember'));
  assert.ok(listed.some(item => item.name === 'swarm-execution'));
  assert.equal(shown.name, 'remember');
  assert.equal(shown.execution_mode, 'inline');
  assert.equal(shown.path, 'skills/remember.md');
  assert.match(shown.content, /cross-session conclusions/);
});

test('skills run supports inline and isolated execution modes', async () => {
  const originalBridge = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;

  try {
    const inlineResult = await captureJson(['skills', 'run', 'remember', 'capture stable timer fact']);
    assert.equal(inlineResult.execution.mode, 'inline');
    assert.match(inlineResult.prompt, /capture stable timer fact/);

    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = 'mock://ok';
    const isolatedResult = await captureJson(['skills', 'run', 'swarm-execution']);
    assert.equal(isolatedResult.execution.mode, 'isolated');
    assert.equal(isolatedResult.isolated.status, 'ok');
    assert.equal(isolatedResult.isolated.worker_result.phase, 'skill');
  } finally {
    if (originalBridge === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = originalBridge;
    }
  }
});
