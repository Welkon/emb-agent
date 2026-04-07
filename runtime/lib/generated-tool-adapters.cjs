'use strict';

function ensureNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return [value];
}

function uniqueNumbers(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = String(value);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function parsePositiveNumber(value) {
  const number = ensureNumber(value);
  if (!Number.isFinite(number) || number <= 0) {
    return NaN;
  }
  return number;
}

function parseIntegerList(value) {
  return uniqueNumbers(
    toArray(value)
      .map(item => Number(item))
      .filter(item => Number.isInteger(item) && item >= 0)
  );
}

function firstObjectKey(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return '';
  }
  return Object.keys(value)[0] || '';
}

function resolveTimerBinding(binding, options) {
  const params = (binding && binding.params) || {};
  const variants = params.timer_variants && typeof params.timer_variants === 'object' ? params.timer_variants : {};
  const requestedTimer = String(options.timer || params.default_timer || firstObjectKey(variants) || '').trim();
  const variant = requestedTimer ? (variants[requestedTimer] || {}) : {};

  return {
    timer: requestedTimer || String(params.peripheral || variant.peripheral || '').trim(),
    defaults: {
      ...params,
      ...variant
    }
  };
}

function resolvePwmBinding(binding, options) {
  const params = (binding && binding.params) || {};
  const variants = params.pwm_variants && typeof params.pwm_variants === 'object' ? params.pwm_variants : {};
  const requestedPwm = String(
    options.pwm ||
    options['pwm-block'] ||
    options.timer ||
    params.default_pwm ||
    params.pwm_block ||
    firstObjectKey(variants) ||
    ''
  ).trim();
  const variant = requestedPwm ? (variants[requestedPwm] || {}) : {};

  return {
    pwm: requestedPwm || String(params.pwm_block || variant.peripheral || '').trim(),
    defaults: {
      ...params,
      ...variant
    }
  };
}

function resolveAdcBinding(binding, options) {
  const params = (binding && binding.params) || {};
  const channels = params.channels && typeof params.channels === 'object' ? params.channels : {};
  const references = params.reference_sources && typeof params.reference_sources === 'object' ? params.reference_sources : {};
  const requestedChannel = String(options.channel || params.default_channel || firstObjectKey(channels) || '').trim();
  const requestedReference = String(
    options['reference-source'] ||
    params.default_reference_source ||
    firstObjectKey(references) ||
    ''
  ).trim();

  return {
    channel: requestedChannel,
    referenceSource: requestedReference,
    defaults: {
      ...params
    }
  };
}

function resolveComparatorBinding(binding, options) {
  const params = (binding && binding.params) || {};
  const positiveSources = params.positive_sources && typeof params.positive_sources === 'object'
    ? params.positive_sources
    : {};
  const negativeSources = params.negative_sources && typeof params.negative_sources === 'object'
    ? params.negative_sources
    : {};

  return {
    positiveSource: String(
      options['positive-source'] ||
      params.default_positive_source ||
      firstObjectKey(positiveSources) ||
      ''
    ).trim(),
    negativeSource: String(
      options['negative-source'] ||
      params.default_negative_source ||
      firstObjectKey(negativeSources) ||
      ''
    ).trim(),
    defaults: {
      ...params
    }
  };
}

function buildTimerCandidates(clockHz, targetUs, timerName, defaults, options) {
  const prescalers = parseIntegerList(options.prescaler).length > 0
    ? parseIntegerList(options.prescaler)
    : parseIntegerList(defaults.prescalers);
  const interruptBits = parseIntegerList(options['interrupt-bit']).length > 0
    ? parseIntegerList(options['interrupt-bit'])
    : parseIntegerList(defaults.interrupt_bits);
  const counterBits = parseIntegerList(options['counter-bits']).length > 0
    ? parseIntegerList(options['counter-bits'])
    : parseIntegerList(defaults.counter_bits);
  const effectiveBits = interruptBits.length > 0 ? interruptBits : counterBits;

  const candidates = [];

  prescalers.forEach(prescaler => {
    effectiveBits.forEach(bitCount => {
      const ticks = 2 ** bitCount;
      const actualUs = (prescaler * ticks * 1e6) / clockHz;
      const actualHz = 1e6 / actualUs;
      const errorUs = actualUs - targetUs;
      const errorPct = targetUs === 0 ? 0 : (errorUs / targetUs) * 100;

      candidates.push({
        timer: timerName,
        prescaler,
        interrupt_bit: interruptBits.includes(bitCount) ? bitCount : undefined,
        counter_bits: counterBits.includes(bitCount) ? bitCount : undefined,
        ticks,
        actual_us: Number(actualUs.toFixed(6)),
        actual_hz: Number(actualHz.toFixed(6)),
        error_us: Number(errorUs.toFixed(6)),
        error_pct: Number(errorPct.toFixed(6))
      });
    });
  });

  return candidates.sort((left, right) => {
    return Math.abs(left.error_us) - Math.abs(right.error_us) ||
      left.prescaler - right.prescaler ||
      (left.interrupt_bit || left.counter_bits || 0) - (right.interrupt_bit || right.counter_bits || 0);
  });
}

