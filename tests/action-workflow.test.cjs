'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureCliTtyOutput(args) {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalStdoutIsTty = process.stdout.isTTY;
  const originalStderrIsTty = process.stderr.isTTY;
  let stdout = '';
  let stderr = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = chunk => {
    stderr += String(chunk);
    return true;
  };
  process.stdout.isTTY = true;
  process.stderr.isTTY = true;

  try {
    await cli.main(args);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.stdout.isTTY = originalStdoutIsTty;
    process.stderr.isTTY = originalStderrIsTty;
  }

  return { stdout, stderr };
}

test('scan tty output shows workflow stage, exit criteria, and clean followup hints', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-action-workflow-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const output = await captureCliTtyOutput(['scan']);

    assert.equal(output.stdout.trim(), '');
    assert.match(output.stderr, /Workflow: selection/);
    assert.match(
      output.stderr,
      /Exit: Project constraints are explicit enough to shortlist a real chip candidate or first hardware target/
    );
    assert.match(output.stderr, /Stage: scan/);
    assert.match(output.stderr, /CLI: .*emb-agent\.cjs plan/);
    assert.match(output.stderr, /Then: .*emb-agent\.cjs verify/);
    assert.doesNotMatch(output.stderr, /instruction=/);
    assert.doesNotMatch(output.stderr, /followup=/);
  } finally {
    process.chdir(currentCwd);
  }
});
