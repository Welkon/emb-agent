'use strict';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(toArray(values).map(item => String(item || '').trim()).filter(Boolean))];
}

function getRequiredExecutors(projectConfig) {
  if (!projectConfig || typeof projectConfig !== 'object') {
    return [];
  }

  const qualityGates = projectConfig.quality_gates;
  if (!qualityGates || typeof qualityGates !== 'object' || Array.isArray(qualityGates)) {
    return [];
  }

  return unique(qualityGates.required_executors || []);
}

function getRequiredSignoffs(projectConfig) {
  if (!projectConfig || typeof projectConfig !== 'object') {
    return [];
  }

  const qualityGates = projectConfig.quality_gates;
  if (!qualityGates || typeof qualityGates !== 'object' || Array.isArray(qualityGates)) {
    return [];
  }

  return unique(qualityGates.required_signoffs || []);
}

function normalizeObservedStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'ok' || status === 'passed' || status === 'pass' || status === 'success') {
    return 'passed';
  }
  if (status === 'failed' || status === 'error' || status === 'fail') {
    return 'failed';
  }
  if (!status) {
    return 'pending';
  }
  return 'pending';
}

function getExecutorRecord(name, diagnostics) {
  const safeDiagnostics =
    diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics)
      ? diagnostics
      : {};
  const history =
    safeDiagnostics.executor_history &&
    typeof safeDiagnostics.executor_history === 'object' &&
    !Array.isArray(safeDiagnostics.executor_history)
      ? safeDiagnostics.executor_history
      : {};
  const latest =
    safeDiagnostics.latest_executor &&
    typeof safeDiagnostics.latest_executor === 'object' &&
    !Array.isArray(safeDiagnostics.latest_executor)
      ? safeDiagnostics.latest_executor
      : null;
  const fromHistory = history[name];

  if (fromHistory && typeof fromHistory === 'object' && !Array.isArray(fromHistory)) {
    return fromHistory;
  }

  if (latest && latest.name === name) {
    return latest;
  }

  return null;
}

function normalizeHumanSignoffStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'confirmed' || status === 'pass' || status === 'passed' || status === 'ok') {
    return 'confirmed';
  }
  if (status === 'rejected' || status === 'failed' || status === 'fail' || status === 'blocked') {
    return 'rejected';
  }
  return 'pending';
}

function getHumanSignoffRecord(name, diagnostics) {
  const safeDiagnostics =
    diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics)
      ? diagnostics
      : {};
  const signoffs =
    safeDiagnostics.human_signoffs &&
    typeof safeDiagnostics.human_signoffs === 'object' &&
    !Array.isArray(safeDiagnostics.human_signoffs)
      ? safeDiagnostics.human_signoffs
      : {};

  return signoffs[name] && typeof signoffs[name] === 'object' && !Array.isArray(signoffs[name])
    ? signoffs[name]
    : null;
}

function evaluateQualityGates(projectConfig, diagnostics) {
  const requiredExecutors = getRequiredExecutors(projectConfig);
  const requiredSignoffs = getRequiredSignoffs(projectConfig);
  const gateDetails = requiredExecutors.map(name => {
    const record = getExecutorRecord(name, diagnostics);
    const state = normalizeObservedStatus(record && record.status);

    return {
      name,
      state,
      observed_status: record && record.status ? String(record.status) : '',
      exit_code: record && Number.isInteger(record.exit_code) ? record.exit_code : null,
      ran_at: record && record.ran_at ? String(record.ran_at) : ''
    };
  });
  const signoffDetails = requiredSignoffs.map(name => {
    const record = getHumanSignoffRecord(name, diagnostics);
    const state = normalizeHumanSignoffStatus(record && record.status);

    return {
      name,
      state,
      observed_status: record && record.status ? String(record.status) : '',
      confirmed_at: record && record.confirmed_at ? String(record.confirmed_at) : '',
      note: record && record.note ? String(record.note) : ''
    };
  });

  const passedGates = gateDetails.filter(item => item.state === 'passed').map(item => item.name);
  const failedGates = gateDetails.filter(item => item.state === 'failed').map(item => item.name);
  const pendingGates = gateDetails.filter(item => item.state === 'pending').map(item => item.name);
  const confirmedSignoffs = signoffDetails.filter(item => item.state === 'confirmed').map(item => item.name);
  const rejectedSignoffs = signoffDetails.filter(item => item.state === 'rejected').map(item => item.name);
  const pendingSignoffs = signoffDetails.filter(item => item.state === 'pending').map(item => item.name);

  let gateStatus = 'not-configured';
  if (requiredExecutors.length > 0 || requiredSignoffs.length > 0) {
    if (failedGates.length > 0 || rejectedSignoffs.length > 0) {
      gateStatus = 'failed';
    } else if (pendingGates.length > 0 || pendingSignoffs.length > 0) {
      gateStatus = 'pending';
    } else {
      gateStatus = 'pass';
    }
  }

  const summaryParts = [];
  if (failedGates.length > 0) {
    summaryParts.push(`Executor gates failed: ${failedGates.join(', ')}`);
  } else if (pendingGates.length > 0) {
    summaryParts.push(`Executor gates pending: ${pendingGates.join(', ')}`);
  }

  if (rejectedSignoffs.length > 0) {
    summaryParts.push(`Engineer signoff rejected: ${rejectedSignoffs.join(', ')}`);
  } else if (pendingSignoffs.length > 0) {
    summaryParts.push(`Waiting for engineer confirmation: ${pendingSignoffs.join(', ')}`);
  }

  let statusSummary = '';
  if (gateStatus === 'pass') {
    statusSummary = 'Quality gates closed';
  } else if (gateStatus !== 'not-configured') {
    statusSummary = summaryParts.join(' | ');
  }

  const blockingSummary = summaryParts[0] || '';

  return {
    enabled: requiredExecutors.length > 0 || requiredSignoffs.length > 0,
    gate_status: gateStatus,
    status_summary: statusSummary,
    blocking_summary: blockingSummary,
    required_executors: requiredExecutors,
    required_signoffs: requiredSignoffs,
    passed_gates: passedGates,
    failed_gates: failedGates,
    pending_gates: pendingGates,
    confirmed_signoffs: confirmedSignoffs,
    rejected_signoffs: rejectedSignoffs,
    pending_signoffs: pendingSignoffs,
    recommended_runs: unique([...failedGates, ...pendingGates]).map(name => `executor run ${name}`),
    recommended_signoffs: pendingSignoffs.map(name => `verify confirm ${name}`),
    gate_details: gateDetails,
    signoff_details: signoffDetails
  };
}

module.exports = {
  evaluateQualityGates,
  getRequiredExecutors,
  getRequiredSignoffs
};
