'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeRoot = path.join(repoRoot, 'runtime');
const cli = require(path.join(runtimeRoot, 'bin', 'emb-agent.cjs'));
const toolRuntime = require(path.join(runtimeRoot, 'lib', 'tool-runtime.cjs'));

async function captureStdout(run) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return stdout;
}

async function suppressStdout(run) {
  await captureStdout(run);
}

test('tool runtime stays abstract-only without installed chip support', () => {
  const result = toolRuntime.runTool(runtimeRoot, 'timer-calc', [
    '--family',
    'vendor-family',
    '--device',
    'device-name',
    '--target-us',
    '560'
  ]);

  assert.equal(result.status, 'chip-support-required');
  assert.equal(result.implementation, 'abstract-only');
  assert.equal(result.tool, 'timer-calc');
  assert.equal(result.inputs.options.family, 'vendor-family');
  assert.ok(result.chip_support_search_paths.some(item => item.endsWith('timer-calc.cjs')));
});

test('cli tool run emits chip-support-required json when no support exists', async () => {
  const stdout = await captureStdout(() =>
    cli.main([
      'tool',
      'run',
      'timer-calc',
      '--family',
      'vendor-family',
      '--target-us',
      '125000'
    ])
  );
  const result = JSON.parse(stdout);

  assert.equal(result.status, 'chip-support-required');
  assert.equal(result.implementation, 'abstract-only');
  assert.equal(result.tool, 'timer-calc');
});

test('tool runtime blocks high-risk execution until explicit confirmation is provided', () => {
  const result = toolRuntime.runTool(runtimeRoot, 'timer-calc', [
    '--flash',
    'main',
    '--force'
  ]);

  assert.equal(result.status, 'permission-pending');
  assert.ok(result.high_risk_clarity);
  assert.equal(result.high_risk_clarity.enabled, true);
  assert.equal(result.high_risk_clarity.requires_explicit_confirmation, true);
  assert.ok(Array.isArray(result.high_risk_clarity.matched_signals));
  assert.ok(result.high_risk_clarity.matched_signals.length > 0);
  assert.ok(result.permission_decision);
  assert.equal(result.permission_decision.decision, 'ask');
  assert.equal(result.permission_decision.reason_code, 'high-risk-confirmation');
  assert.ok(Array.isArray(result.permission_gates));
  assert.equal(result.permission_gates[0].kind, 'explicit-confirmation');
  assert.equal(result.permission_gates[0].state, 'pending');
});

test('tool runtime allows confirmed high-risk execution to continue to normal resolution', () => {
  const result = toolRuntime.runTool(runtimeRoot, 'timer-calc', [
    '--confirm',
    '--flash',
    'main',
    '--force'
  ]);

  assert.equal(result.status, 'chip-support-required');
  assert.ok(result.permission_decision);
  assert.equal(result.permission_decision.decision, 'allow');
  assert.equal(result.permission_decision.reason_code, 'explicit-confirmed');
  assert.ok(Array.isArray(result.permission_gates));
  assert.equal(result.permission_gates[0].kind, 'explicit-confirmation');
});

test('pwm-calc also requires installed chip support by default', () => {
  const result = toolRuntime.runTool(runtimeRoot, 'pwm-calc', [
    '--family',
    'vendor-family',
    '--target-hz',
    '3906.25',
    '--target-duty',
    '50'
  ]);

  assert.equal(result.status, 'chip-support-required');
  assert.equal(result.tool, 'pwm-calc');
  assert.equal(result.inputs.options.family, 'vendor-family');
});

