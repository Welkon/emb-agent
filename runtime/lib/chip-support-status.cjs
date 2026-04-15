'use strict';

function normalizeChipSupportStatus(value) {
  const status = String(value || '').trim();

  switch (status) {
    case 'adapter-required':
      return 'chip-support-required';
    case 'draft-adapter':
      return 'draft-chip-support';
    default:
      return status;
  }
}

function normalizeChipSupportImplementation(value) {
  const implementation = String(value || '').trim();

  switch (implementation) {
    case 'external-adapter':
      return 'external-chip-support';
    case 'external-adapter-draft':
      return 'external-chip-support-draft';
    default:
      return implementation;
  }
}

function normalizeChipSupportAction(value) {
  const action = String(value || '').trim();

  switch (action) {
    case 'sync-adapter':
      return 'install-chip-support';
    case 'implement-adapter':
      return 'complete-chip-support';
    default:
      return action;
  }
}

function normalizeToolExecutionResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }

  const normalized = {
    ...result
  };

  if (Object.prototype.hasOwnProperty.call(normalized, 'status')) {
    normalized.status = normalizeChipSupportStatus(normalized.status);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'implementation')) {
    normalized.implementation = normalizeChipSupportImplementation(normalized.implementation);
  }
  if (Object.prototype.hasOwnProperty.call(normalized, 'recommended_action')) {
    normalized.recommended_action = normalizeChipSupportAction(normalized.recommended_action);
  }
  if (normalized.trust && typeof normalized.trust === 'object' && !Array.isArray(normalized.trust)) {
    normalized.trust = {
      ...normalized.trust,
      primary: normalized.trust.primary && typeof normalized.trust.primary === 'object'
        ? {
            ...normalized.trust.primary,
            recommended_action: normalizeChipSupportAction(normalized.trust.primary.recommended_action)
          }
        : normalized.trust.primary
    };
  }

  return normalized;
}

module.exports = {
  normalizeChipSupportAction,
  normalizeChipSupportImplementation,
  normalizeChipSupportStatus,
  normalizeToolExecutionResult
};
