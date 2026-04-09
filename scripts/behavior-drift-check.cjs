#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

const suites = [
  {
    id: 'behavior-regression',
    file: path.join(repoRoot, 'tests', 'behavior-regression.test.cjs'),
    hint: 'Core next-routing contracts may have drifted (health/plan/forensics/tool-first).'
  },
  {
    id: 'context-hook',
    file: path.join(repoRoot, 'tests', 'context-hook.test.cjs'),
    hint: 'Context-hook warning throttling or severity-escalation logic may have drifted.'
  },
  {
    id: 'session-start-hook',
    file: path.join(repoRoot, 'tests', 'session-start-hook.test.cjs'),
    hint: 'Session-start reminder flow may have drifted (handoff/task/workspace/update).'
  },
  {
    id: 'plugin-governance',
    file: path.join(repoRoot, 'tests', 'plugin-governance.test.cjs'),
    hint: 'Plugin-governance constraints may have drifted (external registry schema / adapter export contracts).'
  }
];

function runSuite(suite) {
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', suite.file], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env }
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const failures = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('not ok '))
    .map(line => line.replace(/^not ok\s+\d+\s*-\s*/, ''));

  return {
    suite,
    ok: result.status === 0,
    status: result.status,
    failures
  };
}

const results = suites.map(runSuite);
const failed = results.filter(item => !item.ok);

console.log('Behavior Drift Check Summary');
console.log('============================');
for (const item of results) {
  const statusText = item.ok ? 'PASS' : 'FAIL';
  console.log(`- ${item.suite.id}: ${statusText}`);
  if (!item.ok && item.failures.length > 0) {
    for (const name of item.failures) {
      console.log(`  failing test: ${name}`);
    }
  }
}

if (failed.length > 0) {
  console.log('');
  console.log('Drift Hints');
  console.log('-----------');
  for (const item of failed) {
    console.log(`- ${item.suite.id}: ${item.suite.hint}`);
  }
  process.exit(1);
}

console.log('');
console.log('No behavior drift detected in sentinel suites.');
