'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./runtime.cjs');
const runtimeHostHelpers = require('./runtime-host.cjs');
const qualityGateHelpers = require('./quality-gates.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);

const ACTIONS = ['scan', 'plan', 'do', 'debug', 'review', 'verify', 'forensics', 'note'];

const READ_HINTS = {
  hardware_truth: 'Hardware truth sources: datasheet / schematic / pin map',
  registers: 'Registers and bit definitions: manual register chapter / headers',
  entry_points: 'Code entry points: reset / main loop / ISR entry',
  shared_state: 'Shared state: variables / flags shared by ISR and main loop',
  tasks: 'Task entry points: task creation sites / main task loops',
  queues: 'Message paths: queue / mailbox / event path',
  mutexes: 'Synchronization primitives: mutex / lock / critical section',
  timers: 'Timing paths: software timer / hardware timer / callback',
  connectivity_state: 'Connectivity state: reconnect / offline / cloud sync state machine',
  ota_path: 'Upgrade path: version check / download / switch / rollback'
};

const AGENT_PURPOSES = {
  'hw-scout': 'Lock hardware truth, registers, pins, timing, and board-level constraints',
  'fw-doer': 'Execute the smallest code or documentation change and report scope and verification results',
  'bug-hunter': 'Converge on root cause by symptom -> hypothesis -> check -> result -> next step',
  'sys-reviewer': 'Inspect task boundaries, concurrency paths, state sync, and recovery paths',
  'release-checker': 'Inspect upgrade, rollback, offline defaults, and release closure',
  'arch-reviewer': 'Run a pre-mortem review for selection, architecture pressure, and production risk'
};

const AGENT_OWNERSHIP = {
  'hw-scout': 'Own only fact-finding and truth-source localization; do not implement product changes directly',
  'fw-doer': 'Own only implementation within the locked change surface plus minimal verification; do not expand into refactors',
  'bug-hunter': 'Own only the debugging loop and hypothesis elimination; do not replace the final implementation',
  'sys-reviewer': 'Own only structural review; do not present style issues as structural issues',
  'release-checker': 'Own only release closure and recovery paths; do not drive product implementation',
  'arch-reviewer': 'Own only system-level preflight review; do not replace the implementation agent'
};

function getProjectTruthFiles(resolved) {
  const projectRoot = resolved && resolved.session ? resolved.session.project_root : '';
  if (!projectRoot) {
    return [];
  }

  const candidates = [
    runtime.getProjectAssetRelativePath('hw.yaml'),
    runtime.getProjectAssetRelativePath('req.yaml')
  ];

  return candidates.filter(file => fs.existsSync(path.join(projectRoot, file)));
}

function ensureResolved(resolved) {
  if (!resolved || typeof resolved !== 'object') {
    throw new Error('Resolved session is required');
  }
  if (!resolved.session || !resolved.profile || !resolved.effective) {
    throw new Error('Resolved session is missing required sections');
  }
}

function hasAgent(resolved, name) {
  return (resolved.effective.agents || []).includes(name);
}

function hasPack(resolved, name) {
  return (resolved.packs || []).some(pack => pack.name === name);
}

function buildContext(resolved) {
  ensureResolved(resolved);

  const focus = resolved.session.focus || '';
  const lastFiles = resolved.session.last_files || [];
  const openQuestions = resolved.session.open_questions || [];
  const knownRisks = resolved.session.known_risks || [];
  const packNames = (resolved.packs || []).map(pack => pack.name);
  const focusAreas = resolved.effective.focus_areas || [];
  const preferences = runtime.normalizePreferences(resolved.session.preferences || {});

  return {
    focus,
    lastFiles,
    openQuestions,
    knownRisks,
    packNames,
    focusAreas,
    preferences,
    isBaremetal: resolved.profile.runtime_model === 'main_loop_plus_isr',
    isRtos:
      resolved.profile.runtime_model === 'task_scheduler_plus_isr' ||
      (resolved.profile.concurrency_model || '').includes('tasks'),
    isConnected:
      hasPack(resolved, 'connected-appliance') ||
      (resolved.effective.review_axes || []).includes('reconnect_strategy'),
    isSensor:
      hasPack(resolved, 'sensor-node') ||
      focusAreas.includes('sampling') ||
      focusAreas.includes('calibration')
  };
}

function buildPreferredReadKeys(resolved) {
  const context = buildContext(resolved);
  const searchPriority = resolved.effective.search_priority || [];
  const hardwareKeys = ['hardware_truth', 'registers'];
  const hardwareFirst = searchPriority.filter(key => hardwareKeys.includes(key));
  const codeFirst = searchPriority.filter(key => !hardwareKeys.includes(key));

  if (context.preferences.truth_source_mode === 'code_first') {
    return runtime.unique([...codeFirst, ...hardwareFirst]);
  }

  return runtime.unique([...hardwareFirst, ...codeFirst]);
}

function buildFocusOrder(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    context.focus ? `Current focus: ${context.focus}` : '',
    ...context.focusAreas.map(area => `Scenario focus: ${area}`),
    ...context.lastFiles.map(file => `Recent file: ${file}`),
    ...context.openQuestions.slice(0, 2).map(question => `Open question: ${question}`),
    ...context.knownRisks.slice(0, 2).map(risk => `Known risk: ${risk}`)
  ]);
}

