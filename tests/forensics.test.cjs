'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('forensics writes lightweight diagnostic report with evidence', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-forensics-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['focus', 'set', 'resume wakeup drift investigation']);
    cli.main(['question', 'add', 'why jitter grows after resume']);
    cli.main(['risk', 'add', 'timer divider may not restore']);
    cli.main(['pause', 'resume wakeup drift first']);
    cli.main(['forensics', 'why flow keeps drifting after resume']);

    const reportDir = path.join(tempProject, 'emb-agent', 'reports', 'forensics');
    const reports = fs.readdirSync(reportDir).filter(name => name.endsWith('.md'));

    assert.equal(reports.length, 1);

    const content = fs.readFileSync(path.join(reportDir, reports[0]), 'utf8');
    assert.match(content, /# Emb-Agent Forensics Report/);
    assert.match(content, /why flow keeps drifting after resume/);
    assert.match(content, /存在未消费的 handoff/);
    assert.match(content, /未决问题仍在堆积/);
    assert.match(content, /已知风险仍未闭环/);
    assert.match(content, /resume wakeup drift first/);
    assert.match(content, /node ~\/\.codex\/emb-agent\/bin\/emb-agent\.cjs resume/);
    assert.equal(cli.loadSession().last_command, 'forensics');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
