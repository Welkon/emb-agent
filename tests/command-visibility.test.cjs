'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
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

function extractUsageTopLevelCommands() {
  const entryPath = path.join(repoRoot, 'runtime', 'lib', 'cli-entrypoints.cjs');
  const content = fs.readFileSync(entryPath, 'utf8');
  const commands = new Set();

  for (const match of content.matchAll(/^\s+'  ([a-z-]+)(?:\s|')/gm)) {
    commands.add(match[1]);
  }

  return [...commands].sort();
}

function extractImplementedTopLevelCommands() {
  const files = [
    path.join(repoRoot, 'runtime', 'lib', 'cli-router.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'state-commands.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'spec-commands.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'task-commands.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'workspace-commands.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'command-groups.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'thread-commands.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'forensics-command.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'settings-command.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'session-report-command.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'manager-command.cjs'),
    path.join(repoRoot, 'runtime', 'lib', 'health-update-command.cjs')
  ];
  const commands = new Set(['help']);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/\bcmd === '([a-z-]+)'/g)) {
      commands.add(match[1]);
    }
    for (const match of content.matchAll(/\bcmd !== '([a-z-]+)'/g)) {
      commands.add(match[1]);
    }
  }

  commands.delete('attach');
  return [...commands].sort();
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
  assert.match(shown.content, /兼容旧用法的别名/);
});

test('agents list and show resolve source-layout markdown files', async () => {
  const listed = await captureCliJson(['agents', 'list']);
  const shown = await captureCliJson(['agents', 'show', 'emb-hw-scout']);

  assert.ok(Array.isArray(listed));
  assert.ok(listed.includes('emb-hw-scout'));
  assert.equal(shown.name, 'emb-hw-scout');
  assert.equal(shown.path, 'agents/emb-hw-scout.md');
  assert.match(shown.content, /查硬件真值/);
});

test('commands show resolves source-layout command markdown files', async () => {
  const shown = await captureCliJson(['commands', 'show', 'help']);

  assert.equal(shown.name, 'help');
  assert.equal(shown.path, 'commands/emb/help.md');
  assert.match(shown.content, /唯一官方初始化入口/);
});

test('help markdown public commands stay in sync with commands list', async () => {
  const helpPath = path.join(repoRoot, 'commands', 'emb', 'help.md');
  const content = fs.readFileSync(helpPath, 'utf8');
  const documented = [...content.matchAll(/- `\$emb-([a-z-]+)`/g)]
    .map(match => match[1])
    .sort();
  const listed = (await captureCliJson(['commands', 'list'])).slice().sort();

  assert.deepEqual(documented, listed);
});

test('usage top-level commands stay in sync with implemented router commands', () => {
  assert.deepEqual(extractUsageTopLevelCommands(), extractImplementedTopLevelCommands());
});