function buildSafetyChecks(action, resolved) {
  const context = buildContext(resolved);
  const guardrails = resolved.effective.guardrails || [];
  const checks = [
    ...guardrails.map(item => `guardrail: ${item}`)
  ];

  if (action === 'scan') {
    checks.push('Read truth sources before drawing conclusions');
    checks.push('Separate explicit documentation from engineering inference');
  }

  if (action === 'do') {
    checks.push('Locate the real implementation site before changing anything');
    checks.push('Default to the smallest, shallowest, most direct implementation');
    if (context.isBaremetal) {
      checks.push('Before changing ISR or shared state, re-check interrupt paths and timing windows');
    }
    if (context.isConnected) {
      checks.push('Before changing connectivity or upgrade behavior, re-check offline defaults and recovery paths');
    }
  }

  if (action === 'plan') {
    checks.push('Only produce a task-level micro-plan; do not expand into phase planning');
    checks.push('Clarify truth sources, constraints, and verification before sequencing steps');
    if (context.isBaremetal) {
      checks.push('When pins, registers, timing, or ISR are involved, lock hardware truth first');
    }
    if (context.isConnected) {
      checks.push('When connectivity, upgrade, or rollback is involved, cover offline defaults and recovery paths');
    }
  }

  if (action === 'debug') {
    checks.push('Converge to 1 to 3 high-value hypotheses');
    checks.push('Validate only one hypothesis at a time, and make the result eliminate branches');
  }

  if (action === 'review') {
    checks.push('This is not a code-style review');
    checks.push('Separate confirmed risks from risks that still need verification');
  }

  if (action === 'verify') {
    checks.push('Separate bench evidence, code inference, and document assumptions');
    checks.push('Every check item must report pass / fail / untested');
    checks.push('Failed items must be written back to risk, question, or note');
  }

  if (action === 'forensics') {
    checks.push('Base conclusions only on the current session, handoff, reports, and project facts');
    checks.push('Do not present forensics output as the final fix');
  }

  if (action === 'note') {
    checks.push('Record only durable conclusions, not session fragments');
    checks.push('Every conclusion must note its basis and any unverified items');
  }

  return runtime.unique(checks);
}

function choosePrimaryAgent(action, resolved) {
  const context = buildContext(resolved);

  if (action === 'scan') {
    return hasAgent(resolved, 'hw-scout') ? 'hw-scout' : (resolved.effective.agents || [])[0] || '';
  }
  if (action === 'do') {
    return hasAgent(resolved, 'fw-doer') ? 'fw-doer' : (resolved.effective.agents || [])[0] || '';
  }
  if (action === 'plan') {
    if (context.isRtos && hasAgent(resolved, 'sys-reviewer')) {
      return 'sys-reviewer';
    }
    if (context.isBaremetal && hasAgent(resolved, 'hw-scout')) {
      return 'hw-scout';
    }
    return (resolved.effective.agents || [])[0] || '';
  }
  if (action === 'debug') {
    return hasAgent(resolved, 'bug-hunter')
      ? 'bug-hunter'
      : (hasAgent(resolved, 'hw-scout') ? 'hw-scout' : (resolved.effective.agents || [])[0] || '');
  }
  if (action === 'review') {
    if (hasAgent(resolved, 'sys-reviewer')) {
      return 'sys-reviewer';
    }
    if (context.isBaremetal && hasAgent(resolved, 'hw-scout')) {
      return 'hw-scout';
    }
    return (resolved.effective.review_agents || [])[0] || (resolved.effective.agents || [])[0] || '';
  }
  if (action === 'forensics') {
    return hasAgent(resolved, 'bug-hunter')
      ? 'bug-hunter'
      : (hasAgent(resolved, 'hw-scout') ? 'hw-scout' : (resolved.effective.agents || [])[0] || '');
  }
  if (action === 'verify') {
    if (context.isConnected && hasAgent(resolved, 'release-checker')) {
      return 'release-checker';
    }
    if (context.isRtos && hasAgent(resolved, 'sys-reviewer')) {
      return 'sys-reviewer';
    }
    return hasAgent(resolved, 'hw-scout')
      ? 'hw-scout'
      : (hasAgent(resolved, 'fw-doer') ? 'fw-doer' : (resolved.effective.agents || [])[0] || '');
  }
  if (action === 'note') {
    return hasAgent(resolved, 'fw-doer')
      ? 'fw-doer'
      : (hasAgent(resolved, 'hw-scout') ? 'hw-scout' : (resolved.effective.agents || [])[0] || '');
  }

  throw new Error(`Unsupported action: ${action}`);
}

function chooseSupportingAgents(action, resolved, primaryAgent) {
  const context = buildContext(resolved);
  const agents = resolved.effective.agents || [];
  const reviewAgents = resolved.effective.review_agents || [];

  if (action === 'scan') {
    return runtime.unique([
      hasAgent(resolved, 'fw-doer') ? 'fw-doer' : '',
      context.openQuestions.length > 0 && hasAgent(resolved, 'bug-hunter') ? 'bug-hunter' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'do') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      context.openQuestions.length > 0 && hasAgent(resolved, 'bug-hunter') ? 'bug-hunter' : '',
      context.isConnected && hasAgent(resolved, 'release-checker') ? 'release-checker' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'plan') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      hasAgent(resolved, 'fw-doer') ? 'fw-doer' : '',
      context.openQuestions.length > 0 && hasAgent(resolved, 'bug-hunter') ? 'bug-hunter' : '',
      context.isConnected && hasAgent(resolved, 'release-checker') ? 'release-checker' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'debug') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      hasAgent(resolved, 'fw-doer') ? 'fw-doer' : '',
      context.isRtos && hasAgent(resolved, 'sys-reviewer') ? 'sys-reviewer' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'review') {
    return reviewAgents.filter(name => name !== primaryAgent);
  }

  if (action === 'forensics') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      context.isRtos && hasAgent(resolved, 'sys-reviewer') ? 'sys-reviewer' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'verify') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      hasAgent(resolved, 'fw-doer') ? 'fw-doer' : '',
      context.isRtos && hasAgent(resolved, 'sys-reviewer') ? 'sys-reviewer' : '',
      context.isConnected && hasAgent(resolved, 'release-checker') ? 'release-checker' : ''
    ]).filter(name => name !== primaryAgent);
  }

  if (action === 'note') {
    return runtime.unique([
      hasAgent(resolved, 'hw-scout') ? 'hw-scout' : '',
      context.isConnected && hasAgent(resolved, 'release-checker') ? 'release-checker' : ''
    ]).filter(name => name !== primaryAgent);
  }

  return agents.filter(name => name !== primaryAgent);
}

function toInstalledAgentName(name) {
  if (!name) {
    return '';
  }

  return name.startsWith('emb-') ? name : `emb-${name}`;
}

