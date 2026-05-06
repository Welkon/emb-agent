'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));
const runtime = require(path.join(repoRoot, 'runtime', 'lib', 'runtime.cjs'));
const workflowRegistry = require(path.join(repoRoot, 'runtime', 'lib', 'workflow-registry.cjs'));

function assertProjectLocalInjected(specs) {
  assert.deepEqual(
    (Array.isArray(specs) ? specs : []).map(item => item.name),
    ['project-local']
  );
}

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
    path.join(rootDir, 'chip-support', 'core', 'shared.cjs'),
    "'use strict';\nmodule.exports = {};\n"
  );

  writeText(
    path.join(rootDir, 'chip-support', 'algorithms', 'scmcu-timer.cjs'),
    "'use strict';\nmodule.exports = { name: 'scmcu-timer' };\n"
  );

  writeText(
    path.join(rootDir, 'chip-support', 'routes', 'timer-calc.cjs'),
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

async function captureCliTtyOutput(args) {
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  const originalStdoutIsTty = process.stdout.isTTY;
  const originalStderrIsTty = process.stderr.isTTY;
  let stdout = '';
  let stderr = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = chunk => {
    stderr += String(chunk);
    return true;
  };
  process.stdout.isTTY = true;
  process.stderr.isTTY = true;

  try {
    await cli.main(args);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.stdout.isTTY = originalStdoutIsTty;
    process.stderr.isTTY = originalStderrIsTty;
  }

  return { stdout, stderr };
}

test('task commands create activate manage context and resolve lightweight tasks', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-'));
  const tempSource = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-source-'));
  const currentCwd = process.cwd();

  try {
    createAdapterSource(tempSource);
    process.chdir(tempProject);
    await cli.main(['init']);
    writeText(path.join(tempProject, '.emb-agent', 'worktree.yaml'), 'worktree_dir: .task-worktrees\n');
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
    await cli.main(['support', 'source', 'add', 'default-support', '--type', 'path', '--location', tempSource]);
    await cli.main(['support', 'sync', 'default-support']);
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
    const autoSpecsPath = `.emb-agent/tasks/${taskName}/auto-specs.md`;

    assert.equal(created.created, true);
    assert.equal(fs.existsSync(path.join(taskDir, 'task.json')), true);
    assert.equal(fs.existsSync(path.join(taskDir, 'implement.jsonl')), true);
    assert.equal(fs.existsSync(path.join(taskDir, 'check.jsonl')), true);
    assert.equal(fs.existsSync(path.join(taskDir, 'debug.jsonl')), true);
    assert.equal(fs.existsSync(path.join(taskDir, 'prd.md')), true);
    assert.equal(fs.existsSync(path.join(taskDir, 'auto-specs.md')), true);
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
    assert.ok(created.task.bindings.chip_support.some(item => item.source === 'default-support'));
    assert.ok(created.task.bindings.tools.some(item => item.tool === 'timer-calc'));
    assertProjectLocalInjected(created.task.injected_specs);
    assert.ok(created.task.context.implement.some(item => item.path === '.emb-agent/hw.yaml'));
    assert.ok(created.task.context.implement.some(item => item.path === 'docs/HARDWARE-LOGIC.md'));
    assert.ok(created.task.context.implement.some(item => item.path.includes('cache/docs/')));
    assert.ok(created.task.context.implement.some(item => item.path === `.emb-agent/tasks/${taskName}/prd.md`));
    assert.ok(created.task.context.implement.some(item => item.path === autoSpecsPath));
    assert.equal(created.task.artifacts.prd, `.emb-agent/tasks/${taskName}/prd.md`);
    assert.equal(created.task_convergence.status, 'planning-task');
    assert.equal(created.task_convergence.prd_path, `.emb-agent/tasks/${taskName}/prd.md`);
    assert.equal(created.task_convergence.recommended_path, 'plan-first');
    assert.match(created.task_convergence.summary, /Open the task PRD first/i);
    assert.match(created.task_convergence.next_cli, new RegExp(`task activate ${taskName}$`));
    assert.match(created.task_convergence.then_cli, /emb-agent\.cjs capability run plan$/);
    assert.equal(created.task_convergence.prompts.length, 3);

    const activated = await captureCliJson(['task', 'activate', taskName]);
    assert.equal(activated.activated, true);
    assert.equal(activated.workspace.mode, 'direct');
    assert.equal(activated.workspace.created, false);
    assert.equal(activated.workspace.path, tempProject);
    assert.equal(activated.task.worktree_path, null);
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'tasks', taskName, 'task.json')),
      true
    );
    assertProjectLocalInjected(activated.task.injected_specs);
    assert.equal(activated.task.artifacts.prd, `.emb-agent/tasks/${taskName}/prd.md`);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'SC8F072.pdf')), true);
    assert.equal(activated.worktree.exists, false);
    assert.equal(activated.worktree.workspace_state, 'detached');
    assert.equal(activated.worktree.current_task, '');
    assert.equal(activated.worktree_mode, 'direct');
    assert.equal(cli.loadSession().active_task.name, taskName);
    assert.equal(cli.loadSession().active_task.status, 'in_progress');
    assert.equal(cli.loadSession().focus, activated.task.title);
    assert.equal(activated.task_convergence.status, 'active-task');
    assert.equal(activated.task_convergence.recommended_path, 'plan-first');
    assert.match(activated.task_convergence.next_cli, /emb-agent\.cjs capability run plan$/);
    assert.match(activated.task_convergence.then_cli, /emb-agent\.cjs capability run do$/);
    assert.equal(
      fs.readFileSync(path.join(tempProject, '.emb-agent', '.current-task'), 'utf8').trim(),
      taskName
    );
    assert.ok(cli.loadSession().last_files.some(item => item.includes('cache/docs/')));

    const taskStatus = await captureCliJson(['task', 'status']);
    assert.equal(taskStatus.current_task, taskName);
    assert.equal(taskStatus.active_task.name, taskName);
    assert.equal(taskStatus.active_task.status, 'in_progress');
    assert.equal(taskStatus.task_convergence.recommended_path, 'plan-first');

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

    const listedWorktrees = await captureCliJson(['task', 'worktree', 'list']);
    assert.equal(listedWorktrees.worktrees.some(item => item.task_name === taskName), false);

    const worktreeStatus = await captureCliJson(['task', 'worktree', 'status', taskName]);
    assert.equal(worktreeStatus.worktree.task_name, taskName);
    assert.equal(worktreeStatus.worktree.exists, false);
    assert.equal(worktreeStatus.worktree.workspace_state, 'detached');

    const resume = await captureCliJson(['resume']);
    assert.equal(resume.task.name, taskName);
    assert.equal(resume.task.worktree_path, null);
    assert.equal(resume.task.artifacts.prd, `.emb-agent/tasks/${taskName}/prd.md`);
    assert.ok(resume.task.context.implement.some(item => item.path === 'src/timer.c'));
    assertProjectLocalInjected(resume.injected_specs);
    assertProjectLocalInjected(resume.task.injected_specs);

    const next = cli.buildNextContext();
    assertProjectLocalInjected(next.injected_specs);
    assertProjectLocalInjected(next.task.injected_specs);
    assert.equal(next.next.command, 'plan');
    assert.match(next.next.reason, /Active task/i);
    assert.equal(next.task_convergence.recommended_path, 'plan-first');
    assert.equal(next.task_convergence.prd_path, `.emb-agent/tasks/${taskName}/prd.md`);
    assert.ok(next.next_actions.some(item => item.startsWith('task_route=plan-first')));

    const status = cli.buildStatus();
    assertProjectLocalInjected(status.injected_specs);
    assertProjectLocalInjected(status.active_task.injected_specs);

    const plan = cli.buildActionOutput('plan');
    assertProjectLocalInjected(plan.injected_specs);

    const paused = await captureCliJson(['pause', `Continue ${taskName}`]);
    assert.equal(paused.paused, true);
    assert.equal(cli.loadHandoff().focus, activated.task.title);
    assert.equal(cli.buildResumeContext().handoff.next_action, `Continue ${taskName}`);

    const blockedResolve = await captureCliJson(['task', 'resolve', taskName, 'adapter merged']);
    assert.equal(blockedResolve.status, 'aar-required');

    const scanned = await captureCliJson([
      'task',
      'aar',
      'scan',
      taskName,
      '--aar-new-pattern',
      'no',
      '--aar-new-trap',
      'no',
      '--aar-missing-rule',
      'no',
      '--aar-outdated-rule',
      'no'
    ]);
    assert.equal(scanned.scanned, true);
    assert.equal(scanned.task.aar.scan_completed, true);
    assert.equal(scanned.task.aar.record_required, false);

    const resolved = await captureCliJson(['task', 'resolve', taskName, 'adapter merged']);
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.workspace_merge.status, 'direct-workspace');
    assert.equal(resolved.workspace_cleanup.cleaned, false);
    assert.equal(resolved.workspace_cleanup.status, 'not-attached');
    assert.equal(resolved.task.status, 'completed');
    assert.equal(resolved.task.worktree_path, null);
    assert.equal(resolved.task.notes, 'adapter merged');
    assert.equal(resolved.task.aar.scan_completed, true);
    assert.equal(resolved.task.aar.record_required, false);
    assert.equal(cli.loadSession().active_task.name, '');
    assert.equal(cli.loadSession().focus, '');
    assert.equal(resolved.continuity_cleanup.handoff_cleared, true);
    assert.equal(resolved.continuity_cleanup.context_summary_cleared, true);
    assert.equal(cli.loadHandoff(), null);
    assert.equal(cli.buildResumeContext().summary.resume_source, 'session');
    assert.equal(fs.readFileSync(path.join(tempProject, '.emb-agent', '.current-task'), 'utf8'), '');

    const focusSet = await captureCliJson(['context', 'focus', 'set', 'temporary follow-up']);
    assert.equal(focusSet.focus, 'temporary follow-up');
    const focusCleared = await captureCliJson(['context', 'focus', 'clear']);
    assert.equal(focusCleared.focus, '');

    const listedAfterResolve = await captureCliJson(['task', 'worktree', 'list']);
    assert.equal(listedAfterResolve.worktrees.some(item => item.task_name === taskName), false);
  } finally {
    process.chdir(currentCwd);
  }
});

