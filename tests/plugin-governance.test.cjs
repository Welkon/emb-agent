'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeRoot = path.join(repoRoot, 'runtime');
const toolCatalog = require(path.join(runtimeRoot, 'lib', 'tool-catalog.cjs'));
const toolRuntime = require(path.join(runtimeRoot, 'lib', 'tool-runtime.cjs'));

test('plugin governance rejects malformed external tool registry schema', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-plugin-registry-'));
  const currentCwd = process.cwd();
  const extRoot = path.join(tempProject, '.emb-agent', 'extensions', 'tools');

  try {
    fs.mkdirSync(extRoot, { recursive: true });
    fs.writeFileSync(
      path.join(extRoot, 'registry.json'),
      JSON.stringify(
        {
          specs: 'timer-calc',
          families: [],
          devices: []
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    process.chdir(tempProject);

    assert.throws(
      () => toolCatalog.loadRegistry(runtimeRoot),
      /External tool registry .*\.specs must be an array/
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('plugin governance rejects chip support module without runTool export', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-plugin-adapter-'));
  const currentCwd = process.cwd();
  const adapterPath = path.join(tempProject, '.emb-agent', 'adapters', 'routes', 'timer-calc.cjs');

  try {
    fs.mkdirSync(path.dirname(adapterPath), { recursive: true });
    fs.writeFileSync(
      adapterPath,
      [
        "'use strict';",
        '',
        'module.exports = {',
        "  name: 'invalid-adapter'",
        '};',
        ''
      ].join('\n'),
      'utf8'
    );

    process.chdir(tempProject);

    assert.throws(
      () => toolRuntime.runTool(runtimeRoot, 'timer-calc', ['--family', 'vendor-family']),
      /Tool chip support module must export runTool\(\):/
    );
  } finally {
    process.chdir(currentCwd);
  }
});
