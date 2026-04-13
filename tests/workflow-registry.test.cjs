'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const workflowRegistry = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-registry.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));

test('workflow registry merges built-in and project specs and resolves auto injection', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-registry-'));
  const projectExtDir = runtime.initProjectLayout(tempProject);
  const registryPath = path.join(projectExtDir, 'registry', 'workflow.json');

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  registry.specs.push({
    name: 'sensor-review-local',
    title: 'Sensor Review Local',
    path: 'specs/sensor-review-local.md',
    summary: 'Project-local sensor review rules.',
    auto_inject: true,
    priority: 95,
    apply_when: {
      packs: ['sensor-node']
    }
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
    packs: ['sensor-node'],
    task: { type: 'implement', status: 'active' }
  });

  assert.ok(injected.some(item => item.name === 'project-local'));
  assert.ok(injected.some(item => item.name === 'sensor-node-focus'));
  assert.ok(injected.some(item => item.name === 'sensor-review-local'));
});

test('workflow registry injects iot device focus for connected projects without requiring rtos', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-iot-'));
  const projectExtDir = runtime.initProjectLayout(tempProject);

  const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
    projectExtDir
  });
  const injected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
    profile: 'baremetal-8bit',
    packs: ['connected-appliance'],
    task: { type: 'implement', status: 'planning' }
  }, { limit: 8 });

  assert.ok(injected.some(item => item.name === 'connected-appliance-focus'));
  assert.ok(injected.some(item => item.name === 'iot-device-focus'));
  assert.ok(!injected.some(item => item.name === 'rtos-iot-focus'));
});

test('workflow registry injects project-local smart pillbox focus plus shared iot focus', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-pillbox-'));
  const projectExtDir = runtime.initProjectLayout(tempProject);
  const registryPath = path.join(projectExtDir, 'registry', 'workflow.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

  registry.templates.push({
    name: 'medication-flow',
    source: 'templates/medication-flow.md.tpl',
    description: 'Project-local medication flow note.',
    default_output: 'docs/MEDICATION-FLOW.md'
  });
  registry.packs.push({
    name: 'smart-pillbox',
    file: 'packs/smart-pillbox.yaml',
    description: 'Project-local smart pillbox workflow pack.'
  });
  registry.specs.push({
    name: 'smart-pillbox-focus',
    title: 'Smart Pillbox Focus',
    path: 'specs/smart-pillbox-focus.md',
    summary: 'Project-local smart pillbox rules.',
    auto_inject: true,
    priority: 62,
    apply_when: {
      packs: ['smart-pillbox']
    }
  });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  fs.writeFileSync(
    path.join(projectExtDir, 'packs', 'smart-pillbox.yaml'),
    [
      'name: smart-pillbox',
      'focus_areas:',
      '  - medication_schedule',
      '  - sync_reconciliation',
      'extra_review_axes:',
      '  - schedule_state_machine',
      'preferred_notes:',
      '  - docs/MEDICATION-FLOW.md',
      ''
    ].join('\n'),
    'utf8'
  );
  fs.writeFileSync(
    path.join(projectExtDir, 'specs', 'smart-pillbox-focus.md'),
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
    packs: ['smart-pillbox'],
    task: { type: 'implement', status: 'planning' }
  }, { limit: 8 });

  assert.ok(injected.some(item => item.name === 'smart-pillbox-focus'));
  assert.ok(injected.some(item => item.name === 'iot-device-focus'));
  assert.ok(!injected.some(item => item.name === 'rtos-iot-focus'));
});

test('workflow registry injects motor drive focus for motor control projects', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-motor-'));
  const projectExtDir = runtime.initProjectLayout(tempProject);

  const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
    projectExtDir
  });
  const injected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
    profile: 'baremetal-8bit',
    packs: ['motor-drive'],
    task: { type: 'implement', status: 'planning' }
  }, { limit: 8 });

  assert.ok(injected.some(item => item.name === 'motor-drive-focus'));
  assert.ok(!injected.some(item => item.name === 'iot-device-focus'));
});

test('workflow registry exposes implementation style spec and template', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-workflow-style-'));
  const projectExtDir = runtime.initProjectLayout(tempProject);

  const merged = workflowRegistry.loadWorkflowRegistry(path.join(repoRoot, 'runtime'), {
    projectExtDir
  });
  const injected = workflowRegistry.resolveAutoInjectedSpecs(merged, {
    profile: 'baremetal-8bit',
    packs: [],
    task: { type: 'implement', status: 'active' }
  }, { limit: 8 });

  assert.ok((merged.templates || []).some(item => item.name === 'implementation-style'));
  assert.ok(injected.some(item => item.name === 'implementation-style'));
  assert.ok((merged.specs || []).some(item => item.name === 'clean-worker-execution'));
  assert.ok(injected.some(item => item.name === 'clean-worker-execution'));
});
