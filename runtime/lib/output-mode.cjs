'use strict';

const permissionGateHelpers = require('./permission-gates.cjs');
const runtimeEventHelpers = require('./runtime-events.cjs');

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(toArray(values).filter(Boolean))];
}

function truncateList(values, limit) {
  return toArray(values).slice(0, limit);
}

function summarizeContextHygiene(value) {
  if (!isObject(value)) {
    return null;
  }

  return compactObject({
    level: value.level || '',
    recommendation: value.recommendation || '',
    clear_hint: value.clear_hint || '',
    compress_cli: value.compress_cli || '',
    handoff_ready: Boolean(value.handoff_ready)
  });
}

function summarizeMemorySummary(value) {
  if (!isObject(value)) {
    return null;
  }

  const activeTask = isObject(value.active_task) ? value.active_task : {};
  const diagnostics = isObject(value.diagnostics) ? value.diagnostics : {};
  const latestForensics = isObject(diagnostics.latest_forensics) ? diagnostics.latest_forensics : {};
  const latestSkill = isObject(diagnostics.latest_skill) ? diagnostics.latest_skill : {};
  const latestExecutor = isObject(diagnostics.latest_executor) ? diagnostics.latest_executor : {};

  return compactObject({
    generated_at: value.generated_at || '',
    captured_at: value.captured_at || '',
    source: value.source || '',
    snapshot_label: value.snapshot_label || '',
    stale_note: value.stale_note || '',
    recovery_pointers: truncateList(value.recovery_pointers, 4),
    focus: value.focus || '',
    last_command: value.last_command || '',
    suggested_flow: value.suggested_flow || '',
    next_action: value.next_action || '',
    last_files: truncateList(value.last_files, 4),
    open_questions: truncateList(value.open_questions, 3),
    known_risks: truncateList(value.known_risks, 3),
    active_task: compactObject({
      name: activeTask.name || '',
      title: activeTask.title || '',
      status: activeTask.status || ''
    }),
    diagnostics: compactObject({
      latest_forensics: compactObject({
        report_file: latestForensics.report_file || '',
        highest_severity: latestForensics.highest_severity || ''
      }),
      latest_skill: compactObject({
        name: latestSkill.name || '',
        status: latestSkill.status || '',
        risk: latestSkill.risk || ''
      }),
      latest_executor: compactObject({
        name: latestExecutor.name || '',
        status: latestExecutor.status || '',
        risk: latestExecutor.risk || ''
      })
    })
  });
}

function summarizeScheduler(value) {
  if (!isObject(value)) {
    return null;
  }

  return compactObject({
    primary_agent: value.primary_agent || '',
    supporting_agents: truncateList(value.supporting_agents, 3),
    safety_checks: truncateList(value.safety_checks, 4),
    execution_mode: value.agent_execution && value.agent_execution.mode ? value.agent_execution.mode : '',
    agent_recommended: Boolean(value.agent_execution && value.agent_execution.recommended)
  });
}

function summarizeToolRecommendation(value) {
  if (!isObject(value)) {
    return null;
  }

  const trust = isObject(value.trust)
    ? compactObject({
        score: Number.isFinite(value.trust.score) ? value.trust.score : undefined,
        grade: value.trust.grade || '',
        executable: value.trust.executable === undefined ? undefined : Boolean(value.trust.executable)
      })
    : null;

  return compactObject({
    tool: value.tool || '',
    status: value.status || '',
    cli_draft: value.cli_draft || '',
    missing_inputs: truncateList(value.missing_inputs, 4),
    trust
  });
}

function summarizeWalkthroughRecommendation(value) {
  if (!isObject(value)) {
    return null;
  }

  return compactObject({
    kind: value.kind || '',
    summary: value.summary || '',
    tool_count: Number.isFinite(value.tool_count) ? value.tool_count : undefined,
    ordered_tools: truncateList(value.ordered_tools, 8),
    first_tool: value.first_tool || '',
    first_cli: value.first_cli || '',
    recommended_sequence: truncateList(
      toArray(value.recommended_sequence).map(item => summarizeToolRecommendation(item)),
      5
    )
  });
}

function summarizeWalkthroughExecution(value) {
  if (!isObject(value)) {
    return null;
  }

  const steps = toArray(value.steps).filter(isObject);
  const currentIndex = Number.isInteger(value.current_index) ? value.current_index : 0;
  const currentStep = steps[currentIndex] || null;
  const completedSteps = Array.isArray(value.completed_steps)
    ? value.completed_steps
    : steps.filter(item => ['ok', 'skipped'].includes(item.status)).map(item => item.tool || '');
  const remainingSteps = Array.isArray(value.remaining_steps)
    ? value.remaining_steps
    : steps.filter(item => !['ok', 'skipped'].includes(item.status)).map(item => item.tool || '');

  return compactObject({
    kind: value.kind || '',
    status: value.status || '',
    total_steps: Number.isFinite(value.total_steps) ? value.total_steps : undefined,
    completed_count: Number.isFinite(value.completed_count) ? value.completed_count : undefined,
    current_tool: value.current_tool || (currentStep && currentStep.tool ? currentStep.tool : ''),
    current_cli: value.current_cli || (currentStep && currentStep.cli ? currentStep.cli : ''),
    last_tool: value.last_tool || '',
    last_summary: value.last_summary || '',
    completed_steps: truncateList(completedSteps, 6),
    remaining_steps: truncateList(remainingSteps, 6)
  });
}

