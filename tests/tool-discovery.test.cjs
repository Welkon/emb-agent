'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('fixed chip model auto-discovers suggested tools and adapter readiness', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-tool-discovery-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, 'emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init', '--mcu', 'vendor-chip']);

    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'devices'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'devices'), { recursive: true });

    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'registry.json'),
      JSON.stringify({
        devices: ['vendor-chip']
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'devices', 'vendor-chip.json'),
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
        capabilities: ['timer16', 'pwm'],
        docs: [],
        related_tools: ['timer-calc', 'pwm-calc'],
        source_modules: [],
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'timer-calc.cjs'),
      [
        "'use strict';",
        '',
        'module.exports = {',
        '  runTool() {',
        "    return { status: 'ok' };",
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );

    const status = cli.buildStatus();
    const next = cli.buildNextContext();
    const plan = cli.buildActionOutput('plan');

    assert.equal(status.hardware.mcu.model, 'vendor-chip');
    assert.equal(status.hardware.chip_profile.name, 'vendor-chip');
    assert.deepEqual(
      status.suggested_tools.map(item => ({ name: item.name, status: item.status })),
      [
        { name: 'timer-calc', status: 'ready' },
        { name: 'pwm-calc', status: 'adapter-required' }
      ]
    );
    assert.equal(next.hardware.chip_profile.family, 'vendor-family');
    assert.equal(next.suggested_tools.length, 2);
    assert.equal(plan.suggested_tools[0].chip, 'vendor-chip');
    assert.equal(plan.suggested_tools[0].implementation, 'external-adapter');
    assert.equal(plan.suggested_tools[1].implementation, 'abstract-only');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
