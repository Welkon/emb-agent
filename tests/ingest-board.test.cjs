'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(repoRoot, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const altiumPcbDocParser = require(path.join(repoRoot, 'runtime', 'lib', 'altium-pcbdoc-parser.cjs'));
const boardEvidence = require(path.join(repoRoot, 'runtime', 'lib', 'board-evidence.cjs'));

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

test('altium pcbdoc parser reads Board6 data directly from PcbDoc', () => {
  const fixturePath = path.join(workspaceRoot, 'QP-XY25-1201_2.PcbDoc');
  if (!fs.existsSync(fixturePath)) {
    return;
  }

  const parsed = altiumPcbDocParser.parseAltiumPcbDocBuffer(fs.readFileSync(fixturePath));

  assert.equal(parsed.format, 'altium-pcbdoc');
  assert.equal(parsed.parser_mode, 'altium-pcbdoc-cfb-multistream');
  assert.match(parsed.file_header, /PCB 5\.0/i);
  assert.equal(parsed.cfb.board_data_stream, 'Root Entry/Board6/Data');
  assert.ok(parsed.cfb.board_data_bytes > 1000);
  assert.ok(parsed.coverage.records > 0);
  assert.ok(parsed.coverage.outlines >= 1);
  assert.ok(parsed.coverage.components > 0);
  assert.ok(parsed.coverage.pads > 0);
  assert.ok(parsed.coverage.texts > 0);
  assert.ok(parsed.coverage.tracks > 0);
  assert.ok(parsed.coverage.nets > 0);
  assert.ok(parsed.coverage.layer_stack >= 2);
  assert.ok(parsed.board.bounds.width_mm > 0);
  assert.ok(parsed.board.bounds.height_mm > 0);
  assert.ok(parsed.components.some(component => component.designator === 'U1'));
  assert.ok(parsed.components.some(component => component.designator === 'U2'));
  assert.ok(parsed.components.some(component => component.designator === 'CON2'));
  assert.ok(parsed.texts.some(text => text.text === 'SC8F083AD716SP'));
  assert.ok(parsed.pads.some(pad => pad.component === 'U1' && pad.net === 'GND'));
  assert.ok(parsed.vias.every(via => via.diameter_mm === null || via.diameter_mm < 5));
});

test('ingest board normalizes Altium PcbDoc into layout and advice artifacts', async () => {
  const fixturePath = path.join(workspaceRoot, 'QP-XY25-1201_2.PcbDoc');
  if (!fs.existsSync(fixturePath)) {
    return;
  }

  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-ingest-board-pcbdoc-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.copyFileSync(fixturePath, path.join(tempProject, 'docs', 'board.PcbDoc'));

    process.chdir(tempProject);
    await cli.main(['init']);

    const ingested = await cli.runIngestCommand(
      'board',
      ['--file', 'docs/board.PcbDoc']
    );

    assert.equal(ingested.status, 'ok');
    assert.equal(ingested.domain, 'board');
    assert.equal(ingested.format, 'altium-pcbdoc');
    assert.equal(ingested.write_mode, 'analysis-only');
    assert.equal(ingested.truth_write.direct, false);
    assert.equal(ingested.hardware_review.blocking, false);
    assert.equal(ingested.hardware_review.can_continue, true);
    assert.equal(fs.existsSync(path.join(tempProject, ingested.artifacts.layout)), true);
    assert.equal(fs.existsSync(path.join(tempProject, ingested.artifacts.board_advice)), true);
    assert.ok(ingested.summary.records > 0);
    assert.ok(ingested.summary.outlines >= 1);
    assert.ok(ingested.summary.components > 0);
    assert.ok(ingested.summary.pads > 0);
    assert.ok(ingested.summary.texts > 0);
    assert.ok(ingested.summary.tracks > 0);
    assert.ok(ingested.summary.nets > 0);
    assert.ok(ingested.summary.layer_stack >= 2);

    const layout = JSON.parse(fs.readFileSync(path.join(tempProject, ingested.artifacts.layout), 'utf8'));
    const advice = JSON.parse(fs.readFileSync(path.join(tempProject, ingested.artifacts.board_advice), 'utf8'));
    assert.equal(layout.cfb.board_data_stream, 'Root Entry/Board6/Data');
    assert.ok(layout.components.some(component => component.designator === 'CON2'));
    assert.ok(layout.texts.some(text => text.text === 'HT7533'));
    assert.equal(advice.status, 'analysis-only');
    assert.equal(advice.policy.blocking, false);
    assert.equal(advice.policy.manual_override_allowed, true);

    const summary = await captureCliJson(['--json', 'board', 'summary', '--parsed', ingested.artifacts.layout]);
    assert.equal(summary.command, 'board summary');
    assert.ok(summary.summary.coverage.records > 0);

    const boardAdvice = await captureCliJson(['--json', 'board', 'advice', '--parsed', ingested.artifacts.layout]);
    assert.equal(boardAdvice.command, 'board advice');
    assert.equal(boardAdvice.advice.available, true);

    const boardPads = await captureCliJson(['--json', 'board', 'pads', '--parsed', ingested.artifacts.layout, '--ref', 'U1']);
    assert.equal(boardPads.command, 'board pads');
    assert.ok(boardPads.pads.some(pad => pad.net === 'GND'));

    const boardTexts = await captureCliJson(['--json', 'board', 'texts', '--parsed', ingested.artifacts.layout, '--name', 'HT7533']);
    assert.equal(boardTexts.command, 'board texts');
    assert.ok(boardTexts.texts.some(text => text.text === 'HT7533'));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('board evidence is optional and missing PCB never blocks start or next', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-board-evidence-missing-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    const evidence = boardEvidence.summarizeBoardEvidence(tempProject);
    assert.equal(evidence.state, 'missing');
    assert.equal(evidence.required, false);
    assert.equal(evidence.blocking, false);
    assert.equal(evidence.can_continue, true);
    assert.ok(evidence.skipped_checks.includes('routing'));

    const start = cli.buildStartContext();
    assert.equal(start.board_evidence.state, 'missing');
    assert.equal(start.board_evidence.blocking, false);
    assert.equal(start.board_evidence.can_continue, true);

    const next = cli.buildNextContext();
    assert.equal(next.board_evidence.state, 'missing');
    assert.equal(next.board_evidence.blocking, false);
    assert.equal(next.board_evidence.can_continue, true);
    assert.ok(next.optional_evidence_actions.some(item => item.includes('No PCB layout file was found')));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('board evidence surfaces optional board ingest when PCB exists', async () => {
  const fixturePath = path.join(workspaceRoot, 'QP-XY25-1201_2.PcbDoc');
  if (!fs.existsSync(fixturePath)) {
    return;
  }

  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-board-evidence-available-'));
  fs.copyFileSync(fixturePath, path.join(tempProject, 'board.PcbDoc'));

  const evidence = boardEvidence.summarizeBoardEvidence(tempProject);
  assert.equal(evidence.state, 'available');
  assert.equal(evidence.blocking, false);
  assert.equal(evidence.can_continue, true);
  assert.match(evidence.command, /ingest board --file board\.PcbDoc/);
});
