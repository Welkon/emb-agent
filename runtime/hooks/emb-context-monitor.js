#!/usr/bin/env node
// emb-hook-version: {{EMB_VERSION}}

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const hookDispatchHelpers = require('../lib/hook-dispatch.cjs');
const hookTrustHelpers = require('../lib/hook-trust.cjs');
const runtimeHostHelpers = require('../lib/runtime-host.cjs');

const DEBOUNCE_CALLS = 5;
const WARNING_REMAINING_PERCENT = 35;
const CRITICAL_REMAINING_PERCENT = 25;
const METRICS_STALE_MS = 60 * 1000;
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);
const hookDispatch = hookDispatchHelpers.createHookDispatchHelpers({
  fs,
  path,
  process,
  runtimeHost: RUNTIME_HOST
});

function getWarnPath(projectRoot) {
  const key = crypto.createHash('sha1').update(projectRoot).digest('hex');
  return path.join(os.tmpdir(), `emb-agent-ctx-${key}.json`);
}

function getBridgePath(projectRoot) {
  const key = crypto.createHash('sha1').update(projectRoot).digest('hex');
  return path.join(os.tmpdir(), `emb-agent-ctx-${key}.bridge.json`);
}

function parseContextMetrics(data) {
  const source = data || {};
  const remaining =
    Number(source.context_window && source.context_window.remaining_percentage) ||
    Number(source.remaining_percentage) ||
    0;

  if (Number.isFinite(remaining) && remaining > 0) {
    const used = Math.max(0, Math.min(100, Math.round(100 - remaining)));
    return { remaining, used };
  }

  const totalTokens =
    Number(
      source.info &&
      source.info.total_token_usage &&
      source.info.total_token_usage.total_tokens
    ) ||
    Number(
      source.total_token_usage &&
      source.total_token_usage.total_tokens
    ) ||
    0;

  const contextWindow =
    Number(source.model_context_window) ||
    Number(source.context_window && source.context_window.max_tokens) ||
    0;

  if (!Number.isFinite(totalTokens) || !Number.isFinite(contextWindow) || totalTokens <= 0 || contextWindow <= 0) {
    return null;
  }

  const used = Math.max(0, Math.min(100, Math.round((totalTokens / contextWindow) * 100)));
  return {
    remaining: Math.max(0, 100 - used),
    used
  };
}

function readBridge(projectRoot) {
  const bridgePath = getBridgePath(projectRoot);
  if (!fs.existsSync(bridgePath)) {
    return null;
  }

  try {
    const metrics = JSON.parse(fs.readFileSync(bridgePath, 'utf8'));
    if (!metrics || !metrics.timestamp || Date.now() - metrics.timestamp > METRICS_STALE_MS) {
      return null;
    }
    return metrics;
  } catch {
    return null;
  }
}

function writeBridge(projectRoot, metrics) {
  const bridgePath = getBridgePath(projectRoot);
  const payload = {
    remaining: metrics.remaining,
    used: metrics.used,
    timestamp: Date.now()
  };
  fs.writeFileSync(bridgePath, JSON.stringify(payload), 'utf8');
  return payload;
}

function buildMetricsMessage(metrics, contextHygiene) {
  if (!metrics || !Number.isFinite(metrics.remaining)) {
    return '';
  }

  if (metrics.remaining > WARNING_REMAINING_PERCENT) {
    return '';
  }

  const isCritical = metrics.remaining <= CRITICAL_REMAINING_PERCENT;
  const prefix = isCritical ? 'EMB CONTEXT CRITICAL:' : 'EMB CONTEXT WARNING:';
  const pauseCli = contextHygiene && contextHygiene.pause_cli
    ? contextHygiene.pause_cli
    : runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['pause']);
  const resumeChain = contextHygiene && contextHygiene.clear_hint
    ? contextHygiene.clear_hint
    : 'pause -> clear -> resume';
  const reasons = contextHygiene && Array.isArray(contextHygiene.reasons) && contextHygiene.reasons.length > 0
    ? ` Signals: ${contextHygiene.reasons.join('; ')}.`
    : '';

  if (isCritical) {
    return `${prefix} Context window remaining=${Math.round(metrics.remaining)}%. Stop expanding scope. Run ${pauseCli} now, close the smallest pending unit, then follow ${resumeChain}.${reasons}`;
  }

  return `${prefix} Context window remaining=${Math.round(metrics.remaining)}%. Prepare to close scope before deeper exploration. Prefer pause first, then follow ${resumeChain}.${reasons}`;
}

