'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeRoot = path.join(repoRoot, 'runtime');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(runtimeRoot, 'bin', 'emb-agent.cjs'));

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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createPathAdapterSource(rootDir) {
  writeText(
    path.join(rootDir, 'adapters', 'core', 'shared.cjs'),
    [
      "'use strict';",
      '',
      'module.exports = {',
      '  parse(context) {',
      '    return context.parseLongOptions(context.tokens || []);',
      '  }',
      '};',
      ''
    ].join('\n')
  );

  writeText(
    path.join(rootDir, 'adapters', 'routes', 'timer-calc.cjs'),
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
      "      adapter_path: context.adapterPath,",
      "      family: options.family || '',",
      "      device: options.device || ''",
      '    };',
      '  }',
      '};',
      ''
    ].join('\n')
  );

  writeJson(path.join(rootDir, 'extensions', 'tools', 'families', 'vendor-family.json'), {
    name: 'vendor-family',
    vendor: 'VendorName',
    series: 'SeriesName',
    description: 'Adapter family profile.',
    supported_tools: ['timer-calc'],
    clock_sources: ['sysclk'],
    notes: []
  });

  writeJson(path.join(rootDir, 'extensions', 'tools', 'devices', 'vendor-device.json'), {
    name: 'vendor-device',
    family: 'vendor-family',
    description: 'Adapter device profile.',
    supported_tools: ['timer-calc'],
    notes: []
  });

  writeJson(path.join(rootDir, 'extensions', 'chips', 'devices', 'vendor-chip.json'), {
    name: 'vendor-chip',
    vendor: 'VendorName',
    family: 'vendor-family',
    description: 'Adapter chip profile.',
    package: 'sop8',
    runtime_model: 'main_loop_plus_isr',
    summary: {},
    capabilities: ['timer16'],
    docs: [],
    related_tools: ['timer-calc'],
    source_modules: [],
    notes: []
  });
}

function createGitAdapterSource(rootDir) {
  const layoutRoot = path.join(rootDir, 'emb-agent');

  writeText(
    path.join(layoutRoot, 'adapters', 'core', 'shared.cjs'),
    [
      "'use strict';",
      '',
      'module.exports = {',
      '  parse(context) {',
      '    return context.parseLongOptions(context.tokens || []);',
      '  }',
      '};',
      ''
    ].join('\n')
  );

  writeText(
    path.join(layoutRoot, 'adapters', 'routes', 'pwm-calc.cjs'),
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
      "      adapter_path: context.adapterPath,",
      "      duty: options['target-duty'] || ''",
      '    };',
      '  }',
      '};',
      ''
    ].join('\n')
  );

  writeJson(path.join(layoutRoot, 'extensions', 'tools', 'families', 'git-family.json'), {
    name: 'git-family',
    vendor: 'GitVendor',
    series: 'GitSeries',
    description: 'Git adapter family profile.',
    supported_tools: ['pwm-calc'],
    clock_sources: ['ihrc'],
    notes: []
  });

  childProcess.execFileSync('git', ['init'], {
    cwd: rootDir,
    stdio: 'ignore'
  });
  childProcess.execFileSync('git', ['add', '.'], {
    cwd: rootDir,
    stdio: 'ignore'
  });
  childProcess.execFileSync(
    'git',
    ['-c', 'user.name=emb-agent', '-c', 'user.email=emb-agent@example.com', 'commit', '-m', 'init'],
    {
      cwd: rootDir,
      stdio: 'ignore'
    }
  );
}

function createFilteredGitAdapterSource(rootDir) {
  createFilteredAdapterSource(rootDir);
  childProcess.execFileSync('git', ['init'], {
    cwd: rootDir,
    stdio: 'ignore'
  });
  childProcess.execFileSync('git', ['add', '.'], {
    cwd: rootDir,
    stdio: 'ignore'
  });
  childProcess.execFileSync(
    'git',
    ['-c', 'user.name=emb-agent', '-c', 'user.email=emb-agent@example.com', 'commit', '-m', 'init'],
    {
      cwd: rootDir,
      stdio: 'ignore'
    }
  );
}

