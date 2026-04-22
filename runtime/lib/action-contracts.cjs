'use strict';

const path = require('path');

const runtimeHostHelpers = require('./runtime-host.cjs');
const permissionGateHelpers = require('./permission-gates.cjs');
const workflowRegistry = require('./workflow-registry.cjs');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);

function createActionContractHelpers(deps) {
  const {
    runtime,
    scheduler,
    resolveSession,
    loadHandoff,
    buildHealthReport,
    buildContextHygiene,
    enrichWithToolSuggestions,
    buildArchReviewContext,
    buildWorkflowStage,
    getActiveTask
  } = deps;

  function buildCli(args) {
    return runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, Array.isArray(args) ? args : []);
  }

  function buildActionFollowup(action, resolved, activeTask) {
    const scanWorkflowStage = action === 'scan' && typeof buildWorkflowStage === 'function'
      ? buildWorkflowStage({ command: 'scan' }, resolved)
      : null;
    const blankSelection = action === 'scan'
      ? Boolean(scanWorkflowStage && scanWorkflowStage.name === 'selection')
      : (resolved && resolved.session
          ? Boolean(
              resolved.hardware &&
                resolved.hardware.selection_mode === 'blank-project'
            )
          : false);

    if (action === 'scan') {
      const nextAction = blankSelection ? 'plan' : 'do';
      return {
        label: blankSelection ? 'Continue with plan' : 'Continue with do',
        cli: buildCli([nextAction]),
        followup: `Then: ${buildCli(['verify'])}`
      };
    }

    if (action === 'plan') {
      return {
        label: 'Continue with do',
        cli: buildCli(['do']),
        followup: `Then: ${buildCli(['verify'])}`
      };
    }

    if (action === 'do') {
      return {
        label: 'Continue with verify',
        cli: buildCli(['verify']),
        followup: activeTask && activeTask.name
          ? `Then: ${buildCli(['task', 'aar', 'scan', activeTask.name])}`
          : ''
      };
    }

    if (action === 'debug') {
      return {
        label: 'Return to do once the branch is clear',
        cli: buildCli(['do']),
        followup: `Then: ${buildCli(['verify'])}`
      };
    }

    if (action === 'review') {
      return {
        label: 'Continue with do after structural risks are explicit',
        cli: buildCli(['do']),
        followup: `Then: ${buildCli(['verify'])}`
      };
    }

    if (action === 'verify') {
      if (activeTask && activeTask.name) {
        return {
          label: 'Record the task AAR scan',
          cli: buildCli(['task', 'aar', 'scan', activeTask.name]),
          followup: `Then: ${buildCli(['task', 'resolve', activeTask.name])}`
        };
      }

      return {
        label: 'Review remaining closure work',
        cli: buildCli(['next']),
        followup: ''
      };
    }

    if (action === 'forensics') {
      return {
        label: 'Return to debug with the narrowed evidence',
        cli: buildCli(['debug']),
        followup: `Then: ${buildCli(['do'])}`
      };
    }

    if (action === 'note') {
      return {
        label: 'Continue with the default next step',
        cli: buildCli(['next']),
        followup: ''
      };
    }

    return {
      label: '',
      cli: '',
      followup: ''
    };
  }

  function buildActionSummary(action) {
    switch (action) {
      case 'scan':
        return 'Action=scan. Lock the real change surface before mutation.';
      case 'plan':
        return 'Action=plan. Lock truth, constraints, and the smallest executable order before mutation.';
      case 'do':
        return 'Action=do. Execute the smallest durable change and keep verification debt explicit.';
      case 'debug':
        return 'Action=debug. Eliminate hypotheses one by one before patching.';
      case 'review':
        return 'Action=review. Inspect structural risk without collapsing into style review.';
      case 'verify':
        return 'Action=verify. Close evidence item by item and surface any failed or untested gates.';
      case 'forensics':
        return 'Action=forensics. Converge the problem statement and evidence before choosing the return path.';
      case 'note':
        return 'Action=note. Record stable conclusions only and keep temporary session fragments out.';
      default:
        return '';
    }
  }

  function buildActionReason(action, output, resolved) {
    if (action === 'plan') {
      return output.goal ? `goal=${output.goal}` : '';
    }
    if (action === 'do' || action === 'debug') {
      return output.chosen_agent ? `primary_agent=${output.chosen_agent}` : '';
    }
    if (action === 'review') {
      return Array.isArray(output.axes) && output.axes.length > 0
        ? `review_axis=${output.axes[0]}`
        : '';
    }
    if (action === 'verify') {
      return output.closure_status
        ? `closure_status=${output.closure_status}`
        : (output.next_step ? `next_step=${output.next_step}` : '');
    }
    if (action === 'scan') {
      return Array.isArray(output.key_facts) && output.key_facts.length > 0
        ? `key_fact=${output.key_facts[0]}`
        : '';
    }
    if (action === 'forensics' || action === 'note') {
      if (output.next_step) {
        return `next_step=${output.next_step}`;
      }
      if (output.problem) {
        return `problem=${output.problem}`;
      }
      if (output.chosen_agent) {
        return `primary_agent=${output.chosen_agent}`;
      }
      return '';
    }
    return resolved && resolved.session && resolved.session.focus
      ? `focus=${resolved.session.focus}`
      : '';
  }

  function buildActionInstruction(action, output) {
    if (action === 'scan') {
      return (output.next_reads && output.next_reads[0]) || (output.open_questions && output.open_questions[0]) || '';
    }
    if (action === 'plan') {
      return (output.steps && output.steps[0]) || (output.verification && output.verification[0]) || '';
    }
    if (action === 'do') {
      return (output.execution_brief && output.execution_brief.suggested_steps && output.execution_brief.suggested_steps[0]) ||
        (output.prerequisites && output.prerequisites[0]) ||
        '';
    }
    if (action === 'debug') {
      return (output.checks && output.checks[0]) || output.next_step || '';
    }
    if (action === 'review') {
      return (output.required_checks && output.required_checks[0]) || (output.findings_template && output.findings_template[0]) || '';
    }
    if (action === 'verify') {
      return (output.checklist && output.checklist[0]) || output.next_step || '';
    }
    if (action === 'forensics') {
      return (output.evidence_sources && output.evidence_sources[0]) || output.next_step || '';
    }
    if (action === 'note') {
      return (output.recordable_items && output.recordable_items[0]) || '';
    }
    return '';
  }

  function extractThenCli(text) {
    return String(text || '').trim().replace(/^Then:\s*/i, '').trim();
  }

  function buildActionCard(action, output, resolved, activeTask) {
    const followup = buildActionFollowup(action, resolved, activeTask);
    const instruction = buildActionInstruction(action, output);

    return {
      status: 'ready-to-run',
      stage: action,
      action: followup.label || `Continue with ${action}`,
      summary: buildActionSummary(action),
      reason: buildActionReason(action, output, resolved),
      first_step_label: followup.label || '',
      first_instruction: instruction,
      first_cli: followup.cli || '',
      then_cli: extractThenCli(followup.followup),
      followup: followup.followup || ''
    };
  }

  function buildClosureCheckpointHint(action) {
    if (action === 'review') {
      return `checkpoint=If these review findings should carry into the next session, capture a session checkpoint with: ${buildCli(['session', 'record'])}`;
    }

    if (action === 'verify') {
      return `checkpoint=If you may stop after this verification pass, capture a session checkpoint with: ${buildCli(['session', 'record'])}`;
    }

    return '';
  }

  function buildActionNextActions(action, actionCard, output) {
    return runtime.unique([
      actionCard && actionCard.first_instruction ? `instruction=${actionCard.first_instruction}` : '',
      actionCard && actionCard.first_cli ? `command=${actionCard.first_cli}` : '',
      actionCard && actionCard.followup ? `followup=${actionCard.followup}` : '',
      buildClosureCheckpointHint(action),
      output && output.next_step ? `decision_point=${output.next_step}` : ''
    ]);
  }

  function normalizeStringArray(value, fallback) {
    const items = Array.isArray(value)
      ? value.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    return items.length > 0 ? items : fallback.slice();
  }

  function buildWorkerContract(call, defaults = {}) {
    return {
      goal: String(defaults.goal || call.purpose || 'Execute the assigned worker task').trim(),
      inputs: normalizeStringArray(defaults.inputs, [
        'Context Bundle entries explicitly listed in this prompt',
        'Agent instructions loaded from agents show <agent>'
      ]),
      outputs: normalizeStringArray(defaults.outputs, [
        'stdout: compact worker_result JSON only',
        'Optional files_considered array with repo-relative paths'
      ]),
      forbidden_zones: normalizeStringArray(defaults.forbidden_zones, [
        'Any file or side effect outside the declared Outputs',
        'Recursive delegation, hidden sub-teams, or orchestration-state mutations',
        'Any repository file write or mutation'
      ]),
      acceptance_criteria: normalizeStringArray(defaults.acceptance_criteria, [
        'Return a compact JSON object matching the Output Contract in this prompt',
        'Keep status within ok | failed | blocked and keep findings as an array',
        'Do not modify repository files; Outputs must remain stdout-only'
      ])
    };
  }

  function buildReviewContract() {
    return {
      required: true,
      policy: 'If Stage A fails, set redispatch_required=true and tighten the worker contract instead of patching inline in the main thread.',
      stage_a: {
        id: 'contract-review',
        owner: 'Current main thread',
        objective: 'Verify architecture worker outputs match the worker contract and stay inside declared read-only boundaries.',
        completion_signal: 'contract compliance, evidence boundaries, and drive-by changes are explicit',
        failure_action: 'redispatch',
        review_checks: [
          'Check that outputs stay read-only and match the declared worker contract',
          'Check that side evidence does not replace the primary review conclusion',
          'Check that acceptance criteria were actually addressed'
        ]
      },
      stage_b: {
        id: 'quality-review',
        owner: 'Current main thread',
        objective: 'Review architecture quality, tradeoff coherence, residual risks, and follow-up gaps only after Stage A passes.',
        completion_signal: 'quality findings and merge/reject decision are explicit',
        failure_action: 'reject-or-follow-up',
        review_checks: [
          'Review option quality, factual separation, and residual risk',
          'Separate contract failures from quality concerns',
          'Do not let the worker review its own output'
        ]
      }
    };
  }

  function buildInjectedSpecs(resolved, task, handoff, limit = 5) {
    const snapshot = workflowRegistry.buildInjectedSpecSnapshot(
      ROOT,
      runtime.getProjectExtDir(resolved.session.project_root),
      {
        profile: resolved.profile.name,
        specs: resolved.session.active_specs || [],
        task: task || null,
        handoff: handoff || null
      },
      { limit }
    );

    return (snapshot.items || []).map(item => ({
      name: item.name,
      title: item.title || item.name,
      summary: item.summary || '',
      display_path: item.display_path,
      scope: item.scope,
      priority: item.priority,
      reasons: item.reasons || []
    }));
  }

  function buildActionOutput(action) {
    const resolved = resolveSession();
    const handoff = loadHandoff();
    const activeTask = typeof getActiveTask === 'function' ? getActiveTask() : null;
    const injectedSpecs = buildInjectedSpecs(resolved, activeTask, handoff);
    const workflowStage = typeof buildWorkflowStage === 'function'
      ? buildWorkflowStage({ command: action }, resolved)
      : null;
    let output;

    if (action === 'scan') {
      output = scheduler.buildScanOutput(resolved);
    } else if (action === 'plan') {
      output = scheduler.buildPlanOutput(resolved);
    } else if (action === 'do') {
      output = scheduler.buildDoOutput(resolved);
    } else if (action === 'debug') {
      output = scheduler.buildDebugOutput(resolved);
    } else if (action === 'review') {
      output = scheduler.buildReviewOutput(resolved);
    } else if (action === 'verify') {
      output = scheduler.buildVerifyOutput(resolved);
    } else if (action === 'forensics') {
      output = scheduler.buildForensicsOutput(resolved);
    } else if (action === 'note') {
      output = scheduler.buildNoteOutput(resolved);
    } else if (action === 'health') {
      const health = buildHealthReport();
      output = {
        checks: health.checks || [],
        recommendations: health.recommendations || [],
        next_commands: health.next_commands || [],
        quickstart: health.quickstart || null,
        summary: health.summary || {},
        status: health.status || 'warn',
        scheduler: {
          primary_agent: '',
          supporting_agents: [],
          parallel_safe: false,
          agent_execution: {
            available: false,
            spawn_available: false,
            recommended: false,
            inline_ok: true,
            mode: 'inline-preferred',
            reason: 'Health is a read-only self-check action and should run inline on the current main thread by default.',
            primary_agent: '',
            supporting_agents: [],
            dispatch_contract: null
          }
        }
      };
    } else {
      throw new Error(`Unsupported action: ${action}`);
    }

    const enriched = enrichWithToolSuggestions({
      ...output,
      injected_specs: injectedSpecs,
      agent_execution: output.scheduler && output.scheduler.agent_execution
        ? output.scheduler.agent_execution
        : scheduler.buildAgentExecution(action, resolved),
      context_hygiene: buildContextHygiene(resolved, handoff, action)
    }, resolved);

    const actionCard = buildActionCard(action, enriched, resolved, activeTask);

    return {
      ...enriched,
      workflow_stage: workflowStage,
      action_card: actionCard,
      next_actions: buildActionNextActions(action, actionCard, enriched),
      permission_gates: permissionGateHelpers.buildPermissionGates(enriched)
    };
  }

  function buildArchReviewDispatchContext() {
    const context = buildArchReviewContext();

    return {
      requested_action: 'arch-review',
      resolved_action: 'arch-review',
      reason: context.warning,
      cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['arch-review']),
      dispatch_ready: true,
      agent_execution: {
        available: true,
        spawn_available: true,
        recommended: true,
        inline_ok: false,
        mode: 'primary-recommended',
        reason: 'An explicit architecture preflight should be led directly by emb-arch-reviewer.',
        primary_agent: context.suggested_agent,
        supporting_agents: runtime.unique(context.review_agents || []),
        dispatch_contract: {
          launch_via: 'installed-emb-agent',
          delegation_pattern: 'coordinator',
          pattern_constraints: {
            allowed_patterns: ['coordinator'],
            disallowed_patterns: ['fork', 'swarm'],
            max_depth: 1,
            workers_may_delegate: false,
            verification_requires_fresh_context: true
          },
          auto_invoke_when_recommended: true,
          primary_first: true,
          parallel_safe: runtime.unique(context.review_agents || []),
          phases: [
            {
              id: 'research',
              owner: context.suggested_agent,
              objective: 'Gather architecture options, constraints, and pre-mortem evidence',
              completion_signal: 'tradeoffs and risks are explicit'
            },
            {
              id: 'synthesis',
              owner: 'Current main thread',
              objective: 'Compose a self-contained architecture decision brief before any downstream conclusion',
              completion_signal: 'the next consumer can decide without seeing prior conversation'
            },
            {
              id: 'execution',
              owner: context.suggested_agent,
              objective: 'Produce the primary architecture review conclusion against the synthesized brief',
              completion_signal: 'evaluation matrix and pre-mortem are explicit'
            },
            {
              id: 'integration',
              owner: 'Current main thread',
              objective: 'Integrate the review conclusion and decide the next project action',
              completion_signal: 'final architecture review output is explicit'
            }
          ],
          synthesis_required: true,
          synthesis_contract: {
            owner: 'Current main thread',
            happens_after: ['research'],
            happens_before: ['execution', 'integration'],
            rule: 'Synthesize, do not delegate understanding',
            output_requirements: [
              'Write a self-contained architecture brief with options, constraints, and success criteria',
              'Do not forward raw evidence directly to downstream workers as if it were already synthesized'
            ]
          },
          review_contract: buildReviewContract(),
          do_not_parallelize: [
            'Do not split architecture preflight into multiple competing writable agents',
            'Do not skip fact checks and jump directly to a selection conclusion',
            'Do not let workers spawn other workers or recurse into deeper orchestration layers'
          ],
          integration_owner: 'Current main thread',
          integration_steps: [
            'Read research outputs fully before composing the next worker specification',
            'Start emb-arch-reviewer first to produce the primary review conclusion',
            'Let review agents add hardware, structural, or release-side evidence only when needed',
            'Let the main thread integrate the final architecture review conclusion'
          ],
          primary: {
            agent: context.suggested_agent,
            role: 'primary',
            blocking: true,
            delegation_phase: 'research',
            context_mode: 'fresh-self-contained',
            tool_scope: {
              role_profile: 'review',
              allows_write: false,
              allows_delegate: false,
              allows_background_work: false,
              preferred_tools: ['read', 'search', 'inspect', 'diff'],
              disallowed_tools: ['spawn', 'orchestration-state-write']
            },
            purpose: 'Execute system-level architecture preflight, option comparison, and pre-mortem',
            ownership: 'Own the primary review conclusion and do not replace concrete implementation changes',
            when: 'Start immediately when arch-review is explicitly entered',
            spawn_fallback: {
              supported: true,
              preferred_launch: context.suggested_agent,
              fallback_tool: 'spawn_agent',
              fallback_agent_type: 'default',
              role: 'primary',
              instructions_source_cli: runtimeHostHelpers.buildCliCommand(
                RUNTIME_HOST,
                ['agents', 'show', context.suggested_agent]
              ),
              prompt_contract: [
                `Read the agent instructions for ${context.suggested_agent} first`,
                'Then execute with the context and output requirements provided by dispatch_contract',
                'Let the main thread integrate the output into the architecture review'
              ]
            },
            expected_output: [
              'Provide three options, an evaluation matrix, and a pre-mortem',
              'Separate confirmed facts, engineering inference, and experience-based warnings'
            ],
            worker_contract: buildWorkerContract({
              purpose: 'Execute system-level architecture preflight, option comparison, and pre-mortem',
              role: 'primary'
            }, {
              goal: 'Produce the primary architecture review conclusion from a fresh context without changing the contract scope.',
              inputs: [
                'Context Bundle entries explicitly listed in this prompt',
                'Agent instructions loaded from agents show emb-arch-reviewer',
                '.emb-agent/hw.yaml, .emb-agent/req.yaml, and any files explicitly named in the context bundle'
              ],
              outputs: [
                'stdout: compact worker_result JSON only',
                'Optional files_considered array with repo-relative paths'
              ],
              forbidden_zones: [
                'Any repository file write or mutation',
                'Recursive delegation, hidden sub-teams, or orchestration-state mutations',
                'Changing the worker contract or replacing the main-thread decision'
              ],
              acceptance_criteria: [
                'Return a compact JSON object matching the Output Contract in this prompt',
                'Keep status within ok | failed | blocked and keep findings as an array',
                'Do not modify repository files; Outputs must remain stdout-only'
              ]
            }),
            context_bundle: {
              trigger_patterns: context.trigger_patterns || [],
              checkpoints: context.checkpoints || [],
              review_axes: context.review_axes || [],
              note_targets: context.note_targets || []
            },
            start_when: 'Start immediately'
          },
          supporting: runtime.unique(context.review_agents || []).map(agent => ({
            agent,
            role: 'supporting',
            blocking: false,
            delegation_phase: 'support',
            context_mode: 'fresh-self-contained',
            tool_scope: {
              role_profile: 'review',
              allows_write: false,
              allows_delegate: false,
              allows_background_work: false,
              preferred_tools: ['read', 'search', 'inspect', 'diff'],
              disallowed_tools: ['spawn', 'orchestration-state-write']
            },
            purpose: 'Add structural, hardware, or release-side evidence for the architecture preflight',
            ownership: 'Add side evidence only and do not override the primary review conclusion',
            when: 'Start only when the main thread determines that side evidence is needed',
            spawn_fallback: {
              supported: true,
              preferred_launch: agent,
              fallback_tool: 'spawn_agent',
              fallback_agent_type: 'explorer',
              role: 'supporting',
              instructions_source_cli: runtimeHostHelpers.buildCliCommand(
                RUNTIME_HOST,
                ['agents', 'show', agent]
              ),
              prompt_contract: [
                `Read the agent instructions for ${agent} first`,
                'Then execute with the context and output requirements provided by dispatch_contract',
                'Let the main thread integrate the output as side evidence for the architecture review'
              ]
            },
            expected_output: ['Supplemental evidence, constraints, or risks awaiting verification'],
            worker_contract: buildWorkerContract({
              purpose: 'Add structural, hardware, or release-side evidence for the architecture preflight',
              role: 'supporting'
            }, {
              goal: 'Add side evidence for architecture review without replacing the primary review conclusion.',
              inputs: [
                'Context Bundle entries explicitly listed in this prompt',
                `Agent instructions loaded from agents show ${agent}`,
                '.emb-agent/hw.yaml, .emb-agent/req.yaml, and any files explicitly named in the context bundle'
              ],
              outputs: [
                'stdout: compact worker_result JSON only',
                'Optional files_considered array with repo-relative paths'
              ],
              forbidden_zones: [
                'Any repository file write or mutation',
                'Recursive delegation, hidden sub-teams, or orchestration-state mutations',
                'Overriding the primary architecture review conclusion'
              ],
              acceptance_criteria: [
                'Return a compact JSON object matching the Output Contract in this prompt',
                'Keep status within ok | failed | blocked and keep findings as an array',
                'Do not modify repository files; Outputs must remain stdout-only'
              ]
            }),
            context_bundle: {
              review_axes: context.review_axes || [],
              note_targets: context.note_targets || []
            },
            start_when: 'Start on demand'
          }))
        }
      },
      context_hygiene: context.context_hygiene || null,
      action_context: context,
      permission_gates: []
    };
  }

  return {
    buildActionOutput,
    buildArchReviewDispatchContext
  };
}

module.exports = {
  createActionContractHelpers
};
