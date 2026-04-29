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

test('component lookup builds szlcsc-style query inputs from schematic data', async () => {
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
    assert.ok(result.components[0].szlcsc_queries.some(item => item.includes('VS1838B')));
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
      path.join(tempProject, '.emb-agent', 'cache', 'schematics', 'fixture', 'preview.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n'
    );

    process.chdir(tempProject);

    const summary = await captureCliJson(['schematic', 'summary', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json']);
    const component = await captureCliJson(['schematic', 'component', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json', '--ref', 'U1']);
    const net = await captureCliJson(['schematic', 'net', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json', '--name', 'PWM_OUT']);
    const bom = await captureCliJson(['schematic', 'bom', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json']);
    const preview = await captureCliJson(['schematic', 'preview', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json']);
    const raw = await captureCliJson(['schematic', 'raw', '--parsed', '.emb-agent/cache/schematics/fixture/parsed.json', '--record', '12']);

    assert.equal(summary.command, 'schematic summary');
    assert.equal(summary.summary.components, 1);
    assert.equal(summary.summary.nets, 1);
    assert.equal(component.component.designator, 'U1');
    assert.equal(component.pins[0].net, 'PWM_OUT');
    assert.equal(net.net.evidence[0].kind, 'net_label');
    assert.equal(bom.bom[0].quantity, 1);
    assert.equal(preview.preview.available, true);
    assert.equal(preview.preview.summary.renderer, 'emb-agent-schdoc-svg-preview-v1');
    assert.equal(preview.preview.artifacts.svg, '.emb-agent/cache/schematics/fixture/preview.svg');
    assert.equal(preview.preview.artifacts.input, '.emb-agent/cache/schematics/fixture/preview.input.json');
    assert.equal(raw.object.kind, 'net_label');
  } finally {
    process.chdir(currentCwd);
  }
});

test('component lookup enriches schematic components through szlcsc provider', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-component-lookup-szlcsc-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const runtimeConfig = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs')).loadRuntimeConfig(
    path.join(repoRoot, 'runtime')
  );

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

    const projectConfigPath = path.join(tempProject, '.emb-agent', 'project.json');
    const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
    projectConfig.integrations.szlcsc.enabled = true;
    fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2) + '\n', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const seenRequests = [];
    const result = await referenceLookupHelpers.lookupComponents(tempProject, [
      '--file',
      'docs/ir-board.json',
      '--ref',
      'U2',
      '--provider',
      'szlcsc'
    ], {
      runtime: require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs')),
      runtimeConfig,
      ingestSchematicCli: require(path.join(repoRoot, 'runtime', 'scripts', 'ingest-schematic.cjs')),
      env: {
        SZLCSC_API_KEY: 'demo-key',
        SZLCSC_API_SECRET: 'demo-secret'
      },
      fetch: async url => {
        seenRequests.push(String(url));
        return {
          ok: true,
          async json() {
            return {
              code: 0,
              success: true,
              result: {
                items: [
                  {
                    productCode: 'C12345',
                    productModel: 'VS1838B',
                    brandName: 'VISHAY',
                    packageName: 'SIP-3',
                    productDescEn: 'IR receiver module',
                    datasheetUrl: 'https://datasheet.invalid/VS1838B.pdf',
                    productUrl: 'https://www.lcsc.com/product-detail/C12345.html'
                  }
                ]
              }
            };
          }
        };
      }
    });

    assert.equal(result.command, 'component lookup');
    assert.equal(result.result_mode, 'candidate-only');
    assert.equal(result.candidate_status, 'unverified');
    assert.equal(result.candidate_kind, 'component');
    assert.equal(result.provider, 'szlcsc');
    assert.equal(result.integration.enabled, true);
    assert.equal(result.components.length, 1);
    assert.equal(result.components[0].designator, 'U2');
    assert.ok(result.components[0].provider_queries.some(item => item.match_type === 'exact'));
    assert.equal(result.components[0].supplier_matches.length, 1);
    assert.equal(result.components[0].supplier_matches[0].lcsc_part_number, 'C12345');
    assert.equal(result.components[0].supplier_matches[0].mpn, 'VS1838B');
    assert.equal(result.components[0].supplier_matches[0].package, 'SIP-3');
    assert.equal(result.components[0].supplier_matches[0].datasheet, 'https://datasheet.invalid/VS1838B.pdf');
    assert.ok(seenRequests.some(url => url.includes('/rest/wmsc2agent/search/product')));
    assert.ok(seenRequests.some(url => url.includes('signature=')));
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
