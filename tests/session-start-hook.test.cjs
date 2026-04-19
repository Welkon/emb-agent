'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const sessionStartHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-session-start.js'));

test('session start hook points the user back to start instead of replaying the full workflow', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-start-'));
  const currentCwd = process.cwd();
  const previousSkip = process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
  const previousCachePath = process.env.EMB_AGENT_UPDATE_CACHE_PATH;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  const cachePath = path.join(tempProject, '.cache', 'update-check.json');

  try {
    process.env.EMB_AGENT_SKIP_UPDATE_CHECK = '1';
    process.env.EMB_AGENT_UPDATE_CACHE_PATH = cachePath;
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    if (fs.existsSync(cachePath)) {
      fs.rmSync(cachePath, { force: true });
    }
    process.chdir(tempProject);
    cli.main(['init']);

    const empty = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    assert.equal(empty.trusted, true);
    assert.match(empty.output, /Emb-Agent Session Reminder/);
    assert.match(empty.output, /Primary entrypoint: start/);
    assert.match(empty.output, /Recommended next command: next/);
    assert.doesNotMatch(empty.output, /Task bootstrap:/);
    assert.doesNotMatch(empty.output, /Execution loop:/);

    cli.main(['pause', 'resume irq race first']);
    const reminder = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    assert.equal(reminder.trusted, true);
    assert.equal(reminder.runtime_events[0].type, 'hook-dispatch');
    assert.match(reminder.output, /Emb-Agent Session Reminder/);
    assert.match(reminder.output, /Primary entrypoint: start/);
    assert.match(reminder.output, /Recommended next command: resume/);
    assert.match(reminder.output, /Pending handoff detected/);
    assert.match(reminder.output, /node ~\/\.codex\/emb-agent\/bin\/emb-agent\.cjs resume/);
    assert.match(reminder.output, /resume irq race first/);
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    if (previousSkip === undefined) {
      delete process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
    } else {
      process.env.EMB_AGENT_SKIP_UPDATE_CHECK = previousSkip;
    }
    if (previousCachePath === undefined) {
      delete process.env.EMB_AGENT_UPDATE_CACHE_PATH;
    } else {
      process.env.EMB_AGENT_UPDATE_CACHE_PATH = previousCachePath;
    }
    process.chdir(currentCwd);
  }
});

test('session start hook surfaces cached update and stale install notices', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-update-'));
  const currentCwd = process.cwd();
  const previousSkip = process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
  const previousHookVersion = process.env.EMB_AGENT_FORCE_HOOK_VERSION;
  const previousCachePath = process.env.EMB_AGENT_UPDATE_CACHE_PATH;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  const cachePath = path.join(tempProject, '.cache', 'update-check.json');
  const cacheDir = path.dirname(cachePath);

  try {
    process.env.EMB_AGENT_SKIP_UPDATE_CHECK = '1';
    process.env.EMB_AGENT_FORCE_HOOK_VERSION = '0.0.1';
    process.env.EMB_AGENT_UPDATE_CACHE_PATH = cachePath;
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    fs.mkdirSync(cacheDir, { recursive: true });
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
    cli.main(['init']);
    const reminder = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    assert.match(reminder.output, /Found a newer emb-agent version: 0.2.0 -> 0.3.0/);
    assert.match(reminder.output, /Detected stale install/);
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
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
  }
});

test('session start hook reminds active task context after clearable resume path exists', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-task-'));
  const currentCwd = process.cwd();
  const previousSkip = process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
  const previousCachePath = process.env.EMB_AGENT_UPDATE_CACHE_PATH;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  const cachePath = path.join(tempProject, '.cache', 'update-check.json');

  try {
    process.env.EMB_AGENT_SKIP_UPDATE_CHECK = '1';
    process.env.EMB_AGENT_UPDATE_CACHE_PATH = cachePath;
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['task', 'add', 'Investigate PMS150G comparator timing']);
    const tasksDir = path.join(tempProject, '.emb-agent', 'tasks');
    const taskName = fs.readdirSync(tasksDir).find(name =>
      name !== '00-bootstrap-project' &&
      fs.existsSync(path.join(tasksDir, name, 'task.json'))
    );
    cli.main(['task', 'activate', taskName]);

    const reminder = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    assert.match(reminder.output, /Primary entrypoint: start/);
    assert.match(reminder.output, /Recommended next command: next/);
    assert.match(reminder.output, /Current active task:/);
    assert.match(reminder.output, /Investigate PMS150G comparator timing/);
    assert.match(reminder.output, /Re-read the task PRD first:/);
    assert.match(reminder.output, /task implement context/);
    assert.match(reminder.output, /emb-agent\/hw\.yaml/);
    assert.match(reminder.output, /Auto-injected specs:/);
    assert.match(reminder.output, /project-local/);
    assert.match(reminder.output, /task-execution/);
    assert.doesNotMatch(reminder.output, /Default loop:/);
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    if (previousSkip === undefined) {
      delete process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
    } else {
      process.env.EMB_AGENT_SKIP_UPDATE_CHECK = previousSkip;
    }
    if (previousCachePath === undefined) {
      delete process.env.EMB_AGENT_UPDATE_CACHE_PATH;
    } else {
      process.env.EMB_AGENT_UPDATE_CACHE_PATH = previousCachePath;
    }
    process.chdir(currentCwd);
  }
});

test('session start hook skips all output when workspace trust is not established', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-untrusted-'));
  const currentCwd = process.cwd();
  const previousSkip = process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
  const previousCachePath = process.env.EMB_AGENT_UPDATE_CACHE_PATH;
  const cachePath = path.join(tempProject, '.cache', 'update-check.json');

  try {
    process.env.EMB_AGENT_SKIP_UPDATE_CHECK = '1';
    process.env.EMB_AGENT_UPDATE_CACHE_PATH = cachePath;
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['pause', 'resume irq race first']);

    const reminder = sessionStartHook.runHook({
      cwd: tempProject,
      event: 'SessionStart',
      workspace_trusted: false
    });

    assert.equal(reminder.trusted, false);
    assert.equal(reminder.status, 'skipped');
    assert.equal(reminder.output, '');
  } finally {
    if (previousSkip === undefined) {
      delete process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
    } else {
      process.env.EMB_AGENT_SKIP_UPDATE_CHECK = previousSkip;
    }
    if (previousCachePath === undefined) {
      delete process.env.EMB_AGENT_UPDATE_CACHE_PATH;
    } else {
      process.env.EMB_AGENT_UPDATE_CACHE_PATH = previousCachePath;
    }
    process.chdir(currentCwd);
  }
});
