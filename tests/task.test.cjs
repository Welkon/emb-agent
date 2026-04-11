'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, JSON.stringify(value, null, 2) + '\n');
}

function initGitRepo(rootDir) {
  childProcess.execFileSync('git', ['init'], {
    cwd: rootDir,
    stdio: 'ignore'
  });
  childProcess.execFileSync('git', ['add', '.'], {
    cwd: rootDir,
    stdio: 'ignore'
  });
  childProcess.execFileSync(
    'git',
    ['-c', 'user.name=emb-agent', '-c', 'user.email=emb-agent@example.com', 'commit', '-m', 'init'],
    {
      cwd: rootDir,
      stdio: 'ignore'
    }
  );
}

function createAdapterSource(rootDir) {
  writeText(
    path.join(rootDir, 'adapters', 'core', 'shared.cjs'),
    "'use strict';\nmodule.exports = {};\n"
  );

  writeText(
    path.join(rootDir, 'adapters', 'algorithms', 'scmcu-timer.cjs'),
    "'use strict';\nmodule.exports = { name: 'scmcu-timer' };\n"
  );

  writeText(
    path.join(rootDir, 'adapters', 'routes', 'timer-calc.cjs'),
    [
      "'use strict';",
      '',
      'module.exports = {',
      '  runTool() {',
      "    return { status: 'ok' };",
      '  }',
      '};',
      ''
    ].join('\n')
  );

  writeJson(path.join(rootDir, 'extensions', 'tools', 'families', 'scmcu-sc8f0xx.json'), {
    name: 'scmcu-sc8f0xx',
    vendor: 'SCMCU',
    series: 'SC8F0xx',
    description: 'SCMCU family.',
    supported_tools: ['timer-calc'],
    bindings: {},
    notes: []
  });

  writeJson(path.join(rootDir, 'extensions', 'tools', 'devices', 'sc8f072.json'), {
    name: 'sc8f072',
    family: 'scmcu-sc8f0xx',
    description: 'SC8F072 device.',
    supported_tools: ['timer-calc'],
    bindings: {
      'timer-calc': {
        algorithm: 'scmcu-timer',
        params: {
          chip: 'sc8f072'
        }
      }
    },
    notes: []
  });

  writeJson(path.join(rootDir, 'extensions', 'chips', 'profiles', 'sc8f072sop8.json'), {
    name: 'sc8f072sop8',
    vendor: 'SCMCU',
    family: 'scmcu-sc8f072',
    description: 'SC8F072 SOP8 chip.',
    package: 'SOP8',
    runtime_model: 'main_loop_plus_isr',
    summary: {},
    capabilities: ['Timer16', 'PWM'],
    related_tools: ['timer-calc', 'pwm-calc'],
    notes: []
  });
}

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

