'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const workflowRegistry = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-registry.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const {
  importSupportWorkflowRegistry,
  withSupportSourceEnv
} = require(path.join(repoRoot, 'tests', 'support-workflow-source.cjs'));

test('workflow registry merges built-in and project specs and resolves auto injection', () => {
  return withSupportSourceEnv(() => {
    const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-registry-'));
    const projectExtDir = runtime.initProjectLayout(tempProject);
    importSupportWorkflowRegistry(tempProject);
    const registryPath = path.join(projectExtDir, 'registry', 'workflow.json');

    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    registry.specs.push({
      name: 'sensor-review-local',
      title: 'Sensor Review Local',
      path: 'specs/sensor-review-local.md',
      summary: 'Project-local sensor review rules.',
      auto_inject: true,
      selectable: false,
      priority: 95,
      apply_when: {
        specs: ['sensor-node']
      },
      focus_areas: [],
      extra_review_axes: [],
      preferred_notes: [],
      default_agents: []
    });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
    fs.writeFileSync(
      path.join(projectExtDir, 'specs', 'sensor-review-local.md'),
      '# Sensor Review Local\n\n- Check project sensor constraints.\n',
      'utf8'
    );

    const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
      projectExtDir
    });
    const injected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
      profile: 'baremetal-loop',
      specs: ['sensor-node'],
      task: { type: 'implement', status: 'active' }
    });

    assert.ok(injected.some(item => item.name === 'project-local'));
    assert.ok(injected.some(item => item.name === 'sensor-node'));
    assert.ok(injected.some(item => item.name === 'sensor-review-local'));
  });
});

test('workflow registry treats selected active specs as code-writing requirements only when requested', () => {
  return withSupportSourceEnv(() => {
    const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-selected-spec-'));
    const projectExtDir = runtime.initProjectLayout(tempProject);
    workflowRegistry.syncProjectWorkflowLayout(projectExtDir, { write: true });
    const registryPath = path.join(projectExtDir, 'registry', 'workflow.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

    registry.specs.push({
      name: 'embedded-space',
      title: 'Embedded Space',
      path: 'specs/embedded-space.md',
      summary: 'Code-writing rules for small MCU firmware.',
      auto_inject: false,
      selectable: true,
      priority: 58,
      apply_when: {
        specs: ['embedded-space']
      },
      focus_areas: [],
      extra_review_axes: [],
      preferred_notes: [],
      default_agents: []
    }, {
      name: 'product-flow',
      title: 'Product Flow',
      path: 'specs/product-flow.md',
      summary: 'Workflow rules that are not code-writing style rules.',
      auto_inject: false,
      selectable: true,
      priority: 55,
      apply_when: {
        specs: ['product-flow']
      },
      focus_areas: [],
      extra_review_axes: [],
      preferred_notes: [],
      default_agents: []
    }, {
      name: 'local-style',
      title: 'Local Style',
      path: 'specs/local-style.md',
      summary: 'Project-local code-writing rules.',
      auto_inject: false,
      selectable: true,
      priority: 56,
      apply_when: {
        specs: ['local-style']
      },
      focus_areas: [],
      extra_review_axes: [],
      preferred_notes: [],
      default_agents: [],
      enforcement_scopes: ['code-writing']
    });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
    fs.writeFileSync(
      path.join(projectExtDir, 'specs', 'embedded-space.md'),
      '# Embedded Space\n\n- Keep code direct and ROM-first.\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectExtDir, 'specs', 'product-flow.md'),
      '# Product Flow\n\n- Keep workflow state explicit.\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectExtDir, 'specs', 'local-style.md'),
      '# Local Style\n\n- Use local naming rules.\n',
      'utf8'
    );

    const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
      projectExtDir
    });
    const normalInjected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
      specs: ['embedded-space', 'product-flow', 'local-style'],
      task: { type: 'implement', status: 'planning' }
    }, { limit: 8 });
    const codeWritingInjected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
      specs: ['embedded-space', 'product-flow', 'local-style'],
      task: { type: 'implement', status: 'planning' }
    }, {
      limit: 8,
      include_selected_specs: true,
      selected_specs_only: true,
      selected_reason: 'required-for-code-writing',
      selected_enforcement_scope: 'code-writing'
    });

    assert.ok(!normalInjected.some(item => item.name === 'embedded-space'));
    assert.ok(codeWritingInjected.some(item =>
      item.name === 'embedded-space' &&
      item.required === true &&
      item.enforcement_scope === 'code-writing' &&
      item.reasons.includes('required-for-code-writing')
    ));
    assert.ok(codeWritingInjected.some(item =>
      item.name === 'local-style' &&
      item.required === true &&
      item.enforcement_scope === 'code-writing'
    ));
    assert.ok(!codeWritingInjected.some(item => item.name === 'product-flow'));
  });
});

test('workflow registry injects iot device focus for connected projects without requiring rtos', () => {
  return withSupportSourceEnv(() => {
    const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-iot-'));
    const projectExtDir = runtime.initProjectLayout(tempProject);
    importSupportWorkflowRegistry(tempProject);

    const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
      projectExtDir
    });
    const injected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
      profile: 'baremetal-loop',
      specs: ['connected-appliance'],
      task: { type: 'implement', status: 'planning' }
    }, { limit: 8 });

    assert.ok(injected.some(item => item.name === 'connected-appliance'));
    assert.ok(injected.some(item => item.name === 'iot-device-focus'));
    assert.ok(!injected.some(item => item.name === 'tasked-runtime-focus'));
  });
});

