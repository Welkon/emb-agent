'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_AGENT_BASE_URL = 'https://mineru.net/api/v1/agent';
const DEFAULT_API_BASE_URL = 'https://mineru.net/api/v4';

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

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

  const values = {};
  const content = fs.readFileSync(filePath, 'utf8');

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
  const codexRoot = path.resolve(__dirname, '..', '..', '..');
  const merged = {
    ...readEnvFile(path.join(codexRoot, '.env'))
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

function inferModeFromBaseUrl(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/$/, '').toLowerCase();
  if (!normalized) {
    return '';
  }
  if (/\/api\/v\d+\/agent$/.test(normalized)) {
    return 'agent';
  }
  if (/\/api\/v\d+$/.test(normalized)) {
    return 'api';
  }
  return '';
}

function hasApiCredential(integration, options) {
  const explicit = String((integration && integration.api_key) || '').trim();
  if (explicit) {
    return true;
  }

  const envName = String((integration && integration.api_key_env) || 'MINERU_API_KEY').trim() || 'MINERU_API_KEY';
  const envSource = buildEnvSource(options);
  return Boolean(String((envSource && envSource[envName]) || '').trim());
}

function parseRequestedPageCount(pages) {
  const text = String(pages || '').trim();
  if (!text) {
    return 0;
  }

  let count = 0;
  for (const part of text.split(',')) {
    const segment = part.trim();
    if (!segment) {
      continue;
    }

    if (/^\d+$/.test(segment)) {
      count += 1;
      continue;
    }

    const rangeMatch = segment.match(/^(\d+)-(\d+)$/);
    if (!rangeMatch) {
      return 0;
    }

    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (end < start) {
      return 0;
    }

    count += end - start + 1;
  }

  return count;
}

function readFileSizeBytes(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return 0;
  }

  try {
    return fs.statSync(filePath).size;
  } catch (_) {
    return 0;
  }
}

function shouldPreferApiForRequest(request, integration) {
  const pageThreshold = Number((integration && integration.auto_api_page_threshold) || 12);
  const fileSizeThresholdKb = Number((integration && integration.auto_api_file_size_kb) || 4096);
  const requestedPageCount = parseRequestedPageCount(request && request.pages);
  const fileSizeBytes = readFileSizeBytes(request && request.file_path);

  return (
    requestedPageCount >= pageThreshold ||
    fileSizeBytes >= fileSizeThresholdKb * 1024
  );
}

function resolveMineruMode(request, integration, options) {
  const explicitMode = String((integration && integration.mode) || 'auto').trim().toLowerCase();
  const inferredFromBaseUrl = inferModeFromBaseUrl(integration && integration.base_url);

  if (inferredFromBaseUrl) {
    return inferredFromBaseUrl;
  }
  if (explicitMode === 'agent' || explicitMode === 'api') {
    return explicitMode;
  }

  if (shouldPreferApiForRequest(request, integration) && hasApiCredential(integration, options)) {
    return 'api';
  }

  return 'agent';
}

function resolveBaseUrlForMode(integration, route) {
  const configured = String((integration && integration.base_url) || '').trim().replace(/\/$/, '');
  const explicitMode = String((integration && integration.mode) || 'auto').trim().toLowerCase();
  const inferredFromBaseUrl = inferModeFromBaseUrl(configured);

  if (configured && (inferredFromBaseUrl === route || (!inferredFromBaseUrl && explicitMode === route))) {
    return configured;
  }

  return route === 'api' ? DEFAULT_API_BASE_URL : DEFAULT_AGENT_BASE_URL;
}

async function requestJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MinerU request failed (${response.status}): ${body || response.statusText}`);
  }
  return response.json();
}

async function requestText(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MinerU content fetch failed (${response.status}): ${body || response.statusText}`);
  }
  return response.text();
}

