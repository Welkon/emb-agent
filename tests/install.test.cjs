'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const installer = require(path.join(repoRoot, 'bin', 'install.js'));

test('installer lays down config/lib and runtime commands work', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-home-'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-proj-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    process.chdir(repoRoot);
    await installer.main(['--codex', '--global', '--config-dir', tempHome]);

    const runtimeRoot = path.join(tempHome, 'emb-agent');
    const cliPath = path.join(runtimeRoot, 'bin', 'emb-agent.cjs');
    const installedCli = require(cliPath);

    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-arch-review', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-adapter', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-dispatch', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-orchestrate', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-tool', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-thread', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-forensics', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-settings', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-session-report', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-manager', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'agents', 'emb-arch-reviewer.toml')), true);
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
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'VERSION')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'tools', 'registry.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'chips', 'registry.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'adapters')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'extensions')), false);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'lib', 'scheduler.cjs')), true);
    assert.equal(fs.existsSync(cliPath), true);
    assert.equal(fs.existsSync(path.join(tempHome, '.env.example')), true);
    assert.match(fs.readFileSync(path.join(tempHome, '.env.example'), 'utf8'), /MINERU_API_KEY=/);
    const codexConfig = fs.readFileSync(path.join(tempHome, 'config.toml'), 'utf8');
    assert.match(codexConfig, /\[features\][\s\S]*codex_hooks = true/);
    assert.match(codexConfig, /\[\[hooks\]\]\s*[\r\n]+event = "SessionStart"/);
    assert.match(codexConfig, /emb-session-start\.js/);
    assert.match(codexConfig, /\[\[hooks\]\]\s*[\r\n]+event = "PostToolUse"/);
    assert.match(codexConfig, /emb-context-monitor\.js/);
    assert.doesNotMatch(fs.readFileSync(path.join(runtimeRoot, 'hooks', 'emb-session-start.js'), 'utf8'), /\{\{EMB_VERSION\}\}/);
    assert.match(stdout, /Created env example:/);
    assert.match(stdout, /Tip: create .*\.env from \.env\.example/);
    assert.match(stdout, /Tip: set MINERU_API_KEY/);

    process.chdir(tempProject);
    installedCli.main(['init']);

    const sessionPath = path.join(tempHome, 'state', 'emb-agent', 'projects');
    assert.equal(fs.existsSync(sessionPath), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'docs')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'emb-agent', 'project.json')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'emb-agent', 'hw.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'emb-agent', 'req.yaml')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'emb-agent', 'cache', 'adapter-sources')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'emb-agent', 'adapters')), true);
    assert.equal(fs.existsSync(path.join(tempProject, 'emb-agent', 'extensions')), false);

    const configData = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'config.json'), 'utf8'));
    const hostMetadata = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'HOST.json'), 'utf8'));
    const runtimeHost = require(path.join(runtimeRoot, 'lib', 'runtime-host.cjs'));
    const resolvedHost = runtimeHost.resolveRuntimeHost(runtimeRoot);
    assert.equal(configData.session_version, 1);
    assert.equal(configData.default_preferences.truth_source_mode, 'hardware_first');
    assert.equal(hostMetadata.name, 'codex');
    assert.equal(resolvedHost.name, 'codex');
    assert.equal(resolvedHost.stateRoot, path.join(tempHome, 'state', 'emb-agent'));
    assert.match(resolvedHost.cliCommand, /emb-agent\/bin\/emb-agent\.cjs$/);

    const nextBeforeContext = installedCli.buildNextContext();
    assert.equal(nextBeforeContext.next.command, 'health');
    assert.equal(nextBeforeContext.next.gated_by_health, true);
    assert.ok(Array.isArray(nextBeforeContext.next.health_next_commands));
    assert.ok(nextBeforeContext.next.health_next_commands.some(item => item.cli.includes('adapter source add default-pack')));
    const orchestratorBeforeContext = installedCli.buildOrchestratorContext('next');
    assert.equal(orchestratorBeforeContext.workflow.strategy, 'inline');
    assert.equal(orchestratorBeforeContext.resolved_action, 'health');
    assert.equal(orchestratorBeforeContext.workflow.next_skill, '$emb-health');

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
    assert.equal(plan.agent_execution.primary_agent, 'emb-hw-scout');
    assert.equal(plan.agent_execution.mode, 'primary-recommended');
    assert.ok(plan.steps.some(item => item.includes('最小 scan')));
    assert.equal(scan.scheduler.primary_agent, 'hw-scout');
    assert.equal(scan.agent_execution.primary_agent, 'emb-hw-scout');
    assert.ok(scan.next_reads.some(item => item.includes('硬件真值来源')));
    assert.equal(resume.summary.resume_source, 'handoff');
    assert.ok(resume.next_actions.some(item => item.includes('handoff')));
    assert.ok(resume.next_actions.some(item => item.includes('建议命令')));
    assert.equal(nextAfterPause.next.command, 'scan');
    assert.ok(nextAfterPause.handoff.next_action.includes('resume irq race first'));

    fs.writeFileSync(path.join(tempProject, 'main.c'), 'void main(void) {}\n', 'utf8');
    installedCli.main(['last-files', 'add', 'main.c']);
    installedCli.main(['prefs', 'set', 'truth_source_mode', 'code_first']);
    const codeFirstPlan = installedCli.buildActionOutput('plan');
    assert.equal(codeFirstPlan.truth_sources[0], '当前最相关文件: main.c');

    installedCli.main(['prefs', 'set', 'verification_mode', 'strict']);
    const strictPlan = installedCli.buildActionOutput('plan');
    assert.ok(strictPlan.verification.some(item => item.includes('失败路径')));

    installedCli.main(['risk', 'add', 'irq race']);
    const nextWithRisk = installedCli.buildNextContext();
    assert.equal(nextWithRisk.next.command, 'plan');

    installedCli.main(['question', 'add', 'why irq misses']);
    const nextWithQuestion = installedCli.buildNextContext();
    assert.equal(nextWithQuestion.next.command, 'debug');

    installedCli.main(['question', 'clear']);
    installedCli.main(['risk', 'clear']);
    installedCli.main(['prefs', 'reset']);
    installedCli.main(['focus', 'set', '芯片选型与PoC转量产预审']);
    const nextWithArchReview = installedCli.buildNextContext();
    assert.equal(nextWithArchReview.next.command, 'arch-review');
    assert.equal(nextWithArchReview.next.skill, '$emb-arch-review');
    assert.match(nextWithArchReview.next.cli, /arch-review$/);
    const archReviewContext = installedCli.buildArchReviewContext();
    assert.equal(archReviewContext.suggested_agent, 'emb-arch-reviewer');
    assert.equal(archReviewContext.recommended_template.name, 'architecture-review');
    assert.ok(archReviewContext.trigger_patterns.includes('芯片选型'));
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
    assert.equal(timerResult.status, 'adapter-required');
    const pwmResult = installedCli.toolRuntime.runTool(runtimeRoot, 'pwm-calc', [
      '--family',
      'vendor-family',
      '--target-hz',
      '3906.25',
      '--target-duty',
      '50'
    ]);
    assert.equal(pwmResult.status, 'adapter-required');
    installedCli.main(['focus', 'set', 'review ota rollback path']);
    installedCli.main(['prefs', 'set', 'review_mode', 'always']);
    installedCli.main(['profile', 'set', 'rtos-iot']);
    const nextWithForcedReview = installedCli.buildNextContext();
    assert.equal(nextWithForcedReview.next.command, 'review');

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

    const templateCli = require(path.join(runtimeRoot, 'scripts', 'template.cjs'));
    templateCli.fillCommand('architecture-review', '', { MCU_NAME: 'PMS150G', BOARD_NAME: 'SY_CST021' }, true);
    templateCli.fillCommand('profile', '', { SLUG: 'test-profile' }, true);

    assert.equal(fs.existsSync(path.join(tempProject, 'docs', 'ARCH-REVIEW.md')), true);
    assert.match(fs.readFileSync(path.join(tempProject, 'docs', 'ARCH-REVIEW.md'), 'utf8'), /PMS150G/);
    assert.equal(fs.existsSync(path.join(tempProject, 'emb-agent', 'profiles', 'test-profile.yaml')), true);

    const configuredProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-configured-'));
    const initProject = require(path.join(runtimeRoot, 'scripts', 'init-project.cjs'));

    initProject.main(['--project', configuredProject, '--profile', 'rtos-iot', '--pack', 'connected-appliance']);

    const projectConfigPath = path.join(configuredProject, 'emb-agent', 'project.json');

    process.chdir(configuredProject);
    installedCli.main(['init']);
    installedCli.main(['project', 'set', '--field', 'preferences.truth_source_mode', '--value', 'code_first']);
    installedCli.main(['project', 'set', '--field', 'preferences.plan_mode', '--value', 'always']);
    const configuredStatus = installedCli.buildStatus();
    assert.equal(configuredStatus.project_profile, 'rtos-iot');
    assert.deepEqual(configuredStatus.active_packs, ['connected-appliance']);
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
    assert.equal(configuredArchNext.next.command, 'arch-review');
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
    const localProfileDir = path.join(localProfileProject, 'emb-agent', 'profiles');
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
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});

