'use strict';

const runtimeEventHelpers = require('./runtime-events.cjs');

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(toArray(values).map(item => String(item || '').trim()).filter(Boolean))];
}

function buildQualityPermissionGate(qualityGates) {
  const gates =
    qualityGates && typeof qualityGates === 'object' && !Array.isArray(qualityGates)
      ? qualityGates
      : null;
  if (!gates || !gates.enabled) {
    return null;
  }

  const state = gates.gate_status === 'pass'
    ? 'pass'
    : gates.gate_status === 'failed'
      ? 'blocked'
      : 'pending';
  const blockingItems = unique([
    ...(gates.failed_gates || []),
    ...(gates.pending_gates || []),
    ...(gates.rejected_signoffs || []),
    ...(gates.pending_signoffs || [])
  ]);

  return {
    id: 'quality-gates',
    kind: 'quality-gate',
    state,
    title: 'Quality gate closure required',
    summary: gates.blocking_summary || gates.status_summary || '',
    requires_explicit_confirmation: toArray(gates.pending_signoffs).length > 0,
    commands: unique([
      ...(gates.recommended_runs || []),
      ...(gates.recommended_signoffs || [])
    ]),
    blocking_items: blockingItems,
    details: {
      required_executors: toArray(gates.required_executors),
      required_signoffs: toArray(gates.required_signoffs),
      passed_gates: toArray(gates.passed_gates),
      failed_gates: toArray(gates.failed_gates),
      pending_gates: toArray(gates.pending_gates),
      confirmed_signoffs: toArray(gates.confirmed_signoffs),
      rejected_signoffs: toArray(gates.rejected_signoffs),
      pending_signoffs: toArray(gates.pending_signoffs)
    }
  };
}

function buildHighRiskPermissionGate(highRiskClarity) {
  const clarity =
    highRiskClarity && typeof highRiskClarity === 'object' && !Array.isArray(highRiskClarity)
      ? highRiskClarity
      : null;
  if (!clarity || clarity.enabled !== true) {
    return null;
  }

  return {
    id: 'high-risk-confirmation',
    kind: 'explicit-confirmation',
    state: 'pending',
    title: 'Explicit confirmation required',
    summary: clarity.warning || '',
    category: clarity.category || '',
    requires_explicit_confirmation: clarity.requires_explicit_confirmation === true,
    commands: [],
    blocking_items: unique(clarity.matched_signals || []),
    confirmation_template: clarity.confirmation_template || null
  };
}

function buildDecisionPermissionGate(permissionDecision) {
  const decision =
    permissionDecision && typeof permissionDecision === 'object' && !Array.isArray(permissionDecision)
      ? permissionDecision
      : null;
  if (!decision || !decision.decision || decision.decision === 'allow' || decision.reason_code === 'high-risk-confirmation') {
    return null;
  }

  return {
    id: 'permission-decision',
    kind: 'permission-rule',
    state: decision.decision === 'deny' ? 'blocked' : 'pending',
    title: decision.decision === 'deny' ? 'Execution denied by permission policy' : 'Permission confirmation required',
    summary: decision.summary || '',
    requires_explicit_confirmation: decision.decision === 'ask',
    commands: unique(decision.confirm_commands || []),
    blocking_items: unique(decision.reasons || []),
    details: {
      action_kind: decision.action_kind || '',
      action_name: decision.action_name || '',
      matched_rule: decision.matched_rule || '',
      reason_code: decision.reason_code || '',
      category: decision.category || '',
      severity: decision.severity || '',
      operator_guidance: decision.operator_guidance || '',
      remediation: unique(decision.remediation || []),
      prechecks: unique(decision.prechecks || [])
    }
  };
}

function normalizePermissionBucket(value) {
  const bucket = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return {
    allow: unique(bucket.allow || []),
    ask: unique(bucket.ask || []),
    deny: unique(bucket.deny || [])
  };
}

function normalizePermissionConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return {
    default_policy: ['allow', 'ask', 'deny'].includes(source.default_policy) ? source.default_policy : 'allow',
    require_confirmation_for_high_risk: source.require_confirmation_for_high_risk !== false,
    tools: normalizePermissionBucket(source.tools),
    executors: normalizePermissionBucket(source.executors),
    writes: normalizePermissionBucket(source.writes)
  };
}

function describeAction(actionKind, actionName) {
  if (actionKind === 'write') {
    return `write operation ${actionName}`;
  }
  return `${actionKind} ${actionName}`;
}

function actionKindToCategory(actionKind) {
  if (actionKind === 'write') {
    return 'write';
  }
  if (actionKind === 'executor') {
    return 'executor';
  }
  return 'tool';
}

