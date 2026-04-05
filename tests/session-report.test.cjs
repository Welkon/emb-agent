'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('session-report writes lightweight session report with next guidance', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-session-report-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['focus', 'set', 'capture bring-up summary']);
    cli.main(['question', 'add', 'is pwm divider restored after sleep']);
    cli.main(['risk', 'add', 'resume path may skip timer reload']);
    cli.main(['thread', 'add', 'Track PWM divider restore issue']);
    cli.main(['session-report', 'capture current bring-up handoff']);

    const reportDir = path.join(tempProject, 'emb-agent', 'reports', 'sessions');
    const reports = fs.readdirSync(reportDir).filter(name => name.endsWith('.md'));
    assert.equal(reports.length, 1);

    const content = fs.readFileSync(path.join(reportDir, reports[0]), 'utf8');
    assert.match(content, /# Emb-Agent Session Report/);
    assert.match(content, /capture current bring-up handoff/);
    assert.match(content, /capture bring-up summary/);
    assert.match(content, /is pwm divider restored after sleep/);
    assert.match(content, /resume path may skip timer reload/);
    assert.match(content, /next_command: debug/);
    assert.match(content, /open: 1/);
    assert.equal(cli.loadSession().last_command, 'session-report');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