function summarizeRecommendedFlow(value) {
  if (!isObject(value)) {
    return null;
  }

  const steps = toArray(value.steps)
    .filter(isObject)
    .slice(0, 3)
    .map(step => compactObject({
      id: step.id || '',
      kind: step.kind || '',
      required: step.required === undefined ? undefined : Boolean(step.required),
      cli: step.cli || '',
      artifact_path: step.artifact_path || '',
      recommended_agent: step.recommended_agent || ''
    }));

  return compactObject({
    id: value.id || '',
    mode: value.mode || '',
    source_kind: value.source_kind || '',
    summary: value.summary || '',
    steps
  });
}

function summarizeHandoffProtocol(value) {
  if (!isObject(value)) {
    return null;
  }

  const commands = isObject(value.commands)
    ? compactObject({
        init: isObject(value.commands.init)
          ? compactObject({
              cli: value.commands.init.cli || '',
              argv: truncateList(value.commands.init.argv, 6)
            })
          : null,
        derive: isObject(value.commands.derive)
          ? compactObject({
              cli: value.commands.derive.cli || '',
              argv: truncateList(value.commands.derive.argv, 6)
            })
          : null
      })
    : null;

  return compactObject({
    protocol: value.protocol || '',
    source_kind: value.source_kind || '',
    doc_id: value.doc_id || '',
    artifact_path: value.artifact_path || '',
    recommended_agent: value.recommended_agent || '',
    commands,
    confirmation_targets: truncateList(value.confirmation_targets, 4),
    expected_output: truncateList(value.expected_output, 4)
  });
}

function summarizeActionCard(value) {
  if (!isObject(value)) {
    return null;
  }

  return compactObject({
    status: value.status || '',
    stage: value.stage || '',
    action: value.action || '',
    summary: value.summary || '',
    reason: value.reason || '',
    first_step_label: value.first_step_label || '',
    first_instruction: value.first_instruction || '',
    first_cli: value.first_cli || '',
    then_cli: value.then_cli || '',
    followup: value.followup || ''
  });
}

function summarizeCapabilityRoute(value) {
  if (!isObject(value)) {
    return null;
  }

  const primaryEntry = isObject(value.primary_entry) ? value.primary_entry : {};
  return compactObject({
    capability: value.capability || '',
    category: value.category || '',
    route_strategy: value.route_strategy || '',
    product_role: value.product_role || '',
    generator_owner: value.generator_owner || '',
    repository_layout: value.repository_layout || '',
    materialization_state: value.materialization_state || '',
    host_targets: truncateList(value.host_targets, 5),
    primary_entry: compactObject({
      kind: primaryEntry.kind || '',
      name: primaryEntry.name || '',
      cli: primaryEntry.cli || ''
    }),
    generated_surfaces: truncateList(value.generated_surfaces, 4).map(item => compactObject({
      kind: item && item.kind ? item.kind : '',
      name: item && item.name ? item.name : '',
      materialized:
        item && Object.prototype.hasOwnProperty.call(item, 'materialized')
          ? Boolean(item.materialized)
          : undefined,
      source: item && item.source ? item.source : ''
    }))
  });
}

function summarizeTaskRef(value) {
  if (!isObject(value)) {
    return null;
  }

  const artifacts = isObject(value.artifacts) ? value.artifacts : {};

  return compactObject({
    name: value.name || '',
    title: value.title || '',
    status: value.status || '',
    package: value.package || '',
    path: value.path || '',
    prd: artifacts.prd || ''
  });
}

function summarizeTaskConvergence(value) {
  if (!isObject(value)) {
    return null;
  }

  return compactObject({
    status: value.status || '',
    prd_path: value.prd_path || '',
    summary: value.summary || '',
    prompts: truncateList(value.prompts, 3),
    recommended_path: value.recommended_path || '',
    recommended_reason: value.recommended_reason || '',
    next_cli: value.next_cli || '',
    then_cli: value.then_cli || '',
    review_hint: value.review_hint || ''
  });
}

function normalizeComparableText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isNearDuplicateRecommendation(candidate, actionCard) {
  const text = normalizeComparableText(candidate);
  if (!text) {
    return false;
  }

  const summarizedAction = isObject(actionCard) ? actionCard : {};
  const references = [
    summarizedAction.summary,
    summarizedAction.followup,
    summarizedAction.first_instruction
  ]
    .map(normalizeComparableText)
    .filter(Boolean);

  return references.some(reference => reference.includes(text) || text.includes(reference));
}

function selectBriefHealthRecommendations(recommendations, actionCard, checks) {
  const allRecommendations = toArray(recommendations).filter(Boolean);
  const summarizedAction = isObject(actionCard) ? actionCard : {};
  const hasActionCard = Boolean(
    summarizedAction.stage ||
      summarizedAction.action ||
      summarizedAction.summary
  );
  const relevantKeys = new Set(relevantHealthCheckKeys(summarizedAction.stage || ''));
  const allChecks = toArray(checks).filter(isObject);

  if (!hasActionCard) {
    return truncateList(allRecommendations, 5);
  }

  const preferred =
    allRecommendations.find(item => {
      if (isNearDuplicateRecommendation(item, summarizedAction)) {
        return false;
      }

      const ownerCheck = allChecks.find(check => check.recommendation === item);
      return !(ownerCheck && relevantKeys.has(ownerCheck.key));
    }) ||
    allRecommendations.find(item => !isNearDuplicateRecommendation(item, summarizedAction)) ||
    allRecommendations[0] ||
    '';

  return preferred ? [preferred] : [];
}

