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

test('workflow init normalizes project-local workflow layout', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-init-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    const result = await captureCliJson(['workflow', 'init']);

    assert.equal(result.command, 'workflow init');
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'registry', 'workflow.json')));
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'project-local.md')));
    assert.ok(Array.isArray(result.workflow_layout.created) || Array.isArray(result.workflow_layout.reused));
  } finally {
    process.chdir(currentCwd);
  }
});

test('workflow new pack authors project-local assets and init defers them into the bootstrap task', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-pack-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const created = await captureCliJson([
      'workflow',
      'new',
      'pack',
      'smart-pillbox',
      '--with-spec',
      '--with-template',
      'medication-flow',
      '--output',
      'docs/MEDICATION-FLOW.md'
    ]);

    assert.equal(created.command, 'workflow new pack');
    assert.equal(created.name, 'smart-pillbox');
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'packs', 'smart-pillbox.yaml')));
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'smart-pillbox-focus.md')));
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'templates', 'medication-flow.md.tpl')));

    const registryPath = path.join(tempProject, '.emb-agent', 'registry', 'workflow.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    assert.ok(registry.packs.some(item => item.name === 'smart-pillbox'));
    assert.ok(registry.specs.some(item => item.name === 'smart-pillbox-focus'));
    assert.ok(registry.templates.some(item => item.name === 'medication-flow'));

    const initialized = await captureCliJson(['init', '--pack', 'smart-pillbox']);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = JSON.parse(
      fs.readFileSync(
        path.join(tempProject, '.emb-agent', 'tasks', '00-bootstrap-project', 'task.json'),
        'utf8'
      )
    );
    assert.deepEqual(projectConfig.active_packs, ['smart-pillbox']);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MEDICATION-FLOW.md')), false);
    assert.equal(initialized.onboarding.bootstrap_task.name, '00-bootstrap-project');
    assert.ok(bootstrapTask.relatedFiles.includes('docs/MEDICATION-FLOW.md'));
  } finally {
    process.chdir(currentCwd);
  }
});
