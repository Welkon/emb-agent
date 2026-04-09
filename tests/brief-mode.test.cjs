'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
  assert.ok(Array.isArray(output.next_actions));
  assert.ok(output.next_actions.length <= 5);
});
