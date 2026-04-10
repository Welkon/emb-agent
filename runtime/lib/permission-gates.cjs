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

function buildPermissionGates(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  return [
    buildQualityPermissionGate(source.quality_gates || source.qualityGates || null),
    buildHighRiskPermissionGate(source.high_risk_clarity || source.highRiskClarity || null)
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
  buildPermissionGates,
  buildQualityPermissionGate,
  buildHighRiskPermissionGate,
  summarizePermissionGates
};
