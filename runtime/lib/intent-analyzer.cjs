'use strict';

function normalizeIntentText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9.%+/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean).map(item => String(item).trim()).filter(Boolean))];
}

function includesIntentKeyword(haystack, keyword) {
  const normalizedHaystack = normalizeIntentText(haystack);
  const normalizedKeyword = normalizeIntentText(keyword);
  return Boolean(normalizedHaystack && normalizedKeyword && normalizedHaystack.includes(normalizedKeyword));
}

const DOMAIN_ALIASES = {
  adc: ['adc', 'sample voltage', 'analog input'],
  pwm: ['pwm'],
  lpwmg: ['lpwmg', 'long period pwm', 'low frequency pwm'],
  timer: ['timer', 'tick', 'periodic interrupt'],
  comparator: ['comparator', 'cmp'],
  lvdc: ['lvdc', 'brownout', 'low voltage detect', 'undervoltage'],
  charger: ['charger', 'charging', 'charge current']
};

const ACTION_ALIASES = {
  measure: ['measure', 'sampling', 'sample', 'sense'],
  convert: ['convert', 'scale', 'decode'],
  calculate: ['calculate', 'calc', 'solve', 'search'],
  generate: ['generate', 'output', 'drive', 'bring up'],
  schedule: ['schedule', 'delay', 'timeout', 'periodic'],
  threshold: ['threshold', 'trip'],
  detect: ['detect', 'monitor', 'watch'],
  configure: ['configure', 'config', 'set'],
  decode: ['decode', 'interpret']
};

const TARGET_ALIASES = {
  voltage: ['voltage', 'vdd', 'vref'],
  reference: ['reference', 'vref', 'vdd', 'ldo'],
  code: ['sample code', 'adc code', 'raw code', 'code'],
  frequency: ['frequency', 'hz', 'khz'],
  duty: ['duty', '%'],
  period: ['period', 'us', 'ms'],
  delay: ['delay', 'timeout'],
  interrupt: ['interrupt', 'tick'],
  threshold: ['threshold', 'bandgap'],
  current: ['current', 'ma'],
  status: ['status', 'flag', 'bit'],
  battery: ['battery']
};

function collectMatches(haystack, aliasMap) {
  return uniqueStrings(
    Object.entries(aliasMap)
      .filter(([, patterns]) => patterns.some(pattern => includesIntentKeyword(haystack, pattern)))
      .map(([key]) => key)
  );
}

function collectPins(text) {
  return uniqueStrings((String(text || '').match(/\b(?:p[ab]\d{1,2}|r[ab]\d{1,2})\b/gi) || []).map(item => item.toLowerCase()));
}

function collectChannels(text) {
  return uniqueStrings(
    (String(text || '').match(/\b(?:an\d{1,2}|bg1\.2|lpwmg\d+|pwm\d(?:-[a-z]\d+)?)\b/gi) || []).map(item => item.toLowerCase())
  );
}

function collectReferenceHints(haystack) {
  return uniqueStrings(
    ['vdd', 'vref', 'ldo2.0', 'ldo2.4', 'ldo3.0'].filter(item => includesIntentKeyword(haystack, item))
  );
}

function extractSignals(haystack, domains, pins, channels, references) {
  const signals = [];
  const hasExactFrequencyTarget = /\b\d+(?:\.\d+)?\s*(?:k?hz|khz)\b/i.test(haystack);
  const hasExactDutyTarget = /\b\d+(?:\.\d+)?\s*%/.test(haystack);
  const hasVoltageTarget =
    /\b\d+(?:\.\d+)?\s*v\b/i.test(haystack) ||
    includesIntentKeyword(haystack, 'target voltage') ||
    includesIntentKeyword(haystack, 'sample voltage') ||
    includesIntentKeyword(haystack, 'threshold voltage');
  const hasSampleCode =
    includesIntentKeyword(haystack, 'sample code') ||
    includesIntentKeyword(haystack, 'adc code') ||
    includesIntentKeyword(haystack, 'raw code');
  const hasStatusBits =
    includesIntentKeyword(haystack, 'status bit') ||
    includesIntentKeyword(haystack, 'status bits') ||
    includesIntentKeyword(haystack, 'status flag');

  if (hasExactFrequencyTarget) {
    signals.push('exact-frequency-target');
  }
  if (hasExactDutyTarget) {
    signals.push('exact-duty-target');
  }
  if (hasExactFrequencyTarget && hasExactDutyTarget && domains.includes('pwm')) {
    signals.push('exact-pwm-target');
  }
  if (hasVoltageTarget) {
    signals.push('target-voltage');
  }
  if (hasSampleCode) {
    signals.push('sample-code');
  }
  if (references.length > 0 || includesIntentKeyword(haystack, 'reference') || includesIntentKeyword(haystack, 'vref')) {
    signals.push('reference-voltage');
  }
  if (pins.length > 0) {
    signals.push('pin-anchor');
  }
  if (channels.length > 0) {
    signals.push('channel-anchor');
  }
  if (hasStatusBits) {
    signals.push('status-bits');
  }

  return uniqueStrings(signals);
}