function resolveActionProfile(actionKind, actionName, risk) {
  const normalizedKind = String(actionKind || '').trim();
  const normalizedName = String(actionName || '').trim();
  const normalizedRisk = risk === 'high' ? 'high' : 'normal';
  const defaults = {
    category: actionKindToCategory(normalizedKind),
    severity: normalizedRisk,
    operator_guidance: '',
    remediation: [],
    prechecks: []
  };

  if (normalizedKind === 'write' && normalizedName === 'project-set') {
    return {
      ...defaults,
      category: 'project-policy',
      severity: 'high',
      operator_guidance: 'Changing project policy can affect future execution behavior and safety posture.',
      remediation: [
        'Re-run with --confirm only after verifying the target field and project scope.',
        'Use project show --effective to verify the resulting merged policy.'
      ],
      prechecks: [
        'Confirm this policy change is intended for the current project only.',
        'Confirm deny / ask / allow precedence still matches the intended safety posture.'
      ]
    };
  }

  if (normalizedKind === 'write' && normalizedName.startsWith('support-bootstrap')) {
    return {
      ...defaults,
      category: 'chip-support-install',
      operator_guidance: 'Chip-support bootstrap can write adapter files and change future tool execution behavior.',
      remediation: [
        'Review the selected support source and target before confirming.',
        'Run support status after installation to verify the expected source and match.'
      ],
      prechecks: [
        'Confirm the support source is the intended family/device/chip provider.',
        'Confirm the write target is correct for this project.'
      ]
    };
  }

  if (normalizedKind === 'write' && (normalizedName === 'support-derive' || normalizedName === 'support-generate')) {
    return {
      ...defaults,
      category: 'chip-support-generation',
      operator_guidance: 'Generated chip support is draft infrastructure and should not be treated as final ground truth without review.',
      remediation: [
        'Review generated bindings, routes, and trust summaries before reuse.',
        'Keep project-local output until evidence and runtime behavior are verified.'
      ],
      prechecks: [
        'Confirm the source project/doc evidence is the intended basis for generation.',
        'Confirm the target location is correct before overwriting existing artifacts.'
      ]
    };
  }

  if (normalizedKind === 'write' && normalizedName.startsWith('doc-apply-')) {
    return {
      ...defaults,
      category: 'truth-promotion',
      operator_guidance: 'Applying document-derived truth updates shared project facts and should remain evidence-driven.',
      remediation: [
        'Review the staged values before confirming.',
        'Prefer preserving unknowns when the source evidence is incomplete.'
      ],
      prechecks: [
        'Confirm the source document is the intended authority.',
        'Confirm the target truth file and fields are correct.'
      ]
    };
  }

  if (normalizedKind === 'write' && normalizedName.startsWith('verify-')) {
    return {
      ...defaults,
      category: 'human-signoff',
      operator_guidance: 'Verification signoffs affect closure state and should reflect a real human review or bench result.',
      remediation: [
        'Record the human confirmation note explicitly when re-running with --confirm.',
        'Use verify or next to confirm the remaining required signoffs.'
      ],
      prechecks: [
        'Confirm the signoff reflects a real human validation outcome.',
        'Confirm the target signoff name matches the required gate.'
      ]
    };
  }

  if (normalizedKind === 'write' && normalizedName.startsWith('task-worktree-')) {
    return {
      ...defaults,
      category: 'task-worktree-lifecycle',
      operator_guidance: 'Task worktree operations create or remove isolated execution directories and can affect task continuity.',
      remediation: [
        'Use task worktree show <name> to inspect state before retrying.',
        'Confirm the task name and target worktree path are correct.'
      ],
      prechecks: [
        'Confirm the task is the intended target.',
        'Confirm no unsaved work remains in the worktree before cleanup.'
      ]
    };
  }

  if (normalizedKind === 'tool' && normalizedRisk === 'high') {
    return {
      ...defaults,
      category: 'high-risk-tool',
      severity: 'high',
      operator_guidance: 'This tool path is marked high risk and requires an explicit user decision.',
      remediation: [
        'Re-run with --confirm only after checking the target and rollback plan.'
      ],
      prechecks: [
        'Confirm the tool target is correct.',
        'Confirm the expected side effects are acceptable.'
      ]
    };
  }

  return defaults;
}

function permissionBucketLabel(actionKind) {
  if (actionKind === 'write') {
    return 'writes';
  }
  return `${actionKind}s`;
}

function buildPermissionDecisionSummary(decision, actionKind, actionName) {
  const label = describeAction(actionKind, actionName);
  if (decision === 'deny') {
    return `Permission policy denied ${label}.`;
  }

  return `Permission confirmation is required before running ${label}.`;
}

