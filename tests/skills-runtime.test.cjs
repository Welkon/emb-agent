'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureJson(args) {
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

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('skills list and show expose lazily discovered built-in skills', async () => {
  const listed = await captureJson(['skills', 'list']);
  const shown = await captureJson(['skills', 'show', 'remember']);

  assert.ok(Array.isArray(listed));
  assert.ok(listed.some(item => item.name === 'remember'));
  assert.ok(listed.some(item => item.name === 'swarm-execution'));
  assert.equal(shown.name, 'remember');
  assert.equal(shown.execution_mode, 'inline');
  assert.equal(shown.path, 'skills/remember.md');
  assert.match(shown.content, /cross-session conclusions/);
});

test('skills run supports inline and isolated execution modes', async () => {
  const originalBridge = process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;

  try {
    const inlineResult = await captureJson(['skills', 'run', 'remember', 'capture stable timer fact']);
    assert.equal(inlineResult.execution.mode, 'inline');
    assert.match(inlineResult.prompt, /capture stable timer fact/);

    process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = 'mock://ok';
    const isolatedResult = await captureJson(['skills', 'run', 'swarm-execution']);
    assert.equal(isolatedResult.execution.mode, 'isolated');
    assert.equal(isolatedResult.isolated.status, 'ok');
    assert.equal(isolatedResult.isolated.worker_result.phase, 'skill');
  } finally {
    if (originalBridge === undefined) {
      delete process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD;
    } else {
      process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD = originalBridge;
    }
  }
});

test('skills discover directory bundles and execute command skills from project scope', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-skill-command-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await captureJson(['init']);

    const skillDir = path.join(tempProject, '.emb-agent', 'skills', 'scope-capture');
    writeFile(
      path.join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: scope-capture',
        'description: Capture a waveform from a connected scope.',
        'execution_mode: command',
        'command:',
        '  - node',
        '  - scripts/run.cjs',
        '---',
        '',
        '# scope-capture',
        '',
        'Capture waveform data from the active scope connection.',
        ''
      ].join('\n')
    );
    writeFile(
      path.join(skillDir, 'scripts', 'run.cjs'),
      [
        "'use strict';",
        '',
        "process.stdout.write(JSON.stringify({ status: 'ok', argv: process.argv.slice(2) }) + '\\n');",
        ''
      ].join('\n')
    );

    const listed = await captureJson(['skills', 'list']);
    const shown = await captureJson(['skills', 'show', 'scope-capture']);
    const runResult = await captureJson(['skills', 'run', 'scope-capture', '--', 'channel1', '10ms']);

    assert.ok(listed.some(item => item.name === 'scope-capture' && item.execution_mode === 'command'));
    assert.equal(shown.name, 'scope-capture');
    assert.equal(shown.execution_mode, 'command');
    assert.equal(shown.enabled, true);
    assert.equal(runResult.execution.mode, 'command');
    assert.equal(runResult.command_result.status, 'ok');
    assert.deepEqual(runResult.command_result.parsed_output.argv, ['channel1', '10ms']);
  } finally {
    process.chdir(currentCwd);
  }
});

