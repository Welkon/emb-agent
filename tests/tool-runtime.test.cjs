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

test('tool runtime stays abstract-only without external adapter', () => {
  const result = toolRuntime.runTool(runtimeRoot, 'timer-calc', [
    '--family',
    'vendor-family',
    '--device',
    'device-name',
    '--target-us',
    '560'
  ]);

  assert.equal(result.status, 'adapter-required');
  assert.equal(result.implementation, 'abstract-only');
  assert.equal(result.tool, 'timer-calc');
  assert.equal(result.inputs.options.family, 'vendor-family');
  assert.ok(result.adapter_search_paths.some(item => item.endsWith('timer-calc.cjs')));
});

test('cli tool run emits adapter-required json when no adapter exists', async () => {
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

  assert.equal(result.status, 'adapter-required');
  assert.equal(result.implementation, 'abstract-only');
  assert.equal(result.tool, 'timer-calc');
});

test('pwm-calc also requires external adapter by default', () => {
  const result = toolRuntime.runTool(runtimeRoot, 'pwm-calc', [
    '--family',
    'vendor-family',
    '--target-hz',
    '3906.25',
    '--target-duty',
    '50'
  ]);

  assert.equal(result.status, 'adapter-required');
  assert.equal(result.tool, 'pwm-calc');
  assert.equal(result.inputs.options.family, 'vendor-family');
});

test('tool runtime loads project external adapter when available', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-tool-runtime-'));
  const currentCwd = process.cwd();
  const sharedPath = path.join(tempProject, 'emb-agent', 'adapters', 'core', 'shared.cjs');
  const adapterPath = path.join(tempProject, 'emb-agent', 'adapters', 'routes', 'timer-calc.cjs');

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
        "      implementation: 'external-adapter',",
        '      adapter_path: context.adapterPath,',
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
    assert.equal(result.implementation, 'external-adapter');
    assert.equal(result.adapter_path, adapterPath);
    assert.equal(result.spec_name, 'timer-calc');
    assert.equal(result.options.family, 'vendor-family');
    assert.equal(result.options.device, 'vendor-device');
    assert.equal(result.options.timer, 'tm16');
  } finally {
    process.chdir(currentCwd);
  }
});

test('generated draft timer route can execute first-pass timer search', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-tool-runtime-generated-'));
  const currentCwd = process.cwd();
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeRoot = path.join(repoRoot, 'runtime');
  const cli = require(path.join(runtimeRoot, 'bin', 'emb-agent.cjs'));
  const originalWrite = process.stdout.write;

  try {
    process.chdir(tempProject);
    process.stdout.write = () => true;
    cli.main(['init']);
    process.stdout.write = originalWrite;

    fs.mkdirSync(path.join(tempProject, 'emb-agent', 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, 'emb-agent', 'extensions', 'tools', 'devices'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, 'emb-agent', 'adapters', 'routes'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, 'emb-agent', 'extensions', 'tools', 'registry.json'),
      JSON.stringify({
        specs: [],
        families: ['vendor-family'],
        devices: ['vendor-device']
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, 'emb-agent', 'extensions', 'tools', 'families', 'vendor-family.json'),
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
      path.join(tempProject, 'emb-agent', 'extensions', 'tools', 'devices', 'vendor-device.json'),
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
              interrupt_bits: [8, 9, 10]
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, 'emb-agent', 'adapters', 'routes', 'timer-calc.cjs'),
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
    assert.equal(result.implementation, 'external-adapter-draft');
    assert.equal(result.timer.name, 'Timer16');
    assert.equal(result.best_candidate.actual_us, 64);
    assert.equal(result.best_candidate.error_us, 0);
    assert.ok(Array.isArray(result.candidates));
    assert.ok(result.candidates.length > 0);
    assert.ok(
      result.candidates.some(item => item.prescaler === 4 && item.interrupt_bit === 8 && item.actual_us === 64)
    );
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