test('capability do requires selected code-writing specs without making them global', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-code-writing-spec-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    const projectExtDir = runtime.getProjectExtDir(tempProject);
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
    });
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
    writeText(
      path.join(projectExtDir, 'specs', 'embedded-space.md'),
      '# Embedded Space\n\n- Keep code direct and ROM-first.\n'
    );
    writeText(
      path.join(projectExtDir, 'specs', 'product-flow.md'),
      '# Product Flow\n\n- Keep workflow state explicit.\n'
    );
    const projectConfigPath = runtime.resolveProjectDataPath(tempProject, 'project.json');
    const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
    writeJson(projectConfigPath, {
      ...projectConfig,
      active_specs: ['embedded-space', 'product-flow']
    });

    const plan = cli.buildActionOutput('plan');
    const actionDo = cli.buildActionOutput('do');

    assert.ok(!plan.injected_specs.some(item => item.name === 'embedded-space'));
    assert.ok(actionDo.injected_specs.some(item =>
      item.name === 'embedded-space' &&
      item.required === true &&
      item.enforcement_scope === 'code-writing'
    ));
    assert.ok(!actionDo.injected_specs.some(item => item.name === 'product-flow'));
    assert.equal(actionDo.code_writing_specs.status, 'required');
    assert.ok(actionDo.code_writing_specs.items.some(item => item.name === 'embedded-space'));
    assert.ok(!actionDo.code_writing_specs.items.some(item => item.name === 'product-flow'));
    assert.ok(actionDo.next_actions.some(item => item.includes('required_code_writing_specs=')));

    const created = await captureCliJson(['task', 'add', 'Implement source rules']);
    const taskName = created.task.name;
    const taskDir = path.join(tempProject, '.emb-agent', 'tasks', taskName);
    const codeWritingSpecsPath = `.emb-agent/tasks/${taskName}/code-writing-specs.md`;
    const autoSpecsText = fs.readFileSync(path.join(taskDir, 'auto-specs.md'), 'utf8');
    const codeWritingSpecsText = fs.readFileSync(path.join(taskDir, 'code-writing-specs.md'), 'utf8');

    assert.ok(created.task.code_writing_specs.some(item => item.name === 'embedded-space'));
    assert.ok(!created.task.code_writing_specs.some(item => item.name === 'product-flow'));
    assert.equal(created.task.artifacts.code_writing_specs, codeWritingSpecsPath);
    assert.ok(created.task.context.implement.some(item => item.path === codeWritingSpecsPath));
    assert.ok(!created.task.context.check.some(item => item.path === codeWritingSpecsPath));
    assert.ok(!created.task.context.debug.some(item => item.path === codeWritingSpecsPath));
    assert.doesNotMatch(autoSpecsText, /Required Code-Writing Specs/);
    assert.match(codeWritingSpecsText, /Required Code-Writing Specs/);
    assert.match(codeWritingSpecsText, /Keep code direct and ROM-first/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('task worktree default and legacy config stay inside project', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-worktree-default-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);
    writeText(path.join(tempProject, '.emb-agent', 'worktree.yaml'), 'worktree_dir: ../emb-agent-worktrees\n');

    const created = await captureCliJson(['task', 'add', '--confirm', 'Keep task workspace project local']);
    const activated = await captureCliJson(['task', 'activate', '--confirm', '--worktree', created.task.name]);
    const expectedRoot = path.join(tempProject, '.emb-agent', 'worktrees');

    assert.equal(activated.activated, true);
    assert.equal(
      path.relative(expectedRoot, activated.task.worktree_path).startsWith('..'),
      false
    );
    assert.equal(fs.existsSync(activated.task.worktree_path), true);

    await captureCliJson(['task', 'worktree', 'cleanup', '--confirm', created.task.name]);
  } finally {
    process.chdir(currentCwd);
  }
});