function buildPwmCandidates(clockHz, targetHz, targetDuty, pwmName, defaults, options) {
  const prescalers = parseIntegerList(options.prescaler).length > 0
    ? parseIntegerList(options.prescaler)
    : parseIntegerList(defaults.prescalers);
  const periodBits = parseIntegerList(options['period-bits']).length > 0
    ? parseIntegerList(options['period-bits'])
    : parseIntegerList(defaults.period_bits);
  const counterBits = parseIntegerList(options['counter-bits']).length > 0
    ? parseIntegerList(options['counter-bits'])
    : parseIntegerList(defaults.counter_bits);
  const effectiveBits = periodBits.length > 0 ? periodBits : counterBits;
  const candidates = [];

  prescalers.forEach(prescaler => {
    effectiveBits.forEach(bitCount => {
      const periodCounts = 2 ** bitCount;
      const actualHz = clockHz / (prescaler * periodCounts);
      const freqErrorHz = actualHz - targetHz;
      const freqErrorPct = targetHz === 0 ? 0 : (freqErrorHz / targetHz) * 100;
      const dutySteps = Math.min(periodCounts, Math.max(0, Math.round((periodCounts * targetDuty) / 100)));
      const actualDuty = (dutySteps / periodCounts) * 100;
      const dutyErrorPct = actualDuty - targetDuty;

      candidates.push({
        pwm: pwmName,
        prescaler,
        period_bits: periodBits.includes(bitCount) ? bitCount : undefined,
        counter_bits: counterBits.includes(bitCount) ? bitCount : undefined,
        period_counts: periodCounts,
        duty_steps: dutySteps,
        actual_hz: Number(actualHz.toFixed(6)),
        actual_duty: Number(actualDuty.toFixed(6)),
        freq_error_hz: Number(freqErrorHz.toFixed(6)),
        freq_error_pct: Number(freqErrorPct.toFixed(6)),
        duty_error_pct: Number(dutyErrorPct.toFixed(6))
      });
    });
  });

  return candidates.sort((left, right) => {
    return Math.abs(left.freq_error_pct) - Math.abs(right.freq_error_pct) ||
      Math.abs(left.duty_error_pct) - Math.abs(right.duty_error_pct) ||
      left.prescaler - right.prescaler ||
      (left.period_bits || left.counter_bits || 0) - (right.period_bits || right.counter_bits || 0);
  });
}

function buildAdcConversion(referenceVoltage, resolution, sampleCode, targetVoltage) {
  const maxCode = (2 ** resolution) - 1;
  const lsbVoltage = maxCode > 0 ? referenceVoltage / maxCode : NaN;
  const sampleVoltage = Number.isFinite(sampleCode)
    ? (sampleCode / maxCode) * referenceVoltage
    : NaN;
  const predictedCodeRaw = Number.isFinite(targetVoltage)
    ? (targetVoltage / referenceVoltage) * maxCode
    : NaN;
  const predictedCode = Number.isFinite(predictedCodeRaw)
    ? Math.min(maxCode, Math.max(0, Math.round(predictedCodeRaw)))
    : NaN;
  const quantizedVoltage = Number.isFinite(predictedCode)
    ? (predictedCode / maxCode) * referenceVoltage
    : NaN;

  return {
    max_code: maxCode,
    lsb_voltage: Number.isFinite(lsbVoltage) ? Number(lsbVoltage.toFixed(9)) : NaN,
    sampled_voltage: Number.isFinite(sampleVoltage) ? Number(sampleVoltage.toFixed(9)) : NaN,
    predicted_code: Number.isFinite(predictedCode) ? predictedCode : NaN,
    predicted_code_raw: Number.isFinite(predictedCodeRaw) ? Number(predictedCodeRaw.toFixed(6)) : NaN,
    quantized_voltage: Number.isFinite(quantizedVoltage) ? Number(quantizedVoltage.toFixed(9)) : NaN,
    target_error_voltage: Number.isFinite(targetVoltage) && Number.isFinite(quantizedVoltage)
      ? Number((quantizedVoltage - targetVoltage).toFixed(9))
      : NaN
  };
}

