'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const sessionStartHook = require(path.join(repoRoot, 'runtime', 'hooks', 'emb-session-start.js'));

function parseHookPayload(result) {
  assert.equal(typeof result.output, 'string');
  return JSON.parse(result.output);
}

test('session start hook auto-injects startup context and initializes the repo on first session', () => {
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

    const empty = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    const emptyPayload = parseHookPayload(empty);
    assert.equal(empty.trusted, true);
    assert.equal(emptyPayload.suppressOutput, true);
    assert.equal(emptyPayload.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(emptyPayload.systemMessage, /emb-agent context injected/);
    assert.match(emptyPayload.hookSpecificOutput.additionalContext, /startup context is already injected/i);
    assert.match(emptyPayload.hookSpecificOutput.additionalContext, /initialized automatically during SessionStart/);
    assert.match(emptyPayload.hookSpecificOutput.additionalContext, /Recommended next command: next/);
    assert.doesNotMatch(emptyPayload.hookSpecificOutput.additionalContext, /Primary entrypoint: start/);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'project.json')), true);

    cli.main(['pause', 'resume irq race first']);
    const reminder = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    const reminderPayload = parseHookPayload(reminder);
    assert.equal(reminder.trusted, true);
    assert.equal(reminder.runtime_events[0].type, 'hook-dispatch');
    assert.match(reminderPayload.hookSpecificOutput.additionalContext, /Recommended next command: resume/);
    assert.match(reminderPayload.hookSpecificOutput.additionalContext, /Pending handoff: resume irq race first/);
    assert.match(reminderPayload.hookSpecificOutput.additionalContext, /Recommended CLI: node ~\/\.codex\/emb-agent\/bin\/emb-agent\.cjs resume/);
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
    const payload = parseHookPayload(reminder);
    assert.match(payload.hookSpecificOutput.additionalContext, /Found a newer emb-agent version: 0.2.0 -> 0.3.0/);
    assert.match(payload.hookSpecificOutput.additionalContext, /Detected stale install/);
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
    const payload = parseHookPayload(reminder);
    assert.match(payload.hookSpecificOutput.additionalContext, /Recommended next command: next/);
    assert.match(payload.hookSpecificOutput.additionalContext, /Active task:/);
    assert.match(payload.hookSpecificOutput.additionalContext, /Investigate PMS150G comparator timing/);
    assert.match(payload.hookSpecificOutput.additionalContext, /Task PRD:/);
    assert.match(payload.hookSpecificOutput.additionalContext, /Task implement context:/);
    assert.match(payload.hookSpecificOutput.additionalContext, /emb-agent\/hw\.yaml/);
    assert.match(payload.hookSpecificOutput.additionalContext, /Auto-injected specs:/);
    assert.match(payload.hookSpecificOutput.additionalContext, /project-local/);
    assert.match(payload.hookSpecificOutput.additionalContext, /task-execution/);
    assert.doesNotMatch(payload.hookSpecificOutput.additionalContext, /Primary entrypoint: start/);
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

test('session start hook surfaces the latest session checkpoint for the current branch', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-report-hook-'));
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
    childProcess.execFileSync('git', ['init', '-b', 'feat/session-hook'], {
      cwd: tempProject,
      stdio: 'ignore'
    });
    cli.main(['init']);
    cli.main(['session', 'record', 'capture pwm checkpoint']);

    const reminder = sessionStartHook.runHook({ cwd: tempProject, event: 'SessionStart' });
    const payload = parseHookPayload(reminder);
    assert.match(payload.hookSpecificOutput.additionalContext, /Latest session checkpoint: capture pwm checkpoint/);
    assert.match(payload.hookSpecificOutput.additionalContext, /Checkpoint next command:/);
    assert.match(payload.hookSpecificOutput.additionalContext, /Checkpoint branch: feat\/session-hook \(matches current branch\)/);
    assert.match(payload.hookSpecificOutput.additionalContext, /\.emb-agent\/reports\/sessions\/report-/);
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
