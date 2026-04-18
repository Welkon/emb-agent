'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('fixed chip model auto-discovers suggested tools and chip support readiness', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-tool-discovery-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

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
        source_refs: ['mcu/vendor-chip', 'mcu/vendor-chip-registers'],
        component_refs: [],
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
        source_refs: ['mcu/vendor-family-overview'],
        component_refs: [],
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
        source_refs: ['mcu/vendor-chip-registers'],
        component_refs: [],
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
    assert.deepEqual(status.hardware.chip_profile.source_refs, ['mcu/vendor-chip', 'mcu/vendor-chip-registers']);
    assert.equal(status.recommended_sources[0].id, 'mcu/vendor-chip-registers');
    assert.equal(status.recommended_sources[0].priority_group, 'register-summary');
    assert.equal(status.recommended_sources[0].path, '.emb-agent/docs/sources/mcu/vendor-chip-registers.md');
    assert.deepEqual(
      status.suggested_tools.map(item => ({ name: item.name, status: item.status })),
      [
        { name: 'timer-calc', status: 'ready' },
        { name: 'pwm-calc', status: 'chip-support-required' }
      ]
    );
    assert.equal(status.tool_recommendations.length, 2);
    assert.equal(status.tool_recommendations[0].tool, 'timer-calc');
    assert.equal(status.tool_recommendations[0].status, 'ready');
    assert.equal(status.tool_recommendations[0].binding_source, 'device');
    assert.equal(status.tool_recommendations[0].trust.grade, 'trusted');
    assert.equal(status.tool_recommendations[0].trust.executable, true);
    assert.match(status.tool_recommendations[0].cli_draft, /tool run timer-calc/);
    assert.match(status.tool_recommendations[0].cli_draft, /--family vendor-family/);
    assert.match(status.tool_recommendations[0].cli_draft, /--device vendor-chip/);
    assert.match(status.tool_recommendations[0].cli_draft, /--timer tm16/);
    assert.deepEqual(status.tool_recommendations[0].missing_inputs, ['clock-hz', 'target-us or target-hz']);
    assert.equal(status.tool_recommendations[1].status, 'chip-support-required');
    assert.equal(status.tool_recommendations[1].trust.executable, false);
    assert.match(status.tool_recommendations[1].cli_draft, /tool run pwm-calc/);
    assert.deepEqual(status.tool_recommendations[1].missing_inputs, ['clock-hz', 'target-hz']);
    assert.equal(next.hardware.chip_profile.family, 'vendor-family');
    assert.equal(next.next.command, 'scan');
    assert.equal(next.next.gated_by_health, false);
    assert.equal(next.suggested_tools.length, 2);
    assert.equal(next.tool_recommendations.length, 2);
    assert.equal(next.recommended_sources[0].id, 'mcu/vendor-chip-registers');
    assert.equal(next.next.tool_recommendation.tool, 'timer-calc');
    assert.equal(next.next.tool_recommendation.trust.grade, 'trusted');
    assert.match(next.next.tool_recommendation.cli_draft, /tool run timer-calc/);
    assert.ok(next.next_actions.some(item => item.includes('Re-read the register summary first: .emb-agent/docs/sources/mcu/vendor-chip-registers.md')));
    assert.ok(next.next_actions.some(item => item.includes('Preferred tool draft:')));
    assert.ok(next.next_actions.some(item => item.includes('Missing tool inputs:')));
    assert.equal(plan.recommended_sources[0].id, 'mcu/vendor-chip-registers');
    assert.equal(plan.suggested_tools[0].chip, 'vendor-chip');
    assert.equal(plan.tool_recommendations[0].binding_algorithm, 'vendor-timer16');
    assert.equal(plan.suggested_tools[0].implementation, 'external-chip-support');
    assert.equal(plan.suggested_tools[1].implementation, 'abstract-only');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('draft chip support route is discoverable but not treated as ready', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-tool-draft-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init', '--mcu', 'vendor-chip']);

    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'profiles'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'devices'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'chip-support', 'routes'), { recursive: true });

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
      path.join(projectEmbDir, 'chip-support', 'routes', 'timer-calc.cjs'),
      [
        "'use strict';",
        '',
        'module.exports = {',
        '  draft: true,',
        '  runTool(context) {',
        '    const options = context.parseLongOptions(context.tokens || []);',
        '    return {',
        "      tool: context.toolName,",
        "      status: 'draft-chip-support',",
        "      implementation: 'external-chip-support-draft',",
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
        { name: 'timer-calc', status: 'draft-chip-support', implementation: 'external-chip-support-draft' }
      ]
    );
    assert.equal(status.tool_recommendations[0].status, 'draft-chip-support');
    assert.equal(status.tool_recommendations[0].binding_source, 'device');
    assert.equal(status.tool_recommendations[0].trust.grade, 'draft');
    assert.equal(status.tool_recommendations[0].trust.executable, false);
    assert.equal(next.next.tool_recommendation.status, 'draft-chip-support');
    assert.equal(next.next.tool_recommendation.tool, 'timer-calc');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('known chip start path prefers guided bootstrap once a chip support source is configured', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-start-bootstrap-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['declare', 'hardware', '--confirm', '--mcu', 'vendor-chip', '--package', 'qfp32']);
    await cli.main(['support', 'source', 'add', 'local-pack', '--type', 'path', '--location', tempProject]);

    const start = cli.buildStartContext();

    assert.equal(start.immediate.command, 'bootstrap run --confirm');
    assert.match(start.immediate.cli, /bootstrap run --confirm$/);
    assert.ok(Array.isArray(start.workflow.steps[0].commands));
    assert.ok(start.workflow.steps[0].commands.some(item => item.includes('bootstrap run --confirm')));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('hardware PWM intent makes next prefer pwm-calc over generic timer-calc', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-tool-pwm-intent-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init', '--mcu', 'vendor-chip', '--package', 'qfp32']);

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
        source_refs: ['mcu/vendor-chip', 'mcu/vendor-chip-registers'],
        component_refs: [],
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
      path.join(projectEmbDir, 'extensions', 'tools', 'pwm-calc.cjs'),
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
        source_refs: ['mcu/vendor-family-overview'],
        component_refs: [],
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
        source_refs: ['mcu/vendor-chip-registers'],
        component_refs: [],
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
          },
          'pwm-calc': {
            algorithm: 'vendor-pwm',
            params: {
              chip: 'vendor-chip',
              peripheral: 'pwm',
              mode_macro: 'PWMCON',
              scale_macro: 'PWMSCALE',
              counter_register: 'PWMCNT',
              period_register: 'PWMPER',
              default_clock_source: 'sysclk',
              default_output_pin: 'pa3',
              default_resolution: 'auto',
              prescalers: [1],
              divider_min: 1,
              divider_max: 16,
              resolutions: [8, 7],
              clock_sources: {
                sysclk: { macro: 'SYSCLK' }
              },
              output_pins: {
                pa3: { macro: 'PA3' }
              }
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    await cli.main([
      'declare', 'hardware', '--confirm',
      '--mcu', 'vendor-chip',
      '--package', 'qfp32',
      '--signal', 'PWM_OUT',
      '--pin', 'PA3',
      '--dir', 'output',
      '--note', '20kHz PWM output',
      '--confirmed', 'true',
      '--peripheral', 'PWM',
      '--usage', '20kHz 50% duty output'
    ]);

    const next = cli.buildNextContext();

    assert.equal(next.next.tool_recommendation.tool, 'pwm-calc');
    assert.match(next.next.tool_recommendation.cli_draft, /tool run pwm-calc/);
    assert.match(next.next.tool_recommendation.cli_draft, /--output-pin pa3/);
    assert.match(next.next.tool_recommendation.cli_draft, /--target-hz 20000/);
    assert.match(next.next.tool_recommendation.cli_draft, /--target-duty 50/);
    assert.equal(next.hardware.mcu.signals[0].name, 'PWM_OUT');
    assert.equal(next.hardware.mcu.peripherals[0].name, 'PWM');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('hardware ADC intent makes next prefer adc-scale over generic timer-calc', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-tool-adc-intent-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init', '--mcu', 'vendor-chip', '--package', 'qfp32']);

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
        source_refs: ['mcu/vendor-chip', 'mcu/vendor-chip-registers'],
        component_refs: [],
        summary: {},
        capabilities: ['timer16', 'adc'],
        docs: [],
        related_tools: ['timer-calc', 'adc-scale'],
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
      path.join(projectEmbDir, 'extensions', 'tools', 'adc-scale.cjs'),
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
        supported_tools: ['timer-calc', 'adc-scale'],
        source_refs: ['mcu/vendor-family-overview'],
        component_refs: [],
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
        supported_tools: ['timer-calc', 'adc-scale'],
        source_refs: ['mcu/vendor-chip-registers'],
        component_refs: [],
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
          },
          'adc-scale': {
            algorithm: 'vendor-adc',
            params: {
              chip: 'vendor-chip',
              peripheral: 'adc',
              default_reference_source: 'vdd',
              default_resolution: 12,
              supported_resolutions: [12],
              reference_sources: {
                vdd: {
                  label: 'VDD'
                }
              },
              channel_aliases: {
                pa0: 'an0'
              },
              channels: {
                an0: {
                  name: 'AN0'
                }
              }
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    await cli.main([
      'declare', 'hardware', '--confirm',
      '--mcu', 'vendor-chip',
      '--package', 'qfp32',
      '--signal', 'ADC_IN',
      '--pin', 'PA0',
      '--dir', 'input',
      '--note', 'Voltage sampling input on PA0',
      '--confirmed', 'true',
      '--peripheral', 'ADC',
      '--usage', 'Sample input voltage on PA0'
    ]);

    const next = cli.buildNextContext();

    assert.equal(next.next.tool_recommendation.tool, 'adc-scale');
    assert.match(next.next.reason, /adc-scale/);
    assert.match(next.next.tool_recommendation.cli_draft, /tool run adc-scale/);
    assert.match(next.next.tool_recommendation.cli_draft, /--channel PA0/);
    assert.equal(next.hardware.mcu.signals[0].name, 'ADC_IN');
    assert.equal(next.hardware.mcu.peripherals[0].name, 'ADC');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('broad peripheral exercise keeps next in walkthrough mode instead of single-tool tunnel vision', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-tool-peripheral-walkthrough-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init', '--mcu', 'vendor-chip', '--package', 'qfp32']);

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
        source_refs: ['mcu/vendor-chip', 'mcu/vendor-chip-registers'],
        component_refs: [],
        summary: {},
        capabilities: ['timer', 'pwm', 'comparator', 'adc'],
        docs: [],
        related_tools: ['timer-calc', 'pwm-calc', 'comparator-threshold', 'adc-scale'],
        source_modules: [],
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    ['timer-calc', 'pwm-calc', 'comparator-threshold', 'adc-scale'].forEach(toolName => {
      fs.writeFileSync(
        path.join(projectEmbDir, 'extensions', 'tools', `${toolName}.cjs`),
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
    });

    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'families', 'vendor-family.json'),
      JSON.stringify({
        name: 'vendor-family',
        vendor: 'VendorName',
        series: 'SeriesName',
        sample: false,
        description: 'External tool family profile.',
        supported_tools: ['timer-calc', 'pwm-calc', 'comparator-threshold', 'adc-scale'],
        source_refs: ['mcu/vendor-family-overview'],
        component_refs: [],
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
        supported_tools: ['timer-calc', 'pwm-calc', 'comparator-threshold', 'adc-scale'],
        source_refs: ['mcu/vendor-chip-registers'],
        component_refs: [],
        bindings: {
          'timer-calc': {
            algorithm: 'vendor-timer',
            params: {
              chip: 'vendor-chip',
              peripheral: 'tmr0',
              default_timer: 'tmr0',
              default_clock_source: 'sysclk',
              prescalers: [1]
            }
          },
          'pwm-calc': {
            algorithm: 'vendor-pwm',
            params: {
              chip: 'vendor-chip',
              peripheral: 'pwm',
              default_output_pin: 'pa3',
              default_clock_source: 'sysclk',
              output_pins: {
                pa3: { pin: 'pa3' }
              },
              clock_sources: {
                sysclk: { label: 'SYSCLK' }
              }
            }
          },
          'comparator-threshold': {
            algorithm: 'vendor-cmp',
            params: {
              chip: 'vendor-chip',
              peripheral: 'cmp',
              default_positive_source: 'vr',
              default_negative_source: 'cmp0n',
              positive_sources: {
                vr: {}
              },
              negative_sources: {
                cmp0n: {}
              }
            }
          },
          'adc-scale': {
            algorithm: 'vendor-adc',
            params: {
              chip: 'vendor-chip',
              peripheral: 'adc',
              default_reference_source: 'vdd',
              default_channel: 'an0',
              default_resolution: 12,
              supported_resolutions: [12],
              reference_sources: {
                vdd: { label: 'VDD' }
              },
              channels: {
                an0: { name: 'AN0' }
              }
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    await cli.main([
      'declare', 'hardware', '--confirm',
      '--mcu', 'vendor-chip',
      '--package', 'qfp32',
      '--signal', 'PWM_OUT',
      '--pin', 'PA3',
      '--dir', 'output',
      '--note', '20kHz PWM output',
      '--confirmed', 'true',
      '--signal', 'CMP_IN',
      '--pin', 'PA1',
      '--dir', 'input',
      '--note', 'Comparator input',
      '--confirmed', 'true',
      '--signal', 'ADC_IN',
      '--pin', 'PA0',
      '--dir', 'input',
      '--note', 'ADC sampling input',
      '--confirmed', 'true',
      '--peripheral', 'PWM',
      '--usage', '20kHz 50% duty output',
      '--peripheral', 'Comparator',
      '--usage', 'Threshold compare',
      '--peripheral', 'ADC',
      '--usage', 'Voltage sampling'
    ]);
    await cli.main([
      'task', 'add', '--confirm',
      'Exercise all supported vendor-chip peripherals',
      '--type', 'implement',
      '--scope', 'peripherals',
      '--priority', 'P1'
    ]);
    await cli.main(['task', 'activate', '--confirm', 'exercise-all-supported-vendor-chip-peripherals']);

    const next = cli.buildNextContext();

    assert.equal(next.next.command, 'scan');
    assert.match(next.next.reason, /broad peripheral exercise/i);
    assert.equal(next.next.walkthrough_recommendation.kind, 'peripheral-walkthrough');
    assert.deepEqual(
      next.next.walkthrough_recommendation.ordered_tools,
      ['timer-calc', 'pwm-calc', 'comparator-threshold', 'adc-scale']
    );
    assert.equal(next.walkthrough_recommendation.kind, 'peripheral-walkthrough');
    assert.match(next.action_card.first_instruction, /Ready tool checklist:/);
    assert.match(next.action_card.followup, /Run scan first, then walk each ready tool once/);
    assert.ok(next.next_actions.some(item => item.includes('do not stop at the first matching tool')));
    assert.ok(next.next_actions.some(item => item.includes('Ready tool checklist: 1. timer-calc | 2. pwm-calc | 3. comparator-threshold | 4. adc-scale')));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('hardware model plus package can resolve derived chip slug automatically', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-chip-slug-discovery-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    fs.writeFileSync(
      path.join(projectEmbDir, 'hw.yaml'),
      [
        'mcu:',
        '  vendor: "SCMCU"',
        '  model: "SC8F072"',
        '  package: "SOP8"',
        '',
        'board:',
        '  name: ""',
        '  target: ""',
        '',
        'sources:',
        '  datasheet:',
        '    - ""',
        '  schematic:',
        '    - ""',
        '  code:',
        '    - ""',
        '',
        'signals:',
        '  - name: "PWM_OUT"',
        '    pin: "PA3"',
        '    direction: "output"',
        '    default_state: "low"',
        '    confirmed: false',
        '    note: ""',
        '',
        'peripherals:',
        '  - name: "Timer16"',
        '    usage: "time base"',
        '',
        'truths:',
        '  - "Board uses SC8F072 SOP8"',
        '',
        'constraints:',
        '  - ""',
        '',
        'unknowns:',
        '  - ""',
        ''
      ].join('\n'),
      'utf8'
    );

    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'profiles'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'devices'), { recursive: true });

    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'registry.json'),
      JSON.stringify({
        devices: ['sc8f072sop8']
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'profiles', 'sc8f072sop8.json'),
      JSON.stringify({
        name: 'sc8f072sop8',
        vendor: 'SCMCU',
        family: 'scmcu-sc8f072',
        sample: false,
        series: 'SC8F072',
        package: 'SOP8',
        architecture: '8-bit',
        runtime_model: 'main_loop_plus_isr',
        description: 'External chip profile.',
        summary: {},
        capabilities: ['Timer16'],
        docs: [],
        related_tools: ['timer-calc'],
        source_modules: [],
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'registry.json'),
      JSON.stringify({
        specs: [],
        families: ['scmcu-sc8f072'],
        devices: ['sc8f072']
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'families', 'scmcu-sc8f072.json'),
      JSON.stringify({
        name: 'scmcu-sc8f072',
        vendor: 'SCMCU',
        series: 'SC8F072',
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
      path.join(projectEmbDir, 'extensions', 'tools', 'devices', 'sc8f072.json'),
      JSON.stringify({
        name: 'sc8f072',
        family: 'scmcu-sc8f072',
        sample: false,
        description: 'External tool device profile.',
        supported_tools: ['timer-calc'],
        bindings: {
          'timer-calc': {
            algorithm: 'sc8f072-timer-calc',
            draft: true,
            params: {
              default_timer: 'Timer16',
              prescalers: [1, 4, 16],
              interrupt_bits: [8, 9, 10]
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    const status = cli.buildStatus();
    const health = cli.buildHealthReport();

    assert.equal(status.hardware.mcu.model, 'SC8F072');
    assert.equal(status.hardware.mcu.package, 'SOP8');
    assert.equal(status.hardware.chip_profile.name, 'sc8f072sop8');
    assert.equal(status.hardware.chip_profile.family, 'scmcu-sc8f072');
    assert.equal(status.suggested_tools[0].tool_kind, 'calculator');
    assert.equal(
      health.checks.find(item => item.key === 'hardware_identity').status,
      'pass'
    );
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('exact pwm target on a known pin can prefer lpwmg over generic pwm route', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-lpwmg-prefer-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'profiles'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'devices'), { recursive: true });
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'chips', 'registry.json'),
      JSON.stringify({ devices: ['vendor-chip'] }, null, 2) + '\n',
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
        source_refs: ['mcu/vendor-chip-registers'],
        component_refs: [],
        summary: {},
        capabilities: ['pwm', 'lpwmg'],
        docs: [],
        related_tools: ['pwm-calc', 'lpwmg-calc'],
        source_modules: [],
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'pwm-calc.cjs'),
      [
        "'use strict';",
        '',
        'module.exports = {',
        '  runTool() {',
        "    return { status: 'ok', route: 'pwm' };",
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectEmbDir, 'extensions', 'tools', 'lpwmg-calc.cjs'),
      [
        "'use strict';",
        '',
        'module.exports = {',
        '  runTool() {',
        "    return { status: 'ok', route: 'lpwmg' };",
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
        supported_tools: ['pwm-calc', 'lpwmg-calc'],
        source_refs: [],
        component_refs: [],
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
        supported_tools: ['pwm-calc', 'lpwmg-calc'],
        source_refs: ['mcu/vendor-chip-registers'],
        component_refs: [],
        bindings: {
          'pwm-calc': {
            algorithm: 'vendor-pwm',
            params: {
              default_clock_source: 'sysclk',
              default_output_pin: 'pa3',
              clock_sources: {
                sysclk: {}
              },
              output_pins: {
                pa3: {}
              }
            }
          },
          'lpwmg-calc': {
            algorithm: 'vendor-lpwmg',
            params: {
              default_clock_source: 'sysclk',
              default_channel: 'lpwmg2',
              clock_sources: {
                sysclk: {}
              },
              channels: {
                lpwmg2: {
                  output_pins: ['pa3']
                }
              }
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    await cli.main([
      'declare', 'hardware', '--confirm',
      '--mcu', 'vendor-chip',
      '--package', 'qfp32',
      '--signal', 'PWM_OUT',
      '--pin', 'PA3',
      '--dir', 'output',
      '--note', 'exact 20kHz 50% PWM output on PA3',
      '--confirmed', 'true',
      '--peripheral', 'PWM',
      '--usage', '20kHz 50% exact output demo'
    ]);
    await cli.main([
      'task', 'add', '--confirm',
      'Bring up exact 20kHz 50% PWM on PA3',
      '--type', 'implement',
      '--scope', 'pwm',
      '--priority', 'P1'
    ]);
    await cli.main(['task', 'activate', 'bring-up-exact-20khz-50-pwm-on-pa3', '--confirm']);

    const next = cli.buildNextContext();

    assert.equal(next.next.tool_recommendation.tool, 'lpwmg-calc');
    assert.match(next.next.reason, /lpwmg-calc/);
    assert.match(next.next.tool_recommendation.cli_draft, /tool run lpwmg-calc/);
    assert.match(next.next.tool_recommendation.cli_draft, /--channel lpwmg2/);
    assert.match(next.next.tool_recommendation.cli_draft, /--output-pin pa3/);
    assert.match(next.next.tool_recommendation.cli_draft, /--clock-source sysclk/);
    assert.match(next.next.tool_recommendation.cli_draft, /--target-hz 20000/);
    assert.match(next.next.tool_recommendation.cli_draft, /--target-duty 50/);
    assert.deepEqual(next.next.tool_recommendation.missing_inputs, ['clock frequency']);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(currentCwd);
  }
});
