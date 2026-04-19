#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname, '..');
const AGENTS_SRC = path.join(REPO_ROOT, 'agents');
const RUNTIME_SRC = path.join(REPO_ROOT, 'runtime');
const RUNTIME_HOOKS_SRC = path.join(RUNTIME_SRC, 'hooks');
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const PACKAGE_VERSION = PACKAGE_JSON.version || '0.0.0';

const installHelpers = require(path.join(RUNTIME_SRC, 'lib', 'install-helpers.cjs'));
const installTargets = require(path.join(RUNTIME_SRC, 'lib', 'install-targets.cjs'));
const runtimeHost = require(path.join(RUNTIME_SRC, 'lib', 'runtime-host.cjs'));
const terminalUi = require(path.join(RUNTIME_SRC, 'lib', 'terminal-ui.cjs'));
const initProject = require(path.join(RUNTIME_SRC, 'scripts', 'init-project.cjs'));

const {
  usage,
  getSupportedInstallTargets,
  parseArgs,
  isInteractiveInstall,
  buildInteractiveRuntimePrompt,
  buildInteractiveLocationPrompt,
  promptInteractiveInstallArgs,
  resolveArgs,
  getRuntimeTarget,
  getTargetDir,
  installRuntime,
  installEnvExample,
  installAgents,
  uninstall,
  main
} = installHelpers.createInstallHelpers({
  fs,
  os,
  path,
  process,
  readline,
  installTargets: installTargets.createInstallTargets({
    os,
    path,
    process
  }),
  runtimeHost,
  commandsSrc: path.join(REPO_ROOT, 'commands', 'emb'),
  agentsSrc: AGENTS_SRC,
  runtimeSrc: RUNTIME_SRC,
  runtimeHooksSrc: RUNTIME_HOOKS_SRC,
  packageVersion: PACKAGE_VERSION,
  initProject,
  createTerminalUi: terminalUi.createTerminalUi
});

module.exports = {
  usage,
  getSupportedInstallTargets,
  parseArgs,
  isInteractiveInstall,
  buildInteractiveRuntimePrompt,
  buildInteractiveLocationPrompt,
  promptInteractiveInstallArgs,
  resolveArgs,
  getRuntimeTarget,
  getTargetDir,
  main,
  installRuntime,
  installEnvExample,
  installAgents,
  uninstall
};

if (require.main === module) {
  Promise.resolve(main(process.argv.slice(2))).catch(error => {
    process.stderr.write(`emb-agent install error: ${error.message}\n`);
    process.exit(1);
  });
}
