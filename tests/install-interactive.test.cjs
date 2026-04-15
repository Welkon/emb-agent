'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const installHelpersModule = require(path.join(repoRoot, 'runtime', 'lib', 'install-helpers.cjs'));
const installTargetsModule = require(path.join(repoRoot, 'runtime', 'lib', 'install-targets.cjs'));
const runtimeHost = require(path.join(repoRoot, 'runtime', 'lib', 'runtime-host.cjs'));

function createHelper(customProcess, promptInstallerChoices) {
  const runtimeSrc = path.join(repoRoot, 'runtime');

  return installHelpersModule.createInstallHelpers({
    fs,
    os,
    path,
    process: customProcess,
    readline: null,
    promptInstallerChoices,
    installTargets: installTargetsModule.createInstallTargets({
      os,
      path,
      process: customProcess
    }),
    runtimeHost,
    commandsSrc: path.join(repoRoot, 'commands', 'emb'),
    agentsSrc: path.join(repoRoot, 'agents'),
    runtimeSrc,
    runtimeHooksSrc: path.join(runtimeSrc, 'hooks'),
    packageVersion: '0.0.0-test'
  });
}

test('interactive no-args install rejects non-tty sessions without developer name', async () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write(chunk) {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  await assert.rejects(() => helper.resolveArgs([]), /Non-interactive install requires --developer <name>/);
});

test('interactive no-args install can resolve local codex choice through prompt hook', async () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: true },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, async targets => {
    assert.deepEqual(targets.map(item => item.name), ['codex', 'claude', 'cursor']);
    return {
      runtime: 'codex',
      location: 'local',
      developer: 'welkon'
    };
  });

  const args = await helper.resolveArgs([]);

  assert.equal(args.runtime, 'codex');
  assert.equal(args.global, false);
  assert.equal(args.local, true);
  assert.equal(args.developer, 'welkon');
  assert.equal(args.profile, 'core');
  assert.equal(args.subagentBridgeCmd, '');
  assert.equal(args.subagentBridgeTimeoutMs, runtimeHost.DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS);
});

test('parseArgs accepts sub-agent bridge command and timeout', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const args = helper.parseArgs([
    '--global',
    '--developer',
    'welkon',
    '--subagent-bridge-cmd',
    'node /tmp/mock-bridge.cjs --stdio-json',
    '--subagent-bridge-timeout-ms',
    '21000'
  ]);

  assert.equal(args.subagentBridgeCmd, 'node /tmp/mock-bridge.cjs --stdio-json');
  assert.equal(args.subagentBridgeTimeoutMs, 21000);
});

test('parseArgs defaults Codex installs to local project scope', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const args = helper.parseArgs(['--developer', 'welkon']);

  assert.equal(args.runtime, 'codex');
  assert.equal(args.local, true);
  assert.equal(args.global, false);
});

test('parseArgs keeps Claude installs global by default', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const args = helper.parseArgs(['--claude', '--developer', 'welkon']);

  assert.equal(args.runtime, 'claude');
  assert.equal(args.local, true);
  assert.equal(args.global, false);
});

test('parseArgs accepts default adapter source overrides', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const args = helper.parseArgs([
    '--global',
    '--developer',
    'welkon',
    '--default-chip-support-source-location',
    'git@github.com:Welkon/emb-agent-adapters.git',
    '--default-chip-support-source-branch',
    'main',
    '--default-chip-support-source-subdir',
    'emb-agent'
  ]);

  assert.equal(args.defaultAdapterSourceLocation, 'git@github.com:Welkon/emb-agent-adapters.git');
  assert.equal(args.defaultAdapterSourceBranch, 'main');
  assert.equal(args.defaultAdapterSourceSubdir, 'emb-agent');
});

test('parseArgs accepts install profile override', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const args = helper.parseArgs(['--global', '--developer', 'welkon', '--profile', 'workflow']);

  assert.equal(args.profile, 'workflow');
});

test('parseArgs rejects sub-agent bridge timeout without command', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);

  assert.throws(
    () => helper.parseArgs(['--global', '--developer', 'welkon', '--subagent-bridge-timeout-ms', '21000']),
    /--subagent-bridge-timeout-ms requires --subagent-bridge-cmd/
  );
});

test('parseArgs rejects empty default adapter source location', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);

  assert.throws(
    () => helper.parseArgs(['--global', '--developer', 'welkon', '--default-chip-support-source-location']),
    /Missing value after --default-chip-support-source-location/
  );
});
