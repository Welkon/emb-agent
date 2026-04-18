'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeRoot = path.join(repoRoot, 'runtime');
const initProject = require(path.join(runtimeRoot, 'scripts', 'init-project.cjs'));
const cli = require(path.join(runtimeRoot, 'bin', 'emb-agent.cjs'));

async function captureJson(run) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await run();
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

test('adapter derive creates extension registries and profile skeletons', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-derive-'));
  const currentCwd = process.cwd();

  try {
    await suppressStdout(() => Promise.resolve(initProject.main(['--project', tempProject])));
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    const result = await captureJson(() =>
      cli.main([
        'support',
        'derive',
        '--family',
        'scmcu-sc8f0xx',
        '--device',
        'sc8f072',
        '--chip',
        'sc8f072ad608sp',
        '--tool',
        'timer-calc',
        '--tool',
        'pwm-calc',
        '--tool',
        'adc-scale',
        '--vendor',
        'SCMCU',
        '--series',
        'SC8F072',
        '--package',
        'sop8',
        '--pin-count',
        '8'
      ])
    );

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.tools, ['timer-calc', 'pwm-calc', 'adc-scale']);
    assert.equal(result.reusability.status, 'project-only');
    assert.equal(result.reusability.recommended_action, 'keep-project-local');
    assert.equal(result.trust.safe_to_execute, false);
    assert.equal(result.trust.primary.tool, 'timer-calc');
    assert.equal(result.trust.primary.grade, 'draft');
    assert.equal(result.trust.primary.recommended_action, 'complete-chip-support');
    assert.ok(result.notes.some(item => item.includes('draft chip support')));
    assert.ok(result.notes.some(item => item.includes('do not treat tool output as ground truth')));

    const toolRegistry = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'registry.json'), 'utf8')
    );
    const chipRegistry = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'registry.json'), 'utf8')
    );
    const deviceProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'sc8f072.json'), 'utf8')
    );
    const chipProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'profiles', 'sc8f072ad608sp.json'), 'utf8')
    );
    const timerRoutePath = path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'timer-calc.cjs');
    const pwmRoutePath = path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'pwm-calc.cjs');
    const adcRoutePath = path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'adc-scale.cjs');
    const loadedChip = cli.chipCatalog.loadChip(runtimeRoot, 'sc8f072ad608sp');
    const routeResult = cli.toolRuntime.runTool(runtimeRoot, 'timer-calc', [
      '--family',
      'scmcu-sc8f0xx',
      '--device',
      'sc8f072',
      '--target-us',
      '560'
    ]);
    const pwmRouteResult = cli.toolRuntime.runTool(runtimeRoot, 'pwm-calc', [
      '--family',
      'scmcu-sc8f0xx',
      '--device',
      'sc8f072',
      '--target-hz',
      '1000',
      '--target-duty',
      '25'
    ]);
    const adcRouteResult = cli.toolRuntime.runTool(runtimeRoot, 'adc-scale', [
      '--family',
      'scmcu-sc8f0xx',
      '--device',
      'sc8f072',
      '--sample-code',
      '128'
    ]);

    assert.deepEqual(toolRegistry.families, ['scmcu-sc8f0xx']);
    assert.deepEqual(toolRegistry.devices, ['sc8f072']);
    assert.deepEqual(chipRegistry.devices, ['sc8f072ad608sp']);
    assert.equal(fs.existsSync(timerRoutePath), true);
    assert.equal(fs.existsSync(pwmRoutePath), true);
    assert.equal(fs.existsSync(adcRoutePath), true);
    assert.deepEqual(deviceProfile.supported_tools, ['timer-calc', 'pwm-calc', 'adc-scale']);
    assert.deepEqual(Object.keys(deviceProfile.bindings), ['timer-calc', 'pwm-calc', 'adc-scale']);
    assert.equal(deviceProfile.bindings['timer-calc'].draft, true);
    assert.equal(deviceProfile.bindings['timer-calc'].algorithm, 'sc8f072-timer-calc');
    assert.equal(deviceProfile.bindings['pwm-calc'].draft, true);
    assert.equal(deviceProfile.bindings['pwm-calc'].algorithm, 'sc8f072-pwm-calc');
    assert.equal(deviceProfile.bindings['adc-scale'].draft, true);
    assert.equal(deviceProfile.bindings['adc-scale'].algorithm, 'sc8f072-adc-scale');
    assert.equal(routeResult.status, 'draft-chip-support');
    assert.equal(routeResult.implementation, 'external-chip-support-draft');
    assert.equal(routeResult.binding.algorithm, 'sc8f072-timer-calc');
    assert.equal(pwmRouteResult.status, 'draft-chip-support');
    assert.equal(pwmRouteResult.implementation, 'external-chip-support-draft');
    assert.equal(pwmRouteResult.binding.algorithm, 'sc8f072-pwm-calc');
    assert.equal(adcRouteResult.status, 'draft-chip-support');
    assert.equal(adcRouteResult.implementation, 'external-chip-support-draft');
    assert.equal(adcRouteResult.binding.algorithm, 'sc8f072-adc-scale');
    assert.equal(chipProfile.packages[0].name, 'sop8');
    assert.equal(chipProfile.packages[0].pin_count, 8);
    assert.deepEqual(chipProfile.pins, {});
    assert.deepEqual(chipProfile.related_tools, ['timer-calc', 'pwm-calc', 'adc-scale']);
    assert.equal(loadedChip.packages[0].name, 'sop8');
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter derive can infer family device chip and tools from project truth', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-derive-truth-'));
  const currentCwd = process.cwd();

  try {
    await suppressStdout(() => Promise.resolve(initProject.main(['--project', tempProject])));
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      [
        'mcu:',
        '  vendor: "SCMCU"',
        '  model: "SC8F072"',
        '  package: "SOP8"',
        '',
        'board:',
        '  name: ""',
        '  target: ""',
        '',
        'sources:',
        '  datasheet:',
        '    - "docs/SC8F072.pdf"',
        '  schematic:',
        '    - ""',
        '  code:',
        '    - ""',
        '',
        'signals:',
        '  - name: "PWM_OUT"',
        '    pin: "PA3"',
        '    direction: "output"',
        '    default_state: "low"',
        '    confirmed: false',
        '    note: ""',
        '',
        'peripherals:',
        '  - name: "Timer16"',
        '    usage: "time base"',
        '  - name: "PWM"',
        '    usage: "dimming"',
        '  - name: "ADC"',
        '    usage: "sampling"',
        '',
        'truths:',
        '  - "Board uses SC8F072 SOP8"',
        '',
        'constraints:',
        '  - "PA5 reserved for programming"',
        '',
        'unknowns:',
        '  - ""',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await captureJson(() =>
      cli.main([
        'support',
        'derive',
        '--from-project'
      ])
    );

    const chipProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'profiles', 'sc8f072sop8.json'), 'utf8')
    );

    assert.equal(result.status, 'ok');
    assert.equal(result.family, 'scmcu-sc8f072');
    assert.equal(result.device, 'sc8f072');
    assert.equal(result.chip, 'sc8f072sop8');
    assert.equal(result.reusability.status, 'reusable-candidate');
    assert.equal(result.reusability.recommended_action, 'review-for-catalog');
    assert.ok(result.reusability.reasons.includes('source-mode=project'));
    assert.equal(result.trust.primary.recommended_action, 'complete-chip-support');
    assert.deepEqual(result.tools, ['timer-calc', 'pwm-calc', 'adc-scale']);
    assert.equal(result.inferred.from_project, true);
    assert.equal(result.inferred.source_mode, 'project');
    assert.deepEqual(result.inferred.binding_tools, ['timer-calc', 'pwm-calc', 'adc-scale']);
    assert.deepEqual(chipProfile.related_tools, ['timer-calc', 'pwm-calc', 'adc-scale']);
    assert.deepEqual(chipProfile.capabilities, ['Timer16', 'PWM', 'ADC']);
    assert.equal(chipProfile.package, 'SOP8');
    assert.equal(chipProfile.packages[0].pin_count, 8);
    assert.equal(chipProfile.summary.source_mode, 'project');

    const deviceProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'sc8f072.json'), 'utf8')
    );

    assert.equal(deviceProfile.bindings['timer-calc'].draft, true);
    assert.equal(deviceProfile.bindings['timer-calc'].params.default_timer, 'Timer16');
    assert.equal(deviceProfile.bindings['pwm-calc'].params.default_output_pin, 'PA3');
    assert.equal(deviceProfile.bindings['adc-scale'].draft, true);
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter derive drafts chip pins and richer bindings from project signals', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-derive-project-signals-'));
  const currentCwd = process.cwd();

  try {
    await suppressStdout(() => Promise.resolve(initProject.main(['--project', tempProject])));
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      [
        'mcu:',
        '  vendor: "SCMCU"',
        '  model: "SC8F072"',
        '  package: "SOP8"',
        '',
        'board:',
        '  name: ""',
        '  target: ""',
        '',
        'sources:',
        '  datasheet:',
        '    - "docs/SC8F072.pdf"',
        '  schematic:',
        '    - ""',
        '  code:',
        '    - ""',
        '',
        'signals:',
        '  - name: "PWM_OUT"',
        '    pin: "PA3"',
        '    direction: "output"',
        '    default_state: "low"',
        '    confirmed: true',
        '    usage: "pwm-output"',
        '    note: "TM2 PWM output"',
        '  - name: "ADC_TEMP"',
        '    pin: "PA0"',
        '    direction: "input"',
        '    default_state: ""',
        '    confirmed: true',
        '    usage: "adc-input"',
        '    note: "Temperature sense input"',
        '  - name: "CMP_REF_NEG"',
        '    pin: "PA1"',
        '    direction: "input"',
        '    default_state: ""',
        '    confirmed: false',
        '    usage: "comparator-input"',
        '    note: "Comparator negative reference / VREF"',
        '',
        'peripherals:',
        '  - name: "Timer16"',
        '    usage: "time base"',
        '  - name: "TM2"',
        '    usage: "pwm generator"',
        '  - name: "PWM"',
        '    usage: "dimming"',
        '  - name: "ADC"',
        '    usage: "sampling"',
        '  - name: "Comparator"',
        '    usage: "threshold detect"',
        '',
        'truths:',
        '  - "Board uses SC8F072 SOP8"',
        '',
        'constraints:',
        '  - "PA5 reserved for programming"',
        '',
        'unknowns:',
        '  - ""',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await captureJson(() =>
      cli.main([
        'support',
        'derive',
        '--from-project',
        '--tool',
        'timer-calc',
        '--tool',
        'pwm-calc',
        '--tool',
        'adc-scale',
        '--tool',
        'comparator-threshold'
      ])
    );

    const chipProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'profiles', 'sc8f072sop8.json'), 'utf8')
    );
    const deviceProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'sc8f072.json'), 'utf8')
    );

    assert.equal(result.status, 'ok');
    assert.equal(chipProfile.packages[0].pins.length, 4);
    assert.equal(chipProfile.packages[0].pins.find(item => item.signal === 'PA3').label, 'PWM_OUT');
    assert.equal(chipProfile.packages[0].pins.find(item => item.signal === 'PA0').default_function, 'adc-input');
    assert.equal(chipProfile.pins.PA3.port, 'PA');
    assert.equal(chipProfile.pins.PA3.bit, 3);
    assert.deepEqual(chipProfile.pins.PA3.functions, ['PWM_OUT', 'pwm-output']);
    assert.ok(chipProfile.pins.PA5.notes.some(item => item.includes('programming')));
    assert.equal(deviceProfile.bindings['timer-calc'].params.default_timer, 'Timer16');
    assert.deepEqual(
      Object.keys(deviceProfile.bindings['timer-calc'].params.timer_variants),
      ['Timer16', 'TM2']
    );
    assert.equal(deviceProfile.bindings['pwm-calc'].params.default_output_pin, 'PA3');
    assert.deepEqual(Object.keys(deviceProfile.bindings['pwm-calc'].params.output_pins), ['PA3']);
    assert.equal(deviceProfile.bindings['adc-scale'].params.default_channel, 'PA0');
    assert.deepEqual(Object.keys(deviceProfile.bindings['adc-scale'].params.channels), ['PA0']);
    assert.deepEqual(
      Object.keys(deviceProfile.bindings['comparator-threshold'].params.positive_sources),
      ['PA0']
    );
    assert.deepEqual(
      Object.keys(deviceProfile.bindings['comparator-threshold'].params.negative_sources),
      ['PA1']
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter derive can infer from hardware doc draft and attach doc metadata', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-derive-doc-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    await suppressStdout(() => Promise.resolve(initProject.main(['--project', tempProject])));
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf content', 'utf8');

    process.chdir(tempProject);
    await cli.main(['init']);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-adapter-derive',
            markdown: '# PMS150G SOP8\n\n- Timer16 exists\n- PWM output supported\n- ADC input supported\n- Comparator available\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/result.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );

    process.stdout.write = originalWrite;

    const result = await captureJson(() =>
      cli.main([
        'support',
        'derive',
        '--from-doc',
        ingested.doc_id,
        '--vendor',
        'Padauk'
      ])
    );

    const chipProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'profiles', 'pms150gsop8.json'), 'utf8')
    );
    const comparatorRoutePath = path.join(tempProject, '.emb-agent', 'chip-support', 'routes', 'comparator-threshold.cjs');
    const comparatorRouteResult = cli.toolRuntime.runTool(runtimeRoot, 'comparator-threshold', [
      '--family',
      'padauk-pms150g',
      '--device',
      'pms150g',
      '--vdd',
      '5',
      '--target-threshold-v',
      '2.5'
    ]);

    assert.equal(result.status, 'ok');
    assert.equal(result.family, 'padauk-pms150g');
    assert.equal(result.device, 'pms150g');
    assert.equal(result.chip, 'pms150gsop8');
    assert.equal(result.reusability.status, 'reusable-candidate');
    assert.equal(result.reusability.recommended_action, 'review-for-catalog');
    assert.ok(result.reusability.reasons.includes('source-mode=doc'));
    assert.equal(result.trust.safe_to_execute, false);
    assert.equal(result.trust.primary.recommended_action, 'complete-chip-support');
    assert.deepEqual(
      result.tools,
      ['timer-calc', 'pwm-calc', 'adc-scale', 'comparator-threshold']
    );
    assert.equal(result.inferred.from_doc, ingested.doc_id);
    assert.deepEqual(
      result.inferred.binding_tools,
      ['timer-calc', 'pwm-calc', 'adc-scale', 'comparator-threshold']
    );
    assert.deepEqual(chipProfile.related_tools, ['timer-calc', 'pwm-calc', 'adc-scale', 'comparator-threshold']);
    assert.deepEqual(chipProfile.capabilities, ['Timer16', 'PWM', 'ADC', 'Comparator']);
    assert.equal(chipProfile.docs.length, 1);
    assert.equal(chipProfile.docs[0].id, ingested.doc_id);
    assert.equal(chipProfile.docs[0].kind, 'datasheet');
    assert.equal(chipProfile.packages[0].pin_count, 8);
    assert.equal(chipProfile.packages[0].pins[0].signal, 'PA5');
    assert.equal(chipProfile.packages[0].pins[0].default_function, 'programming');
    assert.equal(chipProfile.pins.PA5.port, 'PA');
    assert.equal(chipProfile.pins.PA5.bit, 5);
    assert.equal(chipProfile.summary.source_mode, 'doc');
    assert.equal(fs.existsSync(comparatorRoutePath), true);

    const deviceProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'pms150g.json'), 'utf8')
    );

    assert.equal(deviceProfile.bindings['timer-calc'].draft, true);
    assert.equal(deviceProfile.bindings['timer-calc'].params.default_timer, 'Timer16');
    assert.equal(deviceProfile.bindings['comparator-threshold'].draft, true);
    assert.equal(deviceProfile.bindings['adc-scale'].draft, true);
    assert.equal(comparatorRouteResult.status, 'draft-chip-support');
    assert.equal(comparatorRouteResult.implementation, 'external-chip-support-draft');
    assert.equal(comparatorRouteResult.binding.algorithm, 'pms150g-comparator-threshold');
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('adapter derive can consume AI analysis artifact as structured input', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-derive-analysis-'));
  const currentCwd = process.cwd();

  try {
    await suppressStdout(() => Promise.resolve(initProject.main(['--project', tempProject])));
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    const artifactDir = path.join(tempProject, '.emb-agent', 'analysis');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactDir, 'esp32-c3.json'),
      JSON.stringify({
        chip_support_analysis: {
          vendor: 'Espressif',
          series: 'ESP32-C3',
          model: 'ESP32-C3',
          family: 'espressif-esp32-c3',
          device: 'esp32-c3',
          package: 'QFN32',
          pin_count: 32,
          architecture: '32-bit RISC-V',
          runtime_model: 'main_loop_plus_isr',
          tools: ['timer-calc', 'pwm-calc', 'adc-scale'],
          capabilities: ['GPTimer', 'LEDC', 'ADC'],
          docs: [
            {
              id: 'doc-esp32-c3-datasheet',
              kind: 'datasheet',
              title: 'ESP32-C3 Datasheet',
              notes: ['AI extracted summary']
            }
          ],
          truths: ['ESP32-C3 integrates GPTimer, LEDC, and SAR ADC.'],
          constraints: ['GPIO18 defaults to USB Serial/JTAG.'],
          unknowns: ['Exact register-level formulas still need confirmation.'],
          signals: [
            {
              name: 'PWM_OUT',
              pin: 'GPIO18',
              direction: 'output',
              confirmed: false,
              usage: 'pwm-output',
              note: 'LEDC candidate output'
            },
            {
              name: 'ADC_IN',
              pin: 'GPIO0',
              direction: 'input',
              confirmed: true,
              usage: 'adc-input',
              note: 'ADC1_CH0 candidate input'
            }
          ],
          peripherals: [
            { name: 'GPTimer', usage: 'general timing' },
            { name: 'LEDC', usage: 'pwm generation' },
            { name: 'ADC', usage: 'voltage sampling' }
          ],
          bindings: {
            'lvdc-threshold': {
              algorithm: 'unsupported',
              reason: 'Brownout detector has no user-facing discrete threshold table.'
            }
          },
          notes: ['Artifact generated by AI datasheet analysis.']
        }
      }, null, 2),
      'utf8'
    );

    const result = await captureJson(() =>
      cli.main([
        'support',
        'derive',
        '--from-analysis',
        '.emb-agent/analysis/esp32-c3.json'
      ])
    );

    const chipProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'chips', 'profiles', 'esp32c3qfn32.json'), 'utf8')
    );
    const deviceProfile = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'extensions', 'tools', 'devices', 'esp32-c3.json'), 'utf8')
    );

    assert.equal(result.status, 'ok');
    assert.equal(result.family, 'espressif-esp32-c3');
    assert.equal(result.device, 'esp32-c3');
    assert.equal(result.chip, 'esp32c3qfn32');
    assert.equal(result.inferred.from_analysis, '.emb-agent/analysis/esp32-c3.json');
    assert.equal(result.inferred.source_mode, 'analysis');
    assert.deepEqual(result.tools, ['timer-calc', 'pwm-calc', 'adc-scale']);
    assert.deepEqual(
      result.inferred.binding_tools,
      ['timer-calc', 'pwm-calc', 'adc-scale', 'lvdc-threshold']
    );
    assert.equal(result.reusability.status, 'reusable-candidate');
    assert.ok(result.notes.some(item => item.includes('draft chip support')));

    assert.equal(chipProfile.vendor, 'Espressif');
    assert.equal(chipProfile.architecture, '32-bit RISC-V');
    assert.equal(chipProfile.summary.source_mode, 'analysis');
    assert.deepEqual(chipProfile.related_tools, ['timer-calc', 'pwm-calc', 'adc-scale']);
    assert.deepEqual(chipProfile.capabilities, ['GPTimer', 'LEDC', 'ADC']);
    assert.equal(chipProfile.packages[0].name, 'QFN32');
    assert.equal(chipProfile.packages[0].pin_count, 32);
    assert.equal(chipProfile.docs[0].id, 'doc-esp32-c3-datasheet');
    assert.equal(chipProfile.pins.GPIO18.name, 'GPIO18');
    assert.ok(chipProfile.pins.GPIO18.notes.some(item => item.includes('draft inferred')));

    assert.deepEqual(deviceProfile.supported_tools, ['timer-calc', 'pwm-calc', 'adc-scale']);
    assert.equal(deviceProfile.bindings['timer-calc'].draft, true);
    assert.equal(deviceProfile.bindings['pwm-calc'].draft, true);
    assert.equal(deviceProfile.bindings['adc-scale'].draft, true);
    assert.equal(deviceProfile.bindings['lvdc-threshold'].algorithm, 'unsupported');
    assert.match(
      deviceProfile.bindings['lvdc-threshold'].reason,
      /Brownout detector has no user-facing discrete threshold table/
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('support analysis init creates a schema-backed artifact template', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-analysis-init-'));
  const currentCwd = process.cwd();

  try {
    await suppressStdout(() => Promise.resolve(initProject.main(['--project', tempProject])));
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    const result = await captureJson(() =>
      cli.main([
        'support',
        'analysis',
        'init',
        '--chip',
        'ESP32-C3',
        '--vendor',
        'Espressif',
        '--series',
        'ESP32-C3',
        '--package',
        'QFN32'
      ])
    );

    const artifactPath = path.join(tempProject, '.emb-agent', 'analysis', 'esp32-c3.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    assert.equal(result.status, 'ok');
    assert.equal(result.artifact_path, '.emb-agent/analysis/esp32-c3.json');
    assert.equal(result.schema_id, 'https://emb-agent.dev/schemas/chip-support-analysis.schema.json');
    assert.equal(result.device, 'esp32-c3');
    assert.equal(result.chip, 'esp32-c3');
    assert.match(result.derive_hint, /support derive --from-analysis \.emb-agent\/analysis\/esp32-c3\.json/);

    assert.equal(artifact.$schema, 'https://emb-agent.dev/schemas/chip-support-analysis.schema.json');
    assert.equal(artifact.chip_support_analysis.vendor, 'Espressif');
    assert.equal(artifact.chip_support_analysis.series, 'ESP32-C3');
    assert.equal(artifact.chip_support_analysis.model, 'ESP32-C3');
    assert.equal(artifact.chip_support_analysis.family, 'espressif-esp32-c3');
    assert.equal(artifact.chip_support_analysis.package, 'QFN32');
    assert.deepEqual(artifact.chip_support_analysis.tools, []);
    assert.deepEqual(artifact.chip_support_analysis.bindings, {});
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter derive rejects malformed analysis artifacts before writing adapters', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-derive-analysis-invalid-'));
  const currentCwd = process.cwd();

  try {
    await suppressStdout(() => Promise.resolve(initProject.main(['--project', tempProject])));
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    const artifactDir = path.join(tempProject, '.emb-agent', 'analysis');
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(
      path.join(artifactDir, 'invalid.json'),
      JSON.stringify({
        chip_support_analysis: {
          tools: 'timer-calc',
          bindings: {
            'lvdc-threshold': {
              algorithm: 'unsupported'
            }
          }
        }
      }, null, 2),
      'utf8'
    );

    await assert.rejects(
      () => cli.main([
        'support',
        'derive',
        '--from-analysis',
        '.emb-agent/analysis/invalid.json'
      ]),
      /Analysis artifact validation failed .*tools must be an array of strings.*bindings\.lvdc-threshold\.reason is required when algorithm is unsupported.*identity must provide at least one of model, device, or chip/
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('adapter generate can write emb-style output to arbitrary root', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-generate-project-'));
  const tempOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-generate-output-'));
  const currentCwd = process.cwd();

  try {
    await suppressStdout(() => Promise.resolve(initProject.main(['--project', tempProject])));
    process.chdir(tempProject);
    await suppressStdout(() => cli.main(['init']));

    fs.writeFileSync(
      path.join(tempProject, '.emb-agent', 'hw.yaml'),
      [
        'mcu:',
        '  vendor: "SCMCU"',
        '  model: "SC8F072"',
        '  package: "SOP8"',
        '',
        'board:',
        '  name: ""',
        '  target: ""',
        '',
        'sources:',
        '  datasheet:',
        '    - "docs/SC8F072.pdf"',
        '  schematic:',
        '    - ""',
        '  code:',
        '    - ""',
        '',
        'signals:',
        '  - name: "PWM_OUT"',
        '    pin: "PA3"',
        '    direction: "output"',
        '    default_state: "low"',
        '    confirmed: false',
        '    note: ""',
        '',
        'peripherals:',
        '  - name: "Timer16"',
        '    usage: "time base"',
        '  - name: "PWM"',
        '    usage: "dimming"',
        '',
        'truths:',
        '  - "Board uses SC8F072 SOP8"',
        '',
        'constraints:',
        '  - ""',
        '',
        'unknowns:',
        '  - ""',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = await captureJson(() =>
      cli.main([
        'support',
        'generate',
        '--from-project',
        '--output-root',
        tempOutput
      ])
    );

    assert.equal(result.status, 'ok');
    assert.equal(result.target, 'path');
    assert.equal(result.output_root, tempOutput);
    assert.equal(result.emb_root, tempOutput);
    assert.equal(result.reusability.status, 'reusable-candidate');
    assert.equal(result.reusability.publish, 'maintainer-review-only');
    assert.equal(fs.existsSync(path.join(tempOutput, 'extensions', 'tools', 'families', 'scmcu-sc8f072.json')), true);
    assert.equal(fs.existsSync(path.join(tempOutput, 'extensions', 'tools', 'devices', 'sc8f072.json')), true);
    assert.equal(fs.existsSync(path.join(tempOutput, 'extensions', 'chips', 'profiles', 'sc8f072sop8.json')), true);
    assert.equal(fs.existsSync(path.join(tempOutput, 'chip-support', 'routes', 'timer-calc.cjs')), true);
    assert.equal(fs.existsSync(path.join(tempOutput, 'chip-support', 'routes', 'pwm-calc.cjs')), true);
  } finally {
    process.chdir(currentCwd);
  }
});
