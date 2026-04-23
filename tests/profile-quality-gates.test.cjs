'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('profile default quality gates appear in effective status without mutating raw project config', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-profile-quality-status-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject, '--profile', 'baremetal-8bit']);

    process.chdir(tempProject);
    await cli.main(['init']);

    const rawProjectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const status = cli.buildStatus();
    const projectView = cli.buildProjectShow(true);

    assert.deepEqual(rawProjectConfig.quality_gates.required_skills, []);
    assert.deepEqual(rawProjectConfig.quality_gates.required_executors, []);
    assert.deepEqual(rawProjectConfig.quality_gates.required_signoffs, []);
    assert.deepEqual(status.quality_gates.required_skills, ['scope-capture']);
    assert.deepEqual(status.quality_gates.required_executors, []);
    assert.deepEqual(status.quality_gates.required_signoffs, ['board-bench']);
    assert.deepEqual(status.quality_gates.pending_skills, ['scope-capture']);
    assert.deepEqual(status.quality_gates.pending_signoffs, ['board-bench']);
    assert.equal(status.quality_gates.gate_status, 'pending');
    assert.deepEqual(projectView.effective.quality_gates.required_skills, ['scope-capture']);
    assert.deepEqual(projectView.effective.quality_gates.required_signoffs, ['board-bench']);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('next suggests installing missing profile-default verification skills before running them', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-profile-quality-next-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject, '--profile', 'baremetal-8bit']);

    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['focus', 'set', 'close loop after pwm change']);
    await cli.main(['do']);

    const next = cli.buildNextContext();

    assert.equal(next.next.command, 'verify');
    assert.deepEqual(next.quality_gates.required_skills, ['scope-capture']);
    assert.deepEqual(next.quality_gates.required_signoffs, ['board-bench']);
    assert.ok(next.next_actions.some(item => item.includes('quality_gate_install=') && item.includes('--skill scope-capture')));
    assert.ok(next.next_actions.some(item => item.includes('quality_gate_run=skills run scope-capture')));
    assert.ok(next.next_actions.some(item => item.includes('quality_gate_signoff=verify confirm board-bench')));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
