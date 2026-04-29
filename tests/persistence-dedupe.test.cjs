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

function countOccurrences(content, needle) {
  return (content.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

test('repeated note save with same summary replaces prior entry', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dedupe-note-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main([
      'note',
      'add',
      'hardware',
      'PA5 is reserved for programming path',
      '--kind',
      'hardware_truth',
      '--evidence',
      'datasheet-v1'
    ]);
    cli.main([
      'note',
      'add',
      'hardware',
      'PA5 is reserved for programming path',
      '--kind',
      'hardware_truth',
      '--evidence',
      'datasheet-v2'
    ]);

    const content = fs.readFileSync(path.join(tempProject, 'docs', 'HARDWARE-LOGIC.md'), 'utf8');

    assert.equal(countOccurrences(content, 'PA5 is reserved for programming path'), 1);
    assert.equal(countOccurrences(content, 'datasheet-v2'), 1);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('repeated scan and plan saves with same summary replace prior entries', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dedupe-flow-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.writeFileSync(path.join(tempProject, 'main.c'), 'void main(void) {}\n', 'utf8');

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['last-files', 'add', 'main.c']);
    cli.main(['focus', 'set', 'stabilize timer wakeup path']);

    cli.main(['scan', 'save', 'hardware', 'Captured current entry and truth source order', '--fact', 'fact-v1']);
    cli.main(['scan', 'save', 'hardware', 'Captured current entry and truth source order', '--fact', 'fact-v2']);

    cli.main(['plan', 'save', 'Prepare minimal wakeup-timer fix plan', '--risk', 'risk-v1']);
    cli.main(['plan', 'save', 'Prepare minimal wakeup-timer fix plan', '--risk', 'risk-v2']);

    const hardwareContent = fs.readFileSync(path.join(tempProject, 'docs', 'HARDWARE-LOGIC.md'), 'utf8');
    const debugContent = fs.readFileSync(path.join(tempProject, 'docs', 'DEBUG-NOTES.md'), 'utf8');

    assert.equal(countOccurrences(hardwareContent, 'Captured current entry and truth source order'), 1);
    assert.equal(countOccurrences(hardwareContent, 'fact-v2'), 1);
    assert.equal(countOccurrences(debugContent, 'Prepare minimal wakeup-timer fix plan'), 1);
    assert.equal(countOccurrences(debugContent, 'risk-v2'), 1);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('repeated review save with same summary replaces prior report entry', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-dedupe-review-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  return withDefaultWorkflowSourceEnv(() => {
    try {
      initProject.main(['--project', tempProject, '--profile', 'tasked-runtime', '--spec', 'connected-appliance']);

    process.chdir(tempProject);
    cli.main(['init']);

    cli.main(['review', 'save', 'Reconnect path needs explicit offline gate', '--finding', 'finding-v1']);
    cli.main(['review', 'save', 'Reconnect path needs explicit offline gate', '--finding', 'finding-v2']);

    const content = fs.readFileSync(path.join(tempProject, 'docs', 'REVIEW-REPORT.md'), 'utf8');

      assert.equal(countOccurrences(content, 'Reconnect path needs explicit offline gate'), 1);
      assert.equal(countOccurrences(content, 'finding-v2'), 1);
    } finally {
      process.chdir(currentCwd);
      process.stdout.write = originalWrite;
    }
  });
});
