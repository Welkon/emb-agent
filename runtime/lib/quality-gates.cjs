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

function getRequiredSkills(projectConfig) {
  if (!projectConfig || typeof projectConfig !== 'object') {
    return [];
  }

  const qualityGates = projectConfig.quality_gates;
  if (!qualityGates || typeof qualityGates !== 'object' || Array.isArray(qualityGates)) {
    return [];
  }

  return unique(qualityGates.required_skills || []);
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

function getRequiredHardwareChecks(projectConfig) {
  if (!projectConfig || typeof projectConfig !== 'object') {
    return [];
  }

  const qualityGates = projectConfig.quality_gates;
  if (!qualityGates || typeof qualityGates !== 'object' || Array.isArray(qualityGates)) {
    return [];
  }

  const checks = qualityGates.required_hardware_checks;
  if (!Array.isArray(checks)) {
    return [];
  }

  return checks.filter(c => c && typeof c === 'object' && c.check && c.against);
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

function getSkillRecord(name, diagnostics) {
  const safeDiagnostics =
    diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics)
      ? diagnostics
      : {};
  const history =
    safeDiagnostics.skill_history &&
    typeof safeDiagnostics.skill_history === 'object' &&
    !Array.isArray(safeDiagnostics.skill_history)
      ? safeDiagnostics.skill_history
      : {};
  const latest =
    safeDiagnostics.latest_skill &&
    typeof safeDiagnostics.latest_skill === 'object' &&
    !Array.isArray(safeDiagnostics.latest_skill)
      ? safeDiagnostics.latest_skill
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
  const requiredSkills = getRequiredSkills(projectConfig);
  const requiredExecutors = getRequiredExecutors(projectConfig);
  const requiredSignoffs = getRequiredSignoffs(projectConfig);
  const requiredHardwareChecks = getRequiredHardwareChecks(projectConfig);
  const skillDetails = requiredSkills.map(name => {
    const record = getSkillRecord(name, diagnostics);
    const state = normalizeObservedStatus(record && record.status);

    return {
      name,
      state,
      observed_status: record && record.status ? String(record.status) : '',
      exit_code: record && Number.isInteger(record.exit_code) ? record.exit_code : null,
      ran_at: record && record.ran_at ? String(record.ran_at) : ''
    };
  });
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

  const hwCheckRecords = (diagnostics && diagnostics.hardware_checks &&
    typeof diagnostics.hardware_checks === 'object' && !Array.isArray(diagnostics.hardware_checks))
    ? diagnostics.hardware_checks
    : {};

  const hwCheckDetails = requiredHardwareChecks.map(hc => {
    const record = hwCheckRecords[hc.check];
    const state = normalizeObservedStatus(record && record.status);

    return {
      check: hc.check,
      against: hc.against,
      state,
      observed_status: record && record.status ? String(record.status) : '',
      note: record && record.note ? String(record.note) : '',
      ran_at: record && record.ran_at ? String(record.ran_at) : ''
    };
  });

  const passedSkills = skillDetails.filter(item => item.state === 'passed').map(item => item.name);
  const failedSkills = skillDetails.filter(item => item.state === 'failed').map(item => item.name);
  const pendingSkills = skillDetails.filter(item => item.state === 'pending').map(item => item.name);
  const passedGates = gateDetails.filter(item => item.state === 'passed').map(item => item.name);
  const failedGates = gateDetails.filter(item => item.state === 'failed').map(item => item.name);
  const pendingGates = gateDetails.filter(item => item.state === 'pending').map(item => item.name);
  const confirmedSignoffs = signoffDetails.filter(item => item.state === 'confirmed').map(item => item.name);
  const rejectedSignoffs = signoffDetails.filter(item => item.state === 'rejected').map(item => item.name);
  const pendingSignoffs = signoffDetails.filter(item => item.state === 'pending').map(item => item.name);

  const passedHwChecks = hwCheckDetails.filter(item => item.state === 'passed').map(item => item.check);
  const failedHwChecks = hwCheckDetails.filter(item => item.state === 'failed').map(item => item.check);
  const pendingHwChecks = hwCheckDetails.filter(item => item.state === 'pending').map(item => item.check);

  let gateStatus = 'not-configured';
  if (requiredSkills.length > 0 || requiredExecutors.length > 0 || requiredSignoffs.length > 0 || requiredHardwareChecks.length > 0) {
    if (failedSkills.length > 0 || failedGates.length > 0 || rejectedSignoffs.length > 0 || failedHwChecks.length > 0) {
      gateStatus = 'failed';
    } else if (pendingSkills.length > 0 || pendingGates.length > 0 || pendingSignoffs.length > 0 || pendingHwChecks.length > 0) {
      gateStatus = 'pending';
    } else {
      gateStatus = 'pass';
    }
  }

  const summaryParts = [];
  if (failedSkills.length > 0) {
    summaryParts.push(`Skill gates failed: ${failedSkills.join(', ')}`);
  } else if (pendingSkills.length > 0) {
    summaryParts.push(`Skill gates pending: ${pendingSkills.join(', ')}`);
  }
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

  if (failedHwChecks.length > 0) {
    summaryParts.push(`Hardware checks failed: ${failedHwChecks.join(', ')}`);
  } else if (pendingHwChecks.length > 0) {
    summaryParts.push(`Hardware checks pending: ${pendingHwChecks.join(', ')}`);
  }

  let statusSummary = '';
  if (gateStatus === 'pass') {
    statusSummary = 'Quality gates closed';
  } else if (gateStatus !== 'not-configured') {
    statusSummary = summaryParts.join(' | ');
  }

  const blockingSummary = summaryParts[0] || '';

  return {
    enabled: requiredSkills.length > 0 || requiredExecutors.length > 0 || requiredSignoffs.length > 0 || requiredHardwareChecks.length > 0,
    gate_status: gateStatus,
    status_summary: statusSummary,
    blocking_summary: blockingSummary,
    required_skills: requiredSkills,
    required_executors: requiredExecutors,
    required_signoffs: requiredSignoffs,
    required_hardware_checks: requiredHardwareChecks.map(hc => hc.check),
    passed_skills: passedSkills,
    failed_skills: failedSkills,
    pending_skills: pendingSkills,
    passed_gates: passedGates,
    failed_gates: failedGates,
    pending_gates: pendingGates,
    confirmed_signoffs: confirmedSignoffs,
    rejected_signoffs: rejectedSignoffs,
    pending_signoffs: pendingSignoffs,
    passed_hw_checks: passedHwChecks,
    failed_hw_checks: failedHwChecks,
    pending_hw_checks: pendingHwChecks,
    recommended_runs: unique([
      ...failedSkills.map(name => `skills run ${name}`),
      ...pendingSkills.map(name => `skills run ${name}`),
      ...failedGates.map(name => `executor run ${name}`),
      ...pendingGates.map(name => `executor run ${name}`),
      ...failedHwChecks.map(name => `verify hw-check ${name}`),
      ...pendingHwChecks.map(name => `verify hw-check ${name}`)
    ]),
    recommended_signoffs: pendingSignoffs.map(name => `verify confirm ${name}`),
    skill_details: skillDetails,
    gate_details: gateDetails,
    signoff_details: signoffDetails,
    hw_check_details: hwCheckDetails
  };
}

module.exports = {
  evaluateQualityGates,
  getRequiredSkills,
  getRequiredExecutors,
  getRequiredSignoffs,
  getRequiredHardwareChecks
};
