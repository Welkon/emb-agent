'use strict';

function hasArrayItems(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasObjectEntries(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function uniquePush(target, value) {
  const text = String(value || '').trim();
  if (text && !target.includes(text)) {
    target.push(text);
  }
}

function collectSourceRefs(...profiles) {
  const refs = [];
  profiles.forEach(profile => {
    (profile && Array.isArray(profile.source_refs) ? profile.source_refs : []).forEach(ref => {
      const text = String(ref || '').trim();
      if (text && !refs.includes(text)) {
        refs.push(text);
      }
    });
  });
  return refs;
}

function collectComponentRefs(...profiles) {
  const refs = [];
  profiles.forEach(profile => {
    (profile && Array.isArray(profile.component_refs) ? profile.component_refs : []).forEach(ref => {
      const text = String(ref || '').trim();
      if (text && !refs.includes(text)) {
        refs.push(text);
      }
    });
  });
  return refs;
}

function hasRegisterSummaryRef(...profiles) {
  return collectSourceRefs(...profiles).some(ref => ref.toLowerCase().includes('register'));
}

function gradeFromScore(score) {
  if (score >= 85) {
    return 'trusted';
  }
  if (score >= 70) {
    return 'usable';
  }
  if (score >= 50) {
    return 'partial';
  }
  if (score >= 30) {
    return 'draft';
  }
  return 'missing';
}

function buildGradeSummary(grade) {
  if (grade === 'trusted') {
    return 'The evidence chain is complete and this adapter can be used as trusted.';
  }
  if (grade === 'usable') {
    return 'The primary path is usable, but more references or packaging details are still recommended.';
  }
  if (grade === 'partial') {
    return 'There is some binding and implementation, but the evidence chain is still incomplete.';
  }
  if (grade === 'draft') {
    return 'This is still better treated as a draft and should not be taken as final ground truth.';
  }
  return 'There is almost not enough evidence to support this adapter yet.';
}

function buildRecommendedAction(input) {
  const {
    chipProfile,
    bindingInfo,
    toolStatus,
    hasRegisterSummary,
    hasAnySourceRef,
    hasAnyComponentRef,
    executable
  } = input;

  if (!chipProfile) {
    return 'map-chip-profile';
  }
  if (toolStatus === 'adapter-required') {
    return 'sync-adapter';
  }
  if (toolStatus === 'draft-adapter' || (bindingInfo.binding && bindingInfo.binding.draft === true)) {
    return 'implement-adapter';
  }
  if (!bindingInfo.binding) {
    return 'add-binding';
  }
  if (!hasAnySourceRef) {
    return 'add-source-refs';
  }
  if (!hasRegisterSummary) {
    return 'add-register-summary';
  }
  if (!hasAnyComponentRef) {
    return executable ? 'run-tool' : 'review-profile';
  }
  return executable ? 'run-tool' : 'review-profile';
}

function evaluateToolRecommendationTrust(input) {
  const chipProfile = input && input.chipProfile ? input.chipProfile : null;
  const deviceProfile = input && input.deviceProfile ? input.deviceProfile : null;
  const familyProfile = input && input.familyProfile ? input.familyProfile : null;
  const bindingInfo = input && input.bindingInfo
    ? input.bindingInfo
    : { source: 'none', binding: null };
  const tool = input && input.tool ? input.tool : {};
  const toolName = String(input && input.toolName ? input.toolName : tool.name || '').trim();
  const toolStatus = String(tool.status || '').trim() || 'adapter-required';
  const implementation = String(tool.implementation || '').trim();
  const signals = [];
  const gaps = [];
  let score = 0;

  const sourceRefs = collectSourceRefs(chipProfile, deviceProfile, familyProfile);
  const componentRefs = collectComponentRefs(chipProfile, deviceProfile, familyProfile);
  const hasAnySourceRef = sourceRefs.length > 0;
  const hasRegisterSummary = hasRegisterSummaryRef(chipProfile, deviceProfile, familyProfile);
  const hasAnyComponentRef = componentRefs.length > 0;

  if (chipProfile) {
    score += 6;
    uniquePush(signals, 'chip-profile');
  } else {
    uniquePush(gaps, 'missing chip profile');
  }

  if (chipProfile && chipProfile.package) {
    score += 2;
    uniquePush(signals, 'package');
  }
  if (chipProfile && hasArrayItems(chipProfile.capabilities)) {
    score += 2;
    uniquePush(signals, 'capabilities');
  }
  if (chipProfile && chipProfile.runtime_model) {
    score += 2;
    uniquePush(signals, 'runtime-model');
  }
  if (chipProfile && chipProfile.description) {
    score += 2;
    uniquePush(signals, 'chip-description');
  }
  if (chipProfile && hasObjectEntries(chipProfile.summary)) {
    score += 2;
    uniquePush(signals, 'chip-summary');
  }
  if (chipProfile && Array.isArray(chipProfile.related_tools) && chipProfile.related_tools.includes(toolName)) {
    score += 2;
    uniquePush(signals, 'chip-related-tool');
  }
  if (deviceProfile) {
    score += 6;
    uniquePush(signals, 'device-profile');
  }
  if (familyProfile) {
    score += 4;
    uniquePush(signals, 'family-profile');
  }
  if (deviceProfile && Array.isArray(deviceProfile.supported_tools) && deviceProfile.supported_tools.includes(toolName)) {
    score += 3;
    uniquePush(signals, 'device-supported-tool');
  }
  if (familyProfile && Array.isArray(familyProfile.supported_tools) && familyProfile.supported_tools.includes(toolName)) {
    score += 3;
    uniquePush(signals, 'family-supported-tool');
  }
  if (hasAnySourceRef) {
    score += 4;
    uniquePush(signals, 'source-refs');
  } else {
    uniquePush(gaps, 'missing source_refs');
  }
  if (deviceProfile && hasArrayItems(deviceProfile.source_refs)) {
    score += 2;
    uniquePush(signals, 'device-source-ref');
  }
  if (familyProfile && hasArrayItems(familyProfile.source_refs)) {
    score += 2;
    uniquePush(signals, 'family-source-ref');
  }
  if (hasRegisterSummary) {
    score += 10;
    uniquePush(signals, 'register-summary');
  } else {
    uniquePush(gaps, 'missing register summary');
  }
  if (hasAnyComponentRef) {
    score += 2;
    uniquePush(signals, 'component-refs');
  } else {
    uniquePush(gaps, 'missing component/circuit references');
  }

  if (bindingInfo.binding) {
    score += 14;
    uniquePush(signals, 'binding');
  } else {
    uniquePush(gaps, 'missing tool binding');
  }
  if (bindingInfo.source === 'device') {
    score += 4;
    uniquePush(signals, 'device-binding');
  } else if (bindingInfo.source === 'family') {
    score += 2;
    uniquePush(signals, 'family-binding');
  }
  if (bindingInfo.binding && bindingInfo.binding.algorithm) {
    score += 6;
    uniquePush(signals, 'algorithm');
  } else if (bindingInfo.binding) {
    uniquePush(gaps, 'binding is missing algorithm');
  }
  if (bindingInfo.binding && bindingInfo.binding.draft === true) {
    score -= 16;
    uniquePush(gaps, 'binding is still draft');
  }

  if (toolStatus === 'ready') {
    score += 14;
    uniquePush(signals, 'runtime-adapter-ready');
  } else if (toolStatus === 'draft-adapter') {
    score += 4;
    uniquePush(signals, 'runtime-draft-adapter');
    uniquePush(gaps, 'runtime adapter is still draft');
  } else {
    score -= 8;
    uniquePush(gaps, 'missing executable runtime adapter');
  }

  if (implementation === 'external-adapter') {
    score += 2;
  }
  if (tool.adapter_path) {
    score += 2;
    uniquePush(signals, 'adapter-path');
  }

  score = Math.max(0, Math.min(100, score));

  const grade = gradeFromScore(score);
  const executable =
    toolStatus === 'ready' &&
    bindingInfo.binding &&
    bindingInfo.binding.draft !== true &&
    (grade === 'trusted' || grade === 'usable');

  const recommendedAction = buildRecommendedAction({
    chipProfile,
    bindingInfo,
    toolStatus,
    hasRegisterSummary,
    hasAnySourceRef,
    hasAnyComponentRef,
    executable
  });

  return {
    score,
    grade,
    executable,
    summary: buildGradeSummary(grade),
    signals,
    gaps,
    recommended_action: recommendedAction
  };
}

function summarizeAdapterHealth(toolRecommendations, recommendedSources) {
  const recommendations = Array.isArray(toolRecommendations) ? toolRecommendations : [];
  const registerSummaryAvailable =
    Array.isArray(recommendedSources) &&
    recommendedSources.some(item => item && item.priority_group === 'register-summary');

  if (recommendations.length === 0) {
    return {
      status: 'info',
      total_tools: 0,
      register_summary_available: registerSummaryAvailable,
      overall_grade: 'missing',
      trusted_tools: 0,
      usable_tools: 0,
      executable_tools: 0,
      binding_ready_tools: 0,
      draft_binding_tools: 0,
      primary: null,
      summary: 'There is no adapter/tool recommendation to evaluate yet.'
    };
  }

  const ranked = recommendations
    .map(item => ({
      ...item,
      trust: item && item.trust ? item.trust : {
        score: 0,
        grade: 'missing',
        executable: false,
        summary: buildGradeSummary('missing'),
        signals: [],
        gaps: ['missing trust information'],
        recommended_action: 'review-profile'
      }
    }))
    .sort((left, right) => {
      return (right.trust.score || 0) - (left.trust.score || 0) ||
        Number(Boolean(right.trust.executable)) - Number(Boolean(left.trust.executable));
    });

  const primary = ranked[0];
  const trustedTools = ranked.filter(item => item.trust.grade === 'trusted').length;
  const usableTools = ranked.filter(item => item.trust.grade === 'usable').length;
  const executableTools = ranked.filter(item => item.trust.executable).length;
  const bindingReadyTools = ranked.filter(item => item.binding_source && item.binding_source !== 'none').length;
  const draftBindingTools = ranked.filter(
    item => item.trust.gaps && item.trust.gaps.some(gap => gap.includes('binding is still draft'))
  ).length;

  return {
    status: primary.trust.executable ? 'pass' : 'warn',
    total_tools: ranked.length,
    register_summary_available: registerSummaryAvailable || Boolean(primary.trust.signals.includes('register-summary')),
    overall_grade: primary.trust.grade,
    trusted_tools: trustedTools,
    usable_tools: usableTools,
    executable_tools: executableTools,
    binding_ready_tools: bindingReadyTools,
    draft_binding_tools: draftBindingTools,
    primary: {
      tool: primary.tool,
      status: primary.status,
      score: primary.trust.score,
      grade: primary.trust.grade,
      executable: primary.trust.executable,
      recommended_action: primary.trust.recommended_action,
      summary: primary.trust.summary,
      gaps: primary.trust.gaps,
      cli_draft: primary.cli_draft || ''
    },
    summary: primary.trust.summary
  };
}

module.exports = {
  evaluateToolRecommendationTrust,
  gradeFromScore,
  summarizeAdapterHealth
};
