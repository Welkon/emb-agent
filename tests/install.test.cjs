'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const installer = require(path.join(repoRoot, 'bin', 'install.js'));
const {
  withDefaultWorkflowSourceEnv,
  workflowSourceRoot
} = require(path.join(repoRoot, 'tests', 'support-workflow-source.cjs'));

async function captureCliJson(cliImpl, args) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await cliImpl.main(args);
  } finally {
    process.stdout.write = originalWrite;
  }

  return JSON.parse(stdout);
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('installer lays down config/lib and runtime commands work', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-home-'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-proj-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  const bridgeCommand = 'node /tmp/emb-subagent-bridge.cjs --stdio-json';
  const privateAdapterSource = 'git@github.com:Welkon/emb-agent-adapters.git';
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    process.chdir(repoRoot);
    await installer.main([
      '--codex',
      '--global',
      '--config-dir',
      tempHome,
      '--developer',
      'welkon',
      '--subagent-bridge-cmd',
      bridgeCommand,
      '--subagent-bridge-timeout-ms',
      '25000',
      '--default-chip-support-source-location',
      privateAdapterSource,
      '--default-chip-support-source-branch',
      'main',
      '--default-chip-support-source-subdir',
      'emb-agent'
    ]);

    const runtimeRoot = path.join(tempHome, 'emb-agent');
    const cliPath = path.join(runtimeRoot, 'bin', 'emb-agent.cjs');
    const installedCli = require(cliPath);
    const installedCommandFiles = fs.readdirSync(path.join(runtimeRoot, 'commands')).filter(name => name.endsWith('.md')).sort();
    const internalCommandDocs = fs.readdirSync(path.join(runtimeRoot, 'command-docs')).filter(name => name.endsWith('.md')).sort();

    assert.equal(fs.existsSync(path.join(tempHome, 'agents', 'emb-arch-reviewer.toml')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-start', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-init', 'SKILL.md')), false);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-next', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'config.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'HOST.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'lib', 'runtime.cjs')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'lib', 'runtime-host.cjs')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'lib', 'adapter-sources.cjs')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'lib', 'tool-catalog.cjs')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'lib', 'tool-runtime.cjs')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'lib', 'chip-catalog.cjs')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'hooks', 'emb-context-monitor.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'hooks', 'emb-session-start.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'scaffolds', 'registry.json')), false);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'state', 'default-session.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'state', 'projects')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'VERSION')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'command-docs')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'tools', 'registry.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'chips', 'registry.json')), true);
    assert.equal(
      require.resolve('chalk', { paths: [path.join(runtimeRoot, 'lib')] }).startsWith(
        path.join(runtimeRoot, 'node_modules')
      ),
      true
    );
    assert.equal(
      require.resolve('ora', { paths: [path.join(runtimeRoot, 'lib')] }).startsWith(
        path.join(runtimeRoot, 'node_modules')
      ),
      true
    );
    assert.equal(
      require.resolve('giget', { paths: [path.join(runtimeRoot, 'lib')] }).startsWith(
        path.join(runtimeRoot, 'node_modules')
      ),
      true
    );
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'chip-support')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'extensions')), false);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'lib', 'scheduler.cjs')), true);
    assert.equal(fs.existsSync(cliPath), true);
    assert.equal(fs.existsSync(path.join(tempHome, '.env.example')), true);
    assert.equal(installedCommandFiles.length, 13);
    assert.ok(installedCommandFiles.includes('help.md'));
    assert.ok(installedCommandFiles.includes('start.md'));
    assert.ok(!installedCommandFiles.includes('init.md'));
    assert.ok(installedCommandFiles.includes('verify.md'));
    assert.ok(!installedCommandFiles.includes('workflow.md'));
    assert.ok(!installedCommandFiles.includes('adapter.md'));
    assert.ok(!installedCommandFiles.includes('support.md'));
    assert.ok(!installedCommandFiles.includes('init-project.md'));
    assert.ok(internalCommandDocs.includes('workflow.md'));
    assert.ok(!internalCommandDocs.includes('adapter.md'));
    assert.ok(internalCommandDocs.includes('support.md'));
    assert.ok(internalCommandDocs.includes('init-project.md'));
    assert.match(fs.readFileSync(path.join(tempHome, '.env.example'), 'utf8'), /MINERU_API_KEY=/);
    assert.match(
      fs.readFileSync(path.join(tempHome, 'skills', 'emb-start', 'SKILL.md'), 'utf8'),
      /This Codex skill mirrors the emb-agent public command `start`\./
    );
    assert.match(
      fs.readFileSync(path.join(tempHome, 'skills', 'emb-start', 'SKILL.md'), 'utf8'),
      /node .*emb-agent\/bin\/emb-agent\.cjs start/
    );
    assert.match(
      fs.readFileSync(path.join(tempHome, 'skills', 'emb-start', 'SKILL.md'), 'utf8'),
      /Prefer `node .*emb-agent\/bin\/emb-agent\.cjs start --brief` as the first routing check/
    );
    assert.match(
      fs.readFileSync(path.join(tempHome, 'skills', 'emb-next', 'SKILL.md'), 'utf8'),
      /If `start --brief` returns an `immediate\.command` other than `next`, follow that command first/
    );
    assert.match(
      fs.readFileSync(path.join(tempHome, 'skills', 'emb-do', 'SKILL.md'), 'utf8'),
      /Only continue with `do` when `next\.command` already equals `do`/
    );
    assert.match(
      fs.readFileSync(path.join(tempHome, 'skills', 'emb-scan', 'SKILL.md'), 'utf8'),
      /Run `node .*emb-agent\/bin\/emb-agent\.cjs next --brief` first and use it as the preflight gate before forcing `scan`/
    );
    assert.match(
      fs.readFileSync(path.join(tempHome, 'skills', 'emb-scan', 'SKILL.md'), 'utf8'),
      /Never use this skill to bypass pending source intake, missing task intake, or health closure/
    );
    const codexConfig = fs.readFileSync(path.join(tempHome, 'config.toml'), 'utf8');
    const codexHooks = JSON.parse(fs.readFileSync(path.join(tempHome, 'hooks.json'), 'utf8'));
    assert.doesNotMatch(codexConfig, /codex_hooks\s*=\s*true/);
    assert.doesNotMatch(codexConfig, /\[\[hooks\]\]/);
    assert.match(codexConfig, /project_doc_fallback_filenames = \["AGENTS\.md"\]/);
    assert.match(codexConfig, /\[agents\.emb-fw-doer\]/);
    assert.ok(Array.isArray(codexHooks.hooks.SessionStart));
    assert.ok(Array.isArray(codexHooks.hooks.PostToolUse));
    assert.match(JSON.stringify(codexHooks.hooks.SessionStart), /emb-session-start\.js/);
    assert.match(JSON.stringify(codexHooks.hooks.PostToolUse), /emb-context-monitor\.js/);
    assert.match(JSON.stringify(codexHooks.hooks.SessionStart), /Loading emb-agent context/);
    assert.doesNotMatch(fs.readFileSync(path.join(runtimeRoot, 'hooks', 'emb-session-start.js'), 'utf8'), /\{\{EMB_VERSION\}\}/);
    assert.match(stdout, /Install profile: core/);
    assert.match(stdout, /Created env example:/);
    assert.match(stdout, /Installed 13 Codex skills under:/);
    assert.match(stdout, /Tip: create .*\.env from \.env\.example/);
    assert.match(stdout, /Tip: set MINERU_API_KEY/);
    assert.match(stdout, /Default chip support source: git@github\.com:Welkon\/emb-agent-adapters\.git/);
    assert.match(stdout, /Installed Codex hooks config:/);
    assert.match(stdout, /Advanced scaffold assets were skipped in core profile/);
    assert.match(stdout, /Startup automation is installed automatically\./);
    assert.match(stdout, /Sub-agent bridge: node \/tmp\/emb-subagent-bridge\.cjs --stdio-json \(timeout: 25000 ms\)/);
    assert.match(stdout, /Next steps:/);
    assert.match(stdout, /open a Codex session\. emb-agent will inject the startup context automatically\./);
    assert.match(stdout, /Then continue with the recommended next command\./);

    process.chdir(tempProject);
    const sessionPath = path.join(tempHome, 'state', 'emb-agent', 'projects');
    assert.equal(fs.existsSync(sessionPath), false);
    installedCli.main(['start']);

    assert.equal(fs.existsSync(sessionPath), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'AGENTS.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'CLAUDE.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'CODEX.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'project.json')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'hw.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'req.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'cache', 'chip-support-sources')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'chip-support')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'extensions')), false);
    assert.equal(fs.existsSync(path.join(tempProject, 'src')), true);

    const configData = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'config.json'), 'utf8'));
    const hostMetadata = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'HOST.json'), 'utf8'));
    const runtimeHost = require(path.join(runtimeRoot, 'lib', 'runtime-host.cjs'));
    const resolvedHost = runtimeHost.resolveRuntimeHost(runtimeRoot);
    assert.equal(configData.session_version, 1);
    assert.equal(configData.default_preferences.truth_source_mode, 'hardware_first');
    assert.deepEqual(configData.default_chip_support_source, {
      type: 'git',
      location: privateAdapterSource,
      branch: 'main',
      subdir: 'emb-agent'
    });
    assert.deepEqual(configData.default_workflow_source, {
      type: 'git',
      location: 'https://github.com/Welkon/emb-support.git',
      branch: '',
      subdir: 'specs'
    });
    assert.deepEqual(configData.default_skill_source, {
      type: 'git',
      location: 'https://github.com/Welkon/emb-support.git',
      branch: '',
      subdir: 'skills'
    });
    assert.deepEqual(configData.developer, { name: 'welkon', runtime: 'codex' });
    assert.equal(hostMetadata.name, 'codex');
    assert.equal(hostMetadata.install_profile, 'core');
    assert.deepEqual(hostMetadata.subagent_bridge, {
      command: bridgeCommand,
      timeout_ms: 25000
    });
    assert.equal(resolvedHost.name, 'codex');
    assert.equal(resolvedHost.stateRoot, path.join(tempHome, 'state', 'emb-agent'));
    assert.match(resolvedHost.cliCommand, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.equal(resolvedHost.subagentBridge.available, true);
    assert.equal(resolvedHost.subagentBridge.mode, 'stdio-json');
    assert.equal(resolvedHost.subagentBridge.source, 'host-metadata');
    assert.equal(resolvedHost.subagentBridge.command, bridgeCommand);
    assert.equal(resolvedHost.subagentBridge.timeout_ms, 25000);
    assert.deepEqual(resolvedHost.subagentBridge.command_argv, ['node', '/tmp/emb-subagent-bridge.cjs', '--stdio-json']);

    const nextBeforeContext = installedCli.buildNextContext();
    const statusBeforeContext = installedCli.buildStatus();
    const startBeforeContext = installedCli.buildStartContext();
    assert.match(fs.readFileSync(path.join(tempProject, 'AGENTS.md'), 'utf8'), /# emb-agent Instructions/);
    assert.match(
      fs.readFileSync(path.join(tempProject, 'AGENTS.md'), 'utf8'),
      /Avoid generic AI or project-management wording when a concrete board action, artifact, or truth file is known/
    );
    assert.equal(nextBeforeContext.next.command, 'scan');
    assert.equal(nextBeforeContext.next.gated_by_health, false);
    assert.equal(nextBeforeContext.runtime_events[0].type, 'workflow-next');
    assert.equal(nextBeforeContext.external_agent, undefined);
    assert.equal(statusBeforeContext.runtime_events[0].type, 'workflow-status');
    assert.equal(statusBeforeContext.external_agent, undefined);
    assert.equal(startBeforeContext.runtime_events[0].type, 'workflow-start');
    assert.equal(startBeforeContext.external_agent, undefined);
    assert.match(startBeforeContext.immediate.cli, / next$/);
    assert.match(startBeforeContext.bootstrap.summary, /project type, intended inputs\/outputs, interfaces, and constraints/);
    assert.equal(startBeforeContext.task_intake.status, 'blocked-by-bootstrap');
    assert.equal(startBeforeContext.task_intake.recommended_entry, 'task add <summary>');
    assert.match(startBeforeContext.task_intake.summary, /After bootstrap is ready, create a task and PRD first/i);
    assert.deepEqual(nextBeforeContext.injected_specs, []);
    assert.equal(nextBeforeContext.workflow_stage.name, 'selection');
    assert.equal(nextBeforeContext.workflow_stage.primary_command, 'scan');
    assert.match(nextBeforeContext.next.reason, /Project definition is still open/);
    assert.ok(nextBeforeContext.next_actions.some(item => item.includes('.emb-agent/req.yaml')));
    assert.ok(Array.isArray(nextBeforeContext.next.health_next_commands));
    assert.equal(nextBeforeContext.next.health_next_commands.length, 0);
    const orchestratorBeforeContext = installedCli.buildOrchestratorContext('next');
    assert.equal(orchestratorBeforeContext.workflow.strategy, 'inline');
    assert.equal(orchestratorBeforeContext.resolved_action, 'scan');
    assert.match(orchestratorBeforeContext.workflow.next_cli, / scan$/);
    installedCli.main(['prefs', 'set', 'plan_mode', 'always']);
    const nextWithForcedPlan = installedCli.buildNextContext();
    assert.equal(nextWithForcedPlan.next.command, 'plan');
    const orchestratorWithForcedPlan = installedCli.buildOrchestratorContext('next');
    assert.equal(orchestratorWithForcedPlan.resolved_action, 'plan');

    installedCli.main(['prefs', 'reset']);

    installedCli.main(['pause', 'resume irq race first']);
    const handoffPath = path.join(
      tempHome,
      'state',
      'emb-agent',
      'projects',
      `${path.basename(fs.readdirSync(path.join(tempHome, 'state', 'emb-agent', 'projects')).find(name => name.endsWith('.handoff.json')) || '')}`
    );
    const plan = installedCli.buildActionOutput('plan');
    const scan = installedCli.buildActionOutput('scan');
    const resume = installedCli.buildResumeContext();
    const nextAfterPause = installedCli.buildNextContext();
    assert.equal(fs.existsSync(handoffPath), true);
    assert.equal(plan.scheduler.primary_agent, 'hw-scout');
    assert.deepEqual(plan.injected_specs, []);
    assert.equal(plan.agent_execution.primary_agent, 'emb-hw-scout');
    assert.equal(plan.agent_execution.mode, 'primary-recommended');
    assert.ok(plan.steps.some(item => item.includes('minimal scan')));
    assert.equal(scan.scheduler.primary_agent, 'hw-scout');
    assert.deepEqual(scan.injected_specs, []);
    assert.equal(scan.agent_execution.primary_agent, 'emb-hw-scout');
    assert.ok(scan.next_reads.some(item => item.includes('.emb-agent/req.yaml')));
    assert.equal(resume.summary.resume_source, 'handoff');
    assert.deepEqual(resume.injected_specs, []);
    assert.equal(resume.memory_summary.source, 'pause');
    assert.ok(resume.memory_summary.next_action.includes('resume irq race first'));
    assert.ok(resume.next_actions.some(item => item.includes('handoff')));
    assert.ok(resume.next_actions.some(item => item.startsWith('command=')));
    assert.equal(nextAfterPause.next.command, 'scan');
    assert.ok(nextAfterPause.handoff.next_action.includes('resume irq race first'));
    assert.equal(nextAfterPause.memory_summary.source, 'pause');

    fs.writeFileSync(path.join(tempProject, 'main.c'), 'void main(void) {}\n', 'utf8');
    installedCli.main(['last-files', 'add', 'main.c']);
    installedCli.main(['prefs', 'set', 'truth_source_mode', 'code_first']);
    const codeFirstPlan = installedCli.buildActionOutput('plan');
    assert.equal(codeFirstPlan.truth_sources[0], 'Most relevant file: main.c');

    installedCli.main(['prefs', 'set', 'verification_mode', 'strict']);
    const strictPlan = installedCli.buildActionOutput('plan');
    assert.ok(strictPlan.verification.some(item => item.includes('failure paths')));

    installedCli.main(['risk', 'add', 'irq race']);
    const nextWithRisk = installedCli.buildNextContext();
    assert.ok(nextWithRisk.current.known_risks.includes('irq race'));

    installedCli.main(['question', 'add', 'why irq misses']);
    const nextWithQuestion = installedCli.buildNextContext();
    assert.ok(nextWithQuestion.current.open_questions.includes('why irq misses'));

    installedCli.main(['question', 'clear']);
    installedCli.main(['risk', 'clear']);
    installedCli.main(['prefs', 'reset']);
    installedCli.main(['focus', 'set', 'chip selection and PoC to production preflight']);
    const nextWithArchReview = installedCli.buildNextContext();
    assert.match(nextWithArchReview.current.focus, /chip selection/i);
    const archReviewContext = installedCli.buildArchReviewContext();
    assert.equal(archReviewContext.suggested_agent, 'emb-arch-reviewer');
    assert.equal(archReviewContext.recommended_template.name, 'architecture-review');
    assert.ok(archReviewContext.trigger_patterns.includes('chip selection'));
    const tools = installedCli.toolCatalog.listToolSpecs(runtimeRoot);
    assert.ok(tools.some(item => item.name === 'timer-calc'));
    assert.ok(tools.some(item => item.name === 'pwm-calc'));
    const families = installedCli.toolCatalog.listFamilies(runtimeRoot);
    assert.deepEqual(families, []);
    const devices = installedCli.toolCatalog.listDevices(runtimeRoot);
    assert.deepEqual(devices, []);
    const chips = installedCli.chipCatalog.listChips(runtimeRoot);
    assert.deepEqual(chips, []);
    const timerResult = installedCli.toolRuntime.runTool(runtimeRoot, 'timer-calc', [
      '--family',
      'vendor-family',
      '--device',
      'device-name',
      '--target-us',
      '560'
    ]);
    assert.equal(timerResult.status, 'chip-support-required');
    const pwmResult = installedCli.toolRuntime.runTool(runtimeRoot, 'pwm-calc', [
      '--family',
      'vendor-family',
      '--target-hz',
      '3906.25',
      '--target-duty',
      '50'
    ]);
    assert.equal(pwmResult.status, 'chip-support-required');
    installedCli.main(['focus', 'set', 'review ota rollback path']);
    installedCli.main(['prefs', 'set', 'review_mode', 'always']);
    installedCli.main(['profile', 'set', 'rtos-iot']);
    const nextWithForcedReview = installedCli.buildNextContext();
    assert.equal(nextWithForcedReview.current.preferences.review_mode, 'always');

    installedCli.main(['prefs', 'reset']);
    installedCli.main(['profile', 'set', 'baremetal-8bit']);
    installedCli.main(['focus', 'set', 'close loop after irq fix']);
    installedCli.main(['do']);
    const nextAfterDo = installedCli.buildNextContext();
    assert.equal(nextAfterDo.current.last_command, 'do');
    const verify = installedCli.buildActionOutput('verify');
    assert.ok(verify.checklist.some(item => item.includes('abnormal inputs')));
    assert.ok(verify.result_template.some(item => item.includes('UNTESTED')));
    assert.ok(verify.next_actions.some(item => item.startsWith('checkpoint=')));

    installedCli.main([
      'review',
      'save',
      'Reconnect path needs release gate',
      '--finding',
      'Rollback verification is still manual',
      '--check',
      'Verify reconnect and rollback together'
    ]);
    const reviewReportPath = path.join(tempProject, 'docs', 'REVIEW-REPORT.md');
    assert.equal(fs.existsSync(reviewReportPath), true);
    assert.match(fs.readFileSync(reviewReportPath, 'utf8'), /Reconnect path needs release gate/);
    const review = installedCli.buildActionOutput('review');
    assert.ok(review.next_actions.some(item => item.startsWith('checkpoint=')));

    installedCli.main([
      'scan',
      'save',
      'hardware',
      'Captured current entry and truth source order',
      '--fact',
      'main.c remains the latest touched file'
    ]);
    const hardwareLogicPath = path.join(tempProject, 'docs', 'HARDWARE-LOGIC.md');
    assert.equal(fs.existsSync(hardwareLogicPath), true);
    assert.match(fs.readFileSync(hardwareLogicPath, 'utf8'), /Captured current entry and truth source order/);

    installedCli.main([
      'plan',
      'save',
      'Prepare minimal irq race fix',
      '--risk',
      'irq race may persist after wakeup',
      '--verify',
      'Verify interrupt ordering on bench'
    ]);
    const debugNotesPath = path.join(tempProject, 'docs', 'DEBUG-NOTES.md');
    assert.match(fs.readFileSync(debugNotesPath, 'utf8'), /Prepare minimal irq race fix/);

    installedCli.main([
      'note',
      'add',
      'debug',
      'irq race reproduced after wakeup path',
      '--kind',
      'debug_conclusion',
      '--evidence',
      'scope capture pending'
    ]);
    assert.equal(fs.existsSync(debugNotesPath), true);
    assert.match(fs.readFileSync(debugNotesPath, 'utf8'), /irq race reproduced after wakeup path/);

    installedCli.main([
      'verify',
      'save',
      'IRQ fix closed with bench validation',
      '--check',
      'Check interrupt ordering after wakeup',
      '--result',
      'PASS: wakeup ordering stable',
      '--evidence',
      'bench log #12'
    ]);
    const verificationPath = path.join(tempProject, 'docs', 'VERIFICATION.md');
    assert.equal(fs.existsSync(verificationPath), true);
    assert.match(fs.readFileSync(verificationPath, 'utf8'), /IRQ fix closed with bench validation/);

    const templateCli = require(path.join(runtimeRoot, 'scripts', 'template.cjs'));
    templateCli.fillCommand('architecture-review', '', { MCU_NAME: 'PMS150G', BOARD_NAME: 'SY_CST021' }, true);
    templateCli.fillCommand('profile', '', { SLUG: 'test-profile' }, true);

    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'ARCH-REVIEW.md')), true);
    assert.match(fs.readFileSync(path.join(tempProject, 'docs', 'ARCH-REVIEW.md'), 'utf8'), /PMS150G/);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'profiles', 'test-profile.yaml')), true);

    const configuredProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-configured-'));
    const initProject = require(path.join(runtimeRoot, 'scripts', 'init-project.cjs'));

    withDefaultWorkflowSourceEnv(() => {
      initProject.main(['--project', configuredProject, '--profile', 'rtos-iot', '--spec', 'connected-appliance']);
    });

    const projectConfigPath = path.join(configuredProject, '.emb-agent', 'project.json');

    process.chdir(configuredProject);
    installedCli.main(['init']);
    const inheritedProjectConfig = JSON.parse(fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8'));
    assert.deepEqual(inheritedProjectConfig.developer, { name: 'welkon', runtime: 'codex' });
    installedCli.main(['project', 'set', '--field', 'preferences.truth_source_mode', '--value', 'code_first']);
    installedCli.main(['project', 'set', '--field', 'preferences.plan_mode', '--value', 'always']);
    const configuredStatus = installedCli.buildStatus();
    assert.equal(configuredStatus.project_profile, 'rtos-iot');
    assert.deepEqual(configuredStatus.active_specs, ['connected-appliance']);
    assert.equal(configuredStatus.preferences.truth_source_mode, 'code_first');
    assert.deepEqual(configuredStatus.project_defaults.arch_review.trigger_patterns, []);
    const configuredProjectView = installedCli.buildProjectShow(true);
    assert.equal(configuredProjectView.config.project_profile, 'rtos-iot');
    assert.equal(configuredProjectView.effective.project_profile, 'rtos-iot');
    assert.ok(Array.isArray(configuredProjectView.effective.arch_review_triggers));
    const configuredProjectField = installedCli.buildProjectShow(true, 'effective.arch_review_triggers');
    assert.equal(configuredProjectField.field, 'effective.arch_review_triggers');
    assert.ok(Array.isArray(configuredProjectField.value));

    installedCli.main([
      'project',
      'set',
      '--field',
      'arch_review.trigger_patterns',
      '--value',
      '["custom arch gate"]'
    ]);
    installedCli.main(['focus', 'set', 'custom arch gate for board split']);
    const configuredArchNext = installedCli.buildNextContext();
    assert.match(configuredArchNext.current.focus, /custom arch gate/i);
    assert.deepEqual(installedCli.buildStatus().arch_review_triggers, ['custom arch gate']);
    assert.deepEqual(installedCli.buildProjectShow(true).effective.arch_review_triggers, ['custom arch gate']);
    assert.deepEqual(
      installedCli.buildProjectShow(true, 'effective.arch_review_triggers').value,
      ['custom arch gate']
    );

    installedCli.main(['prefs', 'set', 'truth_source_mode', 'hardware_first']);
    installedCli.main(['prefs', 'reset']);
    const resetPrefs = installedCli.loadSession().preferences;
    assert.equal(resetPrefs.truth_source_mode, 'code_first');
    assert.equal(resetPrefs.plan_mode, 'always');

    const localProfileProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-local-profile-'));
    const localProfileDir = path.join(localProfileProject, '.emb-agent', 'profiles');
    fs.mkdirSync(localProfileDir, { recursive: true });
    fs.writeFileSync(
      path.join(localProfileDir, 'project-local.yaml'),
      [
        'name: project-local',
        'runtime_model: main_loop_plus_isr',
        'concurrency_model: interrupt_shared_state',
        'resource_priority:',
        '  - rom',
        'search_priority:',
        '  - hardware_truth',
        'guardrails:',
        '  - thin_isr',
        'review_axes:',
        '  - timing_path',
        'notes_targets:',
        '  - docs/HARDWARE-LOGIC.md',
        'default_agents:',
        '  - hw-scout',
        ''
      ].join('\n'),
      'utf8'
    );

    process.chdir(localProfileProject);
    installedCli.main(['init']);
    installedCli.main(['profile', 'set', 'project-local']);
    const localProfileStatus = installedCli.buildStatus();
    assert.equal(localProfileStatus.project_profile, 'project-local');
    const blockedDoBeforeTask = await captureCliJson(installedCli, ['do']);
    assert.equal(blockedDoBeforeTask.action_card.status, 'blocked-by-task-intake');
    assert.match(blockedDoBeforeTask.action_card.first_cli, /task add <summary>/);
    assert.match(blockedDoBeforeTask.action_card.then_cli, /task activate <name>/);
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('installer can preinstall project skill bundles during local setup', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-skill-install-project-'));
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-skill-install-bundle-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    writeFile(
      path.join(bundleDir, '.emb-agent-plugin', 'plugin.json'),
      JSON.stringify(
        {
          name: 'scope-ops-kit',
          version: '0.1.0',
          description: 'Scope operation skills.',
          skills: './skills'
        },
        null,
        2
      ) + '\n'
    );
    writeFile(
      path.join(bundleDir, 'skills', 'scope-connect', 'SKILL.md'),
      [
        '---',
        'name: scope-connect',
        'description: Connect to the configured oscilloscope.',
        'execution_mode: command',
        'command:',
        '  - node',
        '  - scripts/connect.cjs',
        '---',
        '',
        '# scope-connect',
        '',
        'Connect to the scope and report the status.',
        ''
      ].join('\n')
    );
    writeFile(
      path.join(bundleDir, 'skills', 'scope-connect', 'scripts', 'connect.cjs'),
      [
        "'use strict';",
        '',
        "process.stdout.write(JSON.stringify({ status: 'ok', connected: true }) + '\\n');",
        ''
      ].join('\n')
    );

    process.chdir(tempProject);
    await installer.main([
      '--codex',
      '--local',
      '--developer',
      'welkon',
      '--skill-source',
      bundleDir
    ]);

    const installedCli = require(path.join(tempProject, '.codex', 'emb-agent', 'bin', 'emb-agent.cjs'));
    const listed = await captureCliJson(installedCli, ['skills', 'list']);
    const runResult = await captureCliJson(installedCli, ['skills', 'run', 'scope-connect']);
    const codexEntryPath = path.join(tempProject, '.codex', 'skills', 'scope-connect', 'SKILL.md');
    const sharedEntryPath = path.join(tempProject, '.agents', 'skills', 'scope-connect', 'SKILL.md');

    assert.ok(listed.some(item => item.name === 'scope-connect' && item.plugin && item.plugin.name === 'scope-ops-kit'));
    assert.equal(runResult.execution.mode, 'command');
    assert.equal(runResult.command_result.status, 'ok');
    assert.equal(runResult.command_result.parsed_output.connected, true);
    assert.equal(fs.existsSync(codexEntryPath), false);
    assert.equal(fs.existsSync(sharedEntryPath), true);
    assert.match(fs.readFileSync(sharedEntryPath, 'utf8'), /shared skill entry routes matching requests/);
    assert.match(stdout, /Installed skill bundle: scope-ops-kit/);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(currentCwd);
  }
});

