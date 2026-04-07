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

test('spec commands add list and show project-visible specs', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-spec-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    const created = await captureCliJson(['spec', 'add', 'Timer budget contract', '--type', 'hardware']);
    const listed = await captureCliJson(['spec', 'list']);
    const shown = await captureCliJson(['spec', 'show', created.spec.name]);

    assert.equal(created.created, true);
    assert.equal(created.spec.type, 'hardware');
    assert.equal(created.spec.path, `.emb-agent/specs/${created.spec.name}.md`);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', `${created.spec.name}.md`)), true);

    assert.equal(listed.specs.length, 1);
    assert.equal(listed.specs[0].name, created.spec.name);
    assert.equal(listed.specs[0].type, 'hardware');

    assert.equal(shown.name, created.spec.name);
    assert.equal(shown.type, 'hardware');
    assert.match(shown.content, /# Spec: Timer budget contract/);
    assert.match(shown.content, /## Constraints/);
    assert.match(shown.content, /## Acceptance/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