function parseRatioValue(value) {
  const number = ensureNumber(value);
  if (!Number.isFinite(number) || number < 0) {
    return NaN;
  }
  if (number > 1 && number <= 100) {
    return number / 100;
  }
  return number;
}

function resolveComparatorSourceRange(sourceName, sourceConfig, vdd) {
  const source = sourceConfig && typeof sourceConfig === 'object' ? sourceConfig : {};
  const fixedVoltage = parsePositiveNumber(source.fixed_voltage);
  const fixedRatio = parseRatioValue(source.fixed_ratio);
  const minVoltageDirect = parsePositiveNumber(source.min_voltage);
  const maxVoltageDirect = parsePositiveNumber(source.max_voltage);
  const minRatio = parseRatioValue(source.min_ratio);
  const maxRatio = parseRatioValue(source.max_ratio);
  const role = String(source.role || source.kind || '').toLowerCase();
  const signal = String(source.signal || source.pin || '').trim();

  let minVoltage = NaN;
  let maxVoltage = NaN;
  let mode = 'unknown';

  if (Number.isFinite(fixedVoltage)) {
    minVoltage = fixedVoltage;
    maxVoltage = fixedVoltage;
    mode = 'fixed-voltage';
  } else if (Number.isFinite(fixedRatio) && Number.isFinite(vdd)) {
    minVoltage = fixedRatio * vdd;
    maxVoltage = fixedRatio * vdd;
    mode = 'fixed-ratio';
  } else if ((Number.isFinite(minVoltageDirect) || Number.isFinite(maxVoltageDirect))) {
    minVoltage = Number.isFinite(minVoltageDirect) ? minVoltageDirect : 0;
    maxVoltage = Number.isFinite(maxVoltageDirect) ? maxVoltageDirect : (Number.isFinite(vdd) ? vdd : NaN);
    mode = 'voltage-range';
  } else if ((Number.isFinite(minRatio) || Number.isFinite(maxRatio)) && Number.isFinite(vdd)) {
    minVoltage = (Number.isFinite(minRatio) ? minRatio : 0) * vdd;
    maxVoltage = (Number.isFinite(maxRatio) ? maxRatio : 1) * vdd;
    mode = 'ratio-range';
  } else if ((role.includes('input') || role.includes('external') || signal) && Number.isFinite(vdd)) {
    minVoltage = 0;
    maxVoltage = vdd;
    mode = 'external-range';
  }

  return {
    name: sourceName,
    role: String(source.role || source.kind || source.type || '').trim(),
    signal,
    mode,
    fixed_voltage: Number.isFinite(fixedVoltage)
      ? Number(fixedVoltage.toFixed(9))
      : (Number.isFinite(fixedRatio) && Number.isFinite(vdd) ? Number((fixedRatio * vdd).toFixed(9)) : undefined),
    min_voltage: Number.isFinite(minVoltage) ? Number(minVoltage.toFixed(9)) : undefined,
    max_voltage: Number.isFinite(maxVoltage) ? Number(maxVoltage.toFixed(9)) : undefined
  };
}

function comparatorSidePriority(sourceInfo) {
  if (!sourceInfo) {
    return 0;
  }
  if (sourceInfo.mode === 'fixed-voltage' || sourceInfo.mode === 'fixed-ratio') {
    return 3;
  }
  if (sourceInfo.mode === 'voltage-range' || sourceInfo.mode === 'ratio-range') {
    return 2;
  }
  if (sourceInfo.mode === 'external-range') {
    return 1;
  }
  return 0;
}

