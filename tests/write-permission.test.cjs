'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));

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

async function captureJson(args) {
  return JSON.parse(await captureStdout(() => cli.main(args)));
}

function updateProjectConfig(projectRoot, mutator) {
  const configPath = path.join(projectRoot, '.emb-agent', 'project.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  mutator(config);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, JSON.stringify(value, null, 2) + '\n');
}

function createPathAdapterSource(rootDir) {
  writeText(
    path.join(rootDir, 'chip-support', 'core', 'shared.cjs'),
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
    path.join(rootDir, 'chip-support', 'routes', 'timer-calc.cjs'),
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

test('project set honors write deny rules before mutating config', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-project-set-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.deny = ['project-set'];
    });

    const blocked = JSON.parse(await captureStdout(() => cli.main([
      'project',
      'set',
      '--field',
      'quality_gates.required_signoffs',
      '--value',
      JSON.stringify(['board-bench'])
    ])));

    assert.equal(blocked.status, 'permission-denied');
    assert.equal(blocked.permission_decision.decision, 'deny');
    assert.equal(blocked.permission_decision.reason_code, 'policy-deny');
    assert.equal(blocked.permission_decision.category, 'project-policy');
    assert.equal(blocked.permission_decision.severity, 'high');
    assert.match(blocked.permission_decision.operator_guidance, /project policy/i);
    assert.ok(blocked.permission_decision.remediation.length > 0);
    assert.ok(blocked.permission_decision.prechecks.length > 0);
    assert.ok(Array.isArray(blocked.permission_gates));
    assert.equal(blocked.permission_gates[0].kind, 'permission-rule');
    assert.equal(blocked.permission_gates[0].state, 'blocked');
    assert.equal(blocked.runtime_events[0].type, 'permission-evaluated');
    assert.equal(blocked.runtime_events[0].status, 'blocked');

    const runtimeConfig = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
    const config = runtime.loadProjectConfig(tempProject, runtimeConfig);
    assert.deepEqual(config.quality_gates.required_signoffs, []);
  } finally {
    process.chdir(currentCwd);
  }
});

