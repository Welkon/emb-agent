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

test('knowledge init creates project wiki control files and directories', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-init-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const initialized = await captureCliJson(['knowledge', 'init']);

    assert.equal(initialized.initialized, true);
    assert.equal(initialized.wiki_dir, '.emb-agent/wiki');
    assert.ok(initialized.directories.includes('.emb-agent/wiki/sources'));
    assert.ok(initialized.directories.includes('.emb-agent/wiki/decisions'));
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'wiki', 'index.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'wiki', 'log.md')), true);
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge save-query previews by default and writes only with confirmation', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-save-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['knowledge', 'init']);

    const preview = await captureCliJson([
      'knowledge',
      'save-query',
      'Timer contention',
      '--summary',
      'IR decode and PWM may compete for the same timer.',
      '--body',
      'Keep this as draft synthesis until timer ownership is confirmed.'
    ]);

    const pagePath = path.join(tempProject, '.emb-agent', 'wiki', 'queries', 'timer-contention.md');
    assert.equal(preview.status, 'confirmation-required');
    assert.equal(preview.write_mode, 'preview');
    assert.equal(preview.target, '.emb-agent/wiki/queries/timer-contention.md');
    assert.equal(fs.existsSync(pagePath), false);

    const written = await captureCliJson([
      'knowledge',
      'save-query',
      'Timer contention',
      '--summary',
      'IR decode and PWM may compete for the same timer.',
      '--body',
      'Keep this as draft synthesis until timer ownership is confirmed.',
      '--confirm'
    ]);

    assert.equal(written.status, 'written');
    assert.equal(written.page.path, '.emb-agent/wiki/queries/timer-contention.md');
    assert.equal(fs.existsSync(pagePath), true);

    const index = fs.readFileSync(path.join(tempProject, '.emb-agent', 'wiki', 'index.md'), 'utf8');
    const log = fs.readFileSync(path.join(tempProject, '.emb-agent', 'wiki', 'log.md'), 'utf8');
    assert.match(index, /\[\[queries\/timer-contention\]\]/);
    assert.match(log, /query \| Timer contention/);

    const shown = await captureCliJson(['knowledge', 'show', 'queries/timer-contention']);
    assert.match(shown.content, /# Timer contention/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge lint reports declared chip without matching chip page', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-lint-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['knowledge', 'init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['chip: sc8f072', 'package: sop8', ''].join('\n'),
      'utf8'
    );

    const lint = await captureCliJson(['knowledge', 'lint']);

    assert.equal(lint.wiki_dir, '.emb-agent/wiki');
    assert.ok(Array.isArray(lint.issues));
    assert.ok(lint.issues.some(issue => issue.code === 'missing-chip-page'));
    assert.ok(lint.next_steps.some(step => /knowledge save-query --kind chip/.test(step)));
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge graph build writes graph artifacts from truth and wiki links', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-graph-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['knowledge', 'init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['chip: SC8F072', 'package: SOP8', ''].join('\n'),
      'utf8'
    );

    await captureCliJson([
      'knowledge',
      'save-query',
      'SC8F072',
      '--kind',
      'chip',
      '--summary',
      'SC8F072 chip synthesis page.',
      '--body',
      'Timer and GPIO evidence should be reviewed before promotion.',
      '--confirm'
    ]);
    await captureCliJson([
      'knowledge',
      'save-query',
      'Timer contention',
      '--summary',
      'IR decode and PWM may compete for timer resources.',
      '--body',
      'Compare timer ownership against [[chips/sc8f072]] and [[missing/peripheral-note]].',
      '--link',
      'chips/sc8f072',
      '--link',
      'missing/peripheral-note',
      '--confirm'
    ]);

    const built = await captureCliJson(['knowledge', 'graph', 'build']);
    const graphPath = path.join(tempProject, '.emb-agent', 'graph', 'graph.json');
    const reportPath = path.join(tempProject, '.emb-agent', 'graph', 'GRAPH_REPORT.md');
    const manifestPath = path.join(tempProject, '.emb-agent', 'graph', 'cache', 'manifest.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

    assert.equal(built.status, 'built');
    assert.equal(built.graph_file, '.emb-agent/graph/graph.json');
    assert.equal(fs.existsSync(reportPath), true);
    assert.equal(fs.existsSync(manifestPath), true);
    assert.ok(graph.nodes.some(node => node.id === 'chip:sc8f072'));
    assert.ok(graph.nodes.some(node => node.id === 'wiki:chips/sc8f072'));
    assert.ok(graph.nodes.some(node => node.id === 'wiki:queries/timer-contention'));
    assert.ok(graph.edges.some(edge =>
      edge.from === 'wiki:queries/timer-contention' &&
      edge.to === 'wiki:chips/sc8f072' &&
      edge.type === 'links_to'
    ));
    assert.ok(graph.edges.some(edge => edge.basis === 'AMBIGUOUS'));
    const report = fs.readFileSync(reportPath, 'utf8');
    assert.match(report, /Knowledge Graph Report/);
    assert.match(report, /## Suggested Explanations/);
    assert.match(report, /knowledge graph explain wiki:queries\/timer-contention/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge graph query path and lint expose graph navigation', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-graph-query-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['knowledge', 'init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['chip: SC8F072', 'package: SOP8', ''].join('\n'),
      'utf8'
    );

    await captureCliJson([
      'knowledge',
      'save-query',
      'SC8F072',
      '--kind',
      'chip',
      '--summary',
      'SC8F072 chip synthesis page.',
      '--body',
      'Chip notes.',
      '--confirm'
    ]);
    await captureCliJson([
      'knowledge',
      'save-query',
      'Timer contention',
      '--summary',
      'Timer relationship page.',
      '--body',
      'Review [[chips/sc8f072]] and [[missing/timer-note]].',
      '--confirm'
    ]);
    await captureCliJson(['knowledge', 'graph', 'build']);

    const query = await captureCliJson(['knowledge', 'graph', 'query', 'sc8f072']);
    const pathResult = await captureCliJson(['knowledge', 'graph', 'path', 'timer-contention', 'chips/sc8f072']);
    const lint = await captureCliJson(['knowledge', 'graph', 'lint']);

    assert.equal(query.query, 'sc8f072');
    assert.ok(query.nodes.some(node => node.id === 'chip:sc8f072'));
    assert.equal(pathResult.found, true);
    assert.ok(pathResult.path.includes('wiki:queries/timer-contention'));
    assert.ok(pathResult.path.includes('wiki:chips/sc8f072'));
    assert.equal(lint.status, 'warn');
    assert.ok(lint.issues.some(issue => issue.code === 'ambiguous-edge'));
    assert.ok(lint.next_steps.some(step => /Review the linked wiki page/.test(step)));
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge graph build indexes structured formula registries', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-formula-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['knowledge', 'init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['chip: SC8P052B', 'package: SOP8', ''].join('\n'),
      'utf8'
    );
    const formulasDir = path.join(tempProject, '.emb-agent', 'formulas');
    fs.mkdirSync(formulasDir, { recursive: true });
    fs.writeFileSync(
      path.join(formulasDir, 'sc8p052b.json'),
      JSON.stringify(
        {
          version: 'emb-agent.formulas/1',
          chip: 'SC8P052B',
          source: '.emb-agent/cache/docs/full/parse.md',
          formulas: [
            {
              id: 'sc8p052b.pwm.period',
              label: 'SC8P052B PWM period',
              peripheral: 'PWM',
              expression: '(PWMT + 1) * T_HSI * CLKDIV',
              variables: {
                PWMT: '10-bit PWM period register value',
                T_HSI: '1 / F_HSI',
                CLKDIV: 'PWM clock divider'
              },
              registers: ['PWMTL', 'PWMTH', 'PWMCON0'],
              evidence: {
                source: '.emb-agent/cache/docs/full/parse.md',
                section: '9.4 10 位 PWM 周期'
              },
              status: 'draft'
            }
          ]
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    await captureCliJson(['knowledge', 'graph', 'build']);
    const graph = JSON.parse(fs.readFileSync(path.join(tempProject, '.emb-agent', 'graph', 'graph.json'), 'utf8'));
    const query = await captureCliJson(['knowledge', 'graph', 'query', 'PWMTL']);

    assert.ok(graph.nodes.some(node => node.id === 'formula:sc8p052b.pwm.period'));
    assert.ok(graph.nodes.some(node => node.id === 'register:sc8p052b-pwmtl'));
    assert.ok(graph.nodes.some(node => node.id === 'parameter:sc8p052b-pwm-period-clkdiv'));
    assert.ok(graph.edges.some(edge =>
      edge.from === 'formula:sc8p052b.pwm.period' &&
      edge.to === 'register:sc8p052b-pwmtl' &&
      edge.type === 'uses_register'
    ));
    assert.ok(graph.edges.some(edge =>
      edge.from === 'formula:sc8p052b.pwm.period' &&
      edge.type === 'evidenced_by'
    ));
    assert.ok(query.nodes.some(node => node.id === 'register:sc8p052b-pwmtl'));
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge graph build indexes saved tool runs and firmware snippets', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-tool-run-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['knowledge', 'init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['chip: SC8P052B', 'package: SOP8', ''].join('\n'),
      'utf8'
    );

    const formulasDir = path.join(tempProject, '.emb-agent', 'formulas');
    fs.mkdirSync(formulasDir, { recursive: true });
    fs.writeFileSync(
      path.join(formulasDir, 'sc8p052b.json'),
      JSON.stringify(
        {
          version: 'emb-agent.formulas/1',
          chip: 'SC8P052B',
          formulas: [
            {
              id: 'sc8p052b.pwm.period',
              label: 'SC8P052B PWM period',
              peripheral: 'PWM',
              expression: '(PWMT + 1) * T_HSI * CLKDIV',
              variables: {
                PWMT: '10-bit PWM period register value'
              },
              registers: ['PWMTL'],
              evidence: {
                source: '.emb-agent/cache/docs/full/parse.md',
                section: 'PWM period register'
              },
              status: 'draft'
            }
          ]
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    const runsDir = path.join(tempProject, '.emb-agent', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, 'timer-calc.json'),
      JSON.stringify(
        {
          tool: 'timer-calc',
          status: 'ok',
          saved_output: '.emb-agent/runs/timer-calc.json',
          best_candidate: {
            register_writes: {
              registers: [
                {
                  register: 'PWMTL',
                  mask_hex: '0xFF',
                  write_value_hex: '0xE7',
                  fields: ['PWMT<7:0>'],
                  c_statement: 'PWMTL = (PWMTL & ~0xFF) | 0xE7;',
                  hal_statement: 'MODIFY_REG(PWMTL, 0xFF, 0xE7);'
                }
              ],
              firmware_snippet_request: {
                protocol: 'emb-agent.firmware-snippet-request/1',
                status: 'draft-until-verified'
              }
            }
          }
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    const snippetsDir = path.join(tempProject, '.emb-agent', 'firmware-snippets');
    fs.mkdirSync(snippetsDir, { recursive: true });
    fs.writeFileSync(
      path.join(snippetsDir, 'pwm-init.md'),
      [
        '---',
        'title: "SC8P052B PWM init"',
        'status: "draft"',
        'protocol: "emb-agent.firmware-snippet-request/1"',
        'source_tool_output: ".emb-agent/runs/timer-calc.json"',
        '---',
        '',
        '# SC8P052B PWM init',
        '',
        '## Register Writes',
        '',
        '- `PWMTL`: mask `0xFF`, value `0xE7`, fields `PWMT<7:0>`.',
        ''
      ].join('\n'),
      'utf8'
    );

    await captureCliJson(['knowledge', 'graph', 'build']);
    const graph = JSON.parse(fs.readFileSync(path.join(tempProject, '.emb-agent', 'graph', 'graph.json'), 'utf8'));
    const query = await captureCliJson(['knowledge', 'graph', 'query', 'PWMTL']);
    const registerExplain = await captureCliJson(['knowledge', 'graph', 'explain', 'PWMTL']);
    const snippetExplain = await captureCliJson(['knowledge', 'graph', 'explain', 'firmware-snippets/pwm-init.md']);
    const missingExplain = await captureCliJson(['knowledge', 'graph', 'explain', 'no-such-register']);

    assert.ok(graph.nodes.some(node => node.id === 'tool-run:runs/timer-calc.json'));
    assert.ok(graph.nodes.some(node => node.id === 'firmware-snippet:firmware-snippets/pwm-init.md'));
    assert.ok(graph.nodes.some(node => node.id === 'register:sc8p052b-pwmtl'));
    assert.ok(graph.edges.some(edge =>
      edge.from === 'tool-run:runs/timer-calc.json' &&
      edge.to === 'register:sc8p052b-pwmtl' &&
      edge.type === 'writes_register'
    ));
    assert.ok(graph.edges.some(edge =>
      edge.from === 'tool-run:runs/timer-calc.json' &&
      edge.to === 'formula:sc8p052b.pwm.period' &&
      edge.type === 'uses_formula'
    ));
    assert.ok(graph.edges.some(edge =>
      edge.from === 'tool-run:runs/timer-calc.json' &&
      edge.to === 'firmware-snippet:firmware-snippets/pwm-init.md' &&
      edge.type === 'materialized_by'
    ));
    assert.ok(graph.edges.some(edge =>
      edge.from === 'firmware-snippet:firmware-snippets/pwm-init.md' &&
      edge.to === 'register:sc8p052b-pwmtl' &&
      edge.type === 'writes_register'
    ));
    assert.ok(query.nodes.some(node => node.id === 'tool-run:runs/timer-calc.json'));
    assert.ok(query.nodes.some(node => node.id === 'firmware-snippet:firmware-snippets/pwm-init.md'));
    assert.ok(query.edges.some(edge => edge.from === 'formula:sc8p052b.pwm.period'));
    assert.equal(registerExplain.found, true);
    assert.equal(registerExplain.matched.id, 'register:sc8p052b-pwmtl');
    assert.ok(registerExplain.summary.inbound_edges >= 2);
    assert.ok(registerExplain.summary.sources.includes('.emb-agent/runs/timer-calc.json'));
    assert.ok(registerExplain.summary.sources.includes('.emb-agent/firmware-snippets/pwm-init.md'));
    assert.ok(registerExplain.evidence.some(edge =>
      edge.from === 'tool-run:runs/timer-calc.json' &&
      edge.relation === 'writes_register'
    ));
    assert.ok(registerExplain.evidence.some(edge =>
      edge.from === 'firmware-snippet:firmware-snippets/pwm-init.md' &&
      edge.relation === 'writes_register'
    ));
    assert.ok(registerExplain.next_steps.some(step => /knowledge graph path register:sc8p052b-pwmtl/.test(step)));
    assert.equal(snippetExplain.found, true);
    assert.equal(snippetExplain.matched.id, 'firmware-snippet:firmware-snippets/pwm-init.md');
    assert.ok(snippetExplain.evidence.some(edge =>
      edge.from === 'tool-run:runs/timer-calc.json' &&
      edge.relation === 'materialized_by'
    ));
    assert.equal(missingExplain.found, false);
    assert.equal(missingExplain.reason, 'node-not-found');
    assert.ok(missingExplain.next_steps.includes('knowledge graph query no-such-register'));
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge graph report and lint detect stale tracked artifacts', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-graph-stale-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['knowledge', 'init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['chip: SC8P052B', 'package: SOP8', ''].join('\n'),
      'utf8'
    );

    await captureCliJson(['knowledge', 'graph', 'build']);
    const freshReport = await captureCliJson(['knowledge', 'graph', 'report']);
    assert.equal(freshReport.stale, false);
    assert.deepEqual(freshReport.next_steps, []);

    const runsDir = path.join(tempProject, '.emb-agent', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, 'timer-calc.json'),
      JSON.stringify({ tool: 'timer-calc', status: 'ok' }, null, 2) + '\n',
      'utf8'
    );

    const staleReport = await captureCliJson(['knowledge', 'graph', 'report']);
    const lint = await captureCliJson(['knowledge', 'graph', 'lint']);

    assert.equal(staleReport.stale, true);
    assert.ok(staleReport.changed_files.includes('.emb-agent/runs/timer-calc.json'));
    assert.ok(staleReport.added_files.includes('.emb-agent/runs/timer-calc.json'));
    assert.ok(staleReport.next_steps.includes('knowledge graph refresh'));
    assert.equal(lint.stale, true);
    assert.ok(lint.changed_files.includes('.emb-agent/runs/timer-calc.json'));
    assert.ok(lint.issues.some(issue => issue.code === 'graph-stale'));
    assert.ok(lint.next_steps.includes('Run knowledge graph refresh.'));
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge graph refresh rebuilds only missing or stale graphs', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-graph-refresh-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['knowledge', 'init']);
    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      ['chip: SC8P052B', 'package: SOP8', ''].join('\n'),
      'utf8'
    );

    const missing = await captureCliJson(['knowledge', 'graph', 'refresh']);
    assert.equal(missing.status, 'built');
    assert.equal(missing.refreshed, true);
    assert.equal(missing.reason, 'graph-missing');

    const fresh = await captureCliJson(['knowledge', 'graph', 'refresh']);
    assert.equal(fresh.status, 'fresh');
    assert.equal(fresh.skipped, true);
    assert.equal(fresh.stale, false);
    assert.deepEqual(fresh.next_steps, []);

    const runsDir = path.join(tempProject, '.emb-agent', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, 'timer-calc.json'),
      JSON.stringify({ tool: 'timer-calc', status: 'ok' }, null, 2) + '\n',
      'utf8'
    );

    const stale = await captureCliJson(['knowledge', 'graph', 'refresh']);
    assert.equal(stale.status, 'built');
    assert.equal(stale.refreshed, true);
    assert.equal(stale.reason, 'stale');
    assert.ok(stale.changed_files.includes('.emb-agent/runs/timer-calc.json'));

    const report = await captureCliJson(['knowledge', 'graph', 'report']);
    assert.equal(report.stale, false);
  } finally {
    process.chdir(currentCwd);
  }
});

test('next context exposes knowledge graph freshness without rerouting workflow', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-knowledge-next-graph-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const missing = cli.buildNextContext();
    assert.equal(missing.knowledge_graph.initialized, false);
    assert.equal(missing.knowledge_graph.state, 'missing');
    assert.deepEqual(missing.knowledge_graph.next_steps, ['knowledge graph refresh']);
    assert.notEqual(missing.next.command, 'knowledge graph refresh');

    await captureCliJson(['knowledge', 'graph', 'build']);
    const fresh = cli.buildNextContext();
    assert.equal(fresh.knowledge_graph.initialized, true);
    assert.equal(fresh.knowledge_graph.state, 'fresh');
    assert.equal(fresh.knowledge_graph.stale, false);
    assert.deepEqual(fresh.knowledge_graph.next_steps, []);
    assert.notEqual(fresh.next.command, 'knowledge graph refresh');

    const runsDir = path.join(tempProject, '.emb-agent', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, 'timer-calc.json'),
      JSON.stringify({ tool: 'timer-calc', status: 'ok' }, null, 2) + '\n',
      'utf8'
    );

    const stale = cli.buildNextContext();
    assert.equal(stale.knowledge_graph.initialized, true);
    assert.equal(stale.knowledge_graph.state, 'stale');
    assert.equal(stale.knowledge_graph.stale, true);
    assert.ok(stale.knowledge_graph.changed_files.includes('.emb-agent/runs/timer-calc.json'));
    assert.ok(stale.knowledge_graph.next_steps.includes('knowledge graph refresh'));
    assert.equal(stale.next.command, fresh.next.command);
  } finally {
    process.chdir(currentCwd);
  }
});

test('knowledge command is visible in advanced command inventory', async () => {
  const listed = await captureCliJson(['commands', 'list', '--all']);
  const shown = await captureCliJson(['commands', 'show', 'knowledge']);

  assert.ok(listed.includes('knowledge'));
  assert.equal(shown.name, 'knowledge');
  assert.match(shown.content, /persistent knowledge wiki/i);
  assert.match(shown.content, /knowledge graph build/);
  assert.match(shown.content, /knowledge graph refresh/);
});
