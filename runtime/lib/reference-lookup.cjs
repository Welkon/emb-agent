'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage'
]);
const DOC_EXTS = new Set(['.pdf', '.md', '.txt', '.doc', '.docx', '.csv', '.xls', '.xlsx']);
const LCEDA_SEARCH_API = 'https://pro.lceda.cn/api/szlcsc/eda/product/list';
const GENERIC_COMPONENT_VALUES = new Set([
  'r',
  'c',
  'd',
  'q',
  'u',
  'led',
  'testpoint'
]);

function parseBooleanFlag(token, result, key) {
  if (token === key) {
    result.explicit_confirmation = true;
    return true;
  }
  return false;
}

function parseCommonLookupArgs(argv, defaults) {
  const result = {
    project: '',
    limit: 10,
    ...defaults
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--project') {
      result.project = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--file' || token === '--from-schematic') {
      result.file = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--parsed') {
      result.parsed = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--ref') {
      result.ref = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--limit') {
      const rawLimit = argv[index + 1] || '';
      index += 1;
      if (!/^\d+$/.test(rawLimit) || Number(rawLimit) <= 0) {
        throw new Error('limit must be a positive integer');
      }
      result.limit = Number(rawLimit);
      continue;
    }
    if (parseBooleanFlag(token, result, '--confirm')) {
      continue;
    }
    return { result, index, handled: false };
  }

  return { result, index: argv.length, handled: true };
}