test('task resolve keeps unrelated handoff when only context summary matches', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-continuity-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await cli.main(['init']);

    const created = await captureCliJson(['task', 'add', '--confirm', 'Resolve stale continuation']);
    await captureCliJson(['task', 'activate', '--confirm', created.task.name]);

    const runtimeRoot = path.join(repoRoot, 'runtime');
    const runtimeConfig = runtime.loadRuntimeConfig(runtimeRoot);
    const statePaths = runtime.getProjectStatePaths(runtimeRoot, tempProject, runtimeConfig);

    runtime.writeJson(statePaths.handoffPath, {
      version: '1.0',
      timestamp: '2026-05-06T00:00:00.000Z',
      status: 'paused',
      focus: 'Unrelated board review',
      next_action: 'Continue board review',
      context_notes: 'No reference to the resolved task',
      specs: [],
      last_files: []
    });
    runtime.writeJson(statePaths.contextSummaryPath, {
      version: '1.0',
      generated_at: '2026-05-06T00:00:00.000Z',
      source: 'pause',
      focus: created.task.title,
      specs: [],
      active_task: {
        name: created.task.name,
        title: created.task.title,
        status: 'in_progress',
        path: created.task.path,
        package: ''
      }
    });

    await captureCliJson([
      'task',
      'aar',
      'scan',
      created.task.name,
      '--aar-new-pattern',
      'no',
      '--aar-new-trap',
      'no',
      '--aar-missing-rule',
      'no',
      '--aar-outdated-rule',
      'no'
    ]);
    const resolved = await captureCliJson(['task', 'resolve', created.task.name, 'done']);

    assert.equal(resolved.continuity_cleanup.context_summary_cleared, true);
    assert.equal(resolved.continuity_cleanup.handoff_cleared, false);
    assert.equal(fs.existsSync(statePaths.contextSummaryPath), false);
    assert.equal(cli.loadHandoff().focus, 'Unrelated board review');
  } finally {
    process.chdir(currentCwd);
  }
});

