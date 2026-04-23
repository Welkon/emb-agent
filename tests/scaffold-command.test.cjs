'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
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
  const shownShells = await captureCliJson(['scaffold', 'show', 'shells']);

  assert.ok(Array.isArray(listed.scaffolds));
  assert.ok(listed.scaffolds.some(item => item.name === 'skill'));
  assert.ok(listed.scaffolds.some(item => item.name === 'shells'));
  assert.equal(shown.scaffold.name, 'skill');
  assert.ok(shown.scaffold.files.includes('SKILL.md'));
  assert.ok(shown.scaffold.files.includes('workflows/subagent-driven.md'));
  assert.equal(shownShells.scaffold.name, 'shells');
  assert.ok(shownShells.scaffold.files.includes('AGENTS.md'));
  assert.ok(shownShells.scaffold.files.includes('.codex/instructions.md'));
  assert.ok(!shownShells.scaffold.files.some(file => file.includes('_partials/')));
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
    assert.ok(installed.created.includes('skills/irq-review/scripts/README.md'));
    assert.ok(installed.created.includes('skills/irq-review/scripts/smoke-test.sh'));
    assert.ok(installed.created.includes('skills/irq-review/scripts/test-trigger.sh'));
    assert.equal(installed.validation.needs_manual_completion, true);
    assert.ok(installed.validation.fill_count > 0);
    assert.match(installed.validation.grep_hint, /rg -n "FILL:" skills\/irq-review/);

    const skillPath = path.join(tempProject, 'skills', 'irq-review', 'SKILL.md');
    const skillContent = fs.readFileSync(skillPath, 'utf8');
    assert.match(skillContent, /name: irq-review/);
    assert.match(skillContent, /Review IRQ closure rules/);
    assert.doesNotMatch(skillContent, /\{\{NAME\}\}/);
    assert.doesNotMatch(skillContent, /\{\{SUMMARY\}\}/);
    assert.match(skillContent, /Record project-specific constraints, unusual architecture, hidden dependencies/);
    assert.match(skillContent, /Do not record generic programming knowledge, mainstream framework usage/);
    assert.match(skillContent, /Encode constraints, invariants, and context/);
    assert.match(skillContent, /If this skill relies on repeatable extraction, validation, migration, or report-generation work, add helper scripts under `scripts\/`\./);
    assert.match(skillContent, /Keep `scripts\/smoke-test\.sh` and `scripts\/test-trigger\.sh` working/);
    assert.match(skillContent, /Test activation: confirm the skill triggers for the right task shapes/);
    assert.match(skillContent, /The description accumulates 10 or more trigger phrases from different domains/);
    assert.match(skillContent, /Treat the scaffold structure as load-bearing infrastructure/);
    assert.match(skillContent, /The template should remember the infrastructure so the skill author can focus on project-specific content/);
    assert.match(skillContent, /Do not regenerate this scaffold from scratch during authoring/);
    assert.match(skillContent, /Do not prefill concrete business spec examples into shared templates/);
    assert.match(skillContent, /Auto-trigger guidance must survive context compression/);
    assert.match(skillContent, /Thin shells may grow to roughly 60 lines/);
    assert.match(skillContent, /Missing harness entry files such as `GEMINI\.md` or the shared `AGENTS\.md` means that harness is effectively blind/);
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

    const scriptsReadmePath = path.join(tempProject, 'skills', 'irq-review', 'scripts', 'README.md');
    const scriptsReadme = fs.readFileSync(scriptsReadmePath, 'utf8');
    assert.match(scriptsReadme, /scripts\/smoke-test\.sh/);
    assert.match(scriptsReadme, /scripts\/test-trigger\.sh/);
    assert.match(scriptsReadme, /source of truth/);
    assert.match(scriptsReadme, /Reuse repository-native scripts first/);
    assert.match(scriptsReadme, /humans are bad at self-auditing repetitive structure/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('scaffolded smoke and trigger scripts fail loudly on unfinished skills', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-scaffold-scripts-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    await captureCliJson([
      'scaffold',
      'install',
      'skill',
      'NAME=irq-review',
      'SUMMARY=Review IRQ closure rules'
    ]);

    await captureCliJson([
      'scaffold',
      'install',
      'shells',
      'NAME=irq-review',
      'SUMMARY=Review IRQ closure rules'
    ]);

    const smokeResult = childProcess.spawnSync(
      'bash',
      ['skills/irq-review/scripts/smoke-test.sh', 'skills/irq-review'],
      {
        cwd: tempProject,
        encoding: 'utf8'
      }
    );
    assert.notEqual(smokeResult.status, 0);
    assert.match(smokeResult.stdout, /== Placeholder residue ==/);
    assert.match(smokeResult.stdout, /unresolved placeholders remain/);
    assert.match(smokeResult.stdout, /description is too short/);

    const triggerResult = childProcess.spawnSync(
      'bash',
      ['skills/irq-review/scripts/test-trigger.sh', 'skills/irq-review'],
      {
        cwd: tempProject,
        encoding: 'utf8'
      }
    );
    assert.notEqual(triggerResult.status, 0);
    assert.match(triggerResult.stdout, /Static trigger preflight only/);
    assert.match(triggerResult.stdout, /description is too short for discovery/);
    assert.match(triggerResult.stdout, /need at least 2 concrete trigger phrases/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('smoke-test catches missing harness entry files after shell install', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-scaffold-harness-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    await captureCliJson([
      'scaffold',
      'install',
      'skill',
      'NAME=irq-review',
      'SUMMARY=Review IRQ closure rules'
    ]);

    await captureCliJson([
      'scaffold',
      'install',
      'shells',
      'NAME=irq-review',
      'SUMMARY=Review IRQ closure rules'
    ]);

    fs.rmSync(path.join(tempProject, 'GEMINI.md'));

    const smokeResult = childProcess.spawnSync(
      'bash',
      ['skills/irq-review/scripts/smoke-test.sh', 'skills/irq-review'],
      {
        cwd: tempProject,
        encoding: 'utf8'
      }
    );
    assert.notEqual(smokeResult.status, 0);
    assert.match(smokeResult.stdout, /== Harness coverage ==/);
    assert.match(smokeResult.stdout, /missing harness entry GEMINI\.md/);
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
    assert.ok(installed.created.includes('GEMINI.md'));
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
    assert.match(cursorSkill, /Bug fix or regression/);
    assert.match(cursorSkill, /Rules or protocol update/);
    assert.match(cursorSkill, /Docs-only maintenance/);

    const agentsShell = fs.readFileSync(path.join(tempProject, 'AGENTS.md'), 'utf8');
    assert.match(agentsShell, /Quick Routing/);
    assert.match(agentsShell, /Multiple independent sub-tasks/);
    assert.match(agentsShell, /Treat shell entry points, routing tables, and visible/);
    assert.match(agentsShell, /Any non-trivial task must run Task Closure Protocol before completion/);
    assert.match(agentsShell, /等会话结束一起补/);
    assert.match(agentsShell, /## Human-Readable Defaults/);
    assert.match(agentsShell, /Treat skills, hooks, and wrappers as integration surfaces; they must not override emb-agent runtime gates/);

    const codexShell = fs.readFileSync(path.join(tempProject, '.codex', 'instructions.md'), 'utf8');
    assert.match(codexShell, /Bug fix or regression/);
    assert.match(codexShell, /Rules or protocol update/);
    assert.match(codexShell, /Docs-only maintenance/);
    assert.match(codexShell, /The template should remember harness infrastructure/);
    assert.match(codexShell, /## Human-Readable Defaults/);
    assert.match(codexShell, /Keep guidance hardware-first and name the real blocker/);

    const windsurfShell = fs.readFileSync(
      path.join(tempProject, '.windsurf', 'rules', 'workflow.md'),
      'utf8'
    );
    assert.match(windsurfShell, /## Quick Routing/);
    assert.match(windsurfShell, /## Red Flags - STOP/);
    assert.match(windsurfShell, /Bug fix or regression/);
    assert.match(windsurfShell, /Rules or protocol update/);
    assert.match(windsurfShell, /Docs-only maintenance/);
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
