'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('ingest hardware appends stable facts into hw truth file', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-ingest-hw-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main([
      'ingest',
      'hardware',
      '--mcu',
      'PMS150G',
      '--truth',
      'PA5 reserved for programming',
      '--constraint',
      'ISR must stay thin',
      '--unknown',
      'board pull-up value on KEY_IN',
      '--source',
      'docs/PMS150G-manual.md'
    ]);

    const content = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');
    const status = cli.buildStatus();

    assert.match(content, /model: "PMS150G"/);
    assert.match(content, /PA5 reserved for programming/);
    assert.match(content, /ISR must stay thin/);
    assert.match(content, /board pull-up value on KEY_IN/);
    assert.match(content, /docs\/PMS150G-manual\.md/);
    assert.equal(status.last_files[0], '.emb-agent/hw.yaml');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('ingest hardware can write structured signals and peripherals into hw truth', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-ingest-signals-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main([
      'ingest',
      'hardware',
      '--signal',
      'PWM_OUT',
      '--pin',
      'PA3',
      '--dir',
      'output',
      '--default-state',
      'low',
      '--note',
      'TM2 PWM output',
      '--confirmed',
      'true',
      '--peripheral',
      'PWM',
      '--usage',
      'warm dimming',
      '--peripheral',
      'Timer2',
      '--usage',
      'period base'
    ]);

    cli.main([
      'ingest',
      'hardware',
      '--signal',
      'PWM_OUT',
      '--note',
      'TM2 PWM output on PA3',
      '--peripheral',
      'PWM',
      '--usage',
      'dimming output'
    ]);

    const content = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');

    assert.doesNotMatch(content, /INPUT_1/);
    assert.doesNotMatch(content, /OUTPUT_1/);
    assert.match(content, /- name: "PWM_OUT"/);
    assert.match(content, /pin: "PA3"/);
    assert.match(content, /direction: "output"/);
    assert.match(content, /default_state: "low"/);
    assert.match(content, /confirmed: true/);
    assert.match(content, /note: "TM2 PWM output on PA3"/);
    assert.match(content, /- name: "PWM"/);
    assert.match(content, /usage: "dimming output"/);
    assert.match(content, /- name: "Timer2"/);
    assert.match(content, /usage: "period base"/);
    assert.equal((content.match(/- name: "PWM_OUT"/g) || []).length, 1);
    assert.equal((content.match(/- name: "PWM"/g) || []).length, 1);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('declare hardware aliases ingest hardware for direct board truth updates', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-declare-hw-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main([
      'declare',
      'hardware',
      '--mcu',
      'SC8F072',
      '--package',
      'SOP8',
      '--signal',
      'PWM_OUT',
      '--pin',
      'PA3',
      '--dir',
      'output',
      '--peripheral',
      'PWM',
      '--usage',
      'dimming'
    ]);

    const content = fs.readFileSync(path.join(tempProject, '.emb-agent', 'hw.yaml'), 'utf8');
    const status = cli.buildStatus();

    assert.match(content, /model: "SC8F072"/);
    assert.match(content, /package: "SOP8"/);
    assert.match(content, /- name: "PWM_OUT"/);
    assert.match(content, /pin: "PA3"/);
    assert.match(content, /- name: "PWM"/);
    assert.match(content, /usage: "dimming"/);
    assert.equal(status.last_files[0], '.emb-agent/hw.yaml');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('ingest requirements appends reusable requirement facts into req truth file', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-ingest-req-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main([
      'ingest',
      'requirements',
      '--goal',
      'stabilize wakeup path',
      '--feature',
      'short press toggles relay',
      '--constraint',
      'boot within 100 ms',
      '--accept',
      'wakeup works after 100 cycles',
      '--failure',
      'invalid sensor data forces safe off',
      '--unknown',
      'long-press duration not confirmed',
      '--source',
      'README.md'
    ]);

    const content = fs.readFileSync(path.join(tempProject, '.emb-agent', 'req.yaml'), 'utf8');
    const status = cli.buildStatus();

    assert.match(content, /stabilize wakeup path/);
    assert.match(content, /short press toggles relay/);
    assert.match(content, /boot within 100 ms/);
    assert.match(content, /wakeup works after 100 cycles/);
    assert.match(content, /invalid sensor data forces safe off/);
    assert.match(content, /long-press duration not confirmed/);
    assert.match(content, /README\.md/);
    assert.equal(status.last_files[0], '.emb-agent/req.yaml');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
