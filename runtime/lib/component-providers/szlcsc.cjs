'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'https://ips.lcsc.com';
const DEFAULT_TIMEOUT_MS = 15000;

function parseEnvValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const equalIndex = normalized.indexOf('=');
    if (equalIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, equalIndex).trim();
    if (!key) {
      continue;
    }

    values[key] = parseEnvValue(normalized.slice(equalIndex + 1));
  }

  return values;
}

function buildEnvSource(options) {
  const projectRoot = options && options.projectRoot ? path.resolve(options.projectRoot) : '';
  const embAgentRoot = path.resolve(__dirname, '..', '..', '..');
  const merged = {
    ...readEnvFile(path.join(embAgentRoot, '.env'))
  };

  if (projectRoot) {
    Object.assign(merged, readEnvFile(path.join(projectRoot, '.env')));
  }

  Object.assign(merged, process.env);

  if (options && options.env) {
    Object.assign(merged, options.env);
  }

  return merged;
}

function normalizeBaseUrl(value) {
  const configured = String(value || '').trim().replace(/\/+$/, '');
  return configured || DEFAULT_BASE_URL;
}

function randomNonce() {
  return crypto.randomBytes(8).toString('hex');
}

function buildSignature(key, secret, nonce, timestamp) {
  return crypto
    .createHash('sha1')
    .update(`key=${key}&nonce=${nonce}&secret=${secret}&timestamp=${timestamp}`)
    .digest('hex');
}

function resolveCredentials(integration, options) {
  const envSource = buildEnvSource(options);
  const apiKeyEnv = String((integration && integration.api_key_env) || 'SZLCSC_API_KEY').trim() || 'SZLCSC_API_KEY';
  const apiSecretEnv =
    String((integration && integration.api_secret_env) || 'SZLCSC_API_SECRET').trim() || 'SZLCSC_API_SECRET';
  const apiKey = String(
    (integration && integration.api_key) ||
      envSource[apiKeyEnv] ||
      envSource.LCSC_API_KEY ||
      ''
  ).trim();
  const apiSecret = String(
    (integration && integration.api_secret) ||
      envSource[apiSecretEnv] ||
      envSource.LCSC_API_SECRET ||
      ''
  ).trim();

  return {
    apiKey,
    apiKeyEnv,
    apiSecret,
    apiSecretEnv
  };
}

function getFetchImpl(options) {
  if (options && typeof options.fetch === 'function') {
    return options.fetch;
  }
  if (typeof fetch === 'function') {
    return fetch;
  }
  throw new Error('Global fetch is unavailable; provide a fetch implementation');
}

function firstString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (values || [])
        .map(item => String(item || '').trim())
        .filter(Boolean)
    )
  );
}

function collectRecordArrays(payload) {
  if (Array.isArray(payload)) {
    return [payload];
  }
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const directKeys = ['result', 'data', 'records', 'rows', 'items', 'list', 'content'];
  const arrays = [];

  directKeys.forEach(key => {
    if (Array.isArray(payload[key])) {
      arrays.push(payload[key]);
    } else if (payload[key] && typeof payload[key] === 'object') {
      arrays.push(...collectRecordArrays(payload[key]));
    }
  });

  return arrays;
}

function normalizeProductMatch(record, context) {
  const lcscPartNumber = firstString(
    record.lcsc_part_number,
    record.productCode,
    record.product_code,
    record.productNo,
    record.product_no,
    record.sku
  );
  const mpn = firstString(
    record.mpn,
    record.productModel,
    record.product_model,
    record.mfrPart,
    record.mfr_part,
    record.manufacturerPartNumber,
    record.manufacturer_part_number
  );
  const manufacturer = firstString(
    record.manufacturer,
    record.brandName,
    record.brand_name,
    record.brand
  );
  const packageName = firstString(
    record.package,
    record.packageName,
    record.package_name,
    record.encapStandard,
    record.encap_standard,
    record.encapsulation
  );
  const description = firstString(
    record.description,
    record.productDescEn,
    record.product_desc_en,
    record.productDescCn,
    record.product_desc_cn,
    record.productName,
    record.product_name,
    record.title
  );
  const datasheet = firstString(
    record.datasheetUrl,
    record.datasheet_url,
    record.dataManualUrl,
    record.data_manual_url
  );
  const productUrl = firstString(
    record.productUrl,
    record.product_url,
    record.goodsUrl,
    record.goods_url,
    record.detailUrl,
    record.detail_url
  );
  const stock = record.stockNumber ?? record.stock_number ?? record.inStock ?? record.in_stock ?? null;
  const query = context && context.query ? String(context.query) : '';
  const matchType = context && context.match_type ? String(context.match_type) : '';
  const needle = query.toLowerCase();
  const exactNeedle = needle.replace(/[^a-z0-9]+/g, '');
  const exactMatch =
    exactNeedle &&
    [lcscPartNumber, mpn]
      .map(value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''))
      .some(value => value && value === exactNeedle);

  return {
    provider: 'szlcsc',
    query,
    match_type: matchType,
    exact_match: Boolean(exactMatch),
    lcsc_part_number: lcscPartNumber,
    mpn,
    manufacturer,
    package: packageName,
    description,
    datasheet,
    product_url: productUrl,
    stock,
    raw: record
  };
}