test('task supports parent-child links and create-pr preview commands', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-parent-child-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    writeText(path.join(tempProject, 'src', 'main.c'), '// main\n');
    await cli.main(['init']);

    const parentCreated = await captureCliJson([
      'task',
      'add',
      'Build peripheral exercise plan',
      '--scope',
      'planning',
      '--priority',
      'P1'
    ]);
    const parentName = parentCreated.task.name;

    const childCreated = await captureCliJson([
      'task',
      'add',
      'Implement pwm execution path',
      '--scope',
      'pwm',
      '--parent',
      parentName
    ]);
    const childName = childCreated.task.name;

    assert.equal(childCreated.task.parent, parentName);

    const parentShown = await captureCliJson(['task', 'show', parentName]);
    assert.ok(parentShown.task.children.includes(childName));
    assert.equal(parentShown.task.child_progress.total, 1);
    assert.equal(parentShown.task.child_progress.completed, 0);

    const branchUpdated = await captureCliJson(['task', 'set-branch', childName, 'feat/pwm-execution']);
    assert.equal(branchUpdated.updated, true);
    assert.equal(branchUpdated.task.branch, 'feat/pwm-execution');

    const baseUpdated = await captureCliJson(['task', 'set-base-branch', childName, 'release/demo']);
    assert.equal(baseUpdated.updated, true);
    assert.equal(baseUpdated.task.base_branch, 'release/demo');

    const preview = await captureCliJson(['task', 'create-pr', childName, '--dry-run']);
    assert.equal(preview.ready, true);
    assert.equal(preview.dry_run, true);
    assert.equal(preview.pr.head, 'feat/pwm-execution');
    assert.equal(preview.pr.base, 'release/demo');
    assert.match(preview.pr.title, /^pwm: /);
    assert.match(preview.pr.suggested_cli, /gh pr create/);
    const childShown = await captureCliJson(['task', 'show', childName]);
    assert.equal(childShown.task.pr.status, 'previewed');
    assert.equal(childShown.task.pr.head, 'feat/pwm-execution');
    assert.equal(childShown.task.pr.base, 'release/demo');
    assert.match(childShown.task.pr.suggested_cli, /gh pr create/);

    const linked = await captureCliJson([
      'task',
      'link-pr',
      childName,
      'https://github.com/demo/repo/pull/42',
      '--number',
      '42'
    ]);
    assert.equal(linked.updated, true);
    assert.equal(linked.pr.status, 'linked');
    assert.equal(linked.pr.url, 'https://github.com/demo/repo/pull/42');
    assert.equal(linked.pr.number, '42');

    const linkedShown = await captureCliJson(['task', 'show', childName]);
    assert.equal(linkedShown.task.pr.status, 'linked');
    assert.equal(linkedShown.task.pr.url, 'https://github.com/demo/repo/pull/42');
    assert.equal(linkedShown.task.pr.number, '42');

    const linkedTty = await captureCliTtyOutput([
      'task',
      'link-pr',
      childName,
      'https://github.com/demo/repo/pull/42',
      '--number',
      '42'
    ]);
    assert.match(linkedTty.stderr, /Linked: yes/);
    assert.match(linkedTty.stderr, /PR Status: linked/);
    assert.match(linkedTty.stderr, /PR URL: https:\/\/github.com\/demo\/repo\/pull\/42/);

    const showTty = await captureCliTtyOutput(['task', 'show', childName]);
    assert.match(showTty.stderr, /Task: implement-pwm-execution-path/);
    assert.match(showTty.stderr, /Branch: feat\/pwm-execution/);
    assert.match(showTty.stderr, /Base Branch: release\/demo/);
    assert.match(showTty.stderr, /PR: linked: https:\/\/github.com\/demo\/repo\/pull\/42/);

    const linkedAgain = await captureCliJson(['task', 'subtask', 'remove', parentName, childName]);
    assert.equal(linkedAgain.updated, true);
    assert.equal(linkedAgain.child.parent, null);

    const parentAfterUnlink = await captureCliJson(['task', 'show', parentName]);
    assert.equal(parentAfterUnlink.task.children.includes(childName), false);
  } finally {
    process.chdir(currentCwd);
  }
});