test('ingest apply doc honors write ask rules until explicit confirmation is provided', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-doc-apply-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-write-permission',
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

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['doc-apply-hardware'];
    });

    const blocked = await cli.runIngestCommand(
      'apply',
      ['doc', ingested.doc_id, '--to', 'hardware'],
      { providerImpls }
    );

    assert.equal(blocked.status, 'permission-pending');
    assert.equal(blocked.permission_decision.decision, 'ask');
    assert.equal(blocked.permission_decision.reason_code, 'policy-ask');
    assert.equal(blocked.permission_decision.category, 'truth-promotion');
    assert.equal(blocked.permission_decision.severity, 'normal');
    assert.ok(blocked.permission_decision.remediation.length > 0);
    assert.ok(blocked.permission_decision.prechecks.length > 0);
    assert.ok(Array.isArray(blocked.permission_gates));
    assert.ok(blocked.permission_gates.some(item => item.kind === 'permission-rule' && item.state === 'pending'));
    assert.equal(blocked.runtime_events[0].type, 'permission-evaluated');
    assert.equal(blocked.runtime_events[0].status, 'pending');

    const hwBefore = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');
    assert.match(hwBefore, /model: ""/);

    const allowed = await cli.runIngestCommand(
      'apply',
      ['doc', ingested.doc_id, '--confirm', '--to', 'hardware'],
      { providerImpls }
    );

    assert.equal(allowed.permission_decision.decision, 'allow');
    assert.equal(allowed.permission_decision.reason_code, 'explicit-confirmed');
    assert.equal(allowed.permission_decision.category, 'truth-promotion');
    assert.ok(allowed.runtime_events.some(item => item.type === 'permission-evaluated' && item.status === 'ok'));
    const hwAfter = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');
    assert.match(hwAfter, /model: "PMS150G"/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('verify confirm honors write ask rules before updating human signoffs', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-verify-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.quality_gates.required_signoffs = ['board-bench'];
      config.permissions.writes.ask = ['verify-confirm'];
    });

    const blocked = JSON.parse(await captureStdout(() => cli.main([
      'verify',
      'confirm',
      'board-bench',
      'engineer confirmed pwm output on board'
    ])));

    assert.equal(blocked.status, 'permission-pending');
    assert.equal(blocked.permission_decision.decision, 'ask');
    assert.equal(blocked.permission_decision.reason_code, 'policy-ask');
    assert.ok(Array.isArray(blocked.permission_gates));
    assert.ok(blocked.permission_gates.some(item => item.kind === 'permission-rule' && item.state === 'pending'));

    const beforeConfirm = cli.buildNextContext();
    assert.deepEqual(beforeConfirm.quality_gates.pending_signoffs, ['board-bench']);
    assert.equal(beforeConfirm.runtime_events[0].type, 'workflow-next');
    assert.equal(beforeConfirm.runtime_events[0].status, 'pending');

    const allowed = JSON.parse(await captureStdout(() => cli.main([
      'verify',
      'confirm',
      '--confirm',
      'board-bench',
      'engineer confirmed pwm output on board'
    ])));

    assert.equal(allowed.status, 'confirmed');
    assert.equal(allowed.permission_decision.decision, 'allow');
    assert.equal(allowed.permission_decision.reason_code, 'explicit-confirmed');
    assert.equal(allowed.permission_decision.category, 'human-signoff');
    assert.ok(allowed.runtime_events.some(item => item.type === 'permission-evaluated' && item.status === 'ok'));

    const afterConfirm = cli.buildNextContext();
    assert.deepEqual(afterConfirm.quality_gates.confirmed_signoffs, ['board-bench']);
    assert.equal(afterConfirm.runtime_events[0].type, 'workflow-next');
  } finally {
    process.chdir(currentCwd);
  }
});

test('bootstrap run surfaces permission ask and supports --confirm for gated adapter stages', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-bootstrap-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-bootstrap-source-'));
  const currentCwd = process.cwd();
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    createPathAdapterSource(tempSource);
    process.chdir(tempProject);
    await cli.main(['init']);

    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      'mcu:\n  vendor: "VendorName"\n  model: "vendor-chip"\n  package: "sop8"\n',
      'utf8'
    );

    await cli.main([
      'support',
      'source',
      'add',
      'default-pack',
      '--type',
      'path',
      '--location',
      tempSource
    ]);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['support-bootstrap-project'];
    });

    const blocked = await captureJson(['bootstrap', 'run']);
    assert.equal(blocked.executed, false);
    assert.equal(blocked.reason, 'permission-pending');
    assert.equal(blocked.stage.id, 'support-bootstrap');
    assert.equal(blocked.result.status, 'permission-pending');
    assert.equal(blocked.result.permission_decision.decision, 'ask');
    assert.equal(blocked.bootstrap_after.current_stage, 'support-bootstrap');

    const allowed = await captureJson(['bootstrap', 'run', '--confirm']);
    assert.equal(allowed.executed, true);
    assert.equal(allowed.stage.id, 'support-bootstrap');
    assert.equal(allowed.result.permission_decision.decision, 'allow');
    assert.equal(allowed.result.permission_decision.reason_code, 'explicit-confirmed');
    assert.equal(allowed.result.sync.status, 'synced');
    assert.equal(allowed.bootstrap_after.current_stage, 'next-step');
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    process.chdir(currentCwd);
  }
});

