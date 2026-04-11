'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const executorCommandHelpers = require(path.join(repoRoot, 'runtime', 'lib', 'executor-command.cjs'));

async function captureStdout(run) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return stdout;
}

test('executor commands list show and run project-defined entrypoints', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-executor-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const scriptPath = path.join(tempProject, 'scripts', 'bench-runner.cjs');
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(
      scriptPath,
      [
        "'use strict';",
        '',
        'process.stdout.write(JSON.stringify({',
        '  cwd: process.cwd(),',
        '  args: process.argv.slice(2),',
        "  env: process.env.EXECUTOR_MODE || ''",
        '}));',
        ''
      ].join('\n'),
      'utf8'
    );

    await cli.main([
      'project',
      'set',
      '--field',
      'executors.bench',
      '--value',
      JSON.stringify({
        description: 'board bench runner',
        argv: [process.execPath, 'scripts/bench-runner.cjs'],
        cwd: '.',
        env: {
          EXECUTOR_MODE: 'smoke'
        },
        allow_extra_args: true,
        risk: 'high',
        evidence_hint: ['docs/VERIFICATION.md']
      })
    ]);

    const listResult = JSON.parse(await captureStdout(() => cli.main(['executor', 'list'])));
    assert.equal(listResult.executors.length, 1);
    assert.equal(listResult.executors[0].name, 'bench');
    assert.equal(listResult.executors[0].risk, 'high');

    const showResult = JSON.parse(await captureStdout(() => cli.main(['executor', 'show', 'bench'])));
    assert.equal(showResult.executor.name, 'bench');
    assert.deepEqual(showResult.executor.argv, [process.execPath, 'scripts/bench-runner.cjs']);
    assert.deepEqual(showResult.executor.evidence_hint, ['docs/VERIFICATION.md']);

    let savedSession = {};
    const runtimeConfig = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
    const helpers = executorCommandHelpers.createExecutorCommandHelpers({
      path,
      process,
      childProcess: {
        spawnSync(command, args, options) {
          return {
            status: 0,
            signal: null,
            stdout: JSON.stringify({
              command,
              args,
              cwd: options.cwd,
              env: options.env.EXECUTOR_MODE || ''
            }),
            stderr: '',
            error: null
          };
        }
      },
      runtime,
      resolveProjectRoot: () => tempProject,
      getProjectConfig: () => runtime.loadProjectConfig(tempProject, runtimeConfig),
      updateSession(mutator) {
        const session = { last_command: '', diagnostics: {} };
        mutator(session);
        savedSession = session;
        return session;
      }
    });

    const runResult = helpers.runExecutor('bench', ['--confirm', '--', '--case', 'pwm']);
    assert.equal(runResult.executor, 'bench');
    assert.equal(runResult.status, 'ok');
    assert.equal(runResult.risk, 'high');
    assert.equal(runResult.permission_decision.decision, 'allow');
    assert.equal(runResult.permission_decision.reason_code, 'explicit-confirmed');
    assert.ok(Array.isArray(runResult.permission_gates));
    assert.equal(runResult.permission_gates[0].kind, 'explicit-confirmation');
    assert.deepEqual(runResult.extra_args, ['--case', 'pwm']);
    assert.equal(typeof runResult.ran_at, 'string');
    assert.equal(savedSession.last_command, 'executor run bench');
    assert.equal(savedSession.diagnostics.latest_executor.name, 'bench');
    assert.equal(savedSession.diagnostics.latest_executor.status, 'ok');
    assert.equal(savedSession.diagnostics.latest_executor.risk, 'high');
    assert.deepEqual(savedSession.diagnostics.latest_executor.evidence_hint, ['docs/VERIFICATION.md']);
    assert.equal(savedSession.diagnostics.latest_executor.cwd, '.');
    assert.equal(savedSession.diagnostics.latest_executor.stderr_preview, '');
    assert.equal(savedSession.diagnostics.executor_history.bench.name, 'bench');
    assert.equal(savedSession.diagnostics.executor_history.bench.status, 'ok');

    const payload = JSON.parse(runResult.stdout);
    assert.equal(payload.command, process.execPath);
    assert.equal(payload.cwd, tempProject);
    assert.deepEqual(payload.args, ['scripts/bench-runner.cjs', '--case', 'pwm']);
    assert.equal(payload.env, 'smoke');
    assert.match(savedSession.diagnostics.latest_executor.stdout_preview, /"command"/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('executor run requires explicit confirmation for high-risk entries', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-executor-confirm-'));
  const currentCwd = process.cwd();
  let spawnCalls = 0;

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main([
      'project',
      'set',
      '--field',
      'executors.flash',
      '--value',
      JSON.stringify({
        description: 'flash chip',
        argv: [process.execPath, '-e', "process.stdout.write('flashed')"],
        risk: 'high'
      })
    ]);

    const runtimeConfig = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
    const helpers = executorCommandHelpers.createExecutorCommandHelpers({
      path,
      process,
      childProcess: {
        spawnSync() {
          spawnCalls += 1;
          return {
            status: 0,
            signal: null,
            stdout: 'flashed',
            stderr: '',
            error: null
          };
        }
      },
      runtime,
      resolveProjectRoot: () => tempProject,
      getProjectConfig: () => runtime.loadProjectConfig(tempProject, runtimeConfig),
      updateSession(mutator) {
        const session = { last_command: '', diagnostics: {} };
        mutator(session);
        return session;
      }
    });

    const blocked = helpers.runExecutor('flash', []);
    assert.equal(blocked.status, 'permission-pending');
    assert.ok(blocked.high_risk_clarity);
    assert.equal(blocked.high_risk_clarity.enabled, true);
    assert.equal(blocked.permission_decision.decision, 'ask');
    assert.equal(blocked.permission_decision.reason_code, 'high-risk-confirmation');
    assert.ok(Array.isArray(blocked.permission_gates));
    assert.equal(blocked.permission_gates[0].kind, 'explicit-confirmation');
    assert.equal(blocked.permission_gates[0].state, 'pending');
    assert.equal(spawnCalls, 0);

    const allowed = helpers.runExecutor('flash', ['--confirm']);
    assert.equal(allowed.status, 'ok');
    assert.equal(allowed.permission_decision.decision, 'allow');
    assert.equal(allowed.permission_decision.reason_code, 'explicit-confirmed');
    assert.ok(Array.isArray(allowed.permission_gates));
    assert.equal(allowed.permission_gates[0].kind, 'explicit-confirmation');
    assert.equal(spawnCalls, 1);
  } finally {
    process.chdir(currentCwd);
  }
});

