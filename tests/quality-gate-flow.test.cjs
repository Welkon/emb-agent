'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('next stays in verify loop until required quality gates pass', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-quality-gate-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    await cli.main([
      'project',
      'set',
      '--field',
      'executors.build',
      '--value',
      JSON.stringify({
        description: 'build gate',
        argv: ['sh', '-c', 'exit 0']
      })
    ]);

    await cli.main([
      'project',
      'set',
      '--field',
      'executors.bench',
      '--value',
      JSON.stringify({
        description: 'bench gate',
        argv: ['sh', '-c', 'exit 7'],
        risk: 'high'
      })
    ]);

    await cli.main([
      'project',
      'set',
      '--field',
      'quality_gates.required_executors',
      '--value',
      JSON.stringify(['build', 'bench'])
    ]);
    await cli.main([
      'project',
      'set',
      '--field',
      'quality_gates.required_signoffs',
      '--value',
      JSON.stringify(['board-bench'])
    ]);

    await cli.main(['focus', 'set', 'close loop with required gates']);
    await cli.main(['capability', 'run', 'do']);

    const beforeRun = cli.buildNextContext();
    assert.equal(beforeRun.next.command, 'verify');
    assert.equal(beforeRun.quality_gates.gate_status, 'pending');
    assert.equal(beforeRun.permission_gates[0].kind, 'quality-gate');
    assert.equal(beforeRun.permission_gates[0].state, 'pending');
    assert.match(beforeRun.quality_gates.status_summary, /Executor gates pending: build, bench/);
    assert.ok(beforeRun.next_actions.some(item => item.includes('quality_gate_run=executor run build')));
    assert.ok(beforeRun.next_actions.some(item => item.includes('quality_gate_run=executor run bench')));
    assert.ok(beforeRun.next_actions.some(item => item.includes('quality_gate_signoff=verify confirm board-bench')));

    const runtimeRoot = path.join(repoRoot, 'runtime');
    const runtimeConfig = runtime.loadRuntimeConfig(runtimeRoot);
    const statePaths = runtime.getProjectStatePaths(runtimeRoot, tempProject, runtimeConfig);
    const buildPassedSession = runtime.readJson(statePaths.sessionPath);
    buildPassedSession.last_command = 'executor run build';
    buildPassedSession.diagnostics = {
      ...(buildPassedSession.diagnostics || {}),
      latest_executor: {
        name: 'build',
        status: 'ok',
        risk: 'normal',
        exit_code: 0,
        duration_ms: 120,
        ran_at: new Date().toISOString(),
        cwd: '.',
        argv: ['sh', '-c', 'exit 0'],
        evidence_hint: [],
        stdout_preview: '',
        stderr_preview: ''
      },
      executor_history: {
        ...((buildPassedSession.diagnostics && buildPassedSession.diagnostics.executor_history) || {}),
        build: {
          name: 'build',
          status: 'ok',
          risk: 'normal',
          exit_code: 0,
          duration_ms: 120,
          ran_at: new Date().toISOString(),
          cwd: '.',
          argv: ['sh', '-c', 'exit 0'],
          evidence_hint: [],
          stdout_preview: '',
          stderr_preview: ''
        }
      }
    };
    fs.writeFileSync(statePaths.sessionPath, JSON.stringify(buildPassedSession, null, 2) + '\n', 'utf8');

    const afterBuild = cli.buildNextContext();
    assert.equal(afterBuild.next.command, 'verify');
    assert.equal(afterBuild.quality_gates.gate_status, 'pending');
    assert.match(afterBuild.next.reason, /Executor gates pending: bench/);
    assert.deepEqual(afterBuild.quality_gates.pending_gates, ['bench']);
    assert.deepEqual(afterBuild.quality_gates.pending_signoffs, ['board-bench']);
    assert.ok(afterBuild.next_actions.some(item => item.includes('quality_gate_run=executor run bench')));
    assert.ok(afterBuild.next_actions.some(item => item.includes('quality_gate_signoff=verify confirm board-bench')));

    const benchFailedSession = runtime.readJson(statePaths.sessionPath);
    benchFailedSession.last_command = 'executor run bench';
    benchFailedSession.diagnostics = {
      ...(benchFailedSession.diagnostics || {}),
      latest_executor: {
        name: 'bench',
        status: 'failed',
        risk: 'high',
        exit_code: 7,
        duration_ms: 180,
        ran_at: new Date().toISOString(),
        cwd: '.',
        argv: ['sh', '-c', 'exit 7'],
        evidence_hint: [],
        stdout_preview: '',
        stderr_preview: 'exit 7'
      },
      executor_history: {
        ...((benchFailedSession.diagnostics && benchFailedSession.diagnostics.executor_history) || {}),
        bench: {
          name: 'bench',
          status: 'failed',
          risk: 'high',
          exit_code: 7,
          duration_ms: 180,
          ran_at: new Date().toISOString(),
          cwd: '.',
          argv: ['sh', '-c', 'exit 7'],
          evidence_hint: [],
          stdout_preview: '',
          stderr_preview: 'exit 7'
        }
      }
    };
    fs.writeFileSync(statePaths.sessionPath, JSON.stringify(benchFailedSession, null, 2) + '\n', 'utf8');

    const afterBenchFail = cli.buildNextContext();
    assert.equal(afterBenchFail.next.command, 'verify');
    assert.equal(afterBenchFail.quality_gates.gate_status, 'failed');
    assert.equal(afterBenchFail.permission_gates[0].state, 'blocked');
    assert.deepEqual(afterBenchFail.quality_gates.failed_gates, ['bench']);
    assert.deepEqual(afterBenchFail.quality_gates.pending_signoffs, ['board-bench']);
    assert.ok(afterBenchFail.next_actions.some(item => item.includes('quality_gate_run=executor run bench')));
    assert.ok(afterBenchFail.next_actions.some(item => item.includes('quality_gate_signoff=verify confirm board-bench')));

    const verify = cli.buildActionOutput('verify');
    assert.equal(verify.quality_gates.gate_status, 'failed');
    assert.equal(verify.permission_gates[0].kind, 'quality-gate');
    assert.equal(verify.permission_gates[0].state, 'blocked');
    assert.ok(verify.quality_gates.recommended_runs.includes('executor run bench'));
    assert.ok(verify.quality_gates.recommended_signoffs.includes('verify confirm board-bench'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('verify loop can close required skill gates through skills run', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-skill-gate-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    writeFile(
      path.join(tempProject, '.emb-agent', 'skills', 'scope-debug', 'SKILL.md'),
      [
        '---',
        'name: scope-debug',
        'description: Probe the active scope connection and return capture status.',
        'execution_mode: command',
        'evidence_hint:',
        '  - docs/VERIFICATION.md',
        'command:',
        '  - node',
        '  - scripts/run.cjs',
        '---',
        '',
        '# scope-debug',
        '',
        'Run bench-side scope validation.',
        ''
      ].join('\n')
    );
    writeFile(
      path.join(tempProject, '.emb-agent', 'skills', 'scope-debug', 'scripts', 'run.cjs'),
      [
        "'use strict';",
        '',
        "process.stdout.write(JSON.stringify({ status: 'ok', measurement: 'captured' }) + '\\n');",
        ''
      ].join('\n')
    );

    await cli.main([
      'project',
      'set',
      '--field',
      'quality_gates.required_skills',
      '--value',
      JSON.stringify(['scope-debug'])
    ]);
    await cli.main(['focus', 'set', 'close loop with required scope debug skill']);
    await cli.main(['capability', 'run', 'do']);

    const beforeRun = cli.buildNextContext();
    assert.equal(beforeRun.next.command, 'verify');
    assert.equal(beforeRun.quality_gates.gate_status, 'pending');
    assert.match(beforeRun.quality_gates.status_summary, /Skill gates pending: scope-debug/);
    assert.deepEqual(beforeRun.quality_gates.required_skills, ['scope-debug']);
    assert.deepEqual(beforeRun.quality_gates.pending_skills, ['scope-debug']);
    assert.ok(beforeRun.next_actions.some(item => item.includes('quality_gate_run=skills run scope-debug')));

    await cli.main(['skills', 'run', 'scope-debug']);

    const runtimeRoot = path.join(repoRoot, 'runtime');
    const runtimeConfig = runtime.loadRuntimeConfig(runtimeRoot);
    const statePaths = runtime.getProjectStatePaths(runtimeRoot, tempProject, runtimeConfig);
    const session = runtime.readJson(statePaths.sessionPath);

    assert.equal(session.last_command, 'skills run scope-debug');
    assert.equal(session.diagnostics.latest_skill.name, 'scope-debug');
    assert.equal(session.diagnostics.latest_skill.status, 'ok');
    assert.deepEqual(session.diagnostics.latest_skill.evidence_hint, ['docs/VERIFICATION.md']);

    const afterRun = cli.buildActionOutput('verify');
    assert.equal(afterRun.quality_gates.gate_status, 'pass');
    assert.deepEqual(afterRun.quality_gates.passed_skills, ['scope-debug']);
    assert.deepEqual(afterRun.quality_gates.pending_skills, []);
    assert.deepEqual(afterRun.quality_gates.recommended_runs, []);
    assert.ok(afterRun.checklist.some(item => item.includes('Verification skill "scope-debug"')));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('verify confirm and reject update human signoff gates', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-human-signoff-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main([
      'project',
      'set',
      '--field',
      'quality_gates.required_signoffs',
      '--value',
      JSON.stringify(['board-bench', 'thermal-check'])
    ]);
    await cli.main(['focus', 'set', 'wait for human board validation']);
    await cli.main(['capability', 'run', 'do']);

    const beforeConfirm = cli.buildNextContext();
    assert.equal(beforeConfirm.quality_gates.gate_status, 'pending');
    assert.equal(beforeConfirm.permission_gates[0].state, 'pending');
    assert.match(beforeConfirm.quality_gates.status_summary, /Waiting for engineer confirmation: board-bench, thermal-check/);
    assert.deepEqual(beforeConfirm.quality_gates.pending_signoffs, ['board-bench', 'thermal-check']);

    await cli.main(['verify', 'confirm', 'board-bench', 'engineer confirmed pwm output on board']);
    const afterConfirm = cli.buildNextContext();
    assert.equal(afterConfirm.next.command, 'verify');
    assert.equal(afterConfirm.quality_gates.gate_status, 'pending');
    assert.match(afterConfirm.next.reason, /Waiting for engineer confirmation: thermal-check/);
    assert.deepEqual(afterConfirm.quality_gates.confirmed_signoffs, ['board-bench']);
    assert.deepEqual(afterConfirm.quality_gates.pending_signoffs, ['thermal-check']);

    await cli.main(['verify', 'reject', 'thermal-check', 'thermal rise exceeded target']);
    const afterReject = cli.buildNextContext();
    assert.equal(afterReject.next.command, 'verify');
    assert.equal(afterReject.quality_gates.gate_status, 'failed');
    assert.deepEqual(afterReject.quality_gates.rejected_signoffs, ['thermal-check']);

    const verify = cli.buildActionOutput('verify');
    assert.equal(verify.quality_gates.gate_status, 'failed');
    assert.ok(verify.checklist.some(item => item.includes('Human signoff "board-bench"')));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
