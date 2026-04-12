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

  const output = hookDispatch.runHookWithProjectContext(
    {
      cwd: process.cwd(),
      workspace_trusted: false
    },
    () => 'should-not-run'
  );

  assert.equal(output, '');
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

    assert.equal(result.cwd, tempProject);
    assert.equal(result.projectRoot, tempProject);
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

  const output = hookDispatch.runHookWithProjectContext(
    {
      cwd: tempProject,
      event: 'SessionStart'
    },
    () => 'hook-ran'
  );

  assert.equal(output, 'hook-ran');
});