test('executor run rejects extra args when executor is fixed-argv only', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-executor-noextra-'));
  const currentCwd = process.cwd();

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
        description: 'fixed build entrypoint',
        argv: [process.execPath, '-e', "process.stdout.write('ok')"]
      })
    ]);

    await assert.rejects(
      () => cli.main(['executor', 'run', 'build', '--', '--release']),
      /does not allow extra args/
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('executor run honors project permission deny rules before spawning', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-executor-deny-'));
  const currentCwd = process.cwd();
  let spawnCalls = 0;

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
        description: 'build firmware',
        argv: [process.execPath, '-e', "process.stdout.write('ok')"]
      })
    ]);
    await cli.main([
      'project',
      'set',
      '--confirm',
      '--field',
      'permissions.executors.deny',
      '--value',
      JSON.stringify(['build'])
    ]);

    const runtimeConfig = runtime.loadRuntimeConfig(path.join(repoRoot, 'runtime'));
    const helpers = executorCommandHelpers.createExecutorCommandHelpers({
      path,
      process,
      childProcess: {
        spawnSync() {
          spawnCalls += 1;
          return {
            status: 0,
            signal: null,
            stdout: 'ok',
            stderr: '',
            error: null
          };
        }
      },
      runtime,
      resolveProjectRoot: () => tempProject,
      getProjectConfig: () => runtime.loadProjectConfig(tempProject, runtimeConfig),
      updateSession(mutator) {
        const session = { last_command: '', diagnostics: {} };
        mutator(session);
        return session;
      }
    });

    const denied = helpers.runExecutor('build', []);
    assert.equal(denied.status, 'permission-denied');
    assert.equal(denied.permission_decision.decision, 'deny');
    assert.equal(denied.permission_decision.reason_code, 'policy-deny');
    assert.ok(Array.isArray(denied.permission_gates));
    assert.equal(denied.permission_gates[0].kind, 'permission-rule');
    assert.equal(denied.permission_gates[0].state, 'blocked');
    assert.equal(spawnCalls, 0);
  } finally {
    process.chdir(currentCwd);
  }
});
