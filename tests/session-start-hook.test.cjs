'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const sessionStartHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-session-start.js'));

test('session start hook only reminds when an unconsumed handoff exists', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-start-'));
  const currentCwd = process.cwd();
  const cachePath = sessionStartHook.getUpdateCachePath();
  const previousSkip = process.env.EMB_AGENT_SKIP_UPDATE_CHECK;

  try {
    process.env.EMB_AGENT_SKIP_UPDATE_CHECK = '1';
    if (fs.existsSync(cachePath)) {
      fs.rmSync(cachePath, { force: true });
    }
    process.chdir(tempProject);
    cli.main(['init']);

    const empty = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    assert.equal(empty, '');

    cli.main(['pause', 'resume irq race first']);
    const reminder = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    assert.match(reminder, /Emb-Agent Session Reminder/);
    assert.match(reminder, /发现未消费的 handoff/);
    assert.match(reminder, /node ~\/\.codex\/emb-agent\/bin\/emb-agent\.cjs resume/);
    assert.match(reminder, /resume irq race first/);
  } finally {
    if (previousSkip === undefined) {
      delete process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
    } else {
      process.env.EMB_AGENT_SKIP_UPDATE_CHECK = previousSkip;
    }
    process.chdir(currentCwd);
  }
});

test('session start hook surfaces cached update and stale install notices', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-update-'));
  const currentCwd = process.cwd();
  const cachePath = sessionStartHook.getUpdateCachePath();
  const cacheDir = path.dirname(cachePath);
  const previousSkip = process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
  const previousHookVersion = process.env.EMB_AGENT_FORCE_HOOK_VERSION;

  try {
    process.env.EMB_AGENT_SKIP_UPDATE_CHECK = '1';
    process.env.EMB_AGENT_FORCE_HOOK_VERSION = '0.0.1';
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
    assert.match(reminder, /发现 emb-agent 新版本: 0.2.0 -> 0.3.0/);
    assert.match(reminder, /检测到 stale install/);
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
  }
});

test('session start hook reminds active task context after clearable resume path exists', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-task-'));
  const currentCwd = process.cwd();
  const previousSkip = process.env.EMB_AGENT_SKIP_UPDATE_CHECK;

  try {
    process.env.EMB_AGENT_SKIP_UPDATE_CHECK = '1';
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['task', 'add', 'Investigate PMS150G comparator timing']);
    const tasksDir = path.join(tempProject, '.emb-agent', 'tasks');
    const taskName = fs.readdirSync(tasksDir).find(name => fs.existsSync(path.join(tasksDir, name, 'task.json')));
    cli.main(['task', 'activate', taskName]);

    const reminder = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    assert.match(reminder, /当前活跃 task:/);
    assert.match(reminder, /Investigate PMS150G comparator timing/);
    assert.match(reminder, /task implement context/);
    assert.match(reminder, /emb-agent\/hw\.yaml/);
  } finally {
    if (previousSkip === undefined) {
      delete process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
    } else {
      process.env.EMB_AGENT_SKIP_UPDATE_CHECK = previousSkip;
    }
    process.chdir(currentCwd);
  }
});

test('session start hook reminds active workspace when no handoff or task is active', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-workspace-'));
  const currentCwd = process.cwd();
  const previousSkip = process.env.EMB_AGENT_SKIP_UPDATE_CHECK;

  try {
    process.env.EMB_AGENT_SKIP_UPDATE_CHECK = '1';
    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['workspace', 'add', 'Power domain verification', '--type', 'domain']);
    const workspacesDir = path.join(tempProject, '.emb-agent', 'workspace');
    const workspaceName = fs.readdirSync(workspacesDir).find(name =>
      fs.existsSync(path.join(workspacesDir, name, 'workspace.json'))
    );
    cli.main(['workspace', 'activate', workspaceName]);

    const reminder = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    assert.match(reminder, /当前活跃 workspace:/);
    assert.match(reminder, /Power domain verification/);
    assert.match(reminder, /workspace notes/);
    assert.match(reminder, /emb-agent\/workspace\//);
    assert.match(reminder, /workspace refresh/);
  } finally {
    if (previousSkip === undefined) {
      delete process.env.EMB_AGENT_SKIP_UPDATE_CHECK;
    } else {
      process.env.EMB_AGENT_SKIP_UPDATE_CHECK = previousSkip;
    }
    process.chdir(currentCwd);
  }
});