function runGeneratedTimerAdapter(context, resolved, options) {
  const binding = resolved && resolved.binding ? resolved.binding : null;
  const timerConfig = resolveTimerBinding(binding, options || {});
  const defaults = timerConfig.defaults || {};
  const clockHz = parsePositiveNumber(options['clock-hz']);
  const targetUs = Number.isFinite(parsePositiveNumber(options['target-us']))
    ? parsePositiveNumber(options['target-us'])
    : (
      Number.isFinite(parsePositiveNumber(options['target-hz'])) && parsePositiveNumber(options['target-hz']) > 0
        ? 1e6 / parsePositiveNumber(options['target-hz'])
        : NaN
    );
  const clockSource = String(
    options['clock-source'] ||
    defaults.default_clock_source ||
    firstObjectKey(defaults.clock_sources) ||
    ''
  ).trim();

  if (!binding) {
    return {
      tool: context.toolName,
      status: 'route-required',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      notes: [
        'draft route 已存在，但还没有匹配到 device/family binding。',
        '请先补 bindings，或重新执行 adapter derive。'
      ]
    };
  }

  if (!timerConfig.timer) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['timer'],
      notes: [
        '当前 binding 缺少默认 timer 信息。',
        '请在 device/family binding 里补 default_timer 或 timer_variants。'
      ]
    };
  }

  if (!Number.isFinite(clockHz)) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['clock-hz'],
      notes: [
        'timer-calc 首版实现已可运行，但仍需要明确输入 clock-hz。'
      ]
    };
  }

  if (!Number.isFinite(targetUs)) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['target-us or target-hz'],
      notes: [
        'timer-calc 首版实现已可运行，但仍需要目标周期或频率。'
      ]
    };
  }

  const candidates = buildTimerCandidates(clockHz, targetUs, timerConfig.timer, defaults, options || {});
  if (candidates.length === 0) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      notes: [
        '当前 binding 缺少可搜索的 prescalers / interrupt_bits / counter_bits。',
        '请在 binding params 中补这些组合后再运行。'
      ]
    };
  }

  const best = candidates[0];
  return {
    tool: context.toolName,
    status: 'ok',
    implementation: 'external-adapter-draft',
    adapter_path: context.adapterPath,
    adapter_mode: 'generated-timer-search',
    inputs: {
      raw_tokens: context.tokens || [],
      options
    },
    resolution: {
      family: resolved.family || '',
      device: resolved.device || '',
      binding_source: resolved.source || ''
    },
    binding: {
      algorithm: binding.algorithm || '',
      draft: binding.draft !== false,
      params: binding.params || {},
      evidence: binding.evidence || []
    },
    timer: {
      name: timerConfig.timer,
      clock_source: clockSource,
      clock_hz: clockHz,
      target_us: Number(targetUs.toFixed(6)),
      target_hz: Number((1e6 / targetUs).toFixed(6))
    },
    best_candidate: best,
    candidates: candidates.slice(0, 8),
    notes: [
      '这是 timer-calc 的首版通用搜索实现，基于 binding params 中的 prescaler/bit 组合计算。',
      '当前仍保留 draft route 标记；如果要量产使用，需继续补寄存器名、reload 写法和边界说明。'
    ]
  };
}