function buildSpawnFallback(agentName, role) {
  const installedAgent = toInstalledAgentName(agentName);
  let fallbackType = 'default';

  if (agentName === 'hw-scout') {
    fallbackType = 'explorer';
  } else if (agentName === 'fw-doer') {
    fallbackType = 'worker';
  } else if (agentName === 'bug-hunter') {
    fallbackType = 'default';
  } else if (agentName === 'sys-reviewer' || agentName === 'release-checker') {
    fallbackType = 'explorer';
  } else if (agentName === 'arch-reviewer') {
    fallbackType = 'default';
  }

  return {
    supported: true,
    preferred_launch: installedAgent,
    fallback_tool: 'spawn_agent',
    fallback_agent_type: fallbackType,
    role,
    instructions_source_cli: runtimeHostHelpers.buildCliCommand(
      RUNTIME_HOST,
      ['agents', 'show', installedAgent]
    ),
    prompt_contract: [
      `Read the agent instructions for ${installedAgent} first`,
      'Then execute with the context_bundle and expected_output from dispatch_contract',
      'Let the main thread integrate the output instead of replacing the main-thread conclusion'
    ]
  };
}

function buildAgentCall(action, agentName, role, context) {
  let when = 'Call this agent only when the current action needs its specialization';
  let blocking = role === 'primary';

  if (agentName === 'hw-scout') {
    when = context.isBaremetal
      ? 'Call it first when registers, pins, timing, board connections, or manual truth are involved'
      : 'Call it when hardware boundaries, interface definitions, or board truth need to be filled in';
  } else if (agentName === 'fw-doer') {
    when = 'Call it when the real change point is locked and minimal implementation is needed';
  } else if (agentName === 'bug-hunter') {
    when = 'Call it when symptoms are known but root cause is unclear and hypotheses must be narrowed quickly';
    blocking = false;
  } else if (agentName === 'sys-reviewer') {
    when = context.isRtos || context.isConnected
      ? 'Prefer calling it when task / queue / lock / timer / reconnect / OTA boundaries are involved'
      : 'Call it when a structural boundary review is needed';
    blocking = false;
  } else if (agentName === 'release-checker') {
    when = 'Call it when upgrade, rollback, offline defaults, or release closure is involved';
    blocking = false;
  } else if (agentName === 'arch-reviewer') {
    when = 'Call it when entering chip selection, PoC-to-production, or pre-mortem scenarios';
    blocking = false;
  }

  if (action === 'review' && role !== 'primary') {
    blocking = false;
  }

  return {
    agent: toInstalledAgentName(agentName),
    role,
    blocking,
    purpose: AGENT_PURPOSES[agentName] || `Support the ${action} action`,
    ownership: AGENT_OWNERSHIP[agentName] || 'Handle only the assigned output surface and do not revert other agents\' work',
    when,
    spawn_fallback: buildSpawnFallback(agentName, role)
  };
}

function buildAgentOutputExpectation(action, agentName, context) {
  if (agentName === 'hw-scout') {
    return runtime.unique([
      'List hardware truth sources, key anchor points, and explicit conclusions',
      context.isBaremetal ? 'Fill in register, pin, timing, and shared-state constraints' : 'Fill in interface, voltage-domain, or board-boundary constraints'
    ]);
  }

  if (agentName === 'fw-doer') {
    return [
      'Provide the minimal change plan or the change already executed',
      'Explain impact scope, minimal verification, and residual risk'
    ];
  }

  if (agentName === 'bug-hunter') {
    return [
      'Output in symptom -> hypothesis -> check -> result -> next step format',
      'Keep only 1 to 3 high-value hypotheses'
    ];
  }

  if (agentName === 'sys-reviewer') {
    return [
      'Separate confirmed risks from risks that still need verification',
      'Explain task-boundary, concurrency-path, state-sync, or recovery-path issues'
    ];
  }

  if (agentName === 'release-checker') {
    return [
      'Explain upgrade, rollback, offline-default, and release-closure risks',
      'Add the checks that must be verified before release'
    ];
  }

  if (agentName === 'arch-reviewer') {
    return [
      'Provide three options, an evaluation matrix, and a pre-mortem',
      'Separate facts, engineering inference, and experience-based warnings'
    ];
  }

  return [`Output conclusions related to ${action}`];
}

function buildAgentContextBundle(action, resolved) {
  const context = buildContext(resolved);
  const outputShape = buildOutputShape(action);
  const suggestedSteps = buildSuggestedSteps(action, resolved);
  const safetyChecks = buildSafetyChecks(action, resolved);
  const truthSources = action === 'plan'
    ? buildPlanTruthSources(resolved)
    : action === 'scan'
      ? buildNextReads(resolved)
      : [];

  return {
    focus: context.focus || '',
    last_files: context.lastFiles.slice(0, 3),
    open_questions: context.openQuestions.slice(0, 3),
    known_risks: context.knownRisks.slice(0, 3),
    truth_sources: truthSources.slice(0, 4),
    safety_checks: safetyChecks.slice(0, 4),
    suggested_steps: suggestedSteps.slice(0, 4),
    output_shape: outputShape
  };
}

function buildDispatchContract(action, resolved, primaryAgent, supportingAgents, mode, recommended) {
  const context = buildContext(resolved);
  const contextBundle = buildAgentContextBundle(action, resolved);
  const primary = primaryAgent
    ? {
        ...buildAgentCall(action, primaryAgent, 'primary', context),
        expected_output: buildAgentOutputExpectation(action, primaryAgent, context),
        context_bundle: contextBundle,
        start_when: recommended ? 'Start immediately' : 'Start only when the current thread does not want to inline'
      }
    : null;
  const supporting = supportingAgents.map(agentName => ({
    ...buildAgentCall(action, agentName, 'supporting', context),
    expected_output: buildAgentOutputExpectation(action, agentName, context),
    context_bundle: contextBundle,
    start_when: mode === 'parallel-recommended' || mode === 'primary-plus-supporting'
      ? 'Can start in parallel with the main thread'
      : 'Start only when the main thread finds a side issue'
  }));

  return {
    launch_via: 'installed-emb-agent',
    auto_invoke_when_recommended: recommended,
    primary_first: mode !== 'parallel-recommended',
    parallel_safe: runtime.unique([
      ...supporting
        .filter(item => !item.blocking)
        .map(item => item.agent)
    ]),
    do_not_parallelize: [
      'Do not let multiple writable agents modify the same file set',
      'Do not overbuild orchestration for a small task'
    ],
    integration_owner: 'Current main thread',
    integration_steps: runtime.unique([
      'Keep the main thread moving; do not sit idle waiting for every sub-agent',
      'Wait for a critical sub-agent only when the main path is blocked',
      `Integrate sub-agent results back into the standard output shape for ${action}`
    ]),
    primary,
    supporting
  };
}

