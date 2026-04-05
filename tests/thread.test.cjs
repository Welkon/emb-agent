'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('thread commands create list resume and resolve lightweight threads', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-thread-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['focus', 'set', 'timer wakeup edge drift']);
    cli.main(['question', 'add', 'why wakeup jitter grows after sleep']);
    cli.main(['risk', 'add', 'shared timer divider may drift']);

    cli.main(['thread', 'add', 'Track timer wakeup jitter across sessions']);

    const threadsDir = path.join(tempProject, 'emb-agent', 'threads');
    const threadFiles = fs.readdirSync(threadsDir).filter(name => name.endsWith('.md'));

    assert.equal(threadFiles.length, 1);

    const threadName = threadFiles[0].replace(/\.md$/, '');
    const createdContent = fs.readFileSync(path.join(threadsDir, threadFiles[0]), 'utf8');
    assert.match(createdContent, /# Thread: Track timer wakeup jitter across sessions/);
    assert.match(createdContent, /## Status\s+OPEN/);
    assert.match(createdContent, /timer wakeup edge drift/);
    assert.match(createdContent, /why wakeup jitter grows after sleep/);
    assert.match(createdContent, /shared timer divider may drift/);

    cli.main(['thread', 'resume', threadName]);
    const resumedContent = fs.readFileSync(path.join(threadsDir, threadFiles[0]), 'utf8');
    assert.match(resumedContent, /## Status\s+IN_PROGRESS/);
    assert.equal(cli.loadSession().focus, 'Track timer wakeup jitter across sessions');

    cli.main(['thread', 'resolve', threadName, 'bench result captured']);
    const resolvedContent = fs.readFileSync(path.join(threadsDir, threadFiles[0]), 'utf8');
    assert.match(resolvedContent, /## Status\s+RESOLVED/);
    assert.match(resolvedContent, /resolved: bench result captured/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
