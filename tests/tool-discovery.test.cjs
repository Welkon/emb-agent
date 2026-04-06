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

    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'profiles'), { recursive: true });
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
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'families', 'vendor-family.json'),
      JSON.stringify({
        name: 'vendor-family',
        vendor: 'VendorName',
        series: 'SeriesName',
        sample: false,
        description: 'External tool family profile.',
        supported_tools: ['timer-calc', 'pwm-calc'],
        clock_sources: ['sysclk'],
        bindings: {},
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'devices', 'vendor-chip.json'),
      JSON.stringify({
        name: 'vendor-chip',
        family: 'vendor-family',
        sample: false,
        description: 'External tool device profile.',
        supported_tools: ['timer-calc', 'pwm-calc'],
        bindings: {
          'timer-calc': {
            algorithm: 'vendor-timer16',
            params: {
              chip: 'vendor-chip',
              peripheral: 'tm16',
              default_clock_source: 'sysclk',
              prescalers: [1, 4, 16, 64],
              interrupt_bits: [8, 9, 10]
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
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
    assert.equal(status.tool_recommendations.length, 2);
    assert.equal(status.tool_recommendations[0].tool, 'timer-calc');
    assert.equal(status.tool_recommendations[0].status, 'ready');
    assert.equal(status.tool_recommendations[0].binding_source, 'device');
    assert.match(status.tool_recommendations[0].cli_draft, /tool run timer-calc/);
    assert.match(status.tool_recommendations[0].cli_draft, /--family vendor-family/);
    assert.match(status.tool_recommendations[0].cli_draft, /--device vendor-chip/);
    assert.match(status.tool_recommendations[0].cli_draft, /--timer tm16/);
    assert.deepEqual(status.tool_recommendations[0].missing_inputs, ['clock-hz', 'target-us or target-hz']);
    assert.equal(status.tool_recommendations[1].status, 'adapter-required');
    assert.match(status.tool_recommendations[1].cli_draft, /tool run pwm-calc/);
    assert.deepEqual(status.tool_recommendations[1].missing_inputs, ['clock-hz', 'target-hz']);
    assert.equal(next.hardware.chip_profile.family, 'vendor-family');
    assert.equal(next.suggested_tools.length, 2);
    assert.equal(next.tool_recommendations.length, 2);
    assert.equal(next.next.tool_recommendation.tool, 'timer-calc');
    assert.match(next.next.tool_recommendation.cli_draft, /tool run timer-calc/);
    assert.ok(next.next_actions.some(item => item.includes('首选工具草案:')));
    assert.ok(next.next_actions.some(item => item.includes('工具待补参数:')));
    assert.equal(plan.suggested_tools[0].chip, 'vendor-chip');
    assert.equal(plan.tool_recommendations[0].binding_algorithm, 'vendor-timer16');
    assert.equal(plan.suggested_tools[0].implementation, 'external-adapter');
    assert.equal(plan.suggested_tools[1].implementation, 'abstract-only');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('draft adapter route is discoverable but not treated as ready', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-tool-draft-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, 'emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init', '--mcu', 'vendor-chip']);

    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'profiles'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'devices'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'adapters', 'routes'), { recursive: true });

    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'registry.json'),
      JSON.stringify({
        devices: ['vendor-chip']
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
        bindings: {},
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'devices', 'vendor-chip.json'),
      JSON.stringify({
        name: 'vendor-chip',
        family: 'vendor-family',
        sample: false,
        description: 'External tool device profile.',
        supported_tools: ['timer-calc'],
        bindings: {
          'timer-calc': {
            algorithm: 'vendor-timer16',
            draft: true,
            params: {
              default_timer: 'tm16'
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'adapters', 'routes', 'timer-calc.cjs'),
      [
        "'use strict';",
        '',
        'module.exports = {',
        '  draft: true,',
        '  runTool(context) {',
        '    const options = context.parseLongOptions(context.tokens || []);',
        '    return {',
        "      tool: context.toolName,",
        "      status: 'draft-adapter',",
        "      implementation: 'external-adapter-draft',",
        '      inputs: { options }',
        '    };',
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );

    const status = cli.buildStatus();
    const next = cli.buildNextContext();

    assert.deepEqual(
      status.suggested_tools.map(item => ({ name: item.name, status: item.status, implementation: item.implementation })),
      [
        { name: 'timer-calc', status: 'draft-adapter', implementation: 'external-adapter-draft' }
      ]
    );
    assert.equal(status.tool_recommendations[0].status, 'draft-adapter');
    assert.equal(status.tool_recommendations[0].binding_source, 'device');
    assert.equal(next.next.tool_recommendation.status, 'draft-adapter');
    assert.equal(next.next.tool_recommendation.tool, 'timer-calc');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