function createFilteredAdapterSource(rootDir) {
  writeText(
    path.join(rootDir, 'adapters', 'core', 'shared.cjs'),
    [
      "'use strict';",
      '',
      'module.exports = {',
      '  ok(tool) {',
      "    return { status: 'ok', tool };",
      '  }',
      '};',
      ''
    ].join('\n')
  );

  writeText(
    path.join(rootDir, 'adapters', 'algorithms', 'scmcu-timer.cjs'),
    [
      "'use strict';",
      '',
      'module.exports = {',
      "  name: 'scmcu-timer'",
      '};',
      ''
    ].join('\n')
  );

  writeText(
    path.join(rootDir, 'adapters', 'algorithms', 'padauk-tm2-pwm.cjs'),
    [
      "'use strict';",
      '',
      'module.exports = {',
      "  name: 'padauk-tm2-pwm'",
      '};',
      ''
    ].join('\n')
  );

  writeText(
    path.join(rootDir, 'adapters', 'routes', 'timer-calc.cjs'),
    [
      "'use strict';",
      '',
      "const shared = require('../core/shared.cjs');",
      '',
      'module.exports = {',
      '  runTool() {',
      "    return shared.ok('timer-calc');",
      '  }',
      '};',
      ''
    ].join('\n')
  );

  writeText(
    path.join(rootDir, 'adapters', 'routes', 'pwm-calc.cjs'),
    [
      "'use strict';",
      '',
      "const shared = require('../core/shared.cjs');",
      '',
      'module.exports = {',
      '  runTool() {',
      "    return shared.ok('pwm-calc');",
      '  }',
      '};',
      ''
    ].join('\n')
  );

  writeJson(path.join(rootDir, 'extensions', 'tools', 'families', 'scmcu-sc8f0xx.json'), {
    name: 'scmcu-sc8f0xx',
    vendor: 'SCMCU',
    series: 'SC8F0xx',
    description: 'SCMCU family.',
    supported_tools: ['timer-calc'],
    source_refs: ['mcu/scmcu-sc8f072'],
    component_refs: [],
    bindings: {},
    notes: []
  });

  writeJson(path.join(rootDir, 'extensions', 'tools', 'families', 'padauk-pms15b-150g.json'), {
    name: 'padauk-pms15b-150g',
    vendor: 'Padauk',
    series: 'PMS15B/PMS150G',
    description: 'Padauk family.',
    supported_tools: ['pwm-calc'],
    source_refs: ['mcu/padauk-pms150g'],
    component_refs: [],
    bindings: {},
    notes: []
  });

  writeJson(path.join(rootDir, 'extensions', 'tools', 'devices', 'sc8f072.json'), {
    name: 'sc8f072',
    family: 'scmcu-sc8f0xx',
    description: 'SC8F072 device.',
    supported_tools: ['timer-calc'],
    source_refs: ['mcu/scmcu-sc8f072-registers'],
    component_refs: [],
    bindings: {
      'timer-calc': {
        algorithm: 'scmcu-timer',
        params: {
          chip: 'sc8f072'
        }
      }
    },
    notes: []
  });

  writeJson(path.join(rootDir, 'extensions', 'tools', 'devices', 'pms150g.json'), {
    name: 'pms150g',
    family: 'padauk-pms15b-150g',
    description: 'PMS150G device.',
    supported_tools: ['pwm-calc'],
    source_refs: ['mcu/padauk-pms150g-registers'],
    component_refs: [],
    bindings: {
      'pwm-calc': {
        algorithm: 'padauk-tm2-pwm',
        params: {
          chip: 'pms150g'
        }
      }
    },
    notes: []
  });

  writeJson(path.join(rootDir, 'extensions', 'chips', 'profiles', 'sc8f072.json'), {
    name: 'sc8f072',
    vendor: 'SCMCU',
    family: 'scmcu-sc8f0xx',
    description: 'SC8F072 chip.',
    package: 'sop8',
    runtime_model: 'main_loop_plus_isr',
    source_refs: ['mcu/scmcu-sc8f072', 'mcu/scmcu-sc8f072-registers'],
    component_refs: [],
    summary: {},
    capabilities: ['tmr0'],
    related_tools: ['timer-calc'],
    notes: []
  });

  writeJson(path.join(rootDir, 'extensions', 'chips', 'profiles', 'pms150g.json'), {
    name: 'pms150g',
    vendor: 'Padauk',
    family: 'padauk-pms15b-150g',
    description: 'PMS150G chip.',
    package: 'sop8',
    runtime_model: 'main_loop_plus_isr',
    source_refs: ['mcu/padauk-pms150g', 'mcu/padauk-pms150g-registers'],
    component_refs: [],
    summary: {},
    capabilities: ['tm2-pwm'],
    related_tools: ['pwm-calc'],
    notes: []
  });

  writeText(path.join(rootDir, 'docs', 'sources', 'mcu', 'scmcu-sc8f072.md'), '# SC8F072 summary\n');
  writeText(path.join(rootDir, 'docs', 'sources', 'mcu', 'scmcu-sc8f072-registers.md'), '# SC8F072 registers\n');
  writeText(path.join(rootDir, 'docs', 'sources', 'mcu', 'padauk-pms150g.md'), '# PMS150G summary\n');
  writeText(path.join(rootDir, 'docs', 'sources', 'mcu', 'padauk-pms150g-registers.md'), '# PMS150G registers\n');
}

