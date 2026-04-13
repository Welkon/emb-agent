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

test('scaffold list and show expose built-in scaffold trees', async () => {
  const listed = await captureCliJson(['scaffold', 'list']);
  const shown = await captureCliJson(['scaffold', 'show', 'skill']);

  assert.ok(Array.isArray(listed.scaffolds));
  assert.ok(listed.scaffolds.some(item => item.name === 'skill'));
  assert.ok(listed.scaffolds.some(item => item.name === 'shells'));
  assert.equal(shown.scaffold.name, 'skill');
  assert.ok(shown.scaffold.files.includes('SKILL.md'));
  assert.ok(shown.scaffold.files.includes('workflows/subagent-driven.md'));
});

test('scaffold install skill copies the tree, replaces placeholders, and reports FILL markers', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-scaffold-skill-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const installed = await captureCliJson([
      'scaffold',
      'install',
      'skill',
      'NAME=irq-review',
      'SUMMARY=Review IRQ closure rules'
    ]);

    assert.equal(installed.installed, true);
    assert.equal(installed.scaffold, 'skill');
    assert.equal(installed.output_root, 'skills/irq-review');
    assert.ok(installed.created.includes('skills/irq-review/SKILL.md'));
    assert.ok(installed.created.includes('skills/irq-review/workflows/fix-bug.md'));
    assert.equal(installed.validation.needs_manual_completion, true);
    assert.ok(installed.validation.fill_count > 0);
    assert.match(installed.validation.grep_hint, /rg -n "FILL:" skills\/irq-review/);

    const skillPath = path.join(tempProject, 'skills', 'irq-review', 'SKILL.md');
    const skillContent = fs.readFileSync(skillPath, 'utf8');
    assert.match(skillContent, /name: irq-review/);
    assert.match(skillContent, /Review IRQ closure rules/);
    assert.doesNotMatch(skillContent, /\{\{NAME\}\}/);
    assert.doesNotMatch(skillContent, /\{\{SUMMARY\}\}/);

    const gotchasPath = path.join(tempProject, 'skills', 'irq-review', 'references', 'gotchas.md');
    assert.equal(fs.readFileSync(gotchasPath, 'utf8').trim(), '');
  } finally {
    process.chdir(currentCwd);
  }
});

test('scaffold install shells replaces placeholders in nested file paths', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-scaffold-shells-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const installed = await captureCliJson([
      'scaffold',
      'install',
      'shells',
      'NAME=irq-review',
      'SUMMARY=Review IRQ closure rules'
    ]);

    assert.equal(installed.installed, true);
    assert.ok(installed.created.includes('.cursor/skills/irq-review/SKILL.md'));
    assert.equal(fs.existsSync(path.join(tempProject, '.codex', 'instructions.md')), true);

    const cursorSkill = fs.readFileSync(
      path.join(tempProject, '.cursor', 'skills', 'irq-review', 'SKILL.md'),
      'utf8'
    );
    assert.match(cursorSkill, /# irq-review/);
    assert.match(cursorSkill, /Review IRQ closure rules/);
  } finally {
    process.chdir(currentCwd);
  }
});