function selectBriefHealthPrimaryCli(actionCard, nextCommands) {
  const summarizedAction = isObject(actionCard) ? actionCard : {};
  if (summarizedAction.first_cli) {
    return summarizedAction.first_cli;
  }

  if (summarizedAction.first_instruction) {
    return '';
  }

  const commands = toArray(nextCommands).filter(isObject);
  const firstCommand = commands.find(item => item.cli) || null;
  return firstCommand ? firstCommand.cli || '' : '';
}

function relevantHealthCheckKeys(stage) {
  switch (stage) {
    case 'host-readiness':
      return ['startup_automation'];
    case 'project-facts':
      return ['hardware_identity', 'hw_truth', 'req_truth'];
    case 'apply-document-facts':
      return ['doc_apply_backlog'];
    case 'chip-support':
      return [
        'chip_support_sources_registered',
        'chip_support_sync_project',
        'chip_support_match',
        'chip_support_quality',
        'chip_support_reusability',
        'binding_quality',
        'register_summary_available'
      ];
    case 'chip-support-from-document':
    case 'chip-support-from-analysis':
      return ['chip_support_derive_candidate', 'chip_support_match'];
    default:
      return [];
  }
}

function getHealthCheckPriority(status) {
  switch (status) {
    case 'fail':
      return 0;
    case 'warn':
      return 1;
    case 'info':
      return 2;
    case 'pass':
      return 3;
    default:
      return 4;
  }
}

function selectBriefHealthChecks(checks, actionCard) {
  const allChecks = toArray(checks).filter(isObject);
  const summarizedAction = isObject(actionCard) ? actionCard : {};
  const hasActionCard = Boolean(
    summarizedAction.stage ||
      summarizedAction.action ||
      summarizedAction.summary
  );
  const relevantKeys = new Set(relevantHealthCheckKeys(summarizedAction.stage || ''));

  const ranked = allChecks
    .filter(item => item.key !== 'startup_automation' || relevantKeys.has('startup_automation'))
    .filter(item => !hasActionCard || item.status !== 'info')
    .map((item, index) => ({
      item,
      index,
      relevant: relevantKeys.has(item.key),
      priority: getHealthCheckPriority(item.status)
    }))
    .sort((left, right) => {
      if (left.relevant !== right.relevant) {
        return left.relevant ? -1 : 1;
      }
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.index - right.index;
    })
    .map(entry => entry.item);

  const limit = hasActionCard ? 3 : 5;
  const limited = ranked.slice(0, limit);
  const hasBlocking = limited.some(item => item.status === 'fail' || item.status === 'warn');

  if (hasBlocking) {
    return limited.filter(item => item.status !== 'pass').slice(0, limit);
  }

  return limited;
}

function summarizeHealth(value) {
  if (!isObject(value)) {
    return null;
  }

  return compactObject({
    status: value.status || '',
    summary: isObject(value.summary) ? value.summary : null,
    quickstart: isObject(value.quickstart)
      ? compactObject({
          followup: value.quickstart.followup || '',
          steps: truncateList(value.quickstart.steps, 3)
        })
      : null
  });
}

function summarizeSubagentBridge(value) {
  if (!isObject(value)) {
    return null;
  }

  return compactObject({
    available: value.available === undefined ? undefined : Boolean(value.available),
    invoked: value.invoked === undefined ? undefined : Boolean(value.invoked),
    mode: value.mode || '',
    source: value.source || '',
    status: value.status || ''
  });
}

function summarizeWorkspaceTrust(value) {
  if (!isObject(value)) {
    return null;
  }

  return compactObject({
    trusted: value.trusted === undefined ? undefined : Boolean(value.trusted),
    explicit: value.explicit === undefined ? undefined : Boolean(value.explicit),
    source: value.source || '',
    signal: value.signal || '',
    summary: value.summary || ''
  });
}

function summarizeDelegationRuntime(value) {
  if (!isObject(value)) {
    return null;
  }

  const synthesis = isObject(value.synthesis) ? value.synthesis : {};
  const integration = isObject(value.integration) ? value.integration : {};
  const review = isObject(value.review) ? value.review : {};
  const stageA = isObject(review.stage_a) ? review.stage_a : {};
  const stageB = isObject(review.stage_b) ? review.stage_b : {};
  return compactObject({
    pattern: value.pattern || '',
    strategy: value.strategy || '',
    requested_action: value.requested_action || '',
    resolved_action: value.resolved_action || '',
    phases: truncateList(toArray(value.phases).map(item => item && item.id ? item.id : ''), 6),
    launch_requests: truncateList(
      toArray(value.launch_requests).map(item => item && item.agent ? item.agent : ''),
      4
    ),
    jobs: truncateList(
      toArray(value.jobs).map(item => item && item.agent ? `${item.agent}:${item.status || ''}` : ''),
      4
    ),
    worker_results: truncateList(
      toArray(value.worker_results).map(item => item && item.agent ? `${item.agent}:${item.status || ''}` : ''),
      4
    ),
    synthesis: compactObject({
      required: synthesis.required === undefined ? undefined : Boolean(synthesis.required),
      status: synthesis.status || '',
      owner: synthesis.owner || ''
    }),
    integration: compactObject({
      status: integration.status || '',
      owner: integration.owner || '',
      execution_kind: integration.execution_kind || ''
    }),
    review: compactObject({
      required: review.required === undefined ? undefined : Boolean(review.required),
      redispatch_required: review.redispatch_required === undefined ? undefined : Boolean(review.redispatch_required),
      stage_a: stageA.status || '',
      stage_b: stageB.status || ''
    })
  });
}