test('ingest hardware honors write ask rules until explicit confirmation is provided', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-ingest-hw-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['ingest-hardware'];
    });

    const hwPath = path.join(tempProject, '.emb-agent', 'hw.yaml');
    const before = fs.readFileSync(hwPath, 'utf8');

    const blocked = await cli.runIngestCommand('hardware', [
      '--mcu',
      'PMS150G',
      '--truth',
      'PA5 reserved for programming',
      '--constraint',
      'ISR must stay thin'
    ]);

    assert.equal(blocked.status, 'permission-pending');
    assert.equal(blocked.permission_decision.decision, 'ask');
    assert.equal(blocked.permission_decision.reason_code, 'policy-ask');
    assert.equal(fs.readFileSync(hwPath, 'utf8'), before);

    const allowed = await cli.runIngestCommand('hardware', [
      '--confirm',
      '--mcu',
      'PMS150G',
      '--truth',
      'PA5 reserved for programming',
      '--constraint',
      'ISR must stay thin'
    ]);

    assert.equal(allowed.permission_decision.decision, 'allow');
    assert.equal(allowed.permission_decision.reason_code, 'explicit-confirmed');
    const after = fs.readFileSync(hwPath, 'utf8');
    assert.match(after, /model: "PMS150G"/);
    assert.match(after, /PA5 reserved for programming/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('ingest requirements honors write deny rules before mutating req truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-ingest-req-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.deny = ['ingest-requirements'];
    });

    const reqPath = path.join(tempProject, '.emb-agent', 'req.yaml');
    const before = fs.readFileSync(reqPath, 'utf8');

    const blocked = await cli.runIngestCommand('requirements', [
      '--goal',
      'stabilize wakeup path',
      '--feature',
      'short press toggles relay'
    ]);

    assert.equal(blocked.status, 'permission-denied');
    assert.equal(blocked.permission_decision.decision, 'deny');
    assert.equal(blocked.permission_decision.reason_code, 'policy-deny');
    assert.equal(fs.readFileSync(reqPath, 'utf8'), before);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('task write commands honor write rules before mutating shared task state', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-task-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['task-add'];
    });

    const blockedCreate = await captureJson(['task', 'add', 'Implement TM2 PWM adapter']);
    assert.equal(blockedCreate.status, 'permission-pending');
    assert.equal(blockedCreate.permission_decision.decision, 'ask');
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'tasks', 'implement-tm2-pwm-adapter', 'task.json')),
      false
    );

    const created = await captureJson(['task', 'add', '--confirm', 'Implement TM2 PWM adapter']);
    assert.equal(created.permission_decision.decision, 'allow');
    const taskName = created.task.name;
    const taskDir = path.join(tempProject, '.emb-agent', 'tasks', taskName);
    assert.equal(fs.existsSync(path.join(taskDir, 'task.json')), true);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['task-activate'];
    });

    const blockedActivate = await captureJson(['task', 'activate', taskName]);
    assert.equal(blockedActivate.status, 'permission-pending');
    assert.equal(cli.loadSession().active_task.name, '');
    assert.equal(fs.readFileSync(path.join(tempProject, '.emb-agent', '.current-task'), 'utf8'), '');

    const activated = await captureJson(['task', 'activate', '--confirm', taskName]);
    assert.equal(activated.permission_decision.decision, 'allow');
    assert.equal(cli.loadSession().active_task.name, taskName);

    fs.mkdirSync(path.join(tempProject, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'src', 'timer.c'), 'void timer(void) {}\n', 'utf8');
    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['task-context-add'];
    });

    const implementPath = path.join(taskDir, 'implement.jsonl');
    const contextBefore = fs.readFileSync(implementPath, 'utf8');
    const blockedContext = await captureJson([
      'task',
      'context',
      'add',
      taskName,
      'implement',
      'src/timer.c',
      'TM2 implementation file'
    ]);
    assert.equal(blockedContext.status, 'permission-pending');
    assert.equal(fs.readFileSync(implementPath, 'utf8'), contextBefore);

    const allowedContext = await captureJson([
      'task',
      'context',
      'add',
      '--confirm',
      taskName,
      'implement',
      'src/timer.c',
      'TM2 implementation file'
    ]);
    assert.equal(allowedContext.permission_decision.decision, 'allow');
    assert.match(fs.readFileSync(implementPath, 'utf8'), /src\/timer\.c/);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['task-resolve'];
    });

    const manifestPath = path.join(taskDir, 'task.json');
    const blockedResolve = await captureJson(['task', 'resolve', taskName, 'adapter merged']);
    assert.equal(blockedResolve.status, 'permission-pending');
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).status, 'in_progress');

    const resolved = await captureJson([
      'task',
      'resolve',
      '--confirm',
      taskName,
      '--aar-new-pattern',
      'no',
      '--aar-new-trap',
      'no',
      '--aar-missing-rule',
      'no',
      '--aar-outdated-rule',
      'no',
      'adapter merged'
    ]);
    assert.equal(resolved.permission_decision.decision, 'allow');
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).status, 'completed');
  } finally {
    process.chdir(currentCwd);
  }
});