function buildAgentExecution(action, resolved, primaryAgentInput, supportingAgentsInput) {
  const context = buildContext(resolved);
  const primaryAgent = primaryAgentInput || choosePrimaryAgent(action, resolved);
  const supportingAgents = Array.isArray(supportingAgentsInput)
    ? supportingAgentsInput
    : chooseSupportingAgents(action, resolved, primaryAgent);
  const installedPrimary = toInstalledAgentName(primaryAgent);
  const installedSupporting = supportingAgents.map(toInstalledAgentName).filter(Boolean);
  const available = Boolean(installedPrimary) || installedSupporting.length > 0;

  let mode = 'inline-preferred';
  let recommended = false;
  let inlineOk = true;
  let reason = 'The current action can stay inline by default; there is no need to expand the sub-agent chain proactively.';
  let suggestedWhen = [];
  let avoidWhen = [];

  if (action === 'scan') {
    recommended = Boolean(primaryAgent) && (context.isRtos || context.isConnected || context.openQuestions.length > 0);
    mode = recommended ? 'primary-recommended' : 'inline-preferred';
    reason = recommended
      ? context.isRtos || context.isConnected
        ? 'Task/connectivity boundaries are more complex; splitting first to scouting or review agents is safer for gathering truth sources.'
        : 'Open questions exist; letting a scouting agent lock truth sources first reduces guessing.'
      : 'Scan is often just lightweight context reading, so inline is cheaper by default.';
    suggestedWhen = [
      'Open questions already exist, but truth sources are not locked yet',
      context.isBaremetal ? 'Pins, registers, or timing requirements need to be checked first' : 'Task, queue, lock, or connectivity-state boundaries need to be checked first'
    ];
    avoidWhen = [
      'This is only re-reading a known file',
      'Truth sources and change boundaries are both clear'
    ];
  } else if (action === 'plan') {
    recommended = Boolean(primaryAgent);
    mode = context.isRtos || context.isConnected ? 'parallel-recommended' : 'primary-recommended';
    reason = context.isRtos || context.isConnected
      ? 'RTOS / IoT planning usually benefits from separating structural boundaries from release constraints, which fits lightweight parallelism.'
      : 'A baremetal micro-plan works better when the primary agent locks hardware truth and constraints first, then the main thread integrates.';
    suggestedWhen = [
      'The task already exceeds a small single-file change',
      context.isConnected ? 'Recovery, upgrade, or rollback paths must all be covered' : 'Both hardware constraints and implementation paths must be covered'
    ];
    avoidWhen = [
      'After scan, it can already move directly into do',
      'This is only a tiny comment or documentation update'
    ];
  } else if (action === 'do') {
    recommended = Boolean(primaryAgent) && (context.openQuestions.length > 0 || context.isConnected);
    mode = recommended ? 'primary-plus-supporting' : 'inline-preferred';
    reason = recommended
      ? context.isConnected
        ? 'Connectivity or upgrade changes are more likely to miss recovery paths, so a supporting agent is useful for parallel review.'
        : 'When open questions still exist, let a supporting agent re-check truth sources or risks before landing code.'
      : 'Do should stay direct by default; do not make the execution chain heavy for a small change.';
    suggestedWhen = [
      'One agent should focus on implementation while another focuses on truth-source or release review',
      'The main thread wants to integrate the plan while a sub-agent handles side issues'
    ];
    avoidWhen = [
      'Only a small single-file change remains and truth sources are already confirmed',
      'Multiple writable agents would touch the same file set'
    ];
  } else if (action === 'debug') {
    recommended = Boolean(primaryAgent);
    mode = context.isRtos || context.isConnected ? 'parallel-recommended' : 'primary-recommended';
    reason = context.isRtos || context.isConnected
      ? 'Complex concurrency or connectivity issues fit parallel debugging and structural review.'
      : 'By default, debugging can go to bug-hunter first to narrow hypotheses, then the main thread decides the change.';
    suggestedWhen = [
      'Symptoms are stable but there are many root-cause branches',
      context.isConnected ? 'The problem spans tasks, connectivity, and recovery paths' : 'The problem spans ISR, the main loop, and timing windows'
    ];
    avoidWhen = [
      'The root cause is already very clear; only the direct fix remains',
      'There is not enough symptom evidence to justify sub-agent debugging'
    ];
  } else if (action === 'review') {
    recommended = Boolean(primaryAgent);
    mode = installedSupporting.length > 0 ? 'parallel-recommended' : 'primary-recommended';
    reason = 'Review naturally fits splitting structural, hardware-boundary, and release-closure concerns across different read-only agents.';
    suggestedWhen = [
      'Module boundaries, recovery paths, and release risks all need simultaneous review',
      'You want confirmed risks and risks awaiting verification to converge separately'
    ];
    avoidWhen = [
      'This is only a single-point implementation check',
      'The current scope is too small to justify parallelism'
    ];
  } else if (action === 'verify') {
    recommended = Boolean(primaryAgent);
    mode = context.isConnected || context.isRtos ? 'parallel-recommended' : 'primary-recommended';
    reason = context.isConnected || context.isRtos
      ? 'Verification often covers behavior, recovery chains, and system boundaries at the same time, which fits parallel convergence of check items.'
      : 'Baremetal verification is more like board-level/timing closure; let a verify agent list the checklist first.';
    suggestedWhen = [
      'A do step just finished; the implementation now needs closure across bench / docs / risk surface',
      context.isBaremetal ? 'Registers, pins, timing, sleep/wake, or power boundaries need re-checking' : 'Task boundaries, recovery paths, and failure paths need re-checking'
    ];
    avoidWhen = [
      'Minimal do or debug convergence has not been completed yet',
      'The current state has only vague ideas and no verifiable target'
    ];
  } else if (action === 'forensics') {
    recommended = Boolean(primaryAgent);
    mode = context.isRtos || context.isConnected ? 'parallel-recommended' : 'primary-recommended';
    reason = context.isRtos || context.isConnected
      ? 'Complex recovery or drift issues fit parallel forensics and structural review.'
      : 'Forensics works well when bug-hunter leads evidence gathering first, then the main thread decides whether to return to debug, review, or do.';
    suggestedWhen = [
      'The problem keeps recurring, and session / handoff / thread have started to drift',
      'Evidence must converge first before deciding whether to continue with debug, review, or implementation'
    ];
    avoidWhen = [
      'The root cause is already clear; only the direct fix remains',
      'This is only a normal hardware-formula or register-location problem'
    ];
  } else if (action === 'note') {
    recommended = Boolean(primaryAgent) && context.isConnected;
    mode = recommended ? 'primary-recommended' : 'inline-preferred';
    reason = recommended
      ? 'Connectivity or release constraints are easier to miss; a specialized agent can fill the record surface first when needed.'
      : 'Note is mainly for recording stable conclusions, so inline is usually enough.';
    suggestedWhen = [
      'Release or connectivity constraints must be filled in before writing documentation',
      'The recorded content spans hardware truth and release constraints'
    ];
    avoidWhen = [
      'This only appends one stable conclusion',
      'The session is still exploratory and the conclusion is not stable yet'
    ];
  }

  return {
    available,
    spawn_available: available,
    recommended,
    inline_ok: inlineOk,
    mode,
    reason,
    primary_agent: installedPrimary,
    supporting_agents: installedSupporting,
    wait_strategy: recommended
      ? 'Wait for sub-agent results only when the main path is blocked; otherwise keep working in the main thread'
      : 'Do not wait for sub-agents by default unless the current step is blocked on their result',
    execution_rules: runtime.unique([
      'Do not let multiple writable agents modify the same file set',
      'The main thread owns integration of conclusions and should not make orchestration itself heavy',
      context.isBaremetal
        ? 'When registers, pins, timing, or board truth are involved, call emb-hw-scout first'
        : 'When task, queue, lock, timer, reconnect, or OTA boundaries are involved, call the structural review agent first'
    ]),
    suggested_when: runtime.unique(suggestedWhen),
    avoid_when: runtime.unique(avoidWhen),
    calls: runtime.unique([
      primaryAgent ? buildAgentCall(action, primaryAgent, 'primary', context) : '',
      ...supportingAgents.map(agentName => buildAgentCall(action, agentName, 'supporting', context))
    ].filter(Boolean)),
    dispatch_contract: buildDispatchContract(action, resolved, primaryAgent, supportingAgents, mode, recommended)
  };
}

