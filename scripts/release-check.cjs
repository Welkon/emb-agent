#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const packagePath = path.join(repoRoot, 'package.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(label, command, args) {
  process.stdout.write(`\n[release-check] ${label}\n`);
  const cacheDir = path.join(repoRoot, '.tmp', 'npm-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  return childProcess.execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_cache: cacheDir
    }
  });
}

function runPackDryRunCheck() {
  process.stdout.write('\n[release-check] pack content check\n');
  const cacheDir = path.join(repoRoot, '.tmp', 'npm-cache');
  const packDir = path.join(repoRoot, '.tmp', 'pack');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(packDir, { recursive: true });

  childProcess.execFileSync('npm', ['pack', '--pack-destination', packDir], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_cache: cacheDir
    }
  });

  const tarballs = fs
    .readdirSync(packDir)
    .filter(name => name.endsWith('.tgz'))
    .sort();
  const tarballName = tarballs[tarballs.length - 1];
  ensure(tarballName, 'npm pack did not produce a tarball');

  const tarballPath = path.join(packDir, tarballName);
  ensure(fs.existsSync(tarballPath), `packed tarball not found: ${tarballPath}`);

  const tarList = childProcess.execFileSync('tar', ['-tf', tarballPath], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8'
  });
  const files = tarList
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const blocked = files.filter(
      item =>
        item.includes('package/runtime/state/projects/') ||
        item.includes('package/state/emb-agent/projects/') ||
        item.includes('package/.tmp/') ||
        item.endsWith('.handoff.json')
  );

  ensure(blocked.length === 0, `package contains forbidden files: ${blocked.join(', ')}`);
  process.stdout.write('[release-check] npm pack content check passed\n');
}

function main() {
  const pkg = readJson(packagePath);

  ensure(pkg.name === 'emb-agent', 'package.json name must be emb-agent');
  ensure(typeof pkg.version === 'string' && pkg.version.trim() !== '', 'package.json version is required');
  ensure(pkg.bin && pkg.bin['emb-agent'] === 'bin/install.js', 'bin.emb-agent must point to bin/install.js');
  ensure(Array.isArray(pkg.files), 'package.json files must be an array');
  ensure(pkg.files.includes('runtime/bin'), 'package.json files must include runtime/bin');
  ensure(pkg.files.includes('runtime/lib'), 'package.json files must include runtime/lib');
  ensure(
    pkg.files.includes('runtime/state/default-session.json'),
    'package.json files must include runtime/state/default-session.json'
  );
  ensure(fs.existsSync(path.join(repoRoot, 'README.md')), 'README.md is required');
  ensure(fs.existsSync(path.join(repoRoot, 'RELEASE.md')), 'RELEASE.md is required');

  run('run tests', process.execPath, ['scripts/run-tests.cjs']);
  run('run behavior drift gate', process.execPath, ['scripts/behavior-drift-check.cjs']);
  runPackDryRunCheck();

  process.stdout.write('\n[release-check] emb-agent release check passed\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`[release-check] failed: ${error.message}\n`);
  process.exit(1);
}