function runGeneratedPwmAdapter(context, resolved, options) {
  const binding = resolved && resolved.binding ? resolved.binding : null;
  const pwmConfig = resolvePwmBinding(binding, options || {});
  const defaults = pwmConfig.defaults || {};
  const outputPin = String(
    options['output-pin'] ||
    defaults.default_output_pin ||
    firstObjectKey(defaults.output_pins) ||
    ''
  ).trim();
  const clockSource = String(
    options['clock-source'] ||
    defaults.default_clock_source ||
    firstObjectKey(defaults.clock_sources) ||
    ''
  ).trim();
  const clockHz = parsePositiveNumber(options['clock-hz']);
  const targetHz = parsePositiveNumber(options['target-hz']);
  const dutyInput = options['target-duty'] === undefined ? 50 : ensureNumber(options['target-duty']);
  const targetDuty = Number.isFinite(dutyInput) && dutyInput >= 0 && dutyInput <= 100 ? dutyInput : NaN;

  if (!binding) {
    return {
      tool: context.toolName,
      status: 'route-required',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      notes: [
        'draft route 已存在，但还没有匹配到 device/family binding。',
        '请先补 bindings，或重新执行 adapter derive。'
      ]
    };
  }

  if (!outputPin) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['output-pin'],
      notes: [
        '当前 binding 缺少默认 PWM 输出引脚信息。',
        '请在 device/family binding 里补 default_output_pin 或 output_pins。'
      ]
    };
  }

  if (!Number.isFinite(clockHz)) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['clock-hz'],
      notes: [
        'pwm-calc 首版实现已可运行，但仍需要明确输入 clock-hz。'
      ]
    };
  }

  if (!Number.isFinite(targetHz)) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['target-hz'],
      notes: [
        'pwm-calc 首版实现已可运行，但仍需要目标 PWM 频率。'
      ]
    };
  }

  if (!Number.isFinite(targetDuty)) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['target-duty'],
      notes: [
        'target-duty 必须是 0 到 100 之间的百分比。'
      ]
    };
  }

  const candidates = buildPwmCandidates(clockHz, targetHz, targetDuty, pwmConfig.pwm || 'PWM', defaults, options || {});
  if (candidates.length === 0) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      notes: [
        '当前 binding 缺少可搜索的 prescalers / counter_bits / period_bits。',
        '请在 binding params 中补这些组合后再运行。'
      ]
    };
  }

  const best = candidates[0];
  return {
    tool: context.toolName,
    status: 'ok',
    implementation: 'external-adapter-draft',
    adapter_path: context.adapterPath,
    adapter_mode: 'generated-pwm-search',
    inputs: {
      raw_tokens: context.tokens || [],
      options
    },
    resolution: {
      family: resolved.family || '',
      device: resolved.device || '',
      binding_source: resolved.source || ''
    },
    binding: {
      algorithm: binding.algorithm || '',
      draft: binding.draft !== false,
      params: binding.params || {},
      evidence: binding.evidence || []
    },
    pwm: {
      name: pwmConfig.pwm || 'PWM',
      output_pin: outputPin,
      clock_source: clockSource,
      clock_hz: clockHz,
      target_hz: Number(targetHz.toFixed(6)),
      target_duty: Number(targetDuty.toFixed(6))
    },
    best_candidate: best,
    candidates: candidates.slice(0, 8),
    notes: [
      '这是 pwm-calc 的首版通用搜索实现，基于 binding params 中的 prescaler/period 组合计算。',
      '当前仍保留 draft route 标记；如果要量产使用，需继续补 period 写法、寄存器边界和输出极性说明。'
    ]
  };
}

function runGeneratedAdcAdapter(context, resolved, options) {
  const binding = resolved && resolved.binding ? resolved.binding : null;
  const adcConfig = resolveAdcBinding(binding, options || {});
  const defaults = adcConfig.defaults || {};
  const references = defaults.reference_sources && typeof defaults.reference_sources === 'object'
    ? defaults.reference_sources
    : {};
  const reference = adcConfig.referenceSource ? (references[adcConfig.referenceSource] || {}) : {};
  const referenceVoltage = Number.isFinite(parsePositiveNumber(options['reference-v']))
    ? parsePositiveNumber(options['reference-v'])
    : parsePositiveNumber(reference.fixed_voltage);
  const resolution = Number.isInteger(Number(options.resolution))
    ? Number(options.resolution)
    : (
      Number.isInteger(Number(defaults.default_resolution))
        ? Number(defaults.default_resolution)
        : parseIntegerList(defaults.supported_resolutions)[0]
    );
  const sampleCode = options['sample-code'] === undefined ? NaN : ensureNumber(options['sample-code']);
  const targetVoltage = options['target-voltage'] === undefined ? NaN : ensureNumber(options['target-voltage']);
  const notes = [];

  if (!binding) {
    return {
      tool: context.toolName,
      status: 'route-required',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      notes: [
        'draft route 已存在，但还没有匹配到 device/family binding。',
        '请先补 bindings，或重新执行 adapter derive。'
      ]
    };
  }

  if (!adcConfig.channel) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['channel'],
      notes: [
        '当前 binding 缺少默认 ADC 通道信息。',
        '请在 device/family binding 里补 default_channel 或 channels。'
      ]
    };
  }

  if (!Number.isFinite(referenceVoltage)) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['reference-v'],
      notes: [
        'adc-scale 首版实现已可运行，但仍需要明确参考电压或 fixed_voltage 参考源。'
      ]
    };
  }

  if (!Number.isInteger(resolution) || resolution <= 0) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['resolution'],
      notes: [
        'adc-scale 首版实现已可运行，但仍需要 ADC 分辨率。'
      ]
    };
  }

  if (!Number.isFinite(sampleCode) && !Number.isFinite(targetVoltage)) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['sample-code or target-voltage'],
      notes: [
        'adc-scale 首版实现已可运行，但仍需要样本码或目标电压。'
      ]
    };
  }

  const conversion = buildAdcConversion(referenceVoltage, resolution, sampleCode, targetVoltage);
  if (Number.isFinite(sampleCode) && (sampleCode < 0 || sampleCode > conversion.max_code)) {
    notes.push('sample-code 超出当前 resolution 可表示范围，请检查分辨率或原始采样值。');
  }
  if (Number.isFinite(targetVoltage) && targetVoltage > referenceVoltage) {
    notes.push('target-voltage 高于参考电压，已按满量程裁剪 predicted_code。');
  }
  if (Number.isFinite(targetVoltage) && targetVoltage < 0) {
    notes.push('target-voltage 小于 0V，已按 0 码处理 predicted_code。');
  }

  return {
    tool: context.toolName,
    status: 'ok',
    implementation: 'external-adapter-draft',
    adapter_path: context.adapterPath,
    adapter_mode: 'generated-adc-scale',
    inputs: {
      raw_tokens: context.tokens || [],
      options
    },
    resolution: {
      family: resolved.family || '',
      device: resolved.device || '',
      binding_source: resolved.source || ''
    },
    binding: {
      algorithm: binding.algorithm || '',
      draft: binding.draft !== false,
      params: binding.params || {},
      evidence: binding.evidence || []
    },
    adc: {
      channel: adcConfig.channel,
      reference_source: adcConfig.referenceSource,
      reference_voltage: Number(referenceVoltage.toFixed(9)),
      resolution_bits: resolution,
      sample_code: Number.isFinite(sampleCode) ? sampleCode : undefined,
      target_voltage: Number.isFinite(targetVoltage) ? Number(targetVoltage.toFixed(9)) : undefined
    },
    conversion,
    notes: [
      '这是 adc-scale 的首版通用换算实现，基于参考电压、分辨率和 sample/target 输入做标定。',
      '当前仍保留 draft route 标记；如果要量产使用，需继续补采样时间、输入阻抗、参考源误差和校准边界。'
    ].concat(notes)
  };
}

