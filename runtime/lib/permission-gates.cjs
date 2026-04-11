'use strict';

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
      reason_code: decision.reason_code || ''
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

  if (decision.decision === 'allow') {
    return {
      ...base,
      permission_decision: decision,
      permission_gates: buildPermissionGates({
        ...base,
        permission_decision: decision
      })
    };
  }

  return {
    ...base,
    status: decision.decision === 'deny' ? 'permission-denied' : 'permission-pending',
    permission_decision: decision,
    permission_gates: buildPermissionGates({
      ...base,
      permission_decision: decision
    })
  };
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