function summarizeWorkflowStage(value) {
  if (!isObject(value)) {
    return null;
  }

  return compactObject({
    name: value.name || '',
    why: value.why || '',
    exit_criteria: value.exit_criteria || '',
    primary_command: value.primary_command || ''
  });
}

function summarizeQualityGates(value) {
  if (!isObject(value)) {
    return null;
  }

  return compactObject({
    gate_status: value.gate_status || '',
    status_summary: value.status_summary || '',
    blocking_summary: value.blocking_summary || '',
    required_skills: truncateList(value.required_skills, 6),
    required_executors: truncateList(value.required_executors, 6),
    required_signoffs: truncateList(value.required_signoffs, 6),
    required_hardware_checks: truncateList(value.required_hardware_checks, 6),
    pending_skills: truncateList(value.pending_skills, 6),
    failed_skills: truncateList(value.failed_skills, 6),
    pending_gates: truncateList(value.pending_gates, 6),
    failed_gates: truncateList(value.failed_gates, 6),
    pending_signoffs: truncateList(value.pending_signoffs, 6),
    rejected_signoffs: truncateList(value.rejected_signoffs, 6),
    passed_hw_checks: truncateList(value.passed_hw_checks, 6),
    failed_hw_checks: truncateList(value.failed_hw_checks, 6),
    pending_hw_checks: truncateList(value.pending_hw_checks, 6),
    recommended_runs: truncateList(value.recommended_runs, 6),
    recommended_signoffs: truncateList(value.recommended_signoffs, 6)
  });
}

function summarizePermissionGates(value) {
  const summary = permissionGateHelpers.summarizePermissionGates(value);
  if (!summary || summary.total === 0) {
    return null;
  }

  return compactObject({
    status: summary.status || '',
    total: Number.isFinite(summary.total) ? summary.total : undefined,
    blocked: Number.isFinite(summary.blocked) ? summary.blocked : undefined,
    pending: Number.isFinite(summary.pending) ? summary.pending : undefined,
    passed: Number.isFinite(summary.passed) ? summary.passed : undefined,
    kinds: truncateList(summary.kinds, 4),
    commands: truncateList(summary.commands, 4),
    summaries: truncateList(summary.summaries, 3)
  });
}

function compactObject(input) {
  if (!isObject(input)) {
    return input;
  }

  const output = {};
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined || raw === null) {
      continue;
    }

    if (Array.isArray(raw)) {
      if (raw.length > 0) {
        output[key] = raw;
      }
      continue;
    }

    if (isObject(raw)) {
      const nested = compactObject(raw);
      if (Object.keys(nested).length > 0) {
        output[key] = nested;
      }
      continue;
    }

    if (raw === '') {
      continue;
    }

    output[key] = raw;
  }
  return output;
}

function buildBriefNextContext(value) {
  const current = isObject(value.current) ? value.current : {};
  const next = isObject(value.next) ? value.next : {};
  const task = isObject(value.task) ? value.task : {};

  return compactObject({
    output_mode: 'brief',
    current: compactObject({
      profile: current.profile || '',
      specs: toArray(current.specs),
      default_package: current.default_package || '',
      active_package: current.active_package || '',
      focus: current.focus || '',
      last_command: current.last_command || '',
      suggested_flow: current.suggested_flow || ''
    }),
    task: compactObject({
      name: task.name || '',
      status: task.status || '',
      package: task.package || ''
    }),
    task_convergence: summarizeTaskConvergence(value.task_convergence),
    next: compactObject({
      command: next.command || '',
      reason: next.reason || '',
      cli: next.cli || '',
      gated_by_health: Boolean(next.gated_by_health)
    }),
    capability_route: summarizeCapabilityRoute(value.capability_route || next.capability_route),
    workflow_stage: summarizeWorkflowStage(value.workflow_stage),
    action_card: summarizeActionCard(value.action_card),
    quality_gates: summarizeQualityGates(value.quality_gates),
    permission_gates: summarizePermissionGates(value.permission_gates),
    runtime_events: runtimeEventHelpers.summarizeRuntimeEvents(value.runtime_events),
    tool_recommendation: summarizeToolRecommendation(next.tool_recommendation || value.tool_recommendation),
    walkthrough_recommendation: summarizeWalkthroughRecommendation(
      next.walkthrough_recommendation || value.walkthrough_recommendation
    ),
    walkthrough_execution: summarizeWalkthroughExecution(value.walkthrough_execution),
    memory_summary: summarizeMemorySummary(value.memory_summary),
    context_hygiene: summarizeContextHygiene(value.context_hygiene),
    recommended_flow: summarizeRecommendedFlow(value.recommended_flow || next.recommended_flow),
    handoff_protocol: summarizeHandoffProtocol(value.handoff_protocol || next.handoff_protocol),
    next_actions: truncateList(value.next_actions, 5),
    health: summarizeHealth(value.health)
  });
}