test('task package selection propagates into manifest and active session package', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-package-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    fs.writeFileSync(
      path.join(tempProject, 'pnpm-workspace.yaml'),
      ['packages:', '  - packages/*', ''].join('\n'),
      'utf8'
    );
    writeJson(path.join(tempProject, 'packages', 'app', 'package.json'), { name: '@demo/app' });
    writeJson(path.join(tempProject, 'packages', 'fw', 'package.json'), { name: '@demo/fw' });

    await cli.main(['init']);
    writeText(path.join(tempProject, 'packages', 'app', 'src', 'app.ts'), '// app\n');
    writeText(path.join(tempProject, 'packages', 'fw', 'src', 'adc.c'), '// adc\n');
    writeText(path.join(tempProject, 'packages', 'fw', 'src', 'pwm.c'), '// pwm\n');
    await cli.main(['last-files', 'add', 'packages/app/src/app.ts']);
    await cli.main(['last-files', 'add', 'packages/fw/src/adc.c']);
    await cli.main(['last-files', 'add', 'packages/fw/src/pwm.c']);

    const created = await captureCliJson([
      'task',
      'add',
      'Implement ADC sampling path',
      '--scope',
      'adc',
      '--package',
      'fw'
    ]);
    const taskName = created.task.name;

    assert.equal(created.task.package, 'fw');

    const shown = await captureCliJson(['task', 'show', taskName]);
    assert.equal(shown.task.package, 'fw');
    assert.equal(shown.task.context.implement.some(item => item.kind === 'directory' && item.path === 'packages/fw'), true);
    assert.equal(shown.task.context.implement.some(item => item.path === 'packages/fw/src/adc.c'), true);
    assert.equal(shown.task.context.implement.some(item => item.path === 'packages/fw/src/pwm.c'), true);
    assert.equal(shown.task.context.implement.some(item => item.path === 'packages/app/src/app.ts'), false);

    await captureCliJson(['task', 'activate', taskName]);

    const session = cli.loadSession();
    assert.equal(session.active_package, 'fw');
    assert.equal(session.active_task.package, 'fw');

    const status = cli.buildStatus();
    assert.equal(status.active_package, 'fw');
    assert.equal(status.active_task.package, 'fw');
  } finally {
    process.chdir(currentCwd);
  }
});

test('task worktree state exposes package-scoped workspace metadata', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-package-worktree-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    fs.writeFileSync(
      path.join(tempProject, 'pnpm-workspace.yaml'),
      ['packages:', '  - packages/*', ''].join('\n'),
      'utf8'
    );
    writeJson(path.join(tempProject, 'packages', 'app', 'package.json'), { name: '@demo/app' });
    writeJson(path.join(tempProject, 'packages', 'fw', 'package.json'), { name: '@demo/fw' });
    writeText(path.join(tempProject, 'packages', 'fw', 'src', 'main.c'), '// fw main\n');
    await cli.main(['init']);
    const projectConfigPath = path.join(tempProject, '.emb-agent', 'project.json');
    const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
    projectConfig.packages = (projectConfig.packages || []).map(item =>
      item && item.name === 'fw'
        ? { ...item, submodule: true }
        : item
    );
    fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2) + '\n', 'utf8');
    writeText(path.join(tempProject, '.emb-agent', 'worktree.yaml'), 'worktree_dir: .task-worktrees\n');
    initGitRepo(tempProject);

    const created = await captureCliJson(['task', 'add', 'Inspect package workspace scope', '--package', 'fw']);
    const taskName = created.task.name;
    const preview = await captureCliJson(['task', 'create-pr', taskName, '--dry-run']);
    assert.equal(preview.ready, true);

    const provisioned = await captureCliJson(['task', 'worktree', 'create', taskName]);
    assert.equal(provisioned.workspace.package, 'fw');
    assert.equal(provisioned.workspace.package_scope, 'package');
    assert.equal(provisioned.workspace.package_path, 'packages/fw');
    assert.equal(provisioned.worktree.package, 'fw');
    assert.equal(provisioned.worktree.package_scope, 'package');
    assert.equal(provisioned.worktree.package_path, 'packages/fw');
    assert.equal(provisioned.worktree.package_exists, true);
    assert.equal(provisioned.worktree.submodule, true);
    assert.equal(provisioned.worktree.submodule_status, 'ready');
    assert.equal(provisioned.worktree.pr_status, 'previewed');
    assert.equal(provisioned.worktree.pr.head, `task/${taskName}`);
    assert.equal(provisioned.worktree.pr.base, preview.pr.base);

    const shown = await captureCliJson(['task', 'worktree', 'show', taskName]);
    assert.equal(shown.worktree.package, 'fw');
    assert.equal(shown.worktree.package_scope, 'package');
    assert.equal(shown.worktree.package_path, 'packages/fw');
    assert.equal(shown.worktree.submodule, true);
    assert.equal(shown.worktree.pr_status, 'previewed');

    const linked = await captureCliJson([
      'task',
      'link-pr',
      taskName,
      'https://github.com/demo/repo/pull/7',
      '--number',
      '7'
    ]);
    assert.equal(linked.pr.status, 'linked');

    const shownLinked = await captureCliJson(['task', 'worktree', 'show', taskName]);
    assert.equal(shownLinked.worktree.pr_status, 'linked');
    assert.equal(shownLinked.worktree.pr.url, 'https://github.com/demo/repo/pull/7');

    const tty = await captureCliTtyOutput(['task', 'worktree', 'show', taskName]);
    assert.match(tty.stderr, /Scope: package/);
    assert.match(tty.stderr, /Package: fw/);
    assert.match(tty.stderr, /Package Path: packages\/fw/);
    assert.match(tty.stderr, /Submodule: yes/);
    assert.match(tty.stderr, new RegExp(`Branch: task/${taskName}`));
    assert.match(tty.stderr, new RegExp(`Base Branch: ${preview.pr.base}`));
    assert.match(tty.stderr, /PR: linked: https:\/\/github.com\/demo\/repo\/pull\/7/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('task add and activate keep tty output human-readable for package tasks', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-package-tty-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    fs.writeFileSync(
      path.join(tempProject, 'pnpm-workspace.yaml'),
      ['packages:', '  - packages/*', ''].join('\n'),
      'utf8'
    );
    writeJson(path.join(tempProject, 'packages', 'app', 'package.json'), { name: '@demo/app' });
    writeJson(path.join(tempProject, 'packages', 'fw', 'package.json'), { name: '@demo/fw' });
    writeText(path.join(tempProject, 'packages', 'fw', 'src', 'main.c'), '// fw main\n');
    await cli.main(['init']);
    writeText(path.join(tempProject, '.emb-agent', 'worktree.yaml'), 'worktree_dir: .task-worktrees\n');
    initGitRepo(tempProject);

    const addTty = await captureCliTtyOutput(['task', 'add', 'TTY package task', '--package', 'fw']);
    assert.equal(addTty.stdout.trim(), '');
    assert.match(addTty.stderr, /PRD: \.emb-agent\/tasks\/tty-package-task\/prd\.md/);
    assert.match(addTty.stderr, /Converge: Open the task PRD first/);
    assert.match(addTty.stderr, /Route: scan-first/);
    assert.match(addTty.stderr, /Next: .*task activate tty-package-task/);
    assert.match(addTty.stderr, /Then: .*emb-agent\.cjs capability run scan/);
    assert.match(addTty.stderr, /Created: yes/);
    assert.match(addTty.stderr, /Task: tty-package-task/);
    assert.match(addTty.stderr, /Package: fw/);

    const activateTty = await captureCliTtyOutput(['task', 'activate', 'tty-package-task']);
    assert.equal(activateTty.stdout.trim(), '');
    assert.match(activateTty.stderr, /PRD: \.emb-agent\/tasks\/tty-package-task\/prd\.md/);
    assert.match(activateTty.stderr, /Converge: Use the task PRD as the working contract/);
    assert.match(activateTty.stderr, /Route: scan-first/);
    assert.match(activateTty.stderr, /Next: .*emb-agent\.cjs capability run scan/);
    assert.match(activateTty.stderr, /Then: .*emb-agent\.cjs capability run plan/);
    assert.match(activateTty.stderr, /Activated: yes/);
    assert.match(activateTty.stderr, /Task: tty-package-task/);
    assert.match(activateTty.stderr, /Package: fw/);
    assert.match(activateTty.stderr, /Mode: direct/);
    assert.match(activateTty.stderr, /Path:/);

    const nextTty = await captureCliTtyOutput(['next']);
    assert.equal(nextTty.stdout.trim(), '');
    assert.match(nextTty.stderr, /PRD: \.emb-agent\/tasks\/tty-package-task\/prd\.md/);
    assert.match(nextTty.stderr, /Converge: Use the task PRD as the working contract/);
    assert.match(nextTty.stderr, /Route: scan-first/);
    assert.match(nextTty.stderr, /Next: .*emb-agent\.cjs capability run scan/);
    assert.match(nextTty.stderr, /Reason: Active task/i);
  } finally {
    process.chdir(currentCwd);
  }
});

