'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const installHelpersModule = require(path.join(repoRoot, 'runtime', 'lib', 'install-helpers.cjs'));
const installTargetsModule = require(path.join(repoRoot, 'runtime', 'lib', 'install-targets.cjs'));

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
    assert.deepEqual(targets.map(item => item.name), ['codex', 'claude']);
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
});
