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

function captureJson(run) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return JSON.parse(stdout);
}

test('adapter derive creates extension registries and profile skeletons', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-derive-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

    const result = captureJson(() =>
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

test('adapter derive can infer family device chip and tools from project truth', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-derive-truth-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

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

    const result = captureJson(() =>
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

test('adapter derive drafts chip pins and richer bindings from project signals', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-derive-project-signals-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

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

    const result = captureJson(() =>
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
    initProject.main(['--project', tempProject]);
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

    const result = captureJson(() =>
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

test('adapter generate can write emb-style output to arbitrary root', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-generate-project-'));
  const tempOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-generate-output-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    cli.main(['init']);

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

    const result = captureJson(() =>
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
    assert.equal(fs.existsSync(path.join(tempOutput, 'extensions', 'tools', 'families', 'scmcu-sc8f072.json')), true);
    assert.equal(fs.existsSync(path.join(tempOutput, 'extensions', 'tools', 'devices', 'sc8f072.json')), true);
    assert.equal(fs.existsSync(path.join(tempOutput, 'extensions', 'chips', 'profiles', 'sc8f072sop8.json')), true);
    assert.equal(fs.existsSync(path.join(tempOutput, 'chip-support', 'routes', 'timer-calc.cjs')), true);
    assert.equal(fs.existsSync(path.join(tempOutput, 'chip-support', 'routes', 'pwm-calc.cjs')), true);
  } finally {
    process.chdir(currentCwd);
  }
});
