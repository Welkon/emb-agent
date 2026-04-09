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
    assert.ok(heavyNext.next_actions.some(item => item.includes('Context reminder')));

    cli.main(['pause', 'capture heavy session before clear']);

    const resumed = cli.buildResumeContext();
    assert.equal(resumed.context_hygiene.level, 'suggest-clearing');
    assert.equal(resumed.context_hygiene.handoff_ready, true);
    assert.equal(resumed.context_hygiene.clear_hint, 'clear -> resume');
    assert.match(resumed.context_hygiene.recommendation, /a handoff exists/);

    const plan = cli.buildActionOutput('plan');
    assert.equal(plan.context_hygiene.level, 'suggest-clearing');
    assert.equal(plan.context_hygiene.resume_cli, 'node ~/.codex/emb-agent/bin/emb-agent.cjs resume');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
