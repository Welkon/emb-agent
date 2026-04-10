'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));

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
    cli.main([
      'project',
      'set',
      '--field',
      'quality_gates.required_signoffs',
      '--value',
      JSON.stringify(['board-bench'])
    ]);
    fs.mkdirSync(path.join(tempProject, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'src', 'power.c'), 'void power(void) {}\n', 'utf8');
    cli.main(['last-files', 'add', 'src/power.c']);
    const runtimeConfig = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
    const statePaths = runtime.getProjectStatePaths(path.join(repoRoot, 'runtime'), tempProject, runtimeConfig);
    const session = runtime.readJson(statePaths.sessionPath);
    session.diagnostics.latest_executor = {
      name: 'bench',
      status: 'ok',
      risk: 'high',
      exit_code: 0,
      duration_ms: 1800,
      ran_at: '2026-04-09T11:00:00.000Z',
      cwd: '.',
      argv: ['node', 'scripts/bench-runner.cjs', '--case', 'wakeup'],
      evidence_hint: ['docs/VERIFICATION.md'],
      stdout_preview: 'bench pass wakeup path',
      stderr_preview: ''
    };
    session.diagnostics.human_signoffs = {
      'board-bench': {
        name: 'board-bench',
        status: 'confirmed',
        confirmed_at: '2026-04-09T11:05:00.000Z',
        note: 'engineer confirmed on real board'
      }
    };
    runtime.writeJson(statePaths.sessionPath, session);
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
    assert.match(content, /Latest executor: bench ok, exit=0, risk=high, duration=1800ms/);
    assert.match(content, /Latest executor argv: node scripts\/bench-runner\.cjs --case wakeup/);
    assert.match(content, /Latest executor evidence hint: docs\/VERIFICATION\.md/);
    assert.match(content, /Latest executor stdout preview: bench pass wakeup path/);
    assert.match(content, /Quality gates: pending|Quality gates: pass/);
    assert.match(content, /Quality gate summary:/);
    assert.match(content, /Required signoffs: board-bench/);
    assert.match(content, /Confirmed signoffs: board-bench/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