function buildSessionMessage(contextHygiene) {
  if (!contextHygiene || contextHygiene.level === 'stable') {
    return '';
  }

  const prefix = contextHygiene.level === 'suggest-clearing'
    ? 'EMB CONTEXT WARNING:'
    : 'EMB CONTEXT NOTICE:';
  const reasons = Array.isArray(contextHygiene.reasons) && contextHygiene.reasons.length > 0
    ? ` Reasons: ${contextHygiene.reasons.join('; ')}.`
    : '';

  return `${prefix} ${contextHygiene.recommendation}${reasons} Next chain: ${contextHygiene.clear_hint}.`;
}

function severityRank(level) {
  const ranks = {
    stable: 0,
    'consider-clearing': 1,
    'suggest-clearing': 2,
    warning: 3,
    critical: 4
  };
  return ranks[level] || 0;
}

function shouldEmit(projectRoot, level) {
  const warnPath = getWarnPath(projectRoot);
  let warnData = { callsSinceWarn: 0, lastLevel: 'stable' };
  let firstWarn = true;

  if (fs.existsSync(warnPath)) {
    try {
      warnData = JSON.parse(fs.readFileSync(warnPath, 'utf8'));
      firstWarn = false;
    } catch {
      warnData = { callsSinceWarn: 0, lastLevel: 'stable' };
    }
  }

  warnData.callsSinceWarn = (warnData.callsSinceWarn || 0) + 1;
  const severityEscalated = severityRank(level) > severityRank(warnData.lastLevel);

  if (!firstWarn && warnData.callsSinceWarn < DEBOUNCE_CALLS && !severityEscalated) {
    fs.writeFileSync(warnPath, JSON.stringify(warnData), 'utf8');
    return false;
  }

  warnData.callsSinceWarn = 0;
  warnData.lastLevel = level;
  fs.writeFileSync(warnPath, JSON.stringify(warnData), 'utf8');
  return true;
}

function runHook(rawInput) {
  return hookDispatch.runHookWithProjectContext(rawInput, ({ data, projectRoot }) => {
    const cli = require(path.join(__dirname, '..', 'bin', 'emb-agent.cjs'));
    const status = cli.buildStatus();
    const contextHygiene = status.context_hygiene;
    const liveMetrics = parseContextMetrics(data);
    const bridgeMetrics = liveMetrics ? writeBridge(projectRoot, liveMetrics) : readBridge(projectRoot);
    const metricsMessage = buildMetricsMessage(bridgeMetrics, contextHygiene);
    const sessionMessage = buildSessionMessage(contextHygiene);
    const message = metricsMessage || sessionMessage;

    if (!message) {
      return '';
    }

    let level = contextHygiene && contextHygiene.level ? contextHygiene.level : 'stable';
    if (bridgeMetrics && bridgeMetrics.remaining <= CRITICAL_REMAINING_PERCENT) {
      level = 'critical';
    } else if (bridgeMetrics && bridgeMetrics.remaining <= WARNING_REMAINING_PERCENT) {
      level = 'warning';
    }

    if (!shouldEmit(projectRoot, level)) {
      return '';
    }

    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: data.hook_event_name || data.event || 'PostToolUse',
        additionalContext: message
      }
    });
  });
}

if (require.main === module) {
  hookDispatch.runHookCli(runHook);
}

module.exports = {
  buildMetricsMessage,
  buildSessionMessage,
  getBridgePath,
  hookDispatch,
  parseContextMetrics,
  readBridge,
  hookTrustHelpers,
  runHook,
  shouldEmit,
  writeBridge
};
