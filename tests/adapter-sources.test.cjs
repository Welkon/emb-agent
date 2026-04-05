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
      "      implementation: 'external-adapter',",
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
      "      implementation: 'external-adapter',",
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
          'adapter',
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
      await captureStdout(() => cli.main(['adapter', 'sync', 'vendor-pack']))
    );

    assert.equal(syncResult.status, 'synced');
    assert.ok(syncResult.files.includes(path.join('adapters', 'routes', 'timer-calc.cjs')));
    assert.equal(
      fs.existsSync(path.join(tempProject, 'emb-agent', 'adapters', 'routes', 'timer-calc.cjs')),
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

    const status = JSON.parse(
      await captureStdout(() => cli.main(['adapter', 'status', 'vendor-pack']))
    );
    assert.equal(status.targets.project.synced, true);
    assert.equal(status.targets.project.files_count, 5);
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
        'adapter',
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
      await captureStdout(() => cli.main(['adapter', 'sync', 'git-pack']))
    );

    assert.equal(syncResult.status, 'synced');
    assert.ok(syncResult.source_root.endsWith(path.join('repo', 'emb-agent')));
    assert.equal(
      fs.existsSync(path.join(tempProject, 'emb-agent', 'adapters', 'routes', 'pwm-calc.cjs')),
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
      await captureStdout(() => cli.main(['adapter', 'source', 'remove', 'git-pack']))
    );

    assert.equal(removeResult.action, 'removed');
    assert.equal(
      fs.existsSync(path.join(tempProject, 'emb-agent', 'adapters', 'routes', 'pwm-calc.cjs')),
      false
    );
    assert.deepEqual(
      JSON.parse(
        fs.readFileSync(path.join(tempProject, 'emb-agent', 'extensions', 'tools', 'registry.json'), 'utf8')
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
