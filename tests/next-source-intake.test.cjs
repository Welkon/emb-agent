'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

async function assertPendingSourceIntakeGatesNext({
  prefix,
  fileName,
  content,
  expectedCliPattern,
  expectedLabelPattern
}) {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;

  process.stdout.write = () => true;

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    writeFile(path.join(tempProject, 'docs', fileName), content);

    process.chdir(tempProject);
    await cli.main(['init']);

    const next = cli.buildNextContext();

    assert.equal(next.next.command, 'health');
    assert.equal(next.next.gated_by_health, true);
    assert.match(next.next.cli, /health$/);
    assert.match(next.next.reason, /source intake/i);
    assert.equal(next.health.quickstart.stage, 'ingest-detected-input');
    assert.equal(next.next.health_quickstart.stage, 'ingest-detected-input');
    assert.match(next.action_card.first_step_label, expectedLabelPattern);
    assert.match(next.action_card.first_cli, expectedCliPattern);
    assert.equal(Array.isArray(next.health.quickstart.steps), true);
    assert.match(next.health.quickstart.steps[0].cli, expectedCliPattern);
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
}

test('next hard-gates to health when a discovered schematic still needs intake', async () => {
  await assertPendingSourceIntakeGatesNext({
    prefix: 'emb-agent-next-source-schematic-',
    fileName: 'board.SchDoc',
    content: 'dummy schematic payload\n',
    expectedCliPattern: /ingest schematic --file docs\/board\.SchDoc/,
    expectedLabelPattern: /Normalize discovered schematic input/
  });
});

test('next hard-gates to health when a discovered hardware pdf still needs intake', async () => {
  await assertPendingSourceIntakeGatesNext({
    prefix: 'emb-agent-next-source-doc-',
    fileName: 'PMS150G.pdf',
    content: 'fake pdf payload\n',
    expectedCliPattern: /ingest doc --file docs\/PMS150G\.pdf --kind datasheet --to hardware/,
    expectedLabelPattern: /Parse discovered hardware document/
  });
});
