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
