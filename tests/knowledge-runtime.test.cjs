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

test('knowledge init creates project wiki control files and directories', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-init-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const initialized = await captureCliJson(['knowledge', 'init']);

    assert.equal(initialized.initialized, true);
    assert.equal(initialized.wiki_dir, '.emb-agent/wiki');
    assert.ok(initialized.directories.includes('.emb-agent/wiki/sources'));
    assert.ok(initialized.directories.includes('.emb-agent/wiki/decisions'));
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'wiki', 'index.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'wiki', 'log.md')), true);
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge save-query previews by default and writes only with confirmation', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-save-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['knowledge', 'init']);

    const preview = await captureCliJson([
      'knowledge',
      'save-query',
      'Timer contention',
      '--summary',
      'IR decode and PWM may compete for the same timer.',
      '--body',
      'Keep this as draft synthesis until timer ownership is confirmed.'
    ]);

    const pagePath = path.join(tempProject, '.emb-agent', 'wiki', 'queries', 'timer-contention.md');
    assert.equal(preview.status, 'confirmation-required');
    assert.equal(preview.write_mode, 'preview');
    assert.equal(preview.target, '.emb-agent/wiki/queries/timer-contention.md');
    assert.equal(fs.existsSync(pagePath), false);

    const written = await captureCliJson([
      'knowledge',
      'save-query',
      'Timer contention',
      '--summary',
      'IR decode and PWM may compete for the same timer.',
      '--body',
      'Keep this as draft synthesis until timer ownership is confirmed.',
      '--confirm'
    ]);

    assert.equal(written.status, 'written');
    assert.equal(written.page.path, '.emb-agent/wiki/queries/timer-contention.md');
    assert.equal(fs.existsSync(pagePath), true);

    const index = fs.readFileSync(path.join(tempProject, '.emb-agent', 'wiki', 'index.md'), 'utf8');
    const log = fs.readFileSync(path.join(tempProject, '.emb-agent', 'wiki', 'log.md'), 'utf8');
    assert.match(index, /\[\[queries\/timer-contention\]\]/);
    assert.match(log, /query \| Timer contention/);

    const shown = await captureCliJson(['knowledge', 'show', 'queries/timer-contention']);
    assert.match(shown.content, /# Timer contention/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge lint reports declared chip without matching chip page', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-lint-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['knowledge', 'init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['chip: sc8f072', 'package: sop8', ''].join('\n'),
      'utf8'
    );

    const lint = await captureCliJson(['knowledge', 'lint']);

    assert.equal(lint.wiki_dir, '.emb-agent/wiki');
    assert.ok(Array.isArray(lint.issues));
    assert.ok(lint.issues.some(issue => issue.code === 'missing-chip-page'));
    assert.ok(lint.next_steps.some(step => /knowledge save-query --kind chip/.test(step)));
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge command is visible in advanced command inventory', async () => {
  const listed = await captureCliJson(['commands', 'list', '--all']);
  const shown = await captureCliJson(['commands', 'show', 'knowledge']);

  assert.ok(listed.includes('knowledge'));
  assert.equal(shown.name, 'knowledge');
  assert.match(shown.content, /persistent knowledge wiki/i);
});