test('tool runtime loads project chip support when available', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-tool-runtime-'));
  const currentCwd = process.cwd();
  const sharedPath = path.join(tempProject, '.emb-agent', 'chip-support', 'core', 'shared.cjs');
  const adapterPath = path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'timer-calc.cjs');

  try {
    fs.mkdirSync(path.dirname(sharedPath), { recursive: true });
    fs.mkdirSync(path.dirname(adapterPath), { recursive: true });
    fs.writeFileSync(
      sharedPath,
      [
        "'use strict';",
        '',
        'module.exports = {',
        '  parse(context) {',
        '    return context.parseLongOptions(context.tokens || []);',
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      adapterPath,
      [
        "'use strict';",
        '',
        "const shared = require('../core/shared.cjs');",
        '',
        'module.exports = {',
        '  runTool(context) {',
        '    const options = shared.parse(context);',
        '    return {',
        "      tool: context.toolName,",
        "      status: 'ok',",
        "      implementation: 'external-chip-support',",
        '      chip_support_path: context.adapterPath,',
        '      spec_name: context.spec.name,',
        '      options',
        '    };',
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );

    process.chdir(tempProject);

    const result = toolRuntime.runTool(runtimeRoot, 'timer-calc', [
      '--family',
      'vendor-family',
      '--device',
      'vendor-device',
      '--timer',
      'tm16',
      '--target-us',
      '560'
    ]);

    assert.equal(result.status, 'ok');
    assert.equal(result.implementation, 'external-chip-support');
    assert.equal(result.chip_support_path, adapterPath);
    assert.equal(result.spec_name, 'timer-calc');
    assert.equal(result.options.family, 'vendor-family');
    assert.equal(result.options.device, 'vendor-device');
    assert.equal(result.options.timer, 'tm16');
  } finally {
    process.chdir(currentCwd);
  }
});

test('tool runtime honors project permission deny rules before adapter execution', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-tool-runtime-deny-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));
    await suppressStdout(() =>
      cli.main([
        'project',
        'set',
        '--confirm',
        '--field',
        'permissions.tools.deny',
        '--value',
        JSON.stringify(['timer-calc'])
      ])
    );

    const result = toolRuntime.runTool(runtimeRoot, 'timer-calc', ['--target-us', '560']);
    assert.equal(result.status, 'permission-denied');
    assert.ok(result.permission_decision);
    assert.equal(result.permission_decision.decision, 'deny');
    assert.equal(result.permission_decision.reason_code, 'policy-deny');
    assert.ok(Array.isArray(result.permission_gates));
    assert.equal(result.permission_gates[0].kind, 'permission-rule');
    assert.equal(result.permission_gates[0].state, 'blocked');
  } finally {
    process.chdir(currentCwd);
  }
});

