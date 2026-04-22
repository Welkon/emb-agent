'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const installer = require(path.join(repoRoot, 'bin', 'install.js'));
const sessionStartHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-session-start.js'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const packageVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, JSON.stringify(value, null, 2) + '\n');
}

function createHealthAdapterSource(rootDir) {
  writeText(
    path.join(rootDir, 'chip-support', 'core', 'shared.cjs'),
    "'use strict';\nmodule.exports = {};\n"
  );

  writeText(
    path.join(rootDir, 'chip-support', 'algorithms', 'scmcu-timer.cjs'),
    "'use strict';\nmodule.exports = { name: 'scmcu-timer' };\n"
  );

  writeText(
    path.join(rootDir, 'chip-support', 'routes', 'timer-calc.cjs'),
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
  const originalBridgeCmd = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  let stdout = '';

  try {
    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = 'mock://ok';
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
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
    assert.equal(report.runtime_host, 'codex');
    assert.equal(report.status, 'warn');
    assert.ok(report.checks.some(item => item.key === 'project_config_valid' && item.status === 'pass'));
    assert.ok(report.checks.some(item => item.key === 'subagent_bridge' && item.status === 'pass'));
    assert.equal(report.subagent_bridge.mode, 'mock');
    assert.ok(report.checks.some(item => item.key === 'hardware_identity' && item.status === 'warn'));
    assert.ok(report.checks.some(item => item.key === 'szlcsc_integration' && item.status === 'pass'));
    assert.ok(Array.isArray(report.next_commands));
    assert.ok(report.next_commands.every(item => !item.cli.includes('support source add default-support')));
    assert.ok(report.next_commands.some(item => item.cli.endsWith(' next')));
    assert.equal(report.quickstart.stage, 'fill-hardware-identity');
    assert.equal(report.quickstart.display_stage, 'complete-project-facts');
    assert.match(report.quickstart.user_summary, /Hardware identity is incomplete/);
    assert.equal(report.action_card.action, 'Project facts required');
    assert.equal(report.action_card.stage, 'project-facts');
    assert.match(report.action_card.first_instruction, /Hardware identity is incomplete/);
    assert.ok(report.action_card.followup.includes('rerun:'));
    assert.equal(report.bootstrap.current_stage, 'hardware-truth');
    assert.equal(report.bootstrap.display_current_stage, 'project-facts');
    assert.equal(report.bootstrap.next_stage.status, 'manual');
    assert.equal(report.bootstrap.next_stage.display_status, 'needs-user-input');
    assert.equal(report.bootstrap.next_stage.display_id, 'project-facts');
    assert.equal(report.bootstrap.next_stage.action_summary, 'Project facts required');
    assert.ok(report.bootstrap.stages.some(item => item.id === 'init-project' && item.status === 'completed'));
    assert.ok(report.quickstart.followup.includes('rerun:'));
    assert.equal(cli.loadSession().last_command, 'health');

    stdout = '';
    fs.rmSync(path.join(tempProject, '.emb-agent', 'req.yaml'), { force: true });
    cli.main(['health']);
    report = JSON.parse(stdout);

    assert.equal(report.status, 'fail');
    assert.ok(report.checks.some(item => item.key === 'req_truth' && item.status === 'fail'));
    assert.ok(report.recommendations.some(item => item.includes('req.yaml')));
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    if (originalBridgeCmd === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = originalBridgeCmd;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('health reports fallback session state path when primary state storage is readonly', { concurrency: false }, () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-fallback-'));
  const fallbackStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-fallback-state-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousFallbackDir = process.env.EMB_AGENT_PROJECT_STATE_FALLBACK_DIR;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  const runtimeConfig = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
  const statePaths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), tempProject, runtimeConfig);
  const readonlyPrefix = `${path.resolve(statePaths.primaryStateDir)}${path.sep}`;
  const realMkdirSync = fs.mkdirSync;
  const realWriteFileSync = fs.writeFileSync;
  const realOpenSync = fs.openSync;
  let stdout = '';

  function isReadonlyPrimaryPath(filePath) {
    const normalized = path.resolve(String(filePath));
    return normalized === path.resolve(statePaths.primaryStateDir) || normalized.startsWith(readonlyPrefix);
  }

  try {
    process.env.EMB_AGENT_PROJECT_STATE_FALLBACK_DIR = fallbackStateDir;
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    const resolvedStatePaths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), tempProject, runtimeConfig);
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    fs.mkdirSync = function patchedMkdirSync(filePath, options) {
      if (isReadonlyPrimaryPath(filePath)) {
        const error = new Error('read-only primary state dir');
        error.code = 'EROFS';
        throw error;
      }
      return realMkdirSync.call(this, filePath, options);
    };
    fs.writeFileSync = function patchedWriteFileSync(filePath, data, options) {
      if (isReadonlyPrimaryPath(filePath)) {
        const error = new Error('read-only primary state dir');
        error.code = 'EROFS';
        throw error;
      }
      return realWriteFileSync.call(this, filePath, data, options);
    };
    fs.openSync = function patchedOpenSync(filePath, flags, mode) {
      if (isReadonlyPrimaryPath(filePath)) {
        const error = new Error('read-only primary state dir');
        error.code = 'EROFS';
        throw error;
      }
      return realOpenSync.call(this, filePath, flags, mode);
    };

    cli.main(['init']);
    stdout = '';
    cli.main(['health']);

    const report = JSON.parse(stdout);
    const sessionCheck = report.checks.find(item => item.key === 'session_state');

    assert.ok(sessionCheck);
    assert.equal(sessionCheck.status, 'pass');
    assert.ok(sessionCheck.evidence.includes('storage_mode=fallback'));
    assert.ok(sessionCheck.evidence.includes(resolvedStatePaths.fallbackSessionPath));
    assert.equal(fs.existsSync(resolvedStatePaths.fallbackSessionPath), true);
  } finally {
    fs.mkdirSync = realMkdirSync;
    fs.writeFileSync = realWriteFileSync;
    fs.openSync = realOpenSync;
    if (previousFallbackDir === undefined) {
      delete process.env.EMB_AGENT_PROJECT_STATE_FALLBACK_DIR;
    } else {
      process.env.EMB_AGENT_PROJECT_STATE_FALLBACK_DIR = previousFallbackDir;
    }
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('health warns when szlcsc integration is enabled without credentials', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-szlcsc-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const originalBridgeCmd = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  const previousSzlcscKey = process.env.SZLCSC_API_KEY;
  const previousSzlcscSecret = process.env.SZLCSC_API_SECRET;
  const previousLcscKey = process.env.LCSC_API_KEY;
  const previousLcscSecret = process.env.LCSC_API_SECRET;
  let stdout = '';

  try {
    delete process.env.SZLCSC_API_KEY;
    delete process.env.SZLCSC_API_SECRET;
    delete process.env.LCSC_API_KEY;
    delete process.env.LCSC_API_SECRET;
    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = 'mock://ok';
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    const projectConfigPath = path.join(tempProject, '.emb-agent', 'project.json');
    const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
    projectConfig.integrations.szlcsc.enabled = true;
    fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2) + '\n', 'utf8');

    stdout = '';
    cli.main(['health']);
    const report = JSON.parse(stdout);

    assert.ok(report.checks.some(item => item.key === 'szlcsc_integration' && item.status === 'warn'));
  } finally {
    if (previousSzlcscKey === undefined) {
      delete process.env.SZLCSC_API_KEY;
    } else {
      process.env.SZLCSC_API_KEY = previousSzlcscKey;
    }
    if (previousSzlcscSecret === undefined) {
      delete process.env.SZLCSC_API_SECRET;
    } else {
      process.env.SZLCSC_API_SECRET = previousSzlcscSecret;
    }
    if (previousLcscKey === undefined) {
      delete process.env.LCSC_API_KEY;
    } else {
      process.env.LCSC_API_KEY = previousLcscKey;
    }
    if (previousLcscSecret === undefined) {
      delete process.env.LCSC_API_SECRET;
    } else {
      process.env.LCSC_API_SECRET = previousLcscSecret;
    }
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    if (originalBridgeCmd === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = originalBridgeCmd;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('health uses configured default adapter source from environment', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-private-source-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const originalBridgeCmd = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  const previousLocation = process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_LOCATION;
  const previousBranch = process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_BRANCH;
  const previousSubdir = process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_SUBDIR;
  let stdout = '';

  try {
    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = 'mock://ok';
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_LOCATION = 'git@github.com:Welkon/emb-agent-adapters.git';
    process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_BRANCH = 'main';
    process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_SUBDIR = 'emb-agent';
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    stdout = '';
    cli.main(['health']);
    const report = JSON.parse(stdout);
    assert.ok(report.next_commands.every(item => !item.cli.includes('support source add default-support')));
    assert.ok(report.next_commands.some(item => item.cli.endsWith(' next')));
    assert.equal(report.quickstart.stage, 'fill-hardware-identity');
    assert.equal(report.action_card.stage, 'project-facts');
  } finally {
    if (previousSubdir === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_SUBDIR;
    } else {
      process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_SUBDIR = previousSubdir;
    }
    if (previousBranch === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_BRANCH;
    } else {
      process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_BRANCH = previousBranch;
    }
    if (previousLocation === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_LOCATION;
    } else {
      process.env.EMB_AGENT_DEFAULT_CHIP_SUPPORT_SOURCE_LOCATION = previousLocation;
    }
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    if (originalBridgeCmd === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = originalBridgeCmd;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('health and bootstrap expose host startup readiness as an explicit bootstrap boundary', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-trust-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousWorkspaceTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  let stdout = '';

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '0';
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);

    stdout = '';
    cli.main(['health']);
    let report = JSON.parse(stdout);

    assert.equal(report.startup_automation.status, 'action-needed');
    assert.equal(report.startup_automation.source, 'env');
    assert.equal(report.checks.find(item => item.key === 'startup_automation').status, 'warn');
    assert.equal(report.bootstrap.current_stage, 'startup-hooks');
    assert.equal(report.bootstrap.display_current_stage, 'host-readiness');
    assert.equal(report.bootstrap.next_stage.status, 'manual');
    assert.equal(report.bootstrap.next_stage.display_status, 'needs-user-input');
    assert.equal(report.bootstrap.next_stage.action_summary, 'Host action required');
    assert.equal(report.quickstart.stage, 'restart-host-hooks');
    assert.equal(report.quickstart.display_stage, 'restart-host-for-bootstrap');
    assert.match(report.quickstart.user_summary, /Startup hooks are not active/);
    assert.equal(report.action_card.action, 'Host action required');
    assert.equal(report.action_card.stage, 'host-readiness');
    assert.match(report.action_card.first_instruction, /Startup hooks are not active/);
    assert.ok(report.recommendations.some(item => item.includes('automatic startup')));

    stdout = '';
    await cli.main(['bootstrap']);
    report = JSON.parse(stdout);

    assert.equal(report.current_stage, 'startup-hooks');
    assert.equal(report.display_current_stage, 'host-readiness');
    assert.equal(report.action_card.action, 'Host action required');
    assert.equal(report.next_stage.id, 'startup-hooks');
    assert.equal(report.next_stage.display_id, 'host-readiness');
    assert.equal(report.next_stage.status, 'manual');
    assert.equal(report.next_stage.display_status, 'needs-user-input');
    assert.ok(report.stages.some(item => item.id === 'startup-hooks' && item.status === 'manual'));
  } finally {
    if (previousWorkspaceTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousWorkspaceTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('installed codex runtime uses enabled hooks config as authorization signal', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-hooks-home-'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-hooks-project-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousWorkspaceTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  let stdout = '';

  try {
    delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    process.chdir(repoRoot);
    await installer.main([
      '--codex',
      '--global',
      '--config-dir',
      tempHome,
      '--developer',
      'tester'
    ]);

    const installedCli = require(path.join(tempHome, 'emb-agent', 'bin', 'emb-agent.cjs'));

    process.chdir(tempProject);
    stdout = '';
    await installedCli.main(['init']);

    stdout = '';
    await installedCli.main(['health']);
    const report = JSON.parse(stdout);

    assert.equal(report.startup_automation.status, 'ready');
    assert.equal(report.startup_automation.source, 'host-config');
    assert.equal(report.startup_automation.signal, 'hooks-enabled');
    assert.equal(report.bootstrap.current_stage, 'hardware-truth');
    assert.equal(report.bootstrap.display_current_stage, 'project-facts');
    assert.equal(report.quickstart.stage, 'fill-hardware-identity');
    assert.equal(report.quickstart.display_stage, 'complete-project-facts');
    assert.ok(!report.bootstrap.stages.some(item => item.id === 'startup-hooks'));
    assert.ok(!report.recommendations.some(item => item.includes('automatic startup')));
  } finally {
    if (previousWorkspaceTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousWorkspaceTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('bootstrap run bypasses startup-hooks when host readiness is the only remaining blocker', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-bootstrap-run-bypass-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousWorkspaceTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  let stdout = '';

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '0';
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    await cli.main(['init']);
    await cli.main([
      'declare', 'hardware', '--confirm',
      '--mcu', 'PMB180B',
      '--package', 'esop8',
      '--signal', 'PWM_OUT',
      '--pin', 'PA3',
      '--dir', 'output',
      '--note', 'PA3 PWM demo',
      '--confirmed', 'true',
      '--peripheral', 'PWM',
      '--usage', '20kHz 50% output demo'
    ]);
    await cli.main([
      'support', 'bootstrap', 'local-pack',
      '--confirm',
      '--type', 'path',
      '--location', path.resolve(repoRoot, '..', 'emb-agent-adapters')
    ]);

    stdout = '';
    await cli.main(['bootstrap', 'run', '--confirm']);
    const report = JSON.parse(stdout);

    assert.equal(report.executed, true);
    assert.equal(report.stage.id, 'next-step');
    assert.equal(report.stage.bypassed_manual_stage.id, 'startup-hooks');
    assert.equal(report.result.resolved_action, 'scan');
  } finally {
    if (previousWorkspaceTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousWorkspaceTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('update reports stale install and cached newer version', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-update-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousSkip = process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
  const previousHookVersion = process.env.EMB_AGENT_FORCE_HOOK_VERSION;
  const previousCachePath = process.env.EMB_AGENT_UPDATE_CACHE_PATH;
  const cachePath = path.join(tempProject, '.cache', 'update-check.json');
  let stdout = '';

  try {
    process.env.EMB_AGENT_SKIP_UPDATE_CHECK = '1';
    process.env.EMB_AGENT_FORCE_HOOK_VERSION = '0.0.1';
    process.env.EMB_AGENT_UPDATE_CACHE_PATH = cachePath;
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
    assert.equal(report.installed_version, packageVersion);
    assert.equal(report.cache.latest, '0.3.0');
    assert.equal(report.cache.installed, '0.2.0');
    assert.equal(report.cache.update_available, true);
    assert.equal(report.stale_install.installed, packageVersion);
    assert.equal(report.stale_install.hook, '0.0.1');
    assert.equal(report.check.triggered, false);
    assert.equal(report.check.reason, 'skip-env');
    assert.ok(report.session_state);
    assert.equal(report.session_state.storage_mode, 'primary');
    assert.equal(report.session_state.session.exists, true);
    assert.ok(report.recommendations.some(item => item.includes('hooks / runtime / agents')));
    assert.equal(report.workflow_layout.registry_path, 'registry/workflow.json');
    assert.ok(Array.isArray(report.workflow_layout.reused));
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
    if (previousCachePath === undefined) {
      delete process.env.EMB_AGENT_UPDATE_CACHE_PATH;
    } else {
      process.env.EMB_AGENT_UPDATE_CACHE_PATH = previousCachePath;
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
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  let stdout = '';

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
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
    assert.equal(report.checks.find(item => item.key === 'chip_support_sources_registered').status, 'info');
    assert.equal(report.checks.find(item => item.key === 'chip_support_sync_project').status, 'info');
    assert.ok(report.next_commands.some(item => item.cli.includes('support derive --from-project')));
    assert.equal(report.quickstart.stage, 'derive-then-next');
    assert.equal(report.action_card.action, 'Ready to run');
    assert.equal(report.action_card.stage, 'chip-support-draft');
    assert.equal(report.action_card.first_instruction, '');
    assert.ok(report.action_card.first_cli.includes('support derive --from-project'));
    assert.ok(report.action_card.then_cli.endsWith(' next'));
    assert.equal(report.bootstrap.current_stage, 'support-derive');
    assert.ok(report.bootstrap.next_stage.cli.includes('support derive --from-project'));
    assert.ok(report.quickstart.steps[0].cli.includes('support derive --from-project'));
    assert.ok(report.quickstart.steps[1].cli.endsWith(' next'));

    stdout = '';
    await cli.main(['bootstrap']);
    let bootstrapView = JSON.parse(stdout);
    assert.equal(bootstrapView.command, 'bootstrap');
    assert.equal(bootstrapView.current_stage, 'support-derive');
    assert.ok(bootstrapView.stages.some(item => item.id === 'next-step'));

    stdout = '';
    await cli.main(['bootstrap', 'run']);
    let bootstrapRun = JSON.parse(stdout);
    assert.equal(bootstrapRun.executed, true);
    assert.equal(bootstrapRun.stage.id, 'support-derive');
    assert.equal(bootstrapRun.result.status, 'ok');

    stdout = '';
    cli.main(['health']);
    report = JSON.parse(stdout);
    assert.equal(report.checks.find(item => item.key === 'chip_support_sources_registered').status, 'info');
    assert.equal(report.checks.find(item => item.key === 'chip_support_sync_project').status, 'pass');
    assert.equal(report.checks.find(item => item.key === 'chip_support_match').status, 'pass');
    assert.equal(report.quickstart.stage, 'next');
    assert.equal(report.action_card.first_cli.endsWith(' next'), true);

    stdout = '';
    cli.main(['support', 'source', 'add', 'default-support', '--type', 'path', '--location', tempSource]);

    stdout = '';
    cli.main(['health']);
    report = JSON.parse(stdout);
    assert.equal(report.checks.find(item => item.key === 'chip_support_sources_registered').status, 'pass');
    assert.equal(report.checks.find(item => item.key === 'chip_support_sync_project').status, 'pass');
    assert.equal(report.checks.find(item => item.key === 'chip_support_match').status, 'pass');
    assert.ok(report.next_commands.every(item => !item.cli.includes('support bootstrap default-support')));
    assert.equal(report.quickstart.stage, 'next');
    assert.equal(report.checks.find(item => item.key === 'chip_support_quality').status, 'warn');
    assert.equal(report.checks.find(item => item.key === 'binding_quality').status, 'warn');
    assert.equal(report.checks.find(item => item.key === 'chip_support_reusability').status, 'info');
    assert.equal(report.checks.find(item => item.key === 'register_summary_available').status, 'warn');
    assert.equal(report.chip_support_health.primary.tool, 'timer-calc');
    assert.equal(report.chip_support_health.primary.grade, 'missing');
    assert.equal(report.chip_support_health.primary.executable, false);
    assert.equal(report.chip_support_health.reusability.status, 'project-only');
    assert.equal(report.chip_support_health.reusability.reusable, false);
    assert.match(report.quickstart.summary, /project-local/);
    assert.match(report.action_card.summary, /project-local/);
    assert.ok(report.recommendations.every(item => !item.includes('support sync default-support')));
    assert.ok(report.next_commands.some(item => item.cli.includes('tool run timer-calc')));
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('health surfaces pending doc apply as quickstart before generic next', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-doc-apply-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  let stdout = '';

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
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
    assert.equal(report.action_card.stage, 'apply-document-facts');
    assert.equal(report.action_card.action, 'Document apply required');
    assert.equal(report.action_card.first_instruction, '');
    assert.ok(report.action_card.first_cli.includes('ingest apply doc'));
    assert.equal(report.bootstrap.current_stage, 'doc-truth-sync');
    assert.ok(report.quickstart.steps[0].cli.includes('ingest apply doc'));
    assert.ok(report.quickstart.steps[1].cli.endsWith(' next'));

    stdout = '';
    await cli.main(['bootstrap', 'run']);
    const bootstrapRun = JSON.parse(stdout);
    assert.equal(bootstrapRun.executed, true);
    assert.equal(bootstrapRun.stage.id, 'doc-truth-sync');
    assert.equal(Boolean(bootstrapRun.result.applied), true);
    assert.equal(bootstrapRun.bootstrap_after.current_stage, 'support-derive');
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('health routes from applied hardware doc to adapter derive when synced adapters still miss the chip', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-derive-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-health-derive-source-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  let stdout = '';

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
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
    cli.main(['support', 'source', 'add', 'default-support', '--type', 'path', '--location', tempSource]);
    cli.main(['support', 'sync', 'default-support']);

    stdout = '';
    cli.main(['health']);
    const report = JSON.parse(stdout);

    assert.equal(report.checks.find(item => item.key === 'chip_support_match').status, 'warn');
    assert.equal(report.checks.find(item => item.key === 'chip_support_derive_candidate').status, 'warn');
    assert.ok(report.next_commands.some(item => item.key === 'support-analysis-init'));
    assert.ok(report.next_commands.some(item => item.key === 'support-derive-from-analysis'));
    assert.ok(report.next_commands.some(item => item.cli.includes('support analysis init --chip PMS150G --package SOP8')));
    assert.ok(report.next_commands.some(item => item.cli.includes('support derive --from-analysis .emb-agent/analysis/pms150g.json')));
    assert.equal(report.recommended_flow.id, 'doc-to-chip-support-analysis');
    assert.equal(report.recommended_flow.mode, 'analysis-artifact-first');
    assert.equal(report.handoff_protocol.protocol, 'emb-agent.chip-support-analysis/1');
    assert.equal(report.handoff_protocol.artifact_path, '.emb-agent/analysis/pms150g.json');
    assert.deepEqual(
      report.next_commands.find(item => item.key === 'support-analysis-init').argv,
      ['support', 'analysis', 'init', '--chip', 'PMS150G', '--package', 'SOP8']
    );
    assert.deepEqual(
      report.next_commands.find(item => item.key === 'support-derive-from-analysis').argv,
      ['support', 'derive', '--from-analysis', '.emb-agent/analysis/pms150g.json']
    );
    assert.equal(report.quickstart.stage, 'derive-then-next');
    assert.equal(report.action_card.stage, 'chip-support-draft');
    assert.equal(report.action_card.action, 'Ready to run');
    assert.equal(report.action_card.first_instruction, '');
    assert.ok(report.action_card.first_cli.includes('support analysis init --chip PMS150G --package SOP8'));
    assert.ok(report.action_card.then_cli.includes('support derive --from-analysis .emb-agent/analysis/pms150g.json'));
    assert.equal(report.bootstrap.current_stage, 'support-derive');
    assert.ok(report.quickstart.steps[0].cli.includes('support analysis init --chip PMS150G --package SOP8'));
    assert.ok(report.quickstart.steps[1].cli.includes('support derive --from-analysis .emb-agent/analysis/pms150g.json'));
    assert.ok(report.quickstart.steps[2].cli.endsWith(' next'));
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
