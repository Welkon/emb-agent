'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const ingestDocCli = require(path.join(repoRoot, 'runtime', 'scripts', 'ingest-doc.cjs'));

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

async function suppressStdout(run) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    await run();
  } finally {
    process.stdout.write = originalWrite;
  }
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function installSc8p052bTimerSupport(projectRoot) {
  const embDir = path.join(projectRoot, '.emb-agent');
  fs.mkdirSync(path.join(embDir, 'extensions', 'chips', 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(embDir, 'extensions', 'tools', 'families'), { recursive: true });
  fs.mkdirSync(path.join(embDir, 'extensions', 'tools', 'devices'), { recursive: true });
  fs.mkdirSync(path.join(embDir, 'chip-support', 'routes'), { recursive: true });

  writeFile(
    path.join(embDir, 'extensions', 'chips', 'registry.json'),
    JSON.stringify({ devices: ['SC8P052B'] }, null, 2) + '\n'
  );
  writeFile(
    path.join(embDir, 'extensions', 'chips', 'profiles', 'sc8p052b.json'),
    JSON.stringify({
      name: 'SC8P052B',
      vendor: 'SinOne',
      family: 'sinone-8bit',
      sample: false,
      series: 'SC8P',
      package: 'SOP8',
      architecture: '8-bit',
      runtime_model: 'main_loop_plus_isr',
      description: 'Project-local SC8P052B profile for full workflow smoke.',
      summary: {},
      capabilities: ['timer', 'pwm', 'gpio'],
      docs: [],
      related_tools: ['timer-calc'],
      source_modules: [],
      notes: []
    }, null, 2) + '\n'
  );
  writeFile(
    path.join(embDir, 'extensions', 'tools', 'registry.json'),
    JSON.stringify({ specs: [], families: ['sinone-8bit'], devices: ['sc8p052b'] }, null, 2) + '\n'
  );
  writeFile(
    path.join(embDir, 'extensions', 'tools', 'families', 'sinone-8bit.json'),
    JSON.stringify({
      name: 'sinone-8bit',
      vendor: 'SinOne',
      series: 'SC8P',
      sample: false,
      description: 'Project-local SinOne tool family profile.',
      supported_tools: ['timer-calc'],
      clock_sources: ['sysclk'],
      bindings: {},
      notes: []
    }, null, 2) + '\n'
  );
  writeFile(
    path.join(embDir, 'extensions', 'tools', 'devices', 'sc8p052b.json'),
    JSON.stringify({
      name: 'sc8p052b',
      family: 'sinone-8bit',
      sample: false,
      description: 'Project-local SC8P052B tool profile.',
      supported_tools: ['timer-calc'],
      bindings: {
        'timer-calc': {
          algorithm: 'sc8p052b-timer-calc',
          draft: true,
          params: {
            default_timer: 'TM2',
            default_clock_source: 'sysclk',
            prescalers: [1, 4, 16, 64],
            interrupt_bits: [8, 9, 10],
            period_max: 255,
            registers: {
              period: 'PR2',
              counter: 'TMR2'
            },
            register_writes: {
              period_value: [
                {
                  register: 'PR2',
                  field: 'PR2<7:0>',
                  value_key: 'period_value',
                  source_lsb: 0,
                  width: 8,
                  target_lsb: 0
                }
              ]
            }
          }
        }
      },
      notes: []
    }, null, 2) + '\n'
  );
  writeFile(
    path.join(embDir, 'chip-support', 'routes', 'timer-calc.cjs'),
    [
      "'use strict';",
      '',
      "const path = require('path');",
      '',
      "const TOOL_NAME = 'timer-calc';",
      "const DEFAULT_FAMILY = 'sinone-8bit';",
      "const DEFAULT_DEVICE = 'sc8p052b';",
      '',
      'function loadBinding(context, options) {',
      "  const toolCatalog = require(path.join(context.rootDir, 'lib', 'tool-catalog.cjs'));",
      "  const requestedDevice = String(options.device || DEFAULT_DEVICE || '').trim();",
      "  const requestedFamily = String(options.family || DEFAULT_FAMILY || '').trim();",
      '  let deviceProfile = null;',
      '  let familyProfile = null;',
      '  if (requestedDevice) {',
      '    try { deviceProfile = toolCatalog.loadDevice(context.rootDir, requestedDevice); } catch { deviceProfile = null; }',
      '  }',
      '  const resolvedFamily = (deviceProfile && deviceProfile.family) || requestedFamily;',
      '  if (resolvedFamily) {',
      '    try { familyProfile = toolCatalog.loadFamily(context.rootDir, resolvedFamily); } catch { familyProfile = null; }',
      '  }',
      '  const deviceBinding = deviceProfile && deviceProfile.bindings ? deviceProfile.bindings[TOOL_NAME] : null;',
      '  const familyBinding = familyProfile && familyProfile.bindings ? familyProfile.bindings[TOOL_NAME] : null;',
      '  return {',
      '    device: requestedDevice,',
      '    family: resolvedFamily,',
      '    source: deviceBinding ? "device" : familyBinding ? "family" : "none",',
      '    binding: deviceBinding || familyBinding || null',
      '  };',
      '}',
      '',
      'module.exports = {',
      '  draft: true,',
      '  runTool(context) {',
      "    const generated = require(path.join(context.rootDir, 'lib', 'generated-tool-adapters.cjs'));",
      '    const options = context.parseLongOptions(context.tokens || []);',
      '    const resolved = loadBinding(context, options);',
      '    return generated.runGeneratedTimerAdapter(context, resolved, options);',
      '  }',
      '};',
      ''
    ].join('\n')
  );
}

test('full workflow smoke covers practical embedded project loop', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-full-workflow-'));
  const currentCwd = process.cwd();
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  const previousBridge = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
  const providerImpls = {
    mineru: {
      async parseDocument() {
        return {
          provider: 'mineru',
          mode: 'agent',
          task_id: 'task-full-workflow',
          markdown: [
            '# SC8P052B SOP8',
            '',
            '- TM2 can generate the PWM period base.',
            '- PR2 controls the 8-bit period register.',
            '- Keep generated register writes reviewable before source patching.'
          ].join('\n'),
          metadata: {
            completed: {
              full_md_url: 'https://mineru.invalid/sc8p052b.md'
            }
          }
        };
      }
    }
  };

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = 'mock://ok';
    process.chdir(tempProject);
    childProcess.execFileSync('git', ['init'], { cwd: tempProject, stdio: 'ignore' });

    await suppressStdout(() => cli.main(['init']));
    installSc8p052bTimerSupport(tempProject);
    await suppressStdout(() => cli.main(['risk', 'add', 'irq and pwm timing may contend']));
    const dispatchRun = await captureCliJson(['dispatch', 'run', 'next']);
    assert.equal(dispatchRun.subagent_bridge.status, 'ok');
    assert.equal(dispatchRun.worker_results[0].status, 'ok');
    assert.equal(dispatchRun.delegation_runtime.synthesis.status, 'ready');

    writeFile(path.join(tempProject, 'docs', 'SC8P052B.pdf'), 'fake datasheet payload\n');
    writeFile(
      path.join(tempProject, 'src', 'main.c'),
      ['#include "app.h"', '', 'void system_init(void)', '{', '    PR2 = 0x00U;', '}', ''].join('\n')
    );

    await suppressStdout(() => cli.main([
      'declare',
      'hardware',
      '--confirm',
      '--mcu',
      'SC8P052B',
      '--package',
      'SOP8',
      '--signal',
      'PWM_OUT',
      '--pin',
      'PA3',
      '--dir',
      'output',
      '--confirmed',
      'true',
      '--peripheral',
      'TM2',
      '--usage',
      'PWM period base'
    ]));

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/SC8P052B.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );
    const applied = await cli.runIngestCommand(
      'apply',
      ['doc', ingested.doc_id, '--to', 'hardware'],
      { providerImpls }
    );
    assert.equal(ingested.truth_write.status, 'ready-to-apply');
    assert.equal(applied.truth_write.status, 'written');
    assert.equal(ingestDocCli.showDoc(tempProject, ingested.doc_id).parse_info.provider, 'mineru');

    const startBrief = await captureCliJson(['start', '--brief']);
    const nextBrief = await captureCliJson(['next', '--brief']);
    const externalNext = await captureCliJson(['external', 'next']);
    assert.equal(startBrief.output_mode, 'brief');
    assert.equal(nextBrief.product_layer.id, 'embedded_workflow');
    assert.equal(nextBrief.next.product_layer.id, 'embedded_workflow');
    assert.equal(externalNext.product_layer.id, 'embedded_workflow');

    await suppressStdout(() => cli.main(['knowledge', 'init']));
    const chipPage = await captureCliJson([
      'knowledge',
      'save-query',
      'SC8P052B',
      '--kind',
      'chip',
      '--summary',
      'SC8P052B board bring-up facts gathered from datasheet and local truth.',
      '--body',
      'TM2 and PR2 drive the current PWM timing investigation.',
      '--confirm'
    ]);
    assert.equal(chipPage.status, 'written');

    const toolRun = await captureCliJson([
      'tool',
      'run',
      'timer-calc',
      '--family',
      'sinone-8bit',
      '--device',
      'sc8p052b',
      '--clock-source',
      'sysclk',
      '--clock-hz',
      '16000000',
      '--target-us',
      '64',
      '--save-output',
      '--output-file',
      '.emb-agent/runs/timer-calc.json'
    ]);
    assert.equal(toolRun.status, 'ok');
    assert.equal(toolRun.saved_output, '.emb-agent/runs/timer-calc.json');
    assert.equal(toolRun.best_candidate.period_register, 'PR2');

    const formula = await captureCliJson([
      'knowledge',
      'formula',
      'draft',
      '--from-tool-output',
      '.emb-agent/runs/timer-calc.json',
      '--confirm'
    ]);
    assert.equal(formula.status, 'written');
    assert.equal(formula.formulas[0].id, 'sc8p052b.tm2.period');
    const formulaRegistry = JSON.parse(fs.readFileSync(path.join(tempProject, '.emb-agent', 'formulas', 'sc8p052b.json'), 'utf8'));
    assert.equal(formulaRegistry.formulas[0].id, 'sc8p052b.tm2.period');

    const snippet = await captureCliJson([
      'snippet',
      'draft',
      '--from-tool-output',
      '.emb-agent/runs/timer-calc.json',
      '--title',
      'SC8P052B TM2 period',
      '--confirm'
    ]);
    assert.equal(snippet.status, 'written');
    assert.match(snippet.artifact_path, /sc8p052b-tm2-period\.md$/);

    const graphReport = await captureCliJson(['knowledge', 'graph', 'build']);
    const graphQuery = await captureCliJson(['knowledge', 'graph', 'query', 'PR2']);
    const graphExplain = await captureCliJson(['knowledge', 'graph', 'explain', 'formula:sc8p052b.tm2.period']);
    assert.equal(graphReport.status, 'built');
    assert.ok(graphQuery.nodes.some(node => node.id === 'register:sc8p052b-pr2'));
    assert.ok(graphExplain.summary.sources.includes('.emb-agent/runs/timer-calc.json'));

    childProcess.execFileSync('git', ['add', '.'], { cwd: tempProject, stdio: 'ignore' });
    childProcess.execFileSync(
      'git',
      ['-c', 'user.name=emb-agent-test', '-c', 'user.email=emb-agent-test@example.invalid', 'commit', '-m', 'test fixture'],
      { cwd: tempProject, stdio: 'ignore' }
    );

    await suppressStdout(() => cli.main([
      'task',
      'add',
      '--confirm',
      'Close SC8P052B PWM board loop',
      '--type',
      'implement',
      '--scope',
      'firmware'
    ]));
    const taskName = fs.readdirSync(path.join(tempProject, '.emb-agent', 'tasks'))
      .filter(name => name !== '00-bootstrap-project' && name !== 'archive')[0];
    await suppressStdout(() => cli.main(['task', 'activate', taskName, '--confirm']));
    await suppressStdout(() => cli.main(['project', 'set', '--field', 'quality_gates.required_signoffs', '--value', JSON.stringify(['board-bench'])]));
    await suppressStdout(() => cli.main(['focus', 'set', 'verify pwm period on the SC8P052B board']));
    await suppressStdout(() => cli.main(['capability', 'run', 'scan']));
    await suppressStdout(() => cli.main(['capability', 'run', 'plan']));
    await suppressStdout(() => cli.main(['capability', 'run', 'do']));

    const beforeSignoff = cli.buildNextContext();
    assert.equal(beforeSignoff.next.command, 'verify');
    assert.equal(beforeSignoff.quality_gates.gate_status, 'pending');
    assert.deepEqual(beforeSignoff.quality_gates.pending_signoffs, ['board-bench']);

    await suppressStdout(() => cli.main(['verify', 'confirm', 'board-bench', 'PWM period checked on bench']));
    const verify = cli.buildActionOutput('verify');
    assert.equal(verify.quality_gates.gate_status, 'pass');
    assert.deepEqual(verify.quality_gates.confirmed_signoffs, ['board-bench']);

    const refreshedGraph = await captureCliJson(['knowledge', 'graph', 'refresh']);
    assert.equal(refreshedGraph.status, 'built');

    const status = cli.buildStatus();
    const finalNext = cli.buildNextContext();
    const session = cli.loadSession();
    assert.equal(status.hardware.chip_profile.name, 'SC8P052B');
    assert.equal(finalNext.knowledge_graph.state, 'fresh');
    assert.equal(session.diagnostics.delegation_runtime.synthesis.status, 'ready');
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    if (previousBridge === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = previousBridge;
    }
    process.chdir(currentCwd);
  }
});
