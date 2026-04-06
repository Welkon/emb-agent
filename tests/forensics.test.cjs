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
    let stdout = '';
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };
    cli.main(['forensics', 'why flow keeps drifting after resume']);
    const result = JSON.parse(stdout);

    const reportDir = path.join(tempProject, 'emb-agent', 'reports', 'forensics');
    const reports = fs.readdirSync(reportDir).filter(name => name.endsWith('.md'));
    const threadsDir = path.join(tempProject, 'emb-agent', 'threads');
    const threadFiles = fs.readdirSync(threadsDir).filter(name => name.endsWith('.md'));

    assert.equal(reports.length, 1);
    assert.equal(threadFiles.length, 1);
    assert.match(result.linked_thread.title, /Forensics: why flow keeps drifting after resume/);

    const content = fs.readFileSync(path.join(reportDir, reports[0]), 'utf8');
    const threadContent = fs.readFileSync(path.join(threadsDir, threadFiles[0]), 'utf8');
    assert.match(content, /# Emb-Agent Forensics Report/);
    assert.match(content, /why flow keeps drifting after resume/);
    assert.match(content, /Linked Thread:/);
    assert.match(content, /存在未消费的 handoff/);
    assert.match(content, /未决问题仍在堆积/);
    assert.match(content, /已知风险仍未闭环/);
    assert.match(content, /resume wakeup drift first/);
    assert.match(content, /node ~\/\.codex\/emb-agent\/bin\/emb-agent\.cjs resume/);
    assert.match(threadContent, /## Status\s+IN_PROGRESS/);
    assert.match(threadContent, /forensics linked/);
    assert.match(threadContent, /report-.*\.md/);
    assert.match(threadContent, /先处理取证建议：/);
    assert.equal(cli.loadSession().last_command, 'forensics');
    assert.match(cli.loadSession().focus, /Forensics: why flow keeps drifting after resume/);
    assert.equal(cli.loadSession().active_thread.name, result.linked_thread.name);
    assert.equal(cli.loadSession().diagnostics.latest_forensics.linked_thread, result.linked_thread.name);
    assert.equal(cli.loadSession().diagnostics.latest_forensics.highest_severity, 'high');

    const resume = cli.buildResumeContext();
    assert.equal(resume.thread.name, threadFiles[0].replace(/\.md$/, ''));
    assert.equal(resume.diagnostics.latest_forensics.linked_thread, result.linked_thread.name);
    assert.ok(resume.next_actions.some(item => item.includes('优先恢复 thread')));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
