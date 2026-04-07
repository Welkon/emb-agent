'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, JSON.stringify(value, null, 2) + '\n');
}

function createHealthAdapterSource(rootDir) {
  writeText(
    path.join(rootDir, 'adapters', 'core', 'shared.cjs'),
    "'use strict';\nmodule.exports = {};\n"
  );

  writeText(
    path.join(rootDir, 'adapters', 'algorithms', 'scmcu-timer.cjs'),
    "'use strict';\nmodule.exports = { name: 'scmcu-timer' };\n"
  );

  writeText(
    path.join(rootDir, 'adapters', 'routes', 'timer-calc.cjs'),
    [
      "'use strict';",
      '',
      'module.exports = {',
      '  runTool() {',
      "    return { status: 'ok' };",
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
    bindings: {},
    notes: []
  });

  writeJson(path.join(rootDir, 'extensions', 'tools', 'devices', 'sc8f072.json'), {
    name: 'sc8f072',
    family: 'scmcu-sc8f0xx',
    description: 'SC8F072 device.',
    supported_tools: ['timer-calc'],
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

  writeJson(path.join(rootDir, 'extensions', 'chips', 'profiles', 'sc8f072.json'), {
    name: 'sc8f072',
    vendor: 'SCMCU',
    family: 'scmcu-sc8f0xx',
    description: 'SC8F072 chip.',
    package: 'sop8',
    runtime_model: 'main_loop_plus_isr',
    summary: {},
    capabilities: ['tmr0'],
    related_tools: ['timer-calc'],
    notes: []
  });
}

test('manager view aggregates next handoff settings threads and reports', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['settings', 'set', 'profile', 'rtos-iot']);
    cli.main(['thread', 'add', 'Track OTA rollback issue']);
    cli.main(['pause', 'resume ota rollback']);
    cli.main(['forensics', 'why ota flow keeps drifting']);
    cli.main(['session-report', 'capture ota status']);

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.equal(manager.mode, 'manager-lite');
    assert.equal(manager.session.profile, 'rtos-iot');
    assert.equal(typeof manager.health.status, 'string');
    assert.equal(manager.handoff.next_action, 'resume ota rollback');
    assert.equal(manager.threads.open, 2);
    assert.match(manager.session.active_thread.title, /Forensics:/);
    assert.ok(manager.reports.forensics.length >= 1);
    assert.ok(manager.reports.sessions.length >= 1);
    assert.equal(manager.diagnostics.latest_forensics.highest_severity, 'high');
    assert.ok(manager.recommended_actions.some(item => item.type === 'resume'));
    assert.ok(manager.recommended_actions.some(item => item.type === 'session-report'));
    const nextIndex = manager.recommended_actions.findIndex(item => item.type === 'next');
    const threadIndex = manager.recommended_actions.findIndex(item => item.type === 'thread');
    assert.ok(threadIndex >= 0);
    assert.ok(nextIndex >= 0);
    assert.ok(threadIndex < nextIndex);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('manager recommends workspace refresh when active workspace has not been refreshed yet', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-workspace-refresh-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['workspace', 'add', 'Power lane', '--type', 'board']);
    await cli.main(['workspace', 'activate', 'power-lane']);
    await cli.main(['thread', 'add', 'Track power sequencing']);
    const threadsDir = path.join(tempProject, '.emb-agent', 'threads');
    const threadName = fs.readdirSync(threadsDir).find(name => name.endsWith('.md')).replace(/\.md$/, '');
    await cli.main(['thread', 'resume', threadName]);

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    await cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.equal(manager.workspace.name, 'power-lane');
    assert.equal(manager.workspace.refresh_recommendation.recommended, true);
    assert.ok(manager.workspace.refresh_recommendation.reasons.some(item => item.includes('workspace 还没有执行过 refresh')));
    const refreshIndex = manager.recommended_actions.findIndex(item => item.type === 'workspace-refresh');
    const workspaceIndex = manager.recommended_actions.findIndex(item => item.type === 'workspace');
    const nextIndex = manager.recommended_actions.findIndex(item => item.type === 'next');
    assert.ok(refreshIndex >= 0);
    assert.ok(workspaceIndex >= 0);
    assert.ok(nextIndex >= 0);
    assert.ok(refreshIndex < workspaceIndex);
    assert.ok(refreshIndex < nextIndex);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('manager surfaces health next commands before generic next action', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-health-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.ok(Array.isArray(manager.health.next_commands));
    assert.ok(manager.health.next_commands.some(item => item.cli.includes('adapter source add default-pack')));
    assert.equal(manager.health.quickstart.stage, 'fill-hardware-identity');
    const healthIndex = manager.recommended_actions.findIndex(
      item => item.type === 'health' && item.cli.includes('adapter source add default-pack')
    );
    const nextIndex = manager.recommended_actions.findIndex(item => item.type === 'next');
    assert.ok(healthIndex >= 0);
    assert.ok(nextIndex >= 0);
    assert.ok(healthIndex < nextIndex);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('manager surfaces quickstart action before next when bootstrap path is ready', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-quickstart-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      'mcu:\n  vendor: "SCMCU"\n  model: "SC8F072"\n  package: "SOP8"\n',
      'utf8'
    );

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.equal(manager.health.quickstart.stage, 'bootstrap-then-next');
    assert.ok(manager.health.quickstart.steps[0].cli.includes('adapter bootstrap'));
    const quickstartIndex = manager.recommended_actions.findIndex(item => item.type === 'quickstart');
    const nextIndex = manager.recommended_actions.findIndex(item => item.type === 'next');
    assert.ok(quickstartIndex >= 0);
    assert.ok(nextIndex >= 0);
    assert.ok(quickstartIndex < nextIndex);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('manager view surfaces tool execution before generic next action when ready', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-tool-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const projectEmbDir = path.join(tempProject, '.emb-agent');
  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init', '--mcu', 'vendor-chip']);
    cli.main(['question', 'add', 'tm2 prescaler 和 pwm 公式怎么算']);

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
            params: {
              default_timer: 'tm16',
              default_clock_source: 'sysclk',
              prescalers: [1, 4, 16],
              interrupt_bits: [8, 9]
            }
          }
        },
        notes: []
      }, null, 2) + '\n',
      'utf8'
    );

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.equal(manager.next.command, 'scan');
    assert.equal(manager.tool_execution.tool, 'timer-calc');
    assert.equal(manager.tool_execution.status, 'ready');
    const toolIndex = manager.recommended_actions.findIndex(item => item.type === 'tool');
    const nextIndex = manager.recommended_actions.findIndex(item => item.type === 'next');
    assert.ok(toolIndex >= 0);
    assert.ok(nextIndex >= 0);
    assert.ok(toolIndex < nextIndex);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('manager prioritizes doc-apply quickstart before next when parsed docs are pending apply', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-doc-quickstart-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-manager-doc',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.equal(manager.health.quickstart.stage, 'doc-apply-then-next');
    assert.ok(manager.health.quickstart.steps[0].cli.includes('ingest apply doc'));
    const quickstartIndex = manager.recommended_actions.findIndex(item => item.type === 'quickstart');
    const nextIndex = manager.recommended_actions.findIndex(item => item.type === 'next');
    assert.ok(quickstartIndex >= 0);
    assert.ok(nextIndex >= 0);
    assert.ok(quickstartIndex < nextIndex);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('manager prioritizes derive quickstart when adapters are synced but doc-backed chip still has no match', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-derive-quickstart-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-manager-derive-source-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    createHealthAdapterSource(tempSource);
    process.chdir(tempProject);
    cli.main(['init']);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-manager-derive-doc',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PWM output supported\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );
    await cli.runIngestCommand('apply', ['doc', ingested.doc_id, '--to', 'hardware']);
    cli.main(['adapter', 'source', 'add', 'default-pack', '--type', 'path', '--location', tempSource]);
    cli.main(['adapter', 'sync', 'default-pack']);

    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['manager']);
    const manager = JSON.parse(stdout);

    assert.equal(manager.health.quickstart.stage, 'derive-then-next');
    assert.ok(manager.health.quickstart.steps[0].cli.includes(`adapter derive --from-project --from-doc ${ingested.doc_id}`));
    const quickstartIndex = manager.recommended_actions.findIndex(item => item.type === 'quickstart');
    const nextIndex = manager.recommended_actions.findIndex(item => item.type === 'next');
    assert.ok(quickstartIndex >= 0);
    assert.ok(nextIndex >= 0);
    assert.ok(quickstartIndex < nextIndex);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