test('task commands create activate manage context and resolve lightweight tasks', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-source-'));
  const currentCwd = process.cwd();

  try {
    createAdapterSource(tempSource);
    process.chdir(tempProject);
    await cli.main(['init']);
    await cli.main(['focus', 'set', 'SC8F072 timer and pwm bring-up']);
    fs.mkdirSync(path.join(tempProject, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, 'docs', 'SC8F072.pdf'), 'fake pdf content', 'utf8');
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
        '',
        'signals:',
        '  - name: "PWM_OUT"',
        '    pin: "PA3"',
        '    direction: "output"',
        '    note: "TM2 PWM output"',
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
        '  - "PA5 reserved for programming"',
        '',
        'unknowns:',
        '  - ""',
        ''
      ].join('\n'),
      'utf8'
    );
    await cli.main(['adapter', 'source', 'add', 'default-pack', '--type', 'path', '--location', tempSource]);
    await cli.main(['adapter', 'sync', 'default-pack']);
    await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/SC8F072.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      {
        providerImpls: {
          mineru: {
            async parseDocument() {
              return {
                provider: 'mineru',
                mode: 'agent',
                task_id: 'task-doc-bindings',
                markdown: '# SC8F072 SOP8\n\n- Timer16 exists\n- PWM output supported\n',
                metadata: {
                  completed: {
                    full_md_url: 'https://mineru.invalid/result.md'
                  }
                }
              };
            }
          }
        }
      }
    );
    const created = await captureCliJson([
      'task',
      'add',
      'Implement TM2 PWM adapter',
      '--type',
      'implement',
      '--scope',
      'pwm',
      '--priority',
      'P1',
      '--assignee',
      'welkon'
    ]);
    const taskName = created.task.name;
    const taskDir = path.join(tempProject, '.emb-agent', 'tasks', taskName);
    const manifest = JSON.parse(fs.readFileSync(path.join(taskDir, 'task.json'), 'utf8'));

    assert.equal(created.created, true);
    assert.equal(fs.existsSync(path.join(taskDir, 'task.json')), true);
    assert.equal(fs.existsSync(path.join(taskDir, 'implement.jsonl')), true);
    assert.equal(fs.existsSync(path.join(taskDir, 'check.jsonl')), true);
    assert.equal(fs.existsSync(path.join(taskDir, 'debug.jsonl')), true);
    assert.match(manifest.id, /^\d{2}-\d{2}-implement-tm2-pwm-adapter/);
    assert.equal(manifest.status, 'planning');
    assert.equal(manifest.dev_type, 'embedded');
    assert.equal(manifest.scope, 'pwm');
    assert.equal(manifest.priority, 'P1');
    assert.equal(manifest.assignee, 'welkon');
    assert.equal(manifest.base_branch, 'main');
    assert.equal(manifest.current_phase, 1);
    assert.deepEqual(manifest.next_action.map(item => item.action), ['implement', 'check', 'finish', 'create-pr']);
    assert.equal(Array.isArray(manifest.relatedFiles), true);
    assert.equal(created.task.bindings.hardware.identity.model, 'SC8F072');
    assert.equal(created.task.bindings.hardware.chip_profile.name, 'sc8f072sop8');
    assert.equal(created.task.status, 'planning');
    assert.equal(created.task.dev_type, 'embedded');
    assert.equal(created.task.scope, 'pwm');
    assert.equal(created.task.priority, 'P1');
    assert.ok(created.task.bindings.docs.some(item => item.doc_id));
    assert.ok(created.task.bindings.adapters.some(item => item.source === 'default-pack'));
    assert.ok(created.task.bindings.tools.some(item => item.tool === 'timer-calc'));
    assert.ok(created.task.context.implement.some(item => item.path === '.emb-agent/hw.yaml'));
    assert.ok(created.task.context.implement.some(item => item.path === 'docs/HARDWARE-LOGIC.md'));
    assert.ok(created.task.context.implement.some(item => item.path.includes('cache/docs/')));

    const activated = await captureCliJson(['task', 'activate', taskName]);
    assert.equal(activated.activated, true);
    assert.equal(activated.workspace.mode, 'copy');
    assert.equal(fs.existsSync(activated.workspace.path), true);
    assert.equal(activated.task.worktree_path, activated.workspace.path);
    assert.equal(fs.existsSync(path.join(activated.workspace.path, 'docs', 'SC8F072.pdf')), true);
    assert.equal(cli.loadSession().active_task.name, taskName);
    assert.equal(cli.loadSession().active_task.status, 'in_progress');
    assert.equal(
      fs.readFileSync(path.join(tempProject, '.emb-agent', '.current-task'), 'utf8').trim(),
      taskName
    );
    assert.ok(cli.loadSession().last_files.some(item => item.includes('cache/docs/')));

    const updatedContext = await captureCliJson([
      'task',
      'context',
      'add',
      taskName,
      'implement',
      'src/timer.c',
      'TM2 implementation file'
    ]);
    assert.equal(updatedContext.updated, true);
    assert.ok(updatedContext.entries.some(item => item.path === 'src/timer.c'));

    const listedContext = await captureCliJson(['task', 'context', 'list', taskName, 'implement']);
    assert.equal(listedContext.channel, 'implement');
    assert.ok(listedContext.entries.some(item => item.path === 'src/timer.c'));

    const resume = await captureCliJson(['resume']);
    assert.equal(resume.task.name, taskName);
    assert.equal(resume.task.worktree_path, activated.workspace.path);
    assert.ok(resume.task.context.implement.some(item => item.path === 'src/timer.c'));

    const resolved = await captureCliJson(['task', 'resolve', taskName, 'adapter merged']);
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.workspace_cleanup.cleaned, true);
    assert.equal(resolved.task.status, 'completed');
    assert.equal(resolved.task.worktree_path, null);
    assert.equal(resolved.task.notes, 'adapter merged');
    assert.equal(fs.existsSync(activated.workspace.path), false);
    assert.equal(cli.loadSession().active_task.name, '');
    assert.equal(fs.readFileSync(path.join(tempProject, '.emb-agent', '.current-task'), 'utf8'), '');
  } finally {
    process.chdir(currentCwd);
  }
});

test('task activate creates a real git worktree when the project is a git repository', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-git-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    writeText(path.join(tempProject, 'src', 'main.c'), '// main\n');
    await cli.main(['init']);
    initGitRepo(tempProject);

    const created = await captureCliJson(['task', 'add', 'Investigate irq race']);
    const taskName = created.task.name;

    const activated = await captureCliJson(['task', 'activate', taskName]);
    assert.equal(activated.workspace.mode, 'git-worktree');
    assert.equal(fs.existsSync(activated.workspace.path), true);
    assert.equal(fs.existsSync(path.join(activated.workspace.path, '.git')), true);
    assert.equal(activated.task.worktree_path, activated.workspace.path);

    const resolved = await captureCliJson(['task', 'resolve', taskName, 'done']);
    assert.equal(resolved.workspace_cleanup.cleaned, true);
    assert.equal(fs.existsSync(activated.workspace.path), false);
  } finally {
    process.chdir(currentCwd);
  }
});