function buildSuggestedSteps(action, resolved) {
  const context = buildContext(resolved);
  const steps = [];

  if (action === 'scan') {
    steps.push('Lock hardware truth sources and the main entry first');
    steps.push(context.isBaremetal ? 'Then read ISR, shared-state, and timing paths' : 'Then read task, queue, lock, and timer boundaries');
    if (context.lastFiles[0]) {
      steps.push(`Re-read the recent file ${context.lastFiles[0]}`);
    }
    if (context.openQuestions[0]) {
      steps.push(`Converge around the open question: ${context.openQuestions[0]}`);
    }
    steps.push('Output relevant_files / key_facts / open_questions / next_reads');
  }

  if (action === 'do') {
    if (context.lastFiles.length === 0) {
      steps.push('Add a minimal scan first to confirm the real change point');
    }
    steps.push('Confirm prerequisite truth sources and constraints for the change');
    steps.push('Execute the minimal change');
    steps.push('Report minimal verification and residual risk');
  }

  if (action === 'plan') {
    steps.push('Clarify the goal and impact boundary first');
    steps.push('Lock truth sources, constraints, and primary risks');
    steps.push('Split into the smallest executable steps');
    steps.push('Provide pre-execution and post-execution verification');
  }

  if (action === 'debug') {
    steps.push('Pin down the symptom first');
    steps.push('Converge to 1 to 3 high-value hypotheses');
    steps.push('Eliminate one by one using Check -> Result');
    steps.push('Keep only the most likely next step');
  }

  if (action === 'review') {
    steps.push('Define the review scope first');
    steps.push('Perform structural checks by review axis');
    steps.push('Output findings and required checks');
    if (context.isConnected) {
      steps.push('Add checks for upgrade, rollback, and offline defaults');
    }
  }

  if (action === 'verify') {
    steps.push('List the verification targets for this round of implementation or conclusions first');
    steps.push(context.isBaremetal ? 'Verify item by item across power-up, timing, pins, registers, sleep/low-voltage, and related surfaces' : 'Verify item by item across tasks, recovery, failure paths, and connectivity/upgrade behavior');
    steps.push('Give pass / fail / untested for each item and record the evidence');
    steps.push('Write failed items back to risk, question, or note');
  }

  if (action === 'forensics') {
    steps.push('Pin down the current problem statement, latest forensics summary, and concrete evidence first');
    steps.push('Converge only the most critical evidence; do not jump straight to a fix');
    steps.push('Clarify whether the next step should return to debug, review, or do');
  }

  if (action === 'note') {
    steps.push('Select the target durable document first');
    steps.push('Record only stable conclusions and their basis');
    steps.push('Mark unverified items');
    steps.push('Avoid writing session fragments or planning process notes');
  }

  return steps;
}

