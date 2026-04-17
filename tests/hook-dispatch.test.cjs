'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const hookDispatchHelpers = require(path.join(repoRoot, 'runtime', 'lib', 'hook-dispatch.cjs'));

test('hook dispatch skips all hooks when workspace is untrusted', () => {
  const hookDispatch = hookDispatchHelpers.createHookDispatchHelpers({
    path,
    process
  });

  const result = hookDispatch.runHookWithProjectContext(
    {
      cwd: process.cwd(),
      workspace_trusted: false
    },
    () => 'should-not-run'
  );

  assert.equal(result.trusted, false);
  assert.equal(result.status, 'skipped');
  assert.equal(result.output, '');
  assert.equal(Array.isArray(result.runtime_events), true);
  assert.equal(result.runtime_events[0].type, 'hook-dispatch');
  assert.equal(result.runtime_events[0].status, 'blocked');
});

test('hook dispatch switches to project cwd and restores it afterward', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-hook-dispatch-'));
  const previousCwd = process.cwd();
  const hookDispatch = hookDispatchHelpers.createHookDispatchHelpers({
    path,
    process
  });

  try {
    const result = hookDispatch.runHookWithProjectContext(
      {
        cwd: tempProject,
        workspace_trusted: true
      },
      ({ data, projectRoot }) => ({
        cwd: process.cwd(),
        projectRoot,
        event: data.event || ''
      })
    );

    assert.equal(result.trusted, true);
    assert.equal(result.output.cwd, tempProject);
    assert.equal(result.output.projectRoot, tempProject);
    assert.equal(process.cwd(), previousCwd);
  } finally {
    process.chdir(previousCwd);
  }
});

test('hook dispatch trusts codex host config when hooks are installed', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-hook-home-'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-hook-project-'));
  const hookDispatch = hookDispatchHelpers.createHookDispatchHelpers({
    fs,
    path,
    process,
    runtimeHost: {
      name: 'codex',
      runtimeHome: tempHome,
      configFileName: 'config.toml'
    }
  });

  fs.writeFileSync(
    path.join(tempHome, 'config.toml'),
    [
      '[features]',
      'codex_hooks = true',
      '',
      '[[hooks]]',
      'event = "SessionStart"',
      'command = "node /tmp/emb-session-start.js"',
      '',
      '[[hooks]]',
      'event = "PostToolUse"',
      'command = "node /tmp/emb-context-monitor.js"',
      ''
    ].join('\n'),
    'utf8'
  );

  const result = hookDispatch.runHookWithProjectContext(
    {
      cwd: tempProject,
      event: 'SessionStart'
    },
    () => 'hook-ran'
  );

  assert.equal(result.trusted, true);
  assert.equal(result.output, 'hook-ran');
});

test('hook dispatch returns structured output and runtime events for trusted workspaces', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-hook-detailed-'));
  const previousCwd = process.cwd();
  const hookDispatch = hookDispatchHelpers.createHookDispatchHelpers({
    fs,
    path,
    process
  });

  try {
    const result = hookDispatch.runHookWithProjectContext(
      {
        cwd: tempProject,
        event: 'PostToolUse',
        workspace_trusted: true
      },
      ({ projectRoot }) => ({
        cwd: process.cwd(),
        projectRoot,
        ok: true
      })
    );

    assert.equal(result.trusted, true);
    assert.equal(result.status, 'ok');
    assert.equal(result.event, 'PostToolUse');
    assert.deepEqual(result.output, {
      cwd: tempProject,
      projectRoot: tempProject,
      ok: true
    });
    assert.equal(result.runtime_events[0].type, 'hook-dispatch');
    assert.equal(result.runtime_events[0].status, 'ok');
    assert.equal(process.cwd(), previousCwd);
  } finally {
    process.chdir(previousCwd);
  }
});

test('hook dispatch cli unwraps structured hook output before writing stdout', async () => {
  const events = {};
  let stdout = '';
  let exitCode = null;
  let encoding = '';
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const hookDispatch = hookDispatchHelpers.createHookDispatchHelpers({
    path,
    process: {
      ...process,
      stdin: {
        setEncoding(value) {
          encoding = value;
        },
        on(event, handler) {
          events[event] = handler;
        }
      },
      stdout: {
        write(chunk) {
          stdout += String(chunk);
          return true;
        }
      },
      exit(code) {
        exitCode = code;
      }
    }
  });

  global.setTimeout = () => 1;
  global.clearTimeout = () => {};

  try {
    hookDispatch.runHookCli(rawInput => hookDispatch.runHookWithProjectContext(rawInput, () => 'hook-ran'));
    assert.equal(encoding, 'utf8');
    events.data('{"cwd":"/tmp","workspace_trusted":true}');
    events.end();
    assert.equal(stdout, 'hook-ran');
    assert.equal(exitCode, null);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});