test('installer rejects declared but unsupported runtime targets', () => {
  return assert.rejects(
    () => installer.main(['--runtime', 'cursor', '--global', '--config-dir', '/tmp/emb-agent-cursor']),
    /Runtime target "cursor" is not supported yet/
  );
});

test('installer lays down claude skills agents and settings hooks', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-claude-home-'));
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await installer.main(['--claude', '--global', '--config-dir', tempHome]);

    const runtimeRoot = path.join(tempHome, 'emb-agent');
    const settingsPath = path.join(tempHome, 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const runtimeHost = require(path.join(runtimeRoot, 'lib', 'runtime-host.cjs'));
    const resolvedHost = runtimeHost.resolveRuntimeHost(runtimeRoot);
    const hostMetadata = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'HOST.json'), 'utf8'));

    assert.equal(fs.existsSync(path.join(tempHome, 'skills', 'emb-help', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'agents', 'emb-arch-reviewer.md')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'hooks', 'emb-context-monitor.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'hooks', 'emb-session-start.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'HOST.json')), true);
    assert.equal(fs.existsSync(path.join(tempHome, 'config.toml')), false);
    assert.ok(Array.isArray(settings.hooks.SessionStart));
    assert.ok(Array.isArray(settings.hooks.PostToolUse));
    assert.match(JSON.stringify(settings.hooks.SessionStart), /emb-session-start\.js/);
    assert.match(JSON.stringify(settings.hooks.PostToolUse), /emb-context-monitor\.js/);
    assert.ok(
      fs.readFileSync(path.join(tempHome, 'skills', 'emb-help', 'SKILL.md'), 'utf8').includes(
        `${runtimeRoot.replace(/\\/g, '/')}/bin/emb-agent.cjs`
      )
    );
    const sessionFlowContent = fs.readFileSync(path.join(runtimeRoot, 'lib', 'session-flow.cjs'), 'utf8');
    assert.doesNotMatch(sessionFlowContent, /~\/\.codex\/emb-agent\/bin\/emb-agent\.cjs/);
    assert.doesNotMatch(sessionFlowContent, /~\/\.claude\/emb-agent\/bin\/emb-agent\.cjs/);
    assert.equal(hostMetadata.name, 'claude');
    assert.equal(resolvedHost.name, 'claude');
    assert.equal(resolvedHost.stateRoot, path.join(tempHome, 'state', 'emb-agent'));
    assert.match(resolvedHost.cliCommand, /emb-agent\/bin\/emb-agent\.cjs$/);
    assert.match(stdout, /Updated Claude Code config:/);
  } finally {
    process.stdout.write = originalWrite;
  }
});