test('adapter source add and sync install project adapters from path source', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-path-project-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-path-source-'));
  const currentCwd = process.cwd();

  try {
    createPathAdapterSource(tempSource);
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

    const addResult = JSON.parse(
      await captureStdout(() =>
        cli.main([
          'support',
          'source',
          'add',
          'vendor-pack',
          '--type',
          'path',
          '--location',
          tempSource
        ])
      )
    );

    assert.equal(addResult.action, 'added');
    assert.equal(addResult.source.name, 'vendor-pack');
    assert.equal(addResult.source.type, 'path');

    const syncResult = JSON.parse(
      await captureStdout(() => cli.main(['support', 'sync', 'vendor-pack']))
    );

    assert.equal(syncResult.status, 'synced');
    assert.ok(syncResult.files.includes(path.join('adapters', 'routes', 'timer-calc.cjs')));
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters', 'routes', 'timer-calc.cjs')),
      true
    );

    const toolResult = cli.toolRuntime.runTool(runtimeRoot, 'timer-calc', [
      '--family',
      'vendor-family',
      '--device',
      'vendor-device'
    ]);
    assert.equal(toolResult.status, 'ok');
    assert.equal(toolResult.family, 'vendor-family');
    assert.equal(toolResult.device, 'vendor-device');

    assert.deepEqual(
      cli.toolCatalog.listFamilies(runtimeRoot).map(item => item.name),
      ['vendor-family']
    );
    assert.deepEqual(
      cli.toolCatalog.listDevices(runtimeRoot).map(item => item.name),
      ['vendor-device']
    );
    assert.deepEqual(
      cli.chipCatalog.listChips(runtimeRoot).map(item => item.name),
      ['vendor-chip']
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'profiles', 'vendor-chip.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'devices', 'vendor-chip.json')),
      false
    );

    const status = JSON.parse(
      await captureStdout(() => cli.main(['support', 'status', 'vendor-pack']))
    );
    assert.equal(status.targets.project.synced, true);
    assert.equal(status.targets.project.files_count, 5);
    assert.equal(status.quality.mode, 'selection-only');
    assert.deepEqual(status.quality.matched_tools, []);
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter bootstrap adds source and syncs matching project adapters in one step', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-bootstrap-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-bootstrap-source-'));
  const currentCwd = process.cwd();

  try {
    createPathAdapterSource(tempSource);
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      'mcu:\n  vendor: "VendorName"\n  model: "vendor-chip"\n  package: "sop8"\n',
      'utf8'
    );

    const bootstrap = JSON.parse(
      await captureStdout(() =>
        cli.main([
          'support',
          'bootstrap',
          'vendor-pack',
          '--type',
          'path',
          '--location',
          tempSource
        ])
      )
    );

    assert.equal(bootstrap.action, 'bootstrapped');
    assert.equal(bootstrap.source_action, 'added');
    assert.equal(bootstrap.source.name, 'vendor-pack');
    assert.equal(bootstrap.sync.status, 'synced');
    assert.equal(bootstrap.sync.selection.filtered, true);
    assert.deepEqual(bootstrap.sync.selection.matched.chips, ['vendor-chip']);
    assert.equal(bootstrap.sync.quality.mode, 'session-aware');
    assert.equal(bootstrap.sync.quality.primary.tool, 'timer-calc');
    assert.ok(!bootstrap.sync.quality.primary.executable);
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters', 'routes', 'timer-calc.cjs')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'profiles', 'vendor-chip.json')),
      true
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter bootstrap uses default adapter source overrides when no source args are provided', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-bootstrap-default-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-bootstrap-default-source-'));
  const currentCwd = process.cwd();
  const previousType = process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_TYPE;
  const previousLocation = process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_LOCATION;

  try {
    createPathAdapterSource(tempSource);
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      'mcu:\n  vendor: "VendorName"\n  model: "vendor-chip"\n  package: "sop8"\n',
      'utf8'
    );
    process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_TYPE = 'path';
    process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_LOCATION = tempSource;

    const bootstrap = JSON.parse(await captureStdout(() => cli.main(['support', 'bootstrap'])));

    assert.equal(bootstrap.action, 'bootstrapped');
    assert.equal(bootstrap.source_action, 'added');
    assert.equal(bootstrap.source.name, 'default-pack');
    assert.equal(bootstrap.source.type, 'path');
    assert.equal(bootstrap.source.location, tempSource);
    assert.equal(bootstrap.sync.status, 'synced');
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters', 'routes', 'timer-calc.cjs')),
      true
    );
  } finally {
    if (previousLocation === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_LOCATION;
    } else {
      process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_LOCATION = previousLocation;
    }
    if (previousType === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_TYPE;
    } else {
      process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_TYPE = previousType;
    }
    process.chdir(currentCwd);
  }
});

