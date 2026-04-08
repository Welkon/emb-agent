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
  assert.ok(listed.some(item => item.name === 'power-charging'));
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
    assert.match(content, /LPWMG0\/1\/2 共享/);
    assert.match(content, /当前手册未体现 ADC 资源/);
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
    assert.match(content, /TM2 PWM 还是 LPWMG/);
  } finally {
    process.chdir(currentCwd);
  }
});