test('generated draft timer route can execute first-pass timer search', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-tool-runtime-generated-'));
  const currentCwd = process.cwd();
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeRoot = path.join(repoRoot, 'runtime');
  const cli = require(path.join(runtimeRoot, 'bin', 'emb-agent.cjs'));

  try {
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'chip-support', 'routes'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'registry.json'),
      JSON.stringify({
        specs: [],
        families: ['vendor-family'],
        devices: ['vendor-device']
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'families', 'vendor-family.json'),
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
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'vendor-device.json'),
      JSON.stringify({
        name: 'vendor-device',
        family: 'vendor-family',
        sample: false,
        description: 'External tool device profile.',
        supported_tools: ['timer-calc'],
        bindings: {
          'timer-calc': {
            algorithm: 'vendor-device-timer-calc',
            draft: true,
            params: {
              default_timer: 'Timer16',
              default_clock_source: 'sysclk',
              prescalers: [1, 4, 16, 64],
              interrupt_bits: [8, 9, 10],
              period_max: 255,
              registers: {
                period: 'PR2',
                counter: 'TMR2'
              },
              register_writes: {
                period_value: [
                  {
                    register: 'PR2',
                    field: 'PR2<7:0>',
                    value_key: 'period_value',
                    source_lsb: 0,
                    width: 8,
                    target_lsb: 0
                  }
                ]
              }
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'timer-calc.cjs'),
      [
        "'use strict';",
        '',
        "const path = require('path');",
        '',
        "const TOOL_NAME = 'timer-calc';",
        "const DEFAULT_FAMILY = 'vendor-family';",
        "const DEFAULT_DEVICE = 'vendor-device';",
        '',
        'function loadBinding(context, options) {',
        "  const toolCatalog = require(path.join(context.rootDir, 'lib', 'tool-catalog.cjs'));",
        "  const requestedDevice = String(options.device || DEFAULT_DEVICE || '').trim();",
        "  const requestedFamily = String(options.family || DEFAULT_FAMILY || '').trim();",
        '  let deviceProfile = null;',
        '  let familyProfile = null;',
        '  if (requestedDevice) {',
        '    try { deviceProfile = toolCatalog.loadDevice(context.rootDir, requestedDevice); } catch { deviceProfile = null; }',
        '  }',
        '  const resolvedFamily = (deviceProfile && deviceProfile.family) || requestedFamily;',
        '  if (resolvedFamily) {',
        '    try { familyProfile = toolCatalog.loadFamily(context.rootDir, resolvedFamily); } catch { familyProfile = null; }',
        '  }',
        "  const deviceBinding = deviceProfile && deviceProfile.bindings ? deviceProfile.bindings[TOOL_NAME] : null;",
        "  const familyBinding = familyProfile && familyProfile.bindings ? familyProfile.bindings[TOOL_NAME] : null;",
        '  return {',
        '    device: requestedDevice,',
        '    family: resolvedFamily,',
        '    source: deviceBinding ? "device" : familyBinding ? "family" : "none",',
        '    binding: deviceBinding || familyBinding || null',
        '  };',
        '}',
        '',
        'module.exports = {',
        '  draft: true,',
        '  runTool(context) {',
        "    const generated = require(path.join(context.rootDir, 'lib', 'generated-tool-adapters.cjs'));",
        '    const options = context.parseLongOptions(context.tokens || []);',
        '    const resolved = loadBinding(context, options);',
        '    return generated.runGeneratedTimerAdapter(context, resolved, options);',
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = toolRuntime.runTool(runtimeRoot, 'timer-calc', [
      '--family',
      'vendor-family',
      '--device',
      'vendor-device',
      '--clock-source',
      'sysclk',
      '--clock-hz',
      '16000000',
      '--target-us',
      '64'
    ]);

    assert.equal(result.status, 'ok');
    assert.equal(result.implementation, 'external-chip-support-draft');
    assert.equal(result.timer.name, 'Timer16');
    assert.equal(result.timer.search_mode, 'register-period');
    assert.equal(result.best_candidate.actual_us, 64);
    assert.equal(result.best_candidate.error_us, 0);
    assert.equal(result.best_candidate.period_register, 'PR2');
    assert.equal(result.best_candidate.period_value, 255);
    assert.equal(result.best_candidate.register_writes.registers[0].register, 'PR2');
    assert.equal(result.best_candidate.register_writes.registers[0].write_value, 255);
    assert.equal(result.best_candidate.register_writes.registers[0].mask, 255);
    assert.equal(result.best_candidate.register_writes.registers[0].c_statement, 'PR2 = (PR2 & ~0xFF) | 0xFF;');
    assert.equal(result.best_candidate.register_writes.registers[0].hal_statement, 'MODIFY_REG(PR2, 0xFF, 0xFF);');
    assert.deepEqual(result.best_candidate.register_writes.c_statements, ['PR2 = (PR2 & ~0xFF) | 0xFF;']);
    assert.deepEqual(result.best_candidate.register_writes.hal_statements, ['MODIFY_REG(PR2, 0xFF, 0xFF);']);
    assert.equal(
      result.best_candidate.register_writes.firmware_snippet_request.protocol,
      'emb-agent.firmware-snippet-request/1'
    );
    assert.equal(result.best_candidate.register_writes.firmware_snippet_request.authoring, 'ai-authored');
    assert.deepEqual(
      result.best_candidate.register_writes.firmware_snippet_request.inputs.registers[0],
      {
        register: 'PR2',
        mask_hex: '0xFF',
        write_value_hex: '0xFF',
        fields: ['PR2<7:0>'],
        c_statement: 'PR2 = (PR2 & ~0xFF) | 0xFF;',
        hal_statement: 'MODIFY_REG(PR2, 0xFF, 0xFF);'
      }
    );
    assert.ok(result.best_candidate.register_writes.firmware_snippet_request.required_output.includes('code_snippet'));
    assert.ok(
      result.best_candidate.register_writes.firmware_snippet_request.required_output.includes('source_edit_policy')
    );
    assert.ok(
      result.best_candidate.register_writes.firmware_snippet_request.required_output.includes('behavior_couplings')
    );
    assert.equal(
      result.best_candidate.register_writes.firmware_snippet_request.artifact_policy.default_directory,
      '.emb-agent/firmware-snippets'
    );
    assert.equal(
      result.best_candidate.register_writes.firmware_snippet_request.artifact_policy.source_editing,
      'review-artifact-first'
    );
    assert.ok(
      result.best_candidate.register_writes.firmware_snippet_request.workflow.some(item => item.includes('project-local review artifact'))
    );
    assert.ok(
      result.best_candidate.register_writes.firmware_snippet_request.gates.some(item => item.includes('compile'))
    );
    assert.ok(
      result.best_candidate.register_writes.firmware_snippet_request.gates.some(item => item.includes('behavior couplings'))
    );
    assert.ok(Array.isArray(result.candidates));
    assert.ok(result.candidates.length > 0);
    assert.ok(
      result.candidates.some(item => item.prescaler === 4 && item.period_value === 255 && item.actual_us === 64)
    );

    const savedStdout = await captureStdout(() =>
      cli.main([
        'tool',
        'run',
        'timer-calc',
        '--family',
        'vendor-family',
        '--device',
        'vendor-device',
        '--clock-source',
        'sysclk',
        '--clock-hz',
        '16000000',
        '--target-us',
        '64',
        '--save-output',
        '--output-file',
        '.emb-agent/runs/timer-calc.json'
      ])
    );
    const saved = JSON.parse(savedStdout);
    const savedPath = path.join(tempProject, '.emb-agent', 'runs', 'timer-calc.json');
    assert.equal(saved.status, 'ok');
    assert.equal(saved.saved_output, '.emb-agent/runs/timer-calc.json');
    assert.equal(fs.existsSync(savedPath), true);
    assert.equal(saved.inputs.options['save-output'], undefined);
    assert.equal(saved.inputs.options['output-file'], undefined);
    assert.ok(saved.next_steps.includes('snippet draft --from-tool-output .emb-agent/runs/timer-calc.json --confirm'));
    assert.ok(saved.next_steps.includes('knowledge formula draft --from-tool-output .emb-agent/runs/timer-calc.json --confirm'));
    assert.ok(saved.next_steps.includes('knowledge graph refresh'));
    assert.ok(saved.next_steps.includes('knowledge graph explain PR2'));
    assert.ok(
      saved.next_steps.indexOf('snippet draft --from-tool-output .emb-agent/runs/timer-calc.json --confirm') <
      saved.next_steps.indexOf('knowledge formula draft --from-tool-output .emb-agent/runs/timer-calc.json --confirm')
    );
    assert.ok(
      saved.next_steps.indexOf('knowledge formula draft --from-tool-output .emb-agent/runs/timer-calc.json --confirm') <
      saved.next_steps.indexOf('knowledge graph refresh')
    );
    assert.ok(
      saved.next_steps.indexOf('knowledge graph refresh') <
      saved.next_steps.indexOf('knowledge graph explain PR2')
    );
    const savedFile = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    assert.equal(savedFile.saved_output, '.emb-agent/runs/timer-calc.json');
    assert.ok(savedFile.next_steps.includes('knowledge formula draft --from-tool-output .emb-agent/runs/timer-calc.json --confirm'));
    assert.ok(savedFile.next_steps.includes('knowledge graph refresh'));
    assert.ok(savedFile.next_steps.includes('knowledge graph explain PR2'));
    assert.equal(savedFile.best_candidate.register_writes.firmware_snippet_request.protocol, 'emb-agent.firmware-snippet-request/1');
  } finally {
    process.chdir(currentCwd);
  }
});

test('generated draft pwm route can execute first-pass pwm search', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-tool-runtime-generated-pwm-'));
  const currentCwd = process.cwd();
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeRoot = path.join(repoRoot, 'runtime');
  const cli = require(path.join(runtimeRoot, 'bin', 'emb-agent.cjs'));

  try {
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'chip-support', 'routes'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'registry.json'),
      JSON.stringify({
        specs: [],
        families: ['vendor-family'],
        devices: ['vendor-device']
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'families', 'vendor-family.json'),
      JSON.stringify({
        name: 'vendor-family',
        vendor: 'VendorName',
        series: 'SeriesName',
        sample: false,
        description: 'External tool family profile.',
        supported_tools: ['pwm-calc'],
        bindings: {},
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'vendor-device.json'),
      JSON.stringify({
        name: 'vendor-device',
        family: 'vendor-family',
        sample: false,
        description: 'External tool device profile.',
        supported_tools: ['pwm-calc'],
        bindings: {
          'pwm-calc': {
            algorithm: 'vendor-device-pwm-calc',
            draft: true,
            params: {
              pwm_block: 'PWM',
              default_output_pin: 'PA3',
              default_clock_source: 'sysclk',
              prescalers: [1, 4, 16],
              counter_bits: [8, 10],
              period_registers: ['ARR'],
              duty_registers: ['CCR1'],
              register_writes: {
                period_value: [
                  {
                    register: 'ARR',
                    field: 'ARR<31:0>',
                    value_key: 'period_value',
                    source_lsb: 0,
                    width: 32,
                    target_lsb: 0
                  }
                ],
                duty_value: [
                  {
                    register: 'CCR1',
                    field: 'CCR1<9:0>',
                    value_key: 'duty_value',
                    source_lsb: 0,
                    width: 10,
                    target_lsb: 0
                  }
                ]
              }
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'pwm-calc.cjs'),
      [
        "'use strict';",
        '',
        "const path = require('path');",
        '',
        "const TOOL_NAME = 'pwm-calc';",
        "const DEFAULT_FAMILY = 'vendor-family';",
        "const DEFAULT_DEVICE = 'vendor-device';",
        '',
        'function loadBinding(context, options) {',
        "  const toolCatalog = require(path.join(context.rootDir, 'lib', 'tool-catalog.cjs'));",
        "  const requestedDevice = String(options.device || DEFAULT_DEVICE || '').trim();",
        "  const requestedFamily = String(options.family || DEFAULT_FAMILY || '').trim();",
        '  let deviceProfile = null;',
        '  let familyProfile = null;',
        '  if (requestedDevice) {',
        '    try { deviceProfile = toolCatalog.loadDevice(context.rootDir, requestedDevice); } catch { deviceProfile = null; }',
        '  }',
        '  const resolvedFamily = (deviceProfile && deviceProfile.family) || requestedFamily;',
        '  if (resolvedFamily) {',
        '    try { familyProfile = toolCatalog.loadFamily(context.rootDir, resolvedFamily); } catch { familyProfile = null; }',
        '  }',
        "  const deviceBinding = deviceProfile && deviceProfile.bindings ? deviceProfile.bindings[TOOL_NAME] : null;",
        "  const familyBinding = familyProfile && familyProfile.bindings ? familyProfile.bindings[TOOL_NAME] : null;",
        '  return {',
        '    device: requestedDevice,',
        '    family: resolvedFamily,',
        '    source: deviceBinding ? "device" : familyBinding ? "family" : "none",',
        '    binding: deviceBinding || familyBinding || null',
        '  };',
        '}',
        '',
        'module.exports = {',
        '  draft: true,',
        '  runTool(context) {',
        "    const generated = require(path.join(context.rootDir, 'lib', 'generated-tool-adapters.cjs'));",
        '    const options = context.parseLongOptions(context.tokens || []);',
        '    const resolved = loadBinding(context, options);',
        '    return generated.runGeneratedPwmAdapter(context, resolved, options);',
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = toolRuntime.runTool(runtimeRoot, 'pwm-calc', [
      '--family',
      'vendor-family',
      '--device',
      'vendor-device',
      '--clock-source',
      'sysclk',
      '--clock-hz',
      '16000000',
      '--target-hz',
      '3906.25',
      '--target-duty',
      '50'
    ]);

    assert.equal(result.status, 'ok');
    assert.equal(result.implementation, 'external-chip-support-draft');
    assert.equal(result.pwm.name, 'PWM');
    assert.equal(result.pwm.output_pin, 'PA3');
    assert.equal(result.pwm.search_mode, 'register-period-duty');
    assert.equal(result.best_candidate.actual_hz, 3906.25);
    assert.equal(result.best_candidate.actual_duty, 50);
    assert.equal(result.best_candidate.freq_error_pct, 0);
    assert.equal(result.best_candidate.duty_error_pct, 0);
    assert.deepEqual(result.best_candidate.period_registers, ['ARR']);
    assert.deepEqual(result.best_candidate.duty_registers, ['CCR1']);
    assert.equal(result.best_candidate.period_value, 1023);
    assert.equal(result.best_candidate.duty_value, 512);
    assert.deepEqual(
      result.best_candidate.register_writes.registers.map(item => [item.register, item.write_value, item.mask]),
      [
        ['ARR', 1023, 4294967295],
        ['CCR1', 512, 1023]
      ]
    );
    assert.equal(result.best_candidate.register_writes.registers[0].mask_hex, '0xFFFFFFFF');
    assert.equal(
      result.best_candidate.register_writes.registers[0].c_statement,
      'ARR = (ARR & ~0xFFFFFFFF) | 0x3FF;'
    );
    assert.equal(
      result.best_candidate.register_writes.registers[0].hal_statement,
      'MODIFY_REG(ARR, 0xFFFFFFFF, 0x3FF);'
    );
    assert.deepEqual(
      result.best_candidate.register_writes.c_statements,
      [
        'ARR = (ARR & ~0xFFFFFFFF) | 0x3FF;',
        'CCR1 = (CCR1 & ~0x3FF) | 0x200;'
      ]
    );
    assert.deepEqual(
      result.best_candidate.register_writes.hal_statements,
      [
        'MODIFY_REG(ARR, 0xFFFFFFFF, 0x3FF);',
        'MODIFY_REG(CCR1, 0x3FF, 0x200);'
      ]
    );
    assert.equal(result.best_candidate.register_writes.firmware_snippet_request.status, 'draft-until-verified');
    assert.equal(result.best_candidate.register_writes.firmware_snippet_request.inputs.registers.length, 2);
    assert.ok(
      result.best_candidate.register_writes.firmware_snippet_request.constraints.includes(
        'do not invent handles channels macros or init order'
      )
    );
    assert.ok(
      result.best_candidate.register_writes.firmware_snippet_request.constraints.includes(
        'do not add helper functions solely to wrap generated register writes'
      )
    );
    assert.ok(
      result.best_candidate.register_writes.firmware_snippet_request.constraints.includes(
        'do not patch firmware sources when relevant source files are dirty unless the user explicitly requests that integration'
      )
    );
    assert.ok(Array.isArray(result.candidates));
    assert.ok(result.candidates.length > 0);
    assert.ok(
      result.candidates.some(item => item.prescaler === 4 && item.period_value === 1023 && item.actual_hz === 3906.25)
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('generated draft adc route can execute first-pass adc scaling', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-tool-runtime-generated-adc-'));
  const currentCwd = process.cwd();
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeRoot = path.join(repoRoot, 'runtime');
  const cli = require(path.join(runtimeRoot, 'bin', 'emb-agent.cjs'));

  try {
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'chip-support', 'routes'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'registry.json'),
      JSON.stringify({
        specs: [],
        families: ['vendor-family'],
        devices: ['vendor-device']
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'families', 'vendor-family.json'),
      JSON.stringify({
        name: 'vendor-family',
        vendor: 'VendorName',
        series: 'SeriesName',
        sample: false,
        description: 'External tool family profile.',
        supported_tools: ['adc-scale'],
        bindings: {},
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'vendor-device.json'),
      JSON.stringify({
        name: 'vendor-device',
        family: 'vendor-family',
        sample: false,
        description: 'External tool device profile.',
        supported_tools: ['adc-scale'],
        bindings: {
          'adc-scale': {
            algorithm: 'vendor-device-adc-scale',
            draft: true,
            params: {
              default_channel: 'PA0',
              channels: {
                PA0: {
                  signal: 'ADC_IN',
                  role: 'adc-input'
                }
              },
              default_reference_source: 'vdd',
              reference_sources: {
                vdd: {
                  fixed_voltage: 5
                }
              },
              supported_resolutions: [8, 10],
              default_resolution: 10
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'adc-scale.cjs'),
      [
        "'use strict';",
        '',
        "const path = require('path');",
        '',
        "const TOOL_NAME = 'adc-scale';",
        "const DEFAULT_FAMILY = 'vendor-family';",
        "const DEFAULT_DEVICE = 'vendor-device';",
        '',
        'function loadBinding(context, options) {',
        "  const toolCatalog = require(path.join(context.rootDir, 'lib', 'tool-catalog.cjs'));",
        "  const requestedDevice = String(options.device || DEFAULT_DEVICE || '').trim();",
        "  const requestedFamily = String(options.family || DEFAULT_FAMILY || '').trim();",
        '  let deviceProfile = null;',
        '  let familyProfile = null;',
        '  if (requestedDevice) {',
        '    try { deviceProfile = toolCatalog.loadDevice(context.rootDir, requestedDevice); } catch { deviceProfile = null; }',
        '  }',
        '  const resolvedFamily = (deviceProfile && deviceProfile.family) || requestedFamily;',
        '  if (resolvedFamily) {',
        '    try { familyProfile = toolCatalog.loadFamily(context.rootDir, resolvedFamily); } catch { familyProfile = null; }',
        '  }',
        "  const deviceBinding = deviceProfile && deviceProfile.bindings ? deviceProfile.bindings[TOOL_NAME] : null;",
        "  const familyBinding = familyProfile && familyProfile.bindings ? familyProfile.bindings[TOOL_NAME] : null;",
        '  return {',
        '    device: requestedDevice,',
        '    family: resolvedFamily,',
        '    source: deviceBinding ? "device" : familyBinding ? "family" : "none",',
        '    binding: deviceBinding || familyBinding || null',
        '  };',
        '}',
        '',
        'module.exports = {',
        '  draft: true,',
        '  runTool(context) {',
        "    const generated = require(path.join(context.rootDir, 'lib', 'generated-tool-adapters.cjs'));",
        '    const options = context.parseLongOptions(context.tokens || []);',
        '    const resolved = loadBinding(context, options);',
        '    return generated.runGeneratedAdcAdapter(context, resolved, options);',
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = toolRuntime.runTool(runtimeRoot, 'adc-scale', [
      '--family',
      'vendor-family',
      '--device',
      'vendor-device',
      '--sample-code',
      '512'
    ]);

    assert.equal(result.status, 'ok');
    assert.equal(result.implementation, 'external-chip-support-draft');
    assert.equal(result.adc.channel, 'PA0');
    assert.equal(result.adc.reference_source, 'vdd');
    assert.equal(result.adc.reference_voltage, 5);
    assert.equal(result.adc.resolution_bits, 10);
    assert.equal(result.conversion.max_code, 1023);
    assert.ok(Number.isNaN(result.conversion.predicted_code));
    assert.equal(result.conversion.sampled_voltage, 2.502443793);
    assert.equal(result.conversion.lsb_voltage, 0.004887586);
  } finally {
    process.chdir(currentCwd);
  }
});

test('generated draft comparator route can execute first-pass threshold feasibility', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-tool-runtime-generated-cmp-'));
  const currentCwd = process.cwd();
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeRoot = path.join(repoRoot, 'runtime');
  const cli = require(path.join(runtimeRoot, 'bin', 'emb-agent.cjs'));

  try {
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'chip-support', 'routes'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'registry.json'),
      JSON.stringify({
        specs: [],
        families: ['vendor-family'],
        devices: ['vendor-device']
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'families', 'vendor-family.json'),
      JSON.stringify({
        name: 'vendor-family',
        vendor: 'VendorName',
        series: 'SeriesName',
        sample: false,
        description: 'External tool family profile.',
        supported_tools: ['comparator-threshold'],
        bindings: {},
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'vendor-device.json'),
      JSON.stringify({
        name: 'vendor-device',
        family: 'vendor-family',
        sample: false,
        description: 'External tool device profile.',
        supported_tools: ['comparator-threshold'],
        bindings: {
          'comparator-threshold': {
            algorithm: 'vendor-device-comparator-threshold',
            draft: true,
            params: {
              default_positive_source: 'PA0',
              default_negative_source: 'vref_ladder',
              positive_sources: {
                PA0: {
                  signal: 'SENSE_IN',
                  role: 'external-input'
                }
              },
              negative_sources: {
                vref_ladder: {
                  role: 'internal-reference',
                  min_ratio: 0.2,
                  max_ratio: 0.8
                }
              },
              threshold_table: [
                {
                  threshold_v: 2.45,
                  setting: 'low',
                  setting_code: 1
                },
                {
                  threshold_v: 2.55,
                  setting: 'high',
                  setting_code: 2
                }
              ],
              register_writes: {
                threshold_selection: [
                  {
                    register: 'CMPREF',
                    field: 'setting_low',
                    value_key: 'setting_code',
                    source_lsb: 0,
                    width: 2,
                    target_lsb: 4
                  }
                ]
              }
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'comparator-threshold.cjs'),
      [
        "'use strict';",
        '',
        "const path = require('path');",
        '',
        "const TOOL_NAME = 'comparator-threshold';",
        "const DEFAULT_FAMILY = 'vendor-family';",
        "const DEFAULT_DEVICE = 'vendor-device';",
        '',
        'function loadBinding(context, options) {',
        "  const toolCatalog = require(path.join(context.rootDir, 'lib', 'tool-catalog.cjs'));",
        "  const requestedDevice = String(options.device || DEFAULT_DEVICE || '').trim();",
        "  const requestedFamily = String(options.family || DEFAULT_FAMILY || '').trim();",
        '  let deviceProfile = null;',
        '  let familyProfile = null;',
        '  if (requestedDevice) {',
        '    try { deviceProfile = toolCatalog.loadDevice(context.rootDir, requestedDevice); } catch { deviceProfile = null; }',
        '  }',
        '  const resolvedFamily = (deviceProfile && deviceProfile.family) || requestedFamily;',
        '  if (resolvedFamily) {',
        '    try { familyProfile = toolCatalog.loadFamily(context.rootDir, resolvedFamily); } catch { familyProfile = null; }',
        '  }',
        "  const deviceBinding = deviceProfile && deviceProfile.bindings ? deviceProfile.bindings[TOOL_NAME] : null;",
        "  const familyBinding = familyProfile && familyProfile.bindings ? familyProfile.bindings[TOOL_NAME] : null;",
        '  return {',
        '    device: requestedDevice,',
        '    family: resolvedFamily,',
        '    source: deviceBinding ? "device" : familyBinding ? "family" : "none",',
        '    binding: deviceBinding || familyBinding || null',
        '  };',
        '}',
        '',
        'module.exports = {',
        '  draft: true,',
        '  runTool(context) {',
        "    const generated = require(path.join(context.rootDir, 'lib', 'generated-tool-adapters.cjs'));",
        '    const options = context.parseLongOptions(context.tokens || []);',
        '    const resolved = loadBinding(context, options);',
        '    return generated.runGeneratedComparatorAdapter(context, resolved, options);',
        '  }',
        '};',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = toolRuntime.runTool(runtimeRoot, 'comparator-threshold', [
      '--family',
      'vendor-family',
      '--device',
      'vendor-device',
      '--vdd',
      '5',
      '--target-threshold-v',
      '2.5'
    ]);

    assert.equal(result.status, 'ok');
    assert.equal(result.implementation, 'external-chip-support-draft');
    assert.equal(result.comparator.positive_source, 'PA0');
    assert.equal(result.comparator.negative_source, 'vref_ladder');
    assert.equal(result.comparator.target_threshold_v, 2.5);
    assert.equal(result.positive_source.threshold_feasible, true);
    assert.equal(result.negative_source.threshold_feasible, true);
    assert.equal(result.feasibility.recommended_reference_side, 'negative');
    assert.equal(result.negative_source.min_voltage, 1);
    assert.equal(result.negative_source.max_voltage, 4);
    assert.equal(result.threshold_selection.threshold_v, 2.45);
    assert.equal(result.threshold_selection.setting, 'low');
    assert.equal(result.threshold_selection.error_v, -0.05);
    assert.equal(result.threshold_selection.register_writes.registers[0].register, 'CMPREF');
    assert.equal(result.threshold_selection.register_writes.registers[0].write_value, 16);
    assert.equal(result.threshold_selection.register_writes.registers[0].mask, 48);
    assert.equal(result.threshold_selection.register_writes.registers[0].c_statement, 'CMPREF = (CMPREF & ~0x30) | 0x10;');
    assert.equal(result.threshold_selection.register_writes.registers[0].hal_statement, 'MODIFY_REG(CMPREF, 0x30, 0x10);');
    assert.equal(
      result.threshold_selection.register_writes.firmware_snippet_request.protocol,
      'emb-agent.firmware-snippet-request/1'
    );
  } finally {
    process.chdir(currentCwd);
  }
});
