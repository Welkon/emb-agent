'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const templateCli = require(path.join(repoRoot, 'runtime', 'scripts', 'template.cjs'));

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

test('template list exposes PMB180B starter templates', async () => {
  const stdout = await captureStdout(() => templateCli.listCommand());
  const listed = JSON.parse(stdout);

  assert.ok(listed.some(item => item.name === 'pmb180b-hw-starter'));
  assert.ok(listed.some(item => item.name === 'pmb180b-req-starter'));
  assert.ok(listed.some(item => item.name === 'sc8f072-hw-starter'));
  assert.ok(listed.some(item => item.name === 'sc8f072-req-starter'));
  assert.ok(listed.some(item => item.name === 'pms150g-hw-starter'));
  assert.ok(listed.some(item => item.name === 'pms150g-req-starter'));
  assert.ok(listed.some(item => item.name === 'power-charging'));
  assert.ok(listed.some(item => item.name === 'task-manifest'));
});

test('template show previews task manifest template', async () => {
  const stdout = await captureStdout(() => templateCli.showCommand('task-manifest'));
  const shown = JSON.parse(stdout);

  assert.equal(shown.name, 'task-manifest');
  assert.equal(shown.default_output, '.emb-agent/tasks/{{SLUG}}/task.json');
  assert.match(shown.preview, /"status": "planning"/);
  assert.match(shown.preview, /"dev_type": "embedded"/);
  assert.match(shown.preview, /"next_action": \[/);
});

test('template fill renders PMB180B starter hw truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-template-pmb180b-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    const stdout = await captureStdout(() =>
      templateCli.fillCommand('pmb180b-hw-starter', '', {}, false)
    );
    const result = JSON.parse(stdout);
    const createdPath = path.join(tempProject, result.created);
    const content = fs.readFileSync(createdPath, 'utf8');

    assert.equal(result.template, 'pmb180b-hw-starter');
    assert.match(content, /model: "PMB180B"/);
    assert.match(content, /CHG_TEMP\.4 && CHG_TEMP\.3/);
    assert.match(content, /LPWMG0\/1\/2 share/);
    assert.match(content, /The current manual does not show ADC resources/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('template fill renders PMB180B starter requirement truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-template-pmb180b-req-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    const stdout = await captureStdout(() =>
      templateCli.fillCommand('pmb180b-req-starter', '', {}, false)
    );
    const result = JSON.parse(stdout);
    const createdPath = path.join(tempProject, result.created);
    const content = fs.readFileSync(createdPath, 'utf8');

    assert.equal(result.template, 'pmb180b-req-starter');
    assert.match(content, /PMB180B/);
    assert.match(content, /CHG_TEMP\.1/);
    assert.match(content, /0\.15V/);
    assert.match(content, /TM2 PWM or LPWMG/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('template fill renders SC8F072 starter hw truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-template-sc8f072-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    const stdout = await captureStdout(() =>
      templateCli.fillCommand('sc8f072-hw-starter', '', {}, false)
    );
    const result = JSON.parse(stdout);
    const createdPath = path.join(tempProject, result.created);
    const content = fs.readFileSync(createdPath, 'utf8');

    assert.equal(result.template, 'sc8f072-hw-starter');
    assert.match(content, /model: "SC8F072"/);
    assert.match(content, /10-bit PWM/);
    assert.match(content, /RBIAS_H\/RBIAS_L \+ LVDS/);
    assert.match(content, /TMR0 has no hardware auto-reload/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('template fill renders SC8F072 starter requirement truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-template-sc8f072-req-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    const stdout = await captureStdout(() =>
      templateCli.fillCommand('sc8f072-req-starter', '', {}, false)
    );
    const result = JSON.parse(stdout);
    const createdPath = path.join(tempProject, result.created);
    const content = fs.readFileSync(createdPath, 'utf8');

    assert.equal(result.template, 'sc8f072-req-starter');
    assert.match(content, /SC8F072/);
    assert.match(content, /PWM0~PWM3 share the period register/);
    assert.match(content, /TMR0/);
    assert.match(content, /reference-source/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('template fill renders PMS150G starter hw truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-template-pms150g-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    const stdout = await captureStdout(() =>
      templateCli.fillCommand('pms150g-hw-starter', '', {}, false)
    );
    const result = JSON.parse(stdout);
    const createdPath = path.join(tempProject, result.created);
    const content = fs.readFileSync(createdPath, 'utf8');

    assert.equal(result.template, 'pms150g-hw-starter');
    assert.match(content, /model: "PMS150G"/);
    assert.match(content, /TM2 PWM/);
    assert.match(content, /but no ADC/);
    assert.match(content, /PA5\/PRSTB/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('template fill renders PMS150G starter requirement truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-template-pms150g-req-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    const stdout = await captureStdout(() =>
      templateCli.fillCommand('pms150g-req-starter', '', {}, false)
    );
    const result = JSON.parse(stdout);
    const createdPath = path.join(tempProject, result.created);
    const content = fs.readFileSync(createdPath, 'utf8');

    assert.equal(result.template, 'pms150g-req-starter');
    assert.match(content, /PMS150G/);
    assert.match(content, /does not support ADC/);
    assert.match(content, /PA3\/PA4/);
    assert.match(content, /OTP \+ small RAM/);
  } finally {
    process.chdir(currentCwd);
  }
});
