'use strict';

const runtimeHostHelpers = require('./runtime-host.cjs');
const permissionGateHelpers = require('./permission-gates.cjs');

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
    buildArchReviewContext
  } = deps;

  function buildActionOutput(action) {
    const resolved = resolveSession();
    const handoff = loadHandoff();
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
      agent_execution: output.scheduler && output.scheduler.agent_execution
        ? output.scheduler.agent_execution
        : scheduler.buildAgentExecution(action, resolved),
      context_hygiene: buildContextHygiene(resolved, handoff, action)
    }, resolved);

    return {
      ...enriched,
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