function runGeneratedComparatorAdapter(context, resolved, options) {
  const binding = resolved && resolved.binding ? resolved.binding : null;
  const comparatorConfig = resolveComparatorBinding(binding, options || {});
  const defaults = comparatorConfig.defaults || {};
  const positiveSources = defaults.positive_sources && typeof defaults.positive_sources === 'object'
    ? defaults.positive_sources
    : {};
  const negativeSources = defaults.negative_sources && typeof defaults.negative_sources === 'object'
    ? defaults.negative_sources
    : {};
  const vdd = parsePositiveNumber(options.vdd);
  const targetThreshold = Number.isFinite(parsePositiveNumber(options['target-threshold-v']))
    ? parsePositiveNumber(options['target-threshold-v'])
    : (
      Number.isFinite(parseRatioValue(options['target-ratio'])) && Number.isFinite(vdd)
        ? parseRatioValue(options['target-ratio']) * vdd
        : NaN
    );
  const targetRatio = Number.isFinite(targetThreshold) && Number.isFinite(vdd)
    ? targetThreshold / vdd
    : NaN;

  if (!binding) {
    return {
      tool: context.toolName,
      status: 'route-required',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      notes: [
        'draft route 已存在，但还没有匹配到 device/family binding。',
        '请先补 bindings，或重新执行 adapter derive。'
      ]
    };
  }

  if (!comparatorConfig.positiveSource) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['positive-source'],
      notes: [
        '当前 binding 缺少默认比较器正端输入源。',
        '请在 device/family binding 里补 default_positive_source 或 positive_sources。'
      ]
    };
  }

  if (!comparatorConfig.negativeSource) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['negative-source'],
      notes: [
        '当前 binding 缺少默认比较器负端输入源。',
        '请在 device/family binding 里补 default_negative_source 或 negative_sources。'
      ]
    };
  }

  if (!Number.isFinite(vdd)) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['vdd'],
      notes: [
        'comparator-threshold 首版实现已可运行，但仍需要明确供电电压 vdd。'
      ]
    };
  }

  if (!Number.isFinite(targetThreshold)) {
    return {
      tool: context.toolName,
      status: 'draft-adapter',
      implementation: 'external-adapter-draft',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      binding: {
        algorithm: binding.algorithm || '',
        params: binding.params || {}
      },
      missing_inputs: ['target-threshold-v or target-ratio'],
      notes: [
        'comparator-threshold 首版实现已可运行，但仍需要目标阈值或目标比例。'
      ]
    };
  }

  const positiveInfo = resolveComparatorSourceRange(
    comparatorConfig.positiveSource,
    positiveSources[comparatorConfig.positiveSource],
    vdd
  );
  const negativeInfo = resolveComparatorSourceRange(
    comparatorConfig.negativeSource,
    negativeSources[comparatorConfig.negativeSource],
    vdd
  );
  const notes = [];

  const positiveFeasible = Number.isFinite(positiveInfo.min_voltage) &&
    Number.isFinite(positiveInfo.max_voltage) &&
    targetThreshold >= positiveInfo.min_voltage &&
    targetThreshold <= positiveInfo.max_voltage;
  const negativeFeasible = Number.isFinite(negativeInfo.min_voltage) &&
    Number.isFinite(negativeInfo.max_voltage) &&
    targetThreshold >= negativeInfo.min_voltage &&
    targetThreshold <= negativeInfo.max_voltage;

  let recommendedReferenceSide = 'none';
  if (positiveFeasible || negativeFeasible) {
    const positivePriority = positiveFeasible ? comparatorSidePriority(positiveInfo) : -1;
    const negativePriority = negativeFeasible ? comparatorSidePriority(negativeInfo) : -1;
    if (positivePriority === negativePriority) {
      recommendedReferenceSide = positiveFeasible && negativeFeasible
        ? 'either'
        : (positiveFeasible ? 'positive' : 'negative');
    } else {
      recommendedReferenceSide = positivePriority > negativePriority ? 'positive' : 'negative';
    }
  }

  if (targetThreshold > vdd) {
    notes.push('目标阈值高于 vdd，不可能由当前供电范围实现。');
  }
  if (targetThreshold < 0) {
    notes.push('目标阈值小于 0V，不可能由当前比较器输入范围实现。');
  }
  if (!positiveFeasible && !negativeFeasible) {
    notes.push('当前正负输入源都无法覆盖目标阈值，请补更准确的内部参考范围或改比较极性。');
  } else if (recommendedReferenceSide === 'negative') {
    notes.push('建议把参考阈值放在负端，待测信号放正端。');
  } else if (recommendedReferenceSide === 'positive') {
    notes.push('建议把参考阈值放在正端，待测信号放负端。');
  } else if (recommendedReferenceSide === 'either') {
    notes.push('当前正负两侧都能覆盖目标阈值，需再结合输出极性和系统行为决定放置位置。');
  }

  return {
    tool: context.toolName,
    status: 'ok',
    implementation: 'external-adapter-draft',
    adapter_path: context.adapterPath,
    adapter_mode: 'generated-comparator-threshold',
    inputs: {
      raw_tokens: context.tokens || [],
      options
    },
    resolution: {
      family: resolved.family || '',
      device: resolved.device || '',
      binding_source: resolved.source || ''
    },
    binding: {
      algorithm: binding.algorithm || '',
      draft: binding.draft !== false,
      params: binding.params || {},
      evidence: binding.evidence || []
    },
    comparator: {
      vdd: Number(vdd.toFixed(9)),
      positive_source: comparatorConfig.positiveSource,
      negative_source: comparatorConfig.negativeSource,
      target_threshold_v: Number(targetThreshold.toFixed(9)),
      target_ratio: Number.isFinite(targetRatio) ? Number(targetRatio.toFixed(9)) : undefined
    },
    positive_source: {
      ...positiveInfo,
      threshold_feasible: positiveFeasible
    },
    negative_source: {
      ...negativeInfo,
      threshold_feasible: negativeFeasible
    },
    feasibility: {
      positive_reference_ok: positiveFeasible,
      negative_reference_ok: negativeFeasible,
      recommended_reference_side: recommendedReferenceSide
    },
    notes: [
      '这是 comparator-threshold 的首版通用可行性检查实现，基于输入源范围和目标阈值做判断。',
      '当前仍保留 draft route 标记；如果要量产使用，需继续补迟滞、offset、输入共模范围和输出极性边界。'
    ].concat(notes)
  };
}

module.exports = {
  runGeneratedTimerAdapter,
  runGeneratedPwmAdapter,
  runGeneratedAdcAdapter,
  runGeneratedComparatorAdapter
};