test('task activate defaults to direct workspace in a git repository', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-git-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    writeText(path.join(tempProject, 'src', 'main.c'), '// main\n');
    await cli.main(['init']);
    writeText(path.join(tempProject, '.emb-agent', 'worktree.yaml'), 'worktree_dir: .task-worktrees\n');
    initGitRepo(tempProject);

    const created = await captureCliJson(['task', 'add', 'Investigate irq race']);
    const taskName = created.task.name;

    const activated = await captureCliJson(['task', 'activate', taskName]);
    assert.equal(activated.workspace.mode, 'direct');
    assert.equal(activated.workspace.path, tempProject);
    assert.equal(activated.task.worktree_path, null);
    assert.equal(activated.worktree.exists, false);
    assert.equal(activated.worktree_mode, 'direct');

    const resolved = await captureCliJson([
      'task',
      'resolve',
      taskName,
      '--aar-new-pattern',
      'no',
      '--aar-new-trap',
      'no',
      '--aar-missing-rule',
      'no',
      '--aar-outdated-rule',
      'no',
      'done'
    ]);
    assert.equal(resolved.workspace_merge.status, 'direct-workspace');
    assert.equal(resolved.workspace_cleanup.cleaned, false);
    assert.equal(fs.existsSync(tempProject), true);
  } finally {
    process.chdir(currentCwd);
  }
});