function buildIntentSummary(domains, actions, targets, signals) {
  return uniqueStrings([
    domains.length > 0 ? `domains=${domains.join(',')}` : '',
    actions.length > 0 ? `actions=${actions.join(',')}` : '',
    targets.length > 0 ? `targets=${targets.join(',')}` : '',
    signals.length > 0 ? `signals=${signals.join(',')}` : ''
  ]).join(' | ');
}

function analyzeStructuredIntent(texts) {
  const sourceTexts = uniqueStrings(texts);
  const joinedText = sourceTexts.join(' ');
  const haystack = normalizeIntentText(joinedText);
  const domains = collectMatches(haystack, DOMAIN_ALIASES);
  const actions = collectMatches(haystack, ACTION_ALIASES);
  const targets = collectMatches(haystack, TARGET_ALIASES);
  const pins = collectPins(joinedText);
  const channels = collectChannels(joinedText);
  const references = collectReferenceHints(haystack);
  const signals = extractSignals(haystack, domains, pins, channels, references);

  return {
    haystack,
    source_texts: sourceTexts,
    domains,
    actions,
    targets,
    pins,
    channels,
    references,
    signals,
    summary: buildIntentSummary(domains, actions, targets, signals)
  };
}

function intersectionCount(left, right) {
  const leftSet = new Set(uniqueStrings(left).map(item => normalizeIntentText(item)));
  return uniqueStrings(right)
    .map(item => normalizeIntentText(item))
    .filter(item => leftSet.has(item))
    .length;
}

function countKeywordMatches(haystack, keywords) {
  return uniqueStrings(keywords).filter(keyword => includesIntentKeyword(haystack, keyword)).length;
}

function scoreIntentProfile(intent, intentProfile) {
  const profile = intentProfile && typeof intentProfile === 'object' ? intentProfile : {};
  const domainHits = intersectionCount(intent.domains, profile.domains || []);
  const actionHits = intersectionCount(intent.actions, profile.actions || []);
  const targetHits = intersectionCount(intent.targets, profile.targets || []);
  const keywordHits = countKeywordMatches(intent.haystack, profile.keywords || []);
  const antiKeywordHits = countKeywordMatches(intent.haystack, profile.anti_keywords || []);
  const signalHits = intersectionCount(intent.signals, profile.preference_signals || []);
  const anchorPreferences = uniqueStrings(profile.anchor_preferences || []);
  const anchorHits =
    (anchorPreferences.includes('pin') && intent.pins.length > 0 ? 1 : 0) +
    (anchorPreferences.includes('channel') && intent.channels.length > 0 ? 1 : 0) +
    (anchorPreferences.includes('reference') && intent.references.length > 0 ? 1 : 0);

  return {
    score:
      (domainHits * 36) +
      (actionHits * 20) +
      (targetHits * 18) +
      (keywordHits * 8) +
      (signalHits * 12) +
      (anchorHits * 6) -
      (antiKeywordHits * 14),
    domain_hits: domainHits,
    action_hits: actionHits,
    target_hits: targetHits,
    keyword_hits: keywordHits,
    anti_keyword_hits: antiKeywordHits,
    signal_hits: signalHits,
    anchor_hits: anchorHits
  };
}

module.exports = {
  analyzeStructuredIntent,
  normalizeIntentText,
  scoreIntentProfile
};