async function requestBuffer(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MinerU binary fetch failed (${response.status}): ${body || response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function uploadFile(fetchImpl, uploadUrl, filePath) {
  const response = await fetchImpl(uploadUrl, {
    method: 'PUT',
    body: fs.readFileSync(filePath)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MinerU upload failed (${response.status}): ${body || response.statusText}`);
  }
}

function normalizeAgentDonePayload(payload) {
  return payload && payload.full_md_url ? payload : null;
}

async function pollAgentTask(fetchImpl, baseUrl, taskId, timeoutMs, pollIntervalMs) {
  const startedAt = Date.now();

  while (true) {
    const payload = await requestJson(fetchImpl, `${baseUrl}/parse/${taskId}`, {
      method: 'GET'
    });

    const state = String(payload.state || '').toLowerCase();
    if (state === 'done') {
      return payload;
    }
    if (state === 'error' || state === 'failed') {
      throw new Error(payload.err_msg || payload.message || `MinerU task failed: ${taskId}`);
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`MinerU task timed out: ${taskId}`);
    }

    sleepMs(pollIntervalMs);
  }
}

function resolveApiKey(integration, options) {
  const explicit = String((integration && integration.api_key) || '').trim();
  if (explicit) {
    return explicit;
  }

  const envName = String((integration && integration.api_key_env) || 'MINERU_API_KEY').trim() || 'MINERU_API_KEY';
  const envSource = buildEnvSource(options);
  const fromEnv = String((envSource && envSource[envName]) || '').trim();
  if (fromEnv) {
    return fromEnv;
  }

  throw new Error(`MinerU API key missing. Set integrations.mineru.api_key or env ${envName}`);
}

function buildApiHeaders(integration, options) {
  return {
    Authorization: `Bearer ${resolveApiKey(integration, options)}`
  };
}

function normalizeApiCreateResponse(payload) {
  const data = (payload && payload.data) || payload || {};
  const batchId = String(data.batch_id || data.id || '').trim();
  const fileUrls = Array.isArray(data.file_urls)
    ? data.file_urls
    : Array.isArray(data.files)
      ? data.files
      : [];
  const first = fileUrls[0] || data.file_url || {};
  const firstValue = typeof first === 'string' ? first : '';
  const uploadUrl = String(firstValue || first.upload_url || first.url || '').trim();
  const fileId = String(
    (typeof first === 'object' && first !== null && (first.file_id || first.file_key || first.name)) || ''
  ).trim();

  if (!batchId || !uploadUrl) {
    throw new Error('MinerU API did not return batch_id/upload_url');
  }

  return {
    batch_id: batchId,
    upload_url: uploadUrl,
    file_id: fileId,
    raw: payload
  };
}

function pickApiResultItem(payload) {
  const data = (payload && payload.data) || payload || {};
  const candidates = [];

  if (Array.isArray(data.extract_result)) candidates.push(...data.extract_result);
  if (Array.isArray(data.results)) candidates.push(...data.results);
  if (Array.isArray(data.file_results)) candidates.push(...data.file_results);
  if (data.extract_result && !Array.isArray(data.extract_result)) candidates.push(data.extract_result);
  if (data.result && !Array.isArray(data.result)) candidates.push(data.result);

  if (candidates.length > 0) {
    return candidates[0];
  }

  return data;
}

function isApiDoneState(state) {
  return ['done', 'success', 'completed', 'finish', 'finished'].includes(state);
}

function isApiFailedState(state) {
  return ['error', 'failed', 'fail'].includes(state);
}

async function pollApiBatch(fetchImpl, baseUrl, batchId, headers, timeoutMs, pollIntervalMs) {
  const startedAt = Date.now();

  while (true) {
    const payload = await requestJson(fetchImpl, `${baseUrl}/extract-results/batch/${batchId}`, {
      method: 'GET',
      headers
    });

    const item = pickApiResultItem(payload);
    const state = String((item && item.state) || '').trim().toLowerCase();

    if (isApiDoneState(state) && String(item.full_zip_url || item.fullZipUrl || '').trim()) {
      return {
        batch_id: batchId,
        result: item,
        raw: payload
      };
    }

    if (isApiFailedState(state)) {
      throw new Error(item.err_msg || item.message || `MinerU API batch failed: ${batchId}`);
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`MinerU API batch timed out: ${batchId}`);
    }

    sleepMs(pollIntervalMs);
  }
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  return -1;
}

function extractZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset === -1) {
    throw new Error('MinerU zip result is invalid: EOCD not found');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralDirOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('MinerU zip result is invalid: central directory header missing');
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer
      .slice(offset + 46, offset + 46 + fileNameLength)
      .toString('utf8');

    entries.push({
      file_name: fileName,
      compression_method: compressionMethod,
      compressed_size: compressedSize,
      uncompressed_size: uncompressedSize,
      local_header_offset: localHeaderOffset
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer, entry) {
  const offset = entry.local_header_offset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`MinerU zip result is invalid: local header missing for ${entry.file_name}`);
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.slice(dataStart, dataStart + entry.compressed_size);

  if (entry.compression_method === 0) {
    return compressed;
  }
  if (entry.compression_method === 8) {
    return zlib.inflateRawSync(compressed);
  }

  throw new Error(`MinerU zip compression not supported: ${entry.compression_method}`);
}

function extractMarkdownFromZip(buffer) {
  const entries = extractZipEntries(buffer);
  const markdownEntry =
    entries.find(item => /(^|\/)full\.md$/i.test(item.file_name)) ||
    entries.find(item => /\.md$/i.test(item.file_name));

  if (!markdownEntry) {
    throw new Error('MinerU zip result missing markdown file');
  }

  return readZipEntry(buffer, markdownEntry).toString('utf8');
}

async function parseDocumentAgent(request, integration, options) {
  const fetchImpl = (options && options.fetchImpl) || global.fetch;
  const baseUrl = resolveBaseUrlForMode(integration, 'agent');
  const createPayload = {
    file_name: request.file_name,
    language: request.language || integration.language || 'ch',
    page_range: request.pages || '',
    enable_table:
      request.enable_table === undefined ? Boolean(integration.enable_table) : Boolean(request.enable_table),
    is_ocr: request.ocr === undefined ? Boolean(integration.is_ocr) : Boolean(request.ocr),
    enable_formula:
      request.enable_formula === undefined
        ? Boolean(integration.enable_formula)
        : Boolean(request.enable_formula)
  };

  const created = await requestJson(fetchImpl, `${baseUrl}/parse/file`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(createPayload)
  });

  if (!created.task_id || !created.file_url) {
    throw new Error('MinerU did not return task_id/file_url');
  }

  await uploadFile(fetchImpl, created.file_url, request.file_path);

  const completed = normalizeAgentDonePayload(
    await pollAgentTask(
      fetchImpl,
      baseUrl,
      created.task_id,
      integration.timeout_ms || 300000,
      integration.poll_interval_ms || 3000
    )
  );

  if (!completed || !completed.full_md_url) {
    throw new Error('MinerU result missing full_md_url');
  }

  const markdown = await requestText(fetchImpl, completed.full_md_url, { method: 'GET' });

  return {
    provider: 'mineru',
    mode: 'agent',
    task_id: created.task_id,
    markdown,
    metadata: {
      created,
      completed
    }
  };
}

async function parseDocumentApi(request, integration, options) {
  const fetchImpl = (options && options.fetchImpl) || global.fetch;
  const baseUrl = resolveBaseUrlForMode(integration, 'api');
  const headers = buildApiHeaders(integration, options);
  const created = normalizeApiCreateResponse(
    await requestJson(fetchImpl, `${baseUrl}/file-urls/batch`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        enable_formula: Boolean(
          request.enable_formula === undefined ? integration.enable_formula : request.enable_formula
        ),
        language: request.language || integration.language || 'ch',
        enable_table: Boolean(
          request.enable_table === undefined ? integration.enable_table : request.enable_table
        ),
        model_version: String(integration.model_version || 'vlm'),
        files: [
          {
            name: request.file_name,
            is_ocr: request.ocr === undefined ? Boolean(integration.is_ocr) : Boolean(request.ocr),
            page_ranges: request.pages || ''
          }
        ]
      })
    })
  );

  await uploadFile(fetchImpl, created.upload_url, request.file_path);

  const completed = await pollApiBatch(
    fetchImpl,
    baseUrl,
    created.batch_id,
    headers,
    integration.timeout_ms || 300000,
    integration.poll_interval_ms || 3000
  );

  const zipUrl = String(completed.result.full_zip_url || completed.result.fullZipUrl || '').trim();
  if (!zipUrl) {
    throw new Error('MinerU API result missing full_zip_url');
  }

  const markdown = extractMarkdownFromZip(await requestBuffer(fetchImpl, zipUrl, { method: 'GET' }));

  return {
    provider: 'mineru',
    mode: 'api',
    task_id: completed.batch_id,
    markdown,
    metadata: {
      created: created.raw,
      completed: completed.raw
    }
  };
}

async function parseDocument(request, integration, options) {
  const fetchImpl = (options && options.fetchImpl) || global.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is required for MinerU provider');
  }

  if (resolveMineruMode(request, integration, options) === 'api') {
    return parseDocumentApi(request, integration, options);
  }

  return parseDocumentAgent(request, integration, options);
}

module.exports = {
  extractMarkdownFromZip,
  parseDocument
};
