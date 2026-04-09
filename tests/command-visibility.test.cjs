'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureCliText(args) {
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

  return stdout;
}

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

test('help markdown does not expose emb-attach as an official command', () => {
  const helpPath = path.join(repoRoot, 'commands', 'emb', 'help.md');
  const content = fs.readFileSync(helpPath, 'utf8');

  assert.doesNotMatch(content, /\$emb-attach/);
});

test('commands list hides legacy attach alias', async () => {
  const listed = await captureCliJson(['commands', 'list']);

  assert.ok(Array.isArray(listed));
  assert.ok(listed.includes('init-project'));
  assert.ok(!listed.includes('attach'));
});

test('commands show keeps legacy attach alias accessible', async () => {
  const shown = await captureCliJson(['commands', 'show', 'attach']);

  assert.equal(shown.name, 'attach');
  assert.equal(shown.path, 'commands/emb/attach.md');
  assert.match(shown.content, /legacy alias kept for compatibility/);
});

test('agents list and show resolve source-layout markdown files', async () => {
  const listed = await captureCliJson(['agents', 'list']);
  const shown = await captureCliJson(['agents', 'show', 'emb-hw-scout']);

  assert.ok(Array.isArray(listed));
  assert.ok(listed.includes('emb-hw-scout'));
  assert.equal(shown.name, 'emb-hw-scout');
  assert.equal(shown.path, 'agents/emb-hw-scout.md');
  assert.match(shown.content, /hardware truth/);
});

test('skills list and show resolve source-layout internal skills', async () => {
  const listed = await captureCliJson(['skills', 'list']);
  const shown = await captureCliJson(['skills', 'show', 'using-emb-agent']);

  assert.ok(Array.isArray(listed));
  assert.ok(listed.includes('using-emb-agent'));
  assert.equal(shown.name, 'using-emb-agent');
  assert.equal(shown.path, 'skills/using-emb-agent/SKILL.md');
  assert.match(shown.content, /lightest, closest-to-truth path/);
});

test('commands show resolves source-layout command markdown files', async () => {
  const shown = await captureCliJson(['commands', 'show', 'help']);

  assert.equal(shown.name, 'help');
  assert.equal(shown.path, 'commands/emb/help.md');
  assert.match(shown.content, /shortest onboarding path/);
});

test('help markdown stays focused on core workflow commands', async () => {
  const helpPath = path.join(repoRoot, 'commands', 'emb', 'help.md');
  const content = fs.readFileSync(helpPath, 'utf8');

  assert.match(content, /\$emb-init-project/);
  assert.match(content, /\$emb-next/);
  assert.match(content, /\$emb-task/);
  assert.doesNotMatch(content, /\$emb-orchestrate/);
  assert.match(content, /help advanced/);
});

test('default help stays concise and advanced help exposes the full surface', async () => {
  const compact = await captureCliText(['help']);
  const advanced = await captureCliText(['help', 'advanced']);
  const allFlag = await captureCliText(['--help', '--all']);

  assert.match(compact, /Core workflow:/);
  assert.match(compact, /declare hardware/);
  assert.match(compact, /help advanced/);
  assert.doesNotMatch(compact, /adapter source add/);
  assert.doesNotMatch(compact, /workspace link/);

  assert.match(advanced, /Advanced commands:/);
  assert.match(advanced, /adapter source add/);
  assert.match(advanced, /workspace link/);
  assert.match(advanced, /commands list/);
  assert.equal(advanced, allFlag);
});
