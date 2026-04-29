'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('ingest schematic normalizes exported json into raw board data artifacts', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-ingest-schematic-json-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, 'docs', 'ir-board.json'),
      JSON.stringify({
        title: 'IR board',
        components: [
          {
            designator: 'U2',
            value: 'VS1838B',
            footprint: 'SIP3',
            pins: [
              { number: '1', name: 'OUT', net: 'IR_RX' },
              { number: '2', name: 'GND', net: 'GND' },
              { number: '3', name: 'VCC', net: 'VDD' }
            ]
          }
        ],
        nets: [
          { name: 'IR_RX', members: ['U2.1', 'MCU.PA4'] },
          { name: 'VDD', members: ['U2.3'] }
        ]
      }, null, 2) + '\n',
      'utf8'
    );

    process.chdir(tempProject);
    await cli.main(['init']);

    const ingested = await cli.runIngestCommand(
      'schematic',
      ['--file', 'docs/ir-board.json', '--format', 'altium-json']
    );

    const hardwareFacts = fs.readFileSync(path.join(tempProject, ingested.artifacts.hardware_facts), 'utf8');
    const summaryJson = JSON.parse(fs.readFileSync(path.join(tempProject, ingested.artifacts.summary), 'utf8'));
    const nextContext = cli.buildNextContext();
    const scanContext = cli.buildActionOutput('scan');

    assert.equal(ingested.status, 'ok');
    assert.equal(ingested.domain, 'schematic');
    assert.equal(ingested.format, 'altium-json');
    assert.equal(ingested.write_mode, 'analysis-only');
    assert.equal(ingested.truth_write.direct, false);
    assert.equal(ingested.truth_write.requires_confirmation, true);
    assert.equal(ingested.truth_write.domain, 'hardware');
    assert.equal(ingested.truth_write.target, '.emb-agent/hw.yaml');
    assert.deepEqual(ingested.truth_write.confirmation_targets, ['mcu.vendor', 'mcu.model', 'mcu.package', 'signals', 'peripherals']);
    assert.deepEqual(ingested.truth_write.source_artifacts, [
      ingested.artifacts.parsed,
      ingested.artifacts.visual_netlist,
      ingested.artifacts.hardware_facts,
      ingested.artifacts.hardware_facts_json
    ]);
    assert.equal(ingested.apply_ready, null);
    assert.equal(ingested.summary.components, 1);
    assert.equal(ingested.summary.signal_candidates, 1);
    assert.ok(Array.isArray(ingested.component_refs));
    assert.equal(ingested.component_refs.length, 0);
    assert.equal(fs.existsSync(path.join(tempProject, ingested.artifacts.hardware_facts)), true);
    assert.equal(fs.existsSync(path.join(tempProject, ingested.artifacts.visual_netlist)), true);
    assert.equal(fs.existsSync(path.join(tempProject, ingested.artifacts.hardware_facts_json)), true);
    assert.match(hardwareFacts, /Normalized 1 components and 2 nets/);
    assert.match(hardwareFacts, /Named nets extracted: IR_RX, VDD/);
    assert.match(hardwareFacts, /Component roles, controller identity, and signal direction should be judged later by the agent from parsed.json/);
    assert.equal(summaryJson.status, 'ok');
    assert.equal(summaryJson.write_mode, 'analysis-only');
    assert.equal(summaryJson.truth_write.direct, false);
    assert.equal(summaryJson.apply_ready, null);
    assert.equal(summaryJson.component_refs.length, 0);
    assert.equal(summaryJson.agent_analysis.required, true);
    assert.equal(summaryJson.agent_analysis.recommended_agent, 'emb-hw-scout');
    assert.ok(summaryJson.agent_analysis.inputs.includes(ingested.artifacts.parsed));
    assert.ok(summaryJson.agent_analysis.inputs.includes(ingested.artifacts.visual_netlist));
    assert.equal(nextContext.next.schematic_analysis.recommended_agent, 'emb-hw-scout');
    assert.ok(nextContext.next_actions.some(item => item.includes('schematic_analysis=emb-hw-scout')));
    assert.ok(nextContext.next_actions.some(item => item.startsWith('schematic_confirm=')));
    assert.ok(scanContext.next_reads.some(item => item.includes('schematic_handoff=')));
    assert.equal(ingested.session.last_files[0], ingested.artifacts.parsed);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('ingest schematic merges repeated files into visual netlist analysis', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-ingest-schematic-multipage-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, 'docs', 'mcu.json'),
      JSON.stringify({
        components: [
          {
            designator: 'U1',
            value: 'SC8F072',
            footprint: 'SOP8',
            pins: [
              { number: '1', name: 'TX', net: 'UART_TX' }
            ]
          }
        ],
        nets: [
          { name: 'UART_TX', members: ['U1.1'] }
        ]
      }, null, 2) + '\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(tempProject, 'docs', 'connector.json'),
      JSON.stringify({
        components: [
          {
            designator: 'J1',
            value: 'UART header',
            pins: [
              { number: '1', name: 'TXD', net: 'UART_TX' }
            ]
          }
        ],
        nets: [
          { name: 'UART_TX', members: ['J1.1'] }
        ]
      }, null, 2) + '\n',
      'utf8'
    );

    process.chdir(tempProject);
    await cli.main(['init']);

    const ingested = await cli.runIngestCommand(
      'schematic',
      ['--file', 'docs/mcu.json', '--file', 'docs/connector.json', '--format', 'altium-json']
    );

    const parsedJson = JSON.parse(fs.readFileSync(path.join(tempProject, ingested.artifacts.parsed), 'utf8'));
    const visualNetlist = JSON.parse(fs.readFileSync(path.join(tempProject, ingested.artifacts.visual_netlist), 'utf8'));
    const hardwareFacts = fs.readFileSync(path.join(tempProject, ingested.artifacts.hardware_facts), 'utf8');

    assert.equal(ingested.format, 'multi-source');
    assert.deepEqual(ingested.source_paths, ['docs/mcu.json', 'docs/connector.json']);
    assert.equal(ingested.summary.pages, 2);
    assert.equal(ingested.summary.cross_sheet_nets, 1);
    assert.equal(ingested.summary.signal_candidates, 1);
    assert.equal(parsedJson.parser_mode, 'multi-source-schematic');
    assert.equal(parsedJson.nets.find(item => item.name === 'UART_TX').members.length, 2);
    assert.equal(visualNetlist.page_count, 2);
    assert.equal(visualNetlist.cross_sheet_nets[0].name, 'UART_TX');
    assert.equal(visualNetlist.signal_candidates[0].name, 'UART_TX');
    assert.match(hardwareFacts, /Multi-page schematic ingest: 2 pages, 1 cross-sheet named nets/);
    assert.ok(ingested.agent_analysis.inputs.includes(ingested.artifacts.visual_netlist));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('ingest schematic parses raw SchDoc through the internal parser and keeps interpretation deferred', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-ingest-schematic-schdoc-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const fixturePath = path.resolve(repoRoot, '..', '参考资料', 'docs', 'QP-SS26-0303电路图.SchDoc');

  process.stdout.write = () => true;

  try {
    if (!fs.existsSync(fixturePath)) {
      throw new Error(`Missing SchDoc fixture: ${fixturePath}`);
    }

    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.copyFileSync(fixturePath, path.join(tempProject, 'docs', 'board.SchDoc'));

    process.chdir(tempProject);
    await cli.main(['init']);

    const ingested = await cli.runIngestCommand(
      'schematic',
      ['--file', 'docs/board.SchDoc']
    );

    const parsedJson = JSON.parse(fs.readFileSync(path.join(tempProject, ingested.artifacts.parsed), 'utf8'));
    const hardwareFacts = fs.readFileSync(path.join(tempProject, ingested.artifacts.hardware_facts), 'utf8');

    assert.equal(ingested.status, 'ok');
    assert.equal(ingested.domain, 'schematic');
    assert.equal(ingested.format, 'altium-raw');
    assert.equal(ingested.parser.mode, 'altium-raw-internal');
    assert.ok(ingested.summary.components > 0);
    assert.ok(ingested.summary.nets > 0);
    assert.ok(parsedJson.components.some(item => item.designator === 'U1' && /PMS150G/i.test(item.comment || '')));
    assert.ok(parsedJson.components.some(item => item.designator === 'PIR' && /TQ322/i.test(item.comment || '')));
    assert.ok(parsedJson.nets.some(item => item.name === 'PIR'));
    assert.equal(parsedJson.visual_netlist.status, 'analysis-only');
    assert.equal(parsedJson.visual_netlist.page_count, 1);
    assert.ok(parsedJson.visual_netlist.graph.nets > 0);
    assert.equal(fs.existsSync(path.join(tempProject, ingested.artifacts.summary)), true);
    assert.equal(fs.existsSync(path.join(tempProject, ingested.artifacts.source)), true);
    assert.equal(fs.existsSync(path.join(tempProject, ingested.artifacts.hardware_facts)), true);
    assert.equal(ingested.agent_analysis.required, true);
    assert.equal(ingested.agent_analysis.recommended_agent, 'emb-hw-scout');
    assert.ok(ingested.agent_analysis.confirmation_targets.includes('mcu.model'));
    assert.equal(ingested.session.last_files[0], ingested.artifacts.parsed);
    assert.match(hardwareFacts, /docs\/board\.SchDoc/);
    assert.match(hardwareFacts, /Normalized \d+ components and \d+ nets/);
    assert.match(hardwareFacts, /PIR/);
    assert.match(hardwareFacts, /PWM/);
    assert.match(hardwareFacts, /judged later by the agent from parsed\.json/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('ingest schematic identifies MCU candidates and pre-fills hardware draft from schematic components', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-ingest-schematic-pmb180b-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const fixturePath = path.resolve(repoRoot, '..', '参考资料', 'docs', 'QP-SS26-0303电路图.SchDoc');

  process.stdout.write = () => true;

  try {
    if (!fs.existsSync(fixturePath)) {
      throw new Error(`Missing SchDoc fixture: ${fixturePath}`);
    }

    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.copyFileSync(fixturePath, path.join(tempProject, 'docs', 'charger-board.SchDoc'));

    process.chdir(tempProject);
    await cli.main(['init']);

    const ingested = await cli.runIngestCommand(
      'schematic',
      ['--file', 'docs/charger-board.SchDoc']
    );

    const parsedJson = JSON.parse(fs.readFileSync(path.join(tempProject, ingested.artifacts.parsed), 'utf8'));
    const hardwareFacts = fs.readFileSync(path.join(tempProject, ingested.artifacts.hardware_facts), 'utf8');

    assert.equal(ingested.status, 'ok');
    assert.equal(ingested.domain, 'schematic');
    assert.equal(ingested.format, 'altium-raw');
    assert.equal(ingested.parser.mode, 'altium-raw-internal');
    assert.ok(ingested.summary.components > 0);
    assert.ok(ingested.summary.signal_candidates >= 1);
    assert.ok(parsedJson.components.some(item => item.designator === 'U1' && /PMS150G/i.test(item.comment || '')));
    assert.equal(ingested.agent_analysis.status, 'agent-review-required');
    assert.ok(Array.isArray(ingested.agent_analysis.candidate_components));
    assert.equal(ingested.session.last_files[0], ingested.artifacts.parsed);
    assert.match(hardwareFacts, /vendor: "padauk"/);
    assert.match(hardwareFacts, /model: ".+"/);
    assert.match(hardwareFacts, /package: ""/);
    assert.match(hardwareFacts, /PIR/);
    assert.match(hardwareFacts, /PWM/);
    assert.match(hardwareFacts, /Top MCU candidate/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