function buildOutputShape(action) {
  if (action === 'scan') {
    return ['relevant_files', 'key_facts', 'open_questions', 'next_reads', 'scheduler'];
  }
  if (action === 'plan') {
    return ['goal', 'truth_sources', 'constraints', 'risks', 'steps', 'verification', 'scheduler'];
  }
  if (action === 'do') {
    return ['chosen_agent', 'prerequisites', 'safety_checks', 'execution_brief', 'scheduler'];
  }
  if (action === 'debug') {
    return ['hypotheses', 'checks', 'next_step', 'chosen_agent', 'scheduler'];
  }
  if (action === 'review') {
    return ['scope', 'axes', 'findings_template', 'required_checks', 'review_agents', 'scheduler'];
  }
  if (action === 'verify') {
    return ['scope', 'checklist', 'evidence_targets', 'result_template', 'next_step', 'scheduler'];
  }
  if (action === 'forensics') {
    return ['problem', 'evidence_sources', 'findings_template', 'next_step', 'chosen_agent', 'scheduler'];
  }
  if (action === 'note') {
    return ['target_docs', 'recordable_items', 'excluded_items', 'chosen_agent', 'scheduler'];
  }
  return [];
}

function buildDefaultOpenQuestions(resolved) {
  const context = buildContext(resolved);

  if (context.openQuestions.length > 0) {
    return context.openQuestions;
  }

  if (context.isBaremetal) {
    return runtime.unique([
      'Have hardware truth sources been confirmed down to pins, registers, and timing?',
      'Which ISR and main-loop shared states are most worth re-checking first?',
      context.isSensor ? 'Have sampling windows, filtering, or settling time been constrained explicitly?' : ''
    ]);
  }

  return runtime.unique([
    'Have the boundaries of tasks, queues, locks, and timers been located clearly?',
    'Are the connectivity state machine and offline defaults consistent?',
    context.isConnected ? 'Have OTA / rollback / upgrade-recovery paths been defined clearly?' : ''
  ]);
}

function buildNextReads(resolved) {
  const context = buildContext(resolved);
  const hintedReads = buildPreferredReadKeys(resolved).map(key => READ_HINTS[key] || key);
  const truthFiles = getProjectTruthFiles(resolved).map(file => `Project truth layer: ${file}`);

  return runtime.unique([
    ...truthFiles,
    ...hintedReads,
    context.lastFiles[0] ? `Re-read recent file: ${context.lastFiles[0]}` : '',
    context.knownRisks[0] ? `Re-check risk source: ${context.knownRisks[0]}` : ''
  ]);
}

function buildHypotheses(resolved) {
  const context = buildContext(resolved);

  if (context.isBaremetal) {
    return runtime.unique([
      'Update order for ISR and main-loop shared state is incorrect',
      'Timing windows or register configuration do not satisfy current behavior',
      context.isSensor ? 'Sampling settling time, filtering, or calibration path is incorrect' : 'Pin mux or board-connection understanding is incorrect'
    ]).slice(0, 3);
  }

  return runtime.unique([
    'Task priority, lock, or queue boundaries are causing abnormal behavior',
    'There is a gap in the connectivity state machine, reconnect logic, or cache consistency',
    context.isConnected ? 'Upgrade recovery, offline defaults, or rollback paths are incomplete' : 'Timer or background-task interaction path is incorrect'
  ]).slice(0, 3);
}

function buildChecks(resolved) {
  const context = buildContext(resolved);

  if (context.isBaremetal) {
    return runtime.unique([
      'Check ISR set/clear flag handling and main-loop consumption order',
      'Check critical registers, pin muxing, and timing requirements',
      context.isSensor ? 'Check sampling windows, settling time, filtering, or calibration flow' : 'Check board connections and output paths'
    ]);
  }

  return runtime.unique([
    'Check task boundaries, blocking points, and priorities',
    'Check interaction paths among queue / lock / timer',
    context.isConnected ? 'Check reconnect / offline / OTA / rollback closure' : 'Check background state machines and timeout recovery'
  ]);
}

function buildFindingsTemplate(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    'Confirmed risks',
    'Risks to verify',
    context.isBaremetal ? 'Timing / register path' : 'Task / queue / lock path',
    context.isConnected ? 'Connectivity / OTA / rollback' : 'Hardware / board truth'
  ]);
}

function buildRequiredChecks(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    ...(resolved.effective.guardrails || []).map(item => `guardrail: ${item}`),
    context.isBaremetal ? 'Re-check ISR, shared state, and ROM/RAM budget' : 'Re-check task boundaries, blocking, and priority',
    context.isConnected ? 'Re-check offline defaults, upgrade recovery, and rollback' : '',
    context.isSensor ? 'Re-check sampling windows, settling time, and measurement-update flow' : ''
  ]);
}

function buildVerificationChecklist(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    context.isBaremetal ? 'Confirm main entry, ISR, and shared-state behavior match expectations' : 'Confirm task boundaries, scheduling, and synchronization behavior match expectations',
    context.isBaremetal ? 'Confirm there is no regression in critical registers, pin muxing, and timing windows' : 'Confirm there is no regression in queues, locks, timeouts, and recovery paths',
    context.isBaremetal ? 'Confirm behavior for power-up, reset, sleep wake, low voltage, and power boundaries' : '',
    context.isConnected ? 'Confirm offline defaults, reconnect, upgrade recovery, and rollback paths' : '',
    context.isSensor ? 'Confirm sampling windows, settling time, filtering, calibration, and measurement-update flow' : '',
    'Confirm handling for abnormal inputs, boundary conditions, and failure paths'
  ]);
}

function buildVerificationEvidenceTargets(resolved) {
  const truthFiles = getProjectTruthFiles(resolved);
  const suggestedSources = resolved && resolved.effective && Array.isArray(resolved.effective.recommended_sources)
    ? resolved.effective.recommended_sources
    : [];

  return runtime.unique([
    ...truthFiles.map(file => `Project truth layer: ${file}`),
    ...(resolved.session.last_files || []).slice(0, 3).map(file => `Recent file: ${file}`),
    ...suggestedSources.slice(0, 2).map(item => `Source summary: ${item.path}`)
  ]);
}

function buildVerificationResultTemplate() {
  return [
    'PASS: verified',
    'FAIL: reproduced failure or found regression',
    'WARN: risk found but evidence is incomplete',
    'UNTESTED: not yet bench / simulated / hardware verified'
  ];
}

function buildRecordableItems(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    'Hardware truth',
    'Bring-up conclusions',
    'Known limits',
    'Debug conclusions',
    context.isConnected ? 'Connectivity and release constraints' : '',
    context.isSensor ? 'Sampling, calibration, and low-power constraints' : ''
  ]);
}