test('task activate --worktree creates a real git worktree when requested', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-git-worktree-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    writeText(path.join(tempProject, 'src', 'main.c'), '// main\n');
    await cli.main(['init']);
    writeText(path.join(tempProject, '.emb-agent', 'worktree.yaml'), 'worktree_dir: .task-worktrees\n');
    initGitRepo(tempProject);

    const created = await captureCliJson(['task', 'add', 'Investigate isolated irq race']);
    const taskName = created.task.name;

    const activated = await captureCliJson(['task', 'activate', '--worktree', taskName]);
    assert.equal(activated.workspace.mode, 'git-worktree');
    assert.equal(fs.existsSync(activated.workspace.path), true);
    assert.equal(fs.existsSync(path.join(activated.workspace.path, '.git')), true);
    assert.equal(activated.task.worktree_path, activated.workspace.path);
    assert.equal(activated.worktree_mode, 'created');

    const resolved = await captureCliJson([
      'task',
      'resolve',
      taskName,
      '--aar-new-pattern',
      'no',
      '--aar-new-trap',
      'no',
      '--aar-missing-rule',
      'no',
      '--aar-outdated-rule',
      'no',
      'done'
    ]);
    assert.equal(resolved.workspace_cleanup.cleaned, true);
    assert.equal(fs.existsSync(activated.workspace.path), false);
  } finally {
    process.chdir(currentCwd);
  }
});

test('task resolve auto-merges dirty git worktree before cleanup', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-merge-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    writeText(path.join(tempProject, 'src', 'main.c'), '// main\n');
    await cli.main(['init']);
    initGitRepo(tempProject);

    const created = await captureCliJson(['task', 'add', 'Merge task workspace changes']);
    const taskName = created.task.name;
    const activated = await captureCliJson(['task', 'activate', '--worktree', taskName]);

    writeText(path.join(activated.workspace.path, 'src', 'main.c'), '// task change\n');
    writeText(path.join(activated.workspace.path, 'src', 'added.c'), '// added by task\n');

    const resolved = await captureCliJson([
      'task',
      'resolve',
      taskName,
      '--aar-new-pattern',
      'no',
      '--aar-new-trap',
      'no',
      '--aar-missing-rule',
      'no',
      '--aar-outdated-rule',
      'no',
      'done'
    ]);

    assert.equal(resolved.resolved, true);
    assert.equal(resolved.workspace_merge.status, 'merged');
    assert.equal(resolved.workspace_cleanup.cleaned, true);
    assert.equal(fs.existsSync(activated.workspace.path), false);
    assert.equal(fs.readFileSync(path.join(tempProject, 'src', 'main.c'), 'utf8'), '// task change\n');
    assert.equal(fs.readFileSync(path.join(tempProject, 'src', 'added.c'), 'utf8'), '// added by task\n');
  } finally {
    process.chdir(currentCwd);
  }
});

test('task resolve keeps worktree when automatic merge fails', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-merge-fail-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    writeText(path.join(tempProject, 'src', 'main.c'), 'line one\nline two\n');
    await cli.main(['init']);
    initGitRepo(tempProject);

    const created = await captureCliJson(['task', 'add', 'Detect merge conflict before cleanup']);
    const taskName = created.task.name;
    const activated = await captureCliJson(['task', 'activate', '--worktree', taskName]);

    writeText(path.join(activated.workspace.path, 'src', 'main.c'), 'line one\nfrom task\n');
    writeText(path.join(tempProject, 'src', 'main.c'), 'line one\nfrom main\n');

    const blocked = await captureCliJson([
      'task',
      'resolve',
      taskName,
      '--aar-new-pattern',
      'no',
      '--aar-new-trap',
      'no',
      '--aar-missing-rule',
      'no',
      '--aar-outdated-rule',
      'no',
      'done'
    ]);

    assert.equal(blocked.resolved, false);
    assert.equal(blocked.status, 'workspace-merge-required');
    assert.equal(blocked.workspace_merge.status, 'failed');
    assert.equal(fs.existsSync(activated.workspace.path), true);
    assert.equal(fs.readFileSync(path.join(tempProject, 'src', 'main.c'), 'utf8'), 'line one\nfrom main\n');
  } finally {
    process.chdir(currentCwd);
  }
});