function buildBriefStartContext(value) {
  const summary = isObject(value.summary) ? value.summary : {};
  const immediate = isObject(value.immediate) ? value.immediate : {};
  const taskIntake = isObject(value.task_intake) ? value.task_intake : {};

  return compactObject({
    output_mode: 'brief',
    entry: value.entry || 'start',
    summary: compactObject({
      project_root: summary.project_root || '',
      initialized: summary.initialized === undefined ? undefined : Boolean(summary.initialized),
      handoff_present: summary.handoff_present === undefined ? undefined : Boolean(summary.handoff_present),
      default_package: summary.default_package || '',
      active_package: summary.active_package || '',
      active_task: isObject(summary.active_task)
        ? compactObject({
            name: summary.active_task.name || '',
            package: summary.active_task.package || '',
            status: summary.active_task.status || ''
          })
        : null,
      hardware_identity: isObject(summary.hardware_identity) ? summary.hardware_identity : null
    }),
    immediate: compactObject({
      command: immediate.command || '',
      reason: immediate.reason || '',
      cli: immediate.cli || ''
    }),
    task_intake: compactObject({
      status: taskIntake.status || '',
      recommended_entry: taskIntake.recommended_entry || '',
      summary: taskIntake.summary || '',
      modes: truncateList(
        toArray(taskIntake.paths)
          .map(item => item && item.id ? item.id : '')
          .filter(Boolean),
        4
      )
    }),
    bootstrap: compactObject({
      status: value.bootstrap && value.bootstrap.status || '',
      stage: value.bootstrap && value.bootstrap.stage || '',
      command: value.bootstrap && value.bootstrap.command || '',
      summary: value.bootstrap && value.bootstrap.summary || ''
    }),
    runtime_events: runtimeEventHelpers.summarizeRuntimeEvents(value.runtime_events),
    next: isObject(value.next)
      ? compactObject({
          command: value.next.command || '',
          reason: value.next.reason || '',
          cli: value.next.cli || ''
        })
      : null
  });
}

function buildBriefInitOutput(value) {
  const bootstrap = isObject(value.bootstrap) ? value.bootstrap : {};
  const session = isObject(value.session) ? value.session : {};

  return compactObject({
    output_mode: 'brief',
    initialized: value.initialized === undefined ? undefined : Boolean(value.initialized),
    reused_existing: value.reused_existing === undefined ? undefined : Boolean(value.reused_existing),
    init_alias: value.init_alias || '',
    project_root: value.project_root || '',
    project_dir: value.project_dir || '',
    project_profile: value.project_profile || session.project_profile || '',
    active_specs: toArray(value.active_specs || session.active_specs),
    developer: isObject(value.developer) ? value.developer : (isObject(session.developer) ? session.developer : null),
    bootstrap: compactObject({
      status: bootstrap.status || '',
      stage: bootstrap.stage || '',
      command: bootstrap.command || '',
      summary: bootstrap.summary || ''
    }),
    runtime_events: runtimeEventHelpers.summarizeRuntimeEvents(value.runtime_events)
  });
}

function buildBriefResumeContext(value) {
  const summary = isObject(value.summary) ? value.summary : {};

  return compactObject({
    output_mode: 'brief',
    summary: compactObject({
      profile: summary.profile || '',
      specs: toArray(summary.specs),
      focus: summary.focus || '',
      last_command: summary.last_command || '',
      suggested_flow: summary.suggested_flow || '',
      resume_source: summary.resume_source || ''
    }),
    handoff: isObject(value.handoff)
      ? compactObject({
          status: value.handoff.status || '',
          next_action: value.handoff.next_action || '',
          timestamp: value.handoff.timestamp || ''
        })
      : null,
    task: isObject(value.task)
      ? compactObject({
          name: value.task.name || '',
          title: value.task.title || '',
          status: value.task.status || '',
          worktree_path: value.task.worktree_path || ''
        })
      : null,
    tool_recommendation: summarizeToolRecommendation(value.tool_recommendation),
    memory_summary: summarizeMemorySummary(value.memory_summary),
    context_hygiene: summarizeContextHygiene(value.context_hygiene),
    next_actions: truncateList(value.next_actions, 5)
  });
}

function buildBriefPlanOutput(value) {
  return compactObject({
    output_mode: 'brief',
    goal: value.goal || '',
    truth_sources: truncateList(value.truth_sources, 5),
    constraints: truncateList(value.constraints, 5),
    risks: truncateList(value.risks, 5),
    steps: truncateList(value.steps, 5),
    verification: truncateList(value.verification, 4),
    workflow_stage: summarizeWorkflowStage(value.workflow_stage),
    action_card: summarizeActionCard(value.action_card),
    next_actions: truncateList(value.next_actions, 4),
    scheduler: summarizeScheduler(value.scheduler)
  });
}

function buildBriefDoOutput(value) {
  const executionBrief = isObject(value.execution_brief) ? value.execution_brief : {};

  return compactObject({
    output_mode: 'brief',
    chosen_agent: value.chosen_agent || '',
    prerequisites: truncateList(value.prerequisites, 4),
    safety_checks: truncateList(value.safety_checks, 4),
    execution_brief: compactObject({
      focus_order: truncateList(executionBrief.focus_order, 4),
      suggested_steps: truncateList(executionBrief.suggested_steps, 4),
      supporting_agents: truncateList(executionBrief.supporting_agents, 3)
    }),
    workflow_stage: summarizeWorkflowStage(value.workflow_stage),
    action_card: summarizeActionCard(value.action_card),
    next_actions: truncateList(value.next_actions, 4),
    scheduler: summarizeScheduler(value.scheduler)
  });
}

