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

test('capability list shows workflow capabilities by default and runtime surfaces with --all', async () => {
  const listed = await captureCliJson(['capability', 'list']);
  const listedAll = await captureCliJson(['capability', 'list', '--all']);

  assert.ok(Array.isArray(listed.capabilities));
  assert.ok(listed.capabilities.some(item => item.name === 'scan'));
  assert.ok(listed.capabilities.some(item => item.name === 'arch-review'));
  assert.ok(!listed.capabilities.some(item => item.name === 'status'));

  assert.ok(listedAll.capabilities.some(item => item.name === 'status'));
  assert.ok(listedAll.capabilities.some(item => item.name === 'next'));
});

test('capability show and run route through capability-first metadata', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-capability-command-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await captureCliJson(['init']);

    const shown = await captureCliJson(['capability', 'show', 'plan']);
    const executed = await captureCliJson(['capability', 'run', 'plan']);

    assert.equal(shown.capability.name, 'plan');
    assert.equal(shown.capability.capability_route.primary_entry.kind, 'capability');
    assert.equal(shown.capability.capability_route.compatibility_command, undefined);
    assert.equal(executed.capability_route.primary_entry.kind, 'capability');
    assert.equal(executed.capability_route.compatibility_command, undefined);
  } finally {
    process.chdir(currentCwd);
  }
});

test('capability materialize all generates project-local workflow capability assets', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-capability-materialize-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);

    const materialized = await captureCliJson(['capability', 'materialize', 'all']);
    const registryPath = path.join(tempProject, '.emb-agent', 'registry', 'workflow.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

    assert.equal(materialized.command, 'capability materialize');
    assert.ok(Array.isArray(materialized.results));
    assert.ok(materialized.results.some(item => item.capability === 'scan'));
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'capability-scan.md')));
    assert.ok(fs.existsSync(path.join(tempProject, '.emb-agent', 'templates', 'scan-workflow.md.tpl')));
    assert.ok(registry.specs.some(item => item.name === 'capability-scan'));
    assert.ok(registry.templates.some(item => item.name === 'scan-workflow'));

    const specContent = fs.readFileSync(
      path.join(tempProject, '.emb-agent', 'specs', 'capability-scan.md'),
      'utf8'
    );
    const templateContent = fs.readFileSync(
      path.join(tempProject, '.emb-agent', 'templates', 'scan-workflow.md.tpl'),
      'utf8'
    );
    assert.doesNotMatch(specContent, /Compatibility alias/);
    assert.doesNotMatch(templateContent, /Compatibility alias/);
  } finally {
    process.chdir(currentCwd);
  }
});
