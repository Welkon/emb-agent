'use strict';

const adapterQualityHelpers = require('./adapter-quality.cjs');
const defaultAdapterSourceHelpers = require('./default-adapter-source.cjs');
const hookTrustHelpers = require('./hook-trust.cjs');
const runtimeHostHelpers = require('./runtime-host.cjs');
const updateCheckHelpers = require('./update-check.cjs');
const workflowRegistry = require('./workflow-registry.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ADAPTER_SOURCE_BOOTSTRAP_CLI =
  `${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['adapter', 'bootstrap'])}`;
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
    loadPack,
    findChipProfileByModel,
    resolveSession,
    buildToolExecutionFromRecommendation,
    ingestDocCli,
    adapterSources,
    rootDir,
    getRuntimeHost,
    updateSession
  } = deps;

  function getDefaultAdapterSource() {
    return defaultAdapterSourceHelpers.resolveDefaultAdapterSource(RUNTIME_CONFIG, process && process.env);
  }

  function buildDefaultAdapterSourceAddCommand() {
    const source = getDefaultAdapterSource();
    const sourceArgs = defaultAdapterSourceHelpers.buildDefaultAdapterSourceArgs(source);

    return {
      cli: `${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['adapter', 'source', 'add', source.name])} ${sourceArgs.join(' ')}`,
      argv: ['adapter', 'source', 'add', source.name, ...sourceArgs]
    };
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
      manual: status === 'manual',
      blocking: ['ready', 'manual'].includes(status),
      evidence: Array.isArray(config.evidence) ? config.evidence.filter(Boolean) : []
    };
  }

  function buildBootstrapPlan(projectRoot, workspaceTrust, hardwareIdentity, nextCommands, pendingDocApply, checks) {
    const commands = Array.isArray(nextCommands) ? nextCommands : [];
    const allChecks = Array.isArray(checks) ? checks : [];
    const findCommand = (...keys) => commands.find(item => keys.includes(item.key));
    const findCheck = key => allChecks.find(item => item.key === key) || null;
    const initReady = [
      'emb_agent_dir',
      'project_config_file',
      'project_config_valid',
      'hw_truth',
      'req_truth',
      'docs_dir',
      'doc_cache_dir',
      'adapter_cache_dir',
      'adapters_dir'
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
    const bootstrap = findCommand('adapter-bootstrap', 'adapter-sync');
    const derive = findCommand('adapter-derive-from-doc');
    const next = findCommand('next');
    const stages = [];

    stages.push(
      createBootstrapStage(
        'init-project',
        initReady ? 'completed' : 'ready',
        'Initialize emb-agent project skeleton',
        {
          summary: initReady
            ? 'Project skeleton and base caches already exist'
            : 'Create or rebuild .emb-agent skeleton before later bootstrap stages',
          cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['init']),
          kind: 'command',
          argv: ['init'],
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
          'Startup hooks ready',
          {
            summary: trustReady
              ? (workspaceTrust && workspaceTrust.summary)
                ? workspaceTrust.summary
                : 'Startup hooks are available for automatic bootstrap flows'
              : 'Make sure the host has loaded emb-agent startup hooks before automatic bootstrap continues',
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
        'hardware-truth',
        !initReady || !trustReady ? 'pending' : hardwareReady ? 'completed' : 'manual',
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
        !initReady || !trustReady || !hardwareReady ? 'pending' : docApply ? 'ready' : 'completed',
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

    if (bootstrap || derive) {
      const command = bootstrap || derive;
      stages.push(
        createBootstrapStage(
          bootstrap ? 'adapter-bootstrap' : 'adapter-derive',
          !initReady || !trustReady || !hardwareReady || Boolean(docApply) ? 'pending' : 'ready',
          bootstrap ? 'Bootstrap matching adapters' : 'Derive adapter from hardware document',
          {
            summary: command.summary || '',
            cli: command.cli || '',
            kind: command.kind || '',
            argv: command.argv || [],
            evidence: [command.key || '']
          }
        )
      );
    } else {
      stages.push(
        createBootstrapStage(
          'adapter-bootstrap',
          !initReady || !trustReady || !hardwareReady || Boolean(docApply) ? 'pending' : 'completed',
          'Bootstrap matching adapters',
          {
            summary: 'Adapter registration and matching bootstrap are already closed'
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
            ? 'Finish earlier bootstrap stages first, then enter next'
            : 'Bootstrap prerequisites are closed; continue with next',
          cli: next ? next.cli : NEXT_CLI,
          kind: 'command',
          argv: ['next']
        }
      )
    );

    const nextStage = stages.find(item => ['ready', 'manual'].includes(item.status)) || null;
    const quickstartStage = nextStage
      ? nextStage.id === 'hardware-truth'
        ? 'fill-hardware-identity'
        : nextStage.id === 'startup-hooks'
          ? 'restart-host-hooks'
        : nextStage.id === 'doc-truth-sync'
          ? 'doc-apply-then-next'
          : nextStage.id === 'adapter-derive'
            ? 'derive-then-next'
            : nextStage.id === 'adapter-bootstrap'
              ? 'bootstrap-then-next'
              : 'next'
      : 'next';
    const quickstartSteps = [
      ...(nextStage
        ? [
            {
              label: nextStage.label,
              cli: nextStage.cli || ''
            }
          ]
        : []),
      ...(nextStage && nextStage.id !== 'next-step'
        ? [
            {
              label: 'Enter the emb-agent recommended next step',
              cli: NEXT_CLI
            }
          ]
        : [])
    ];

    return {
      command: 'bootstrap',
      project_root: projectRoot,
      runtime_host: RUNTIME_HOST.name,
      status: nextStage ? (nextStage.status === 'manual' ? 'manual' : 'ready') : 'complete',
      summary: nextStage
        ? nextStage.summary || nextStage.label
        : 'Bootstrap prerequisites are already closed',
      current_stage: nextStage ? nextStage.id : '',
      next_stage: nextStage,
      stages,
      quickstart: {
        stage: quickstartStage,
        summary: nextStage
          ? nextStage.summary || nextStage.label
          : 'Bootstrap prerequisites are already closed; run next directly',
        steps: quickstartSteps,
        followup:
          nextStage && nextStage.cli
            ? nextStage.id === 'next-step'
            ? `Run first: ${nextStage.cli}`
            : `Run first: ${nextStage.cli} -> ${NEXT_CLI}`
            : nextStage && nextStage.id === 'startup-hooks'
              ? `Restart the host once so emb-agent startup hooks are active, then rerun: ${HEALTH_CLI}`
            : nextStage && nextStage.id === 'hardware-truth'
              ? `After hardware truth is complete, run directly: ${DEFAULT_ADAPTER_SOURCE_BOOTSTRAP_CLI} -> ${NEXT_CLI}`
              : `Run first: ${NEXT_CLI}`
      },
      startup_automation: buildStartupAutomationSummary(workspaceTrust)
    };
  }

  function buildQuickstartHint(workspaceTrust, hardwareIdentity, nextCommands, pendingDocApply, checks, projectRoot) {
    const bootstrap = buildBootstrapPlan(projectRoot, workspaceTrust, hardwareIdentity, nextCommands, pendingDocApply, checks);
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

  function buildAdapterDeriveCli(docEntry) {
    if (!docEntry || !docEntry.doc_id) {
      return '';
    }

    return runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, [
      'adapter',
      'derive',
      '--from-project',
      '--from-doc',
      docEntry.doc_id
    ]);
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
    const adapterCacheDir = path.join(projectExtDir, 'cache', 'adapter-sources');
    const adaptersDir = path.join(projectExtDir, 'adapters');
    const statePaths = getProjectStatePaths();
    const checks = [];
    const nextCommands = [];
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
          : 'Restart the host once so emb-agent startup hooks can activate, then rerun health.'
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
                `packs=${(projectConfig.active_packs || []).join(',') || '(none)'}`,
                `adapter_sources=${(projectConfig.adapter_sources || []).length}`
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
      ['hw_truth', hwPath, 'hw.yaml exists', 'hw.yaml is missing', `Complete ${runtime.getProjectAssetRelativePath('hw.yaml')} first to record MCU / pin / constraint ground truth.`],
      ['req_truth', reqPath, 'req.yaml exists', 'req.yaml is missing', `Complete ${runtime.getProjectAssetRelativePath('req.yaml')} first to record goals / features / acceptance.`],
      ['docs_dir', docsDir, 'docs directory exists', 'docs directory is missing', 'Create the docs directory first so later document ingestion and durable report persistence have a place to land.'],
      ['doc_cache_dir', docCacheDir, 'Document cache directory exists', 'Document cache directory is missing', `Run init again to create ${runtime.getProjectAssetRelativePath('cache', 'docs')}.`],
      ['adapter_cache_dir', adapterCacheDir, 'Adapter cache directory exists', 'Adapter cache directory is missing', `Run init again to create ${runtime.getProjectAssetRelativePath('cache', 'adapter-sources')}.`],
      ['adapters_dir', adaptersDir, 'Adapter directory exists', 'Adapter directory is missing', `Run init again to create ${runtime.getProjectAssetRelativePath('adapters')}.`]
    ].forEach(([key, targetPath, passSummary, failSummary, recommendation]) => {
      const exists = fs.existsSync(targetPath);
      checks.push(
        createCheck(
          key,
          exists ? 'pass' : 'fail',
          exists ? passSummary : failSummary,
          [path.relative(projectRoot, targetPath)],
          exists ? '' : recommendation
        )
      );
    });

    if (fs.existsSync(statePaths.sessionPath)) {
      try {
        rawSession = runtime.readJson(statePaths.sessionPath);
        normalizedSession = normalizeSession(rawSession, statePaths);
        checks.push(
          createCheck(
            'session_state',
            'pass',
            'Session state file is readable',
            [
              path.relative(projectRoot, statePaths.sessionPath),
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
            [error.message],
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
          [path.relative(projectRoot, statePaths.sessionPath)],
          'Run init, next, or resume once so emb-agent can establish project session state.'
        )
      );
      pushNextCommand(
        nextCommands,
        'init',
        'Initialize or rebuild the emb-agent skeleton for the current project',
        runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['init']),
        'command',
        {
          argv: ['init']
        }
      );
    }

    if (fs.existsSync(statePaths.handoffPath)) {
      try {
        handoff = runtime.validateHandoff(runtime.readJson(statePaths.handoffPath), RUNTIME_CONFIG);
        checks.push(
          createCheck(
            'handoff_state',
            'warn',
            'An unconsumed handoff exists',
            [
              path.relative(projectRoot, statePaths.handoffPath),
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
            [error.message],
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

    const desiredPacks =
      projectConfig && Array.isArray(projectConfig.active_packs) && projectConfig.active_packs.length > 0
        ? projectConfig.active_packs
        : RUNTIME_CONFIG.default_packs;
    const unresolvedPacks = [];
    desiredPacks.forEach(name => {
      try {
        loadPack(name);
      } catch (error) {
        unresolvedPacks.push(`${name}: ${error.message}`);
      }
    });
    checks.push(
      createCheck(
        'pack_resolution',
        unresolvedPacks.length > 0 ? 'fail' : 'pass',
        unresolvedPacks.length > 0 ? 'There are unresolved packs' : 'Current packs are resolvable',
        unresolvedPacks.length > 0
          ? unresolvedPacks
          : [`packs=${desiredPacks.join(',') || '(none)'}`],
        unresolvedPacks.length > 0 ? 'Fix the packs in project.json or add the matching pack.yaml.' : ''
      )
    );

    const hardwareIdentity = loadHardwareIdentity();
    if (!hardwareIdentity.model) {
      checks.push(
        createCheck(
          'hardware_identity',
          'warn',
          'hw.yaml does not contain the chip identity yet',
          [hardwareIdentity.file],
          `If the chip is already known, add chip/package to ${runtime.getProjectAssetRelativePath('hw.yaml')} so emb-agent can match chip profiles later. If the project is still at concept stage, record goals and constraints in ${runtime.getProjectAssetRelativePath('req.yaml')} first and leave ${runtime.getProjectAssetRelativePath('hw.yaml')} unknown until a real candidate exists.`
        )
      );
    } else {
      const chipProfile = findChipProfileByModel(hardwareIdentity.model, hardwareIdentity.package);
      checks.push(
        createCheck(
          'hardware_identity',
          chipProfile ? 'pass' : 'warn',
          chipProfile ? 'The chip model is mapped to a chip profile' : 'The chip model is not mapped to a chip profile yet',
          chipProfile
            ? [
                `model=${hardwareIdentity.model}`,
                `chip_profile=${chipProfile.name}`,
                `family=${chipProfile.family}`
              ]
            : [`model=${hardwareIdentity.model}`],
          chipProfile ? '' : 'Tool auto-discovery can fully connect only after the adapter/chip profile is added.'
        )
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
          'adapter_sources_registered',
          enabledSources.length > 0 ? 'pass' : 'warn',
          enabledSources.length > 0 ? 'Adapter sources are registered' : 'No adapter source is registered yet',
          enabledSources.length > 0
            ? enabledSources.map(item => `source=${item.name}`)
            : [`${runtime.getProjectAssetRelativePath('project.json')} -> adapter_sources`],
          enabledSources.length > 0
            ? ''
            : 'Run adapter source add first to register the default adapter source or your private source into the project. Private git sources reuse the host git credentials that are already configured.'
        )
      );
      if (enabledSources.length === 0) {
        const addCommand = buildDefaultAdapterSourceAddCommand();
        pushNextCommand(
          nextCommands,
          hardwareIdentity.model ? 'adapter-bootstrap' : 'adapter-source-add',
          hardwareIdentity.model ? 'Register the default adapter source and sync it against the current project' : 'Register the default adapter source',
          hardwareIdentity.model
            ? DEFAULT_ADAPTER_SOURCE_BOOTSTRAP_CLI
            : addCommand.cli,
          'adapter',
          {
            argv: hardwareIdentity.model
              ? ['adapter', 'bootstrap']
              : addCommand.argv
          }
        );
      }

      checks.push(
        createCheck(
          'adapter_sync_project',
          syncedProjectSources.length > 0 ? 'pass' : enabledSources.length > 0 ? 'warn' : 'info',
          syncedProjectSources.length > 0
            ? 'Adapters have been synced into the project directory'
            : enabledSources.length > 0
              ? 'The adapter source is registered but not synced yet'
              : 'There is no adapter source available to sync yet',
          syncedProjectSources.length > 0
            ? syncedProjectSources.map(item => `source=${item.name}, files=${item.targets.project.files_count}`)
            : enabledSources.length > 0
              ? enabledSources.map(item => `source=${item.name}`)
              : [],
          syncedProjectSources.length > 0
            ? ''
            : enabledSources.length > 0
              ? `Run adapter sync ${enabledSources[0].name} to place matched adapters/profiles into the project.`
              : ''
        )
      );
      if (enabledSources.length > 0 && syncedProjectSources.length === 0) {
        pushNextCommand(
          nextCommands,
          hardwareIdentity.model ? 'adapter-bootstrap' : 'adapter-sync',
          hardwareIdentity.model ? 'Sync the adapter source against the current project' : 'Sync the registered adapter source into the current project',
          hardwareIdentity.model
            ? runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['adapter', 'bootstrap', enabledSources[0].name])
            : runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['adapter', 'sync', enabledSources[0].name]),
          'adapter',
          {
            argv: hardwareIdentity.model
              ? ['adapter', 'bootstrap', enabledSources[0].name]
              : ['adapter', 'sync', enabledSources[0].name]
          }
        );
      }

      if (hardwareIdentity.model) {
        checks.push(
          createCheck(
            'adapter_match',
            matchedProjectSources.length > 0 ? 'pass' : syncedProjectSources.length > 0 ? 'warn' : 'info',
            matchedProjectSources.length > 0
              ? 'A subset of adapters matching the current hardware was found'
              : syncedProjectSources.length > 0
                ? 'Adapters are synced, but a match for current hardware is not confirmed yet'
                : 'Wait until adapter source sync completes before checking match results',
            matchedProjectSources.length > 0
              ? matchedProjectSources.map(item => {
                  const selection = item.targets.project.selection;
                  const chips = (selection && selection.matched && selection.matched.chips) || [];
                  const tools = (selection && selection.matched && selection.matched.tools) || [];
                  return `source=${item.name}, chips=${chips.join(',') || '(none)'}, tools=${tools.join(',') || '(none)'}`;
                })
              : syncedProjectSources.length > 0
                ? syncedProjectSources.map(item => {
                    const selection = item.targets.project.selection;
                    return selection && selection.filtered === false
                      ? `source=${item.name}, mode=full-sync`
                      : `source=${item.name}, matched_chips=${((selection && selection.matched && selection.matched.chips) || []).join(',') || '(none)'}`;
                  })
                : [`model=${hardwareIdentity.model}`, `package=${hardwareIdentity.package || '(empty)'}`],
            matchedProjectSources.length > 0
              ? ''
              : syncedProjectSources.length > 0
                ? 'Check whether the chip model/package in hw.yaml is accurate, or add the corresponding family/device/chip profiles.'
                : 'Fill in the chip model/package in hw.yaml first, then run adapter sync so emb-agent can automatically select the adapters needed by the current chip.'
          )
        );
      }

      const latestHardwareDoc = findLatestHardwareDoc(projectRoot, pendingDocApply);
      if (
        hardwareIdentity.model &&
        syncedProjectSources.length > 0 &&
        matchedProjectSources.length === 0 &&
        latestHardwareDoc
      ) {
        checks.push(
          createCheck(
            'adapter_derive_candidate',
            'warn',
            `The latest hardware document ${latestHardwareDoc.doc_id} can be used directly to draft an adapter`,
            [
              latestHardwareDoc.title ? `title=${latestHardwareDoc.title}` : '',
              latestHardwareDoc.source ? `source=${latestHardwareDoc.source}` : '',
              latestHardwareDoc.cached_at ? `cached_at=${latestHardwareDoc.cached_at}` : ''
            ],
            'Draft an adapter from the latest hardware document first, then run next; this is safer than guessing family/device/chip manually.'
          )
        );
        pushNextCommand(
          nextCommands,
          'adapter-derive-from-doc',
          `Draft an adapter for current hardware from document ${latestHardwareDoc.doc_id}`,
          buildAdapterDeriveCli(latestHardwareDoc),
          'adapter',
          {
            argv: ['adapter', 'derive', '--from-project', '--from-doc', latestHardwareDoc.doc_id]
          }
        );
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
          'adapter_quality',
          adapterHealth.status,
          adapterHealth.primary && adapterHealth.primary.executable
            ? `Preferred tool ${adapterHealth.primary.tool} has reached executable trust level`
            : `Preferred tool ${adapterHealth.primary ? adapterHealth.primary.tool : '(none)'} still needs more adapter evidence`,
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

    const bootstrap = buildBootstrapPlan(projectRoot, workspaceTrust, hardwareIdentity, nextCommands, pendingDocApply, checks);

    return {
      command: 'health',
      project_root: projectRoot,
      runtime_host: runtimeHost.name || RUNTIME_HOST.name,
      status: summary.status,
      summary: summary.counts,
      checks,
      startup_automation: buildStartupAutomationSummary(workspaceTrust),
      subagent_bridge: subagentBridge,
      adapter_health: adapterHealth,
      next_commands: nextCommands,
      quickstart: buildQuickstartHint(workspaceTrust, hardwareIdentity, nextCommands, pendingDocApply, checks, projectRoot),
      bootstrap,
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
    const projectDataPath = runtime.resolveProjectDataPath(projectRoot, 'project.json');
    const hadProjectLayout = fs.existsSync(projectExtDir) || fs.existsSync(projectDataPath);
    const workflowLayout = hadProjectLayout
      ? workflowRegistry.syncProjectWorkflowLayout(projectExtDir, { write: true })
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
