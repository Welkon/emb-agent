'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const installer = require(path.join(repoRoot, 'bin', 'install.js'));

function hasCargo() {
  try {
    childProcess.execFileSync('cargo', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function buildRustBinary() {
  childProcess.execFileSync('cargo', ['build', '-q', '-p', 'emb-agent-rs'], {
    cwd: repoRoot,
    stdio: 'ignore'
  });
  return path.join(
    repoRoot,
    'target',
    'debug',
    process.platform === 'win32' ? 'emb-agent-rs.exe' : 'emb-agent-rs'
  );
}

async function withCapturedInstallerOutput(fn) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function withRustHookEnv(rustBinary, fn) {
  const previousHooks = process.env.EMB_AGENT_RUST_HOOKS;
  const previousHookCmd = process.env.EMB_AGENT_RUST_HOOK_CMD;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;

  try {
    process.env.EMB_AGENT_RUST_HOOKS = '1';
    process.env.EMB_AGENT_RUST_HOOK_CMD = rustBinary;
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    return await fn();
  } finally {
    restoreEnv('EMB_AGENT_RUST_HOOKS', previousHooks);
    restoreEnv('EMB_AGENT_RUST_HOOK_CMD', previousHookCmd);
    restoreEnv('EMB_AGENT_WORKSPACE_TRUST', previousTrust);
  }
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function stringifyJsonFile(filePath) {
  return JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function assertNoManagedRustHookCommands(text) {
  assert.doesNotMatch(text, /hook session-start/);
  assert.doesNotMatch(text, /hook context-monitor/);
  assert.doesNotMatch(text, /hook statusline/);
}

test('source-built Rust hook plans are installed and uninstalled across hosts', { skip: !hasCargo() }, async () => {
  const rustBinary = buildRustBinary();
  assert.equal(fs.existsSync(rustBinary), true);

  await withRustHookEnv(rustBinary, async () => {
    for (const host of ['codex', 'claude', 'cursor', 'pi']) {
      const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), `emb-agent-${host}-rust-hooks-`));
      const hostFlag = `--${host}`;
      const installArgs = [hostFlag, '--global', '--config-dir', tempHome, '--developer', 'felix'];
      const uninstallArgs = [hostFlag, '--global', '--config-dir', tempHome, '--uninstall'];

      await withCapturedInstallerOutput(() => installer.main(installArgs));

      if (host === 'codex') {
        const hooksPath = path.join(tempHome, 'hooks.json');
        const hooksText = stringifyJsonFile(hooksPath);
        assert.match(hooksText, /hook session-start --host codex/);
        assert.match(hooksText, /hook context-monitor/);

        await withCapturedInstallerOutput(() => installer.main(uninstallArgs));
        if (fs.existsSync(hooksPath)) {
          assertNoManagedRustHookCommands(stringifyJsonFile(hooksPath));
        }
        continue;
      }

      if (host === 'claude') {
        const settingsPath = path.join(tempHome, 'settings.json');
        const settingsText = stringifyJsonFile(settingsPath);
        assert.match(settingsText, /hook session-start --host claude/);
        assert.match(settingsText, /hook context-monitor/);
        assert.match(settingsText, /hook statusline/);

        await withCapturedInstallerOutput(() => installer.main(uninstallArgs));
        if (fs.existsSync(settingsPath)) {
          assertNoManagedRustHookCommands(stringifyJsonFile(settingsPath));
        }
        continue;
      }

      if (host === 'cursor') {
        const settingsPath = path.join(tempHome, 'settings.json');
        const settingsText = stringifyJsonFile(settingsPath);
        assert.match(settingsText, /hook session-start --host cursor/);
        assert.match(settingsText, /hook context-monitor/);

        await withCapturedInstallerOutput(() => installer.main(uninstallArgs));
        if (fs.existsSync(settingsPath)) {
          assertNoManagedRustHookCommands(stringifyJsonFile(settingsPath));
        }
        continue;
      }

      const extensionPath = path.join(tempHome, 'extensions', 'emb-agent.ts');
      const extension = fs.readFileSync(extensionPath, 'utf8');
      assert.match(extension, /hook session-start --host pi/);
      assert.match(extension, /hook context-monitor/);
      assert.match(extension, /hook statusline/);
      assert.match(extension, /context_monitor/);

      await withCapturedInstallerOutput(() => installer.main(uninstallArgs));
      assert.equal(fs.existsSync(extensionPath), false);
    }
  });
});
