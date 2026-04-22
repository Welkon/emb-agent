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
      profile: 'baremetal-8bit',
      specs: ['sensor-node'],
      task: { type: 'implement', status: 'active' }
    });

    assert.ok(injected.some(item => item.name === 'project-local'));
    assert.ok(injected.some(item => item.name === 'sensor-node'));
    assert.ok(injected.some(item => item.name === 'sensor-review-local'));
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
      profile: 'baremetal-8bit',
      specs: ['connected-appliance'],
      task: { type: 'implement', status: 'planning' }
    }, { limit: 8 });

    assert.ok(injected.some(item => item.name === 'connected-appliance'));
    assert.ok(injected.some(item => item.name === 'iot-device-focus'));
    assert.ok(!injected.some(item => item.name === 'rtos-iot-focus'));
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
      profile: 'baremetal-8bit',
      specs: ['smart-pillbox'],
      task: { type: 'implement', status: 'planning' }
    }, { limit: 8 });

    assert.ok(injected.some(item => item.name === 'smart-pillbox'));
    assert.ok(injected.some(item => item.name === 'iot-device-focus'));
    assert.ok(!injected.some(item => item.name === 'rtos-iot-focus'));
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
      profile: 'baremetal-8bit',
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
      profile: 'baremetal-8bit',
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
      profile: 'baremetal-8bit',
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
      profile: 'baremetal-8bit',
      specs: [],
      active_package: 'fw',
      default_package: 'app',
      task: { type: 'implement', status: 'planning', package: 'fw' }
    }, { limit: 8 });

    assert.ok(injected.some(item => item.name === 'firmware-package-focus'));
  });
});
