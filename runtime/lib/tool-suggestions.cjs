'use strict';

const runtimeHostHelpers = require('./runtime-host.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);

function createToolSuggestionHelpers(deps) {
  const {
    ROOT,
    runtime,
    toolCatalog,
    toolRuntime
  } = deps;

  function safeLoad(loader, name) {
    if (!name) {
      return null;
    }

    try {
      return loader(ROOT, name);
    } catch {
      return null;
    }
  }

  function firstArrayItem(value) {
    return Array.isArray(value) && value.length > 0 ? value[0] : undefined;
  }

  function firstObjectKey(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return '';
    }

    return Object.keys(value)[0] || '';
  }

  function addDraftArg(parts, key, value) {
    if (value === undefined || value === null) {
      return;
    }

    const text = String(value).trim();
    if (!text) {
      return;
    }

    parts.push(`--${key}`, text);
  }

  function addIdentityArgs(parts, chipProfile, deviceProfile, familyProfile) {
    const familyName =
      (familyProfile && familyProfile.name) ||
      (deviceProfile && deviceProfile.family) ||
      (chipProfile && chipProfile.family) ||
      '';
    const deviceName = deviceProfile && deviceProfile.name ? deviceProfile.name : '';
    const chipName = chipProfile && chipProfile.name ? chipProfile.name : '';

    addDraftArg(parts, 'family', familyName);
    addDraftArg(parts, 'device', deviceName);

    if (chipName && chipName !== deviceName) {
      addDraftArg(parts, 'chip', chipName);
    }
    if (!deviceName && chipName) {
      addDraftArg(parts, 'chip', chipName);
    }
  }

  function addUniqueMissing(missing, value) {
    const text = String(value || '').trim();
    if (text && !missing.includes(text)) {
      missing.push(text);
    }
  }

  function finalizeDraft(parts) {
    return runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, parts);
  }

  function resolveProfiles(chipProfile) {
    if (!chipProfile) {
      return {
        family: null,
        device: null
      };
    }

    const device = safeLoad(toolCatalog.loadDevice, chipProfile.name);
    const familyName =
      (device && device.family) ||
      chipProfile.family ||
      '';

    return {
      device,
      family: safeLoad(toolCatalog.loadFamily, familyName)
    };
  }

  function resolveBinding(toolName, deviceProfile, familyProfile) {
    const deviceBindings = (deviceProfile && deviceProfile.bindings) || {};
    if (deviceBindings[toolName]) {
      return {
        source: 'device',
        binding: deviceBindings[toolName]
      };
    }

    const familyBindings = (familyProfile && familyProfile.bindings) || {};
    if (familyBindings[toolName]) {
      return {
        source: 'family',
        binding: familyBindings[toolName]
      };
    }

    return {
      source: 'none',
      binding: null
    };
  }

  function resolveTimerParams(binding) {
    const params = (binding && binding.params) || {};
    const variants = params.timer_variants;

    if (!variants || typeof variants !== 'object' || Array.isArray(variants)) {
      return {
        timer: params.default_timer || params.peripheral || '',
        defaults: params
      };
    }

    const timerName = params.default_timer || firstObjectKey(variants);
    const variant = timerName ? (variants[timerName] || {}) : {};

    return {
      timer: timerName || variant.peripheral || params.peripheral || '',
      defaults: {
        ...params,
        ...variant
      }
    };
  }

  function buildTimerDraft(toolName, chipProfile, deviceProfile, familyProfile, binding) {
    const missing = [];
    const parts = ['tool', 'run', toolName];
    const resolved = resolveTimerParams(binding);
    const defaults = resolved.defaults || {};

    addIdentityArgs(parts, chipProfile, deviceProfile, familyProfile);
    addDraftArg(parts, 'timer', resolved.timer || 'TIMER_NAME');
    addDraftArg(
      parts,
      'clock-source',
      defaults.default_clock_source || firstObjectKey(defaults.clock_sources) || 'CLOCK_SOURCE'
    );
    addDraftArg(parts, 'clock-hz', '<CLOCK_HZ>');
    addUniqueMissing(missing, 'clock-hz');

    if (firstArrayItem(defaults.prescalers) !== undefined) {
      addDraftArg(parts, 'prescaler', firstArrayItem(defaults.prescalers));
    }

    if (firstArrayItem(defaults.interrupt_bits) !== undefined) {
      addDraftArg(parts, 'interrupt-bit', firstArrayItem(defaults.interrupt_bits));
    }

    addDraftArg(parts, 'target-us', '<TARGET_US>');
    addUniqueMissing(missing, 'target-us or target-hz');

    return {
      cli_draft: finalizeDraft(parts),
      missing_inputs: missing,
      defaults_applied: {
        timer: resolved.timer || '',
        clock_source: defaults.default_clock_source || '',
        prescaler: firstArrayItem(defaults.prescalers) || '',
        interrupt_bit: firstArrayItem(defaults.interrupt_bits) || ''
      }
    };
  }

  function buildPwmDraft(toolName, chipProfile, deviceProfile, familyProfile, binding) {
    const params = (binding && binding.params) || {};
    const missing = [];
    const parts = ['tool', 'run', toolName];

    addIdentityArgs(parts, chipProfile, deviceProfile, familyProfile);
    addDraftArg(
      parts,
      'output-pin',
      params.default_output_pin || firstObjectKey(params.output_pins) || 'OUTPUT_PIN'
    );
    addDraftArg(
      parts,
      'clock-source',
      params.default_clock_source || firstObjectKey(params.clock_sources) || 'CLOCK_SOURCE'
    );
    addDraftArg(parts, 'clock-hz', '<CLOCK_HZ>');
    addDraftArg(parts, 'target-hz', '<TARGET_HZ>');
    addDraftArg(parts, 'target-duty', '50');
    addUniqueMissing(missing, 'clock-hz');
    addUniqueMissing(missing, 'target-hz');

    return {
      cli_draft: finalizeDraft(parts),
      missing_inputs: missing,
      defaults_applied: {
        output_pin: params.default_output_pin || '',
        clock_source: params.default_clock_source || '',
        target_duty: 50
      }
    };
  }

  function buildComparatorDraft(toolName, chipProfile, deviceProfile, familyProfile, binding) {
    const params = (binding && binding.params) || {};
    const missing = [];
    const parts = ['tool', 'run', toolName];

    addIdentityArgs(parts, chipProfile, deviceProfile, familyProfile);
    addDraftArg(parts, 'vdd', '<VDD_V>');
    addDraftArg(parts, 'target-threshold-v', '<TARGET_THRESHOLD_V>');
    addDraftArg(
      parts,
      'positive-source',
      params.default_positive_source || firstObjectKey(params.positive_sources) || 'POSITIVE_SOURCE'
    );
    addDraftArg(
      parts,
      'negative-source',
      params.default_negative_source || firstObjectKey(params.negative_sources) || 'NEGATIVE_SOURCE'
    );
    addUniqueMissing(missing, 'vdd');
    addUniqueMissing(missing, 'target-threshold-v or target-ratio');

    return {
      cli_draft: finalizeDraft(parts),
      missing_inputs: missing,
      defaults_applied: {
        positive_source: params.default_positive_source || '',
        negative_source: params.default_negative_source || ''
      }
    };
  }

  function buildAdcDraft(toolName, chipProfile, deviceProfile, familyProfile, binding) {
    const params = (binding && binding.params) || {};
    const referenceKey = params.default_reference_source || firstObjectKey(params.reference_sources) || '';
    const reference = referenceKey ? ((params.reference_sources || {})[referenceKey] || {}) : {};
    const missing = [];
    const parts = ['tool', 'run', toolName];

    addIdentityArgs(parts, chipProfile, deviceProfile, familyProfile);
    addDraftArg(parts, 'reference-source', referenceKey || 'REFERENCE_SOURCE');

    if (!reference.fixed_voltage) {
      addDraftArg(parts, 'reference-v', '<REFERENCE_V>');
      addUniqueMissing(missing, 'reference-v');
    }

    addDraftArg(parts, 'channel', params.default_channel || firstObjectKey(params.channels) || 'CHANNEL');
    addDraftArg(
      parts,
      'resolution',
      params.default_resolution || firstArrayItem(params.supported_resolutions) || 'RESOLUTION'
    );
    addDraftArg(parts, 'sample-code', '<SAMPLE_CODE>');
    addUniqueMissing(missing, 'sample-code or target-voltage');

    return {
      cli_draft: finalizeDraft(parts),
      missing_inputs: missing,
      defaults_applied: {
        reference_source: referenceKey || '',
        channel: params.default_channel || '',
        resolution: params.default_resolution || firstArrayItem(params.supported_resolutions) || ''
      }
    };
  }

  function buildGenericDraft(toolName, chipProfile, deviceProfile, familyProfile, spec) {
    const missing = (spec.inputs || []).map(item => String(item));
    const parts = ['tool', 'run', toolName];
    addIdentityArgs(parts, chipProfile, deviceProfile, familyProfile);

    return {
      cli_draft: finalizeDraft(parts),
      missing_inputs: missing,
      defaults_applied: {}
    };
  }

  function buildDraft(toolName, chipProfile, deviceProfile, familyProfile, spec, binding) {
    if (toolName === 'timer-calc') {
      return buildTimerDraft(toolName, chipProfile, deviceProfile, familyProfile, binding);
    }
    if (toolName === 'pwm-calc') {
      return buildPwmDraft(toolName, chipProfile, deviceProfile, familyProfile, binding);
    }
    if (toolName === 'comparator-threshold') {
      return buildComparatorDraft(toolName, chipProfile, deviceProfile, familyProfile, binding);
    }
    if (toolName === 'adc-scale') {
      return buildAdcDraft(toolName, chipProfile, deviceProfile, familyProfile, binding);
    }

    return buildGenericDraft(toolName, chipProfile, deviceProfile, familyProfile, spec);
  }

  function buildRecommendationReason(tool, bindingInfo) {
    if (tool.status !== 'ready') {
      return bindingInfo.binding
        ? '已识别到 profile binding，但当前 runtime 还没有外部 adapter，先安装或同步 adapter 仓库。'
        : '当前只有抽象工具规格；需要外部 adapter 才能真正执行该工具。';
    }

    if (!bindingInfo.binding) {
      return '外部 adapter 已存在，但当前 chip/device/family 还没有声明可执行 binding。';
    }

    return `已识别 ${bindingInfo.source} binding，可直接补齐缺失参数后执行。`;
  }

  function buildRecommendationStatus(tool, bindingInfo) {
    if (tool.status !== 'ready') {
      return 'adapter-required';
    }

    return bindingInfo.binding ? 'ready' : 'route-required';
  }

  function buildToolExecutionFromRecommendation(recommendation) {
    if (!recommendation || !recommendation.cli_draft) {
      return null;
    }

    return {
      available: true,
      recommended: recommendation.status === 'ready',
      tool: recommendation.tool,
      status: recommendation.status,
      cli: recommendation.cli_draft,
      reason: recommendation.reason || '',
      missing_inputs: recommendation.missing_inputs || [],
      defaults_applied: recommendation.defaults_applied || {}
    };
  }

  function buildToolExecutionFromNext(next) {
    const recommendation =
      next &&
      next.next &&
      next.next.tool_recommendation
        ? next.next.tool_recommendation
        : null;

    return buildToolExecutionFromRecommendation(recommendation);
  }

  function buildSuggestedTools(chipProfile) {
    if (!chipProfile || !Array.isArray(chipProfile.related_tools) || chipProfile.related_tools.length === 0) {
      return [];
    }

    return runtime.unique(chipProfile.related_tools)
      .map(toolName => {
        try {
          const spec = toolCatalog.loadToolSpec(ROOT, toolName);
          const adapter = toolRuntime.loadExternalAdapter(ROOT, toolName);

          return {
            name: spec.name,
            description: spec.description,
            tool_kind: spec.kind,
            chip: chipProfile.name,
            family: chipProfile.family,
            discovered_from: 'chip-profile',
            status: adapter ? 'ready' : 'adapter-required',
            implementation: adapter ? 'external-adapter' : 'abstract-only',
            adapter_path: adapter ? adapter.file_path : ''
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function buildToolRecommendations(chipProfile, suggestedTools) {
    if (!chipProfile || !Array.isArray(suggestedTools) || suggestedTools.length === 0) {
      return [];
    }

    const profiles = resolveProfiles(chipProfile);

    return suggestedTools.map(tool => {
      const spec = safeLoad(toolCatalog.loadToolSpec, tool.name);
      const bindingInfo = resolveBinding(tool.name, profiles.device, profiles.family);
      const draft = buildDraft(
        tool.name,
        chipProfile,
        profiles.device,
        profiles.family,
        spec || { inputs: [] },
        bindingInfo.binding
      );

      return {
        tool: tool.name,
        description: tool.description,
        status: buildRecommendationStatus(tool, bindingInfo),
        adapter_status: tool.status,
        binding_source: bindingInfo.source,
        binding_algorithm: bindingInfo.binding && bindingInfo.binding.algorithm
          ? bindingInfo.binding.algorithm
          : '',
        reason: buildRecommendationReason(tool, bindingInfo),
        cli_draft: draft.cli_draft,
        missing_inputs: draft.missing_inputs,
        defaults_applied: draft.defaults_applied
      };
    });
  }

  function enrichWithToolSuggestions(output, resolved) {
    const hardwareIdentity = resolved && resolved.hardware ? resolved.hardware.identity : null;
    const chipProfile = resolved && resolved.hardware ? resolved.hardware.chip_profile : null;
    const suggestedTools = (resolved && resolved.effective && resolved.effective.suggested_tools) || [];
    const toolRecommendations = (resolved && resolved.effective && resolved.effective.tool_recommendations) || [];

    if (!suggestedTools.length && !toolRecommendations.length && !chipProfile && !(hardwareIdentity && hardwareIdentity.model)) {
      return output;
    }

    return {
      ...output,
      hardware: {
        mcu: hardwareIdentity || { file: 'emb-agent/hw.yaml', vendor: '', model: '', package: '' },
        chip_profile: chipProfile
          ? {
              name: chipProfile.name,
              vendor: chipProfile.vendor,
              family: chipProfile.family,
              package: chipProfile.package,
              runtime_model: chipProfile.runtime_model
            }
          : null
      },
      suggested_tools: suggestedTools,
      tool_recommendations: toolRecommendations
    };
  }

  return {
    buildSuggestedTools,
    buildToolRecommendations,
    buildToolExecutionFromNext,
    buildToolExecutionFromRecommendation,
    enrichWithToolSuggestions
  };
}

module.exports = {
  createToolSuggestionHelpers
};
