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
    assert.equal(initialized.bootstrap.bootstrap_task.name, '00-bootstrap-project');
    assert.ok(bootstrapTask.relatedFiles.includes('docs/MEDICATION-FLOW.md'));
  } finally {
    process.chdir(currentCwd);
  }
});

test('workflow import registry imports project-local packs, specs, and templates from a source tree', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-import-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-source-'));
  const currentCwd = process.cwd();

  try {
    fs.mkdirSync(path.join(tempSource, '.emb-agent', 'registry'), { recursive: true });
    fs.mkdirSync(path.join(tempSource, '.emb-agent', 'packs'), { recursive: true });
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
        packs: [
          {
            name: 'board-bringup-pack',
            file: 'packs/board-bringup-pack.yaml',
            description: 'Imported bring-up pack.'
          }
        ],
        specs: [
          {
            name: 'board-bringup-focus',
            title: 'Board Bringup Focus',
            path: 'specs/board-bringup-focus.md',
            summary: 'Imported bring-up focus rules.',
            auto_inject: true,
            priority: 70,
            apply_when: {
              packs: ['board-bringup-pack']
            }
          }
        ]
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempSource, '.emb-agent', 'packs', 'board-bringup-pack.yaml'),
      'name: board-bringup-pack\nfocus_areas:\n  - bringup\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempSource, '.emb-agent', 'specs', 'board-bringup-focus.md'),
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
    assert.equal(result.imported.length, 3);
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'packs', 'board-bringup-pack.yaml')));
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'board-bringup-focus.md')));
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'templates', 'board-bringup.md.tpl')));

    const registry = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'registry', 'workflow.json'), 'utf8')
    );
    assert.ok(registry.packs.some(item => item.name === 'board-bringup-pack'));
    assert.ok(registry.specs.some(item => item.name === 'board-bringup-focus'));
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
        packs: [],
        specs: [
          {
            name: 'factory-flow',
            title: 'Factory Flow',
            path: 'specs/factory-flow.md',
            summary: 'Imported factory checklist.',
            auto_inject: true,
            priority: 60,
            apply_when: {
              always: true
            }
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
    assert.deepEqual(projectConfig.active_packs, []);
  } finally {
    process.chdir(currentCwd);
  }
});