function parseDocLookupArgs(argv) {
  const state = parseCommonLookupArgs(argv || [], {
    chip: '',
    keyword: '',
    vendor: '',
    package: '',
    provider: 'local',
    help: false,
    explicit_confirmation: false
  });
  const result = state.result;
  if (!state.handled) {
    for (let index = state.index; index < (argv || []).length; index += 1) {
      const token = argv[index];
      if (token === '--project') {
        result.project = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--file' || token === '--from-schematic') {
        result.file = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--parsed') {
        result.parsed = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--ref') {
        result.ref = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--limit') {
        const rawLimit = argv[index + 1] || '';
        index += 1;
        if (!/^\d+$/.test(rawLimit) || Number(rawLimit) <= 0) {
          throw new Error('limit must be a positive integer');
        }
        result.limit = Number(rawLimit);
        continue;
      }
      if (token === '--chip') {
        result.chip = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--keyword') {
        result.keyword = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--vendor') {
        result.vendor = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--package') {
        result.package = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (token === '--provider') {
        result.provider = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (parseBooleanFlag(token, result, '--confirm')) {
        continue;
      }
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!result.provider) {
    throw new Error('Missing value after --provider');
  }

  return result;
}

function parseDocFetchArgs(argv) {
  const result = {
    project: '',
    url: '',
    output: '',
    title: '',
    explicit_confirmation: false,
    help: false
  };

  for (let index = 0; index < (argv || []).length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--project') {
      result.project = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--url') {
      result.url = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--output') {
      result.output = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--title') {
      result.title = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (parseBooleanFlag(token, result, '--confirm')) {
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!result.help && !result.url) {
    throw new Error('Missing value after --url');
  }

  return result;
}

function parseComponentLookupArgs(argv) {
  const state = parseCommonLookupArgs(argv || [], {
    provider: 'local',
    help: false,
    explicit_confirmation: false
  });
  const result = state.result;
  if (!state.handled) {
    for (let index = state.index; index < (argv || []).length; index += 1) {
      const token = argv[index];
      if (token === '--provider') {
        result.provider = argv[index + 1] || '';
        index += 1;
        continue;
      }
      if (parseBooleanFlag(token, result, '--confirm')) {
        continue;
      }
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!result.provider) {
    throw new Error('Missing value after --provider');
  }

  return result;
}

function parseSchematicQueryArgs(argv) {
  const state = parseCommonLookupArgs(argv || [], {
    name: '',
    record: '',
    help: false
  });
  const result = state.result;
  const tokens = argv || [];
  let index = state.index;
  if (!state.handled) {
    while (index < tokens.length) {
      const token = tokens[index];
      if (token === '--help' || token === '-h') {
        result.help = true;
        index += 1;
        continue;
      }
      if (token === '--project') {
        result.project = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (token === '--file' || token === '--from-schematic') {
        result.file = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (token === '--parsed') {
        result.parsed = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (token === '--limit') {
        const rawLimit = tokens[index + 1] || '';
        if (!/^\d+$/.test(rawLimit) || Number(rawLimit) <= 0) {
          throw new Error('limit must be a positive integer');
        }
        result.limit = Number(rawLimit);
        index += 2;
        continue;
      }
      if (token === '--name' || token === '--net') {
        result.name = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (token === '--record') {
        result.record = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (token === '--ref') {
        result.ref = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (parseBooleanFlag(token, result, '--confirm')) {
        index += 1;
        continue;
      }
      throw new Error(`Unknown schematic argument: ${token}`);
    }
  }
  return result;
}

function parseBoardQueryArgs(argv) {
  const state = parseCommonLookupArgs(argv || [], {
    name: '',
    record: '',
    help: false
  });
  const result = state.result;
  const tokens = argv || [];
  let index = state.index;
  if (!state.handled) {
    while (index < tokens.length) {
      const token = tokens[index];
      if (token === '--help' || token === '-h') {
        result.help = true;
        index += 1;
        continue;
      }
      if (token === '--project') {
        result.project = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (token === '--file' || token === '--from-schematic') {
        result.file = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (token === '--parsed') {
        result.parsed = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (token === '--limit') {
        const rawLimit = tokens[index + 1] || '';
        if (!/^\d+$/.test(rawLimit) || Number(rawLimit) <= 0) {
          throw new Error('limit must be a positive integer');
        }
        result.limit = Number(rawLimit);
        index += 2;
        continue;
      }
      if (token === '--name' || token === '--net') {
        result.name = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (token === '--record') {
        result.record = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (token === '--ref') {
        result.ref = tokens[index + 1] || '';
        index += 2;
        continue;
      }
      if (parseBooleanFlag(token, result, '--confirm')) {
        index += 1;
        continue;
      }
      throw new Error(`Unknown board argument: ${token}`);
    }
  }
  return result;
}

function normalizeComponentProvider(value) {
  const normalized = String(value || 'local').trim().toLowerCase() || 'local';
  return normalized;
}

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function resolveProjectRoot(projectRoot) {
  return path.resolve(projectRoot || process.cwd());
}

function readScalar(content, key) {
  const line = String(content || '')
    .split(/\r?\n/)
    .find(item => item.trim().startsWith(`${key}:`));

  if (!line) {
    return '';
  }

  return line
    .split(':')
    .slice(1)
    .join(':')
    .trim()
    .replace(/^['"]|['"]$/g, '');
}

function loadHardwareIdentity(projectRoot, runtime) {
  const hwPath = runtime.resolveProjectDataPath(projectRoot, 'hw.yaml');
  if (!fs.existsSync(hwPath)) {
    return {
      vendor: '',
      chip: '',
      package: ''
    };
  }

  const content = runtime.readText(hwPath);
  return {
    vendor: readScalar(content, 'vendor'),
    chip: readScalar(content, 'model'),
    package: readScalar(content, 'package')
  };
}

function walkFiles(rootDir, currentDir, results) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      walkFiles(rootDir, path.join(currentDir, entry.name), results);
      continue;
    }
    results.push(normalizePath(path.relative(rootDir, path.join(currentDir, entry.name))));
  }
}

function listProjectDocFiles(projectRoot) {
  const files = [];
  walkFiles(projectRoot, projectRoot, files);
  return files.filter(file => DOC_EXTS.has(path.extname(file).toLowerCase()));
}

function normalizeNeedle(value) {
  return String(value || '').trim().toLowerCase();
}

function compactNeedle(value) {
  return normalizeNeedle(value).replace(/[^a-z0-9]+/g, '');
}

function matchesToken(haystack, token) {
  const normalizedToken = normalizeNeedle(token);
  const compactToken = compactNeedle(token);
  if (!normalizedToken) {
    return false;
  }
  return haystack.includes(normalizedToken) || (compactToken && haystack.replace(/[^a-z0-9]+/g, '').includes(compactToken));
}

function inferConfidence(score) {
  if (score >= 80) {
    return 'high';
  }
  if (score >= 40) {
    return 'medium';
  }
  return 'low';
}

function scoreDocCandidate(relativePath, identity) {
  const basename = path.basename(relativePath);
  const haystack = normalizeNeedle(`${relativePath}\n${basename}`);
  let score = 0;
  const reasons = [];

  if (/datasheet|manual|reference/.test(haystack)) {
    score += 20;
    reasons.push('filename suggests datasheet/manual');
  }
  if (relativePath.startsWith('docs/')) {
    score += 10;
    reasons.push('stored under docs/');
  }
  if (matchesToken(haystack, identity.chip)) {
    score += 60;
    reasons.push(`matches chip ${identity.chip}`);
  }
  if (matchesToken(haystack, identity.vendor)) {
    score += 15;
    reasons.push(`matches vendor ${identity.vendor}`);
  }
  if (matchesToken(haystack, identity.package)) {
    score += 10;
    reasons.push(`matches package ${identity.package}`);
  }

  return {
    score,
    confidence: inferConfidence(score),
    reasons
  };
}

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function loadParsedSchematicEntries(projectRoot, args, deps) {
  const runtime = deps.runtime;
  const ingestSchematicCli = deps.ingestSchematicCli;
  const entries = [];

  function pushParsed(parsedPath, sourcePath) {
    const absoluteParsed = path.resolve(projectRoot, parsedPath);
    if (!fs.existsSync(absoluteParsed)) {
      return;
    }
    entries.push({
      parsed_path: normalizePath(path.relative(projectRoot, absoluteParsed)),
      source_path: normalizePath(sourcePath || ''),
      parsed: runtime.readJson(absoluteParsed)
    });
  }

  if (args.parsed) {
    pushParsed(args.parsed, args.file || '');
    return entries;
  }

  if (args.file) {
    if (normalizePath(args.file).toLowerCase().endsWith('/parsed.json') || normalizePath(args.file).toLowerCase().endsWith('parsed.json')) {
      pushParsed(args.file, '');
      return entries;
    }

    const result = ingestSchematicCli.ingestSchematic(['--project', projectRoot, '--file', args.file], {
      projectRoot
    });
    if (result && result.artifacts && result.artifacts.parsed) {
      pushParsed(result.artifacts.parsed, result.source_path || args.file);
    }
    return entries;
  }

  const cacheRoot = path.join(projectRoot, '.emb-agent', 'cache', 'schematics');
  if (!fs.existsSync(cacheRoot)) {
    return entries;
  }

  const directories = fs.readdirSync(cacheRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .reverse();

  directories.forEach(name => {
    const parsedPath = path.join(cacheRoot, name, 'parsed.json');
    const sourcePath = path.join(cacheRoot, name, 'source.json');
    if (!fs.existsSync(parsedPath)) {
      return;
    }
    const source = fs.existsSync(sourcePath) ? runtime.readJson(sourcePath) : {};
    entries.push({
      parsed_path: normalizePath(path.relative(projectRoot, parsedPath)),
      source_path: normalizePath(source.source_path || ''),
      parsed: runtime.readJson(parsedPath)
    });
  });

  return entries;
}

function loadParsedBoardEntries(projectRoot, args, deps) {
  const runtime = deps.runtime;
  const ingestBoardCli = deps.ingestBoardCli;
  const entries = [];

  function pushParsed(parsedPath, sourcePath) {
    const absoluteParsed = path.resolve(projectRoot, parsedPath);
    if (!fs.existsSync(absoluteParsed)) {
      return;
    }
    entries.push({
      parsed_path: normalizePath(path.relative(projectRoot, absoluteParsed)),
      source_path: normalizePath(sourcePath || ''),
      parsed: runtime.readJson(absoluteParsed)
    });
  }

  if (args.parsed) {
    pushParsed(args.parsed, args.file || '');
    return entries;
  }

  if (args.file) {
    if (normalizePath(args.file).toLowerCase().endsWith('analysis.board-layout.json')) {
      pushParsed(args.file, '');
      return entries;
    }

    const result = ingestBoardCli.ingestBoard(['--project', projectRoot, '--file', args.file], {
      projectRoot
    });
    if (result && result.artifacts && result.artifacts.layout) {
      pushParsed(result.artifacts.layout, result.source_path || args.file);
    }
    return entries;
  }

  const cacheRoot = path.join(projectRoot, '.emb-agent', 'cache', 'boards');
  if (!fs.existsSync(cacheRoot)) {
    return entries;
  }

  const directories = fs.readdirSync(cacheRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .reverse();

  directories.forEach(name => {
    const parsedPath = path.join(cacheRoot, name, 'analysis.board-layout.json');
    const sourcePath = path.join(cacheRoot, name, 'source.json');
    if (!fs.existsSync(parsedPath)) {
      return;
    }
    const source = fs.existsSync(sourcePath) ? runtime.readJson(sourcePath) : {};
    entries.push({
      parsed_path: normalizePath(path.relative(projectRoot, parsedPath)),
      source_path: normalizePath(source.source_path || ''),
      parsed: runtime.readJson(parsedPath)
    });
  });

  return entries;
}

function buildSearchQueries(identity) {
  if (!identity.chip) {
    return [];
  }

  return [
    runtimeSafeUnique([
      identity.vendor,
      identity.chip,
      'datasheet pdf'
    ].filter(Boolean).join(' ')),
    runtimeSafeUnique([
      identity.vendor,
      identity.chip,
      'reference manual pdf'
    ].filter(Boolean).join(' '))
  ].filter(Boolean);
}

function normalizeDocLookupProvider(value) {
  const normalized = String(value || 'local').trim().toLowerCase() || 'local';
  if (normalized === 'lceda' || normalized === 'easyeda') {
    return 'lceda';
  }
  return normalized;
}

function runtimeSafeUnique(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function buildLookupSemantics(kind) {
  return {
    result_mode: 'candidate-only',
    candidate_status: 'unverified',
    candidate_kind: kind
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

async function requestJsonWithFetch(url, options) {
  const fetchImpl = getFetchImpl(options);
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'emb-agent-lceda-datasheet-lookup'
    }
  });
  if (!response || response.ok === false) {
    const status = response && response.status ? response.status : 'unknown';
    throw new Error(`LCEDA datasheet lookup failed (${status})`);
  }
  return response.json();
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function nestedValue(value, pathParts) {
  let current = value;
  for (const part of pathParts || []) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function nestedText(value, pathParts) {
  const current = nestedValue(value, pathParts);
  if (current === undefined || current === null) {
    return '';
  }
  if (typeof current === 'string' || typeof current === 'number' || typeof current === 'boolean') {
    return String(current).trim();
  }
  return '';
}

function findAttributeCaseInsensitive(record, names) {
  const attributes = record && record.attributes && typeof record.attributes === 'object'
    ? record.attributes
    : {};
  const wanted = new Set((names || []).map(item => String(item || '').trim().toLowerCase()));
  for (const [key, value] of Object.entries(attributes)) {
    if (!wanted.has(String(key || '').trim().toLowerCase())) {
      continue;
    }
    const text = String(value || '').trim();
    if (text) {
      return text;
    }
  }
  return '';
}

function extractLcedaDatasheetUrl(record) {
  return firstNonEmptyString(
    findAttributeCaseInsensitive(record, [
      'Datasheet',
      'DataSheet',
      'Data Sheet',
      'Manual',
      'Product Manual',
      'Specification'
    ]),
    nestedText(record, ['datasheet']),
    nestedText(record, ['datasheet_url']),
    nestedText(record, ['data_manual_url'])
  );
}

function extractLcedaComponentMetadata(record) {
  return {
    lcsc_id: firstNonEmptyString(
      nestedText(record, ['product_code']),
      findAttributeCaseInsensitive(record, ['Supplier Part', 'LCSC Part', 'LCSC ID'])
    ),
    value: firstNonEmptyString(
      nestedText(record, ['display_title']),
      nestedText(record, ['title']),
      findAttributeCaseInsensitive(record, ['Manufacturer Part', 'LCSC Part Name'])
    ),
    manufacturer: firstNonEmptyString(
      findAttributeCaseInsensitive(record, ['Manufacturer']),
      nestedText(record, ['manufacturer'])
    ),
    package: firstNonEmptyString(
      nestedText(record, ['footprint', 'display_title']),
      findAttributeCaseInsensitive(record, ['Supplier Footprint', 'Footprint'])
    )
  };
}

function buildLcedaDocLookupKeywords(args, identity, schematicEntries) {
  const keywords = [];
  if (args.keyword) {
    keywords.push(args.keyword);
  }
  if (identity.chip) {
    keywords.push(identity.chip);
  }

  schematicEntries.forEach(entry => {
    const components = Array.isArray(entry.parsed && entry.parsed.components) ? entry.parsed.components : [];
    components.forEach(component => {
      const designator = String(component.designator || '').trim();
      if (args.ref && designator.toLowerCase() !== String(args.ref).trim().toLowerCase()) {
        return;
      }
      buildComponentQueryTerms(component).forEach(term => keywords.push(term));
    });
  });

  return Array.from(new Set(keywords.map(runtimeSafeUnique).filter(Boolean))).slice(0, 5);
}

async function lookupLcedaDatasheetCandidates(args, identity, schematicEntries, deps) {
  const keywords = buildLcedaDocLookupKeywords(args, identity, schematicEntries);
  const candidates = [];
  const seen = new Set();

  for (const keyword of keywords) {
    const url = new URL(LCEDA_SEARCH_API);
    url.searchParams.set('wd', keyword);
    const payload = await requestJsonWithFetch(url.toString(), deps);
    const records = Array.isArray(payload && payload.result) ? payload.result : [];
    records.slice(0, args.limit || 10).forEach(record => {
      const datasheet = extractLcedaDatasheetUrl(record);
      if (!datasheet || !isAbsoluteUrl(datasheet)) {
        return;
      }
      const metadata = extractLcedaComponentMetadata(record);
      const key = `lceda:${datasheet}:${metadata.lcsc_id}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      candidates.push({
        id: key,
        title: runtimeSafeUnique([
          metadata.value,
          metadata.lcsc_id ? `(${metadata.lcsc_id})` : ''
        ].filter(Boolean).join(' ')) || datasheet,
        provider: 'lceda',
        source_kind: 'lceda-datasheet-url',
        location: datasheet,
        fetch_required: true,
        confidence: metadata.lcsc_id && keyword.toLowerCase() === metadata.lcsc_id.toLowerCase() ? 'high' : 'medium',
        score: metadata.lcsc_id && keyword.toLowerCase() === metadata.lcsc_id.toLowerCase() ? 88 : 70,
        reasons: [
          `LCEDA search keyword: ${keyword}`,
          metadata.lcsc_id ? `LCSC ID: ${metadata.lcsc_id}` : '',
          metadata.manufacturer ? `manufacturer: ${metadata.manufacturer}` : ''
        ].filter(Boolean),
        component: {
          designator: '',
          value: metadata.value,
          package: metadata.package,
          datasheet,
          lcsc_id: metadata.lcsc_id,
          manufacturer: metadata.manufacturer
        }
      });
    });
  }

  return candidates;
}

async function lookupDocs(projectRootInput, argv, deps) {
  const args = Array.isArray(argv) ? parseDocLookupArgs(argv) : (argv || {});
  if (args.help) {
    return {
      command: 'doc lookup',
      usage: 'doc lookup [--chip <name>] [--keyword <text>] [--vendor <name>] [--package <name>] [--file <schematic>] [--parsed <parsed.json>] [--ref <designator>] [--provider local|lceda] [--limit <n>]'
    };
  }

  const runtime = deps.runtime;
  const projectRoot = resolveProjectRoot(args.project || projectRootInput);
  const currentIdentity = loadHardwareIdentity(projectRoot, runtime);
  const identity = {
    vendor: args.vendor || currentIdentity.vendor,
    chip: args.chip || currentIdentity.chip,
    package: args.package || currentIdentity.package
  };
  const docFiles = listProjectDocFiles(projectRoot);
  const schematicEntries = loadParsedSchematicEntries(projectRoot, args, deps);
  const candidates = [];
  const seen = new Set();
  const provider = normalizeDocLookupProvider(args.provider);
  if (provider !== 'local' && provider !== 'lceda') {
    throw new Error(`Unknown doc lookup provider: ${args.provider}`);
  }

  docFiles.forEach(relativePath => {
    const scored = scoreDocCandidate(relativePath, identity);
    if (!identity.chip && !/datasheet|manual|reference/i.test(relativePath)) {
      return;
    }
    if (identity.chip && scored.score <= 0) {
      return;
    }
    const key = `file:${relativePath}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push({
      id: key,
      title: path.basename(relativePath),
      provider: 'local',
      source_kind: 'local-file',
      location: relativePath,
      fetch_required: false,
      confidence: scored.confidence,
      score: scored.score,
      reasons: scored.reasons
    });
  });

  schematicEntries.forEach(entry => {
    const components = Array.isArray(entry.parsed && entry.parsed.components) ? entry.parsed.components : [];
    components.forEach(component => {
      const designator = String(component.designator || '').trim();
      const datasheet = String(component.datasheet || '').trim();
      if (!datasheet) {
        return;
      }
      if (args.ref && designator.toLowerCase() !== String(args.ref).trim().toLowerCase()) {
        return;
      }
      const key = `schematic:${datasheet}:${designator}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      candidates.push({
        id: key,
        title: runtimeSafeUnique([component.value, designator].filter(Boolean).join(' ')) || designator || datasheet,
        provider: 'schematic',
        source_kind: isAbsoluteUrl(datasheet) ? 'schematic-datasheet-url' : 'schematic-datasheet-path',
        location: datasheet,
        fetch_required: isAbsoluteUrl(datasheet),
        confidence: isAbsoluteUrl(datasheet) ? 'high' : 'medium',
        score: isAbsoluteUrl(datasheet) ? 90 : 55,
        reasons: runtimeSafeUnique([
          designator ? `datasheet declared on ${designator}` : '',
          entry.source_path ? `from ${entry.source_path}` : ''
        ].filter(Boolean).join('; ')).split('; ').filter(Boolean),
        component: {
          designator,
          value: component.value || '',
          package: component.package || component.footprint || '',
          datasheet
        }
      });
    });
  });

  if (provider === 'lceda') {
    candidates.push(...await lookupLcedaDatasheetCandidates(args, identity, schematicEntries, deps));
  }

  const sorted = candidates
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, args.limit || 10);

  return {
    ...buildLookupSemantics('document'),
    command: 'doc lookup',
    provider,
    scope: {
      project_root: projectRoot,
      vendor: identity.vendor,
      chip: identity.chip,
      keyword: args.keyword || '',
      package: identity.package,
      ref: args.ref || '',
      from_schematic: args.file || '',
      parsed: args.parsed || ''
    },
    candidates: sorted.map(item => ({
      id: item.id,
      title: item.title,
      provider: item.provider,
      source_kind: item.source_kind,
      location: item.location,
      fetch_required: item.fetch_required,
      confidence: item.confidence,
      reasons: item.reasons,
      component: item.component || null
    })),
    search_queries: buildSearchQueries(identity),
    next_steps: sorted.some(item => item.fetch_required)
      ? ['Use `doc fetch --url <url> --confirm` to download a remote datasheet into docs/.', 'Then run `ingest doc --file <path> --to hardware`.']
      : sorted.length > 0
        ? ['Pick the most relevant local or schematic-linked document, then run `ingest doc --file <path> --to hardware` if it is local.', 'If the best candidate is a remote URL, fetch it into docs/ first.']
        : provider === 'lceda'
          ? ['No LCEDA datasheet candidate was found. Try a more exact --keyword or LCSC ID such as C2040.']
          : ['No matching local document was found. Provide a schematic with datasheet fields, add docs under docs/, or use the generated search_queries externally.']
  };
}

function looksLikePartNumber(value) {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }
  if (GENERIC_COMPONENT_VALUES.has(text.toLowerCase())) {
    return false;
  }
  return /[a-z]/i.test(text) && /\d/.test(text) && text.length >= 4;
}

function buildComponentQueryTerms(component) {
  const candidates = [
    component.value,
    component.comment,
    component.libref,
    component.package,
    component.description
  ].map(item => String(item || '').trim()).filter(Boolean);
  const terms = [];
  candidates.forEach(item => {
    if (looksLikePartNumber(item)) {
      terms.push(item);
    }
  });
  if (terms.length === 0) {
    candidates.forEach(item => {
      if (!GENERIC_COMPONENT_VALUES.has(item.toLowerCase()) && item.length >= 3) {
        terms.push(item);
      }
    });
  }
  return Array.from(new Set(terms)).slice(0, 4);
}

function buildLocalComponentMatches(entries, args) {
  const components = [];

  entries.forEach(entry => {
    const parsedComponents = Array.isArray(entry.parsed && entry.parsed.components) ? entry.parsed.components : [];
    parsedComponents.forEach(component => {
      const designator = String(component.designator || '').trim();
      if (args.ref && designator.toLowerCase() !== String(args.ref).trim().toLowerCase()) {
        return;
      }
      const queryTerms = buildComponentQueryTerms(component);
      const primaryPart = queryTerms[0] || '';
      const confidence = primaryPart
        ? (looksLikePartNumber(primaryPart) ? 'high' : 'medium')
        : 'low';
      components.push({
        designator,
        value: component.value || '',
        comment: component.comment || '',
        package: component.package || component.footprint || '',
        description: component.description || '',
        datasheet: component.datasheet || '',
        source_schematic: entry.source_path || '',
        parsed_source: entry.parsed_path,
        confidence,
        query_terms: queryTerms,
        supplier_queries: queryTerms.map(item => runtimeSafeUnique([item, component.package || component.footprint || ''].filter(Boolean).join(' '))).slice(0, 3)
      });
    });
  });

  return components;
}

async function lookupComponents(projectRootInput, argv, deps) {
  const args = Array.isArray(argv) ? parseComponentLookupArgs(argv) : (argv || {});
  if (args.help) {
    return {
      command: 'component lookup',
      usage: 'component lookup [--file <schematic>] [--parsed <parsed.json>] [--ref <designator>] [--limit <n>]'
    };
  }

  const provider = normalizeComponentProvider(args.provider);
  if (provider !== 'local') {
    throw new Error('Component supplier search providers are not integrated yet; use local component lookup outputs.');
  }

  const projectRoot = resolveProjectRoot(args.project || projectRootInput);
  const entries = loadParsedSchematicEntries(projectRoot, args, deps);
  const limited = buildLocalComponentMatches(entries, args).slice(0, args.limit || 10);
  const result = {
    ...buildLookupSemantics('component'),
    command: 'component lookup',
    provider,
    scope: {
      project_root: projectRoot,
      from_schematic: args.file || '',
      parsed: args.parsed || '',
      ref: args.ref || ''
    },
    components: limited,
    next_steps: limited.length > 0
      ? ['Use supplier_queries as manual search inputs, but keep supplier matches as candidates until package/datasheet are verified.', 'Prefer components whose datasheet field or explicit part number is present in the schematic.']
      : ['No components matched the current filter. Provide a schematic or parsed.json first, or remove the --ref filter.']
  };

  return result;
}

function querySchematic(projectRootInput, subject, argv, deps) {
  const args = Array.isArray(argv) ? parseSchematicQueryArgs(argv) : (argv || {});
  const runtime = deps.runtime;
  const normalizedSubject = String(subject || 'summary').trim() || 'summary';
  if (args.help) {
    return {
      command: `schematic ${normalizedSubject}`,
      usage: 'schematic <summary|components|component|nets|net|bom|advice|preview|raw> [--parsed <parsed.json>] [--file <schematic>] [--ref <designator>] [--name <net>] [--record <n>] [--limit <n>]'
    };
  }

  const projectRoot = resolveProjectRoot(args.project || projectRootInput);
  const entries = loadParsedSchematicEntries(projectRoot, args, deps);
  const entry = entries[0] || { parsed_path: '', source_path: '', parsed: {} };
  const parsed = entry.parsed || {};
  const components = Array.isArray(parsed.components) ? parsed.components : [];
  const nets = Array.isArray(parsed.nets) ? parsed.nets : [];
  const bom = Array.isArray(parsed.bom) ? parsed.bom : [];
  const objects = Array.isArray(parsed.objects) ? parsed.objects : [];
  const limit = args.limit || 20;

  const base = {
    result_mode: 'analysis-only',
    command: `schematic ${normalizedSubject}`,
    scope: {
      project_root: projectRoot,
      parsed: entry.parsed_path || args.parsed || '',
      source_schematic: entry.source_path || args.file || ''
    }
  };

  if (normalizedSubject === 'summary') {
    return {
      ...base,
      summary: {
        parser_mode: parsed.parser_mode || '',
        components: components.length,
        nets: nets.length,
        objects: objects.length,
        bom_lines: bom.length,
        advice: parsed.schematic_advice && parsed.schematic_advice.summary ? parsed.schematic_advice.summary : null,
        preview: parsed.preview && parsed.preview.summary ? parsed.preview.summary : null,
        visual_netlist: parsed.visual_netlist || null,
        raw_summary: parsed.raw_summary || {}
      }
    };
  }

  if (normalizedSubject === 'components') {
    return {
      ...base,
      components: components.slice(0, limit)
    };
  }

  if (normalizedSubject === 'component') {
    const ref = String(args.ref || '').trim().toLowerCase();
    const component = components.find(item => String(item.designator || '').toLowerCase() === ref) || null;
    return {
      ...base,
      ref: args.ref || '',
      component,
      pins: component ? (component.pins || []) : []
    };
  }

  if (normalizedSubject === 'nets') {
    return {
      ...base,
      nets: nets.slice(0, limit).map(net => ({
        name: net.name || '',
        members: net.members || [],
        confidence: net.confidence || '',
        evidence_count: Array.isArray(net.evidence) ? net.evidence.length : 0
      }))
    };
  }

  if (normalizedSubject === 'net') {
    const name = String(args.name || '').trim().toLowerCase();
    const net = nets.find(item => String(item.name || '').toLowerCase() === name) || null;
    return {
      ...base,
      name: args.name || '',
      net
    };
  }

  if (normalizedSubject === 'bom') {
    return {
      ...base,
      bom: bom.slice(0, limit)
    };
  }

  if (normalizedSubject === 'advice') {
    const parsedPath = entry.parsed_path || args.parsed || '';
    const parsedDir = parsedPath ? path.dirname(path.resolve(projectRoot, parsedPath)) : '';
    const advicePath = parsedDir ? path.join(parsedDir, 'analysis.schematic-advice.json') : '';
    const adviceRelative = advicePath && fs.existsSync(advicePath)
      ? normalizePath(path.relative(projectRoot, advicePath))
      : '';
    let advice = parsed.schematic_advice || null;
    if (!advice && advicePath && fs.existsSync(advicePath)) {
      advice = runtime.readJson(advicePath);
    }
    const findings = Array.isArray(advice && advice.findings) ? advice.findings : [];
    return {
      ...base,
      advice: {
        available: Boolean(advice),
        summary: advice && advice.summary ? advice.summary : null,
        findings: findings.slice(0, limit),
        artifacts: {
          advice: adviceRelative
        },
        note: 'Advice findings are dismissible engineering review prompts; confirm with datasheets, BOM values, firmware defaults, and board intent before changing hardware truth.'
      }
    };
  }

  if (normalizedSubject === 'preview') {
    const parsedPath = entry.parsed_path || args.parsed || '';
    const parsedDir = parsedPath ? path.dirname(path.resolve(projectRoot, parsedPath)) : '';
    const previewSvgPath = parsedDir ? path.join(parsedDir, 'preview.svg') : '';
    const previewInputPath = parsedDir ? path.join(parsedDir, 'preview.input.json') : '';
    const svgRelative = previewSvgPath && fs.existsSync(previewSvgPath)
      ? normalizePath(path.relative(projectRoot, previewSvgPath))
      : '';
    const inputRelative = previewInputPath && fs.existsSync(previewInputPath)
      ? normalizePath(path.relative(projectRoot, previewInputPath))
      : '';
    return {
      ...base,
      preview: {
        available: Boolean(parsed.preview && parsed.preview.summary),
        summary: parsed.preview && parsed.preview.summary ? parsed.preview.summary : null,
        artifacts: {
          svg: svgRelative,
          input: inputRelative
        },
        note: 'Preview is an orientation aid generated from SchDoc drawing primitives; keep net evidence as the source for connectivity.'
      }
    };
  }

  if (normalizedSubject === 'raw') {
    const recordIndex = String(args.record || '').trim();
    const object = objects.find(item => String(item.record_index || '') === recordIndex) || null;
    return {
      ...base,
      record: recordIndex,
      object
    };
  }

  throw new Error(`Unknown schematic command: ${normalizedSubject}`);
}

function queryBoard(projectRootInput, subject, argv, deps) {
  const normalizedSubject = String(subject || 'summary').trim() || 'summary';
  const args = Array.isArray(argv)
    ? parseBoardQueryArgs(argv)
    : (argv || {});
  if (args.help) {
    return {
      command: `board ${normalizedSubject}`,
      usage: 'board <summary|components|pads|tracks|vias|texts|nets|advice|raw> [--parsed <analysis.board-layout.json>] [--file <board.PcbDoc>] [--ref <designator>] [--name <net>] [--record <n>] [--limit <n>]'
    };
  }

  const projectRoot = resolveProjectRoot(args.project || projectRootInput);
  const entries = loadParsedBoardEntries(projectRoot, args, deps);
  const entry = entries[0] || { parsed_path: '', source_path: '', parsed: {} };
  const parsed = entry.parsed || {};
  const components = Array.isArray(parsed.components) ? parsed.components : [];
  const pads = Array.isArray(parsed.pads) ? parsed.pads : [];
  const tracks = Array.isArray(parsed.tracks) ? parsed.tracks : [];
  const vias = Array.isArray(parsed.vias) ? parsed.vias : [];
  const texts = Array.isArray(parsed.texts) ? parsed.texts : [];
  const nets = Array.isArray(parsed.nets) ? parsed.nets : [];
  const objects = Array.isArray(parsed.objects) ? parsed.objects : [];
  const limit = args.limit || 20;

  const base = {
    result_mode: 'analysis-only',
    command: `board ${normalizedSubject}`,
    scope: {
      project_root: projectRoot,
      parsed: entry.parsed_path || args.parsed || '',
      source_board: entry.source_path || args.file || ''
    }
  };

  if (normalizedSubject === 'summary') {
    return {
      ...base,
      summary: {
        parser_mode: parsed.parser_mode || '',
        metadata: parsed.metadata || {},
        coverage: parsed.coverage || {},
        board: parsed.board || {},
        layer_stack: Array.isArray(parsed.layer_stack) ? parsed.layer_stack.slice(0, limit) : [],
        advice: parsed.board_advice && parsed.board_advice.summary ? parsed.board_advice.summary : null
      }
    };
  }

  if (normalizedSubject === 'components') {
    const ref = String(args.ref || '').trim().toLowerCase();
    return {
      ...base,
      components: components
        .filter(component => !ref || String(component.designator || '').toLowerCase() === ref)
        .slice(0, limit)
    };
  }

  if (normalizedSubject === 'pads') {
    const ref = String(args.ref || '').trim().toLowerCase();
    const name = String(args.name || '').trim().toLowerCase();
    return {
      ...base,
      pads: pads
        .filter(pad => !ref || String(pad.component || '').toLowerCase() === ref)
        .filter(pad => !name || String(pad.net || '').toLowerCase() === name)
        .slice(0, limit)
    };
  }

  if (normalizedSubject === 'tracks') {
    const name = String(args.name || '').trim().toLowerCase();
    return {
      ...base,
      tracks: tracks
        .filter(track => !name || String(track.net || '').toLowerCase() === name)
        .slice(0, limit)
    };
  }

  if (normalizedSubject === 'vias') {
    const name = String(args.name || '').trim().toLowerCase();
    return {
      ...base,
      vias: vias
        .filter(via => !name || String(via.net || '').toLowerCase() === name)
        .slice(0, limit)
    };
  }

  if (normalizedSubject === 'texts') {
    const name = String(args.name || '').trim().toLowerCase();
    return {
      ...base,
      texts: texts
        .filter(text => !name || String(text.text || '').toLowerCase().includes(name))
        .slice(0, limit)
    };
  }

  if (normalizedSubject === 'nets') {
    return {
      ...base,
      nets: nets.slice(0, limit)
    };
  }

  if (normalizedSubject === 'advice') {
    const parsedPath = entry.parsed_path || args.parsed || '';
    const parsedDir = parsedPath ? path.dirname(path.resolve(projectRoot, parsedPath)) : '';
    const advicePath = parsedDir ? path.join(parsedDir, 'analysis.board-advice.json') : '';
    const adviceRelative = advicePath && fs.existsSync(advicePath)
      ? normalizePath(path.relative(projectRoot, advicePath))
      : '';
    let advice = parsed.board_advice || null;
    if (!advice && advicePath && fs.existsSync(advicePath)) {
      advice = runtime.readJson(advicePath);
    }
    const findings = Array.isArray(advice && advice.findings) ? advice.findings : [];
    return {
      ...base,
      advice: {
        available: Boolean(advice),
        summary: advice && advice.summary ? advice.summary : null,
        findings: findings.slice(0, limit),
        artifacts: {
          advice: adviceRelative
        },
        note: 'Board layout advice findings are dismissible engineering review prompts; confirm against schematic intent, datasheets, current limits, mechanical constraints, and fabrication rules.'
      }
    };
  }

  if (normalizedSubject === 'raw') {
    const recordIndex = String(args.record || '').trim();
    const object = objects.find(item => String(item.index || '') === recordIndex) || null;
    return {
      ...base,
      record: recordIndex,
      object
    };
  }

  throw new Error(`Unknown board command: ${normalizedSubject}`);
}

function sanitizeFileName(value) {
  const normalized = String(value || '').trim().replace(/[?#].*$/, '');
  const basename = path.basename(normalized || 'downloaded.pdf').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return basename || 'downloaded.pdf';
}

function resolveFetchOutput(projectRoot, args) {
  if (args.output) {
    return path.resolve(projectRoot, args.output);
  }

  let fileName = 'downloaded.pdf';
  try {
    const parsedUrl = new URL(args.url);
    fileName = sanitizeFileName(parsedUrl.pathname);
  } catch {
    fileName = 'downloaded.pdf';
  }

  return path.join(projectRoot, 'docs', fileName);
}

function requestWithRedirect(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const client = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
    if (!client) {
      reject(new Error(`Unsupported URL protocol: ${parsed.protocol}`));
      return;
    }

    const request = client.get(parsed, response => {
      const statusCode = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('Too many redirects while fetching document'));
          return;
        }
        const nextUrl = new URL(response.headers.location, parsed).toString();
        resolve(requestWithRedirect(nextUrl, redirectsLeft - 1));
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Unexpected response status: ${statusCode}`));
        return;
      }

      resolve({
        url: parsed.toString(),
        response
      });
    });

    request.on('error', reject);
  });
}

function emitUiEvent(options, event, payload) {
  const ui = options && options.ui;
  if (!ui || typeof ui.emit !== 'function') {
    return;
  }
  ui.emit(event, payload || {});
}

async function fetchDocument(projectRootInput, argv, options) {
  const args = Array.isArray(argv) ? parseDocFetchArgs(argv) : (argv || {});
  if (args.help) {
    return {
      command: 'doc fetch',
      usage: 'doc fetch --url <http(s)-url> [--output <path>] [--confirm]'
    };
  }

  const projectRoot = resolveProjectRoot(args.project || projectRootInput);
  const outputPath = resolveFetchOutput(projectRoot, args);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  emitUiEvent(options, 'doc-fetch-start', {
    url: args.url,
    output: normalizePath(path.relative(projectRoot, outputPath))
  });
  const { url, response } = await requestWithRedirect(args.url, 5);
  emitUiEvent(options, 'doc-fetch-response', {
    url
  });
  const tempPath = `${outputPath}.part`;

  try {
    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(tempPath);
      emitUiEvent(options, 'doc-fetch-write', {
        output: normalizePath(path.relative(projectRoot, outputPath))
      });
      response.pipe(stream);
      response.on('error', reject);
      stream.on('error', reject);
      stream.on('finish', resolve);
    });
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }

  const relativeOutput = normalizePath(path.relative(projectRoot, outputPath));
  emitUiEvent(options, 'doc-fetch-finished', {
    output: relativeOutput,
    size_bytes: fs.statSync(outputPath).size
  });
  return {
    command: 'doc fetch',
    downloaded: true,
    url,
    output: relativeOutput,
    size_bytes: fs.statSync(outputPath).size,
    next_steps: [
      `Run ingest doc --file ${relativeOutput} --to hardware`,
      'Then use doc diff/apply if you want to merge parsed facts into truth files'
    ]
  };
}

module.exports = {
  parseDocLookupArgs,
  parseDocFetchArgs,
  parseComponentLookupArgs,
  parseSchematicQueryArgs,
  parseBoardQueryArgs,
  lookupDocs,
  lookupComponents,
  querySchematic,
  queryBoard,
  fetchDocument
};
