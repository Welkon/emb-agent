'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('context hygiene stays stable for light sessions and suggests clear after handoff-heavy sessions', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-context-hygiene-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    const lightStatus = cli.buildStatus();
    assert.equal(lightStatus.context_hygiene.level, 'stable');
    assert.match(lightStatus.context_hygiene.recommendation, /no proactive cleanup is needed/);

    for (let index = 1; index <= 5; index += 1) {
      const fileName = `src/f${index}.c`;
      fs.mkdirSync(path.dirname(fileName), { recursive: true });
      fs.writeFileSync(fileName, `// f${index}\n`, 'utf8');
      cli.main(['last-files', 'add', fileName]);
    }

    cli.main(['focus', 'set', 'review board timing split']);
    cli.main(['question', 'add', 'timer reload margin enough?']);
    cli.main(['question', 'add', 'irq ordering stable after wake?']);
    cli.main(['risk', 'add', 'wakeup edge may race with debounce']);
    cli.main(['risk', 'add', 'shared timer may drift after divider switch']);

    const heavyNext = cli.buildNextContext();
    assert.equal(heavyNext.context_hygiene.level, 'suggest-clearing');
    assert.match(heavyNext.context_hygiene.recommendation, /pause now/);
    assert.equal(heavyNext.context_hygiene.compress_cli, 'node ~/.codex/emb-agent/bin/emb-agent.cjs context compress');
    assert.ok(heavyNext.next_actions.some(item => item.includes('Capture a compact snapshot before clearing')));
    assert.ok(heavyNext.next_actions.some(item => item.includes('Context reminder')));

    cli.main(['pause', 'capture heavy session before clear']);

    const resumed = cli.buildResumeContext();
    assert.equal(resumed.context_hygiene.level, 'suggest-clearing');
    assert.equal(resumed.context_hygiene.handoff_ready, true);
    assert.equal(resumed.context_hygiene.clear_hint, 'clear -> resume');
    assert.match(resumed.context_hygiene.recommendation, /a handoff exists/);
    assert.equal(resumed.memory_summary.source, 'pause');
    assert.equal(resumed.memory_summary.next_action, 'capture heavy session before clear');
    assert.equal(resumed.memory_summary.last_files.length, 5);
    assert.equal(resumed.memory_summary.open_questions[0], 'timer reload margin enough?');

    const status = cli.buildStatus();
    assert.equal(status.memory_summary.source, 'pause');
    assert.equal(status.memory_summary.known_risks[0], 'wakeup edge may race with debounce');

    const paused = cli.buildNextContext();
    assert.equal(paused.memory_summary.source, 'pause');
    assert.ok(paused.next_actions.some(item => item.includes('Compact summary')));

    const plan = cli.buildActionOutput('plan');
    assert.equal(plan.context_hygiene.level, 'suggest-clearing');
    assert.equal(plan.context_hygiene.resume_cli, 'node ~/.codex/emb-agent/bin/emb-agent.cjs resume');

    cli.main(['pause', 'clear']);
    assert.equal(cli.buildResumeContext().memory_summary, null);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('context compress stores a labeled snapshot with recovery pointers', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-context-compress-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init']);

    for (let index = 1; index <= 4; index += 1) {
      const fileName = `src/c${index}.c`;
      fs.mkdirSync(path.dirname(fileName), { recursive: true });
      fs.writeFileSync(fileName, `// c${index}\n`, 'utf8');
      cli.main(['last-files', 'add', fileName]);
    }

    cli.main(['focus', 'set', 'irq recovery after context clear']);
    cli.main(['question', 'add', 'which wake edge is stale?']);
    cli.main(['risk', 'add', 'irq acknowledge may reorder after sleep']);

    cli.main(['context', 'compress', 'resume irq recovery after clear']);

    const status = cli.buildStatus();
    assert.equal(status.memory_summary.source, 'compress');
    assert.equal(status.memory_summary.next_action, 'resume irq recovery after clear');
    assert.match(status.memory_summary.snapshot_label, /Point-in-time compress snapshot captured at/);
    assert.match(status.memory_summary.stale_note, /will not auto-update/);
    assert.ok(status.memory_summary.recovery_pointers.some(item => item.includes('status')));
    assert.ok(status.memory_summary.recovery_pointers.some(item => item.includes('dispatch next')));

    const resumed = cli.buildResumeContext();
    assert.equal(resumed.memory_summary.source, 'compress');

    cli.main(['context', 'clear']);
    assert.equal(cli.buildStatus().memory_summary, null);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
