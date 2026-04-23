'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const workflowImportHelpers = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-import.cjs'));
const workflowRegistry = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-registry.cjs'));

function createMockChildProcess() {
  const calls = [];

  return {
    calls,
    execFileSync(_execPath, argv) {
      const gigetSource = String(argv[2] || '');
      const targetDir = String(argv[3] || '');
      const gigetEntryPath = String(argv[5] || '');

      calls.push({
        gigetSource,
        targetDir,
        gigetEntryPath
      });

      fs.mkdirSync(targetDir, { recursive: true });

      if (gigetSource.includes('/specs')) {
        fs.writeFileSync(
          path.join(targetDir, 'connected-appliance.md'),
          [
            '---',
            'name: connected-appliance',
            'title: Connected Appliance',
            'summary: Mocked remote flat spec.',
            'selectable: true',
            '---',
            '# Connected Appliance',
            ''
          ].join('\n'),
          'utf8'
        );
        return;
      }

      fs.mkdirSync(path.join(targetDir, 'specs'), { recursive: true });
      fs.writeFileSync(
        path.join(targetDir, 'specs', 'connected-appliance.md'),
        [
          '---',
          'name: connected-appliance',
          'title: Connected Appliance',
          'summary: Mocked remote flat spec.',
          'selectable: true',
          '---',
          '# Connected Appliance',
          ''
        ].join('\n'),
        'utf8'
      );
    }
  };
}

function createWorkflowImport(childProcess) {
  return workflowImportHelpers.createWorkflowImportHelpers({
    childProcess,
    fs,
    os,
    path,
    process,
    runtime,
    workflowRegistry
  });
}

test('workflow import resolves remote git source with explicit subdir without double-applying the subdir', () => {
  const childProcess = createMockChildProcess();
  const workflowImport = createWorkflowImport(childProcess);
  const staged = workflowImport.stageWorkflowRegistrySource(
    'https://github.com/Welkon/emb-support.git',
    { subdir: 'specs' }
  );

  try {
    const sourceLayout = workflowImport.resolveWorkflowSourceLayout(staged.root, { subdir: 'specs' });

    try {
      assert.equal(childProcess.calls.length, 1);
      assert.equal(childProcess.calls[0].gigetSource, 'gh:Welkon/emb-support');
      assert.equal(childProcess.calls[0].gigetEntryPath, require.resolve('giget'));
      assert.equal(sourceLayout.kind, 'flat-markdown-specs');
      assert.ok(sourceLayout.registry.specs.some(item => item.name === 'connected-appliance'));
    } finally {
      sourceLayout.cleanup();
    }
  } finally {
    staged.cleanup();
  }
});

test('workflow import keeps embedded git subdir sources downloadable as flat markdown roots', () => {
  const childProcess = createMockChildProcess();
  const workflowImport = createWorkflowImport(childProcess);
  const staged = workflowImport.stageWorkflowRegistrySource(
    'https://github.com/Welkon/emb-support/tree/main/specs'
  );

  try {
    const sourceLayout = workflowImport.resolveWorkflowSourceLayout(staged.root);

    try {
      assert.equal(childProcess.calls.length, 1);
      assert.equal(childProcess.calls[0].gigetSource, 'gh:Welkon/emb-support/specs#main');
      assert.equal(childProcess.calls[0].gigetEntryPath, require.resolve('giget'));
      assert.equal(sourceLayout.kind, 'flat-markdown-specs');
      assert.ok(sourceLayout.registry.specs.some(item => item.name === 'connected-appliance'));
    } finally {
      sourceLayout.cleanup();
    }
  } finally {
    staged.cleanup();
  }
});