function extractSearchResults(payload, context) {
  const arrays = collectRecordArrays(payload);
  const records = arrays.length > 0 ? arrays[0] : [];
  return records.map(record => normalizeProductMatch(record, context));
}

async function requestJson(url, options) {
  const fetchImpl = getFetchImpl(options);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutMs = Number((options && options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        accept: 'application/json'
      },
      signal: controller ? controller.signal : undefined
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LCSC request failed (${response.status}): ${body || response.statusText}`);
    }

    return response.json();
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`LCSC request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function buildSearchPlan(component, integration) {
  const queryTerms = uniqueStrings(component && component.query_terms);
  const supplierQueries = uniqueStrings(
    (component && component.szlcsc_queries) || (component && component.lcsc_queries)
  );
  const fallbackMatchType = String((integration && integration.match_type) || 'fuzzy').trim().toLowerCase() || 'fuzzy';
  const plan = [];

  if (queryTerms[0]) {
    plan.push({
      query: queryTerms[0],
      match_type: 'exact'
    });
  }

  supplierQueries.forEach(query => {
    plan.push({
      query,
      match_type: query.includes(' ') ? fallbackMatchType : 'exact'
    });
  });

  queryTerms.slice(1).forEach(query => {
    plan.push({
      query,
      match_type: fallbackMatchType
    });
  });

  return uniqueStrings(plan.map(item => `${item.match_type}:${item.query}`)).map(entry => {
    const divider = entry.indexOf(':');
    return {
      match_type: entry.slice(0, divider),
      query: entry.slice(divider + 1)
    };
  });
}

async function searchProducts(search, integration, options) {
  const credentials = resolveCredentials(integration, options);
  if (!credentials.apiKey || !credentials.apiSecret) {
    throw new Error(
      `SZLCSC integration requires credentials. Set ${credentials.apiKeyEnv} and ${credentials.apiSecretEnv}, or write integrations.szlcsc.api_key/api_secret in project.json.`
    );
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomNonce();
  const signature = buildSignature(credentials.apiKey, credentials.apiSecret, nonce, timestamp);
  const params = new URLSearchParams({
    key: credentials.apiKey,
    nonce,
    timestamp,
    signature,
    keyword: search.query,
    search_type: search.match_type || 'exact',
    current_page: '1',
    page_size: String(Number((integration && integration.page_size) || 5) || 5)
  });

  if (integration && integration.only_available === true) {
    params.set('is_available', 'true');
  }

  const currency = String((integration && integration.currency) || '').trim();
  if (currency) {
    params.set('currency', currency);
  }

  const baseUrl = normalizeBaseUrl(integration && integration.base_url);
  const url = `${baseUrl}/rest/wmsc2agent/search/product?${params.toString()}`;
  const payload = await requestJson(url, {
    ...options,
    timeoutMs: Number((integration && integration.timeout_ms) || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  });

  if (payload && payload.success === false) {
    throw new Error(payload.message || payload.msg || 'LCSC request failed');
  }

  if (
    payload &&
    payload.code !== undefined &&
    Number(payload.code) !== 0 &&
    Number(payload.code) !== 200
  ) {
    throw new Error(payload.message || payload.msg || `LCSC request failed with code ${payload.code}`);
  }

  return {
    url,
    results: extractSearchResults(payload, search)
  };
}

async function lookupComponents(components, options) {
  const integration = options && options.integration ? options.integration : {};
  const normalizedComponents = Array.isArray(components) ? components : [];
  const maxMatchesPerComponent = Number((integration && integration.max_matches_per_component) || 5) || 5;
  const enriched = [];

  for (const component of normalizedComponents) {
    const plan = buildSearchPlan(component, integration);
    const supplierMatches = [];
    const seen = new Set();
    const providerQueries = [];

    for (const search of plan) {
      if (supplierMatches.length >= maxMatchesPerComponent) {
        break;
      }

      const { url, results } = await searchProducts(search, integration, options);
      providerQueries.push({
        provider: 'szlcsc',
        query: search.query,
        match_type: search.match_type,
        request_url: url,
        result_count: results.length
      });

      results.forEach(match => {
        const dedupeKey = [
          match.lcsc_part_number,
          match.mpn,
          match.package
        ].join('::').toLowerCase();
        if (!dedupeKey || seen.has(dedupeKey)) {
          return;
        }
        seen.add(dedupeKey);
        supplierMatches.push(match);
      });
    }

    enriched.push({
      ...component,
      provider_queries: providerQueries,
      supplier_matches: supplierMatches.slice(0, maxMatchesPerComponent)
    });
  }

  const credentials = resolveCredentials(integration, options);
  return {
    provider: 'szlcsc',
    integration: {
      enabled: integration && integration.enabled === true,
      base_url: normalizeBaseUrl(integration && integration.base_url),
      api_key_env: credentials.apiKeyEnv,
      api_secret_env: credentials.apiSecretEnv
    },
    components: enriched
  };
}

module.exports = {
  buildSignature,
  lookupComponents,
  searchProducts
};