test('task worktree create and cleanup expose trellis-style workspace lifecycle for git projects', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-worktree-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    writeText(path.join(tempProject, 'src', 'main.c'), '// main\n');
    await cli.main(['init']);
    writeText(path.join(tempProject, '.emb-agent', 'worktree.yaml'), 'worktree_dir: .task-worktrees\n');
    initGitRepo(tempProject);

    const created = await captureCliJson(['task', 'add', 'Inspect worktree lifecycle']);
    const taskName = created.task.name;

    const provisioned = await captureCliJson(['task', 'worktree', 'create', taskName]);
    assert.equal(provisioned.created, true);
    assert.equal(provisioned.task.status, 'planning');
    assert.equal(provisioned.worktree.exists, true);
    assert.equal(provisioned.worktree.workspace_state, 'dirty');
    assert.equal(provisioned.worktree.attention, 'warn');
    assert.match(provisioned.worktree.summary, /uncommitted/i);
    assert.ok(provisioned.runtime_events.some(item => item.type === 'permission-evaluated'));
    assert.ok(provisioned.runtime_events.some(item => item.type === 'task-worktree-transition'));
    assert.equal(
      fs.existsSync(path.join(provisioned.workspace.path, '.emb-agent', 'tasks', taskName, 'task.json')),
      true
    );
    assert.equal(
      fs.readFileSync(path.join(provisioned.workspace.path, '.emb-agent', '.current-task'), 'utf8').trim(),
      taskName
    );

    const registryPath = path.join(tempProject, '.emb-agent', 'registry', 'worktrees.json');
    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    assert.ok(registry.worktrees.some(item => item.task_name === taskName));

    const shown = await captureCliJson(['task', 'worktree', 'show', taskName]);
    assert.equal(shown.worktree.task_name, taskName);
    assert.equal(shown.worktree.exists, true);
    assert.equal(shown.worktree.current_task, taskName);
    assert.equal(shown.worktree.workspace_state, 'dirty');
    assert.equal(shown.runtime_events[0].type, 'task-worktree-status');

    const listed = await captureCliJson(['task', 'worktree', 'list']);
    assert.equal(listed.summary.total, 1);
    assert.equal(listed.summary.active, 0);
    assert.equal(listed.summary.dirty, 1);
    assert.equal(listed.worktrees[0].task_name, taskName);
    assert.equal(listed.worktrees[0].workspace_state, 'dirty');
    assert.equal(listed.runtime_events[0].type, 'task-worktree-status');

    const cleaned = await captureCliJson(['task', 'worktree', 'cleanup', taskName]);
    assert.equal(cleaned.cleaned, true);
    assert.equal(cleaned.task.worktree_path, null);
    assert.equal(cleaned.workspace_cleanup.cleaned, true);
    assert.equal(cleaned.workspace_cleanup.path, provisioned.workspace.path);
    assert.ok(cleaned.runtime_events.some(item => item.type === 'permission-evaluated'));
    assert.ok(cleaned.runtime_events.some(item => item.type === 'task-worktree-transition'));
    assert.equal(fs.existsSync(provisioned.workspace.path), false);

    const shownAfterCleanup = await captureCliJson(['task', 'worktree', 'show', taskName]);
    assert.equal(shownAfterCleanup.worktree.workspace_state, 'detached');
    assert.equal(shownAfterCleanup.worktree.attention, 'info');

    const registryAfter = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    assert.equal(registryAfter.worktrees.some(item => item.task_name === taskName), false);
  } finally {
    process.chdir(currentCwd);
  }
});

test('task worktree status surfaces user-facing tty summary and events', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-worktree-tty-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    writeText(path.join(tempProject, 'src', 'main.c'), '// main\n');
    await cli.main(['init']);
    writeText(path.join(tempProject, '.emb-agent', 'worktree.yaml'), 'worktree_dir: .task-worktrees\n');
    initGitRepo(tempProject);

    const created = await captureCliJson(['task', 'add', 'Inspect worktree tty status']);
    const taskName = created.task.name;

    await captureCliJson(['task', 'worktree', 'create', taskName]);
    const output = await captureCliTtyOutput(['task', 'worktree', 'status', taskName]);

    assert.match(output.stderr, new RegExp(`Task: ${taskName}`));
    assert.match(output.stderr, /State: dirty/);
    assert.match(output.stderr, /Summary: The worktree has \d+ uncommitted file\(s\)\./);
    assert.match(output.stderr, /Events: pending \/ 1 \(task-worktree-status\)/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('task aar record is required when the scan finds a new lesson', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-task-aar-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    writeText(path.join(tempProject, 'src', 'main.c'), '// main\n');
    await cli.main(['init']);
    writeText(path.join(tempProject, '.emb-agent', 'worktree.yaml'), 'worktree_dir: .task-worktrees\n');

    const created = await captureCliJson(['task', 'add', 'Document timer gotcha']);
    const taskName = created.task.name;
    await captureCliJson(['task', 'activate', taskName]);

    const scanned = await captureCliJson([
      'task',
      'aar',
      'scan',
      taskName,
      '--aar-new-pattern',
      'no',
      '--aar-new-trap',
      'yes',
      '--aar-missing-rule',
      'no',
      '--aar-outdated-rule',
      'no'
    ]);
    assert.equal(scanned.scanned, true);
    assert.equal(scanned.task.aar.record_required, true);
    assert.deepEqual(scanned.task.aar.triggered_questions, ['new_trap']);

    const blockedResolve = await captureCliJson(['task', 'resolve', taskName, 'captured lesson']);
    assert.equal(blockedResolve.status, 'aar-record-required');

    const recorded = await captureCliJson([
      'task',
      'aar',
      'record',
      taskName,
      '--aar-summary',
      'Document timer reload sequencing trap',
      '--aar-detail',
      'The timer reload register must be written before enabling the interrupt, so the workflow now needs an explicit verification checkpoint.'
    ]);
    assert.equal(recorded.recorded, true);
    assert.equal(recorded.task.aar.record_completed, true);
    assert.match(recorded.task.aar.artifact_path, /\.emb-agent\/tasks\/.*\/aar\.md$/);

    const aarPath = path.join(tempProject, recorded.task.aar.artifact_path);
    assert.equal(fs.existsSync(aarPath), true);
    assert.match(fs.readFileSync(aarPath, 'utf8'), /Document timer reload sequencing trap/);

    const resolved = await captureCliJson(['task', 'resolve', taskName, 'captured lesson']);
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.task.aar.record_completed, true);
    assert.equal(resolved.task.status, 'completed');
  } finally {
    process.chdir(currentCwd);
  }
});
