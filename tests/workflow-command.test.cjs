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

test('workflow new spec authors project-local assets and init defers them into the bootstrap task', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-spec-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const created = await captureCliJson([
      'workflow',
      'new',
      'spec',
      'smart-pillbox',
      '--with-template',
      'medication-flow',
      '--output',
      'docs/MEDICATION-FLOW.md'
    ]);

    assert.equal(created.command, 'workflow new spec');
    assert.equal(created.name, 'smart-pillbox');
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'smart-pillbox.md')));
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'templates', 'medication-flow.md.tpl')));

    const registryPath = path.join(tempProject, '.emb-agent', 'registry', 'workflow.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    assert.ok(registry.specs.some(item => item.name === 'smart-pillbox' && item.selectable === true));
    assert.ok(registry.templates.some(item => item.name === 'medication-flow'));

    const initialized = await captureCliJson(['init', '--spec', 'smart-pillbox']);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const bootstrapTask = JSON.parse(
      fs.readFileSync(
        path.join(tempProject, '.emb-agent', 'tasks', '00-bootstrap-project', 'task.json'),
        'utf8'
      )
    );
    assert.deepEqual(projectConfig.active_specs, ['smart-pillbox']);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MEDICATION-FLOW.md')), false);
    assert.equal(initialized.bootstrap.bootstrap_task.name, '00-bootstrap-project');
    assert.ok(bootstrapTask.relatedFiles.includes('docs/MEDICATION-FLOW.md'));
  } finally {
    process.chdir(currentCwd);
  }
});

test('workflow import registry imports project-local specs and templates from a source tree', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-import-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-source-'));
  const currentCwd = process.cwd();

  try {
    fs.mkdirSync(path.join(tempSource, '.emb-agent', 'registry'), { recursive: true });
    fs.mkdirSync(path.join(tempSource, '.emb-agent', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(tempSource, '.emb-agent', 'templates'), { recursive: true });
    fs.writeFileSync(
      path.join(tempSource, '.emb-agent', 'registry', 'workflow.json'),
      JSON.stringify({
        version: 1,
        templates: [
          {
            name: 'board-bringup',
            source: 'templates/board-bringup.md.tpl',
            description: 'Imported bring-up template.',
            default_output: 'docs/BOARD-BRINGUP.md'
          }
        ],
        specs: [
          {
            name: 'board-bringup',
            title: 'Board Bringup',
            path: 'specs/board-bringup.md',
            summary: 'Imported bring-up focus rules.',
            auto_inject: true,
            selectable: true,
            priority: 70,
            apply_when: {
              specs: ['board-bringup']
            },
            focus_areas: ['bringup'],
            extra_review_axes: [],
            preferred_notes: ['docs/BOARD-BRINGUP.md'],
            default_agents: []
          }
        ]
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempSource, '.emb-agent', 'specs', 'board-bringup.md'),
      '# Board Bringup Focus\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempSource, '.emb-agent', 'templates', 'board-bringup.md.tpl'),
      '# Board Bringup\n',
      'utf8'
    );

    process.chdir(tempProject);
    const result = await captureCliJson(['workflow', 'import', 'registry', tempSource]);

    assert.equal(result.command, 'workflow import registry');
    assert.equal(result.imported.length, 2);
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'board-bringup.md')));
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'templates', 'board-bringup.md.tpl')));

    const registry = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'registry', 'workflow.json'), 'utf8')
    );
    assert.ok(registry.specs.some(item => item.name === 'board-bringup'));
    assert.ok(registry.templates.some(item => item.name === 'board-bringup'));
  } finally {
    process.chdir(currentCwd);
  }
});

test('init imports workflow registry from custom source', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-registry-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-registry-source-'));
  const currentCwd = process.cwd();

  try {
    fs.mkdirSync(path.join(tempSource, '.emb-agent', 'registry'), { recursive: true });
    fs.mkdirSync(path.join(tempSource, '.emb-agent', 'specs'), { recursive: true });
    fs.writeFileSync(
      path.join(tempSource, '.emb-agent', 'registry', 'workflow.json'),
      JSON.stringify({
        version: 1,
        templates: [],
        specs: [
          {
            name: 'factory-flow',
            title: 'Factory Flow',
            path: 'specs/factory-flow.md',
            summary: 'Imported factory checklist.',
            auto_inject: true,
            selectable: false,
            priority: 60,
            apply_when: {
              always: true
            },
            focus_areas: [],
            extra_review_axes: [],
            preferred_notes: [],
            default_agents: []
          }
        ]
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempSource, '.emb-agent', 'specs', 'factory-flow.md'),
      '# Factory Flow\n',
      'utf8'
    );

    process.chdir(tempProject);
    const result = await captureCliJson(['init', '--registry', tempSource]);

    assert.equal(result.initialized, true);
    assert.ok(result.workflow_registry_import);
    assert.equal(result.workflow_registry_import.imported.some(item => item.name === 'factory-flow'), true);
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'factory-flow.md')));

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    assert.deepEqual(projectConfig.active_specs, []);
  } finally {
    process.chdir(currentCwd);
  }
});
