#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const runtimeHostHelpers = require(path.join(ROOT, 'lib', 'runtime-host.cjs'));
const docCache = require(path.join(ROOT, 'lib', 'doc-cache.cjs'));
const mineruProvider = require(path.join(ROOT, 'lib', 'doc-providers', 'mineru.cjs'));
const permissionGateHelpers = require(path.join(ROOT, 'lib', 'permission-gates.cjs'));
const ingestTruthCli = require(path.join(ROOT, 'scripts', 'ingest-truth.cjs'));
const supportAnalysisCli = require(path.join(ROOT, 'scripts', 'support-analysis.cjs'));
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHost(ROOT);

const DOC_LIST_PRESET_NAME_LIMIT = 3;

function usage() {
  process.stdout.write(
    [
      'ingest-doc usage:',
      '  node scripts/ingest-doc.cjs --file <path> [--provider mineru] [--kind datasheet]',
      '    [--title <text>] [--pages <range>] [--language ch|en] [--ocr] [--force]',
      '    [--to hardware|requirements]',
      '  node scripts/ingest-doc.cjs apply doc <doc-id> [--confirm] --to hardware|requirements [--only field1,field2] [--force]',
      '  node scripts/ingest-doc.cjs apply doc <doc-id> --from-last-diff',
      '  node scripts/ingest-doc.cjs apply doc <doc-id> --preset <name>',
      '  node scripts/ingest-doc.cjs doc diff [--confirm] <doc-id> --to hardware|requirements [--only field1,field2] [--force] [--save-as <name>]'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const result = {
    project: '',
    file: '',
    provider: 'mineru',
    kind: 'datasheet',
    title: '',
    pages: '',
    language: '',
    ocr: false,
    force: false,
    to: '',
    help: false
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
    if (token === '--file') {
      result.file = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--provider') {
      result.provider = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--kind') {
      result.kind = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--title') {
      result.title = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--pages') {
      result.pages = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--language') {
      result.language = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--to') {
      result.to = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--ocr') {
      result.ocr = true;
      continue;
    }
    if (token === '--force') {
      result.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!result.file) {
    throw new Error('Missing path after --file');
  }
  if (!result.provider) {
    throw new Error('Missing name after --provider');
  }
  if (!result.kind) {
    throw new Error('Missing name after --kind');
  }
  if (result.language && !['ch', 'en'].includes(result.language)) {
    throw new Error('language must be ch or en');
  }
  if (result.to && !['hardware', 'requirements'].includes(result.to)) {
    throw new Error('to must be hardware or requirements');
  }

  return result;
}

function parseApplyArgs(argv, options) {
  const config = options || {};
  const list = Array.isArray(argv) ? argv : [];
  const filtered = [];
  let explicitConfirmation = false;

  for (const token of list) {
    if (token === '--confirm') {
      explicitConfirmation = true;
      continue;
    }
    filtered.push(token);
  }

  const isDocId = filtered[1] && !filtered[1].startsWith('--');
  const result = {
    entity: filtered[0] || '',
    docId: isDocId ? filtered[1] : '',
    to: '',
    only: [],
    project: '',
    force: false,
    explicit_confirmation: explicitConfirmation,
    fromLastDiff: false,
    preset: '',
    saveAs: '',
    help: false
  };

  const flagStart = isDocId ? 2 : 1;
  for (let index = flagStart; index < filtered.length; index += 1) {
    const token = filtered[index];

    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--project') {
      result.project = filtered[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--to') {
      result.to = filtered[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--only') {
      result.only = String(filtered[index + 1] || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (token === '--from-last-diff') {
      result.fromLastDiff = true;
      continue;
    }
    if (token === '--preset') {
      result.preset = filtered[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--save-as') {
      result.saveAs = filtered[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--force') {
      result.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (result.entity !== 'doc') {
    throw new Error('apply target must be doc');
  }
  if (result.fromLastDiff && (result.preset || result.to || result.only.length > 0 || result.force)) {
    throw new Error('--from-last-diff cannot be combined with --preset, --to, --only, or --force');
  }
  if (result.preset && (result.fromLastDiff || result.to || result.only.length > 0 || result.force)) {
    throw new Error('--preset cannot be combined with --from-last-diff, --to, --only, or --force');
  }
  if (!config.allowSaveAs && result.saveAs) {
    throw new Error('--save-as is only supported by doc diff');
  }
  if (!result.fromLastDiff && !result.preset && !['hardware', 'requirements'].includes(result.to)) {
    throw new Error('to must be hardware or requirements');
  }

  return result;
}

function parseDiffArgs(argv) {
  const input = argv || [];
  const result = parseApplyArgs(input[0] === 'doc' ? input : ['doc', ...input], {
    allowSaveAs: true
  });
  if (result.fromLastDiff || result.preset) {
    throw new Error('doc diff does not support --from-last-diff or --preset');
  }
  result.entity = 'doc';
  return result;
}

function parseShowArgs(argv) {
  const input = argv || [];
  const result = {
    docId: input[0] || '',
    preset: '',
    applyReady: false
  };

  for (let index = 1; index < input.length; index += 1) {
    const token = input[index];

    if (token === '--preset') {
      result.preset = input[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--apply-ready') {
      result.applyReady = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!result.docId) {
    throw new Error('Missing doc id');
  }
  if (result.applyReady && !result.preset) {
    throw new Error('--apply-ready requires --preset');
  }

  return result;
}

function loadProjectConfig(projectRoot, runtimeConfig) {
  return (
    runtime.loadProjectConfig(projectRoot, runtimeConfig) || {
      project_profile: '',
      active_specs: [],
      preferences: runtimeConfig.default_preferences || {},
      integrations: {
        mineru: {
          mode: 'auto',
          base_url: '',
          api_key: '',
          api_key_env: 'MINERU_API_KEY',
          model_version: '',
          language: 'ch',
          enable_table: true,
          is_ocr: false,
          enable_formula: true,
          poll_interval_ms: 3000,
          timeout_ms: 300000,
          auto_api_page_threshold: 12,
          auto_api_file_size_kb: 4096
        }
      }
    }
  );
}

function getProviders(providerImpls) {
  return {
    mineru: mineruProvider,
    ...(providerImpls || {})
  };
}

function normalizeDraftList(values) {
  return runtime.unique(
    (values || [])
      .map(item => String(item || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  );
}

function quoteYaml(value) {
  return JSON.stringify(String(value === undefined || value === null ? '' : value));
}

function toYaml(value, indent) {
  const currentIndent = indent || '';

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${currentIndent}[]`;
    }

    return value
      .map(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const entries = Object.entries(item);
          if (entries.length === 0) {
            return `${currentIndent}- {}`;
          }
          const [firstKey, firstValue] = entries[0];
          const head =
            firstValue && typeof firstValue === 'object'
              ? `${currentIndent}- ${firstKey}:\n${toYaml(firstValue, `${currentIndent}    `)}`
              : `${currentIndent}- ${firstKey}: ${quoteYaml(firstValue)}`;
          const tail = entries
            .slice(1)
            .map(([key, nested]) => {
              if (nested && typeof nested === 'object') {
                return `${currentIndent}  ${key}:\n${toYaml(nested, `${currentIndent}    `)}`;
              }
              return `${currentIndent}  ${key}: ${quoteYaml(nested)}`;
            })
            .join('\n');
          return tail ? `${head}\n${tail}` : head;
        }

        return `${currentIndent}- ${quoteYaml(item)}`;
      })
      .join('\n');
  }

  return Object.entries(value || {})
    .map(([key, nested]) => {
      if (Array.isArray(nested)) {
        return `${currentIndent}${key}:\n${toYaml(nested, `${currentIndent}  `)}`;
      }
      if (nested && typeof nested === 'object') {
        return `${currentIndent}${key}:\n${toYaml(nested, `${currentIndent}  `)}`;
      }
      return `${currentIndent}${key}: ${quoteYaml(nested)}`;
    })
    .join('\n');
}

function normalizeMarkdownLines(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function pickConstraintLines(lines) {
  const pattern = /(?:must|shall|should not|do not|cannot|reserved|maximum|minim|timeout|latency|program|must|forbidden|cannot|reserved|programming|maximum|minimum|must not)/i;
  return normalizeDraftList(
    lines
      .filter(line => pattern.test(line))
      .filter(line => line.length <= 120)
      .slice(0, 6)
  );
}

function pickAcceptanceLines(lines) {
  const pattern = /(?:verify|test|bench|cycle|pass|accept|confirm|verify|test|bench|cycle)/i;
  return normalizeDraftList(
    lines
      .filter(line => pattern.test(line))
      .filter(line => line.length <= 120)
      .slice(0, 6)
  );
}

function inferModel(identity, args, markdown) {
  const candidates = normalizeDraftList([
    (String(markdown || '').match(/^[#\s-]*([A-Z]{2,}\d[A-Z0-9-]*)/m) || [])[1] || '',
    path.basename(identity.source_path, path.extname(identity.source_path)),
    String(args.title || '').replace(path.extname(String(args.title || '')), '')
  ]);

  return candidates[0] || '';
}

function inferPackage(markdown) {
  const match = String(markdown || '').match(
    /\b(SOP-?\d+|SSOP-?\d+|DIP-?\d+|QFN-?\d+|LQFP-?\d+|TSSOP-?\d+|QFP-?\d+)\b/i
  );
  return match ? match[1].toUpperCase() : '';
}

function inferPeripherals(markdown) {
  const text = String(markdown || '');
  const patterns = [
    ['Timer', /\bTIMER(?:\d+)?\b/i],
    ['PWM', /\bPWM\b/i],
    ['UART', /\bUART\b/i],
    ['I2C', /\bI2C\b|\bIIC\b/i],
    ['SPI', /\bSPI\b/i],
    ['ADC', /\bADC\b/i],
    ['Comparator', /\bCOMPARATOR\b|\bCMP\b/i],
    ['Watchdog', /\bWATCHDOG\b|\bWDT\b/i],
    ['GPIO', /\bGPIO\b|\bIO PORT\b/i]
  ];

  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => ({
      name,
      usage: 'Mentioned in parsed document'
    }))
    .slice(0, 8);
}

function inferPinTruth(lines) {
  const pins = new Set();

  for (const line of lines) {
    const matches = line.match(/\bP[A-G]\d\b/g);
    if (!matches) {
      continue;
    }
    for (const pin of matches) {
      pins.add(pin);
      if (pins.size >= 6) {
        break;
      }
    }
    if (pins.size >= 6) {
      break;
    }
  }

  if (pins.size === 0) {
    return '';
  }

  return `Parsed document mentions pins: ${[...pins].join(', ')}`;
}

function buildHardwareDraftFacts(identity, args, markdown) {
  const lines = normalizeMarkdownLines(markdown);
  const model = inferModel(identity, args, markdown);
  const pkg = inferPackage(markdown);
  const peripherals = inferPeripherals(markdown);
  const constraints = pickConstraintLines(lines);
  const truths = normalizeDraftList([
    model ? `Parsed document title/model candidate: ${model}` : '',
    pkg ? `Parsed document mentions package ${pkg}` : '',
    ...peripherals.map(item => `Parsed document mentions peripheral ${item.name}`),
    inferPinTruth(lines)
  ]);
  const unknowns = normalizeDraftList([
    model ? '' : 'Model could not be confidently extracted from parsed document',
    pkg ? '' : 'Package string not found in parsed document',
    peripherals.length > 0 ? '' : 'Peripheral list not confidently extracted from parsed document',
    constraints.length > 0 ? '' : 'No explicit timing/electrical constraint lines were extracted'
  ]);

  return {
    mcu: {
      model,
      package: pkg
    },
    peripherals,
    truths,
    constraints,
    unknowns,
    sources: [identity.source_path]
  };
}

function buildRequirementsDraftFacts(identity, args, markdown) {
  const lines = normalizeMarkdownLines(markdown);
  const title = args.title || path.basename(identity.source_path, path.extname(identity.source_path));
  const constraints = pickConstraintLines(lines);
  const acceptance = pickAcceptanceLines(lines);
  const featureLines = normalizeDraftList(
    lines
      .filter(line => /(?:feature|support|mode|function|feature|support|mode)/i.test(line))
      .filter(line => line.length <= 120)
      .slice(0, 6)
  );
  const unknowns = normalizeDraftList([
    constraints.length > 0 ? '' : 'No explicit requirement constraints were extracted from parsed document',
    acceptance.length > 0 ? '' : 'No explicit verification or acceptance lines were extracted'
  ]);

  return {
    goals: normalizeDraftList([`Review parsed document: ${title}`]),
    features: featureLines,
    constraints,
    acceptance,
    unknowns,
    sources: [identity.source_path]
  };
}

function serializeDraftArtifacts(draftArtifacts) {
  return Object.fromEntries(
    Object.entries(draftArtifacts).map(([name, value]) => [name, `${toYaml(value)}\n`])
  );
}

function buildDraftJsonArtifacts(draftArtifacts) {
  const mapped = {};
  for (const [name, value] of Object.entries(draftArtifacts)) {
    mapped[name.replace(/\.yaml$/, '.json')] = value;
  }
  return mapped;
}

function buildDraftFacts(identity, args, markdown) {
  if (!args.to) {
    return {};
  }

  if (args.to === 'hardware') {
    return {
      'facts.hardware.yaml': buildHardwareDraftFacts(identity, args, markdown)
    };
  }

  return {
    'facts.requirements.yaml': buildRequirementsDraftFacts(identity, args, markdown)
  };
}

function normalizeDocAssetPath(rawPath) {
  const normalized = String(rawPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (
    parts.length < 2 ||
    parts[0] !== 'images' ||
    parts.some(part => part === '.' || part === '..')
  ) {
    return '';
  }
  return parts.join('/');
}

function normalizeProviderAssets(assets) {
  const result = [];
  const seen = new Set();

  for (const asset of Array.isArray(assets) ? assets : []) {
    const relativePath = normalizeDocAssetPath(asset && asset.path);
    if (!relativePath || seen.has(relativePath)) {
      continue;
    }
    const rawData = asset && asset.data;
    const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(String(rawData || ''), 'utf8');
    result.push({
      path: relativePath,
      data
    });
    seen.add(relativePath);
  }

  return result;
}

function extractMarkdownImageReferences(markdown) {
  const result = [];
  const seen = new Set();
  const pattern = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;

  while ((match = pattern.exec(String(markdown || ''))) !== null) {
    const rawTarget = String(match[1] || '').trim().replace(/^["'<]+|[>"']+$/g, '');
    const cleanTarget = rawTarget.split(/[?#]/)[0];
    const relativePath = normalizeDocAssetPath(cleanTarget);
    if (!relativePath || seen.has(relativePath)) {
      continue;
    }
    result.push(relativePath);
    seen.add(relativePath);
  }

  return result;
}

function buildDocImageAssetState(projectRoot, cacheDir, markdown, assets) {
  const references = extractMarkdownImageReferences(markdown);
  const restored = normalizeProviderAssets(assets).map(asset => asset.path);
  const available = runtime.unique([
    ...restored,
    ...references.filter(ref => fs.existsSync(path.join(cacheDir, ref)))
  ]);
  const missing = references.filter(ref => !available.includes(ref));
  const status =
    missing.length > 0
      ? (available.length > 0 ? 'partial' : 'missing')
      : references.length > 0 || available.length > 0
        ? 'available'
        : 'not-referenced';

  return {
    status,
    references,
    available,
    missing,
    restored_count: restored.length,
    manifest: path.relative(projectRoot, path.join(cacheDir, 'assets.json')),
    recovery:
      missing.length > 0
        ? 'If this is a MinerU cache, recover images from parse.json metadata.result_zip_url/full_zip_url before trying PDF rendering or web image workarounds.'
        : ''
  };
}

function buildAssetArtifactMap(assets) {
  const mapped = {};
  for (const asset of normalizeProviderAssets(assets)) {
    mapped[asset.path] = asset.data;
  }
  return mapped;
}

function readDocImageAssetState(projectRoot, cacheDir, entry) {
  const manifestPath = path.join(cacheDir, 'assets.json');
  if (fs.existsSync(manifestPath)) {
    return runtime.readJson(manifestPath);
  }

  const artifacts = (entry && entry.artifacts) || {};
  const markdownPath = artifacts.markdown ? path.join(projectRoot, artifacts.markdown) : path.join(cacheDir, 'parse.md');
  const markdown = fs.existsSync(markdownPath) ? fs.readFileSync(markdownPath, 'utf8') : '';
  return buildDocImageAssetState(projectRoot, cacheDir, markdown, []);
}

function emitUiEvent(options, event, payload) {
  const ui = options && options.ui;
  if (!ui || typeof ui.emit !== 'function') {
    return;
  }

  ui.emit(event, payload || {});
}

async function ingestDoc(argv, options) {
  const args = parseArgs(argv || []);
  if (args.help) {
    return { help: true };
  }

  const runtimeConfig = runtime.loadRuntimeConfig(ROOT);
  const projectRoot = path.resolve((options && options.projectRoot) || args.project || process.cwd());
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root not found: ${projectRoot}`);
  }

  const projectConfig = loadProjectConfig(projectRoot, runtimeConfig);
  const integration = (projectConfig.integrations || {})[args.provider];
  if (!integration) {
    throw new Error(`Provider not configured: ${args.provider}`);
  }

  const providers = getProviders(options && options.providerImpls);
  const provider = providers[args.provider];
  if (!provider || typeof provider.parseDocument !== 'function') {
    throw new Error(`Provider not implemented: ${args.provider}`);
  }

  docCache.ensureDocsCache(projectRoot);
  const identity = docCache.buildDocumentIdentity(projectRoot, args.file, {
    provider: args.provider,
    kind: args.kind,
    pages: args.pages,
    language: args.language || integration.language,
    ocr: args.ocr
  });
  const cached = docCache.getCachedEntry(projectRoot, identity.doc_id);
  const cacheDir = docCache.getDocumentDir(projectRoot, identity.doc_id);
  const markdownPath = path.join(cacheDir, 'parse.md');
  const metadataPath = path.join(cacheDir, 'parse.json');

  if (
    cached &&
    !args.force &&
    fs.existsSync(markdownPath) &&
    fs.existsSync(metadataPath)
  ) {
    const imageAssetState = readDocImageAssetState(projectRoot, cacheDir, cached);
    emitUiEvent(options, 'doc-cache-hit', {
      doc_id: identity.doc_id,
      provider: args.provider
    });
    return withDocIngestSemantics(cached, {
      domain: 'doc',
      cached: true,
      provider: args.provider,
      doc_id: identity.doc_id,
      cache_dir: path.relative(projectRoot, cacheDir),
      source: identity.source_path,
      title: cached.title || args.title || path.basename(identity.source_path),
      kind: cached.kind || args.kind,
      intended_to: cached.intended_to || args.to || '',
      project_root: projectRoot,
      apply_ready: buildAutoApplyReadyHint(projectRoot, cached),
      artifacts: cached.artifacts || {},
      image_assets: imageAssetState,
      last_files: runtime.unique([
        cached.artifacts && cached.artifacts.markdown,
        cached.artifacts && cached.artifacts.metadata,
        cached.artifacts && cached.artifacts.assets_manifest,
        path.relative(projectRoot, docCache.getDocsIndexPath(projectRoot))
      ])
    });
  }

  emitUiEvent(options, 'doc-parse-start', {
    doc_id: identity.doc_id,
    provider: args.provider
  });
  const parsed = await provider.parseDocument(
    {
      file_path: identity.absolute_path,
      file_name: path.basename(identity.absolute_path),
      pages: args.pages,
      language: args.language || integration.language,
      ocr: args.ocr,
      enable_table: integration.enable_table,
      enable_formula: integration.enable_formula
    },
    integration,
    options || {}
  );
  emitUiEvent(options, 'doc-parse-finished', {
    doc_id: identity.doc_id,
    provider: args.provider
  });

  const draftArtifacts = buildDraftFacts(identity, {
    ...args,
    title: args.title || path.basename(identity.source_path)
  }, parsed.markdown);
  const serializedDraftArtifacts = serializeDraftArtifacts(draftArtifacts);
  const draftJsonArtifacts = buildDraftJsonArtifacts(draftArtifacts);
  const providerAssets = normalizeProviderAssets(parsed.assets);
  const imageAssetState = buildDocImageAssetState(projectRoot, cacheDir, parsed.markdown, providerAssets);
  const assetArtifactMap = buildAssetArtifactMap(providerAssets);
  const hasImageAssetManifest =
    imageAssetState.status !== 'not-referenced' ||
    providerAssets.length > 0;

  const artifacts = {
    summary: path.relative(projectRoot, path.join(cacheDir, 'summary.json')),
    markdown: path.relative(projectRoot, markdownPath),
    metadata: path.relative(projectRoot, metadataPath),
    source: path.relative(projectRoot, path.join(cacheDir, 'source.json')),
    assets_manifest: hasImageAssetManifest
      ? path.relative(projectRoot, path.join(cacheDir, 'assets.json'))
      : '',
    hardware_facts: draftArtifacts['facts.hardware.yaml']
      ? path.relative(projectRoot, path.join(cacheDir, 'facts.hardware.yaml'))
      : '',
    hardware_facts_json: draftArtifacts['facts.hardware.yaml']
      ? path.relative(projectRoot, path.join(cacheDir, 'facts.hardware.json'))
      : '',
    requirements_facts: draftArtifacts['facts.requirements.yaml']
      ? path.relative(projectRoot, path.join(cacheDir, 'facts.requirements.yaml'))
      : '',
    requirements_facts_json: draftArtifacts['facts.requirements.yaml']
      ? path.relative(projectRoot, path.join(cacheDir, 'facts.requirements.json'))
      : ''
  };
  const summaryEntry = {
    doc_id: identity.doc_id,
    title: args.title || path.basename(identity.source_path),
    kind: args.kind,
    intended_to: args.to || '',
    source: identity.source_path
  };
  const applyReadyHint = buildAutoApplyReadyHint(projectRoot, summaryEntry);

  const agentAnalysis = buildDocAgentAnalysis(
    projectRoot,
    summaryEntry,
    artifacts,
    draftArtifacts['facts.hardware.yaml'] || null
  );
  const recommendedFlow = buildDocRecommendedFlow(summaryEntry, agentAnalysis);
  const handoffProtocol = buildDocHandoffProtocol(summaryEntry, agentAnalysis);

  emitUiEvent(options, 'doc-cache-write', {
    doc_id: identity.doc_id
  });
  docCache.writeDocumentArtifacts(projectRoot, identity.doc_id, {
    'source.json': {
      provider: args.provider,
      kind: args.kind,
      title: args.title || path.basename(identity.source_path),
      intended_to: args.to || '',
      source_path: identity.source_path,
      source_hash: identity.source_hash,
      pages: args.pages || '',
      language: args.language || integration.language,
      ocr: Boolean(args.ocr),
      ingested_at: new Date().toISOString()
    },
    'parse.md': parsed.markdown,
    'parse.json': {
      provider: parsed.provider,
      mode: parsed.mode,
      task_id: parsed.task_id,
      metadata: parsed.metadata
    },
    ...(hasImageAssetManifest ? { 'assets.json': imageAssetState } : {}),
    ...assetArtifactMap,
    'summary.json': {
      status: 'ok',
      domain: 'doc',
      doc_id: identity.doc_id,
      title: args.title || path.basename(identity.source_path),
      kind: args.kind,
      intended_to: args.to || '',
      source_path: identity.source_path,
      truth_write: buildDocTruthSemantics(summaryEntry, artifacts, applyReadyHint).truth_write,
      agent_analysis: agentAnalysis,
      recommended_flow: recommendedFlow,
      handoff_protocol: handoffProtocol
    },
    ...serializedDraftArtifacts,
    ...draftJsonArtifacts
  });

  emitUiEvent(options, 'doc-index-update', {
    doc_id: identity.doc_id
  });
  docCache.upsertDocumentIndex(projectRoot, {
    doc_id: identity.doc_id,
    provider: args.provider,
    kind: args.kind,
    title: args.title || path.basename(identity.source_path),
    intended_to: args.to || '',
    source: identity.source_path,
    source_hash: identity.source_hash,
    pages: args.pages || '',
    cached_at: new Date().toISOString(),
    artifacts
  });

  const cachedEntry = docCache.getCachedEntry(projectRoot, identity.doc_id);

  return withDocIngestSemantics(cachedEntry, {
    domain: 'doc',
    cached: false,
    provider: args.provider,
    doc_id: identity.doc_id,
    source: identity.source_path,
    title: args.title || path.basename(identity.source_path),
    kind: args.kind,
    intended_to: args.to || '',
    cache_dir: path.relative(projectRoot, cacheDir),
    project_root: projectRoot,
    apply_ready: buildAutoApplyReadyHint(projectRoot, docCache.getCachedEntry(projectRoot, identity.doc_id)),
    artifacts,
    image_assets: imageAssetState,
    last_files: runtime.unique([
      artifacts.markdown,
      artifacts.summary,
      artifacts.metadata,
      artifacts.assets_manifest,
      artifacts.hardware_facts,
      artifacts.requirements_facts,
      path.relative(projectRoot, docCache.getDocsIndexPath(projectRoot))
    ])
  });
}

function loadDraftFacts(projectRoot, entry, to) {
  const cacheDir = docCache.getDocumentDir(projectRoot, entry.doc_id);
  const artifactKey = to === 'hardware' ? 'hardware_facts_json' : 'requirements_facts_json';
  const yamlKey = to === 'hardware' ? 'hardware_facts' : 'requirements_facts';
  const relativeJsonPath =
    (entry.artifacts && entry.artifacts[artifactKey]) ||
    path.relative(projectRoot, path.join(cacheDir, `facts.${to}.json`));
  const absoluteJsonPath = path.join(projectRoot, relativeJsonPath);

  if (fs.existsSync(absoluteJsonPath)) {
    return {
      path: relativeJsonPath,
      data: runtime.readJson(absoluteJsonPath)
    };
  }

  const relativeYamlPath =
    (entry.artifacts && entry.artifacts[yamlKey]) ||
    path.relative(projectRoot, path.join(cacheDir, `facts.${to}.yaml`));

  throw new Error(`Draft json not found for ${to}: ${relativeYamlPath}`);
}

function listDocs(projectRoot) {
  const index = docCache.loadDocsIndex(projectRoot);
  const lastDiff = docCache.getLastDiffSelection(projectRoot);
  const presets = (index.session && index.session.diff_presets) || {};
  return {
    documents: (index.documents || []).map(entry => {
      const presetNames = Object.entries(presets)
        .filter(([, value]) => value && value.doc_id === entry.doc_id)
        .map(([name]) => name)
        .sort();

      return {
        doc_id: entry.doc_id,
        provider: entry.provider,
        kind: entry.kind,
        title: entry.title,
        source: entry.source,
        intended_to: entry.intended_to || '',
        pages: entry.pages || '',
        cached_at: entry.cached_at || '',
        last_diff_hit: Boolean(lastDiff && lastDiff.doc_id === entry.doc_id),
        last_diff_to: lastDiff && lastDiff.doc_id === entry.doc_id ? lastDiff.to : '',
        preset_count: presetNames.length,
        preset_names: presetNames.slice(0, DOC_LIST_PRESET_NAME_LIMIT),
        preset_names_more: Math.max(0, presetNames.length - DOC_LIST_PRESET_NAME_LIMIT),
        apply_pending: Boolean(buildAutoApplyReadyHint(projectRoot, entry)),
        applied: entry.applied || {},
        artifacts: entry.artifacts || {}
      };
    })
  };
}

function readScalarLine(content, prefix) {
  const line = String(content || '')
    .split(/\r?\n/)
    .find(item => item.startsWith(prefix));
  if (!line) {
    return '';
  }

  const raw = line.slice(prefix.length).trim();
  if (!raw || raw === '""' || raw === "''") {
    return '';
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return raw.replace(/^['"]|['"]$/g, '');
  }
}

function readListBlock(content, keyLine, itemIndent) {
  const lines = String(content || '').split(/\r?\n/);
  const start = lines.findIndex(line => line === keyLine);
  if (start === -1) {
    return [];
  }

  let end = start + 1;
  while (end < lines.length && lines[end].startsWith(`${itemIndent}- `)) {
    end += 1;
  }

  return lines
    .slice(start + 1, end)
    .map(line => line.replace(`${itemIndent}- `, '').trim())
    .filter(item => item && item !== '""' && item !== "''")
    .map(item => {
      try {
        return JSON.parse(item);
      } catch (error) {
        return item.replace(/^['"]|['"]$/g, '');
      }
    });
}

function loadCurrentHardwareTruth(projectRoot) {
  const filePath = runtime.resolveProjectDataPath(projectRoot, 'hw.yaml');
  const content = fs.existsSync(filePath) ? runtime.readText(filePath) : '';
  return {
    filePath: runtime.getProjectAssetRelativePath('hw.yaml'),
    content,
    data: {
      model: readScalarLine(content, '  model: '),
      package: readScalarLine(content, '  package: '),
      truths: readListBlock(content, 'truths:', '  '),
      constraints: readListBlock(content, 'constraints:', '  '),
      unknowns: readListBlock(content, 'unknowns:', '  '),
      sources: readListBlock(content, '  datasheet:', '    ')
    }
  };
}

function loadCurrentRequirementsTruth(projectRoot) {
  const filePath = runtime.resolveProjectDataPath(projectRoot, 'req.yaml');
  const content = fs.existsSync(filePath) ? runtime.readText(filePath) : '';
  return {
    filePath: runtime.getProjectAssetRelativePath('req.yaml'),
    content,
    data: {
      goals: readListBlock(content, 'goals:', '  '),
      features: readListBlock(content, 'features:', '  '),
      constraints: readListBlock(content, 'constraints:', '  '),
      acceptance: readListBlock(content, 'acceptance:', '  '),
      unknowns: readListBlock(content, 'unknowns:', '  '),
      sources: readListBlock(content, 'sources:', '  ')
    }
  };
}

function buildScalarDiff(field, currentValue, nextValue, force) {
  if (!nextValue) {
    return {
      field,
      action: 'skip',
      reason: 'empty_draft',
      current: currentValue || '',
      next: ''
    };
  }

  if (!currentValue) {
    return {
      field,
      action: 'set',
      current: '',
      next: nextValue
    };
  }

  if (currentValue === nextValue) {
    return {
      field,
      action: 'noop',
      reason: 'same_value',
      current: currentValue,
      next: nextValue
    };
  }

  if (!force) {
    return {
      field,
      action: 'skip',
      reason: 'existing_value_kept',
      current: currentValue,
      next: nextValue
    };
  }

  return {
    field,
    action: 'replace',
    current: currentValue,
    next: nextValue
  };
}

function buildListDiff(field, currentValues, nextValues) {
  const current = runtime.unique(currentValues || []);
  const additions = runtime.unique((nextValues || []).filter(item => !current.includes(item)));

  return {
    field,
    action: additions.length > 0 ? 'append' : 'noop',
    current,
    next: runtime.unique(nextValues || []),
    additions
  };
}

function diffHardwareDraft(projectRoot, draft, force, fields) {
  const selected = normalizeOnlyFields('hardware', fields);
  const current = loadCurrentHardwareTruth(projectRoot).data;
  const data = draft.data || {};
  const result = [];

  if (selected.includes('model')) {
    result.push(buildScalarDiff('model', current.model, (data.mcu && data.mcu.model) || '', force));
  }
  if (selected.includes('package')) {
    result.push(buildScalarDiff('package', current.package, (data.mcu && data.mcu.package) || '', force));
  }
  if (selected.includes('truths')) {
    result.push(buildListDiff('truths', current.truths, data.truths || []));
  }
  if (selected.includes('constraints')) {
    result.push(buildListDiff('constraints', current.constraints, data.constraints || []));
  }
  if (selected.includes('unknowns')) {
    result.push(buildListDiff('unknowns', current.unknowns, data.unknowns || []));
  }
  if (selected.includes('sources')) {
    result.push(buildListDiff('sources', current.sources, data.sources || []));
  }

  return result;
}

function diffRequirementsDraft(projectRoot, draft, force, fields) {
  const selected = normalizeOnlyFields('requirements', fields);
  const current = loadCurrentRequirementsTruth(projectRoot).data;
  const data = draft.data || {};
  const result = [];

  if (selected.includes('goals')) {
    result.push(buildListDiff('goals', current.goals, data.goals || []));
  }
  if (selected.includes('features')) {
    result.push(buildListDiff('features', current.features, data.features || []));
  }
  if (selected.includes('constraints')) {
    result.push(buildListDiff('constraints', current.constraints, data.constraints || []));
  }
  if (selected.includes('acceptance')) {
    result.push(buildListDiff('acceptance', current.acceptance, data.acceptance || []));
  }
  if (selected.includes('unknowns')) {
    result.push(buildListDiff('unknowns', current.unknowns, data.unknowns || []));
  }
  if (selected.includes('sources')) {
    result.push(buildListDiff('sources', current.sources, data.sources || []));
  }

  return result;
}

function diffDoc(projectRoot, docId, to, fields, force) {
  const entry = docCache.getCachedEntry(projectRoot, docId);
  if (!entry) {
    throw new Error(`Document cache entry not found: ${docId}`);
  }

  const draft = loadDraftFacts(projectRoot, entry, to);
  const selectedFields = normalizeOnlyFields(to, fields);
  const changes =
    to === 'hardware'
      ? diffHardwareDraft(projectRoot, draft, force, selectedFields)
      : diffRequirementsDraft(projectRoot, draft, force, selectedFields);

  return {
    doc_id: docId,
    to,
    only: selectedFields,
    force: Boolean(force),
    source: entry.source,
    draft: draft.path,
    target:
      to === 'hardware'
        ? runtime.getProjectAssetRelativePath('hw.yaml')
        : runtime.getProjectAssetRelativePath('req.yaml'),
    changes
  };
}

function rememberLastDiff(projectRoot, diffView) {
  return docCache.setLastDiffSelection(projectRoot, {
    doc_id: diffView.doc_id,
    to: diffView.to,
    only: diffView.only,
    force: diffView.force,
    target: diffView.target,
    draft: diffView.draft,
    recorded_at: new Date().toISOString()
  });
}

function saveDiffPreset(projectRoot, name, diffView) {
  return docCache.setDiffPreset(projectRoot, name, {
    doc_id: diffView.doc_id,
    to: diffView.to,
    only: diffView.only,
    force: diffView.force,
    target: diffView.target,
    draft: diffView.draft
  });
}

function buildDocLastDiffSummary(projectRoot, docId) {
  const lastDiff = docCache.getLastDiffSelection(projectRoot);
  if (!lastDiff) {
    return null;
  }

  return {
    ...lastDiff,
    current_doc: lastDiff.doc_id === docId
  };
}

function buildDocPresetSummaries(projectRoot, docId) {
  const index = docCache.loadDocsIndex(projectRoot);
  const presets = (index.session && index.session.diff_presets) || {};

  return Object.entries(presets)
    .map(([name, value]) => ({
      name,
      doc_id: value.doc_id,
      to: value.to,
      only: value.only || [],
      force: Boolean(value.force),
      target: value.target || '',
      saved_at: value.saved_at || '',
      current_doc: value.doc_id === docId
    }))
    .sort((left, right) => {
      if (left.current_doc !== right.current_doc) {
        return left.current_doc ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}

function buildDocPresetPreview(projectRoot, docId, presetName) {
  if (!presetName) {
    return {
      selected_preset: null,
      preset_diff: null
    };
  }

  const preset = docCache.getDiffPreset(projectRoot, presetName);
  if (!preset) {
    throw new Error(`Diff preset not found: ${presetName}`);
  }

  return {
    selected_preset: {
      name: preset.name,
      doc_id: preset.doc_id,
      to: preset.to,
      only: preset.only || [],
      force: Boolean(preset.force),
      target: preset.target || '',
      saved_at: preset.saved_at || '',
      current_doc: preset.doc_id === docId
    },
    preset_diff: diffDoc(projectRoot, docId, preset.to, preset.only || [], Boolean(preset.force))
  };
}

function buildApplyReadyHint(docId, selectedPreset, presetDiff, enabled) {
  if (!enabled || !selectedPreset || !presetDiff) {
    return null;
  }

  const argv = ['ingest', 'apply', 'doc', docId, '--preset', selectedPreset.name];

  return {
    command: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, argv),
    argv,
    doc_id: docId,
    preset: selectedPreset.name,
    to: presetDiff.to,
    only: presetDiff.only || [],
    target: presetDiff.target || ''
  };
}

function buildAutoApplyReadyHint(projectRoot, entry) {
  if (!entry || !entry.doc_id) {
    return null;
  }

  const to = String(entry.intended_to || '').trim();
  if (!['hardware', 'requirements'].includes(to)) {
    return null;
  }

  const only = normalizeOnlyFields(to, []);
  if (shouldSkipApply(entry, to, only, false)) {
    return null;
  }

  try {
    loadDraftFacts(projectRoot, entry, to);
  } catch {
    return null;
  }

  const argv = ['ingest', 'apply', 'doc', entry.doc_id, '--to', to];

  return {
    command: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, argv),
    argv,
    doc_id: entry.doc_id,
    to,
    only,
    target:
      to === 'hardware'
        ? runtime.getProjectAssetRelativePath('hw.yaml')
        : runtime.getProjectAssetRelativePath('req.yaml'),
    title: entry.title || '',
    source: entry.source || '',
    kind: entry.kind || ''
  };
}

function resolveTruthTarget(to) {
  if (to === 'hardware') {
    return runtime.getProjectAssetRelativePath('hw.yaml');
  }
  if (to === 'requirements') {
    return runtime.getProjectAssetRelativePath('req.yaml');
  }
  return '';
}

function buildDocSourceArtifacts(artifacts) {
  return runtime.unique([
    artifacts && artifacts.summary,
    artifacts && artifacts.markdown,
    artifacts && artifacts.metadata,
    artifacts && artifacts.hardware_facts,
    artifacts && artifacts.hardware_facts_json,
    artifacts && artifacts.requirements_facts,
    artifacts && artifacts.requirements_facts_json
  ].filter(Boolean));
}

function normalizeAnalysisSeed(value) {
  const payload = supportAnalysisCli.buildArtifact({
    chip: String(value || '').trim(),
    model: '',
    vendor: '',
    series: '',
    family: '',
    device: '',
    package: '',
    pinCount: 0,
    architecture: '',
    runtimeModel: 'main_loop_plus_isr'
  });
  return payload && payload.chip_support_analysis && payload.chip_support_analysis.device
    ? payload.chip_support_analysis.device
    : 'chip';
}

function buildDocAnalysisArtifactPath(projectRoot, chipSeed) {
  return path.join(
    runtime.getProjectExtDir(projectRoot),
    'analysis',
    `${normalizeAnalysisSeed(chipSeed)}.json`
  );
}

function buildDocAgentAnalysis(projectRoot, entry, artifacts, explicitHardwareFacts) {
  if (!projectRoot || !entry) {
    return null;
  }

  const intendedTo = String(entry.intended_to || '').trim();
  const kind = String(entry.kind || '').trim().toLowerCase();
  if (intendedTo !== 'hardware' && !['datasheet', 'manual', 'reference'].includes(kind)) {
    return null;
  }

  let draft = null;
  if (!explicitHardwareFacts) {
    try {
      draft = loadDraftFacts(projectRoot, entry, 'hardware');
    } catch {
      draft = null;
    }
  }

  const hardwareFacts = explicitHardwareFacts || (draft && draft.data ? draft.data : {});
  const model = String((hardwareFacts.mcu && hardwareFacts.mcu.model) || '').trim();
  const packageName = String((hardwareFacts.mcu && hardwareFacts.mcu.package) || '').trim();
  const chipSeed =
    model ||
    String(entry.title || '').replace(path.extname(String(entry.title || '')), '').trim() ||
    path.basename(String(entry.source || ''), path.extname(String(entry.source || ''))) ||
    entry.doc_id;
  const artifactPath = path.relative(projectRoot, buildDocAnalysisArtifactPath(projectRoot, chipSeed)).replace(/\\/g, '/');
  const initArgv = ['adapter', 'analysis', 'init', '--chip', chipSeed];
  if (packageName) {
    initArgv.push('--package', packageName);
  }
  const deriveArgv = ['adapter', 'derive', '--from-analysis', artifactPath];
  const initCommand = runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, initArgv);
  const deriveCommand = runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, deriveArgv);

  return {
    required: true,
    status: 'agent-analysis-recommended',
    recommended_agent: 'emb-hw-scout',
    summary: 'Let emb-hw-scout convert the parsed hardware document into a chip-support analysis artifact before deriving adapters.',
    inputs: runtime.unique([
      artifacts && artifacts.markdown,
      artifacts && artifacts.hardware_facts_json,
      artifacts && artifacts.hardware_facts,
      entry.source || ''
    ].filter(Boolean)),
    evidence: {
      model: model || '',
      package: packageName || '',
      truths: Array.isArray(hardwareFacts.truths) ? hardwareFacts.truths.length : 0,
      constraints: Array.isArray(hardwareFacts.constraints) ? hardwareFacts.constraints.length : 0,
      peripherals: Array.isArray(hardwareFacts.peripherals) ? hardwareFacts.peripherals.length : 0
    },
    artifact_path: artifactPath,
    init_command: initCommand,
    init_argv: initArgv,
    derive_command: deriveCommand,
    derive_argv: deriveArgv,
    confirmation_targets: [
      'mcu.vendor',
      'mcu.model',
      'mcu.package',
      'peripherals[]',
      'signals[]',
      'bindings.*'
    ],
    expected_output: [
      'Extract only evidence-backed hardware facts into the analysis artifact.',
      'Mark unsupported bindings explicitly with reason instead of inventing formulas.',
      'Run adapter derive from the artifact after review so adapters stay draft and structured.'
    ],
    cli_hint:
      `Run ${initCommand}, ask emb-hw-scout to fill ${artifactPath} from ${artifacts && artifacts.markdown ? artifacts.markdown : entry.source}, then run ${deriveCommand}.`
  };
}

function buildDocRecommendedFlow(entry, agentAnalysis) {
  const analysis = agentAnalysis && typeof agentAnalysis === 'object' && !Array.isArray(agentAnalysis)
    ? agentAnalysis
    : null;
  const docId = entry && entry.doc_id ? entry.doc_id : '';
  const intendedTo = entry && entry.intended_to ? entry.intended_to : '';

  return {
    id: 'doc-to-chip-support-analysis',
    mode: 'analysis-artifact-first',
    source_kind: intendedTo === 'hardware' ? 'hardware-document' : 'document',
    summary: 'Stage document truth first, then initialize and fill a chip-support analysis artifact before deriving draft adapters.',
    steps: [
      {
        id: 'ingest-doc',
        kind: 'completed',
        doc_id: docId,
        target_domain: intendedTo || ''
      },
      {
        id: 'apply-doc-truth',
        kind: 'command',
        required: intendedTo === 'hardware',
        target: resolveTruthTarget(intendedTo),
        cli: 'ingest apply doc',
        notes: 'Apply staged truth before trusting chip identity-dependent support generation.'
      },
      {
        id: 'support-analysis-init',
        kind: 'command',
        cli: analysis ? analysis.init_command : '',
        argv: analysis ? analysis.init_argv : [],
        artifact_path: analysis ? analysis.artifact_path : ''
      },
      {
        id: 'agent-fill-analysis-artifact',
        kind: 'agent',
        recommended_agent: analysis ? analysis.recommended_agent : '',
        artifact_path: analysis ? analysis.artifact_path : '',
        inputs: analysis ? analysis.inputs : [],
        expected_output: analysis ? analysis.expected_output : []
      },
      {
        id: 'support-derive-from-analysis',
        kind: 'command',
        cli: analysis ? analysis.derive_command : '',
        argv: analysis ? analysis.derive_argv : [],
        artifact_path: analysis ? analysis.artifact_path : ''
      },
      {
        id: 'next',
        kind: 'command',
        cli: runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['next']),
        argv: ['next']
      }
    ]
  };
}

function buildDocHandoffProtocol(entry, agentAnalysis) {
  const analysis = agentAnalysis && typeof agentAnalysis === 'object' && !Array.isArray(agentAnalysis)
    ? agentAnalysis
    : null;
  if (!analysis || !analysis.artifact_path) {
    return null;
  }

  return {
    protocol: 'emb-agent.chip-support-analysis/1',
    source_kind: 'hardware-document',
    doc_id: entry && entry.doc_id ? entry.doc_id : '',
    artifact_path: analysis.artifact_path,
    recommended_agent: analysis.recommended_agent || '',
    commands: {
      init: {
        cli: analysis.init_command || '',
        argv: analysis.init_argv || []
      },
      derive: {
        cli: analysis.derive_command || '',
        argv: analysis.derive_argv || []
      }
    },
    inputs: Array.isArray(analysis.inputs) ? analysis.inputs : [],
    confirmation_targets: Array.isArray(analysis.confirmation_targets) ? analysis.confirmation_targets : [],
    expected_output: Array.isArray(analysis.expected_output) ? analysis.expected_output : [],
    cli_hint: analysis.cli_hint || ''
  };
}

function buildDocTruthSemantics(entry, artifacts, applyReady) {
  const intendedTo = String((entry && entry.intended_to) || '').trim();
  const target = resolveTruthTarget(intendedTo);
  const appliedState = intendedTo ? getAppliedState(entry, intendedTo) : null;
  let status = 'not-routable';

  if (target) {
    status = applyReady
      ? 'ready-to-apply'
      : (appliedState ? 'already-applied' : 'staged');
  }

  return {
    write_mode: target ? 'staged-truth' : 'analysis-only',
    truth_write: {
      direct: false,
      performed: false,
      requires_confirmation: Boolean(applyReady),
      status,
      domain: intendedTo,
      target,
      apply_via: applyReady ? 'ingest apply doc' : '',
      source_artifacts: buildDocSourceArtifacts(artifacts)
    }
  };
}

function buildDocApplySemantics(to, target, performed, status) {
  return {
    write_mode: 'truth-write',
    truth_write: {
      direct: true,
      performed: Boolean(performed),
      requires_confirmation: false,
      status: status || (performed ? 'written' : 'skipped'),
      domain: to,
      target
    }
  };
}

function withDocIngestSemantics(entry, payload) {
  const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const applyReady = Object.prototype.hasOwnProperty.call(base, 'apply_ready') ? base.apply_ready : null;
  const projectRoot = path.resolve(base.project_root || process.cwd());
  const agentAnalysis = buildDocAgentAnalysis(projectRoot, entry, base.artifacts || {});
  return {
    ...buildDocTruthSemantics(entry, base.artifacts || {}, applyReady),
    agent_analysis: agentAnalysis,
    recommended_flow: buildDocRecommendedFlow(entry, agentAnalysis),
    handoff_protocol: buildDocHandoffProtocol(entry, agentAnalysis),
    ...base
  };
}

function findPendingDocApply(projectRoot) {
  const index = docCache.loadDocsIndex(projectRoot);

  for (const entry of index.documents || []) {
    const hint = buildAutoApplyReadyHint(projectRoot, entry);
    if (hint) {
      return hint;
    }
  }

  return null;
}

function showDoc(projectRoot, docId, options) {
  const entry = docCache.getCachedEntry(projectRoot, docId);
  if (!entry) {
    throw new Error(`Document cache entry not found: ${docId}`);
  }
  const config = options || {};

  const cacheDir = docCache.getDocumentDir(projectRoot, entry.doc_id);
  const sourceInfoPath = path.join(cacheDir, 'source.json');
  const parseInfoPath = path.join(cacheDir, 'parse.json');
  const artifacts = entry.artifacts || {};
  const artifactState = Object.fromEntries(
    Object.entries(artifacts)
      .filter(([, relPath]) => relPath)
      .map(([name, relPath]) => [name, fs.existsSync(path.join(projectRoot, relPath))])
  );
  const presetPreview = buildDocPresetPreview(projectRoot, docId, config.preset || '');
  const applyReady = buildApplyReadyHint(
    docId,
    presetPreview.selected_preset,
    presetPreview.preset_diff,
    Boolean(config.applyReady)
  );
  const autoApplyReady = buildAutoApplyReadyHint(projectRoot, entry);

  return {
    entry,
    cache_dir: path.relative(projectRoot, cacheDir),
    summary_info:
      artifacts.summary && fs.existsSync(path.join(projectRoot, artifacts.summary))
        ? runtime.readJson(path.join(projectRoot, artifacts.summary))
        : null,
    source_info: fs.existsSync(sourceInfoPath) ? runtime.readJson(sourceInfoPath) : null,
    parse_info: fs.existsSync(parseInfoPath) ? runtime.readJson(parseInfoPath) : null,
    artifact_state: artifactState,
    image_assets: readDocImageAssetState(projectRoot, cacheDir, entry),
    last_diff: buildDocLastDiffSummary(projectRoot, docId),
    diff_presets: buildDocPresetSummaries(projectRoot, docId),
    selected_preset: presetPreview.selected_preset,
    preset_diff: presetPreview.preset_diff,
    auto_apply_ready: autoApplyReady,
    apply_ready: applyReady
  };
}

function getAppliedState(entry, to) {
  return (entry.applied && entry.applied[to]) || null;
}

function getAllowedApplyFields(to) {
  if (to === 'hardware') {
    return ['model', 'package', 'truths', 'constraints', 'unknowns', 'sources'];
  }

  return ['goals', 'features', 'constraints', 'acceptance', 'unknowns', 'sources'];
}

function normalizeOnlyFields(to, only) {
  const allowed = getAllowedApplyFields(to);
  const selected = runtime.unique((only || []).filter(Boolean));

  if (selected.length === 0) {
    return allowed;
  }

  const invalid = selected.filter(item => !allowed.includes(item));
  if (invalid.length > 0) {
    throw new Error(`Unsupported --only fields for ${to}: ${invalid.join(', ')}`);
  }

  return selected;
}

function buildAppliedSignature(sourceHash, fields) {
  return `${sourceHash || ''}::${(fields || []).slice().sort().join(',')}`;
}

function shouldSkipApply(entry, to, fields, force) {
  if (force) {
    return false;
  }

  const applied = getAppliedState(entry, to);
  if (!applied) {
    return false;
  }

  return applied.signature === buildAppliedSignature(entry.source_hash, fields);
}

function recordAppliedState(projectRoot, entry, to, fields, draftPath, target) {
  const appliedAt = new Date().toISOString();
  return docCache.updateDocumentEntry(projectRoot, entry.doc_id, current => ({
    ...current,
    applied: {
      ...(current.applied || {}),
      [to]: {
        source_hash: current.source_hash || '',
        signature: buildAppliedSignature(current.source_hash || '', fields),
        applied_at: appliedAt,
        fields: fields.slice().sort(),
        draft: draftPath,
        target
      }
    }
  }));
}

function resolveApplySelection(projectRoot, args) {
  if (args.preset) {
    const preset = docCache.getDiffPreset(projectRoot, args.preset);
    if (!preset) {
      throw new Error(`Diff preset not found: ${args.preset}`);
    }

    return {
      to: preset.to,
      only: normalizeOnlyFields(preset.to, preset.only),
      force: Boolean(preset.force),
      fromLastDiff: false,
      replayedDiff: null,
      fromPreset: true,
      replayedPreset: preset
    };
  }

  if (!args.fromLastDiff) {
    return {
      to: args.to,
      only: normalizeOnlyFields(args.to, args.only),
      force: Boolean(args.force),
      fromLastDiff: false,
      replayedDiff: null,
      fromPreset: false,
      replayedPreset: null
    };
  }

  const lastDiff = docCache.getLastDiffSelection(projectRoot);
  if (!lastDiff) {
    throw new Error('No cached doc diff selection found. Run `doc diff` first.');
  }
  if (lastDiff.doc_id !== args.docId) {
    throw new Error(
      `Cached doc diff belongs to ${lastDiff.doc_id}, not ${args.docId}. Run \`doc diff ${args.docId}\` first.`
    );
  }

  return {
    to: lastDiff.to,
    only: normalizeOnlyFields(lastDiff.to, lastDiff.only),
    force: Boolean(lastDiff.force),
    fromLastDiff: true,
    replayedDiff: lastDiff,
    fromPreset: false,
    replayedPreset: null
  };
}

function applyHardwareDraft(projectRoot, draft, force, fields) {
  const data = draft.data || {};
  const selected = new Set(normalizeOnlyFields('hardware', fields));
  return ingestTruthCli.ingestHardware(projectRoot, {
    mcu: selected.has('model') ? (data.mcu && data.mcu.model) || '' : '',
    package: selected.has('package') ? (data.mcu && data.mcu.package) || '' : '',
    board: '',
    target: '',
    truths: selected.has('truths') ? data.truths || [] : [],
    constraints: selected.has('constraints') ? data.constraints || [] : [],
    unknowns: selected.has('unknowns') ? data.unknowns || [] : [],
    sources: selected.has('sources') ? data.sources || [] : [],
    force: Boolean(force)
  });
}

function applyRequirementsDraft(projectRoot, draft, force, fields) {
  const data = draft.data || {};
  const selected = new Set(normalizeOnlyFields('requirements', fields));
  return ingestTruthCli.ingestRequirements(projectRoot, {
    goals: selected.has('goals') ? data.goals || [] : [],
    features: selected.has('features') ? data.features || [] : [],
    constraints: selected.has('constraints') ? data.constraints || [] : [],
    acceptance: selected.has('acceptance') ? data.acceptance || [] : [],
    failurePolicy: [],
    unknowns: selected.has('unknowns') ? data.unknowns || [] : [],
    sources: selected.has('sources') ? data.sources || [] : [],
    force: Boolean(force)
  });
}

function applyDocPermission(result, projectConfig, actionName, explicitConfirmation) {
  const base = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const permissionDecision = permissionGateHelpers.evaluateExecutionPermission({
    action_kind: 'write',
    action_name: actionName,
    risk: 'normal',
    explicit_confirmation: explicitConfirmation === true,
    permissions: (projectConfig && projectConfig.permissions) || {}
  });

  return permissionGateHelpers.applyPermissionDecision(base, permissionDecision);
}

async function applyDoc(argv, options) {
  const args = parseApplyArgs(argv || []);
  if (args.help) {
    return { help: true };
  }

  const runtimeConfig = runtime.loadRuntimeConfig(ROOT);
  const projectRoot = path.resolve((options && options.projectRoot) || args.project || process.cwd());
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root not found: ${projectRoot}`);
  }
  const projectConfig = runtime.loadProjectConfig(projectRoot, runtimeConfig);

  if (!args.docId) {
    args.docId = docCache.getLatestDocId(projectRoot) || '';
  }
  const entry = docCache.getCachedEntry(projectRoot, args.docId);
  if (!entry) {
    throw new Error(`Document cache entry not found: ${args.docId || '(no doc cached)'}`);
  }
  const resolvedApply = resolveApplySelection(projectRoot, args);
  const truthFile =
    resolvedApply.to === 'hardware'
      ? runtime.getProjectAssetRelativePath('hw.yaml')
      : runtime.getProjectAssetRelativePath('req.yaml');
  const draft = loadDraftFacts(projectRoot, entry, resolvedApply.to);
  const selectedFields = resolvedApply.only;
  const actionName = resolvedApply.to === 'hardware' ? 'doc-apply-hardware' : 'doc-apply-requirements';
  const blocked = applyDocPermission({
    ...buildDocApplySemantics(resolvedApply.to, truthFile, false, 'permission-pending'),
    domain: `doc-${resolvedApply.to}`,
    status: 'permission-pending',
    applied_from: args.docId,
    provider: entry.provider,
    source: entry.source,
    draft: draft.path,
    target: truthFile,
    only: selectedFields,
    from_last_diff: resolvedApply.fromLastDiff,
    from_preset: resolvedApply.fromPreset,
    replayed_diff: resolvedApply.replayedDiff,
    replayed_preset: resolvedApply.replayedPreset
  }, projectConfig, actionName, args.explicit_confirmation);

  if (blocked.permission_decision && blocked.permission_decision.decision !== 'allow') {
    return blocked;
  }

  emitUiEvent(options, 'doc-apply-start', {
    doc_id: args.docId,
    to: resolvedApply.to
  });
  if (shouldSkipApply(entry, resolvedApply.to, selectedFields, resolvedApply.force)) {
    return applyDocPermission({
      ...buildDocApplySemantics(resolvedApply.to, truthFile, false, 'already-applied'),
      domain: `doc-${resolvedApply.to}`,
      skipped: true,
      reason: 'already_applied',
      applied_from: args.docId,
      provider: entry.provider,
      source: entry.source,
      draft: draft.path,
      target: truthFile,
      only: selectedFields,
      from_last_diff: resolvedApply.fromLastDiff,
      from_preset: resolvedApply.fromPreset,
      replayed_diff: resolvedApply.replayedDiff,
      replayed_preset: resolvedApply.replayedPreset,
      applied: getAppliedState(entry, resolvedApply.to),
      last_files: runtime.unique([
        truthFile,
        draft.path,
        entry.artifacts && entry.artifacts.markdown,
        entry.artifacts && entry.artifacts.metadata
      ])
    }, projectConfig, actionName, args.explicit_confirmation);
  }

  const applied =
    resolvedApply.to === 'hardware'
      ? applyHardwareDraft(projectRoot, draft, resolvedApply.force, selectedFields)
      : applyRequirementsDraft(projectRoot, draft, resolvedApply.force, selectedFields);
  const appliedEntry = recordAppliedState(
    projectRoot,
    entry,
    resolvedApply.to,
    selectedFields,
    draft.path,
    truthFile
  );

  return applyDocPermission({
    ...buildDocApplySemantics(resolvedApply.to, truthFile, true, 'written'),
    domain: `doc-${resolvedApply.to}`,
    applied_from: args.docId,
    provider: entry.provider,
    source: entry.source,
    draft: draft.path,
    target: truthFile,
    only: selectedFields,
    from_last_diff: resolvedApply.fromLastDiff,
    from_preset: resolvedApply.fromPreset,
    replayed_diff: resolvedApply.replayedDiff,
    replayed_preset: resolvedApply.replayedPreset,
    updated: applied.updated,
    applied: appliedEntry && appliedEntry.applied ? appliedEntry.applied[resolvedApply.to] : null,
    last_files: runtime.unique([
      truthFile,
      draft.path,
      entry.artifacts && entry.artifacts.markdown,
      entry.artifacts && entry.artifacts.metadata
    ])
  }, projectConfig, actionName, args.explicit_confirmation);
}

function main(argv) {
  const input = argv || process.argv.slice(2);
  const runner =
    input[0] === 'apply'
      ? applyDoc(input.slice(1))
      : (() => {
          const args = parseArgs(input);
          if (args.help) {
            usage();
            return Promise.resolve(null);
          }
          return ingestDoc(input);
        })();

  runner
    .then(result => {
      if (!result) {
        return;
      }
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    })
    .catch(error => {
      process.stderr.write(`ingest-doc error: ${error.message}\n`);
      process.exit(1);
    });
}

module.exports = {
  applyDoc,
  applyHardwareDraft,
  applyRequirementsDraft,
  buildDraftFacts,
  buildDraftJsonArtifacts,
  buildHardwareDraftFacts,
  buildRequirementsDraftFacts,
  diffDoc,
  diffHardwareDraft,
  diffRequirementsDraft,
  findPendingDocApply,
  getProviders,
  ingestDoc,
  listDocs,
  loadProjectConfig,
  loadDraftFacts,
  main,
  normalizeMarkdownLines,
  parseDiffArgs,
  parseShowArgs,
  parseApplyArgs,
  parseArgs,
  normalizeOnlyFields,
  rememberLastDiff,
  saveDiffPreset,
  serializeDraftArtifacts,
  showDoc,
  toYaml
};

if (require.main === module) {
  main(process.argv.slice(2));
}
