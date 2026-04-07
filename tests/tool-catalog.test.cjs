'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const toolCatalog = require(path.join(repoRoot, 'runtime', 'lib', 'tool-catalog.cjs'));
const chipCatalog = require(path.join(repoRoot, 'runtime', 'lib', 'chip-catalog.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('tool catalog keeps built-in specs abstract and ships no bound profiles', () => {
  const runtimeRoot = path.join(repoRoot, 'runtime');

  const specs = toolCatalog.listToolSpecs(runtimeRoot);
  const families = toolCatalog.listFamilies(runtimeRoot);
  const devices = toolCatalog.listDevices(runtimeRoot);
  const timer = toolCatalog.loadToolSpec(runtimeRoot, 'timer-calc');
  const pwm = toolCatalog.loadToolSpec(runtimeRoot, 'pwm-calc');

  assert.ok(specs.some(item => item.name === 'timer-calc'));
  assert.ok(specs.some(item => item.name === 'pwm-calc'));
  assert.ok(specs.some(item => item.name === 'comparator-threshold'));
  assert.deepEqual(families, []);
  assert.deepEqual(devices, []);
  assert.equal(timer.kind, 'calculator');
  assert.equal(timer.sample, false);
  assert.equal(timer.status, 'abstract');
  assert.deepEqual(timer.family_profiles, []);
  assert.deepEqual(timer.device_profiles, []);
  assert.deepEqual(timer.source_modules, []);
  assert.equal(pwm.status, 'abstract');
  assert.deepEqual(pwm.device_profiles, []);
});

test('cli exports tool catalog for runtime integration', () => {
  const runtimeRoot = path.join(repoRoot, 'runtime');
  const spec = cli.toolCatalog.loadToolSpec(runtimeRoot, 'adc-scale');

  assert.equal(spec.name, 'adc-scale');
  assert.ok(spec.outputs.includes('converted voltage'));
});

test('chip catalog is empty by default in abstract-only core', () => {
  const runtimeRoot = path.join(repoRoot, 'runtime');
  const chips = chipCatalog.listChips(runtimeRoot);
  assert.deepEqual(chips, []);
  assert.deepEqual(cli.chipCatalog.listChips(runtimeRoot), []);
});

test('tool and chip catalogs discover project external registries', () => {
  const runtimeRoot = path.join(repoRoot, 'runtime');
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-tool-catalog-'));
  const currentCwd = process.cwd();
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  try {
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'devices'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'profiles'), { recursive: true });

    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'registry.json'),
      JSON.stringify({
        specs: [],
        families: ['vendor-family'],
        devices: ['vendor-device']
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'families', 'vendor-family.json'),
      JSON.stringify({
        name: 'vendor-family',
        vendor: 'VendorName',
        series: 'SeriesName',
        sample: false,
        description: 'External tool family profile.',
        supported_tools: ['timer-calc'],
        clock_sources: ['sysclk'],
        bindings: {
          'timer-calc': {
            algorithm: 'vendor-timer'
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'devices', 'vendor-device.json'),
      JSON.stringify({
        name: 'vendor-device',
        family: 'vendor-family',
        sample: false,
        description: 'External tool device profile.',
        supported_tools: ['timer-calc'],
        bindings: {
          'timer-calc': {
            algorithm: 'vendor-device-timer'
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'registry.json'),
      JSON.stringify({
        devices: ['vendor-chip', 'legacy-chip']
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'profiles', 'vendor-chip.json'),
      JSON.stringify({
        name: 'vendor-chip',
        vendor: 'VendorName',
        family: 'vendor-family',
        sample: false,
        series: 'SeriesName',
        package: 'qfp32',
        architecture: '8-bit',
        runtime_model: 'main_loop_plus_isr',
        description: 'External chip profile.',
        summary: {},
        capabilities: ['timer16'],
        docs: [],
        related_tools: ['timer-calc'],
        source_modules: [],
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'devices'), { recursive: true });
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'devices', 'legacy-chip.json'),
      JSON.stringify({
        name: 'legacy-chip',
        vendor: 'VendorName',
        family: 'vendor-family',
        sample: false,
        series: 'SeriesName',
        package: 'sop8',
        architecture: '8-bit',
        runtime_model: 'main_loop_plus_isr',
        description: 'Legacy chip profile.',
        summary: {},
        capabilities: ['timer16'],
        docs: [],
        related_tools: ['timer-calc'],
        source_modules: [],
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    process.chdir(tempProject);

    const families = toolCatalog.listFamilies(runtimeRoot);
    const devices = toolCatalog.listDevices(runtimeRoot);
    const chips = chipCatalog.listChips(runtimeRoot);

    assert.deepEqual(families.map(item => item.name), ['vendor-family']);
    assert.deepEqual(devices.map(item => item.name), ['vendor-device']);
    assert.deepEqual(chips.map(item => item.name), ['vendor-chip', 'legacy-chip']);
    assert.equal(cli.toolCatalog.loadFamily(runtimeRoot, 'vendor-family').vendor, 'VendorName');
    assert.equal(
      cli.toolCatalog.loadFamily(runtimeRoot, 'vendor-family').bindings['timer-calc'].algorithm,
      'vendor-timer'
    );
    assert.equal(cli.toolCatalog.loadDevice(runtimeRoot, 'vendor-device').family, 'vendor-family');
    assert.equal(
      cli.toolCatalog.loadDevice(runtimeRoot, 'vendor-device').bindings['timer-calc'].algorithm,
      'vendor-device-timer'
    );
    assert.equal(cli.chipCatalog.loadChip(runtimeRoot, 'vendor-chip').package, 'qfp32');
    assert.equal(cli.chipCatalog.loadChip(runtimeRoot, 'legacy-chip').package, 'sop8');
  } finally {
    process.chdir(currentCwd);
  }
});
