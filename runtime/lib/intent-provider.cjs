'use strict';

const toolCatalog = require('./tool-catalog.cjs');
const intentAnalyzer = require('./intent-analyzer.cjs');

function normalizeIntentRouterConfig(projectConfig) {
  const integrations =
    projectConfig && projectConfig.integrations && typeof projectConfig.integrations === 'object'
      ? projectConfig.integrations
      : {};
  const source =
    integrations.intent_router && typeof integrations.intent_router === 'object' && !Array.isArray(integrations.intent_router)
      ? integrations.intent_router
      : {};
  const mode = String(source.mode || 'agent').trim().toLowerCase() || 'agent';
  const normalizedMode = mode === 'local' ? 'local' : 'agent';
  const provider = String(
    source.provider ||
    (normalizedMode === 'agent' ? 'embedded-agent' : 'local-rules')
  ).trim() || (normalizedMode === 'agent' ? 'embedded-agent' : 'local-rules');

  return {
    enabled: source.enabled !== false,
    mode: normalizedMode,
    provider
  };
}

function createIntentProviderHelpers(deps) {
  const {
    ROOT
  } = deps;
  const toolIntentProfileCache = new Map();

  function loadToolIntentProfile(toolName) {
    const key = String(toolName || '').trim();
    if (!key) {
      return null;
    }

    if (toolIntentProfileCache.has(key)) {
      return toolIntentProfileCache.get(key);
    }

    let profile = null;
    try {
      const spec = toolCatalog.loadToolSpec(ROOT, key);
      profile = spec && spec.intent_profile ? spec.intent_profile : null;
    } catch {
      profile = null;
    }

    toolIntentProfileCache.set(key, profile);
    return profile;
  }

  function analyzeIntentSelection(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const projectConfig = settings.projectConfig || {};
    const router = normalizeIntentRouterConfig(projectConfig);
    const texts = Array.isArray(settings.texts) ? settings.texts : [];
    const toolRecommendations = Array.isArray(settings.toolRecommendations) ? settings.toolRecommendations : [];
    const structuredIntent = intentAnalyzer.analyzeStructuredIntent(texts);
    const ranked = toolRecommendations
      .map((item, index) => {
        const intentProfile = loadToolIntentProfile(item && item.tool ? item.tool : '');
        const scoreBreakdown = intentProfile
          ? intentAnalyzer.scoreIntentProfile(structuredIntent, intentProfile)
          : {
              score: 0,
              domain_hits: 0,
              action_hits: 0,
              target_hits: 0,
              keyword_hits: 0,
              anti_keyword_hits: 0,
              signal_hits: 0,
              anchor_hits: 0
            };

        return {
          item,
          index,
          intent_profile: intentProfile,
          intent_score: scoreBreakdown.score,
          score_breakdown: scoreBreakdown
        };
      })
      .sort((left, right) => right.intent_score - left.intent_score || left.index - right.index);

    return {
      router,
      structured_intent: structuredIntent,
      ranked
    };
  }

  return {
    analyzeIntentSelection,
    normalizeIntentRouterConfig
  };
}

module.exports = {
  createIntentProviderHelpers,
  normalizeIntentRouterConfig
};
