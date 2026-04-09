'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

test('init-project creates project defaults and seeded docs', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main([
      '--project',
      tempProject,
      '--profile',
      'rtos-iot',
      '--pack',
      'connected-appliance'
    ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );

    assert.equal(projectConfig.project_profile, 'rtos-iot');
    assert.deepEqual(projectConfig.active_packs, ['connected-appliance']);
    assert.deepEqual(projectConfig.adapter_sources, []);
    assert.deepEqual(projectConfig.executors, {});
    assert.deepEqual(projectConfig.developer, { name: '', runtime: '' });
    assert.equal(projectConfig.integrations.mineru.mode, 'auto');
    assert.equal(projectConfig.integrations.mineru.base_url, '');
    assert.equal(projectConfig.integrations.mineru.api_key, '');
    assert.equal(projectConfig.integrations.mineru.api_key_env, 'MINERU_API_KEY');
    assert.equal(projectConfig.integrations.mineru.model_version, '');
    assert.equal(projectConfig.integrations.mineru.auto_api_page_threshold, 12);
    assert.equal(projectConfig.integrations.mineru.auto_api_file_size_kb, 4096);
    assert.deepEqual(projectConfig.arch_review.trigger_patterns, []);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'hw.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'req.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'docs')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'adapter-sources')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', '.developer')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'CONNECTIVITY.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'RELEASE-NOTES.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'DEBUG-NOTES.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MCU-FOUNDATION-CHECKLIST.md')), true);
    assert.match(
      fs.readFileSync(path.join(tempProject, 'docs', 'MCU-FOUNDATION-CHECKLIST.md'), 'utf8'),
      /manual-first/
    );

    process.chdir(tempProject);
    cli.main(['init']);

    const status = cli.buildStatus();
    assert.equal(status.project_profile, 'rtos-iot');
    assert.deepEqual(status.active_packs, ['connected-appliance']);
    assert.equal(status.preferences.truth_source_mode, 'hardware_first');
    assert.deepEqual(status.developer, { name: '', runtime: '' });
    assert.equal(status.project_defaults.project_profile, 'rtos-iot');
    assert.deepEqual(status.project_defaults.arch_review.trigger_patterns, []);
    assert.ok(Array.isArray(status.arch_review_triggers));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init-project with battery-charger pack seeds power charging doc', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-battery-charger-'));
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    initProject.main([
      '--project',
      tempProject,
      '--profile',
      'baremetal-8bit',
      '--pack',
      'battery-charger'
    ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );

    assert.equal(projectConfig.project_profile, 'baremetal-8bit');
    assert.deepEqual(projectConfig.active_packs, ['battery-charger']);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'POWER-CHARGING.md')), true);
    assert.match(
      fs.readFileSync(path.join(tempProject, 'docs', 'POWER-CHARGING.md'), 'utf8'),
      /Charging Logic/
    );
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('init preserves existing docs files without force', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-preserve-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const customDebugPath = path.join(tempProject, 'docs', 'DEBUG-NOTES.md');
  const customHardwarePath = path.join(tempProject, 'docs', 'HARDWARE-LOGIC.md');

  process.stdout.write = () => true;

  try {
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(customDebugPath, '# custom debug\nkeep me\n', 'utf8');
    fs.writeFileSync(customHardwarePath, '# custom hardware\nkeep me too\n', 'utf8');

    process.chdir(tempProject);
    cli.main(['init']);

    assert.equal(fs.readFileSync(customDebugPath, 'utf8'), '# custom debug\nkeep me\n');
    assert.equal(fs.readFileSync(customHardwarePath, 'utf8'), '# custom hardware\nkeep me too\n');
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'project.json')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'hw.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'req.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'adapter-sources')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'adapters')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'MCU-FOUNDATION-CHECKLIST.md')), true);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init returns onboarding guidance for adapter setup', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-guidance-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  try {
    process.chdir(tempProject);
    process.stdout.write = chunk => {
      stdout += String(chunk);
      return true;
    };

    cli.main(['init']);
    const result = JSON.parse(stdout);

    assert.equal(result.initialized, true);
    assert.equal(result.onboarding.hardware_identity_present, false);
    assert.equal(result.onboarding.adapter_sources_registered, 0);
    assert.ok(result.next_steps.some(item => item.includes('.emb-agent/hw.yaml')));
    assert.ok(result.next_steps.some(item => item.includes('Run adapter bootstrap after hw.yaml is filled in')));
    assert.ok(result.next_steps.some(item => item.includes('health')));
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('init accepts runtime and developer identity flags and persists updates', () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-init-developer-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;

  process.stdout.write = () => true;

  try {
    process.chdir(tempProject);
    cli.main(['init', '--codex', '-u', 'welkon']);

    let projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    let developerMarker = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', '.developer'), 'utf8')
    );
    let status = cli.buildStatus();

    assert.deepEqual(projectConfig.developer, { name: 'welkon', runtime: 'codex' });
    assert.equal(developerMarker.name, 'welkon');
    assert.equal(developerMarker.runtime, 'codex');
    assert.deepEqual(status.developer, { name: 'welkon', runtime: 'codex' });

    cli.main(['init', '--claude', '-u', 'felix']);

    projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    developerMarker = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', '.developer'), 'utf8')
    );
    status = cli.buildStatus();

    assert.deepEqual(projectConfig.developer, { name: 'felix', runtime: 'claude' });
    assert.equal(developerMarker.name, 'felix');
    assert.equal(developerMarker.runtime, 'claude');
    assert.deepEqual(status.developer, { name: 'felix', runtime: 'claude' });
    assert.match(
      fs.readFileSync(path.join(tempProject, '.gitignore'), 'utf8'),
      /\.emb-agent\/\.developer/
    );
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
