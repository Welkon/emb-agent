'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const sessionStartHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-session-start.js'));

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
    assert.equal(cli.loadSession().last_command, 'health');

    stdout = '';
    fs.rmSync(path.join(tempProject, 'emb-agent', 'req.yaml'), { force: true });
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
    assert.ok(report.recommendations.some(item => item.includes('hooks / runtime / skills')));
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