function buildBriefScanOutput(value) {
  return compactObject({
    output_mode: 'brief',
    relevant_files: truncateList(value.relevant_files, 5),
    key_facts: truncateList(value.key_facts, 6),
    open_questions: truncateList(value.open_questions, 4),
    next_reads: truncateList(value.next_reads, 5),
    workflow_stage: summarizeWorkflowStage(value.workflow_stage),
    action_card: summarizeActionCard(value.action_card),
    next_actions: truncateList(value.next_actions, 4),
    scheduler: summarizeScheduler(value.scheduler)
  });
}

function buildBriefDebugOutput(value) {
  return compactObject({
    output_mode: 'brief',
    chosen_agent: value.chosen_agent || '',
    hypotheses: truncateList(value.hypotheses, 4),
    checks: truncateList(value.checks, 4),
    next_step: value.next_step || '',
    workflow_stage: summarizeWorkflowStage(value.workflow_stage),
    action_card: summarizeActionCard(value.action_card),
    next_actions: truncateList(value.next_actions, 4),
    scheduler: summarizeScheduler(value.scheduler)
  });
}

function buildBriefReviewOutput(value) {
  const scope = isObject(value.scope) ? value.scope : {};

  return compactObject({
    output_mode: 'brief',
    scope: compactObject({
      profile: scope.profile || '',
      specs: toArray(scope.specs),
      focus: scope.focus || '',
      runtime_model: scope.runtime_model || '',
      concurrency_model: scope.concurrency_model || ''
    }),
    axes: truncateList(value.axes, 6),
    required_checks: truncateList(value.required_checks, 5),
    review_agents: truncateList(value.review_agents, 4),
    workflow_stage: summarizeWorkflowStage(value.workflow_stage),
    action_card: summarizeActionCard(value.action_card),
    next_actions: truncateList(value.next_actions, 4),
    scheduler: summarizeScheduler(value.scheduler)
  });
}

function buildBriefVerifyOutput(value) {
  const scope = isObject(value.scope) ? value.scope : {};

  return compactObject({
    output_mode: 'brief',
    scope: compactObject({
      profile: scope.profile || '',
      specs: toArray(scope.specs),
      focus: scope.focus || '',
      runtime_model: scope.runtime_model || '',
      concurrency_model: scope.concurrency_model || ''
    }),
    checklist: truncateList(value.checklist, 6),
    evidence_targets: truncateList(value.evidence_targets, 5),
    next_step: value.next_step || '',
    quality_gates: summarizeQualityGates(value.quality_gates),
    permission_gates: summarizePermissionGates(value.permission_gates),
    verification_focus: truncateList(value.verification_focus, 4),
    workflow_stage: summarizeWorkflowStage(value.workflow_stage),
    action_card: summarizeActionCard(value.action_card),
    next_actions: truncateList(value.next_actions, 4),
    scheduler: summarizeScheduler(value.scheduler)
  });
}

function buildBriefForensicsOutput(value) {
  return compactObject({
    output_mode: 'brief',
    problem: value.problem || '',
    evidence_sources: truncateList(value.evidence_sources, 5),
    findings_template: truncateList(value.findings_template, 4),
    next_step: value.next_step || '',
    chosen_agent: value.chosen_agent || '',
    scheduler: summarizeScheduler(value.scheduler)
  });
}

function buildBriefNoteOutput(value) {
  return compactObject({
    output_mode: 'brief',
    target_docs: truncateList(value.target_docs, 5),
    recordable_items: truncateList(value.recordable_items, 6),
    chosen_agent: value.chosen_agent || '',
    scheduler: summarizeScheduler(value.scheduler)
  });
}

function buildBriefHealthOutput(value) {
  const actionCard = summarizeActionCard(value.action_card);
  const checks = selectBriefHealthChecks(value.checks, actionCard);
  const quickstart = isObject(value.quickstart) ? value.quickstart : {};
  const recommendations = selectBriefHealthRecommendations(value.recommendations, actionCard, value.checks);
  const primaryCli = selectBriefHealthPrimaryCli(actionCard, value.next_commands);

  return compactObject({
    output_mode: 'brief',
    status: value.status || '',
    runtime_host: value.runtime_host || '',
    summary: isObject(value.summary) ? value.summary : null,
    checks,
    recommendations,
    primary_cli: primaryCli,
    next_commands: truncateList(value.next_commands, 4),
    subagent_bridge: summarizeSubagentBridge(value.subagent_bridge),
    action_card: actionCard,
    recommended_flow: summarizeRecommendedFlow(value.recommended_flow),
    handoff_protocol: summarizeHandoffProtocol(value.handoff_protocol),
    quickstart: isObject(value.quickstart)
      ? compactObject({
          stage: quickstart.display_stage || quickstart.stage || '',
          summary: quickstart.user_summary || quickstart.summary || '',
          followup: value.quickstart.followup || '',
          steps: truncateList(value.quickstart.steps, 3)
        })
      : null
  });
}

