'use strict';

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
    handoff_ready: Boolean(value.handoff_ready)
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

  return compactObject({
    output_mode: 'brief',
    current: compactObject({
      profile: current.profile || '',
      packs: toArray(current.packs),
      focus: current.focus || '',
      last_command: current.last_command || '',
      suggested_flow: current.suggested_flow || ''
    }),
    next: compactObject({
      command: next.command || '',
      reason: next.reason || '',
      cli: next.cli || '',
      gated_by_health: Boolean(next.gated_by_health)
    }),
    tool_recommendation: summarizeToolRecommendation(next.tool_recommendation || value.tool_recommendation),
    context_hygiene: summarizeContextHygiene(value.context_hygiene),
    next_actions: truncateList(value.next_actions, 5),
    health: summarizeHealth(value.health)
  });
}

function buildBriefResumeContext(value) {
  const summary = isObject(value.summary) ? value.summary : {};

  return compactObject({
    output_mode: 'brief',
    summary: compactObject({
      profile: summary.profile || '',
      packs: toArray(summary.packs),
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
          status: value.task.status || ''
        })
      : null,
    workspace: isObject(value.workspace)
      ? compactObject({
          name: value.workspace.name || '',
          title: value.workspace.title || '',
          status: value.workspace.status || ''
        })
      : null,
    thread: isObject(value.thread)
      ? compactObject({
          name: value.thread.name || '',
          title: value.thread.title || '',
          status: value.thread.status || ''
        })
      : null,
    tool_recommendation: summarizeToolRecommendation(value.tool_recommendation),
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
    scheduler: summarizeScheduler(value.scheduler)
  });
}

function buildBriefReviewOutput(value) {
  const scope = isObject(value.scope) ? value.scope : {};

  return compactObject({
    output_mode: 'brief',
    scope: compactObject({
      profile: scope.profile || '',
      packs: toArray(scope.packs),
      focus: scope.focus || '',
      runtime_model: scope.runtime_model || '',
      concurrency_model: scope.concurrency_model || ''
    }),
    axes: truncateList(value.axes, 6),
    required_checks: truncateList(value.required_checks, 5),
    review_agents: truncateList(value.review_agents, 4),
    scheduler: summarizeScheduler(value.scheduler)
  });
}

function buildBriefVerifyOutput(value) {
  const scope = isObject(value.scope) ? value.scope : {};

  return compactObject({
    output_mode: 'brief',
    scope: compactObject({
      profile: scope.profile || '',
      packs: toArray(scope.packs),
      focus: scope.focus || '',
      runtime_model: scope.runtime_model || '',
      concurrency_model: scope.concurrency_model || ''
    }),
    checklist: truncateList(value.checklist, 6),
    evidence_targets: truncateList(value.evidence_targets, 5),
    next_step: value.next_step || '',
    verification_focus: truncateList(value.verification_focus, 4),
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
  return compactObject({
    output_mode: 'brief',
    status: value.status || '',
    summary: isObject(value.summary) ? value.summary : null,
    checks: truncateList(value.checks, 5),
    recommendations: truncateList(value.recommendations, 5),
    next_commands: truncateList(value.next_commands, 4),
    quickstart: isObject(value.quickstart)
      ? compactObject({
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
    skill: value.skill || '',
    cli: value.cli || '',
    dispatch_ready: value.dispatch_ready === undefined ? undefined : Boolean(value.dispatch_ready),
    workflow: isObject(value.workflow)
      ? compactObject({
          strategy: value.workflow.strategy || '',
          next_skill: value.workflow.next_skill || '',
          next_cli: value.workflow.next_cli || ''
        })
      : null,
    tool_execution: isObject(value.tool_execution)
      ? compactObject({
          status: value.tool_execution.status || '',
          action: value.tool_execution.action || '',
          cli: value.tool_execution.cli || ''
        })
      : null,
    context_hygiene: summarizeContextHygiene(value.context_hygiene)
  });
}

function buildBriefStatusOutput(value) {
  return compactObject({
    output_mode: 'brief',
    project_root: value.project_root || '',
    project_profile: value.project_profile || '',
    active_packs: truncateList(value.active_packs, 4),
    focus: value.focus || '',
    open_questions: truncateList(value.open_questions, 4),
    known_risks: truncateList(value.known_risks, 4),
    last_files: truncateList(value.last_files, 5),
    context_hygiene: summarizeContextHygiene(value.context_hygiene)
  });
}

function applyBriefMode(value) {
  if (!isObject(value)) {
    return value;
  }

  if (isObject(value.current) && isObject(value.next) && Array.isArray(value.next_actions)) {
    return buildBriefNextContext(value);
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

  if (Object.prototype.hasOwnProperty.call(value, 'session_version') && Object.prototype.hasOwnProperty.call(value, 'project_root') && Object.prototype.hasOwnProperty.call(value, 'context_hygiene')) {
    return buildBriefStatusOutput(value);
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
  while (firstNonFlagIndex < args.length && args[firstNonFlagIndex] === '--brief') {
    firstNonFlagIndex += 1;
  }

  const isToolRunCommand = args[firstNonFlagIndex] === 'tool' && args[firstNonFlagIndex + 1] === 'run';
  const preserveFromIndex = isToolRunCommand ? firstNonFlagIndex + 3 : Number.POSITIVE_INFINITY;
  let brief = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

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
    brief
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
  summarizeHealth,
  compactObject,
  truncateList,
  unique
};
