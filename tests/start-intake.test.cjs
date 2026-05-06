'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureCliJson(args) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await cli.main(args);
  } finally {
    process.stdout.write = originalWrite;
  }

  return JSON.parse(stdout);
}

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

test('start exposes Trellis-style task intake guidance during bootstrap', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-start-intake-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await captureCliJson(['init']);

    const start = await captureCliJson(['start']);
    assert.equal(start.immediate.command, 'next');
    assert.equal(start.task_intake.status, 'blocked-by-bootstrap');
    assert.equal(start.task_intake.recommended_entry, 'task add <summary>');
    assert.match(start.task_intake.summary, /After bootstrap is ready, create a task and PRD first/i);
    assert.deepEqual(
      start.task_intake.paths.map(item => item.id),
      ['known-change', 'unclear-scope', 'system-change']
    );
    assert.match(
      start.workflow.steps[1].commands.join(' | '),
      /If scope is unclear: capability run scan -> capability run plan/
    );

    const tty = await captureCliTtyOutput(['start']);
    assert.equal(tty.stdout.trim(), '');
    assert.match(tty.stderr, /Next: .*emb-agent\.cjs next/);
    assert.match(tty.stderr, /First: Open \.emb-agent\/req\.yaml/);
    assert.match(tty.stderr, /Task Intake: After bootstrap is ready, create a task and PRD first\./);
  } finally {
    process.chdir(currentCwd);
  }
});

test('next asks for task intake once hardware identity is locked', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-next-task-intake-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await captureCliJson(['init']);
    await captureCliJson(['declare', 'hardware', '--confirm', '--mcu', 'SC8P8122AD', '--package', 'SOP8']);

    const next = await captureCliJson(['next']);

    assert.equal(next.next.command, 'task add <summary>');
    assert.match(next.next.reason, /Hardware identity is locked/i);
    assert.match(next.next.reason, /Tell me the concrete task/i);
    assert.equal(next.action_card.status, 'blocked-by-task-intake');
    assert.match(next.action_card.first_instruction, /Give the task/i);
    assert.match(next.action_card.first_cli, /task add <summary>/);
    assert.match(next.action_card.then_cli, /task activate <name>/);
  } finally {
    process.chdir(currentCwd);
  }
});