function buildPlanGoal(resolved) {
  const context = buildContext(resolved);

  if (context.focus) {
    return context.focus;
  }

  if (context.isBaremetal) {
    return context.isSensor
      ? 'Lock hardware truth and the sampling path first, then execute the minimal change'
      : 'Lock hardware truth and critical timing first, then execute the minimal change';
  }

  return context.isConnected
    ? 'Lock task boundaries, connectivity state, and recovery paths first, then execute the minimal change'
    : 'Lock task boundaries and shared state first, then execute the minimal change';
}

function buildPlanTruthSources(resolved) {
  const context = buildContext(resolved);
  const fileReads = [
    context.lastFiles[0] ? `Most relevant file: ${context.lastFiles[0]}` : '',
    context.lastFiles[1] ? `Second most relevant file: ${context.lastFiles[1]}` : ''
  ];

  if (context.preferences.truth_source_mode === 'code_first') {
    return runtime.unique([
      ...fileReads,
      ...buildNextReads(resolved)
    ]);
  }

  return runtime.unique([
    ...buildNextReads(resolved),
    ...fileReads
  ]);
}

function buildPlanConstraints(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    ...(resolved.profile.resource_priority || []).map(item => `resource: ${item}`),
    ...(resolved.effective.guardrails || []).map(item => `guardrail: ${item}`),
    context.isBaremetal ? 'Constraint: keep ISR thin, main loop flat, and avoid extra abstraction' : '',
    context.isConnected ? 'Constraint: do not break offline defaults, reconnect, or recovery paths' : '',
    context.isSensor ? 'Constraint: do not break sampling windows, settling time, or measurement-update flow' : ''
  ]);
}

function buildPlanRisks(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    ...(resolved.session.known_risks || []),
    context.isBaremetal ? 'ISR / main-loop shared-state race' : 'Task-boundary, blocking, and priority risks',
    context.isConnected ? 'Regression in offline behavior, reconnect, consistency, or rollback paths' : '',
    context.isSensor ? 'Regression in sampling settling time, filtering, or calibration paths' : ''
  ]);
}

function buildPlanSteps(resolved) {
  const context = buildContext(resolved);
  const steps = [];

  if (context.lastFiles.length === 0) {
    steps.push('Run a minimal scan first to confirm the real change point');
  }

  steps.push('Confirm the hardware truth, code entry points, and impact boundary involved in the goal');
  steps.push('Split the change into a single minimal submission surface instead of expanding multiple risk surfaces at once');
  steps.push('Modify the most critical path first, then add minimal verification');

  if (context.isBaremetal) {
    steps.push('Prefer modifying the true landing points for registers, pins, ISR, or main-loop shared state');
  } else {
    steps.push('Prefer modifying the true landing points for task boundaries, queues, locks, timers, or connectivity state machines');
  }

  if (context.isConnected) {
    steps.push('Re-check offline defaults, recovery paths, and upgrade chains both before and after execution');
  }

  steps.push('After completion, decide whether a note is needed to record a durable conclusion');
  return steps;
}

function buildPlanVerification(resolved) {
  const context = buildContext(resolved);

  return runtime.unique([
    context.isBaremetal ? 'Verify ISR, main loop, shared state, and timing windows' : 'Verify task boundaries, blocking points, and concurrency paths',
    context.isConnected ? 'Verify offline defaults, reconnect, upgrade recovery, and rollback paths' : '',
    context.isSensor ? 'Verify sampling windows, settling time, filtering, and measurement-update paths' : '',
    context.preferences.verification_mode === 'strict'
      ? 'Verify failure paths, abnormal inputs, timeout recovery, and boundary conditions'
      : '',
    'Verify that no new known risks were introduced outside the impact surface'
  ]);
}

function buildSchedule(action, resolved) {
  if (!ACTIONS.includes(action)) {
    throw new Error(`Unsupported action: ${action}`);
  }

  const primaryAgent = choosePrimaryAgent(action, resolved);
  const supportingAgents = chooseSupportingAgents(action, resolved, primaryAgent);

  return {
    action,
    profile: resolved.profile.name,
    packs: (resolved.packs || []).map(pack => pack.name),
    primary_agent: primaryAgent,
    supporting_agents: supportingAgents,
    agent_execution: buildAgentExecution(action, resolved, primaryAgent, supportingAgents),
    safety_checks: buildSafetyChecks(action, resolved),
    focus_order: buildFocusOrder(resolved),
    suggested_steps: buildSuggestedSteps(action, resolved),
    output_shape: buildOutputShape(action)
  };
}

function buildScanOutput(resolved) {
  const truthFiles = getProjectTruthFiles(resolved);

  return {
    relevant_files: runtime.unique([
      ...truthFiles,
      ...(resolved.session.last_files || [])
    ]),
    key_facts: runtime.unique([
      `profile=${resolved.profile.name}`,
      `runtime_model=${resolved.profile.runtime_model}`,
      `concurrency_model=${resolved.profile.concurrency_model}`,
      `resource_priority=${(resolved.profile.resource_priority || []).join(' -> ')}`,
      truthFiles.length > 0 ? `project_truth=${truthFiles.join(', ')}` : 'project_truth=missing',
      `focus_areas=${(resolved.effective.focus_areas || []).join(', ')}`
    ]),
    open_questions: buildDefaultOpenQuestions(resolved),
    next_reads: buildNextReads(resolved),
    scheduler: buildSchedule('scan', resolved)
  };
}

function buildPlanOutput(resolved) {
  return {
    goal: buildPlanGoal(resolved),
    truth_sources: buildPlanTruthSources(resolved),
    constraints: buildPlanConstraints(resolved),
    risks: buildPlanRisks(resolved),
    steps: buildPlanSteps(resolved),
    verification: buildPlanVerification(resolved),
    scheduler: buildSchedule('plan', resolved)
  };
}

