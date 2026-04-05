'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeRoot = path.join(repoRoot, 'runtime');
const initProject = require(path.join(runtimeRoot, 'scripts', 'init-project.cjs'));
const cli = require(path.join(runtimeRoot, 'bin', 'emb-agent.cjs'));

function captureJson(run) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return JSON.parse(stdout);
}

test('adapter derive creates extension registries and profile skeletons', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-derive-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

    const result = captureJson(() =>
      cli.main([
        'adapter',
        'derive',
        '--family',
        'scmcu-sc8f0xx',
        '--device',
        'sc8f072',
        '--chip',
        'sc8f072ad608sp',
        '--tool',
        'timer-calc',
        '--tool',
        'pwm-calc',
        '--vendor',
        'SCMCU',
        '--series',
        'SC8F072',
        '--package',
        'sop8',
        '--pin-count',
        '8'
      ])
    );

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.tools, ['timer-calc', 'pwm-calc']);

    const toolRegistry = JSON.parse(
      fs.readFileSync(path.join(tempProject, 'emb-agent', 'extensions', 'tools', 'registry.json'), 'utf8')
    );
    const chipRegistry = JSON.parse(
      fs.readFileSync(path.join(tempProject, 'emb-agent', 'extensions', 'chips', 'registry.json'), 'utf8')
    );
    const deviceProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, 'emb-agent', 'extensions', 'tools', 'devices', 'sc8f072.json'), 'utf8')
    );
    const chipProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, 'emb-agent', 'extensions', 'chips', 'profiles', 'sc8f072ad608sp.json'), 'utf8')
    );
    const loadedChip = cli.chipCatalog.loadChip(runtimeRoot, 'sc8f072ad608sp');

    assert.deepEqual(toolRegistry.families, ['scmcu-sc8f0xx']);
    assert.deepEqual(toolRegistry.devices, ['sc8f072']);
    assert.deepEqual(chipRegistry.devices, ['sc8f072ad608sp']);
    assert.deepEqual(deviceProfile.supported_tools, ['timer-calc', 'pwm-calc']);
    assert.deepEqual(deviceProfile.bindings, {});
    assert.equal(chipProfile.packages[0].name, 'sop8');
    assert.equal(chipProfile.packages[0].pin_count, 8);
    assert.deepEqual(chipProfile.pins, {});
    assert.deepEqual(chipProfile.related_tools, ['timer-calc', 'pwm-calc']);
    assert.equal(loadedChip.packages[0].name, 'sop8');
  } finally {
    process.chdir(currentCwd);
  }
});