test('workflow registry injects project-local smart pillbox focus plus shared iot focus', () => {
  return withSupportSourceEnv(() => {
    const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-pillbox-'));
    const projectExtDir = runtime.initProjectLayout(tempProject);
    importSupportWorkflowRegistry(tempProject);
    const registryPath = path.join(projectExtDir, 'registry', 'workflow.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

    registry.templates.push({
      name: 'medication-flow',
      source: 'templates/medication-flow.md.tpl',
      description: 'Project-local medication flow note.',
      default_output: 'docs/MEDICATION-FLOW.md'
    });
    registry.specs.push({
      name: 'smart-pillbox',
      title: 'Smart Pillbox',
      path: 'specs/smart-pillbox.md',
      summary: 'Project-local smart pillbox rules.',
      auto_inject: true,
      selectable: true,
      priority: 62,
      apply_when: {
        specs: ['smart-pillbox']
      },
      focus_areas: [
        'medication_schedule',
        'sync_reconciliation'
      ],
      extra_review_axes: [
        'schedule_state_machine'
      ],
      preferred_notes: [
        'docs/MEDICATION-FLOW.md'
      ],
      default_agents: []
    });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
    fs.writeFileSync(
      path.join(projectExtDir, 'specs', 'smart-pillbox.md'),
      '# Smart Pillbox Focus\n\n- Check adherence state transitions.\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(projectExtDir, 'templates', 'medication-flow.md.tpl'),
      '# Medication Flow\n',
      'utf8'
    );

    const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
      projectExtDir
    });
    const injected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
      profile: 'baremetal-loop',
      specs: ['smart-pillbox'],
      task: { type: 'implement', status: 'planning' }
    }, { limit: 8 });

    assert.ok(injected.some(item => item.name === 'smart-pillbox'));
    assert.ok(injected.some(item => item.name === 'iot-device-focus'));
    assert.ok(!injected.some(item => item.name === 'tasked-runtime-focus'));
  });
});

test('workflow registry injects motor drive focus for motor control projects', () => {
  return withSupportSourceEnv(() => {
    const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-motor-'));
    const projectExtDir = runtime.initProjectLayout(tempProject);
    importSupportWorkflowRegistry(tempProject);

    const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
      projectExtDir
    });
    const injected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
      profile: 'baremetal-loop',
      specs: ['motor-drive'],
      task: { type: 'implement', status: 'planning' }
    }, { limit: 8 });

    assert.ok(injected.some(item => item.name === 'motor-drive'));
    assert.ok(!injected.some(item => item.name === 'iot-device-focus'));
  });
});

test('workflow registry injects Padauk firmware focus for constrained-toolchain projects', () => {
  return withSupportSourceEnv(() => {
    const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-padauk-'));
    const projectExtDir = runtime.initProjectLayout(tempProject);
    importSupportWorkflowRegistry(tempProject);

    const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
      projectExtDir
    });
    const injected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
      profile: 'baremetal-loop',
      specs: ['padauk-firmware'],
      task: { type: 'implement', status: 'planning' }
    }, { limit: 8 });

    assert.ok((merged.specs || []).some(item => item.name === 'padauk-firmware'));
    assert.ok(injected.some(item => item.name === 'padauk-firmware'));
    assert.ok(!injected.some(item => item.name === 'iot-device-focus'));
  });
});

test('workflow registry keeps implementation style as a template and leaves core protocols out of workflow specs', () => {
  return withSupportSourceEnv(() => {
    const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-style-'));
    const projectExtDir = runtime.initProjectLayout(tempProject);

    const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
      projectExtDir
    });
    const injected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
      profile: 'baremetal-loop',
      specs: [],
      task: { type: 'implement', status: 'active' }
    }, { limit: 8 });

    assert.ok((merged.templates || []).some(item => item.name === 'implementation-style'));
    assert.ok(!(merged.specs || []).some(item => item.name === 'implementation-style'));
    assert.ok(!(merged.specs || []).some(item => item.name === 'clean-worker-execution'));
    assert.ok(!(merged.specs || []).some(item => item.name === 'task-completion-aar'));
    assert.ok(!injected.some(item => item.name === 'implementation-style'));
    assert.ok(!injected.some(item => item.name === 'clean-worker-execution'));
    assert.ok(!injected.some(item => item.name === 'task-completion-aar'));
  });
});

test('workflow registry supports package-aware auto injection', () => {
  return withSupportSourceEnv(() => {
    const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-package-'));
    const projectExtDir = runtime.initProjectLayout(tempProject);
    workflowRegistry.syncProjectWorkflowLayout(projectExtDir, { write: true });
    const registryPath = path.join(projectExtDir, 'registry', 'workflow.json');

    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    registry.specs.push({
      name: 'firmware-package-focus',
      title: 'Firmware Package Focus',
      path: 'specs/firmware-package-focus.md',
      summary: 'Project-local package rules for firmware work.',
      auto_inject: true,
      selectable: false,
      priority: 88,
      apply_when: {
        packages: ['fw']
      },
      focus_areas: [],
      extra_review_axes: [],
      preferred_notes: [],
      default_agents: []
    });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
    fs.writeFileSync(
      path.join(projectExtDir, 'specs', 'firmware-package-focus.md'),
      '# Firmware Package Focus\n\n- Check firmware package boundaries.\n',
      'utf8'
    );

    const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
      projectExtDir
    });
    const injected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
      profile: 'baremetal-loop',
      specs: [],
      active_package: 'fw',
      default_package: 'app',
      task: { type: 'implement', status: 'planning', package: 'fw' }
    }, { limit: 8 });

    assert.ok(injected.some(item => item.name === 'firmware-package-focus'));
  });
});
