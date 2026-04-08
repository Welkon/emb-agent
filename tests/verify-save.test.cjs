'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('verify save creates verification report and appends structured entry', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-verify-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);

    process.chdir(tempProject);
    cli.main(['init']);
    cli.main(['focus', 'set', 'validate wakeup and low-voltage behavior']);
    fs.mkdirSync(path.join(tempProject, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'src', 'power.c'), 'void power(void) {}\n', 'utf8');
    cli.main(['last-files', 'add', 'src/power.c']);
    cli.main([
      'verify',
      'save',
      'Wakeup and LVDC path verified on bench',
      '--check',
      'Check wakeup flag clear order after sleep',
      '--result',
      'PASS: wakeup flag order matched expectation',
      '--evidence',
      'scope capture on PA0 wake edge',
      '--followup',
      'Retest under low battery condition'
    ]);

    const verifyPath = path.join(tempProject, 'docs', 'VERIFICATION.md');
    const content = fs.readFileSync(verifyPath, 'utf8');

    assert.equal(fs.existsSync(verifyPath), true);
    assert.match(content, /# .* Verification/);
    assert.match(content, /## Emb-Agent Verifications/);
    assert.match(content, /Wakeup and LVDC path verified on bench/);
    assert.match(content, /Check wakeup flag clear order after sleep/);
    assert.match(content, /PASS: wakeup flag order matched expectation/);
    assert.match(content, /scope capture on PA0 wake edge/);
    assert.match(content, /Retest under low battery condition/);
    assert.match(content, /Next command: plan/);
    assert.match(content, /Tool recommendation: -/);
    assert.match(content, /Adapter health: -/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
