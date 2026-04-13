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
    assert.match(skillContent, /Record a lesson only if at least 2 of these 3 checks pass/);
    assert.match(skillContent, /Activation Over Storage/);
    assert.match(skillContent, /When the agent is corrected/);
    assert.match(skillContent, /Rule Retirement/);
    assert.match(skillContent, /Run periodic homogeneity drift checks/);
    assert.match(skillContent, /Stable constraints or conventions go to `rules\/`\./);
    assert.match(skillContent, /Traps, lifecycle notes, or architecture gotchas go to `references\/`\./);
    assert.match(skillContent, /Ordered steps or completion checks go to `workflows\/`\./);

    const gotchasPath = path.join(tempProject, 'skills', 'irq-review', 'references', 'gotchas.md');
    assert.equal(fs.readFileSync(gotchasPath, 'utf8').trim(), '');
  } finally {
    process.chdir(currentCwd);
  }
});

test('protocol blocks include knowledge evolution and anti-template drift log guidance', async () => {
  const knowledgeBlock = fs.readFileSync(
    path.join(repoRoot, 'runtime', 'scaffolds', 'protocol-blocks', 'knowledge-evolution.md'),
    'utf8'
  );
  const antiTemplates = fs.readFileSync(
    path.join(repoRoot, 'runtime', 'scaffolds', 'ANTI-TEMPLATES.md'),
    'utf8'
  );

  assert.match(knowledgeBlock, /Learn From Mistakes/);
  assert.match(knowledgeBlock, /Rule Deprecation/);
  assert.match(knowledgeBlock, /Split Evaluation/);
  assert.match(knowledgeBlock, /Merge Evaluation/);
  assert.match(knowledgeBlock, /Homogeneity Drift Check/);

  assert.match(antiTemplates, /Homogeneity Drift Log/);
  assert.match(antiTemplates, /Expected same:/);
  assert.match(antiTemplates, /Expected different:/);
});

test('scaffold show and install protocol-blocks expose knowledge evolution guidance', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-scaffold-protocol-'));
  const currentCwd = process.cwd();

  try {
    const shown = await captureCliJson(['scaffold', 'show', 'protocol-blocks']);
    assert.equal(shown.scaffold.name, 'protocol-blocks');
    assert.ok(shown.scaffold.files.includes('knowledge-evolution.md'));

    process.chdir(tempProject);

    const installed = await captureCliJson([
      'scaffold',
      'install',
      'protocol-blocks'
    ]);

    assert.equal(installed.installed, true);
    assert.equal(installed.scaffold, 'protocol-blocks');
    assert.ok(installed.created.includes('templates/protocol-blocks/knowledge-evolution.md'));

    const installedKnowledgeBlock = fs.readFileSync(
      path.join(tempProject, 'templates', 'protocol-blocks', 'knowledge-evolution.md'),
      'utf8'
    );
    assert.match(installedKnowledgeBlock, /Learn From Mistakes/);
    assert.match(installedKnowledgeBlock, /Homogeneity Drift Check/);
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
    assert.ok(installed.created.includes('.windsurf/rules/workflow.md'));
    assert.equal(fs.existsSync(path.join(tempProject, '.codex', 'instructions.md')), true);

    const cursorSkill = fs.readFileSync(
      path.join(tempProject, '.cursor', 'skills', 'irq-review', 'SKILL.md'),
      'utf8'
    );
    assert.match(cursorSkill, /# irq-review/);
    assert.match(cursorSkill, /Review IRQ closure rules/);
    assert.match(cursorSkill, /## Quick Routing/);
    assert.match(cursorSkill, /## Auto Triggers/);
    assert.match(cursorSkill, /## Red Flags - STOP/);

    const agentsShell = fs.readFileSync(path.join(tempProject, 'AGENTS.md'), 'utf8');
    assert.match(agentsShell, /Quick Routing/);
    assert.match(agentsShell, /Multiple independent sub-tasks/);
    assert.match(agentsShell, /Any non-trivial task must run Task Closure Protocol before completion/);
    assert.match(agentsShell, /等会话结束一起补/);

    const windsurfShell = fs.readFileSync(
      path.join(tempProject, '.windsurf', 'rules', 'workflow.md'),
      'utf8'
    );
    assert.match(windsurfShell, /## Quick Routing/);
    assert.match(windsurfShell, /## Red Flags - STOP/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('scaffold install hooks provides SessionStart reinjection script and claude matcher config', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-scaffold-hooks-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const installed = await captureCliJson([
      'scaffold',
      'install',
      'hooks',
      'NAME=irq-review',
      'SUMMARY=Review IRQ closure rules'
    ]);

    assert.equal(installed.installed, true);
    assert.ok(installed.created.includes('hooks/session-start'));
    assert.ok(installed.created.includes('hooks/hooks.json'));

    const hookScript = fs.readFileSync(path.join(tempProject, 'hooks', 'session-start'), 'utf8');
    assert.match(hookScript, /SessionStart skill reinjection triggered by/);
    assert.match(hookScript, /hookSpecificOutput/);
    assert.match(hookScript, /additional_context/);
    assert.match(hookScript, /additionalContext/);
    assert.match(hookScript, /startup, clear, or compact/);

    const claudeHooks = JSON.parse(fs.readFileSync(path.join(tempProject, 'hooks', 'hooks.json'), 'utf8'));
    assert.ok(Array.isArray(claudeHooks.hooks.SessionStart));
    assert.deepEqual(
      claudeHooks.hooks.SessionStart.map(item => item.matcher),
      ['startup', 'clear', 'compact']
    );
  } finally {
    process.chdir(currentCwd);
  }
});
