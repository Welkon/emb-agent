'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('plan save appends micro-plan to debug notes by default', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-plan-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.writeFileSync(path.join(tempProject, 'main.c'), 'void main(void) {}\n', 'utf8');

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['focus', 'set', 'stabilize timer wakeup path']);
    cli.main(['last-files', 'add', 'main.c']);
    cli.main([
      'plan',
      'save',
      'Prepare minimal wakeup-timer fix plan',
      '--risk',
      'Wakeup path may re-trigger timer flag',
      '--step',
      'Recheck ISR clear path before main loop change',
      '--verify',
      'Verify wakeup path on bench'
    ]);

    const content = fs.readFileSync(path.join(tempProject, 'docs', 'DEBUG-NOTES.md'), 'utf8');
    const reqTruth = fs.readFileSync(path.join(tempProject, '.emb-agent', 'req.yaml'), 'utf8');

    assert.match(content, /## Emb-Agent Plans/);
    assert.match(content, /Prepare minimal wakeup-timer fix plan/);
    assert.match(content, /stabilize timer wakeup path/);
    assert.match(content, /Wakeup path may re-trigger timer flag/);
    assert.match(content, /Recheck ISR clear path before main loop change/);
    assert.match(content, /Verify wakeup path on bench/);
    assert.match(reqTruth, /Prepare minimal wakeup-timer fix plan/);
    assert.match(reqTruth, /Verify wakeup path on bench/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
