'use strict';

const adapterQualityHelpers = require('./adapter-quality.cjs');
const defaultAdapterSourceHelpers = require('./default-adapter-source.cjs');
const hookTrustHelpers = require('./hook-trust.cjs');
const projectInputIntake = require('./project-input-intake.cjs');
const runtimeHostHelpers = require('./runtime-host.cjs');
const updateCheckHelpers = require('./update-check.cjs');
const workflowRegistry = require('./workflow-registry.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ADAPTER_SOURCE_BOOTSTRAP_CLI =
  `${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['support', 'bootstrap'])}`;
const NEXT_CLI = runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['next']);
const HEALTH_CLI = runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['health']);

function createHealthUpdateCommandHelpers(deps) {
  const {
    fs,
    path,
    process,
    childProcess,
    runtime,
    RUNTIME_CONFIG,
    resolveProjectRoot,
    getProjectExtDir,
    getProjectStatePaths,
    getProjectConfig,
    normalizeSession,
    loadProfile,
    loadSpec,
    findChipProfileByModel,
    resolveSession,
    buildToolExecutionFromRecommendation,
    ingestDocCli,
    attachProjectCli,
    adapterSources,
    rootDir,
    getRuntimeHost,
    updateSession
  } = deps;

  function getDefaultAdapterSource() {
    return defaultAdapterSourceHelpers.resolveDefaultAdapterSource(RUNTIME_CONFIG, process && process.env);
  }

  function buildSupportCli(args) {
    const command = runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, args);
    return command.replace(' emb-agent.cjs adapter ', ' emb-agent.cjs support ');
  }

  function buildDefaultAdapterSourceAddCommand() {
    const source = getDefaultAdapterSource();
    const sourceArgs = defaultAdapterSourceHelpers.buildDefaultAdapterSourceArgs(source);

    return {
      cli: `${buildSupportCli(['support', 'source', 'add', source.name])} ${sourceArgs.join(' ')}`,
      argv: ['support', 'source', 'add', source.name, ...sourceArgs]
    };
  }

  function buildProjectDeriveCommand() {
    return {
      cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['adapter', 'derive', '--from-project']),
      argv: ['adapter', 'derive', '--from-project']
    };
  }

  function findPendingProjectInputIntake(projectRoot, hardwareIdentity) {
    const hardwareReady = Boolean(
      hardwareIdentity &&
      hardwareIdentity.model &&
      hardwareIdentity.package
    );
    if (hardwareReady || !attachProjectCli || typeof attachProjectCli.detectProjectInputs !== 'function') {
      return null;
    }

    const intake = projectInputIntake.buildPendingProjectInputIntake(projectRoot, {
      fs,
      path,
      runtime,
      ingestDocCli,
      detectProjectInputs: attachProjectCli.detectProjectInputs
    });

    if (!intake || !intake.preferred || !intake.preferred.cli) {
      return null;
    }

    return {
      id: 'source-intake',
      type: intake.preferred.type,
      file: intake.preferred.file,
      label: intake.preferred.type === 'schematic'
        ? 'Normalize discovered schematic input'
        : 'Parse discovered hardware document',
      summary: intake.preferred.summary,
      cli: intake.preferred.cli,
      argv: intake.preferred.argv || []
    };
  }

  function normalizeHardwareSlug(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function compactHardwareSlug(value) {
    return normalizeHardwareSlug(value).replace(/-/g, '');
  }

  function findProjectLocalChipSupport(model, packageName) {
    const normalizedModel = String(model || '').trim();
    const normalizedPackage = String(packageName || '').trim();
    if (!normalizedModel) {
      return null;
    }

    const profilesDir = path.join(getProjectExtDir(), 'extensions', 'chips', 'profiles');
    const candidates = runtime.unique([
      normalizedModel,
      compactHardwareSlug(normalizedModel),
      normalizedPackage ? compactHardwareSlug(`${normalizedModel}${normalizedPackage}`) : '',
      normalizedPackage ? compactHardwareSlug(`${normalizedModel}-${normalizedPackage}`) : ''
    ].filter(Boolean));

    for (const candidate of candidates) {
      const filePath = path.join(profilesDir, `${candidate}.json`);
      if (!fs.existsSync(filePath)) {
        continue;
      }
      return {
        name: candidate,
        path: filePath
      };
    }

    return null;
  }

  function readHookVersion() {
    const hookFile = path.join(RUNTIME_HOST.runtimeRoot, 'hooks', 'emb-session-start.js');
    if (!fs.existsSync(hookFile)) {
      return '';
    }

    const lines = runtime.readText(hookFile).split(/\r?\n/).slice(0, 5);
    const versionLine = lines.find(line => line.includes('emb-hook-version:'));
    if (!versionLine) {
      return '';
    }

    return versionLine.split('emb-hook-version:')[1].trim();
  }

  function parseScalar(content, key) {
    const line = String(content || '')
      .split(/\r?\n/)
      .find(item => item.trim().startsWith(`${key}:`));

    if (!line) {
      return '';
    }

    return line
      .split(':')
      .slice(1)
      .join(':')
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  function loadHardwareIdentity() {
    const hwPath = runtime.resolveProjectDataPath(resolveProjectRoot(), 'hw.yaml');
    if (!fs.existsSync(hwPath)) {
      return {
        file: runtime.getProjectAssetRelativePath('hw.yaml'),
        vendor: '',
        model: '',
        package: ''
      };
    }

    const content = runtime.readText(hwPath);
    return {
      file: runtime.getProjectAssetRelativePath('hw.yaml'),
      vendor: parseScalar(content, 'vendor'),
      model: parseScalar(content, 'model'),
      package: parseScalar(content, 'package')
    };
  }

  function createCheck(key, status, summary, evidence, recommendation) {
    return {
      key,
      status,
      summary,
      evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : [],
      recommendation: recommendation || ''
    };
  }

  function formatStateEvidencePath(projectRoot, filePath) {
    const relativePath = path.relative(projectRoot, filePath || '');
    if (
      relativePath &&
      relativePath !== '.' &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath)
    ) {
      return relativePath;
    }
    return path.resolve(filePath || '');
  }

  function buildStartupAutomationSummary(workspaceTrust) {
    const trust = workspaceTrust || {};
    return {
      status: trust.trusted ? 'ready' : 'action-needed',
      source: trust.source || 'default',
      signal: trust.signal || (trust.trusted ? 'trusted' : 'untrusted'),
      summary: trust.summary || ''
    };
  }

  function pushNextCommand(target, key, summary, cli, kind, meta) {
    if (!cli) {
      return;
    }

    if (target.some(item => item.key === key || item.cli === cli)) {
      return;
    }

    target.push({
      key,
      kind: kind || 'command',
      summary,
      cli,
      ...(meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {})
    });
  }

  function summarizeChecks(checks) {
    const counts = {
      pass: 0,
      warn: 0,
      fail: 0,
      info: 0
    };

    checks.forEach(item => {
      counts[item.status] = (counts[item.status] || 0) + 1;
    });

    return {
      status: counts.fail > 0 ? 'fail' : counts.warn > 0 ? 'warn' : 'pass',
      counts
    };
  }

  function createBootstrapStage(id, status, label, options) {
    const config = options && typeof options === 'object' ? options : {};
    return {
      id,
      status,
      label,
      summary: config.summary || '',
      cli: config.cli || '',
      kind: config.kind || '',
      argv: Array.isArray(config.argv) ? config.argv : [],
      additional_steps: Array.isArray(config.additional_steps) ? config.additional_steps.filter(Boolean) : [],
      manual: status === 'manual',
      blocking: ['ready', 'manual'].includes(status),
      evidence: Array.isArray(config.evidence) ? config.evidence.filter(Boolean) : []
    };
  }

  function getBootstrapStageDisplayId(id) {
    switch (id) {
      case 'init-project':
        return 'project-init';
      case 'startup-hooks':
        return 'host-readiness';
      case 'source-intake':
        return 'normalize-discovered-inputs';
      case 'hardware-truth':
        return 'project-facts';
      case 'doc-truth-sync':
        return 'apply-document-facts';
      case 'support-bootstrap':
        return 'chip-support';
      case 'support-derive':
        return 'chip-support-draft';
      case 'next-step':
        return 'continue-with-next';
      default:
        return id || '';
    }
  }

  function getBootstrapStageAction(id) {
    switch (id) {
      case 'startup-hooks':
        return 'Host action required';
      case 'source-intake':
        return 'Normalize discovered input';
      case 'hardware-truth':
        return 'Project facts required';
      case 'doc-truth-sync':
        return 'Document apply required';
      case 'support-bootstrap':
      case 'support-derive':
      case 'next-step':
        return 'Ready to run';
      case 'init-project':
        return 'Project init required';
      default:
        return '';
    }
  }

  function getBootstrapStatusDisplay(status) {
    switch (status) {
      case 'manual':
        return 'needs-user-input';
      case 'ready':
        return 'ready-to-run';
      case 'completed':
        return 'done';
      case 'pending':
        return 'waiting-on-earlier-step';
      default:
        return status || '';
    }
  }

  function decorateBootstrapStage(stage) {
    if (!stage || typeof stage !== 'object') {
      return stage;
    }

    return {
      ...stage,
      display_id: getBootstrapStageDisplayId(stage.id),
      display_status: getBootstrapStatusDisplay(stage.status),
      action_summary: getBootstrapStageAction(stage.id)
    };
  }

  function getQuickstartDisplayStage(id) {
    switch (id) {
      case 'restart-host-hooks':
        return 'restart-host-for-bootstrap';
      case 'fill-hardware-identity':
        return 'complete-project-facts';
      case 'ingest-detected-input':
        return 'normalize-discovered-inputs';
      case 'doc-apply-then-next':
        return 'apply-document-facts';
      case 'derive-then-next':
        return 'derive-chip-support-then-next';
      case 'bootstrap-then-next':
        return 'install-chip-support-then-next';
      case 'next':
        return 'enter-next-stage';
      default:
        return id || '';
    }
  }

  function getQuickstartUserSummary(stageId, summary) {
    if (stageId === 'restart-host-hooks') {
      return 'Startup hooks are not active in the current host session; restart the host once, then rerun health.';
    }

    if (stageId === 'fill-hardware-identity') {
      return 'Hardware identity is incomplete; update .emb-agent/hw.yaml or .emb-agent/req.yaml before continuing.';
    }

    if (stageId === 'ingest-detected-input') {
      return 'emb-agent found a schematic or hardware PDF in the project; normalize it first so the agent can inspect machine-readable evidence before editing truth files.';
    }

    if (stageId === 'doc-apply-then-next') {
      return 'Parsed hardware document facts are pending apply; write them into truth files before continuing.';
    }

    if (stageId === 'derive-then-next') {
      return 'No project-local chip support covers the recorded chip yet; derive draft support in the current project first. If you have a hardware document, prefer analysis artifact -> derive.';
    }

    if (stageId === 'bootstrap-then-next') {
      return 'Chip support is available but not installed in the project yet; install it before continuing.';
    }

    if (stageId === 'next') {
      return 'Bootstrap blockers are closed; run the recommended next stage.';
    }

    return summary || '';
  }

  function getQuickstartFollowup(nextStage, quickstartStage) {
    if (!nextStage || typeof nextStage !== 'object') {
      return '';
    }

    if (nextStage.cli) {
      return nextStage.id === 'next-step' ? '' : `Then: ${NEXT_CLI}`;
    }

    if (quickstartStage === 'restart-host-hooks' || nextStage.id === 'startup-hooks') {
      return `After restarting the host, rerun: ${HEALTH_CLI}`;
    }

    if (quickstartStage === 'fill-hardware-identity' || nextStage.id === 'hardware-truth') {
      return `After updating truth files, rerun: ${HEALTH_CLI}`;
    }

    return '';
  }

  function buildChipSupportReuseSummary(adapterReusability) {
    const reusability =
      adapterReusability && typeof adapterReusability === 'object' && !Array.isArray(adapterReusability)
        ? adapterReusability
        : null;

    if (!reusability) {
      return '';
    }

    if (reusability.status === 'reusable') {
      return 'Current chip support is already reusable across projects; continue with the recommended next stage.';
    }

    if (reusability.status === 'reusable-candidate') {
      return 'Current chip support looks reusable after review; continue with the recommended next stage and keep it as a reusable candidate.';
    }

    if (reusability.status === 'project-only') {
      return 'Current chip support should stay project-local for now; continue with the recommended next stage after local verification.';
    }

    return '';
  }

  function buildActionCardFromBootstrap(bootstrap) {
    const plan = bootstrap && typeof bootstrap === 'object' ? bootstrap : {};
    const quickstart = plan.quickstart && typeof plan.quickstart === 'object' ? plan.quickstart : {};
    const nextStage = plan.next_stage && typeof plan.next_stage === 'object' ? plan.next_stage : {};
    const steps = Array.isArray(quickstart.steps) ? quickstart.steps.filter(Boolean) : [];
    const firstStep = steps[0] && typeof steps[0] === 'object' ? steps[0] : {};
    const secondStep = steps[1] && typeof steps[1] === 'object' ? steps[1] : {};

    return {
      status: plan.display_status || getBootstrapStatusDisplay(plan.status),
      stage: plan.display_current_stage || getBootstrapStageDisplayId(plan.current_stage),
      action: nextStage.action_summary || getBootstrapStageAction(nextStage.id),
      summary: plan.display_summary || quickstart.user_summary || plan.summary || '',
      reason: nextStage.label || '',
      first_step_label: firstStep.label || '',
      first_instruction:
        firstStep.cli
          ? ''
          : (quickstart.user_summary || nextStage.summary || firstStep.label || plan.display_summary || ''),
      first_cli: firstStep.cli || nextStage.cli || '',
      then_cli: secondStep.cli || '',
      followup: quickstart.followup || ''
    };
  }

  function buildBootstrapPlan(projectRoot, workspaceTrust, hardwareIdentity, nextCommands, pendingDocApply, pendingSourceIntake, checks, adapterReusability) {
    const commands = Array.isArray(nextCommands) ? nextCommands : [];
    const allChecks = Array.isArray(checks) ? checks : [];
    const findCommand = (...keys) => commands.find(item => keys.includes(item.key));
    const findCheck = key => allChecks.find(item => item.key === key) || null;
    const initReady = [
      'emb_agent_dir',
      'project_config_file',
      'project_config_valid',
      'hw_truth',
      'req_truth'
    ].every(key => {
      const check = findCheck(key);
      return check && check.status === 'pass';
    });
    const trustReady = !workspaceTrust || workspaceTrust.trusted !== false;
    const hardwareReady = Boolean(hardwareIdentity.model && hardwareIdentity.package);
    const docApply = pendingDocApply && pendingDocApply.command
      ? {
          ...pendingDocApply,
          kind: 'doc',
          cli: pendingDocApply.command,
          argv: pendingDocApply.argv || []
        }
      : null;
    const sourceIntake = pendingSourceIntake && pendingSourceIntake.cli
      ? {
          ...pendingSourceIntake,
          kind: 'ingest',
          cli: pendingSourceIntake.cli,
          argv: pendingSourceIntake.argv || []
        }
      : null;
    const bootstrap = findCommand('support-bootstrap', 'support-sync');
    const analysisInit = findCommand('support-analysis-init');
    const derive = findCommand('support-derive-from-project', 'support-derive-from-analysis', 'support-derive-from-doc');
    const next = findCommand('next');
    const stages = [];

    stages.push(
      createBootstrapStage(
        'init-project',
        initReady ? 'completed' : 'ready',
        'Initialize emb-agent project skeleton',
        {
          summary: initReady
            ? 'Project skeleton and core truth files already exist'
            : 'Create or rebuild .emb-agent skeleton before later bootstrap stages',
          cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['start']),
          kind: 'command',
          argv: ['start'],
          evidence: [runtime.getProjectAssetRelativePath()]
        }
      )
    );

    const showAuthorizationStage = !(workspaceTrust && workspaceTrust.trusted && workspaceTrust.source === 'host-config');

    if (showAuthorizationStage) {
      stages.push(
        createBootstrapStage(
          'startup-hooks',
          !initReady ? 'pending' : trustReady ? 'completed' : 'manual',
          'Enable host startup hooks',
          {
            summary: trustReady
              ? (workspaceTrust && workspaceTrust.summary)
                ? workspaceTrust.summary
                : 'Host startup hooks are active. Automatic bootstrap can continue.'
              : 'Restart the host once so emb-agent startup hooks attach before bootstrap continues.',
            evidence: workspaceTrust
              ? [
                  workspaceTrust.source ? `source=${workspaceTrust.source}` : '',
                  workspaceTrust.signal ? `signal=${workspaceTrust.signal}` : ''
                ]
              : []
          }
        )
      );
    }

    stages.push(
      createBootstrapStage(
        'source-intake',
        !initReady || !trustReady ? 'pending' : sourceIntake ? 'ready' : 'completed',
        sourceIntake && sourceIntake.type === 'schematic'
          ? 'Normalize discovered schematic input'
          : 'Parse discovered hardware document',
        {
          summary: sourceIntake
            ? sourceIntake.summary
            : 'No unparsed schematic or hardware PDF bootstrap evidence remains',
          cli: sourceIntake ? sourceIntake.cli : '',
          kind: sourceIntake ? sourceIntake.kind : '',
          argv: sourceIntake ? sourceIntake.argv : [],
          evidence: sourceIntake
            ? [
                sourceIntake.file || '',
                sourceIntake.type ? `type=${sourceIntake.type}` : ''
              ]
            : []
        }
      )
    );

    stages.push(
      createBootstrapStage(
        'hardware-truth',
        !initReady || !trustReady || Boolean(sourceIntake) ? 'pending' : hardwareReady ? 'completed' : 'manual',
        'Confirm or choose chip identity',
        {
          summary: hardwareReady
            ? `Hardware identity is recorded as ${hardwareIdentity.model}/${hardwareIdentity.package}`
            : `If a chip is already known, write chip/package into ${runtime.getProjectAssetRelativePath('hw.yaml')} first, for example SC8F072 + SOP8. If the project is still at concept stage, keep ${runtime.getProjectAssetRelativePath('hw.yaml')} unknown and record goals and constraints in ${runtime.getProjectAssetRelativePath('req.yaml')} first.`,
          evidence: [runtime.getProjectAssetRelativePath('hw.yaml')]
        }
      )
    );

    stages.push(
      createBootstrapStage(
        'doc-truth-sync',
        !initReady || !trustReady || Boolean(sourceIntake) || !hardwareReady ? 'pending' : docApply ? 'ready' : 'completed',
        'Apply pending document truth',
        {
          summary: docApply
            ? `Pending parsed document ${docApply.doc_id} should be written into truth files first`
            : 'No pending document apply backlog remains',
          cli: docApply ? docApply.cli : '',
          kind: docApply ? docApply.kind : '',
          argv: docApply ? docApply.argv : [],
          evidence: docApply ? [docApply.target, docApply.doc_id] : []
        }
      )
    );

    if (bootstrap || analysisInit || derive) {
      const command = bootstrap || analysisInit || derive;
      stages.push(
        createBootstrapStage(
          bootstrap ? 'support-bootstrap' : 'support-derive',
          !initReady || !trustReady || Boolean(sourceIntake) || !hardwareReady || Boolean(docApply) ? 'pending' : 'ready',
          bootstrap ? 'Install matching chip support' : 'Prepare project-local chip support',
          {
            summary: command.summary || '',
            cli: command.cli || '',
            kind: command.kind || '',
            argv: command.argv || [],
            additional_steps:
              !bootstrap && analysisInit && derive
                ? [
                    {
                      label: derive.summary || 'Derive draft chip support into the current project',
                      cli: derive.cli || ''
                    }
                  ]
                : [],
            evidence: [command.key || '']
          }
        )
      );
    } else {
      stages.push(
        createBootstrapStage(
          'support-bootstrap',
          !initReady || !trustReady || Boolean(sourceIntake) || !hardwareReady || Boolean(docApply) ? 'pending' : 'completed',
          'Install matching chip support',
          {
            summary: 'Chip support registration and hardware matching are already closed'
          }
        )
      );
    }

    const hasBlockingStage = stages.some(item => ['ready', 'manual'].includes(item.status));
    stages.push(
      createBootstrapStage(
        'next-step',
        hasBlockingStage ? 'pending' : 'ready',
        'Enter the recommended next stage',
        {
          summary: hasBlockingStage
            ? 'Finish earlier bootstrap stages first. Then run next.'
            : 'Bootstrap is ready. Run next.',
          cli: next ? next.cli : NEXT_CLI,
          kind: 'command',
          argv: ['next']
        }
      )
    );

    const decoratedStages = stages.map(decorateBootstrapStage);
    const nextStage = decoratedStages.find(item => ['ready', 'manual'].includes(item.status)) || null;
    const quickstartStage = nextStage
      ? nextStage.id === 'hardware-truth'
        ? 'fill-hardware-identity'
        : nextStage.id === 'startup-hooks'
          ? 'restart-host-hooks'
        : nextStage.id === 'source-intake'
          ? 'ingest-detected-input'
        : nextStage.id === 'doc-truth-sync'
          ? 'doc-apply-then-next'
          : nextStage.id === 'support-derive'
            ? 'derive-then-next'
            : nextStage.id === 'support-bootstrap'
              ? 'bootstrap-then-next'
              : 'next'
      : 'next';
    const quickstartSteps = [
      ...(nextStage && nextStage.cli
        ? [
            {
              label: nextStage.label,
              cli: nextStage.cli
            }
          ]
        : []),
      ...((nextStage && Array.isArray(nextStage.additional_steps)) ? nextStage.additional_steps : []),
      ...(nextStage && nextStage.cli && nextStage.id !== 'next-step'
        ? [
            {
              label: 'Enter the emb-agent recommended next step',
              cli: NEXT_CLI
            }
          ]
        : [])
    ];
    const reuseSummary = buildChipSupportReuseSummary(adapterReusability);
    const quickstartSummary = nextStage
      ? nextStage.id === 'next-step' && reuseSummary
        ? reuseSummary
        : nextStage.summary || nextStage.label
      : reuseSummary || 'Bootstrap is already clear. Run next directly.';
    const quickstartUserSummary =
      nextStage && nextStage.id === 'next-step' && reuseSummary
        ? reuseSummary
        : getQuickstartUserSummary(quickstartStage, quickstartSummary);
    const quickstartFollowup = getQuickstartFollowup(nextStage, quickstartStage);

    const actionCard = buildActionCardFromBootstrap({
      status: nextStage ? (nextStage.status === 'manual' ? 'manual' : 'ready') : 'complete',
      display_status: nextStage ? getBootstrapStatusDisplay(nextStage.status) : 'done',
      summary: nextStage
        ? nextStage.id === 'next-step' && reuseSummary
          ? reuseSummary
          : nextStage.summary || nextStage.label
        : reuseSummary || 'Bootstrap is already clear.',
      display_summary: nextStage
        ? nextStage.id === 'next-step' && reuseSummary
          ? reuseSummary
          : getQuickstartUserSummary(quickstartStage, nextStage.summary || nextStage.label)
        : reuseSummary || 'Bootstrap is already clear. Enter the recommended next stage.',
      current_stage: nextStage ? nextStage.id : '',
      display_current_stage: nextStage ? nextStage.display_id : 'continue-with-next',
      next_stage: nextStage,
      quickstart: {
        stage: quickstartStage,
        display_stage: getQuickstartDisplayStage(quickstartStage),
        summary: quickstartSummary,
        user_summary: quickstartUserSummary,
        steps: quickstartSteps,
        followup: quickstartFollowup
      }
    });

    return {
      command: 'bootstrap',
      project_root: projectRoot,
      runtime_host: RUNTIME_HOST.name,
      status: nextStage ? (nextStage.status === 'manual' ? 'manual' : 'ready') : 'complete',
      display_status: nextStage ? getBootstrapStatusDisplay(nextStage.status) : 'done',
      summary: nextStage
        ? nextStage.id === 'next-step' && reuseSummary
          ? reuseSummary
          : nextStage.summary || nextStage.label
        : reuseSummary || 'Bootstrap is already clear.',
      display_summary: nextStage
        ? nextStage.id === 'next-step' && reuseSummary
          ? reuseSummary
          : getQuickstartUserSummary(quickstartStage, nextStage.summary || nextStage.label)
        : reuseSummary || 'Bootstrap is already clear. Enter the recommended next stage.',
      current_stage: nextStage ? nextStage.id : '',
      display_current_stage: nextStage ? nextStage.display_id : 'continue-with-next',
      next_stage: nextStage,
      stages: decoratedStages,
      quickstart: actionCard.first_cli || actionCard.then_cli || actionCard.followup
        ? {
            stage: quickstartStage,
            display_stage: getQuickstartDisplayStage(quickstartStage),
            summary: quickstartSummary,
            user_summary: quickstartUserSummary,
            steps: quickstartSteps,
            followup: actionCard.followup
          }
        : {
            stage: quickstartStage,
            display_stage: getQuickstartDisplayStage(quickstartStage),
            summary: quickstartSummary,
            user_summary: quickstartUserSummary,
            steps: quickstartSteps,
            followup: ''
          },
      action_card: actionCard,
      startup_automation: buildStartupAutomationSummary(workspaceTrust)
    };
  }

  function buildQuickstartHint(workspaceTrust, hardwareIdentity, nextCommands, pendingDocApply, pendingSourceIntake, checks, projectRoot, adapterReusability) {
    const bootstrap = buildBootstrapPlan(projectRoot, workspaceTrust, hardwareIdentity, nextCommands, pendingDocApply, pendingSourceIntake, checks, adapterReusability);
    return bootstrap.quickstart;
  }

  function findLatestHardwareDoc(projectRoot, pendingDocApply) {
    if (!ingestDocCli || typeof ingestDocCli.listDocs !== 'function') {
      return null;
    }

    const listing = ingestDocCli.listDocs(projectRoot);
    const documents = Array.isArray(listing && listing.documents) ? listing.documents : [];
    const blockedDocId = pendingDocApply && pendingDocApply.doc_id ? pendingDocApply.doc_id : '';

    return documents.find(item => {
      if (!item || item.intended_to !== 'hardware') {
        return false;
      }
      if (blockedDocId && item.doc_id === blockedDocId) {
        return false;
      }
      return true;
    }) || null;
  }

  function buildDocAnalysisCommands(projectRoot, docEntry) {
    if (!projectRoot || !docEntry || !docEntry.doc_id || !ingestDocCli || typeof ingestDocCli.showDoc !== 'function') {
      return null;
    }

    try {
      const view = ingestDocCli.showDoc(projectRoot, docEntry.doc_id);
      const summaryInfo = view && view.summary_info && typeof view.summary_info === 'object' ? view.summary_info : null;
      const agentAnalysis = summaryInfo && summaryInfo.agent_analysis && typeof summaryInfo.agent_analysis === 'object'
        ? summaryInfo.agent_analysis
        : null;
      const recommendedFlow = summaryInfo && summaryInfo.recommended_flow && typeof summaryInfo.recommended_flow === 'object'
        ? summaryInfo.recommended_flow
        : null;
      const handoffProtocol = summaryInfo && summaryInfo.handoff_protocol && typeof summaryInfo.handoff_protocol === 'object'
        ? summaryInfo.handoff_protocol
        : null;
      if (!agentAnalysis || !agentAnalysis.artifact_path) {
        return null;
      }

      return {
        artifact_path: agentAnalysis.artifact_path,
        init_command: agentAnalysis.init_command || '',
        init_argv: Array.isArray(agentAnalysis.init_argv) ? agentAnalysis.init_argv : [],
        derive_command: agentAnalysis.derive_command || '',
        derive_argv: Array.isArray(agentAnalysis.derive_argv) ? agentAnalysis.derive_argv : [],
        cli_hint: agentAnalysis.cli_hint || '',
        recommended_flow: recommendedFlow,
        handoff_protocol: handoffProtocol
      };
    } catch {
      return null;
    }
  }

  function buildHealthReport() {
    const runtimeHost = typeof getRuntimeHost === 'function' ? getRuntimeHost() : RUNTIME_HOST;
    const projectRoot = resolveProjectRoot();
    const projectExtDir = getProjectExtDir();
    const projectConfigPath = path.join(projectExtDir, 'project.json');
    const hwPath = path.join(projectExtDir, 'hw.yaml');
    const reqPath = path.join(projectExtDir, 'req.yaml');
    const docsDir = path.join(projectRoot, 'docs');
    const docCacheDir = path.join(projectExtDir, 'cache', 'docs');
    const adapterCacheDir = path.join(projectExtDir, 'cache', 'chip-support-sources');
    const adaptersDir = path.join(projectExtDir, 'chip-support');
    const statePaths = getProjectStatePaths();
    const stateInspection = runtime.resolveProjectStateInspection
      ? runtime.resolveProjectStateInspection(statePaths)
      : {
          storageMode: statePaths.storageMode || 'primary',
          sessionPath: statePaths.sessionPath,
          sessionStorageMode: statePaths.storageMode || 'primary',
          handoffPath: statePaths.handoffPath,
          handoffStorageMode: statePaths.storageMode || 'primary'
        };
    const checks = [];
    const nextCommands = [];
    let latestHardwareDocProtocol = null;
    let projectConfig = null;
    let normalizedSession = null;
    let rawSession = null;
    let handoff = null;
    const workspaceTrust = hookTrustHelpers.resolveWorkspaceTrust(null, process.env, {
      fs,
      path,
      runtimeHost
    });

    const subagentBridge = runtimeHost && runtimeHost.subagentBridge
      ? runtimeHost.subagentBridge
      : { available: false, mode: 'disabled', source: 'none', status: 'disabled' };

    checks.push(
      createCheck(
        'project_root',
        fs.existsSync(projectRoot) ? 'pass' : 'fail',
        fs.existsSync(projectRoot) ? 'Project root is accessible' : 'Project root does not exist',
        [projectRoot],
        fs.existsSync(projectRoot) ? '' : 'Confirm first that the current cwd is the project root.'
      )
    );

    checks.push(
      createCheck(
        'emb_agent_dir',
        fs.existsSync(projectExtDir) ? 'pass' : 'fail',
        fs.existsSync(projectExtDir) ? '.emb-agent directory exists' : '.emb-agent directory is missing',
        [path.relative(projectRoot, projectExtDir) || runtime.getProjectAssetRelativePath()],
        fs.existsSync(projectExtDir) ? '' : 'Run init first to generate the minimal .emb-agent project skeleton.'
      )
    );

    checks.push(
      createCheck(
        'subagent_bridge',
        subagentBridge.available ? 'pass' : 'info',
        subagentBridge.available
          ? `Host sub-agent bridge is configured (${subagentBridge.mode})`
          : 'Host sub-agent bridge is not configured',
        [
          `runtime_host=${runtimeHost.name || RUNTIME_HOST.name}`,
          `source=${subagentBridge.source || 'none'}`,
          `mode=${subagentBridge.mode || 'disabled'}`
        ],
        subagentBridge.available
          ? ''
          : 'Configure EMB_AGENT_SUBAGENT_BRIDGE_CMD if you want dispatch/orchestrate to launch host sub-agents automatically.'
      )
    );

    checks.push(
      createCheck(
        'startup_automation',
        workspaceTrust.trusted ? 'pass' : 'warn',
        workspaceTrust.summary,
        [
          `source=${workspaceTrust.source || 'default'}`,
          `signal=${workspaceTrust.signal || (workspaceTrust.trusted ? 'trusted' : 'untrusted')}`
        ],
        workspaceTrust.trusted
          ? ''
          : 'Restart the host once so emb-agent automatic startup can activate, then rerun health.'
      )
    );

    checks.push(
      createCheck(
        'project_config_file',
        fs.existsSync(projectConfigPath) ? 'pass' : 'fail',
        fs.existsSync(projectConfigPath) ? 'project.json exists' : 'project.json is missing',
        [path.relative(projectRoot, projectConfigPath)],
        fs.existsSync(projectConfigPath) ? '' : `Run init first to create ${runtime.getProjectAssetRelativePath('project.json')}.`
      )
    );

    try {
      projectConfig = getProjectConfig();
      checks.push(
        createCheck(
          'project_config_valid',
          projectConfig ? 'pass' : 'fail',
          projectConfig ? 'project.json validation passed' : 'project.json is not initialized yet',
              projectConfig
                ? [
                    `profile=${projectConfig.project_profile || '(default)'}`,
                    `specs=${(projectConfig.active_specs || []).join(',') || '(none)'}`,
                    `chip_support_sources=${(projectConfig.chip_support_sources || []).length}`
                  ]
            : [path.relative(projectRoot, projectConfigPath)],
          projectConfig ? '' : 'Run init first to write the minimal project configuration.'
        )
      );
    } catch (error) {
      checks.push(
        createCheck(
          'project_config_valid',
          'fail',
          'project.json is invalid',
          [error.message],
          `Fix ${runtime.getProjectAssetRelativePath('project.json')} before continuing to use emb-agent.`
        )
      );
    }

    [
      ['hw_truth', hwPath, 'pass', 'hw.yaml exists', 'fail', 'hw.yaml is missing', `Complete ${runtime.getProjectAssetRelativePath('hw.yaml')} first to record MCU / pin / constraint ground truth.`],
      ['req_truth', reqPath, 'pass', 'req.yaml exists', 'fail', 'req.yaml is missing', `Complete ${runtime.getProjectAssetRelativePath('req.yaml')} first to record goals / features / acceptance.`],
      ['docs_dir', docsDir, 'pass', 'docs directory exists', 'info', 'docs directory has not been created yet', 'Created on first saved document or manual docs work.'],
      ['doc_cache_dir', docCacheDir, 'pass', 'Document cache directory exists', 'info', 'Document cache directory has not been created yet', `Created on first document ingest under ${runtime.getProjectAssetRelativePath('cache', 'docs')}.`],
      ['chip_support_cache_dir', adapterCacheDir, 'pass', 'Chip support cache directory exists', 'info', 'Chip support cache directory has not been created yet', `Created on first support bootstrap/sync under ${runtime.getProjectAssetRelativePath('cache', 'chip-support-sources')}.`],
      ['chip_support_dir', adaptersDir, 'pass', 'Chip support directory exists', 'info', 'Chip support directory has not been created yet', `Created when project-local chip support is bootstrapped, synced, or derived under ${runtime.getProjectAssetRelativePath('chip-support')}.`]
    ].forEach(([key, targetPath, passStatus, passSummary, failStatus, failSummary, recommendation]) => {
      const exists = fs.existsSync(targetPath);
      checks.push(
        createCheck(
          key,
          exists ? passStatus : failStatus,
          exists ? passSummary : failSummary,
          [path.relative(projectRoot, targetPath)],
          exists ? '' : recommendation
        )
      );
    });

    if (fs.existsSync(stateInspection.sessionPath)) {
      try {
        rawSession = runtime.readJson(stateInspection.sessionPath);
        normalizedSession = normalizeSession(rawSession, statePaths);
        checks.push(
          createCheck(
            'session_state',
            'pass',
            'Session state file is readable',
            [
              formatStateEvidencePath(projectRoot, stateInspection.sessionPath),
              `storage_mode=${stateInspection.sessionStorageMode || stateInspection.storageMode || 'primary'}`,
              `last_command=${normalizedSession.last_command || '(empty)'}`,
              `last_files=${(normalizedSession.last_files || []).length}`
            ],
            ''
          )
        );
      } catch (error) {
        checks.push(
          createCheck(
            'session_state',
            'fail',
            'Session state file is corrupted',
            [
              formatStateEvidencePath(projectRoot, stateInspection.sessionPath),
              `storage_mode=${stateInspection.sessionStorageMode || stateInspection.storageMode || 'primary'}`,
              error.message
            ],
            'Delete the corrupted session state, or run init/resume again so emb-agent can rebuild session state.'
          )
        );
      }
    } else {
      checks.push(
        createCheck(
          'session_state',
          'warn',
          'No session state file has been found yet',
          [
            formatStateEvidencePath(projectRoot, stateInspection.sessionPath),
            `storage_mode=${stateInspection.sessionStorageMode || stateInspection.storageMode || 'primary'}`
          ],
          'Run start, next, or resume once so emb-agent can establish project session state.'
        )
      );
      pushNextCommand(
        nextCommands,
        'start',
        'Initialize or rebuild the emb-agent skeleton for the current project',
        runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['start']),
        'command',
        {
          argv: ['start']
        }
      );
    }

    if (fs.existsSync(stateInspection.handoffPath)) {
      try {
        handoff = runtime.validateHandoff(runtime.readJson(stateInspection.handoffPath), RUNTIME_CONFIG);
        checks.push(
          createCheck(
            'handoff_state',
            'warn',
            'An unconsumed handoff exists',
            [
              formatStateEvidencePath(projectRoot, stateInspection.handoffPath),
              `storage_mode=${stateInspection.handoffStorageMode || stateInspection.storageMode || 'primary'}`,
              `next_action=${handoff.next_action || '(empty)'}`,
              `resume_cli=${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume'])}`
            ],
            'If this is the current work state, run resume first; otherwise confirm whether this handoff is stale.'
          )
        );
        pushNextCommand(
          nextCommands,
          'resume',
          'A handoff exists; restore the previous context first',
          runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume']),
          'command',
          {
            argv: ['resume']
          }
        );
      } catch (error) {
        checks.push(
          createCheck(
            'handoff_state',
            'fail',
            'Handoff state file is corrupted',
            [
              formatStateEvidencePath(projectRoot, stateInspection.handoffPath),
              `storage_mode=${stateInspection.handoffStorageMode || stateInspection.storageMode || 'primary'}`,
              error.message
            ],
            'Fix or remove the corrupted handoff file so resume does not restore the wrong context.'
          )
        );
      }
    } else {
      checks.push(
        createCheck(
          'handoff_state',
          'info',
          'There is no handoff right now',
          [],
          ''
        )
      );
    }

    const desiredProfile = projectConfig && projectConfig.project_profile
      ? projectConfig.project_profile
      : RUNTIME_CONFIG.default_profile;
    try {
      loadProfile(desiredProfile);
      checks.push(
        createCheck(
          'profile_resolution',
          'pass',
          'Current profile is resolvable',
          [`profile=${desiredProfile}`],
          ''
        )
      );
    } catch (error) {
      checks.push(
        createCheck(
          'profile_resolution',
          'fail',
          'Current profile is not resolvable',
          [error.message],
          'Fix the profile in project.json or add the matching profile.yaml.'
        )
      );
    }

    const desiredSpecs =
      projectConfig && Array.isArray(projectConfig.active_specs) && projectConfig.active_specs.length > 0
        ? projectConfig.active_specs
        : (RUNTIME_CONFIG.default_specs || []);
    const unresolvedSpecs = [];
    desiredSpecs.forEach(name => {
      try {
        const spec = loadSpec(name);
        if (spec.selectable !== true) {
          throw new Error(`Spec is not selectable: ${name}`);
        }
      } catch (error) {
        unresolvedSpecs.push(`${name}: ${error.message}`);
      }
    });
    checks.push(
      createCheck(
        'spec_resolution',
        unresolvedSpecs.length > 0 ? 'fail' : 'pass',
        unresolvedSpecs.length > 0 ? 'There are unresolved workflow specs' : 'Current workflow specs are resolvable',
        unresolvedSpecs.length > 0
          ? unresolvedSpecs
          : [`specs=${desiredSpecs.join(',') || '(none)'}`],
        unresolvedSpecs.length > 0 ? 'Fix the specs in project.json or add the matching workflow definition.' : ''
      )
    );

    const hardwareIdentity = loadHardwareIdentity();
    if (!hardwareIdentity.model) {
      checks.push(
        createCheck(
          'hardware_identity',
          'warn',
          '.emb-agent/hw.yaml does not contain the chip identity yet',
          [hardwareIdentity.file],
          `If the chip is already known, add chip/package to ${runtime.getProjectAssetRelativePath('hw.yaml')} so emb-agent can match chip profiles later. If the project is still at concept stage, record goals and constraints in ${runtime.getProjectAssetRelativePath('req.yaml')} first and leave ${runtime.getProjectAssetRelativePath('hw.yaml')} unknown until a real candidate exists.`
        )
      );
    } else {
      const chipProfile = findChipProfileByModel(hardwareIdentity.model, hardwareIdentity.package);
      const localChipSupport = findProjectLocalChipSupport(hardwareIdentity.model, hardwareIdentity.package);
      checks.push(
        createCheck(
          'hardware_identity',
          chipProfile || localChipSupport ? 'pass' : 'warn',
          chipProfile || localChipSupport
            ? 'The chip model is mapped to a chip profile'
            : 'The chip model is not mapped to a chip profile yet',
          chipProfile || localChipSupport
            ? [
                `model=${hardwareIdentity.model}`,
                chipProfile ? `chip_profile=${chipProfile.name}` : '',
                chipProfile ? `family=${chipProfile.family}` : '',
                localChipSupport ? `project_chip_profile=${path.relative(projectRoot, localChipSupport.path).replace(/\\/g, '/')}` : ''
              ]
            : [`model=${hardwareIdentity.model}`],
          chipProfile || localChipSupport ? '' : 'Tool auto-discovery can fully connect only after the adapter/chip profile is added.'
        )
      );
    }

    const pendingSourceIntake = findPendingProjectInputIntake(projectRoot, hardwareIdentity);
    if (pendingSourceIntake) {
      checks.push(
        createCheck(
          'project_source_intake',
          'warn',
          pendingSourceIntake.type === 'schematic'
            ? 'A discovered schematic has not been normalized yet'
            : 'A discovered hardware PDF has not been parsed yet',
          [
            pendingSourceIntake.file,
            `type=${pendingSourceIntake.type}`
          ],
          `Run ${pendingSourceIntake.cli} first so emb-agent can inspect machine-readable project evidence before manual truth edits.`
        )
      );
      pushNextCommand(
        nextCommands,
        'source-intake',
        pendingSourceIntake.summary,
        pendingSourceIntake.cli,
        'ingest',
        {
          argv: pendingSourceIntake.argv || [],
          intake_type: pendingSourceIntake.type,
          target_file: pendingSourceIntake.file
        }
      );
    }

    if (projectConfig && projectConfig.integrations && projectConfig.integrations.mineru) {
      const mineru = projectConfig.integrations.mineru;
      const apiKeyConfigured = Boolean(mineru.api_key) || Boolean(process.env[mineru.api_key_env || 'MINERU_API_KEY']);
      checks.push(
        createCheck(
          'mineru_integration',
          mineru.mode === 'api' && !apiKeyConfigured ? 'warn' : 'pass',
          mineru.mode === 'api' && !apiKeyConfigured
            ? 'MinerU API mode is enabled, but no usable API key was found'
            : `MinerU configuration is available (${mineru.mode})`,
          [
            `mode=${mineru.mode}`,
            `api_key_env=${mineru.api_key_env || 'MINERU_API_KEY'}`
          ],
          mineru.mode === 'api' && !apiKeyConfigured
            ? 'Provide an API key in .env or the host environment so document ingestion does not fail in API mode.'
            : ''
        )
      );
    }

    const pendingDocApply =
      ingestDocCli && typeof ingestDocCli.findPendingDocApply === 'function'
        ? ingestDocCli.findPendingDocApply(projectRoot)
        : null;
    if (pendingDocApply) {
      checks.push(
        createCheck(
          'doc_apply_backlog',
          'warn',
          `Pending document apply exists: ${pendingDocApply.doc_id}`,
          [
            pendingDocApply.title ? `title=${pendingDocApply.title}` : '',
            `to=${pendingDocApply.to}`,
            `target=${pendingDocApply.target}`
          ],
          'Apply parsed documents to hw.yaml/req.yaml first, then let next continue from the recorded truth.'
        )
      );
      pushNextCommand(
        nextCommands,
        'doc-apply',
        `Apply document ${pendingDocApply.doc_id} to ${pendingDocApply.target}`,
        pendingDocApply.command,
        'doc',
        {
          argv: pendingDocApply.argv || []
        }
      );
    }

    if (projectConfig) {
      const latestHardwareDoc = findLatestHardwareDoc(projectRoot, pendingDocApply);
      const localProjectSupport = hardwareIdentity.model
        ? findProjectLocalChipSupport(hardwareIdentity.model, hardwareIdentity.package)
        : null;
      const adapterSourceStatus = adapterSources.listSourceStatus(rootDir, projectRoot, projectConfig);
      const enabledSources = adapterSourceStatus.filter(item => item.enabled !== false);
      const syncedProjectSources = enabledSources.filter(
        item => item.targets && item.targets.project && item.targets.project.synced
      );
      const matchedProjectSources = syncedProjectSources.filter(item => {
        const selection = item.targets.project.selection;
        return selection && selection.filtered && Array.isArray(selection.matched && selection.matched.chips)
          ? selection.matched.chips.length > 0
          : false;
      });

      checks.push(
        createCheck(
          'chip_support_sources_registered',
          enabledSources.length > 0 ? 'pass' : 'info',
          enabledSources.length > 0 ? 'Chip support sources are registered' : 'No chip support source is registered yet',
          enabledSources.length > 0
            ? enabledSources.map(item => `source=${item.name}`)
            : [`${runtime.getProjectAssetRelativePath('project.json')} -> chip_support_sources`],
          enabledSources.length > 0
            ? ''
            : hardwareIdentity.model
              ? 'Shared chip support sources are optional. Derive project-local support first; register a source later only when you want reusable catalog install.'
              : 'Shared chip support sources are optional until the hardware identity is known or catalog reuse is explicitly needed.'
        )
      );
      if (enabledSources.length === 0 && !localProjectSupport) {
        if (hardwareIdentity.model && latestHardwareDoc) {
          const analysisCommands = buildDocAnalysisCommands(projectRoot, latestHardwareDoc);
          latestHardwareDocProtocol = analysisCommands;
          if (analysisCommands && analysisCommands.init_command && analysisCommands.derive_command) {
            pushNextCommand(
              nextCommands,
              'support-analysis-init',
              `Initialize chip-support analysis artifact from document ${latestHardwareDoc.doc_id}`,
              analysisCommands.init_command,
              'support',
              {
                argv: analysisCommands.init_argv,
                artifact_path: analysisCommands.artifact_path
              }
            );
            pushNextCommand(
              nextCommands,
              'support-derive-from-analysis',
              `Derive draft chip support from analysis artifact ${analysisCommands.artifact_path}`,
              analysisCommands.derive_command,
              'support',
              {
                argv: analysisCommands.derive_argv,
                artifact_path: analysisCommands.artifact_path
              }
            );
          } else {
            const deriveCommand = buildProjectDeriveCommand();
            pushNextCommand(
              nextCommands,
              'support-derive-from-project',
              'Derive draft chip support directly from the current project truth',
              deriveCommand.cli,
              'support',
              {
                argv: deriveCommand.argv
              }
            );
          }
        } else if (hardwareIdentity.model) {
          const deriveCommand = buildProjectDeriveCommand();
          pushNextCommand(
            nextCommands,
            'support-derive-from-project',
            'Derive draft chip support directly from the current project truth',
            deriveCommand.cli,
            'support',
            {
              argv: deriveCommand.argv
            }
          );
        }
      }

      checks.push(
        createCheck(
          'chip_support_sync_project',
          localProjectSupport || syncedProjectSources.length > 0 ? 'pass' : enabledSources.length > 0 ? 'warn' : 'info',
          localProjectSupport
            ? 'Project-local chip support draft exists in the current project'
            : syncedProjectSources.length > 0
            ? 'Chip support has been installed into the project directory'
            : enabledSources.length > 0
              ? 'The chip support source is registered but not installed yet'
              : 'There is no chip support source available yet',
          localProjectSupport
            ? [`chip=${localProjectSupport.name}`]
            : syncedProjectSources.length > 0
            ? syncedProjectSources.map(item => `source=${item.name}, files=${item.targets.project.files_count}`)
            : enabledSources.length > 0
              ? enabledSources.map(item => `source=${item.name}`)
              : [],
          localProjectSupport || syncedProjectSources.length > 0
            ? ''
            : enabledSources.length > 0
              ? 'Install matching chip support into the project first.'
              : ''
        )
      );
      if (enabledSources.length > 0 && syncedProjectSources.length === 0 && !localProjectSupport) {
        pushNextCommand(
          nextCommands,
          hardwareIdentity.model ? 'support-bootstrap' : 'support-sync',
          hardwareIdentity.model ? 'Install matching chip support into the current project' : 'Install registered chip support into the current project',
          hardwareIdentity.model
            ? buildSupportCli(['support', 'bootstrap', enabledSources[0].name])
            : buildSupportCli(['support', 'sync', enabledSources[0].name]),
          'support',
          {
            argv: hardwareIdentity.model
              ? ['support', 'bootstrap', enabledSources[0].name]
              : ['support', 'sync', enabledSources[0].name]
          }
        );
      }

      if (hardwareIdentity.model) {
        checks.push(
          createCheck(
            'chip_support_match',
            matchedProjectSources.length > 0 || localProjectSupport ? 'pass' : syncedProjectSources.length > 0 ? 'warn' : 'info',
            matchedProjectSources.length > 0 || localProjectSupport
              ? 'Installed chip support matches the current hardware'
              : syncedProjectSources.length > 0
                ? 'Chip support is installed, but the current hardware is not covered yet'
                : 'Wait until chip support install completes before checking hardware coverage',
            matchedProjectSources.length > 0
              ? matchedProjectSources.map(item => {
                  const selection = item.targets.project.selection;
                  const chips = (selection && selection.matched && selection.matched.chips) || [];
                  const tools = (selection && selection.matched && selection.matched.tools) || [];
                  return `source=${item.name}, chips=${chips.join(',') || '(none)'}, tools=${tools.join(',') || '(none)'}`;
                })
              : localProjectSupport
                ? [`chip=${localProjectSupport.name}`, `path=${path.relative(projectRoot, localProjectSupport.path).replace(/\\/g, '/')}`]
              : syncedProjectSources.length > 0
                ? syncedProjectSources.map(item => {
                    const selection = item.targets.project.selection;
                    return selection && selection.filtered === false
                      ? `source=${item.name}, mode=full-sync`
                      : `source=${item.name}, matched_chips=${((selection && selection.matched && selection.matched.chips) || []).join(',') || '(none)'}`;
                  })
                : [`model=${hardwareIdentity.model}`, `package=${hardwareIdentity.package || '(empty)'}`],
            matchedProjectSources.length > 0 || localProjectSupport
              ? ''
              : syncedProjectSources.length > 0
                ? 'Check whether the chip model/package in hw.yaml is accurate, or add matching family/device/chip support definitions.'
                : 'Fill in the chip model/package in hw.yaml first, then install chip support so emb-agent can select the coverage needed by the current chip.'
          )
        );
      }

      if (
        hardwareIdentity.model &&
        syncedProjectSources.length > 0 &&
        matchedProjectSources.length === 0 &&
        latestHardwareDoc
      ) {
        const analysisCommands = buildDocAnalysisCommands(projectRoot, latestHardwareDoc);
        latestHardwareDocProtocol = analysisCommands;
        checks.push(
          createCheck(
            'chip_support_derive_candidate',
            'warn',
            `The latest hardware document ${latestHardwareDoc.doc_id} can seed a chip-support analysis artifact`,
            [
              latestHardwareDoc.title ? `title=${latestHardwareDoc.title}` : '',
              latestHardwareDoc.source ? `source=${latestHardwareDoc.source}` : '',
              latestHardwareDoc.cached_at ? `cached_at=${latestHardwareDoc.cached_at}` : '',
              analysisCommands && analysisCommands.artifact_path ? `analysis=${analysisCommands.artifact_path}` : ''
            ],
            'Initialize a chip-support analysis artifact from the latest hardware document, let the agent fill it, then derive draft chip support; this is safer than guessing family/device/chip coverage manually.'
          )
        );
        if (analysisCommands && analysisCommands.init_command && analysisCommands.derive_command) {
          pushNextCommand(
            nextCommands,
            'support-analysis-init',
            `Initialize chip-support analysis artifact from document ${latestHardwareDoc.doc_id}`,
            analysisCommands.init_command,
            'support',
            {
              argv: analysisCommands.init_argv,
              artifact_path: analysisCommands.artifact_path
            }
          );
          pushNextCommand(
            nextCommands,
            'support-derive-from-analysis',
            `Derive draft chip support from analysis artifact ${analysisCommands.artifact_path}`,
            analysisCommands.derive_command,
            'support',
            {
              argv: analysisCommands.derive_argv,
              artifact_path: analysisCommands.artifact_path
            }
          );
        }
      }
    }

    if (normalizedSession) {
      if ((normalizedSession.open_questions || []).length > 0) {
        checks.push(
          createCheck(
            'open_questions',
            'warn',
            'Open questions are still pending',
            (normalizedSession.open_questions || []).slice(0, 4).map(item => `question=${item}`),
            'Converge on these questions first, or plan/do will keep drifting.'
          )
        );
      }

      if ((normalizedSession.known_risks || []).length > 0) {
        checks.push(
          createCheck(
            'known_risks',
            'warn',
            'Known risks are still open',
            (normalizedSession.known_risks || []).slice(0, 4).map(item => `risk=${item}`),
            'Decide whether these risks should enter review, thread, or bench verification instead of leaving them open indefinitely.'
          )
        );
      }
    }

    let resolvedSession = null;

    try {
      resolvedSession = resolveSession ? resolveSession() : null;
    } catch {
      resolvedSession = null;
    }

    const toolRecommendations =
      resolvedSession &&
      resolvedSession.effective &&
      Array.isArray(resolvedSession.effective.tool_recommendations)
        ? resolvedSession.effective.tool_recommendations
        : [];
    const recommendedSources =
      resolvedSession &&
      resolvedSession.effective &&
      Array.isArray(resolvedSession.effective.recommended_sources)
        ? resolvedSession.effective.recommended_sources
        : [];
    const adapterHealth = adapterQualityHelpers.summarizeAdapterHealth(
      toolRecommendations,
      recommendedSources
    );
    const adapterReusability = adapterQualityHelpers.summarizeAdapterReusability(adapterHealth);
    const primaryRecommendation = adapterHealth.primary
      ? toolRecommendations.find(item => item.tool === adapterHealth.primary.tool) || toolRecommendations[0]
      : toolRecommendations[0];
    const primaryToolExecution =
      primaryRecommendation
        ? buildToolExecutionFromRecommendation(primaryRecommendation)
        : null;

    if (toolRecommendations.length > 0) {
      checks.push(
        createCheck(
          'chip_support_quality',
          adapterHealth.status,
          adapterHealth.primary && adapterHealth.primary.executable
            ? `Preferred tool ${adapterHealth.primary.tool} has reached executable trust level`
            : `Preferred tool ${adapterHealth.primary ? adapterHealth.primary.tool : '(none)'} still needs more chip-support evidence`,
          adapterHealth.primary
            ? [
                `tool=${adapterHealth.primary.tool}`,
                `score=${adapterHealth.primary.score}`,
                `grade=${adapterHealth.primary.grade}`,
                `action=${adapterHealth.primary.recommended_action}`
              ]
            : [],
          adapterHealth.primary && !adapterHealth.primary.executable
            ? `Handle ${adapterHealth.primary.recommended_action} first before using tool results as ground truth.`
            : ''
        )
      );

      checks.push(
        createCheck(
          'binding_quality',
          adapterHealth.binding_ready_tools > 0 && adapterHealth.draft_binding_tools === 0 ? 'pass' : 'warn',
          adapterHealth.binding_ready_tools > 0
            ? 'Tool binding identified'
            : 'There is no stable tool binding yet',
          [
            `binding_ready_tools=${adapterHealth.binding_ready_tools}`,
            `draft_binding_tools=${adapterHealth.draft_binding_tools}`
          ],
          adapterHealth.binding_ready_tools > 0 && adapterHealth.draft_binding_tools === 0
            ? ''
            : 'Add device/family binding first so the runtime route does not exist without a stable algorithm entry.'
        )
      );

      checks.push(
        createCheck(
          'register_summary_available',
          adapterHealth.register_summary_available ? 'pass' : 'warn',
          adapterHealth.register_summary_available
            ? 'Register summary sources found'
            : 'Register summary sources are still missing',
          adapterHealth.register_summary_available
            ? recommendedSources
                .filter(item => item.priority_group === 'register-summary')
                .slice(0, 3)
                .map(item => item.path)
            : [],
          adapterHealth.register_summary_available
            ? ''
            : 'Add a register summary to source_refs to make later timer/pwm/comparator tools much easier to verify.'
        )
      );

      checks.push(
        createCheck(
          'chip_support_reusability',
          adapterReusability.status === 'reusable' ? 'pass' : adapterReusability.status === 'reusable-candidate' ? 'warn' : 'info',
          adapterReusability.status === 'reusable'
            ? 'Current chip support is reusable across projects'
            : adapterReusability.status === 'reusable-candidate'
              ? 'Current chip support looks reusable after review'
              : 'Current chip support should stay project-local for now',
          [
            `status=${adapterReusability.status}`,
            `action=${adapterReusability.recommended_action}`,
            adapterReusability.primary_tool ? `tool=${adapterReusability.primary_tool}` : ''
          ].filter(Boolean),
          adapterReusability.status === 'reusable'
            ? ''
            : adapterReusability.status === 'reusable-candidate'
              ? 'Keep this as a reusable candidate and let a maintainer review it before publishing into a shared catalog.'
              : 'Finish the chip-support evidence and bindings locally before treating it as reusable.'
        )
      );
    }

    if (primaryToolExecution && primaryToolExecution.cli) {
      pushNextCommand(
        nextCommands,
        'tool-run-primary',
        primaryToolExecution.recommended
          ? `Run preferred tool: ${primaryToolExecution.tool}`
          : `Prepare the first tool draft: ${primaryToolExecution.tool}`,
        primaryToolExecution.cli,
        'tool',
        {
          argv: ['tool', 'run', primaryToolExecution.tool]
        }
      );
    }

    const summary = summarizeChecks(checks);

    if (nextCommands.length === 0 && summary.status !== 'fail') {
      pushNextCommand(
        nextCommands,
        'next',
        'Enter the emb-agent recommended next step',
        runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['next']),
        'command',
        {
          argv: ['next']
        }
      );
    }

    const bootstrap = buildBootstrapPlan(
      projectRoot,
      workspaceTrust,
      hardwareIdentity,
      nextCommands,
      pendingDocApply,
      pendingSourceIntake,
      checks,
      adapterReusability
    );

    return {
      command: 'health',
      project_root: projectRoot,
      runtime_host: runtimeHost.name || RUNTIME_HOST.name,
      status: summary.status,
      summary: summary.counts,
      checks,
      startup_automation: buildStartupAutomationSummary(workspaceTrust),
      subagent_bridge: subagentBridge,
      chip_support_health: {
        ...adapterHealth,
        reusability: adapterReusability
      },
      recommended_flow:
        latestHardwareDocProtocol && latestHardwareDocProtocol.recommended_flow
          ? latestHardwareDocProtocol.recommended_flow
          : null,
      handoff_protocol:
        latestHardwareDocProtocol && latestHardwareDocProtocol.handoff_protocol
          ? latestHardwareDocProtocol.handoff_protocol
          : null,
      next_commands: nextCommands,
      quickstart: buildQuickstartHint(
        workspaceTrust,
        hardwareIdentity,
        nextCommands,
        pendingDocApply,
        pendingSourceIntake,
        checks,
        projectRoot,
        adapterReusability
      ),
      bootstrap,
      action_card: bootstrap.action_card || buildActionCardFromBootstrap(bootstrap),
      recommendations: runtime.unique(
        checks
          .filter(item => item.status === 'fail' || item.status === 'warn')
          .map(item => item.recommendation)
          .filter(Boolean)
      )
    };
  }

  function buildUpdateView(forceCheck) {
    const projectRoot = resolveProjectRoot();
    const projectExtDir = getProjectExtDir();
    const statePaths = getProjectStatePaths();
    const projectDataPath = runtime.resolveProjectDataPath(projectRoot, 'project.json');
    const hadProjectLayout = fs.existsSync(projectExtDir) || fs.existsSync(projectDataPath);
    const workflowLayout = hadProjectLayout
      ? workflowRegistry.syncProjectWorkflowLayout(projectExtDir, { write: false })
      : {
          project_ext_dir: projectExtDir,
          registry_path: 'registry/workflow.json',
          created: [],
          migrated: [],
          reused: []
        };
    const cachePath = updateCheckHelpers.getUpdateCachePath(path, RUNTIME_HOST.stateRoot);
    const installed = updateCheckHelpers.readInstalledVersion(fs, path, RUNTIME_HOST.runtimeRoot);
    const hookVersion = process.env.EMB_AGENT_FORCE_HOOK_VERSION || readHookVersion();
    const cache = updateCheckHelpers.readUpdateCache(fs, cachePath);
    const staleInstall = updateCheckHelpers.detectStaleInstall(installed, hookVersion);
    const trigger = updateCheckHelpers.triggerUpdateCheck({
      fs,
      path,
      childProcess,
      process,
      cachePath,
      installed,
      packageName: 'emb-agent',
      intervalMs: UPDATE_CHECK_INTERVAL_MS,
      cache,
      force: Boolean(forceCheck)
    });
    const latestCache = updateCheckHelpers.readUpdateCache(fs, cachePath) || cache;

    const recommendations = [];
    if (staleInstall) {
      recommendations.push('Re-run emb-agent install first to align hooks / runtime / agents versions.');
    }
    if (latestCache && latestCache.update_available && latestCache.latest) {
      recommendations.push('A new version was detected. Read the release notes first, then reinstall runtime.');
    }
    if (trigger.triggered) {
      recommendations.push('A background version check has been triggered. Run update again later to see the latest result.');
    }
    if (recommendations.length === 0) {
      recommendations.push('There is no explicit upgrade blocker right now. Run update check if you want to confirm the latest version.');
    }
    if (workflowLayout.migrated.length > 0) {
      recommendations.push('Legacy workflow registry paths were migrated into .emb-agent/registry/workflow.json.');
    }
    if (workflowLayout.created.length > 0) {
      recommendations.push('Project workflow layout was normalized so spec/template/registry paths now share the same root.');
    }

    return {
      command: 'update',
      runtime_host: RUNTIME_HOST.name,
      session_state: runtime.buildSessionStateView(statePaths, {
        projectRoot
      }),
      installed_version: installed || '',
      hook_version: hookVersion || '',
      stale_install: staleInstall,
      cache: latestCache
        ? {
            installed: latestCache.installed || '',
            latest: latestCache.latest || '',
            checked_at: latestCache.checked_at || 0,
            update_available: Boolean(latestCache.update_available),
            status: latestCache.status || 'unknown',
            error: latestCache.error || ''
          }
        : null,
      check: {
        triggered: trigger.triggered,
        reason: trigger.reason || '',
        cache_path: cachePath,
        stale: updateCheckHelpers.isUpdateCacheStale(cache, UPDATE_CHECK_INTERVAL_MS)
      },
      workflow_layout: {
        project_ext_dir: projectExtDir,
        registry_path: workflowLayout.registry_path,
        created: workflowLayout.created,
        migrated: workflowLayout.migrated,
        reused: workflowLayout.reused
      },
      recommendations
    };
  }

  function handleHealthUpdateCommands(cmd, subcmd, rest) {
    if (cmd === 'health') {
      if (subcmd && subcmd !== 'show') {
        throw new Error(`Unknown health subcommand: ${subcmd}`);
      }
      if (rest && rest.length > 0) {
        throw new Error('health does not accept positional arguments');
      }

      updateSession(current => {
        current.last_command = 'health';
      });
      return buildHealthReport();
    }

    if (cmd === 'bootstrap') {
      if (subcmd && subcmd !== 'show') {
        throw new Error(`Unknown bootstrap subcommand: ${subcmd}`);
      }
      if (rest && rest.length > 0) {
        throw new Error('bootstrap does not accept positional arguments');
      }

      updateSession(current => {
        current.last_command = 'bootstrap';
      });
      return buildHealthReport().bootstrap;
    }

    if (cmd === 'update') {
      if (subcmd && subcmd !== 'show' && subcmd !== 'check') {
        throw new Error(`Unknown update subcommand: ${subcmd}`);
      }
      if (rest && rest.length > 0) {
        throw new Error('update does not accept extra positional arguments');
      }

      updateSession(current => {
        current.last_command = subcmd === 'check' ? 'update check' : 'update';
      });
      return buildUpdateView(subcmd === 'check');
    }

    return undefined;
  }

  return {
    buildHealthReport,
    buildBootstrapReport: () => buildHealthReport().bootstrap,
    buildUpdateView,
    handleHealthUpdateCommands,
    readHookVersion
  };
}

module.exports = {
  createHealthUpdateCommandHelpers
};