test('doc diff save-as honors write ask rules before saving named presets', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-doc-preset-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-preset-write-permission',
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

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['doc-diff-save-preset'];
    });

    const blocked = await captureJson([
      'doc',
      'diff',
      ingested.doc_id,
      '--to',
      'hardware',
      '--only',
      'constraints,sources',
      '--save-as',
      'hw-safe'
    ]);
    assert.equal(blocked.status, 'permission-pending');
    assert.equal(blocked.permission_decision.decision, 'ask');

    const indexPath = path.join(tempProject, '.emb-agent', 'cache', 'docs', 'index.json');
    const blockedIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.equal(
      blockedIndex.session.diff_presets && blockedIndex.session.diff_presets['hw-safe'],
      undefined
    );
    assert.deepEqual(blockedIndex.session.last_diff.only, ['constraints', 'sources']);

    const allowed = await captureJson([
      'doc',
      'diff',
      ingested.doc_id,
      '--confirm',
      '--to',
      'hardware',
      '--only',
      'constraints,sources',
      '--save-as',
      'hw-safe'
    ]);
    assert.equal(allowed.permission_decision.decision, 'allow');
    const allowedIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.deepEqual(allowedIndex.session.diff_presets['hw-safe'].only, ['constraints', 'sources']);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('adapter source add/remove and sync honor write rules before mutating shared adapter state', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-adapter-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-adapter-source-'));
  const currentCwd = process.cwd();

  try {
    createPathAdapterSource(tempSource);
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['support-source-add'];
    });

    const blockedAdd = await captureJson([
      'support',
      'source',
      'add',
      'vendor-pack',
      '--type',
      'path',
      '--location',
      tempSource
    ]);
    assert.equal(blockedAdd.status, 'permission-pending');
    const configPath = path.join(tempProject, '.emb-agent', 'project.json');
    let projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(projectConfig.chip_support_sources, []);

    const allowedAdd = await captureJson([
      'support',
      'source',
      'add',
      'vendor-pack',
      '--confirm',
      '--type',
      'path',
      '--location',
      tempSource
    ]);
    assert.equal(allowedAdd.permission_decision.decision, 'allow');
    projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(projectConfig.chip_support_sources[0].name, 'vendor-pack');

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['support-sync-project'];
    });

    const blockedSync = await captureJson(['support', 'sync', 'vendor-pack', '--no-match-project']);
    assert.equal(blockedSync.status, 'permission-pending');
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'timer-calc.cjs')),
      false
    );

    const allowedSync = await captureJson(['support', 'sync', 'vendor-pack', '--confirm', '--no-match-project']);
    assert.equal(allowedSync.permission_decision.decision, 'allow');
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'timer-calc.cjs')),
      true
    );

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['support-source-remove'];
    });

    const blockedRemove = await captureJson(['support', 'source', 'remove', 'vendor-pack']);
    assert.equal(blockedRemove.status, 'permission-pending');
    projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(projectConfig.chip_support_sources.length, 1);

    const allowedRemove = await captureJson(['support', 'source', 'remove', 'vendor-pack', '--confirm']);
    assert.equal(allowedRemove.permission_decision.decision, 'allow');
    projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(projectConfig.chip_support_sources.length, 0);
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter bootstrap honors write ask rules before adding source and syncing files', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-adapter-bootstrap-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-adapter-bootstrap-source-'));
  const currentCwd = process.cwd();

  try {
    createPathAdapterSource(tempSource);
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['support-bootstrap-project'];
    });

    const blocked = await captureJson([
      'support',
      'bootstrap',
      'vendor-pack',
      '--type',
      'path',
      '--location',
      tempSource
    ]);
    assert.equal(blocked.status, 'permission-pending');
    const configPath = path.join(tempProject, '.emb-agent', 'project.json');
    const projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(projectConfig.chip_support_sources, []);
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'timer-calc.cjs')),
      false
    );

    const allowed = await captureJson([
      'support',
      'bootstrap',
      'vendor-pack',
      '--confirm',
      '--type',
      'path',
      '--location',
      tempSource
    ]);
    assert.equal(allowed.permission_decision.decision, 'allow');
    assert.equal(allowed.source.name, 'vendor-pack');
    assert.equal(allowed.sync.status, 'skipped');
    assert.equal(allowed.sync.reason, 'missing-project-chip');
    assert.equal(allowed.sync.selection.skipped, true);
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'timer-calc.cjs')),
      false
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter derive and generate honor write rules before writing derived outputs', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-adapter-derive-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['support-derive-project'];
    });

    const blockedDerive = await captureJson([
      'support',
      'derive',
      '--family',
      'scmcu-sc8f0xx',
      '--device',
      'sc8f072',
      '--chip',
      'sc8f072ad608sp',
      '--tool',
      'timer-calc',
      '--vendor',
      'SCMCU',
      '--series',
      'SC8F072',
      '--package',
      'sop8',
      '--pin-count',
      '8'
    ]);
    assert.equal(blockedDerive.status, 'permission-pending');
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'registry.json')),
      false
    );

    const allowedDerive = await captureJson([
      'support',
      'derive',
      '--confirm',
      '--family',
      'scmcu-sc8f0xx',
      '--device',
      'sc8f072',
      '--chip',
      'sc8f072ad608sp',
      '--tool',
      'timer-calc',
      '--vendor',
      'SCMCU',
      '--series',
      'SC8F072',
      '--package',
      'sop8',
      '--pin-count',
      '8'
    ]);
    assert.equal(allowedDerive.permission_decision.decision, 'allow');
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'registry.json')),
      true
    );

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.deny = ['support-generate'];
    });

    const outputRoot = path.join(tempProject, 'generated-chip-support');
    const blockedGenerate = await captureJson([
      'support',
      'generate',
      '--family',
      'scmcu-sc8f0xx',
      '--device',
      'sc8f072',
      '--chip',
      'sc8f072ad608sp',
      '--tool',
      'timer-calc',
      '--vendor',
      'SCMCU',
      '--series',
      'SC8F072',
      '--package',
      'sop8',
      '--pin-count',
      '8',
      '--output-root',
      outputRoot
    ]);
    assert.equal(blockedGenerate.status, 'permission-denied');
    assert.equal(fs.existsSync(outputRoot), false);
  } finally {
    process.chdir(currentCwd);
  }
});

test('session-report honors write ask rules before writing report files', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-write-session-report-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['session-report-save'];
    });

    const blocked = await captureJson(['session-report', 'capture current bring-up handoff']);
    assert.equal(blocked.status, 'permission-pending');
    const reportDir = path.join(tempProject, '.emb-agent', 'reports', 'sessions');
    assert.equal(
      fs.existsSync(reportDir) ? fs.readdirSync(reportDir).filter(name => name.endsWith('.md')).length : 0,
      0
    );

    const allowed = await captureJson(['session-report', '--confirm', 'capture current bring-up handoff']);
    assert.equal(allowed.permission_decision.decision, 'allow');
    const reports = fs.readdirSync(reportDir).filter(name => name.endsWith('.md'));
    assert.equal(reports.length, 1);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
