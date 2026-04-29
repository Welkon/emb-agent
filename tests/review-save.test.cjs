'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const { withDefaultWorkflowSourceEnv } = require(path.join(repoRoot, 'tests', 'support-workflow-source.cjs'));

test('review save creates review report from template and appends structured entry', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-review-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  return withDefaultWorkflowSourceEnv(() => {
    try {
      initProject.main(['--project', tempProject, '--profile', 'tasked-runtime', '--spec', 'connected-appliance']);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['focus', 'set', 'review ota rollback path']);
    cli.main([
      'review',
      'save',
      'OTA rollback path needs explicit recovery check',
      '--scope',
      'ota rollback path',
      '--finding',
      'Rollback trigger is not yet documented',
      '--check',
      'Verify offline default behavior after rollback'
    ]);

    const reviewPath = path.join(tempProject, 'docs', 'REVIEW-REPORT.md');
    const content = fs.readFileSync(reviewPath, 'utf8');

    assert.equal(fs.existsSync(reviewPath), true);
    assert.match(content, /# .* Review Report/);
    assert.match(content, /## Emb-Agent Reviews/);
    assert.match(content, /OTA rollback path needs explicit recovery check/);
    assert.match(content, /Rollback trigger is not yet documented/);
    assert.match(content, /Verify offline default behavior after rollback/);
    assert.match(content, /ota_rollback/);
    } finally {
      process.chdir(currentCwd);
      process.stdout.write = originalWrite;
    }
  });
});