function buildBriefBootstrapOutput(value) {
  const nextStage = isObject(value.next_stage) ? value.next_stage : {};

  return compactObject({
    output_mode: 'brief',
    command: value.command || 'bootstrap',
    status: value.display_status || value.status || '',
    summary: value.display_summary || value.summary || '',
    current_stage: value.display_current_stage || value.current_stage || '',
    action_card: summarizeActionCard(value.action_card),
    next_stage: compactObject({
      id: nextStage.display_id || nextStage.id || '',
      status: nextStage.display_status || nextStage.status || '',
      label: nextStage.label || '',
      action_summary: nextStage.action_summary || '',
      cli: nextStage.cli || ''
    }),
    stages: truncateList(value.stages, 5).map(stage => compactObject({
      id: stage.display_id || stage.id || '',
      status: stage.display_status || stage.status || '',
      label: stage.label || '',
      action_summary: stage.action_summary || '',
      cli: stage.cli || ''
    })),
    quickstart: isObject(value.quickstart)
      ? compactObject({
          stage: value.quickstart.display_stage || value.quickstart.stage || '',
          summary: value.quickstart.user_summary || value.quickstart.summary || '',
          followup: value.quickstart.followup || '',
          steps: truncateList(value.quickstart.steps, 3)
        })
      : null
  });
}

function buildBriefDispatchOrchestrateOutput(value) {
  return compactObject({
    output_mode: 'brief',
    requested_action: value.requested_action || '',
    resolved_action: value.resolved_action || '',
    reason: value.reason || '',
    cli: value.cli || '',
    capability_route: summarizeCapabilityRoute(value.capability_route),
    dispatch_ready: value.dispatch_ready === undefined ? undefined : Boolean(value.dispatch_ready),
    workflow: isObject(value.workflow)
      ? compactObject({
          strategy: value.workflow.strategy || '',
          next_cli: value.workflow.next_cli || ''
        })
      : null,
    permission_gates: summarizePermissionGates(value.permission_gates),
    tool_execution: isObject(value.tool_execution)
      ? compactObject({
          status: value.tool_execution.status || '',
          action: value.tool_execution.action || '',
          cli: value.tool_execution.cli || ''
        })
      : null,
    walkthrough_execution: summarizeWalkthroughExecution(value.walkthrough_execution),
    subagent_bridge: summarizeSubagentBridge(value.subagent_bridge),
    delegation_runtime: summarizeDelegationRuntime(value.delegation_runtime),
    workflow_stage: summarizeWorkflowStage(value.workflow_stage),
    runtime_events: runtimeEventHelpers.summarizeRuntimeEvents(value.runtime_events),
    context_hygiene: summarizeContextHygiene(value.context_hygiene)
  });
}

function buildBriefStatusOutput(value) {
  return compactObject({
    output_mode: 'brief',
    project_root: value.project_root || '',
    project_profile: value.project_profile || '',
    active_specs: truncateList(value.active_specs, 4),
    default_package: value.default_package || '',
    active_package: value.active_package || '',
    capability_route: summarizeCapabilityRoute(value.capability_route),
    next_action: isObject(value.next_action)
      ? compactObject({
          command: value.next_action.command || '',
          reason: value.next_action.reason || '',
          cli: value.next_action.cli || ''
        })
      : null,
    next_capability_route: summarizeCapabilityRoute(value.next_capability_route),
    active_task: isObject(value.active_task)
      ? compactObject({
          name: value.active_task.name || '',
          status: value.active_task.status || '',
          package: value.active_task.package || ''
        })
      : null,
    focus: value.focus || '',
    open_questions: truncateList(value.open_questions, 4),
    known_risks: truncateList(value.known_risks, 4),
    last_files: truncateList(value.last_files, 5),
    runtime_host: value.runtime_host || '',
    subagent_bridge: summarizeSubagentBridge(value.subagent_bridge),
    delegation_runtime: summarizeDelegationRuntime(value.delegation_runtime),
    walkthrough_execution: summarizeWalkthroughExecution(value.walkthrough_execution),
    memory_summary: summarizeMemorySummary(value.memory_summary),
    permission_gates: summarizePermissionGates(value.permission_gates),
    runtime_events: runtimeEventHelpers.summarizeRuntimeEvents(value.runtime_events),
    context_hygiene: summarizeContextHygiene(value.context_hygiene)
  });
}

function buildBriefTaskLifecycleOutput(value) {
  const workspace = isObject(value.workspace) ? value.workspace : {};
  const worktree = isObject(value.worktree) ? value.worktree : {};

  return compactObject({
    output_mode: 'brief',
    created: value.created === undefined ? undefined : Boolean(value.created),
    activated: value.activated === undefined ? undefined : Boolean(value.activated),
    task: summarizeTaskRef(value.task),
    workspace: compactObject({
      mode: workspace.mode || '',
      path: workspace.path || ''
    }),
    worktree: compactObject({
      summary: worktree.summary || '',
      workspace_state: worktree.workspace_state || '',
      attention: worktree.attention || ''
    }),
    task_convergence: summarizeTaskConvergence(value.task_convergence),
    runtime_events: runtimeEventHelpers.summarizeRuntimeEvents(value.runtime_events)
  });
}

function buildBriefToolOutput(value) {
  return compactObject({
    output_mode: 'brief',
    tool: value.tool || '',
    status: value.status || '',
    implementation: value.implementation || '',
    permission_gates: summarizePermissionGates(value.permission_gates),
    high_risk_clarity: isObject(value.high_risk_clarity)
      ? compactObject({
          enabled: value.high_risk_clarity.enabled === undefined ? undefined : Boolean(value.high_risk_clarity.enabled),
          category: value.high_risk_clarity.category || '',
          requires_explicit_confirmation: value.high_risk_clarity.requires_explicit_confirmation === undefined
            ? undefined
            : Boolean(value.high_risk_clarity.requires_explicit_confirmation),
          matched_signals: truncateList(value.high_risk_clarity.matched_signals, 4)
        })
      : null
  });
}