test('skills install can add, disable, enable, and remove plugin-managed skills', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-skill-plugin-project-'));
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-skill-plugin-bundle-'));
  const currentCwd = process.cwd();

  try {
    writeFile(
      path.join(bundleDir, '.emb-agent-plugin', 'plugin.json'),
      JSON.stringify(
        {
          name: 'tektronix-scope-kit',
          version: '1.2.0',
          description: 'Tektronix scope control skills.',
          skills: './skills'
        },
        null,
        2
      ) + '\n'
    );
    writeFile(
      path.join(bundleDir, 'skills', 'tektronix-scope', 'SKILL.md'),
      [
        '---',
        'name: tektronix-scope',
        'description: Connect to a Tektronix scope and issue capture commands.',
        'execution_mode: command',
        'command:',
        '  - node',
        '  - scripts/connect.cjs',
        '---',
        '',
        '# tektronix-scope',
        '',
        'Connect to the scope and return capture details.',
        ''
      ].join('\n')
    );
    writeFile(
      path.join(bundleDir, 'skills', 'tektronix-scope', 'scripts', 'connect.cjs'),
      [
        "'use strict';",
        '',
        "process.stdout.write(JSON.stringify({ status: 'ok', action: 'scope-connect' }) + '\\n');",
        ''
      ].join('\n')
    );

    process.chdir(tempProject);
    await captureJson(['init']);

    const installResult = await captureJson(['skills', 'install', bundleDir, '--scope', 'project']);
    const shown = await captureJson(['skills', 'show', 'tektronix-scope']);
    const disabled = await captureJson(['skills', 'disable', 'tektronix-scope']);
    const listAfterDisable = await captureJson(['skills', 'list']);
    const listAllAfterDisable = await captureJson(['skills', 'list', '--all']);
    const shownAfterDisable = await captureJson(['skills', 'show', 'tektronix-scope']);
    const enabled = await captureJson(['skills', 'enable', 'tektronix-scope']);
    const listAfterEnable = await captureJson(['skills', 'list']);
    const removed = await captureJson(['skills', 'remove', 'tektronix-scope-kit']);

    assert.equal(installResult.plugin.name, 'tektronix-scope-kit');
    assert.deepEqual(installResult.selected_skills, ['tektronix-scope']);
    assert.equal(shown.plugin.name, 'tektronix-scope-kit');
    assert.equal(disabled.plugin.name, 'tektronix-scope-kit');
    assert.equal(listAfterDisable.some(item => item.name === 'tektronix-scope'), false);
    assert.ok(listAllAfterDisable.some(item => item.name === 'tektronix-scope' && item.enabled === false));
    assert.equal(shownAfterDisable.enabled, false);
    assert.deepEqual(enabled.enabled_skills, ['tektronix-scope']);
    assert.ok(listAfterEnable.some(item => item.name === 'tektronix-scope' && item.enabled === true));
    assert.equal(removed.removed.kind, 'plugin');
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'plugins', 'tektronix-scope-kit')),
      false
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('skills install provisions plugin-local node dependencies so command skills are immediately usable', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-skill-deps-project-'));
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-skill-deps-bundle-'));
  const currentCwd = process.cwd();

  try {
    writeFile(
      path.join(bundleDir, '.emb-agent-plugin', 'plugin.json'),
      JSON.stringify(
        {
          name: 'scope-deps-kit',
          version: '0.3.0',
          description: 'Scope skills with local runtime dependencies.',
          skills: './skills'
        },
        null,
        2
      ) + '\n'
    );
    writeFile(
      path.join(bundleDir, 'package.json'),
      JSON.stringify(
        {
          name: 'scope-deps-kit',
          private: true,
          dependencies: {
            'scope-helper': 'file:./vendor/scope-helper'
          }
        },
        null,
        2
      ) + '\n'
    );
    writeFile(
      path.join(bundleDir, 'vendor', 'scope-helper', 'package.json'),
      JSON.stringify(
        {
          name: 'scope-helper',
          version: '1.0.0',
          main: 'index.js'
        },
        null,
        2
      ) + '\n'
    );
    writeFile(
      path.join(bundleDir, 'vendor', 'scope-helper', 'index.js'),
      [
        "'use strict';",
        '',
        "module.exports = {",
        "  device: 'MSO54',",
        "  channel: 'CH1'",
        '};',
        ''
      ].join('\n')
    );
    writeFile(
      path.join(bundleDir, 'skills', 'scope-ready', 'SKILL.md'),
      [
        '---',
        'name: scope-ready',
        'description: Verify plugin-local dependencies are provisioned.',
        'execution_mode: command',
        'command:',
        '  - node',
        '  - scripts/check.cjs',
        '---',
        '',
        '# scope-ready',
        ''
      ].join('\n')
    );
    writeFile(
      path.join(bundleDir, 'skills', 'scope-ready', 'scripts', 'check.cjs'),
      [
        "'use strict';",
        '',
        "const helper = require('scope-helper');",
        "process.stdout.write(JSON.stringify({ status: 'ok', helper }) + '\\n');",
        ''
      ].join('\n')
    );

    process.chdir(tempProject);
    await captureJson(['init']);

    const installResult = await captureJson(['skills', 'install', bundleDir, '--scope', 'project']);
    const runResult = await captureJson(['skills', 'run', 'scope-ready']);

    assert.equal(installResult.plugin.name, 'scope-deps-kit');
    assert.ok(Array.isArray(installResult.plugin.runtime.node.module_paths));
    assert.equal(runResult.command_result.status, 'ok');
    assert.equal(runResult.command_result.parsed_output.helper.device, 'MSO54');
    assert.equal(
      fs.existsSync(
        path.join(
          tempProject,
          '.emb-agent',
          'plugins',
          'scope-deps-kit',
          '.runtime',
          'node',
          'node_modules',
          'scope-helper'
        )
      ),
      true
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('skills install falls back to the default skill source when source is omitted', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-skill-default-source-project-'));
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-skill-default-source-bundle-'));
  const currentCwd = process.cwd();
  const previousDefaultType = process.env.EMB_AGENT_DEFAULT_SKILL_SOURCE_TYPE;
  const previousDefaultLocation = process.env.EMB_AGENT_DEFAULT_SKILL_SOURCE_LOCATION;

  try {
    writeFile(
      path.join(bundleDir, '.emb-agent-plugin', 'plugin.json'),
      JSON.stringify(
        {
          name: 'default-scope-kit',
          version: '0.2.0',
          skills: './skills'
        },
        null,
        2
      ) + '\n'
    );
    writeFile(
      path.join(bundleDir, 'skills', 'default-scope', 'SKILL.md'),
      [
        '---',
        'name: default-scope',
        'description: Use the default skill source fallback.',
        'execution_mode: command',
        'command:',
        '  - node',
        '  - scripts/run.cjs',
        '---',
        '',
        '# default-scope',
        ''
      ].join('\n')
    );
    writeFile(
      path.join(bundleDir, 'skills', 'default-scope', 'scripts', 'run.cjs'),
      [
        "'use strict';",
        '',
        "process.stdout.write(JSON.stringify({ status: 'ok', fallback: true }) + '\\n');",
        ''
      ].join('\n')
    );

    process.env.EMB_AGENT_DEFAULT_SKILL_SOURCE_TYPE = 'path';
    process.env.EMB_AGENT_DEFAULT_SKILL_SOURCE_LOCATION = bundleDir;

    process.chdir(tempProject);
    await captureJson(['init']);

    const installResult = await captureJson(['skills', 'install', '--scope', 'project']);
    const runResult = await captureJson(['skills', 'run', 'default-scope']);

    assert.equal(installResult.plugin.name, 'default-scope-kit');
    assert.equal(installResult.plugin.source_type, 'path');
    assert.equal(runResult.command_result.parsed_output.fallback, true);
  } finally {
    if (previousDefaultType === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_SKILL_SOURCE_TYPE;
    } else {
      process.env.EMB_AGENT_DEFAULT_SKILL_SOURCE_TYPE = previousDefaultType;
    }
    if (previousDefaultLocation === undefined) {
      delete process.env.EMB_AGENT_DEFAULT_SKILL_SOURCE_LOCATION;
    } else {
      process.env.EMB_AGENT_DEFAULT_SKILL_SOURCE_LOCATION = previousDefaultLocation;
    }
    process.chdir(currentCwd);
  }
});
