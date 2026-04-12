'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

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

function updateProjectConfig(projectRoot, mutator) {
  const configPath = path.join(projectRoot, '.emb-agent', 'project.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  mutator(config);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

async function runJson(args) {
  return JSON.parse(await captureStdout(() => cli.main(args)));
}

test('scan save honors write ask rules before touching doc or truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-scan-write-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['scan-save'];
    });

    const docPath = path.join(tempProject, 'docs', 'HARDWARE-LOGIC.md');
    const truthPath = path.join(tempProject, '.emb-agent', 'hw.yaml');
    const docBeforeExists = fs.existsSync(docPath);
    const docBefore = docBeforeExists ? fs.readFileSync(docPath, 'utf8') : '';
    const truthBefore = fs.readFileSync(truthPath, 'utf8');

    const blocked = await runJson([
      'scan',
      'save',
      'hardware',
      'Mapped current firmware entry and truth sources',
      '--fact',
      'main.c is current entry reference',
      '--question',
      'Need pin map confirmation from schematic',
      '--read',
      'docs/PMS150G-manual.md'
    ]);

    assert.equal(blocked.status, 'permission-pending');
    assert.equal(blocked.permission_decision.decision, 'ask');
    assert.equal(blocked.permission_decision.reason_code, 'policy-ask');
    assert.equal(fs.existsSync(docPath), docBeforeExists);
    if (docBeforeExists) {
      assert.equal(fs.readFileSync(docPath, 'utf8'), docBefore);
    }
    assert.equal(fs.readFileSync(truthPath, 'utf8'), truthBefore);

    const allowed = await runJson([
      'scan',
      'save',
      '--confirm',
      'hardware',
      'Mapped current firmware entry and truth sources',
      '--fact',
      'main.c is current entry reference',
      '--question',
      'Need pin map confirmation from schematic',
      '--read',
      'docs/PMS150G-manual.md'
    ]);

    assert.equal(allowed.permission_decision.decision, 'allow');
    assert.equal(allowed.permission_decision.reason_code, 'explicit-confirmed');
    assert.match(fs.readFileSync(docPath, 'utf8'), /Mapped current firmware entry and truth sources/);
    assert.match(fs.readFileSync(truthPath, 'utf8'), /main\.c is current entry reference/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('plan save honors write ask rules before touching doc or requirements', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-plan-write-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['plan-save'];
    });

    const docPath = path.join(tempProject, 'docs', 'DEBUG-NOTES.md');
    const reqPath = path.join(tempProject, '.emb-agent', 'req.yaml');
    const docBeforeExists = fs.existsSync(docPath);
    const docBefore = docBeforeExists ? fs.readFileSync(docPath, 'utf8') : '';
    const reqBefore = fs.readFileSync(reqPath, 'utf8');

    const blocked = await runJson([
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

    assert.equal(blocked.status, 'permission-pending');
    assert.equal(blocked.permission_decision.decision, 'ask');
    assert.equal(blocked.permission_decision.reason_code, 'policy-ask');
    assert.equal(fs.existsSync(docPath), docBeforeExists);
    if (docBeforeExists) {
      assert.equal(fs.readFileSync(docPath, 'utf8'), docBefore);
    }
    assert.equal(fs.readFileSync(reqPath, 'utf8'), reqBefore);

    const allowed = await runJson([
      'plan',
      'save',
      '--confirm',
      'Prepare minimal wakeup-timer fix plan',
      '--risk',
      'Wakeup path may re-trigger timer flag',
      '--step',
      'Recheck ISR clear path before main loop change',
      '--verify',
      'Verify wakeup path on bench'
    ]);

    assert.equal(allowed.permission_decision.decision, 'allow');
    assert.equal(allowed.permission_decision.reason_code, 'explicit-confirmed');
    assert.match(fs.readFileSync(docPath, 'utf8'), /Prepare minimal wakeup-timer fix plan/);
    assert.match(fs.readFileSync(reqPath, 'utf8'), /Verify wakeup path on bench/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('review save honors write deny rules before touching review report', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-review-write-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject, '--profile', 'rtos-iot', '--pack', 'connected-appliance']);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.deny = ['review-save'];
    });

    const reviewPath = path.join(tempProject, 'docs', 'REVIEW-REPORT.md');
    assert.equal(fs.existsSync(reviewPath), false);

    const blocked = await runJson([
      'review',
      'save',
      'OTA rollback path needs explicit recovery check',
      '--scope',
      'ota rollback path',
      '--finding',
      'Rollback trigger is not yet documented',
      '--check',
      'Verify offline default behavior after rollback'
    ]);

    assert.equal(blocked.status, 'permission-denied');
    assert.equal(blocked.permission_decision.decision, 'deny');
    assert.equal(blocked.permission_decision.reason_code, 'policy-deny');
    assert.equal(fs.existsSync(reviewPath), false);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('verify save honors write ask rules before touching verification report', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-verify-write-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['verify-save'];
    });

    const verifyPath = path.join(tempProject, 'docs', 'VERIFICATION.md');
    assert.equal(fs.existsSync(verifyPath), false);

    const blocked = await runJson([
      'verify',
      'save',
      'Wakeup and LVDC path verified on bench',
      '--check',
      'Check wakeup flag clear order after sleep',
      '--result',
      'PASS: wakeup flag order matched expectation'
    ]);

    assert.equal(blocked.status, 'permission-pending');
    assert.equal(blocked.permission_decision.decision, 'ask');
    assert.equal(blocked.permission_decision.reason_code, 'policy-ask');
    assert.equal(fs.existsSync(verifyPath), false);

    const allowed = await runJson([
      'verify',
      'save',
      '--confirm',
      'Wakeup and LVDC path verified on bench',
      '--check',
      'Check wakeup flag clear order after sleep',
      '--result',
      'PASS: wakeup flag order matched expectation'
    ]);

    assert.equal(allowed.permission_decision.decision, 'allow');
    assert.equal(allowed.permission_decision.reason_code, 'explicit-confirmed');
    assert.match(fs.readFileSync(verifyPath, 'utf8'), /Wakeup and LVDC path verified on bench/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('note add honors write ask rules before touching doc or hardware truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-note-write-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    updateProjectConfig(tempProject, config => {
      config.permissions.writes.ask = ['note-add'];
    });

    const docPath = path.join(tempProject, 'docs', 'HARDWARE-LOGIC.md');
    const truthPath = path.join(tempProject, '.emb-agent', 'hw.yaml');
    const docBeforeExists = fs.existsSync(docPath);
    const docBefore = docBeforeExists ? fs.readFileSync(docPath, 'utf8') : '';
    const truthBefore = fs.readFileSync(truthPath, 'utf8');

    const blocked = await runJson([
      'note',
      'add',
      'hardware',
      'PA5 is reserved for programming path',
      '--kind',
      'hardware_truth',
      '--evidence',
      'docs/PMS150G-manual.md',
      '--unverified',
      'Need board-level probe confirmation'
    ]);

    assert.equal(blocked.status, 'permission-pending');
    assert.equal(blocked.permission_decision.decision, 'ask');
    assert.equal(blocked.permission_decision.reason_code, 'policy-ask');
    assert.equal(fs.existsSync(docPath), docBeforeExists);
    if (docBeforeExists) {
      assert.equal(fs.readFileSync(docPath, 'utf8'), docBefore);
    }
    assert.equal(fs.readFileSync(truthPath, 'utf8'), truthBefore);

    const allowed = await runJson([
      'note',
      'add',
      '--confirm',
      'hardware',
      'PA5 is reserved for programming path',
      '--kind',
      'hardware_truth',
      '--evidence',
      'docs/PMS150G-manual.md',
      '--unverified',
      'Need board-level probe confirmation'
    ]);

    assert.equal(allowed.permission_decision.decision, 'allow');
    assert.equal(allowed.permission_decision.reason_code, 'explicit-confirmed');
    assert.match(fs.readFileSync(docPath, 'utf8'), /PA5 is reserved for programming path/);
    assert.match(fs.readFileSync(truthPath, 'utf8'), /PA5 is reserved for programming path/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
