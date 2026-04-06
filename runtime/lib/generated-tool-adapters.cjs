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

module.exports = {
  runGeneratedTimerAdapter
};