function applyBriefMode(value) {
  if (!isObject(value)) {
    return value;
  }

  if (isObject(value.current) && isObject(value.next) && Array.isArray(value.next_actions)) {
    return buildBriefNextContext(value);
  }

  if (value.entry === 'start' && isObject(value.summary) && isObject(value.immediate)) {
    return buildBriefStartContext(value);
  }

  if (Object.prototype.hasOwnProperty.call(value, 'initialized') && Object.prototype.hasOwnProperty.call(value, 'bootstrap')) {
    return buildBriefInitOutput(value);
  }

  if (isObject(value.summary) && Array.isArray(value.next_actions) && Object.prototype.hasOwnProperty.call(value, 'carry_over')) {
    return buildBriefResumeContext(value);
  }

  if (Object.prototype.hasOwnProperty.call(value, 'goal') && Array.isArray(value.steps) && Array.isArray(value.verification)) {
    return buildBriefPlanOutput(value);
  }

  if (Object.prototype.hasOwnProperty.call(value, 'execution_brief') && Array.isArray(value.prerequisites)) {
    return buildBriefDoOutput(value);
  }

  if (Array.isArray(value.relevant_files) && Array.isArray(value.key_facts) && Array.isArray(value.next_reads)) {
    return buildBriefScanOutput(value);
  }

  if (Array.isArray(value.hypotheses) && Array.isArray(value.checks) && Object.prototype.hasOwnProperty.call(value, 'next_step')) {
    return buildBriefDebugOutput(value);
  }

  if (isObject(value.scope) && Array.isArray(value.axes) && Array.isArray(value.required_checks)) {
    return buildBriefReviewOutput(value);
  }

  if (isObject(value.scope) && Array.isArray(value.checklist) && Array.isArray(value.evidence_targets)) {
    return buildBriefVerifyOutput(value);
  }

  if (Object.prototype.hasOwnProperty.call(value, 'problem') && Array.isArray(value.evidence_sources) && Array.isArray(value.findings_template)) {
    return buildBriefForensicsOutput(value);
  }

  if (Array.isArray(value.target_docs) && Array.isArray(value.recordable_items)) {
    return buildBriefNoteOutput(value);
  }

  if (Array.isArray(value.checks) && Array.isArray(value.recommendations) && Array.isArray(value.next_commands)) {
    return buildBriefHealthOutput(value);
  }

  if (Object.prototype.hasOwnProperty.call(value, 'requested_action') && Object.prototype.hasOwnProperty.call(value, 'resolved_action')) {
    return buildBriefDispatchOrchestrateOutput(value);
  }

  if (Object.prototype.hasOwnProperty.call(value, 'current_stage') && Array.isArray(value.stages) && Object.prototype.hasOwnProperty.call(value, 'quickstart')) {
    return buildBriefBootstrapOutput(value);
  }

  if (Object.prototype.hasOwnProperty.call(value, 'session_version') && Object.prototype.hasOwnProperty.call(value, 'project_root') && Object.prototype.hasOwnProperty.call(value, 'context_hygiene')) {
    return buildBriefStatusOutput(value);
  }

  if (Object.prototype.hasOwnProperty.call(value, 'tool') && Object.prototype.hasOwnProperty.call(value, 'status') && Object.prototype.hasOwnProperty.call(value, 'implementation')) {
    return buildBriefToolOutput(value);
  }

  if (isObject(value.task) && (Object.prototype.hasOwnProperty.call(value, 'created') || Object.prototype.hasOwnProperty.call(value, 'activated'))) {
    return buildBriefTaskLifecycleOutput(value);
  }

  if (isObject(value.scheduler)) {
    return compactObject({
      output_mode: 'brief',
      scheduler: summarizeScheduler(value.scheduler)
    });
  }

  return value;
}

function parseOutputModeArgs(tokens) {
  const args = Array.isArray(tokens) ? tokens : [];
  const cleaned = [];
  let firstNonFlagIndex = 0;
  while (
    firstNonFlagIndex < args.length &&
    (args[firstNonFlagIndex] === '--brief' || args[firstNonFlagIndex] === '--json')
  ) {
    firstNonFlagIndex += 1;
  }

  const isToolRunCommand = args[firstNonFlagIndex] === 'tool' && args[firstNonFlagIndex + 1] === 'run';
  const preserveFromIndex = isToolRunCommand ? firstNonFlagIndex + 3 : Number.POSITIVE_INFINITY;
  let brief = false;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === '--json') {
      json = true;
      continue;
    }

    if (token === '--brief') {
      const canUseAsGlobal = index < preserveFromIndex;
      if (canUseAsGlobal) {
        brief = true;
        continue;
      }
    }

    cleaned.push(token);
  }

  return {
    args: cleaned,
    brief,
    json
  };
}

function applyOutputMode(value, brief) {
  if (!brief) {
    return value;
  }

  return applyBriefMode(value);
}

module.exports = {
  applyOutputMode,
  parseOutputModeArgs,
  summarizeContextHygiene,
  summarizeScheduler,
  summarizeToolRecommendation,
  summarizeActionCard,
  summarizeHealth,
  summarizePermissionGates,
  compactObject,
  truncateList,
  unique
};
