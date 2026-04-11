'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
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

test('memory runtime supports layered stack, remember, audit, promote, and pause extraction', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-memory-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['focus', 'set', 'stabilize irq timing']);
    await cli.main(['question', 'add', 'is tm2 reload restored after wake']);

    const stack = await captureJson(['memory', 'stack']);
    assert.ok(Array.isArray(stack.layers));
    assert.ok(stack.layers.some(item => item.scope === 'organization'));

    const remembered = await captureJson([
      'memory',
      'remember',
      '--confirm',
      '--type',
      'project',
      'tm2 reload must be restored after wake',
      '--detail',
      'Verified during irq timing review'
    ]);
    assert.equal(remembered.remembered, true);

    const listed = await captureJson(['memory', 'list']);
    assert.ok(Array.isArray(listed));
    assert.ok(listed.length >= 1);

    const shown = await captureJson(['memory', 'show', listed[0].name]);
    assert.equal(shown.name, listed[0].name);
    assert.match(shown.content, /summary:/);

    const audit = await captureJson(['memory', 'audit']);
    assert.ok(Array.isArray(audit.entries));
    assert.ok(audit.entries.some(item => item.suggested_target === 'project'));

    const promoted = await captureJson(['memory', 'promote', '--confirm', listed[0].name, '--to', 'project']);
    assert.equal(promoted.promoted, true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'memory', 'project.md')), true);

    const paused = await captureJson(['pause', 'capture memory extraction']);
    assert.equal(paused.paused, true);
    assert.ok(paused.auto_memory);
    assert.equal(paused.auto_memory.remembered, true);
  } finally {
    process.chdir(currentCwd);
  }
});
