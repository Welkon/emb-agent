'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureCliJson(args) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await cli.main(args);
  } finally {
    process.stdout.write = originalWrite;
  }

  return JSON.parse(stdout);
}

test('decision review creates an AI-host blocking gate before implementation', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-decision-review-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const review = await captureCliJson([
      'decision',
      'review',
      '--question',
      'Should this state be stored in Redux?',
      '--option',
      'Redux',
      '--option',
      'local state',
      '--evidence',
      'docs/prd/system.md',
      '--brief'
    ]);

    assert.equal(review.output_mode, 'brief');
    assert.equal(review.status, 'blocked-by-decision-review');
    assert.equal(review.decision_review.question, 'Should this state be stored in Redux?');
    assert.ok(review.decision_review.review_questions.length >= 4);
    assert.equal(review.agent_protocol.gate.kind, 'decision-review');
    assert.equal(review.agent_protocol.gate.blocking, true);
    assert.ok(review.agent_protocol.gate.forbidden_actions.includes('capability run do'));
    assert.match(review.agent_protocol.ai_instruction.ask_user, /技术选择|技术决策|审视/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('decision record writes auditable JSON and markdown decision logs', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-decision-record-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const recorded = await captureCliJson([
      'decision',
      'record',
      '--question',
      'Which timer owns PWM output?',
      '--chosen',
      'TM2',
      '--option',
      'TM2',
      '--option',
      'software PWM',
      '--reject',
      'software PWM::jitter risk',
      '--evidence',
      'docs/prd/subsystems/pwm-output.md',
      '--note',
      'Keep timer ownership explicit.',
      '--brief'
    ]);

    assert.equal(recorded.output_mode, 'brief');
    assert.equal(recorded.status, 'recorded');
    assert.equal(recorded.decision.chosen, 'TM2');
    assert.match(recorded.decision.path, /^\.emb-agent\/wiki\/decisions\//);
    assert.match(recorded.decision.markdown_path, /^\.emb-agent\/wiki\/decisions\//);
    assert.equal(recorded.agent_protocol.recommendation.command, 'next');
    assert.equal(fs.existsSync(path.join(tempProject, recorded.decision.path)), true);
    assert.equal(fs.existsSync(path.join(tempProject, recorded.decision.markdown_path)), true);

    const status = await captureCliJson(['decision', 'status', '--brief']);
    assert.equal(status.output_mode, 'brief');
    assert.equal(status.count, 1);
    assert.equal(status.decisions[0].chosen, 'TM2');
    assert.equal(status.decisions[0].question, 'Which timer owns PWM output?');
  } finally {
    process.chdir(currentCwd);
  }
});
