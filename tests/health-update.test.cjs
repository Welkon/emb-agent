'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const sessionStartHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-session-start.js'));

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

test('health reports warn for incomplete hardware identity and fail for missing truth files', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    stdout = '';
    cli.main(['health']);
    let report = JSON.parse(stdout);

    assert.equal(report.command, 'health');
    assert.equal(report.status, 'warn');
    assert.ok(report.checks.some(item => item.key === 'project_config_valid' && item.status === 'pass'));
    assert.ok(report.checks.some(item => item.key === 'hardware_identity' && item.status === 'warn'));
    assert.ok(Array.isArray(report.next_commands));
    assert.ok(report.next_commands.some(item => item.cli.includes('adapter source add default-pack')));
    assert.equal(report.quickstart.stage, 'fill-hardware-identity');
    assert.ok(report.quickstart.followup.includes('adapter bootstrap'));
    assert.equal(cli.loadSession().last_command, 'health');

    stdout = '';
    fs.rmSync(path.join(tempProject, '.emb-agent', 'req.yaml'), { force: true });
    cli.main(['health']);
    report = JSON.parse(stdout);

    assert.equal(report.status, 'fail');
    assert.ok(report.checks.some(item => item.key === 'req_truth' && item.status === 'fail'));
    assert.ok(report.recommendations.some(item => item.includes('req.yaml')));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('update reports stale install and cached newer version', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-update-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const cachePath = sessionStartHook.getUpdateCachePath();
  const previousSkip = process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
  const previousHookVersion = process.env.EMB_AGENT_FORCE_HOOK_VERSION;
  let stdout = '';

  try {
    process.env.EMB_AGENT_SKIP_UPDATE_CHECK = '1';
    process.env.EMB_AGENT_FORCE_HOOK_VERSION = '0.0.1';
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify(
        {
          installed: '0.2.0',
          latest: '0.3.0',
          checked_at: Date.now(),
          update_available: true,
          status: 'ok'
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    stdout = '';
    cli.main(['update']);
    const report = JSON.parse(stdout);

    assert.equal(report.command, 'update');
    assert.equal(report.installed_version, '0.2.0');
    assert.equal(report.cache.latest, '0.3.0');
    assert.equal(report.cache.update_available, true);
    assert.equal(report.stale_install.installed, '0.2.0');
    assert.equal(report.stale_install.hook, '0.0.1');
    assert.equal(report.check.triggered, false);
    assert.equal(report.check.reason, 'skip-env');
    assert.ok(report.recommendations.some(item => item.includes('hooks / runtime / agents')));
    assert.equal(cli.loadSession().last_command, 'update');
  } finally {
    if (fs.existsSync(cachePath)) {
      fs.rmSync(cachePath, { force: true });
    }
    if (previousSkip === undefined) {
      delete process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
    } else {
      process.env.EMB_AGENT_SKIP_UPDATE_CHECK = previousSkip;
    }
    if (previousHookVersion === undefined) {
      delete process.env.EMB_AGENT_FORCE_HOOK_VERSION;
    } else {
      process.env.EMB_AGENT_FORCE_HOOK_VERSION = previousHookVersion;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('health reports adapter registration and sync readiness', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-adapter-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-adapter-source-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    createHealthAdapterSource(tempSource);
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      'mcu:\n  vendor: "SCMCU"\n  model: "SC8F072"\n  package: "SOP8"\n',
      'utf8'
    );

    stdout = '';
    cli.main(['health']);
    let report = JSON.parse(stdout);
    assert.equal(report.checks.find(item => item.key === 'adapter_sources_registered').status, 'warn');
    assert.equal(report.checks.find(item => item.key === 'adapter_sync_project').status, 'info');
    assert.ok(report.next_commands.some(item => item.cli.includes('adapter bootstrap')));
    assert.equal(report.quickstart.stage, 'bootstrap-then-next');
    assert.ok(report.quickstart.steps[0].cli.includes('adapter bootstrap'));
    assert.ok(report.quickstart.steps[1].cli.endsWith(' next'));

    stdout = '';
    cli.main(['adapter', 'source', 'add', 'default-pack', '--type', 'path', '--location', tempSource]);

    stdout = '';
    cli.main(['health']);
    report = JSON.parse(stdout);
    assert.equal(report.checks.find(item => item.key === 'adapter_sources_registered').status, 'pass');
    assert.equal(report.checks.find(item => item.key === 'adapter_sync_project').status, 'warn');
    assert.ok(report.next_commands.some(item => item.cli.includes('adapter bootstrap default-pack')));

    stdout = '';
    cli.main(['adapter', 'sync', 'default-pack']);

    stdout = '';
    cli.main(['health']);
    report = JSON.parse(stdout);
    assert.equal(report.checks.find(item => item.key === 'adapter_sync_project').status, 'pass');
    assert.equal(report.checks.find(item => item.key === 'adapter_match').status, 'pass');
    assert.equal(report.checks.find(item => item.key === 'adapter_quality').status, 'pass');
    assert.equal(report.checks.find(item => item.key === 'binding_quality').status, 'pass');
    assert.equal(report.checks.find(item => item.key === 'register_summary_available').status, 'warn');
    assert.equal(report.adapter_health.primary.tool, 'timer-calc');
    assert.equal(report.adapter_health.primary.grade, 'usable');
    assert.equal(report.adapter_health.primary.executable, true);
    assert.ok(report.recommendations.every(item => !item.includes('adapter sync default-pack')));
    assert.ok(report.next_commands.some(item => item.cli.includes('tool run timer-calc')));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('health surfaces pending doc apply as quickstart before generic next', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-doc-apply-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-health-doc',
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

    stdout = '';
    cli.main(['health']);
    const report = JSON.parse(stdout);

    assert.equal(report.checks.find(item => item.key === 'doc_apply_backlog').status, 'warn');
    assert.ok(report.next_commands.some(item => item.key === 'doc-apply'));
    assert.equal(report.quickstart.stage, 'doc-apply-then-next');
    assert.ok(report.quickstart.steps[0].cli.includes('ingest apply doc'));
    assert.ok(report.quickstart.steps[1].cli.endsWith(' next'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('health routes from applied hardware doc to adapter derive when synced adapters still miss the chip', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-derive-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-derive-source-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    createHealthAdapterSource(tempSource);
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-health-derive-doc',
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

    stdout = '';
    cli.main(['health']);
    const report = JSON.parse(stdout);

    assert.equal(report.checks.find(item => item.key === 'adapter_match').status, 'warn');
    assert.equal(report.checks.find(item => item.key === 'adapter_derive_candidate').status, 'warn');
    assert.ok(report.next_commands.some(item => item.key === 'adapter-derive-from-doc'));
    assert.ok(report.next_commands.some(item => item.cli.includes(`adapter derive --from-project --from-doc ${ingested.doc_id}`)));
    assert.equal(report.quickstart.stage, 'derive-then-next');
    assert.ok(report.quickstart.steps[0].cli.includes(`adapter derive --from-project --from-doc ${ingested.doc_id}`));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