function evaluateExecutionPermission(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const actionKind =
    source.action_kind === 'executor'
      ? 'executor'
      : source.action_kind === 'write'
        ? 'write'
        : 'tool';
  const actionName = String(source.action_name || '').trim();
  const risk = source.risk === 'high' ? 'high' : 'normal';
  const explicitConfirmation = source.explicit_confirmation === true;
  const permissions = normalizePermissionConfig(source.permissions || {});
  const bucket =
    actionKind === 'executor'
      ? permissions.executors
      : actionKind === 'write'
        ? permissions.writes
        : permissions.tools;
  const bucketLabel = permissionBucketLabel(actionKind);
  const actionLabel = describeAction(actionKind, actionName);
  const actionProfile = resolveActionProfile(actionKind, actionName, risk);

  function buildDecision(decision, reasonCode, reasonText, matchedRule) {
    const next = {
      decision,
      action_kind: actionKind,
      action_name: actionName,
      risk,
      explicit_confirmation: explicitConfirmation,
      reason_code: reasonCode,
      matched_rule: matchedRule || '',
      reasons: unique([reasonText]),
      summary: buildPermissionDecisionSummary(decision, actionKind, actionName),
      category: actionProfile.category,
      severity: actionProfile.severity,
      operator_guidance: actionProfile.operator_guidance,
      remediation: unique(actionProfile.remediation),
      prechecks: unique(actionProfile.prechecks),
      confirm_commands: decision === 'ask'
        ? [`Re-run with --confirm to allow ${actionLabel}`]
        : []
    };

    if (explicitConfirmation && decision === 'allow') {
      next.summary = `Explicit confirmation accepted for ${actionLabel}.`;
    }

    return next;
  }

  if (bucket.deny.includes(actionName)) {
    return buildDecision('deny', 'policy-deny', `${actionLabel} is listed in permissions.${bucketLabel}.deny`, actionName);
  }

  if (bucket.ask.includes(actionName) && !explicitConfirmation) {
    return buildDecision('ask', 'policy-ask', `${actionLabel} is listed in permissions.${bucketLabel}.ask`, actionName);
  }

  if (permissions.require_confirmation_for_high_risk && risk === 'high' && !explicitConfirmation) {
    return buildDecision('ask', 'high-risk-confirmation', `${actionLabel} is marked high risk`, actionName);
  }

  if (bucket.allow.includes(actionName)) {
    return buildDecision('allow', explicitConfirmation ? 'explicit-confirmed' : 'policy-allow', `${actionLabel} is listed in permissions.${bucketLabel}.allow`, actionName);
  }

  if (permissions.default_policy === 'deny') {
    return buildDecision('deny', 'default-deny', `permissions.default_policy denies ${actionKind} execution by default`, '');
  }

  if (permissions.default_policy === 'ask' && !explicitConfirmation) {
    return buildDecision('ask', 'default-ask', `permissions.default_policy requires confirmation for ${actionKind} execution by default`, '');
  }

  return buildDecision('allow', explicitConfirmation ? 'explicit-confirmed' : 'default-allow', `Permission policy allows ${actionLabel}`, '');
}

function applyPermissionDecision(result, permissionDecision) {
  const base = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const decision =
    permissionDecision && typeof permissionDecision === 'object' && !Array.isArray(permissionDecision)
      ? permissionDecision
      : null;
  if (!decision) {
    return base;
  }

  const event = {
    type: 'permission-evaluated',
    category: decision.category || actionKindToCategory(decision.action_kind),
    status: decision.decision === 'allow' ? 'ok' : decision.decision === 'deny' ? 'blocked' : 'pending',
    severity: decision.severity || decision.risk || 'normal',
    summary: decision.summary || '',
    action: decision.action_name || '',
    source: 'permission-gates',
    details: {
      decision: decision.decision,
      action_kind: decision.action_kind || '',
      reason_code: decision.reason_code || '',
      explicit_confirmation: decision.explicit_confirmation === true,
      remediation: unique(decision.remediation || []),
      prechecks: unique(decision.prechecks || [])
    }
  };

  if (decision.decision === 'allow') {
    return runtimeEventHelpers.appendRuntimeEvent({
      ...base,
      permission_decision: decision,
      permission_gates: buildPermissionGates({
        ...base,
        permission_decision: decision
      })
    }, event);
  }

  return runtimeEventHelpers.appendRuntimeEvent({
    ...base,
    status: decision.decision === 'deny' ? 'permission-denied' : 'permission-pending',
    permission_decision: decision,
    permission_gates: buildPermissionGates({
      ...base,
      permission_decision: decision
    })
  }, event);
}

function buildPermissionGates(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  return [
    buildQualityPermissionGate(source.quality_gates || source.qualityGates || null),
    buildHighRiskPermissionGate(source.high_risk_clarity || source.highRiskClarity || null),
    buildDecisionPermissionGate(source.permission_decision || source.permissionDecision || null)
  ].filter(Boolean);
}

function summarizePermissionGates(gates) {
  const list = toArray(gates).filter(item => item && typeof item === 'object' && !Array.isArray(item));
  const blocked = list.filter(item => item.state === 'blocked');
  const pending = list.filter(item => item.state === 'pending');
  const passed = list.filter(item => item.state === 'pass');

  return {
    status: blocked.length > 0 ? 'blocked' : pending.length > 0 ? 'pending' : passed.length > 0 ? 'pass' : 'clear',
    total: list.length,
    blocked: blocked.length,
    pending: pending.length,
    passed: passed.length,
    kinds: unique(list.map(item => item.kind)),
    commands: unique(list.flatMap(item => item.commands || [])),
    summaries: unique(list.map(item => item.summary || ''))
  };
}

module.exports = {
  applyPermissionDecision,
  buildPermissionGates,
  evaluateExecutionPermission,
  normalizePermissionConfig,
  buildQualityPermissionGate,
  buildHighRiskPermissionGate,
  buildDecisionPermissionGate,
  summarizePermissionGates
};
