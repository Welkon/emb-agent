'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const referenceLookupHelpers = require(path.join(repoRoot, 'runtime', 'lib', 'reference-lookup.cjs'));

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

test('doc lookup finds local docs and schematic datasheet references', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-lookup-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'cache', 'schematics', 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'SC8F072-datasheet.pdf'), 'fake pdf', 'utf8');
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'cache', 'schematics', 'fixture', 'parsed.json'),
      JSON.stringify({
        components: [
          {
            designator: 'U1',
            value: 'SC8F072',
            comment: 'MCU',
            package: 'SOP8',
            datasheet: 'https://vendor.invalid/SC8F072.pdf',
            pins: []
          }
        ],
        nets: []
      }, null, 2) + '\n',
      'utf8'
    );

    process.chdir(tempProject);
    await cli.main(['init']);

    const localLookup = await captureCliJson(['doc', 'lookup', '--chip', 'SC8F072', '--vendor', 'SCMCU']);
    const schematicLookup = await captureCliJson([
      'doc',
      'lookup',
      '--parsed',
      '.emb-agent/cache/schematics/fixture/parsed.json',
      '--ref',
      'U1'
    ]);

    assert.equal(localLookup.command, 'doc lookup');
    assert.equal(localLookup.result_mode, 'candidate-only');
    assert.equal(localLookup.candidate_status, 'unverified');
    assert.equal(localLookup.candidate_kind, 'document');
    assert.ok(localLookup.candidates.some(item => item.location === 'docs/SC8F072-datasheet.pdf'));
    assert.ok(localLookup.search_queries.some(item => item.includes('SC8F072 datasheet pdf')));
    assert.ok(schematicLookup.candidates.some(item => item.location === 'https://vendor.invalid/SC8F072.pdf'));
    assert.ok(schematicLookup.candidates.some(item => item.fetch_required === true));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('doc lookup extracts datasheet links from lceda search results', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-lookup-lceda-'));
  const requests = [];

  initProject.main(['--project', tempProject]);

  const result = await referenceLookupHelpers.lookupDocs(tempProject, [
    '--keyword',
    'C2040',
    '--provider',
    'lceda',
    '--limit',
    '3'
  ], {
    runtime: require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs')),
    ingestSchematicCli: require(path.join(repoRoot, 'runtime', 'scripts', 'ingest-schematic.cjs')),
    fetch: async url => {
      requests.push(String(url));
      return {
        ok: true,
        async json() {
          return {
            success: true,
            code: 0,
            result: [
              {
                product_code: 'C2040',
                display_title: 'RP2040_C2040',
                footprint: {
                  display_title: 'LQFN-56_L7.0-W7.0-P0.4-EP'
                },
                attributes: {
                  'LCSC Part Name': 'RP2040',
                  'Supplier Part': 'C2040',
                  Manufacturer: 'Raspberry Pi',
                  'Manufacturer Part': 'RP2040',
                  Datasheet: 'https://item.szlcsc.com/datasheet/RP2040/2392.html'
                }
              },
              {
                product_code: 'C-no-datasheet',
                display_title: 'NO_DOC',
                attributes: {
                  'Supplier Part': 'C-no-datasheet'
                }
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(result.command, 'doc lookup');
  assert.equal(result.provider, 'lceda');
  assert.equal(result.result_mode, 'candidate-only');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].provider, 'lceda');
  assert.equal(result.candidates[0].source_kind, 'lceda-datasheet-url');
  assert.equal(result.candidates[0].fetch_required, true);
  assert.equal(result.candidates[0].location, 'https://item.szlcsc.com/datasheet/RP2040/2392.html');
  assert.equal(result.candidates[0].component.lcsc_id, 'C2040');
  assert.equal(result.candidates[0].component.manufacturer, 'Raspberry Pi');
  assert.ok(requests.some(url => url.includes('/api/szlcsc/eda/product/list') && url.includes('wd=C2040')));
  assert.ok(result.next_steps.some(step => step.includes('doc fetch --url')));
});

test('component lookup builds supplier query inputs from schematic data', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-component-lookup-'));
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
            comment: 'IR receiver',
            footprint: 'SIP3',
            datasheet: 'https://parts.invalid/VS1838B.pdf',
            pins: []
          }
        ],
        nets: []
      }, null, 2) + '\n',
      'utf8'
    );

    process.chdir(tempProject);
    await cli.main(['init']);

    const result = await captureCliJson(['component', 'lookup', '--file', 'docs/ir-board.json', '--ref', 'U2']);

    assert.equal(result.command, 'component lookup');
    assert.equal(result.result_mode, 'candidate-only');
    assert.equal(result.candidate_status, 'unverified');
    assert.equal(result.candidate_kind, 'component');
    assert.equal(result.components.length, 1);
    assert.equal(result.components[0].designator, 'U2');
    assert.ok(result.components[0].query_terms.includes('VS1838B'));
    assert.ok(result.components[0].supplier_queries.some(item => item.includes('VS1838B')));
    assert.equal(result.components[0].confidence, 'high');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('schematic query commands expose parsed components nets bom and raw objects', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-schematic-query-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    fs.mkdirSync(path.join(tempProject, '.emb-agent', 'cache', 'schematics', 'fixture'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'cache', 'schematics', 'fixture', 'parsed.json'),
      JSON.stringify({
        parser_mode: 'fixture',
        components: [
          {
            designator: 'U1',
            value: 'SC8F072',
            footprint: 'SOP8',
            pins: [{ number: '1', name: 'PWM', net: 'PWM_OUT' }]
          }
        ],
        nets: [
          {
            name: 'PWM_OUT',
            members: ['U1.1', 'R1.1'],
            confidence: 'heuristic-named',
            evidence: [{ kind: 'net_label', record_index: 12, text: 'PWM_OUT' }]
          }
        ],
        objects: [
          { kind: 'component', record_index: 1, designator: 'U1' },
          { kind: 'net_label', record_index: 12, text: 'PWM_OUT' }
        ],
        bom: [
          { designators: ['U1'], quantity: 1, value: 'SC8F072', footprint: 'SOP8' }
        ],
        visual_netlist: {
          graph: { components: 1, nets: 1, named_nets: 1 }
        },
        schematic_advice: {
          version: 1,
          status: 'analysis-only',
          policy: {
            advisory_only: true,
            truth_write: false,
            user_can_dismiss: true
          },
          summary: {
            findings: 1,
            errors: 0,
            warnings: 1,
            info: 0,
            categories: {
              'gpio-bias': 1
            }
          },
          findings: [
            {
              id: 'gpio-bias-pwm-out',
              category: 'gpio-bias',
              severity: 'warning',
              confidence: 'medium',
              summary: 'Signal PWM_OUT reaches an IC/MCU input-like net but no external pull-up or pull-down candidate was detected.',
              evidence: { net: 'PWM_OUT', members: ['U1.1', 'R1.1'] },
              recommended_checks: ['Confirm the MCU pin bias and firmware default state.'],
              status: 'open',
              dismissible: true
            }
          ],
          review_focus: ['Treat findings as review prompts, not schematic errors.']
        },
        preview: {
          summary: {
            renderer: 'emb-agent-schdoc-svg-preview-v1',
            wires: 1,
            pins: 1
          }
        }
      }, null, 2)
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'cache', 'schematics', 'fixture', 'source.json'),
      JSON.stringify({ source_path: 'docs/board.SchDoc' }, null, 2)
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'cache', 'schematics', 'fixture', 'preview.input.json'),
      JSON.stringify({ renderer: 'emb-agent-schdoc-svg-preview-v1' }, null, 2)
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'cache', 'schematics', 'fixture', 'analysis.schematic-advice.json'),
      JSON.stringify({
        version: 1,
        status: 'analysis-only',
        policy: {
          advisory_only: true,
          truth_write: false,
          user_can_dismiss: true
        },
        summary: {
          findings: 1,
          errors: 0,
          warnings: 1,
          info: 0,
          categories: {
            'gpio-bias': 1
          }
        },
        findings: [
          {
            id: 'gpio-bias-pwm-out',
            category: 'gpio-bias',
            severity: 'warning',
            confidence: 'medium',
            summary: 'Signal PWM_OUT reaches an IC/MCU input-like net but no external pull-up or pull-down candidate was detected.',
            evidence: { net: 'PWM_OUT', members: ['U1.1', 'R1.1'] },
            recommended_checks: ['Confirm the MCU pin bias and firmware default state.'],
            status: 'open',
            dismissible: true
          }
        ],
        review_focus: ['Treat findings as review prompts, not schematic errors.']
      }, null, 2)
    );
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'cache', 'schematics', 'fixture', 'preview.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n'
    );

    process.chdir(tempProject);

    const summary = await captureCliJson(['schematic', 'summary', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json']);
    const component = await captureCliJson(['schematic', 'component', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json', '--ref', 'U1']);
    const net = await captureCliJson(['schematic', 'net', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json', '--name', 'PWM_OUT']);
    const bom = await captureCliJson(['schematic', 'bom', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json']);
    const advice = await captureCliJson(['schematic', 'advice', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json']);
    const preview = await captureCliJson(['schematic', 'preview', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json']);
    const raw = await captureCliJson(['schematic', 'raw', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json', '--record', '12']);

    assert.equal(summary.command, 'schematic summary');
    assert.equal(summary.summary.components, 1);
    assert.equal(summary.summary.nets, 1);
    assert.equal(summary.summary.advice.findings, 1);
    assert.equal(component.component.designator, 'U1');
    assert.equal(component.pins[0].net, 'PWM_OUT');
    assert.equal(net.net.evidence[0].kind, 'net_label');
    assert.equal(bom.bom[0].quantity, 1);
    assert.equal(advice.advice.available, true);
    assert.equal(advice.advice.summary.findings, 1);
    assert.equal(advice.advice.findings[0].category, 'gpio-bias');
    assert.equal(advice.advice.artifacts.advice, '.emb-agent/cache/schematics/fixture/analysis.schematic-advice.json');
    assert.match(advice.advice.note, /dismissible engineering review prompts/);
    assert.equal(preview.preview.available, true);
    assert.equal(preview.preview.summary.renderer, 'emb-agent-schdoc-svg-preview-v1');
    assert.equal(preview.preview.artifacts.svg, '.emb-agent/cache/schematics/fixture/preview.svg');
    assert.equal(preview.preview.artifacts.input, '.emb-agent/cache/schematics/fixture/preview.input.json');
    assert.equal(raw.object.kind, 'net_label');
  } finally {
    process.chdir(currentCwd);
  }
});

test('component lookup rejects supplier search providers', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-component-lookup-provider-'));
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
            comment: 'IR receiver',
            footprint: 'SIP3',
            datasheet: '',
            pins: []
          }
        ],
        nets: []
      }, null, 2) + '\n',
      'utf8'
    );

    process.chdir(tempProject);
    await cli.main(['init']);

    await assert.rejects(
      referenceLookupHelpers.lookupComponents(tempProject, [
        '--file',
        'docs/ir-board.json',
        '--ref',
        'U2',
        '--provider',
        'szlcsc'
      ], {
        runtime: require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs')),
        ingestSchematicCli: require(path.join(repoRoot, 'runtime', 'scripts', 'ingest-schematic.cjs'))
      }),
      /supplier search providers are not integrated/
    );
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('doc fetch downloads a remote file into docs', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-doc-fetch-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const originalHttpGet = http.get;

  process.stdout.write = () => true;

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await cli.main(['init']);

    http.get = (target, handler) => {
      const response = new PassThrough();
      response.statusCode = 200;
      response.headers = {
        'content-type': 'application/pdf'
      };
      process.nextTick(() => {
        handler(response);
        response.end('fake-pdf-data');
      });
      return {
        on() {
          return this;
        }
      };
    };

    const result = await referenceLookupHelpers.fetchDocument(tempProject, ['--url', 'http://example.invalid/SC8F072.pdf']);

    assert.equal(result.command, 'doc fetch');
    assert.equal(result.downloaded, true);
    assert.equal(result.output, 'docs/SC8F072.pdf');
    assert.equal(fs.existsSync(path.join(tempProject, result.output)), true);
    assert.match(fs.readFileSync(path.join(tempProject, result.output), 'utf8'), /fake-pdf-data/);
  } finally {
    http.get = originalHttpGet;
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
