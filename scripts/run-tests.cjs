#!/usr/bin/env node
'use strict';

const { readdirSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');

const testDir = join(__dirname, '..', 'tests');
const files = readdirSync(testDir)
  .filter(name => name.endsWith('.test.cjs'))
  .sort()
  .map(name => join('tests', name));

if (files.length === 0) {
  console.error('No test files found in tests/');
  process.exit(1);
}

try {
  execFileSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
    stdio: 'inherit',
    env: { ...process.env }
  });
} catch (error) {
  process.exit(error.status || 1);
}
