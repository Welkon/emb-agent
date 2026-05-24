#!/usr/bin/env node

'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

function findRustBinary() {
  const exeName = process.platform === 'win32' ? 'emb-agent-rs.exe' : 'emb-agent-rs';
  const candidates = [
    path.join(process.cwd(), '.pi', 'emb-agent', 'bin', exeName),
    path.join(__dirname, exeName),
    exeName,
  ];
  return candidates.find(c => { try { return fs.existsSync(c); } catch { return false; } }) || '';
}

async function main(argv) {
  const args = Array.isArray(argv) ? argv : process.argv.slice(2);
  const rustBin = findRustBinary();

  if (!rustBin) {
    process.stderr.write('emb-agent: Rust binary (emb-agent-rs) not found.\n');
    process.stderr.write('Build it with: cd emb-agent && cargo build --release\n');
    process.exit(1);
  }

  const result = childProcess.spawnSync(rustBin, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status || 0);
}

module.exports = { main };

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`emb-agent error: ${error.message}\n`);
    process.exit(1);
  });
}