test('installer only installs selected skills from a bundle during local setup', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-skill-select-project-'));
  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-skill-select-bundle-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    writeFile(
      path.join(bundleDir, '.emb-agent-plugin', 'plugin.json'),
      JSON.stringify(
        {
          name: 'scope-ops-kit',
          version: '0.2.0',
          description: 'Scope operation skills.',
          skills: './skills'
        },
        null,
        2
      ) + '\n'
    );
    writeFile(
      path.join(bundleDir, 'skills', 'scope-connect', 'SKILL.md'),
      [
        '---',
        'name: scope-connect',
        'description: Connect to the configured oscilloscope.',
        'execution_mode: command',
        'command:',
        '  - node',
        '  - scripts/connect.cjs',
        '---',
        '',
        '# scope-connect',
        '',
        'Connect to the scope and report the status.',
        ''
      ].join('\n')
    );
    writeFile(
      path.join(bundleDir, 'skills', 'scope-connect', 'scripts', 'connect.cjs'),
      [
        "'use strict';",
        '',
        "process.stdout.write(JSON.stringify({ status: 'ok', connected: true }) + '\\n');",
        ''
      ].join('\n')
    );
    writeFile(
      path.join(bundleDir, 'skills', 'scope-capture', 'SKILL.md'),
      [
        '---',
        'name: scope-capture',
        'description: Capture a waveform.',
        'execution_mode: command',
        'command:',
        '  - node',
        '  - scripts/capture.cjs',
        '---',
        '',
        '# scope-capture',
        '',
        'Capture the active waveform and return the status.',
        ''
      ].join('\n')
    );
    writeFile(
      path.join(bundleDir, 'skills', 'scope-capture', 'scripts', 'capture.cjs'),
      [
        "'use strict';",
        '',
        "process.stdout.write(JSON.stringify({ status: 'ok', captured: true }) + '\\n');",
        ''
      ].join('\n')
    );

    process.chdir(tempProject);
    await installer.main([
      '--codex',
      '--local',
      '--developer',
      'welkon',
      '--skill-source',
      bundleDir,
      '--skill',
      'scope-capture'
    ]);

    const installedCli = require(path.join(tempProject, '.codex', 'emb-agent', 'bin', 'emb-agent.cjs'));
    const listed = await captureCliJson(installedCli, ['skills', 'list']);
    const listedAll = await captureCliJson(installedCli, ['skills', 'list', '--all']);
    const runResult = await captureCliJson(installedCli, ['skills', 'run', 'scope-capture']);
    const selectedEntryPath = path.join(tempProject, '.agents', 'skills', 'scope-capture', 'SKILL.md');
    const unselectedEntryPath = path.join(tempProject, '.agents', 'skills', 'scope-connect', 'SKILL.md');
    const selectedPayloadPath = path.join(
      tempProject,
      '.emb-agent',
      'plugins',
      'scope-ops-kit',
      'payload',
      'skills',
      'scope-capture',
      'SKILL.md'
    );
    const unselectedPayloadPath = path.join(
      tempProject,
      '.emb-agent',
      'plugins',
      'scope-ops-kit',
      'payload',
      'skills',
      'scope-connect',
      'SKILL.md'
    );

    assert.ok(listed.some(item => item.name === 'scope-capture' && item.plugin && item.plugin.name === 'scope-ops-kit'));
    assert.ok(!listed.some(item => item.name === 'scope-connect'));
    assert.ok(!listedAll.some(item => item.name === 'scope-connect'));
    assert.equal(runResult.execution.mode, 'command');
    assert.equal(runResult.command_result.status, 'ok');
    assert.equal(runResult.command_result.parsed_output.captured, true);
    assert.equal(fs.existsSync(selectedEntryPath), true);
    assert.equal(fs.existsSync(unselectedEntryPath), false);
    assert.equal(fs.existsSync(selectedPayloadPath), true);
    assert.equal(fs.existsSync(unselectedPayloadPath), false);
    assert.match(stdout, /Installed skill bundle: scope-ops-kit/);
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(currentCwd);
  }
});