function buildDoOutput(resolved) {
  const context = buildContext(resolved);

  return {
    chosen_agent: choosePrimaryAgent('do', resolved),
    prerequisites: runtime.unique([
      context.lastFiles.length === 0 ? 'Add a minimal scan first to confirm the real change point' : '',
      'Confirm hardware truth sources or implementation truth sources',
      context.focus ? `Execute around the current focus: ${context.focus}` : '',
      context.isConnected ? 'Confirm offline defaults, upgrade recovery, and consistency constraints' : ''
    ]),
    safety_checks: buildSafetyChecks('do', resolved),
    execution_brief: {
      focus_order: buildFocusOrder(resolved),
      suggested_steps: buildSuggestedSteps('do', resolved),
      supporting_agents: chooseSupportingAgents('do', resolved, choosePrimaryAgent('do', resolved))
    },
    scheduler: buildSchedule('do', resolved)
  };
}

function buildDebugOutput(resolved) {
  const steps = buildSuggestedSteps('debug', resolved);

  return {
    hypotheses: buildHypotheses(resolved),
    checks: buildChecks(resolved),
    next_step: steps[0] || 'Pin down the current symptom first',
    chosen_agent: choosePrimaryAgent('debug', resolved),
    scheduler: buildSchedule('debug', resolved)
  };
}

function buildReviewOutput(resolved) {
  return {
    scope: {
      profile: resolved.profile.name,
      packs: (resolved.packs || []).map(pack => pack.name),
      focus: resolved.session.focus || '',
      runtime_model: resolved.profile.runtime_model,
      concurrency_model: resolved.profile.concurrency_model,
      focus_areas: resolved.effective.focus_areas || []
    },
    axes: resolved.effective.review_axes || [],
    findings_template: buildFindingsTemplate(resolved),
    required_checks: buildRequiredChecks(resolved),
    review_agents: runtime.unique([
      choosePrimaryAgent('review', resolved),
      ...chooseSupportingAgents('review', resolved, choosePrimaryAgent('review', resolved))
    ]),
    scheduler: buildSchedule('review', resolved)
  };
}

function buildVerifyOutput(resolved) {
  const context = buildContext(resolved);
  const steps = buildSuggestedSteps('verify', resolved);
  const qualityGates = qualityGateHelpers.evaluateQualityGates(
    resolved ? resolved.project_config : null,
    resolved && resolved.session ? resolved.session.diagnostics : {}
  );
  const qualityGateChecklist = qualityGates.enabled
    ? runtime.unique([
        ...qualityGates.required_executors.map(name => `Quality gate executor "${name}" must be green before closure`),
        ...qualityGates.required_signoffs.map(name => `Human signoff "${name}" must be confirmed before closure`)
      ])
    : [];

  return {
    scope: {
      profile: resolved.profile.name,
      packs: (resolved.packs || []).map(pack => pack.name),
      focus: resolved.session.focus || '',
      runtime_model: resolved.profile.runtime_model,
      concurrency_model: resolved.profile.concurrency_model,
      last_files: resolved.session.last_files || []
    },
    checklist: runtime.unique([
      ...qualityGateChecklist,
      ...buildVerificationChecklist(resolved)
    ]),
    evidence_targets: buildVerificationEvidenceTargets(resolved),
    result_template: buildVerificationResultTemplate(),
    next_step: steps[0] || 'List this round\'s verification targets first',
    scheduler: buildSchedule('verify', resolved),
    quality_gates: qualityGates,
    closure_status: qualityGates.status_summary || (qualityGates.enabled ? qualityGates.gate_status : ''),
    verification_focus: runtime.unique([
      context.isBaremetal ? 'board-behavior' : 'system-behavior',
      context.isConnected ? 'connectivity-recovery' : '',
      context.isSensor ? 'sampling-stability' : '',
      'failure-paths'
    ])
  };
}

function buildForensicsOutput(resolved) {
  const diagnostics = resolved.session.diagnostics && resolved.session.diagnostics.latest_forensics
    ? resolved.session.diagnostics.latest_forensics
    : {};
  const latestExecutor = resolved.session.diagnostics && resolved.session.diagnostics.latest_executor
    ? resolved.session.diagnostics.latest_executor
    : {};
  const steps = buildSuggestedSteps('forensics', resolved);

  return {
    problem:
      diagnostics.problem ||
      (latestExecutor && ['failed', 'error'].includes(latestExecutor.status)
        ? `Latest executor ${latestExecutor.name || 'unknown'} ${latestExecutor.status}`
        : '') ||
      resolved.session.focus ||
      'The current problem is still drifting; forensics should come first',
    evidence_sources: runtime.unique([
      diagnostics.report_file ? `Latest forensics: ${diagnostics.report_file}` : '',
      latestExecutor && latestExecutor.name
        ? `Latest executor: ${latestExecutor.name} ${latestExecutor.status || 'unknown'}${
          latestExecutor.exit_code === null ? '' : `, exit=${latestExecutor.exit_code}`
        }`
        : '',
      latestExecutor && latestExecutor.stderr_preview ? `Executor stderr summary: ${latestExecutor.stderr_preview}` : '',
      ...(resolved.session.last_files || []).slice(0, 2).map(file => `Recent file: ${file}`),
      ...getProjectTruthFiles(resolved).map(file => `Project truth layer: ${file}`)
    ]),
    findings_template: [
      'Observed symptom',
      'Evidence collected',
      'Most likely branch',
      'Next recommended action'
    ],
    next_step: steps[0] || 'Pin down the problem statement and key evidence first',
    chosen_agent: choosePrimaryAgent('forensics', resolved),
    scheduler: buildSchedule('forensics', resolved)
  };
}

function buildNoteOutput(resolved) {
  return {
    target_docs: resolved.effective.note_targets || [],
    recordable_items: buildRecordableItems(resolved),
    excluded_items: [
      'Temporary guess',
      'Session fragment',
      'phase / planning process'
    ],
    chosen_agent: choosePrimaryAgent('note', resolved),
    scheduler: buildSchedule('note', resolved)
  };
}

module.exports = {
  ACTIONS,
  buildAgentExecution,
  buildDoOutput,
  buildDebugOutput,
  buildForensicsOutput,
  buildNoteOutput,
  buildPlanOutput,
  buildReviewOutput,
  buildVerifyOutput,
  buildScanOutput,
  buildSchedule
};