test('adapter status shows project-level quality overview', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-status-quality-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-status-quality-source-'));
  const currentCwd = process.cwd();

  try {
    createFilteredAdapterSource(tempSource);
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

    writeText(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['mcu:', '  vendor: "SCMCU"', '  model: "SC8F072"', '  package: "SOP8"', ''].join('\n')
    );

    await captureStdout(() =>
      cli.main([
        'support',
        'source',
        'add',
        'filtered-pack',
        '--type',
        'path',
        '--location',
        tempSource
      ])
    );
    await captureStdout(() => cli.main(['support', 'sync', 'filtered-pack']));

    const status = JSON.parse(
      await captureStdout(() => cli.main(['support', 'status']))
    );

    assert.equal(status.quality_overview.mode, 'session-aware');
    assert.equal(status.quality_overview.primary.tool, 'timer-calc');
    assert.equal(status.quality_overview.primary.executable, true);
    assert.equal(status.chip_support_sources.length, 1);
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter source sync supports git source and remove cleans project artifacts', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-git-project-'));
  const tempSourceRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-git-source-'));
  const currentCwd = process.cwd();

  try {
    createGitAdapterSource(tempSourceRepo);
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

    await captureStdout(() =>
      cli.main([
        'support',
        'source',
        'add',
        'git-pack',
        '--type',
        'git',
        '--location',
        tempSourceRepo
      ])
    );

    const syncResult = JSON.parse(
      await captureStdout(() => cli.main(['support', 'sync', 'git-pack']))
    );

    assert.equal(syncResult.status, 'synced');
    assert.ok(syncResult.source_root.endsWith(path.join('repo', 'emb-agent')));
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters', 'routes', 'pwm-calc.cjs')),
      true
    );

    const toolResult = cli.toolRuntime.runTool(runtimeRoot, 'pwm-calc', [
      '--family',
      'git-family',
      '--target-duty',
      '50'
    ]);
    assert.equal(toolResult.status, 'ok');
    assert.equal(toolResult.duty, '50');

    const removeResult = JSON.parse(
      await captureStdout(() => cli.main(['support', 'source', 'remove', 'git-pack']))
    );

    assert.equal(removeResult.action, 'removed');
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters', 'routes', 'pwm-calc.cjs')),
      false
    );
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'registry.json'), 'utf8')
      ),
      {
        specs: [],
        families: [],
        devices: []
      }
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter sync auto-filters files by project hardware identity', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-filter-project-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-filter-source-'));
  const currentCwd = process.cwd();

  try {
    createFilteredAdapterSource(tempSource);
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

    writeText(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['mcu:', '  vendor: "SCMCU"', '  model: "SC8F072"', '  package: "SOP8"', ''].join('\n')
    );

    await captureStdout(() =>
      cli.main([
        'support',
        'source',
        'add',
        'filtered-pack',
        '--type',
        'path',
        '--location',
        tempSource
      ])
    );

    const syncResult = JSON.parse(
      await captureStdout(() => cli.main(['support', 'sync', 'filtered-pack']))
    );

    assert.equal(syncResult.selection.filtered, true);
    assert.equal(syncResult.selection.inferred_from_project, true);
    assert.deepEqual(syncResult.selection.matched.chips, ['sc8f072']);
    assert.deepEqual(syncResult.selection.matched.tools, ['timer-calc']);
    assert.equal(syncResult.quality.mode, 'session-aware');
    assert.equal(syncResult.quality.primary.tool, 'timer-calc');
    assert.equal(syncResult.quality.primary.executable, true);
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters', 'routes', 'timer-calc.cjs')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters', 'routes', 'pwm-calc.cjs')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'sc8f072.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'pms150g.json')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'profiles', 'sc8f072.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'docs', 'sources', 'mcu', 'scmcu-sc8f072-registers.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'docs', 'sources', 'mcu', 'padauk-pms150g-registers.md')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'profiles', 'pms150g.json')),
      false
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter sync supports explicit chip and tool filters', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-explicit-project-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-explicit-source-'));
  const currentCwd = process.cwd();

  try {
    createFilteredAdapterSource(tempSource);
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

    await captureStdout(() =>
      cli.main([
        'support',
        'source',
        'add',
        'filtered-pack',
        '--type',
        'path',
        '--location',
        tempSource
      ])
    );

    const syncResult = JSON.parse(
      await captureStdout(() =>
        cli.main([
          'support',
          'sync',
          'filtered-pack',
          '--chip',
          'pms150g',
          '--tool',
          'pwm-calc',
          '--no-match-project'
        ])
      )
    );

    assert.equal(syncResult.selection.filtered, true);
    assert.equal(syncResult.selection.inferred_from_project, false);
    assert.deepEqual(syncResult.selection.matched.chips, ['pms150g']);
    assert.deepEqual(syncResult.selection.matched.tools, ['pwm-calc']);
    assert.equal(syncResult.quality.mode, 'selection-only');
    assert.deepEqual(syncResult.quality.matched_tools, ['pwm-calc']);
    assert.equal(syncResult.quality.next_action, 'fill-hw-or-run-sync-with-project-match');
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters', 'routes', 'pwm-calc.cjs')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters', 'routes', 'timer-calc.cjs')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'pms150g.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'sc8f072.json')),
      false
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter sync keeps git source checkout scoped to matching chip files', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-git-filter-project-'));
  const tempSourceRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-adapter-git-filter-source-'));
  const currentCwd = process.cwd();

  try {
    createFilteredGitAdapterSource(tempSourceRepo);
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

    writeText(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['mcu:', '  vendor: "SCMCU"', '  model: "SC8F072"', '  package: "SOP8"', ''].join('\n')
    );

    await captureStdout(() =>
      cli.main([
        'support',
        'source',
        'add',
        'git-filtered-pack',
        '--type',
        'git',
        '--location',
        tempSourceRepo
      ])
    );

    const syncResult = JSON.parse(
      await captureStdout(() => cli.main(['support', 'sync', 'git-filtered-pack']))
    );

    const cachedLayoutRoot = path.join(
      tempProject,
      '.emb-agent',
      'cache',
      'adapter-sources',
      'git-filtered-pack',
      'repo'
    );

    assert.equal(syncResult.selection.filtered, true);
    assert.deepEqual(syncResult.selection.matched.chips, ['sc8f072']);
    assert.equal(
      fs.existsSync(path.join(cachedLayoutRoot, 'extensions', 'chips', 'profiles', 'sc8f072.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(cachedLayoutRoot, 'extensions', 'chips', 'profiles', 'pms150g.json')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(cachedLayoutRoot, 'adapters', 'routes', 'timer-calc.cjs')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(cachedLayoutRoot, 'adapters', 'routes', 'pwm-calc.cjs')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(cachedLayoutRoot, 'adapters', 'algorithms', 'scmcu-timer.cjs')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(cachedLayoutRoot, 'adapters', 'algorithms', 'padauk-tm2-pwm.cjs')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(cachedLayoutRoot, 'docs', 'sources', 'mcu', 'scmcu-sc8f072-registers.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(cachedLayoutRoot, 'docs', 'sources', 'mcu', 'padauk-pms150g-registers.md')),
      false
    );
  } finally {
    process.chdir(currentCwd);
  }
});