test('installer can preconfigure project specs during local setup', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-spec-install-project-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    process.chdir(tempProject);
    await installer.main([
      '--codex',
      '--local',
      '--developer',
      'welkon',
      '--registry',
      workflowSourceRoot,
      '--registry-subdir',
      'specs',
      '--spec',
      'connected-appliance'
    ]);

    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'project.json'), 'utf8')
    );
    const projectRegistry = JSON.parse(
      fs.readFileSync(path.join(tempProject, '.emb-agent', 'registry', 'workflow.json'), 'utf8')
    );
    const installedCli = require(path.join(tempProject, '.codex', 'emb-agent', 'bin', 'emb-agent.cjs'));
    const status = installedCli.buildStatus();

    assert.deepEqual(projectConfig.active_specs, ['connected-appliance']);
    assert.deepEqual(status.active_specs, ['connected-appliance']);
    assert.ok(projectRegistry.specs.some(item => item.name === 'connected-appliance'));
    assert.ok(projectRegistry.specs.some(item => item.name === 'iot-device-focus'));
    assert.ok(!projectRegistry.specs.some(item => item.name === 'rtos-iot-focus'));
    assert.ok(!projectRegistry.specs.some(item => item.name === 'sensor-node'));
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'connected-appliance-focus.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'iot-device-focus.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'rtos-iot-focus.md')),
      false
    );
    assert.equal(
      fs.existsSync(path.join(tempProject, '.emb-agent', 'specs', 'sensor-node-focus.md')),
      false
    );
    assert.match(stdout, /Bootstrapped emb-agent project in:/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('installer workflow profile includes scaffold assets', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-home-workflow-'));
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await installer.main([
      '--codex',
      '--global',
      '--config-dir',
      tempHome,
      '--developer',
      'welkon',
      '--profile',
      'workflow'
    ]);

    const runtimeRoot = path.join(tempHome, 'emb-agent');
    const hostMetadata = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'HOST.json'), 'utf8'));

    assert.equal(fs.existsSync(path.join(runtimeRoot, 'scaffolds', 'registry.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'state', 'default-session.json')), true);
    assert.equal(hostMetadata.install_profile, 'workflow');
    assert.match(stdout, /Install profile: workflow/);
    assert.doesNotMatch(stdout, /Advanced scaffold assets were skipped in core profile/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('installer rejects removed full install profile alias', async () => {
  await assert.rejects(
    () => installer.main(['--codex', '--global', '--config-dir', '/tmp/emb-agent-full', '--developer', 'welkon', '--profile', 'full']),
    /Unsupported install profile: full/
  );
});

test('installer rejects declared but unsupported runtime targets', () => {
  return assert.rejects(
    () => installer.main(['--runtime', 'windsurf', '--global', '--config-dir', '/tmp/emb-agent-windsurf', '--developer', 'welkon']),
    /Runtime target "windsurf" is not supported yet/
  );
});

test('installer lays down claude agents and settings hooks', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-claude-home-'));
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await installer.main(['--claude', '--global', '--config-dir', tempHome, '--developer', 'felix']);

    const runtimeRoot = path.join(tempHome, 'emb-agent');
    const settingsPath = path.join(tempHome, 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const runtimeHost = require(path.join(runtimeRoot, 'lib', 'runtime-host.cjs'));
    const resolvedHost = runtimeHost.resolveRuntimeHost(runtimeRoot);
    const hostMetadata = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'HOST.json'), 'utf8'));

    assert.equal(fs.existsSync(path.join(tempHome, 'agents', 'emb-arch-reviewer.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'commands', 'emb', 'start.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'commands', 'emb', 'init.md')), false);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'hooks', 'emb-context-monitor.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'hooks', 'emb-session-start.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'hooks', 'emb-statusline.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'HOST.json')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'config.toml')), false);
    assert.deepEqual(settings.statusLine, {
      type: 'command',
      command: `node "${path.join(tempHome, 'emb-agent', 'hooks', 'emb-statusline.js').replace(/\\/g, '/')}"`
    });
    assert.ok(Array.isArray(settings.hooks.SessionStart));
    assert.ok(Array.isArray(settings.hooks.PostToolUse));
    assert.match(JSON.stringify(settings.hooks.SessionStart), /emb-session-start\.js/);
    assert.match(JSON.stringify(settings.hooks.PostToolUse), /emb-context-monitor\.js/);
    assert.match(
      fs.readFileSync(path.join(tempHome, 'commands', 'emb', 'start.md'), 'utf8'),
      /When this command matches the user intent, run `node .*emb-agent\/bin\/emb-agent\.cjs start`/
    );
    const sessionFlowContent = fs.readFileSync(path.join(runtimeRoot, 'lib', 'session-flow.cjs'), 'utf8');
    assert.doesNotMatch(sessionFlowContent, /~\/\.codex\/emb-agent\/bin\/emb-agent\.cjs/);
    assert.doesNotMatch(sessionFlowContent, /~\/\.claude\/emb-agent\/bin\/emb-agent\.cjs/);
    assert.equal(hostMetadata.name, 'claude');
    assert.equal(hostMetadata.subagent_bridge, undefined);
    assert.equal(resolvedHost.name, 'claude');
    assert.equal(resolvedHost.stateRoot, path.join(tempHome, 'state', 'emb-agent'));
    assert.match(resolvedHost.cliCommand, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.equal(resolvedHost.subagentBridge.available, false);
    assert.equal(resolvedHost.subagentBridge.mode, 'disabled');
    assert.equal(resolvedHost.subagentBridge.source, 'none');
    assert.match(stdout, /Installed 13 Claude commands under:/);
    assert.match(stdout, /Updated Claude Code config:/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('installer defaults Claude to project-scoped .claude layout', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-claude-local-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    process.chdir(tempProject);
    await installer.main(['--claude', '--developer', 'felix']);

    const claudeRoot = path.join(tempProject, '.claude');

    assert.equal(fs.existsSync(path.join(claudeRoot, 'emb-agent', 'bin', 'emb-agent.cjs')), true);
    assert.equal(fs.existsSync(path.join(claudeRoot, 'agents', 'emb-arch-reviewer.md')), true);
    assert.equal(fs.existsSync(path.join(claudeRoot, 'commands', 'emb', 'start.md')), true);
    assert.equal(fs.existsSync(path.join(claudeRoot, 'commands', 'emb', 'init.md')), false);
    assert.equal(fs.existsSync(path.join(claudeRoot, 'settings.json')), true);
    const settings = JSON.parse(fs.readFileSync(path.join(claudeRoot, 'settings.json'), 'utf8'));
    assert.deepEqual(settings.statusLine, {
      type: 'command',
      command: 'node ".claude/emb-agent/hooks/emb-statusline.js"'
    });
    assert.match(stdout, /Installed 13 Claude commands under:/);
    assert.match(stdout, /\.claude\/commands\/emb/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('installer lays down cursor commands and settings hooks', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-cursor-home-'));
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await installer.main(['--cursor', '--global', '--config-dir', tempHome, '--developer', 'felix']);

    const runtimeRoot = path.join(tempHome, 'emb-agent');
    const settingsPath = path.join(tempHome, 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const runtimeHost = require(path.join(runtimeRoot, 'lib', 'runtime-host.cjs'));
    const resolvedHost = runtimeHost.resolveRuntimeHost(runtimeRoot);
    const hostMetadata = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'HOST.json'), 'utf8'));

    assert.equal(fs.existsSync(path.join(tempHome, 'agents', 'emb-arch-reviewer.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'commands', 'emb-start.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'commands', 'emb-init.md')), false);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'hooks', 'emb-context-monitor.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'hooks', 'emb-session-start.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'HOST.json')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'config.toml')), false);
    assert.ok(Array.isArray(settings.hooks.SessionStart));
    assert.ok(Array.isArray(settings.hooks.PostToolUse));
    assert.match(JSON.stringify(settings.hooks.SessionStart), /emb-session-start\.js/);
    assert.match(JSON.stringify(settings.hooks.PostToolUse), /emb-context-monitor\.js/);
    assert.match(
      fs.readFileSync(path.join(tempHome, 'commands', 'emb-start.md'), 'utf8'),
      /When this command matches the user intent, run `node .*emb-agent\/bin\/emb-agent\.cjs start`/
    );
    assert.equal(hostMetadata.name, 'cursor');
    assert.equal(hostMetadata.subagent_bridge, undefined);
    assert.equal(resolvedHost.name, 'cursor');
    assert.equal(resolvedHost.stateRoot, path.join(tempHome, 'state', 'emb-agent'));
    assert.match(resolvedHost.cliCommand, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.equal(resolvedHost.subagentBridge.available, false);
    assert.equal(resolvedHost.subagentBridge.mode, 'disabled');
    assert.equal(resolvedHost.subagentBridge.source, 'none');
    assert.match(stdout, /Installed 13 Cursor commands under:/);
    assert.match(stdout, /Updated Cursor config:/);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('installer defaults Cursor to project-scoped .cursor layout', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-cursor-local-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    process.chdir(tempProject);
    await installer.main(['--cursor', '--developer', 'felix']);

    const cursorRoot = path.join(tempProject, '.cursor');

    assert.equal(fs.existsSync(path.join(cursorRoot, 'emb-agent', 'bin', 'emb-agent.cjs')), true);
    assert.equal(fs.existsSync(path.join(cursorRoot, 'agents', 'emb-arch-reviewer.md')), true);
    assert.equal(fs.existsSync(path.join(cursorRoot, 'commands', 'emb-start.md')), true);
    assert.equal(fs.existsSync(path.join(cursorRoot, 'commands', 'emb-init.md')), false);
    assert.equal(fs.existsSync(path.join(cursorRoot, 'settings.json')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'project.json')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'hw.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'req.yaml')), true);
    assert.match(stdout, /Installed 13 Cursor commands under:/);
    assert.match(stdout, /\.cursor\/commands/);
    assert.match(stdout, /Bootstrapped emb-agent project in:/);
    assert.match(stdout, /open a Cursor session\. emb-agent will inject the startup context automatically\./);
    assert.match(stdout, /recommended next command from the injected startup context/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('installer defaults Codex to project-scoped .codex layout with local state paths', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-codex-local-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    process.chdir(tempProject);
    await installer.main(['--developer', 'felix']);

    const codexRoot = path.join(tempProject, '.codex');
    const runtimeRoot = path.join(codexRoot, 'emb-agent');
    const configData = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'config.json'), 'utf8'));
    const installedCli = require(path.join(runtimeRoot, 'bin', 'emb-agent.cjs'));

    assert.equal(fs.existsSync(path.join(codexRoot, 'skills', 'emb-start', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(codexRoot, 'skills', 'emb-init', 'SKILL.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.agents', 'skills', 'emb-start', 'SKILL.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.agents', 'skills', 'emb-init', 'SKILL.md')), false);
    assert.match(
      fs.readFileSync(path.join(codexRoot, 'config.toml'), 'utf8'),
      /project_doc_fallback_filenames = \["AGENTS\.md"\]/
    );
    assert.match(
      fs.readFileSync(path.join(codexRoot, 'hooks.json'), 'utf8'),
      /Loading emb-agent context/
    );
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'project.json')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'hw.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'req.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'tasks', '00-bootstrap-project', 'task.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'state', 'default-session.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'state', 'projects')), true);
    assert.equal(configData.project_state_dir, 'state/projects');
    assert.equal(configData.legacy_project_state_dir, 'state/projects');

    installedCli.main(['start']);
    assert.match(stdout, /Installed 13 Codex skills under:/);
    assert.match(stdout, /\.codex\/skills/);
    assert.doesNotMatch(stdout, /Installed 13 shared skills under:/);
    assert.match(stdout, /Bootstrapped emb-agent project in:/);
    assert.match(stdout, /Bootstrap task:/);
    assert.match(stdout, /open a Codex session\. emb-agent will inject the startup context automatically\./);
    assert.match(stdout, /"entry": "start"/);
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('installer uninstall removes local Codex managed surfaces and preserves user config', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-codex-uninstall-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';
    process.chdir(tempProject);
    fs.mkdirSync(path.join(tempProject, '.codex'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, '.codex', 'config.toml'), 'model = "gpt-5"\n', 'utf8');
    fs.writeFileSync(
      path.join(tempProject, '.codex', 'hooks.json'),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: 'node "/tmp/custom-session-start.js"'
                  }
                ]
              }
            ],
            PostToolUse: [
              {
                matcher: 'Write',
                hooks: [
                  {
                    type: 'command',
                    command: 'node "/tmp/custom-post-tool.js"'
                  }
                ]
              }
            ]
          }
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    await installer.main(['--developer', 'felix']);

    assert.equal(fs.existsSync(path.join(tempProject, '.codex', 'emb-agent')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.codex', 'skills', 'emb-start', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.agents', 'skills', 'emb-start', 'SKILL.md')), false);

    await installer.main(['--uninstall']);

    assert.equal(fs.existsSync(path.join(tempProject, '.codex', 'emb-agent')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.codex', 'skills')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.agents')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'project.json')), true);

    const preservedConfig = fs.readFileSync(path.join(tempProject, '.codex', 'config.toml'), 'utf8');
    const preservedHooks = JSON.parse(fs.readFileSync(path.join(tempProject, '.codex', 'hooks.json'), 'utf8'));

    assert.match(preservedConfig, /^model = "gpt-5"$/m);
    assert.doesNotMatch(preservedConfig, /project_doc_fallback_filenames/);
    assert.doesNotMatch(preservedConfig, /\[agents\./);
    assert.match(JSON.stringify(preservedHooks), /custom-session-start\.js/);
    assert.match(JSON.stringify(preservedHooks), /custom-post-tool\.js/);
    assert.doesNotMatch(JSON.stringify(preservedHooks), /emb-session-start\.js/);
    assert.doesNotMatch(JSON.stringify(preservedHooks), /emb-context-monitor\.js/);
    assert.match(stdout, /Uninstalled emb-agent managed files for Codex from:/);
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('installer uninstall removes local Claude managed surfaces and preserves user files', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-claude-uninstall-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    process.chdir(tempProject);
    fs.mkdirSync(path.join(tempProject, '.claude', 'commands', 'emb'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.claude', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, '.claude', 'commands', 'emb', 'team-notes.md'), '# custom\n', 'utf8');
    fs.writeFileSync(path.join(tempProject, '.claude', 'agents', 'custom-helper.md'), '# custom helper\n', 'utf8');
    fs.writeFileSync(
      path.join(tempProject, '.claude', 'settings.json'),
      JSON.stringify(
        {
          statusLine: {
            type: 'command',
            command: 'node "/tmp/custom-statusline.js"'
          },
          hooks: {
            SessionStart: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: 'node "/tmp/custom-session-start.js"'
                  }
                ]
              }
            ],
            PostToolUse: [
              {
                matcher: 'Write',
                hooks: [
                  {
                    type: 'command',
                    command: 'node "/tmp/custom-post-tool.js"'
                  }
                ]
              }
            ]
          }
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    await installer.main(['--claude', '--developer', 'felix']);

    assert.equal(fs.existsSync(path.join(tempProject, '.claude', 'emb-agent')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.claude', 'commands', 'emb', 'start.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.claude', 'agents', 'emb-arch-reviewer.md')), true);

    await installer.main(['--claude', '--uninstall']);

    assert.equal(fs.existsSync(path.join(tempProject, '.claude', 'emb-agent')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.claude', 'commands', 'emb', 'start.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.claude', 'agents', 'emb-arch-reviewer.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.claude', 'commands', 'emb', 'team-notes.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.claude', 'agents', 'custom-helper.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'project.json')), true);

    const preservedSettings = JSON.parse(fs.readFileSync(path.join(tempProject, '.claude', 'settings.json'), 'utf8'));

    assert.equal(preservedSettings.statusLine.command, 'node "/tmp/custom-statusline.js"');
    assert.match(JSON.stringify(preservedSettings), /custom-session-start\.js/);
    assert.match(JSON.stringify(preservedSettings), /custom-post-tool\.js/);
    assert.doesNotMatch(JSON.stringify(preservedSettings), /emb-session-start\.js/);
    assert.doesNotMatch(JSON.stringify(preservedSettings), /emb-context-monitor\.js/);
    assert.doesNotMatch(JSON.stringify(preservedSettings), /emb-statusline\.js/);
    assert.match(stdout, /Uninstalled emb-agent managed files for Claude Code from:/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('installer uninstall removes local Cursor managed surfaces and preserves user files', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-cursor-uninstall-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    process.chdir(tempProject);
    fs.mkdirSync(path.join(tempProject, '.cursor', 'commands'), { recursive: true });
    fs.mkdirSync(path.join(tempProject, '.cursor', 'agents'), { recursive: true });
    fs.writeFileSync(path.join(tempProject, '.cursor', 'commands', 'team-notes.md'), '# custom\n', 'utf8');
    fs.writeFileSync(path.join(tempProject, '.cursor', 'agents', 'custom-helper.md'), '# custom helper\n', 'utf8');
    fs.writeFileSync(
      path.join(tempProject, '.cursor', 'settings.json'),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                command: 'node "/tmp/custom-session-start.js"'
              }
            ],
            PostToolUse: [
              {
                matcher: 'Write',
                command: 'node "/tmp/custom-post-tool.js"',
                timeout: 5
              }
            ]
          }
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    await installer.main(['--cursor', '--developer', 'felix']);

    assert.equal(fs.existsSync(path.join(tempProject, '.cursor', 'emb-agent')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.cursor', 'commands', 'emb-start.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.cursor', 'agents', 'emb-arch-reviewer.md')), true);

    await installer.main(['--cursor', '--uninstall']);

    assert.equal(fs.existsSync(path.join(tempProject, '.cursor', 'emb-agent')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.cursor', 'commands', 'emb-start.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.cursor', 'agents', 'emb-arch-reviewer.md')), false);
    assert.equal(fs.existsSync(path.join(tempProject, '.cursor', 'commands', 'team-notes.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.cursor', 'agents', 'custom-helper.md')), true);
    assert.equal(fs.existsSync(path.join(tempProject, '.emb-agent', 'project.json')), true);

    const preservedSettings = JSON.parse(fs.readFileSync(path.join(tempProject, '.cursor', 'settings.json'), 'utf8'));

    assert.match(JSON.stringify(preservedSettings), /custom-session-start\.js/);
    assert.match(JSON.stringify(preservedSettings), /custom-post-tool\.js/);
    assert.doesNotMatch(JSON.stringify(preservedSettings), /emb-session-start\.js/);
    assert.doesNotMatch(JSON.stringify(preservedSettings), /emb-context-monitor\.js/);
    assert.match(stdout, /Uninstalled emb-agent managed files for Cursor from:/);
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
