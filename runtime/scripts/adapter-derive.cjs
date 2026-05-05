#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const docCache = require(path.join(ROOT, 'lib', 'doc-cache.cjs'));
const adapterQualityHelpers = require(path.join(ROOT, 'lib', 'adapter-quality.cjs'));

function usage() {
  process.stdout.write(
    [
      'adapter-derive usage:',
      '  node scripts/adapter-derive.cjs --family <slug> --device <slug> --chip <slug>',
      '    [--from-project] [--from-doc <doc-id>] [--from-analysis <path>]',
      '    [--tool <name>] [--vendor <name>] [--series <name>] [--package <name>]',
      '    [--pin-count <n>] [--architecture <text>] [--runtime-model <name>] [--confirm]',
      '    [--target project|runtime] [--output-root <path>] [--project <path>] [--force]'
    ].join('\n') + '\n'
  );
}

function ensureNonEmpty(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`Missing value for ${label}`);
  }
  return normalized;
}

function parseArgs(argv) {
  const result = {
    family: '',
    device: '',
    chip: '',
    vendor: '',
    series: '',
    package: '',
    pinCount: 0,
    architecture: '',
    runtimeModel: 'main_loop_plus_isr',
    target: 'project',
    outputRoot: '',
    projectRoot: '',
    force: false,
    explicit_confirmation: false,
    fromProject: false,
    fromDoc: '',
    fromAnalysis: '',
    tools: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--family') {
      result.family = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--device') {
      result.device = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--chip') {
      result.chip = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--tool') {
      result.tools.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--from-project') {
      result.fromProject = true;
      continue;
    }
    if (token === '--from-doc') {
      result.fromDoc = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--from-analysis') {
      result.fromAnalysis = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--vendor') {
      result.vendor = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--series') {
      result.series = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--package') {
      result.package = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--pin-count') {
      result.pinCount = Number(argv[index + 1] || 0);
      index += 1;
      continue;
    }
    if (token === '--architecture') {
      result.architecture = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--runtime-model') {
      result.runtimeModel = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--target') {
      result.target = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--output-root') {
      result.outputRoot = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--project') {
      result.projectRoot = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--force') {
      result.force = true;
      continue;
    }
    if (token === '--confirm') {
      result.explicit_confirmation = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (result.help) {
    return result;
  }

  result.runtimeModel = ensureNonEmpty(result.runtimeModel, '--runtime-model');
  result.target = ensureNonEmpty(result.target || 'project', '--target');
  result.outputRoot = String(result.outputRoot || '').trim();

  if (!result.fromProject && !result.fromDoc && !result.fromAnalysis) {
    result.family = ensureNonEmpty(result.family, '--family');
    result.device = ensureNonEmpty(result.device, '--device');
    result.chip = ensureNonEmpty(result.chip, '--chip');
  }
  if (result.fromDoc) {
    result.fromDoc = ensureNonEmpty(result.fromDoc, '--from-doc');
  }
  if (result.fromAnalysis) {
    result.fromAnalysis = ensureNonEmpty(result.fromAnalysis, '--from-analysis');
  }
  if (!['project', 'runtime'].includes(result.target) && !result.outputRoot) {
    throw new Error('--target must be project or runtime');
  }
  if (result.outputRoot) {
    result.target = 'path';
  }
  if (result.pinCount !== 0 && (!Number.isInteger(result.pinCount) || result.pinCount < 1)) {
    throw new Error('--pin-count must be a positive integer');
  }

  result.tools = runtime.unique(result.tools.filter(Boolean).map(name => ensureNonEmpty(name, '--tool')));

  return result;
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function compactSlug(value) {
  return normalizeSlug(value).replace(/-/g, '');
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
  } catch {
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
      } catch {
        return item.replace(/^['"]|['"]$/g, '');
      }
    });
}

function parseYamlObjectLine(line, prefix) {
  const trimmed = String(line || '').slice(prefix.length).trim();
  const match = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
  if (!match) {
    return null;
  }

  const key = match[1];
  const raw = match[2] || '';
  let value = raw;

  if (raw && raw !== '""' && raw !== "''") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw.replace(/^['"]|['"]$/g, '');
    }
  } else {
    value = '';
  }

  return { key, value };
}

function readObjectList(content, keyLine, listIndent) {
  const lines = String(content || '').split(/\r?\n/);
  const start = lines.findIndex(line => line === keyLine);
  if (start === -1) {
    return [];
  }

  const entries = [];
  let current = null;

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim()) {
      continue;
    }
    if (!line.startsWith(listIndent)) {
      break;
    }

    if (line.startsWith(`${listIndent}- `)) {
      if (current && Object.values(current).some(Boolean)) {
        entries.push(current);
      }
      current = {};
      const parsed = parseYamlObjectLine(line, `${listIndent}- `);
      if (parsed) {
        current[parsed.key] = parsed.value;
      }
      continue;
    }

    if (current && line.startsWith(`${listIndent}  `)) {
      const parsed = parseYamlObjectLine(line, `${listIndent}  `);
      if (parsed) {
        current[parsed.key] = parsed.value;
      }
    }
  }

  if (current && Object.values(current).some(Boolean)) {
    entries.push(current);
  }

  return entries;
}

function loadProjectHardwareTruth(projectRoot) {
  const filePath = runtime.resolveProjectDataPath(projectRoot, 'hw.yaml');
  const content = fs.existsSync(filePath) ? runtime.readText(filePath) : '';

  return {
    path: runtime.getProjectAssetRelativePath('hw.yaml'),
    data: {
      vendor: readScalarLine(content, '  vendor: '),
      model: readScalarLine(content, '  model: '),
      package: readScalarLine(content, '  package: '),
      truths: readListBlock(content, 'truths:', '  '),
      constraints: readListBlock(content, 'constraints:', '  '),
      unknowns: readListBlock(content, 'unknowns:', '  '),
      sources: readListBlock(content, '  datasheet:', '    '),
      signals: readObjectList(content, 'signals:', '  '),
      peripherals: readObjectList(content, 'peripherals:', '  ')
    }
  };
}

function loadDocHardwareDraft(projectRoot, docId) {
  const entry = docCache.getCachedEntry(projectRoot, docId);
  if (!entry) {
    throw new Error(`Document not found: ${docId}`);
  }

  const relativePath =
    (entry.artifacts && entry.artifacts.hardware_facts_json) ||
    path.relative(projectRoot, path.join(docCache.getDocumentDir(projectRoot, docId), 'facts.hardware.json'));
  const absolutePath = path.join(projectRoot, relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Hardware draft facts not found for doc ${docId}`);
  }

  return {
    entry,
    path: relativePath,
    data: runtime.readJson(absolutePath)
  };
}

function resolveProjectInputPath(projectRoot, inputPath) {
  const normalized = ensureNonEmpty(inputPath, 'input path');
  return path.isAbsolute(normalized) ? normalized : path.resolve(projectRoot, normalized);
}

function selectAnalysisPayload(rawArtifact) {
  if (!rawArtifact || typeof rawArtifact !== 'object' || Array.isArray(rawArtifact)) {
    throw new Error('Analysis artifact must be a JSON object');
  }

  if (rawArtifact.chip_support_analysis && typeof rawArtifact.chip_support_analysis === 'object') {
    return rawArtifact.chip_support_analysis;
  }

  if (rawArtifact.analysis && typeof rawArtifact.analysis === 'object') {
    return rawArtifact.analysis;
  }

  return rawArtifact;
}

function pushAnalysisValidationError(errors, field, message) {
  errors.push(`${field} ${message}`);
}

function validateOptionalAnalysisString(container, key, errors) {
  if (!container || !Object.prototype.hasOwnProperty.call(container, key)) {
    return;
  }
  if (typeof container[key] !== 'string') {
    pushAnalysisValidationError(errors, key, 'must be a string');
  }
}

function validateOptionalAnalysisStringList(container, key, errors) {
  if (!container || !Object.prototype.hasOwnProperty.call(container, key)) {
    return;
  }

  const value = container[key];
  if (!Array.isArray(value)) {
    pushAnalysisValidationError(errors, key, 'must be an array of strings');
    return;
  }

  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      pushAnalysisValidationError(errors, `${key}[${index}]`, 'must be a string');
    }
  });
}

function validateAnalysisDocs(docs, errors) {
  if (docs === undefined) {
    return;
  }
  if (!Array.isArray(docs)) {
    pushAnalysisValidationError(errors, 'docs', 'must be an array');
    return;
  }

  docs.forEach((item, index) => {
    if (typeof item === 'string') {
      return;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      pushAnalysisValidationError(errors, `docs[${index}]`, 'must be a string or object');
      return;
    }
    if (typeof item.id !== 'string' || !String(item.id).trim()) {
      pushAnalysisValidationError(errors, `docs[${index}].id`, 'must be a non-empty string');
    }
    validateOptionalAnalysisString(item, 'kind', errors);
    validateOptionalAnalysisString(item, 'title', errors);
    validateOptionalAnalysisStringList(item, 'lookup_keys', errors);
    validateOptionalAnalysisStringList(item, 'notes', errors);
  });
}

function validateAnalysisSignals(signals, errors) {
  if (signals === undefined) {
    return;
  }
  if (!Array.isArray(signals)) {
    pushAnalysisValidationError(errors, 'signals', 'must be an array');
    return;
  }

  signals.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      pushAnalysisValidationError(errors, `signals[${index}]`, 'must be an object');
      return;
    }
    ['name', 'pin', 'direction', 'default_state', 'usage', 'note'].forEach(key => {
      validateOptionalAnalysisString(item, key, errors);
    });
    if (Object.prototype.hasOwnProperty.call(item, 'confirmed') && typeof item.confirmed !== 'boolean') {
      pushAnalysisValidationError(errors, `signals[${index}].confirmed`, 'must be a boolean');
    }
  });
}

function validateAnalysisPeripherals(peripherals, errors) {
  if (peripherals === undefined) {
    return;
  }
  if (!Array.isArray(peripherals)) {
    pushAnalysisValidationError(errors, 'peripherals', 'must be an array');
    return;
  }

  peripherals.forEach((item, index) => {
    if (typeof item === 'string') {
      return;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      pushAnalysisValidationError(errors, `peripherals[${index}]`, 'must be a string or object');
      return;
    }
    if (typeof item.name !== 'string' || !String(item.name).trim()) {
      pushAnalysisValidationError(errors, `peripherals[${index}].name`, 'must be a non-empty string');
    }
    validateOptionalAnalysisString(item, 'usage', errors);
  });
}

function validateAnalysisBindings(bindings, errors) {
  if (bindings === undefined) {
    return;
  }
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
    pushAnalysisValidationError(errors, 'bindings', 'must be an object');
    return;
  }

  Object.entries(bindings).forEach(([toolName, binding]) => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      pushAnalysisValidationError(errors, `bindings.${toolName}`, 'must be an object');
      return;
    }
    if (typeof binding.algorithm !== 'string' || !String(binding.algorithm).trim()) {
      pushAnalysisValidationError(errors, `bindings.${toolName}.algorithm`, 'must be a non-empty string');
      return;
    }
    if (
      String(binding.algorithm).trim() === 'unsupported' &&
      (typeof binding.reason !== 'string' || !String(binding.reason).trim())
    ) {
      pushAnalysisValidationError(errors, `bindings.${toolName}.reason`, 'is required when algorithm is unsupported');
    }
    if (
      Object.prototype.hasOwnProperty.call(binding, 'params') &&
      (!binding.params || typeof binding.params !== 'object' || Array.isArray(binding.params))
    ) {
      pushAnalysisValidationError(errors, `bindings.${toolName}.params`, 'must be an object');
    }
    validateOptionalAnalysisString(binding, 'reason', errors);
    validateOptionalAnalysisStringList(binding, 'evidence', errors);
    validateOptionalAnalysisStringList(binding, 'notes', errors);
  });
}

function validateAnalysisArtifact(rawArtifact, payload, artifactPath) {
  const errors = [];

  if (Object.prototype.hasOwnProperty.call(rawArtifact, '$schema') && typeof rawArtifact.$schema !== 'string') {
    pushAnalysisValidationError(errors, '$schema', 'must be a string');
  }
  if (
    Object.prototype.hasOwnProperty.call(rawArtifact, 'chip_support_analysis') &&
    (!rawArtifact.chip_support_analysis || typeof rawArtifact.chip_support_analysis !== 'object' || Array.isArray(rawArtifact.chip_support_analysis))
  ) {
    pushAnalysisValidationError(errors, 'chip_support_analysis', 'must be an object');
  }
  if (
    Object.prototype.hasOwnProperty.call(rawArtifact, 'analysis') &&
    (!rawArtifact.analysis || typeof rawArtifact.analysis !== 'object' || Array.isArray(rawArtifact.analysis))
  ) {
    pushAnalysisValidationError(errors, 'analysis', 'must be an object');
  }

  ['vendor', 'series', 'model', 'family', 'device', 'chip', 'package', 'architecture', 'runtime_model', 'runtimeModel']
    .forEach(key => validateOptionalAnalysisString(payload, key, errors));
  ['tools', 'capabilities', 'truths', 'constraints', 'unknowns', 'notes']
    .forEach(key => validateOptionalAnalysisStringList(payload, key, errors));

  const pinCountValue =
    Object.prototype.hasOwnProperty.call(payload, 'pin_count')
      ? payload.pin_count
      : payload.pinCount;
  if (pinCountValue !== undefined && (!Number.isInteger(pinCountValue) || pinCountValue < 0)) {
    pushAnalysisValidationError(errors, 'pin_count', 'must be a non-negative integer');
  }

  validateAnalysisDocs(payload.docs, errors);
  validateAnalysisSignals(payload.signals, errors);
  validateAnalysisPeripherals(payload.peripherals, errors);
  validateAnalysisBindings(payload.bindings, errors);

  const identityFields = runtime.unique(
    [payload.model, payload.device, payload.chip, payload.chip_model, payload.part]
      .map(value => String(value || '').trim())
      .filter(Boolean)
  );
  if (identityFields.length === 0) {
    pushAnalysisValidationError(errors, 'identity', 'must provide at least one of model, device, or chip');
  }

  if (errors.length > 0) {
    throw new Error(`Analysis artifact validation failed for ${artifactPath}: ${errors.slice(0, 8).join('; ')}`);
  }
}

function normalizeAnalysisDocs(docs) {
  return (Array.isArray(docs) ? docs : [])
    .map(item => {
      if (typeof item === 'string') {
        const docId = String(item).trim();
        if (!docId) {
          return null;
        }
        return {
          id: docId,
          kind: 'analysis',
          title: docId,
          lookup_keys: [],
          notes: []
        };
      }

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }

      const docId = String(item.id || '').trim();
      if (!docId) {
        return null;
      }

      return {
        id: docId,
        kind: String(item.kind || 'analysis').trim() || 'analysis',
        title: String(item.title || docId).trim() || docId,
        lookup_keys: runtime.unique(
          (Array.isArray(item.lookup_keys) ? item.lookup_keys : [])
            .map(value => String(value || '').trim())
            .filter(Boolean)
        ),
        notes: runtime.unique(
          (Array.isArray(item.notes) ? item.notes : [])
            .map(value => String(value || '').trim())
            .filter(Boolean)
        )
      };
    })
    .filter(Boolean);
}

function normalizePeripherals(peripherals) {
  return uniqueObjectsByName(
    (Array.isArray(peripherals) ? peripherals : [])
      .map(item => {
        if (typeof item === 'string') {
          const name = String(item).trim();
          return name ? { name, usage: '' } : null;
        }

        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }

        const name = String(item.name || '').trim();
        if (!name) {
          return null;
        }

        return {
          name,
          usage: String(item.usage || '').trim()
        };
      })
      .filter(Boolean)
  );
}

function normalizeStringList(values) {
  return runtime.unique(
    (Array.isArray(values) ? values : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  );
}

function buildAutoBindingParams(toolName, rawBinding) {
  const notes = normalizeStringList(rawBinding && rawBinding.notes);
  const formulas = (rawBinding && rawBinding.formulas && typeof rawBinding.formulas === 'object')
    ? rawBinding.formulas : {};
  const params = {};

  if (toolName === 'pwm-calc') {
    const prescalerVals = [];
    const psPatterns = [
      /prescaler\s*[∈{]\s*([\d,\s]+)\s*[}]?/i,
      /divider\s*[∈{]\s*([\d,\s]+)\s*[}]?/i,
      /CLKDIV\s*[∈{]\s*([\d,\s]+)\s*[}]?/i
    ];
    for (const pat of psPatterns) {
      const m = notes.join(' ').match(pat);
      if (m) {
        m[1].split(/[\s,]+/).forEach(v => { const n = Number(v); if (n > 0) prescalerVals.push(n); });
      }
    }
    if (prescalerVals.length > 0) {
      params.prescaler_options = prescalerVals.sort((a, b) => a - b);
    }

    const resMatch = notes.join(' ').match(/PWM.*resolution.*?(\d+)\s*-?\s*bit/i);
    if (resMatch) {
      const bits = Number(resMatch[1]);
      if (bits > 0) {
        params.period_bits = [bits];
        params.counter_bits = [bits];
        params.period_max = (2 ** bits) - 1;
      }
    }

    const periodMatch = notes.join(' ').match(/(?:period|PWMT)\s*[∈[]\s*\[\s*0\s*,\s*(\d+)\s*\]/i);
    if (periodMatch && !params.period_max) {
      const max = Number(periodMatch[1]);
      if (max > 0) params.period_max = max;
    }
  }

  if (toolName === 'timer-calc') {
    const bitMatch = notes.join(' ').match(/(\d+)\s*-bit/i);
    if (bitMatch) {
      params.counter_bits = [Number(bitMatch[1])];
    }
  }

  return params;
}

function normalizeProvidedBindings(bindings, fallbackDevice) {
  const input = bindings && typeof bindings === 'object' && !Array.isArray(bindings) ? bindings : {};
  const output = {};

  Object.entries(input).forEach(([toolName, rawBinding]) => {
    const normalizedTool = String(toolName || '').trim();
    if (!normalizedTool || !rawBinding || typeof rawBinding !== 'object' || Array.isArray(rawBinding)) {
      return;
    }

    const algorithm = String(rawBinding.algorithm || '').trim();
    if (!algorithm) {
      return;
    }

    if (algorithm === 'unsupported') {
      output[normalizedTool] = {
        algorithm: 'unsupported',
        reason: String(rawBinding.reason || '').trim() || 'Marked unsupported by analysis artifact.'
      };
      return;
    }

    const baseParams =
      rawBinding.params && typeof rawBinding.params === 'object' && !Array.isArray(rawBinding.params)
        ? rawBinding.params
        : {};
    const autoParams = buildAutoBindingParams(normalizedTool, rawBinding);
    output[normalizedTool] = {
      algorithm: algorithm || `${fallbackDevice}-${slugSuffix(normalizedTool)}`,
      draft: true,
      params: Object.keys(autoParams).length > 0 ? { ...autoParams, ...baseParams } : baseParams,
      evidence: normalizeStringList(rawBinding.evidence),
      notes: buildBindingNotes(
        normalizeStringList(rawBinding.notes),
        ['Binding proposal imported from analysis artifact.']
      )
    };
  });

  return output;
}

function loadAnalysisArtifact(projectRoot, artifactPath) {
  const absolutePath = resolveProjectInputPath(projectRoot, artifactPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Analysis artifact not found: ${artifactPath}`);
  }

  const rawArtifact = runtime.readJson(absolutePath);
  const payload = selectAnalysisPayload(rawArtifact);
  validateAnalysisArtifact(rawArtifact, payload, artifactPath);
  const model = String(payload.model || payload.chip_model || payload.part || '').trim();
  const packageName = String(payload.package || payload.package_name || '').trim();
  const capabilities = normalizeStringList(payload.capabilities);
  const peripherals = normalizePeripherals([
    ...(Array.isArray(payload.peripherals) ? payload.peripherals : []),
    ...capabilities
  ]);
  const bindings = normalizeProvidedBindings(payload.bindings, compactSlug(model || payload.device || 'vendor-chip'));

  return {
    path: path.relative(projectRoot, absolutePath).replace(/\\/g, '/'),
    absolutePath,
    data: {
      vendor: String(payload.vendor || '').trim(),
      series: String(payload.series || '').trim(),
      model,
      family: String(payload.family || '').trim(),
      device: String(payload.device || '').trim(),
      chip: String(payload.chip || '').trim(),
      package: packageName,
      pin_count: Number(payload.pin_count || payload.pinCount || 0) || 0,
      architecture: String(payload.architecture || '').trim(),
      runtime_model: String(payload.runtime_model || payload.runtimeModel || '').trim(),
      tools: normalizeStringList(payload.tools),
      docs: normalizeAnalysisDocs(payload.docs),
      truths: normalizeStringList(payload.truths),
      constraints: normalizeStringList(payload.constraints),
      unknowns: normalizeStringList(payload.unknowns),
      signals: Array.isArray(payload.signals) ? payload.signals : [],
      peripherals,
      capabilities,
      bindings,
      notes: normalizeStringList(payload.notes)
    }
  };
}

function inferTools(peripherals, extraTextParts) {
  const haystack = runtime.unique([
    ...(peripherals || []).map(item => (item && item.name) || ''),
    ...(extraTextParts || [])
  ]).join('\n');

  const patterns = [
    ['timer-calc', /\bTIMER(?:\d+)?\b/i],
    ['pwm-calc', /\bPWM\b/i],
    ['lvdc-threshold', /\bLVD\b|low-voltage detection/i],
    ['charger-config', /\bCHG\b|\bCHARG(?:E|ER|ING)\b|charging/i],
    ['adc-scale', /\bADC\b/i],
    ['comparator-threshold', /\bCOMPARATOR\b|\bCMP\b/i]
  ];

  return patterns
    .filter(([, pattern]) => pattern.test(haystack))
    .map(([toolName]) => toolName);
}

function inferPinCountFromPackage(pkg) {
  const match = String(pkg || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function buildDocReference(docInfo, model, pkg) {
  if (!docInfo) {
    return [];
  }

  return [
    {
      id: docInfo.entry.doc_id,
      kind: docInfo.entry.kind || 'datasheet',
      title: docInfo.entry.title || path.basename(docInfo.entry.source || docInfo.path || docInfo.entry.doc_id),
      lookup_keys: runtime.unique([model, pkg, docInfo.entry.source].filter(Boolean)),
      notes: runtime.unique([
        docInfo.entry.source ? `source: ${docInfo.entry.source}` : '',
        docInfo.path ? `draft: ${docInfo.path}` : ''
      ])
    }
  ];
}

function uniqueObjectsByName(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const name = String((item && item.name) || '').trim();
    if (!name || seen.has(name)) {
      return false;
    }
    seen.add(name);
    return true;
  });
}

function normalizePinName(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\./g, '');
}

function parsePortBit(pinName) {
  const match = normalizePinName(pinName).match(/^P([A-G])(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    port: `P${match[1]}`,
    bit: Number(match[2])
  };
}

function signalHaystack(signal) {
  return [
    signal && signal.name,
    signal && signal.pin,
    signal && signal.direction,
    signal && signal.usage,
    signal && signal.note
  ].filter(Boolean).join(' ');
}

function inferSignalDescriptor(text) {
  const haystack = String(text || '');

  if (/\bPWM\b|dimming|duty cycle/i.test(haystack)) {
    return {
      name: 'PWM_OUT',
      usage: 'pwm-output',
      direction: 'output'
    };
  }
  if (/\bADC\b|ANALOG|SENSE|sampling|analog/i.test(haystack)) {
    return {
      name: 'ADC_IN',
      usage: 'adc-input',
      direction: 'input'
    };
  }
  if (/\bCOMPARATOR\b|\bCMP\b|comparator/i.test(haystack)) {
    return {
      name: 'CMP_IN',
      usage: 'comparator-input',
      direction: 'input'
    };
  }
  if (/PROGRAM|flashing|programming|ICP|ICSP|DEBUG|SWD/i.test(haystack)) {
    return {
      name: 'PROG',
      usage: 'programming',
      direction: ''
    };
  }
  if (/\bUART\b.*\bTX\b|\bTX\b/i.test(haystack)) {
    return {
      name: 'UART_TX',
      usage: 'uart-tx',
      direction: 'output'
    };
  }
  if (/\bUART\b.*\bRX\b|\bRX\b/i.test(haystack)) {
    return {
      name: 'UART_RX',
      usage: 'uart-rx',
      direction: 'input'
    };
  }

  return {
    name: 'GPIO',
    usage: 'gpio',
    direction: ''
  };
}

function normalizeSignal(signal) {
  const normalizedPin = normalizePinName(signal && signal.pin);
  const normalizedName = String((signal && signal.name) || '').trim();
  if (!normalizedName && !normalizedPin) {
    return null;
  }

  return {
    name: normalizedName || normalizedPin,
    pin: normalizedPin,
    direction: String((signal && signal.direction) || '').trim(),
    default_state: String((signal && signal.default_state) || '').trim(),
    confirmed: signal && Object.prototype.hasOwnProperty.call(signal, 'confirmed')
      ? Boolean(signal.confirmed)
      : undefined,
    usage: String((signal && signal.usage) || '').trim(),
    note: String((signal && signal.note) || '').trim()
  };
}

function mergeSignal(current, next) {
  if (!current) {
    return next;
  }

  const currentNameIsGeneric =
    !current.name ||
    current.name === current.pin ||
    current.name.startsWith('GPIO_');
  const nextNameIsGeneric =
    !next.name ||
    next.name === next.pin ||
    next.name.startsWith('GPIO_');

  return {
    name: currentNameIsGeneric && !nextNameIsGeneric ? next.name : (current.name || next.name),
    pin: current.pin || next.pin,
    direction: current.direction || next.direction,
    default_state: current.default_state || next.default_state,
    confirmed:
      current.confirmed === true || next.confirmed === true
        ? true
        : (current.confirmed !== undefined ? current.confirmed : next.confirmed),
    usage:
      !current.usage || current.usage === 'gpio'
        ? (next.usage || current.usage)
        : current.usage,
    note: runtime.unique([current.note, next.note]).filter(Boolean).join(' | ')
  };
}

function deriveSignalsFromTexts(texts) {
  const derived = [];

  (texts || []).forEach(text => {
    const matches = String(text || '').match(/\bP[A-G]\d+\b/gi);
    if (!matches) {
      return;
    }

    const descriptor = inferSignalDescriptor(text);
    matches.forEach(rawPin => {
      const pin = normalizePinName(rawPin);
      derived.push({
        name: `${descriptor.name}_${pin}`,
        pin,
        direction: descriptor.direction,
        confirmed: false,
        usage: descriptor.usage,
        note: String(text || '').trim()
      });
    });
  });

  return derived;
}

function buildSignals(explicitSignals, textHints) {
  const map = new Map();

  [...(explicitSignals || []), ...deriveSignalsFromTexts(textHints || [])]
    .map(item => normalizeSignal(item))
    .filter(Boolean)
    .forEach(signal => {
      const key = signal.pin || signal.name;
      map.set(key, mergeSignal(map.get(key), signal));
    });

  return [...map.values()];
}

function matchSignals(signals, matcher) {
  return buildSignals(signals, []).filter(item => matcher.test(signalHaystack(item)));
}

function matchPeripherals(peripherals, matcher) {
  return uniqueObjectsByName(peripherals).filter(item => matcher.test(String(item.name || '')));
}

function buildBindingMap(signals, role) {
  return signals.reduce((result, signal) => {
    if (!signal.pin) {
      return result;
    }
    result[signal.pin] = {
      signal: signal.name || signal.pin,
      role
    };
    return result;
  }, {});
}

function inferComparatorPolarity(signal) {
  const haystack = signalHaystack(signal);
  if (/\bPOSITIVE\b|\bNON-?INVERT(?:ING)?\b|\bVINP\b|\bCMPP\b|\bCMP_POS\b|\bPLUS\b|\+/i.test(haystack)) {
    return 'positive';
  }
  if (/\bNEGATIVE\b|\bINVERT(?:ING)?\b|\bVINN\b|\bCMPN\b|\bCMP_NEG\b|\bVREF\b|\bLADDER\b|\bBANDGAP\b|\bREFERENCE\b|\bMINUS\b/i.test(haystack)) {
    return 'negative';
  }
  return '';
}

function buildPackagePins(signals) {
  return buildSignals(signals, [])
    .filter(item => item.pin)
    .map(signal => ({
      signal: signal.pin,
      label: signal.name && signal.name !== signal.pin ? signal.name : undefined,
      default_function: signal.usage || undefined,
      mux: runtime.unique([
        signal.name && signal.name !== signal.pin ? signal.name : '',
        signal.usage
      ]).filter(Boolean),
      notes: runtime.unique([
        signal.note,
        signal.direction ? `direction: ${signal.direction}` : '',
        signal.confirmed === false ? 'draft inferred from project/doc evidence' : ''
      ]).filter(Boolean)
    }));
}

function buildChipPinMap(signals) {
  return buildSignals(signals, []).reduce((result, signal) => {
    if (!signal.pin) {
      return result;
    }

    const portBit = parsePortBit(signal.pin);
    result[signal.pin] = {
      name: signal.pin,
      port: portBit ? portBit.port : undefined,
      bit: portBit ? portBit.bit : undefined,
      functions: runtime.unique([
        signal.name && signal.name !== signal.pin ? signal.name : '',
        signal.usage
      ]).filter(Boolean),
      interrupts: [],
      package_locations: {},
      notes: runtime.unique([
        signal.note,
        signal.direction ? `direction: ${signal.direction}` : '',
        signal.default_state ? `default_state: ${signal.default_state}` : '',
        signal.confirmed === false ? 'draft inferred from project/doc evidence' : ''
      ]).filter(Boolean)
    };
    return result;
  }, {});
}

function slugSuffix(toolName) {
  return String(toolName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findPeripheral(peripherals, matcher) {
  return uniqueObjectsByName(peripherals).find(item => matcher.test(String(item.name || '')));
}

function findSignal(signals, matcher) {
  return matchSignals(signals, matcher)[0] || null;
}

function buildBindingNotes(baseNotes, evidence) {
  return runtime.unique([
    'Draft binding generated automatically by adapter derive for agents/developers to complete.',
    'Only safe inferable fields are filled in now; formulas, register widths, clock sources, and boundaries still need manual confirmation.',
    ...(baseNotes || []),
    ...(evidence || [])
  ]);
}

function buildTimerBinding(toolName, config) {
  const timers = matchPeripherals(config.peripherals, /\bTIMER(?:\d+)?\b/i)
    .map(item => String(item.name || '').trim())
    .filter(Boolean);
  const timerName = timers[0] || '';
  const timerVariants = timers.reduce((result, name) => {
    result[name] = {
      peripheral: name
    };
    return result;
  }, {});

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {
      default_timer: timerName || undefined,
      timer_variants: timerVariants
    },
    evidence: runtime.unique([
      ...timers.map(name => `peripheral:${name}`),
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        timerName
          ? `Timer peripherals ${timers.join(', ')} were identified from truth/doc sources.`
          : 'No specific timer name was identified and must be filled in manually.'
      ]
    )
  };
}

function buildPwmBinding(toolName, config) {
  const pwmSignals = matchSignals(config.signals, /PWM|pwm-output/i);
  const signal = pwmSignals[0] || null;
  const outputPin = signal ? String(signal.pin || '') : '';
  const pwm = findPeripheral(config.peripherals, /\bPWM\b/i);
  const pwmName = pwm ? String(pwm.name) : 'PWM';
  const outputPins = buildBindingMap(pwmSignals, 'pwm-output');

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {
      default_output_pin: outputPin || undefined,
      output_pins: outputPins,
      pwm_block: pwmName
    },
    evidence: runtime.unique([
      pwmName ? `peripheral:${pwmName}` : '',
      ...Object.keys(outputPins).map(pin => `signal:${pin}`),
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        pwmName ? `PWM capability ${pwmName} was identified.` : 'Only PWM keywords were identified; the exact block is still unconfirmed.',
        outputPin ? `Default PWM pin ${outputPin} was identified from project truth.` : 'The default PWM output pin is unconfirmed.'
      ]
    )
  };
}

function buildLpwmgBinding(toolName, config) {
  const lpwmg = findPeripheral(config.peripherals, /\bPWM/i);
  const lpwmgName = lpwmg ? String(lpwmg.name) : '';
  const lpwmgSignals = matchSignals(config.signals, /\bPWM|pwm-output/i);
  const channels = buildBindingMap(lpwmgSignals, 'pwm-output');
  const defaultPin = Object.keys(channels)[0] || '';

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {
      default_output_pin: defaultPin || undefined,
      output_pins: channels
    },
    evidence: runtime.unique([
      lpwmgName ? `peripheral:${lpwmgName}` : '',
      ...Object.keys(channels).map(pin => `signal:${pin}`),
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        lpwmgName ? `PWM peripheral ${lpwmgName} identified.` : 'No PWM peripheral explicitly matched.',
        defaultPin
          ? `Default output candidate ${defaultPin} from project truth.`
          : 'Default output pin is unconfirmed.'
      ]
    )
  };
}

function buildAdcBinding(toolName, config) {
  const adc = findPeripheral(config.peripherals, /\bADC\b/i);
  const adcName = adc ? String(adc.name) : 'ADC';
  const adcSignals = matchSignals(config.signals, /ADC|ANALOG|SENSE|adc-input/i);
  const channelSignal = adcSignals[0] || null;
  const channelName = channelSignal ? String(channelSignal.pin || '') : '';
  const channels = buildBindingMap(adcSignals, 'adc-input');

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {
      default_channel: channelName || undefined,
      channels,
      reference_sources: {}
    },
    evidence: runtime.unique([
      adcName ? `peripheral:${adcName}` : '',
      ...Object.keys(channels).map(pin => `signal:${pin}`),
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        adcName ? `ADC capability ${adcName} was identified.` : 'Only ADC keywords were identified; channel mapping is unconfirmed.',
        channelName ? `Default ADC channel candidate ${channelName} was identified from project truth.` : 'The default ADC channel is unconfirmed.'
      ]
    )
  };
}

function buildLvdcBinding(toolName, config) {
  const lvdc = findPeripheral(config.peripherals, /\bLVD\b/i);
  const lvdcName = lvdc ? String(lvdc.name) : '';

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {},
    evidence: runtime.unique([
      lvdcName ? `peripheral:${lvdcName}` : '',
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        lvdcName ? `Low-voltage detection peripheral ${lvdcName} identified.` : 'No LVD peripheral explicitly matched. Register fields need manual confirmation.'
      ]
    )
  };
}

function buildChargerBinding(toolName, config) {
  const charger = findPeripheral(config.peripherals, /\bCHG\b|\bCHARG(?:E|ER|ING)\b|charging/i);
  const chargerName = charger ? String(charger.name) : 'Charger';

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {},
    evidence: runtime.unique([
      chargerName ? `peripheral:${chargerName}` : '',
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        chargerName ? `Charging capability ${chargerName} was identified.` : 'Only CHG/charging keywords were identified; current steps and status bits still need manual confirmation.'
      ]
    )
  };
}

function buildComparatorBinding(toolName, config) {
  const cmp = findPeripheral(config.peripherals, /\bCOMPARATOR\b|\bCMP\b/i);
  const cmpName = cmp ? String(cmp.name) : 'Comparator';
  const comparatorSignals = matchSignals(config.signals, /COMPARATOR|CMP|comparator-input|ANALOG|ADC/i);
  const positiveSignals = comparatorSignals.filter(item => inferComparatorPolarity(item) !== 'negative');
  const negativeSignals = comparatorSignals.filter(item => inferComparatorPolarity(item) === 'negative');

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {
      positive_sources: buildBindingMap(positiveSignals, 'comparator-positive'),
      negative_sources: buildBindingMap(negativeSignals, 'comparator-negative')
    },
    evidence: runtime.unique([
      cmpName ? `peripheral:${cmpName}` : '',
      ...positiveSignals.map(item => item.pin ? `signal:${item.pin}` : ''),
      ...negativeSignals.map(item => item.pin ? `signal:${item.pin}` : ''),
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        cmpName ? `Comparator capability ${cmpName} was identified.` : 'Only comparator keywords were identified; input sources are unconfirmed.',
        comparatorSignals.length > 0
          ? `Comparator input candidates ${comparatorSignals.map(item => item.pin || item.name).join(', ')} were extracted from truth/doc sources.`
          : 'Comparator input sources still need manual confirmation.'
      ]
    )
  };
}

function buildDraftBindings(config) {
  const builders = {
    'timer-calc': buildTimerBinding,
    'pwm-calc': buildPwmBinding,
    'lpwmg-calc': buildLpwmgBinding,
    'lvdc-threshold': buildLvdcBinding,
    'charger-config': buildChargerBinding,
    'adc-scale': buildAdcBinding,
    'comparator-threshold': buildComparatorBinding
  };

  return config.tools.reduce((bindings, toolName) => {
    const builder = builders[toolName];
    if (!builder) {
      return bindings;
    }
    bindings[toolName] = builder(toolName, config);
    return bindings;
  }, {});
}

function resolveDerivedConfig(config, projectRoot) {
  let truthInfo = null;
  let docInfo = null;
  let analysisInfo = null;
  let vendor = config.vendor || '';
  let series = config.series || '';
  let model = '';
  let pkg = config.package || '';
  const signals = [];
  const peripherals = [];
  const truths = [];
  const constraints = [];
  const unknowns = [];
  const notes = [];
  const analysisDocs = [];
  const providedBindings = {};
  const artifactTools = [];
  const artifactCapabilities = [];
  let pinCount = config.pinCount || 0;
  let architecture = config.architecture || '';
  let runtimeModel = config.runtimeModel || '';

  if (config.fromProject) {
    truthInfo = loadProjectHardwareTruth(projectRoot);
    vendor = vendor || truthInfo.data.vendor || '';
    model = model || truthInfo.data.model || '';
    pkg = pkg || truthInfo.data.package || '';
    signals.push(...(truthInfo.data.signals || []));
    peripherals.push(...(truthInfo.data.peripherals || []));
    truths.push(...(truthInfo.data.truths || []));
    constraints.push(...(truthInfo.data.constraints || []));
    unknowns.push(...(truthInfo.data.unknowns || []));
    notes.push(`Loaded project truth from ${truthInfo.path}.`);
  }

  if (config.fromDoc) {
    docInfo = loadDocHardwareDraft(projectRoot, config.fromDoc);
    const docMcu = (docInfo.data && docInfo.data.mcu) || {};
    model = model || docMcu.model || '';
    pkg = pkg || docMcu.package || '';
    peripherals.push(...((docInfo.data && docInfo.data.peripherals) || []));
    truths.push(...((docInfo.data && docInfo.data.truths) || []));
    constraints.push(...((docInfo.data && docInfo.data.constraints) || []));
    unknowns.push(...((docInfo.data && docInfo.data.unknowns) || []));
    notes.push(`Loaded document draft from ${docInfo.path}.`);
  }

  if (config.fromAnalysis) {
    analysisInfo = loadAnalysisArtifact(projectRoot, config.fromAnalysis);
    vendor = vendor || analysisInfo.data.vendor || '';
    series = series || analysisInfo.data.series || '';
    model = model || analysisInfo.data.model || '';
    pkg = pkg || analysisInfo.data.package || '';
    pinCount = pinCount || analysisInfo.data.pin_count || 0;
    architecture = architecture || analysisInfo.data.architecture || '';
    runtimeModel = runtimeModel || analysisInfo.data.runtime_model || '';
    signals.push(...(analysisInfo.data.signals || []));
    peripherals.push(...(analysisInfo.data.peripherals || []));
    truths.push(...(analysisInfo.data.truths || []));
    constraints.push(...(analysisInfo.data.constraints || []));
    unknowns.push(...(analysisInfo.data.unknowns || []));
    analysisDocs.push(...(analysisInfo.data.docs || []));
    artifactCapabilities.push(...(analysisInfo.data.capabilities || []));
    artifactTools.push(...(analysisInfo.data.tools || []));
    Object.assign(providedBindings, analysisInfo.data.bindings || {});
    notes.push(`Loaded analysis artifact from ${analysisInfo.path}.`);
    notes.push(...(analysisInfo.data.notes || []));
  }

  const vendorResolved = vendor || 'VendorName';
  const deviceResolved = config.device || (analysisInfo && analysisInfo.data.device) || compactSlug(model);
  const seriesResolved = series || model || deviceResolved || 'SeriesName';
  const familyResolved =
    config.family ||
    (analysisInfo && analysisInfo.data.family) ||
    normalizeSlug(`${vendorResolved}-${seriesResolved}`);
  const chipSeed = compactSlug(model || deviceResolved);
  const packageSeed = compactSlug(pkg);
  const chipResolved =
    config.chip ||
    (analysisInfo && analysisInfo.data.chip) ||
    compactSlug(`${chipSeed}${packageSeed}`);
  const inferredTools = inferTools(peripherals, [...truths, ...constraints, ...unknowns]);
  const supportedArtifactTools = Object.entries(providedBindings)
    .filter(([, binding]) => binding && binding.algorithm !== 'unsupported')
    .map(([toolName]) => toolName);
  const toolsResolved = config.tools.length > 0
    ? config.tools.slice()
    : runtime.unique([
        ...artifactTools,
        ...supportedArtifactTools,
        ...(inferredTools.length > 0 ? inferredTools : ['timer-calc'])
      ]);
  const resolved = {
    vendor: vendorResolved,
    series: seriesResolved,
    family: familyResolved,
    device: deviceResolved,
    chip: chipResolved,
    package: pkg,
    pinCount: pinCount || inferPinCountFromPackage(pkg),
    architecture,
    runtimeModel,
    tools: runtime.unique(toolsResolved),
    capabilities: runtime.unique([
      ...peripherals.map(item => (item && item.name) || ''),
      ...artifactCapabilities
    ]),
    docs: runtime.unique([
      ...buildDocReference(docInfo, model, pkg),
      ...analysisDocs
    ]),
    signals: buildSignals(signals, [...truths, ...constraints, ...unknowns]),
    peripherals: uniqueObjectsByName(peripherals),
    notes: runtime.unique([
      ...notes,
      truthInfo ? `truths=${(truthInfo.data.truths || []).length}` : '',
      docInfo ? `doc_id=${docInfo.entry.doc_id}` : '',
      analysisInfo ? `analysis=${analysisInfo.path}` : ''
    ])
  };

  return {
    truthInfo,
    docInfo,
    analysisInfo,
    ...resolved,
    bindings: {
      ...buildDraftBindings(resolved),
      ...providedBindings
    }
  };
}

function targetEmbRoot(runtimeRoot, projectRoot, target) {
  if (target === 'runtime') {
    return runtimeRoot;
  }
  return runtime.getProjectExtDir(projectRoot);
}

function resolveEmbOutputRoot(runtimeRoot, projectRoot, config) {
  if (config.outputRoot) {
    return path.resolve(projectRoot, config.outputRoot);
  }
  return targetEmbRoot(runtimeRoot, projectRoot, config.target);
}

function ensureRegistryValue(filePath, emptyValue, key, value) {
  const current = runtime.readJson(filePath);
  const next = {
    ...emptyValue,
    ...current
  };
  next[key] = runtime.unique([...(next[key] || []), value]);
  runtime.writeJson(filePath, next);
  return next;
}

function writeJsonUnlessExists(filePath, value, force) {
  if (fs.existsSync(filePath) && !force) {
    return 'skipped';
  }
  runtime.writeJson(filePath, value);
  return 'written';
}

function writeTextUnlessExists(filePath, value, force) {
  if (fs.existsSync(filePath) && !force) {
    return 'skipped';
  }
  fs.writeFileSync(filePath, value, 'utf8');
  return 'written';
}

function buildDraftAdapterRoute(toolName, config) {
  const adapterName = `${config.device}-${slugSuffix(toolName)}-draft`;

  if (
    toolName === 'timer-calc' ||
    toolName === 'pwm-calc' ||
    toolName === 'adc-scale' ||
    toolName === 'comparator-threshold'
  ) {
    const generatedHandler = toolName === 'timer-calc'
      ? 'runGeneratedTimerAdapter'
      : (
        toolName === 'pwm-calc'
          ? 'runGeneratedPwmAdapter'
          : (toolName === 'adc-scale' ? 'runGeneratedAdcAdapter' : 'runGeneratedComparatorAdapter')
      );

    return [
      "'use strict';",
      '',
      "const path = require('path');",
      '',
      `const TOOL_NAME = ${JSON.stringify(toolName)};`,
      `const DEFAULT_FAMILY = ${JSON.stringify(config.family)};`,
      `const DEFAULT_DEVICE = ${JSON.stringify(config.device)};`,
      `const ADAPTER_NAME = ${JSON.stringify(adapterName)};`,
      '',
      'function loadBinding(context, options) {',
      "  const toolCatalog = require(path.join(context.rootDir, 'lib', 'tool-catalog.cjs'));",
      "  const requestedDevice = String(options.device || DEFAULT_DEVICE || '').trim();",
      "  const requestedFamily = String(options.family || DEFAULT_FAMILY || '').trim();",
      '  let deviceProfile = null;',
      '  let familyProfile = null;',
      '',
      '  if (requestedDevice) {',
      '    try {',
      '      deviceProfile = toolCatalog.loadDevice(context.rootDir, requestedDevice);',
      '    } catch {',
      '      deviceProfile = null;',
      '    }',
      '  }',
      '',
      '  const resolvedFamily = (deviceProfile && deviceProfile.family) || requestedFamily;',
      '  if (resolvedFamily) {',
      '    try {',
      '      familyProfile = toolCatalog.loadFamily(context.rootDir, resolvedFamily);',
      '    } catch {',
      '      familyProfile = null;',
      '    }',
      '  }',
      '',
      "  const deviceBinding = deviceProfile && deviceProfile.bindings ? deviceProfile.bindings[TOOL_NAME] : null;",
      "  const familyBinding = familyProfile && familyProfile.bindings ? familyProfile.bindings[TOOL_NAME] : null;",
      '',
      '  return {',
      '    device: requestedDevice,',
      '    family: resolvedFamily,',
      '    source: deviceBinding ? "device" : familyBinding ? "family" : "none",',
      '    binding: deviceBinding || familyBinding || null',
      '  };',
      '}',
      '',
      'module.exports = {',
      '  draft: true,',
      '  runTool(context) {',
      "    const generated = require(path.join(context.rootDir, 'lib', 'generated-tool-adapters.cjs'));",
      '    const options = context.parseLongOptions(context.tokens || []);',
      '    const resolved = loadBinding(context, options);',
      `    return generated.${generatedHandler}(context, resolved, options);`,
      '  }',
      '};',
      ''
    ].join('\n');
  }

  return [
    "'use strict';",
    '',
    "const path = require('path');",
    '',
    `const TOOL_NAME = ${JSON.stringify(toolName)};`,
    `const DEFAULT_FAMILY = ${JSON.stringify(config.family)};`,
    `const DEFAULT_DEVICE = ${JSON.stringify(config.device)};`,
    `const ADAPTER_NAME = ${JSON.stringify(adapterName)};`,
    '',
    'function loadBinding(context, options) {',
    "  const toolCatalog = require(path.join(context.rootDir, 'lib', 'tool-catalog.cjs'));",
    "  const requestedDevice = String(options.device || DEFAULT_DEVICE || '').trim();",
    "  const requestedFamily = String(options.family || DEFAULT_FAMILY || '').trim();",
    '  let deviceProfile = null;',
    '  let familyProfile = null;',
    '',
    '  if (requestedDevice) {',
    '    try {',
    '      deviceProfile = toolCatalog.loadDevice(context.rootDir, requestedDevice);',
    '    } catch {',
    '      deviceProfile = null;',
    '    }',
    '  }',
    '',
    '  const resolvedFamily = (deviceProfile && deviceProfile.family) || requestedFamily;',
    '  if (resolvedFamily) {',
    '    try {',
    '      familyProfile = toolCatalog.loadFamily(context.rootDir, resolvedFamily);',
    '    } catch {',
    '      familyProfile = null;',
    '    }',
    '  }',
    '',
    "  const deviceBinding = deviceProfile && deviceProfile.bindings ? deviceProfile.bindings[TOOL_NAME] : null;",
    "  const familyBinding = familyProfile && familyProfile.bindings ? familyProfile.bindings[TOOL_NAME] : null;",
    '',
    '  return {',
    '    device: requestedDevice,',
    '    family: resolvedFamily,',
    '    source: deviceBinding ? "device" : familyBinding ? "family" : "none",',
    '    binding: deviceBinding || familyBinding || null',
    '  };',
    '}',
    '',
    'module.exports = {',
    '  draft: true,',
    '  runTool(context) {',
    '    const options = context.parseLongOptions(context.tokens || []);',
    '    const resolved = loadBinding(context, options);',
    '',
    '    if (!resolved.binding) {',
    '      return {',
    '        tool: context.toolName,',
    "        status: 'route-required',",
    "        implementation: 'external-chip-support-draft',",
    '        adapter_name: ADAPTER_NAME,',
    '        chip_support_path: context.adapterPath,',
    '        inputs: {',
    '          raw_tokens: context.tokens || [],',
    '          options',
    '        },',
    '        resolution: {',
    "          family: resolved.family || '',",
    "          device: resolved.device || ''",
    '        },',
    '        notes: [',
    "          'This draft chip-support route was generated by adapter derive and currently only exposes the binding draft to agents/developers.',",
    "          'No matching binding has been found yet. Add device/family bindings first, or run adapter derive again.'",
    '        ]',
    '      };',
    '    }',
    '',
    '    return {',
    '      tool: context.toolName,',
    "      status: 'draft-chip-support',",
    "      implementation: 'external-chip-support-draft',",
    '      adapter_name: ADAPTER_NAME,',
    '      chip_support_path: context.adapterPath,',
    '      inputs: {',
    '        raw_tokens: context.tokens || [],',
    '        options',
    '      },',
    '      resolution: {',
    "        family: resolved.family || '',",
    "        device: resolved.device || '',",
    '        binding_source: resolved.source',
    '      },',
    '      binding: {',
    "        algorithm: resolved.binding.algorithm || '',",
    '        draft: resolved.binding.draft !== false,',
    '        params: resolved.binding.params || {},',
    '        evidence: resolved.binding.evidence || [],',
    '        notes: resolved.binding.notes || []',
    '      },',
    '      next_steps: [',
    "        'Implement the real formula in this route according to binding.algorithm and params.',",
    "        'After implementation is complete, remove the module.exports.draft marker so scheduling can treat the tool as ready.'",
    '      ],',
    '      notes: [',
    "        'This is a draft route generated by adapter derive and does not execute real calculations.',",
    "        'Its purpose is to provide agents with a stable entry point and binding draft, not to fabricate results.'",
    '      ]',
    '    };',
    '  }',
    '};',
    ''
  ].join('\n');
}

function buildFamilyProfile(config) {
  return {
    name: config.family,
    vendor: config.vendor,
    series: config.series,
    sample: false,
    description: `External tool family profile for ${config.family}.`,
      supported_tools: (config.supported_tools || config.tools).slice(),
      clock_sources: [],
      bindings: {},
      notes: [
        'Family draft generated by adapter derive.',
        'If devices differ only by parameters, prefer filling them in via device bindings/params.',
        ...(config.inference_notes || [])
      ]
  };
}

function buildDeviceProfile(config) {
  return {
    name: config.device,
    family: config.family,
    sample: false,
    description: `External tool device profile for ${config.device}.`,
      supported_tools: (config.supported_tools || config.tools).slice(),
      bindings: config.bindings || {},
      notes: [
        'Device draft generated by adapter derive.',
        'Draft bindings were added automatically. Fill in real algorithm parameters from manuals, examples, or verified code.',
        ...(config.inference_notes || [])
      ]
  };
}

function buildChipPackages(config) {
  if (!config.package) {
    return [];
  }

  const pins = buildPackagePins(config.signals || []);

  return [
    {
      name: config.package,
      pin_count: config.pinCount || undefined,
      pins,
      notes: runtime.unique([
        pins.length > 0
          ? 'This is a partially auto-drafted pin proposal from truth/doc sources. Physical pin numbers still need to be checked against the datasheet pin table.'
          : 'Add the physical pin table later according to package type.'
      ])
    }
  ];
}

function buildChipProfile(config) {
  return {
    name: config.chip,
    vendor: config.vendor,
    family: config.family,
    sample: false,
    series: config.series,
    package: config.package || '',
    architecture: config.architecture || '',
    runtime_model: config.runtimeModel,
    description: `External chip profile for ${config.chip}.`,
    summary: {
      vendor: config.vendor,
      series: config.series,
      source_mode: config.source_mode || 'manual'
    },
    capabilities: (config.capabilities || []).slice(),
    packages: buildChipPackages(config),
    pins: buildChipPinMap(config.signals || []),
    docs: (config.docs || []).slice(),
    related_tools: (config.supported_tools || config.tools).slice(),
    source_modules: [],
    notes: [
      'Chip draft generated by adapter derive.',
      'Put reusable capabilities into pins/packages to avoid scattering pin knowledge into tool params.',
      ...(config.inference_notes || [])
    ]
  };
}

function buildDerivedTrustReport(config, embRoot, projectRoot) {
  const familyProfile = buildFamilyProfile(config);
  const deviceProfile = buildDeviceProfile(config);
  const chipProfile = buildChipProfile(config);
  const recommendations = config.tools.map(toolName => {
    const binding = deviceProfile.bindings && deviceProfile.bindings[toolName]
      ? deviceProfile.bindings[toolName]
      : null;
    const trust = adapterQualityHelpers.evaluateToolRecommendationTrust({
      toolName,
      chipProfile,
      deviceProfile,
      familyProfile,
      tool: {
        name: toolName,
        status: 'draft-chip-support',
        implementation: 'external-chip-support-draft',
        chip_support_path: path.relative(projectRoot, path.join(embRoot, 'chip-support', 'routes', `${toolName}.cjs`)) || `${toolName}.cjs`
      },
      bindingInfo: {
        source: binding ? 'device' : 'none',
        binding
      }
    });

    return {
      tool: toolName,
      status: 'draft-chip-support',
      binding_source: binding ? 'device' : 'none',
      trust
    };
  });
  const summary = adapterQualityHelpers.summarizeAdapterHealth(recommendations, []);

  return {
    status: summary.status,
    overall_grade: summary.overall_grade,
    safe_to_execute: summary.executable_tools > 0,
    primary: summary.primary,
    tools: recommendations.map(item => ({
      tool: item.tool,
      score: item.trust.score,
      grade: item.trust.grade,
      executable: item.trust.executable,
      recommended_action: item.trust.recommended_action,
      gaps: item.trust.gaps
    }))
  };
}

function buildDerivedReusability(config, trustReport) {
  const sourceMode = String(config && config.source_mode ? config.source_mode : 'manual').trim() || 'manual';
  const hasProjectOrDocEvidence = sourceMode !== 'manual';
  const docs = Array.isArray(config && config.docs) ? config.docs : [];
  const signals = Array.isArray(config && config.signals) ? config.signals : [];
  const tools = Array.isArray(config && config.tools) ? config.tools : [];
  const bindings =
    config && config.bindings && typeof config.bindings === 'object' && !Array.isArray(config.bindings)
      ? Object.keys(config.bindings).filter(Boolean)
      : [];
  const reasons = [];
  const blockers = [];

  if (hasProjectOrDocEvidence) {
    reasons.push(`source-mode=${sourceMode}`);
  } else {
    blockers.push('missing project/doc evidence');
  }

  if (docs.length > 0) {
    reasons.push(`docs=${docs.length}`);
  }

  if (signals.length > 0) {
    reasons.push(`signals=${signals.length}`);
  }

  if (tools.length > 0) {
    reasons.push(`tools=${tools.length}`);
  } else {
    blockers.push('missing tool coverage');
  }

  if (bindings.length > 0) {
    reasons.push(`binding-tools=${bindings.length}`);
  } else {
    blockers.push('missing inferred bindings');
  }

  if (trustReport && trustReport.primary && trustReport.primary.tool) {
    reasons.push(`primary-tool=${trustReport.primary.tool}`);
    reasons.push(`primary-grade=${trustReport.primary.grade}`);
  }

  const status =
    hasProjectOrDocEvidence &&
    tools.length > 0 &&
    bindings.length > 0 &&
    (docs.length > 0 || signals.length > 0)
      ? 'reusable-candidate'
      : 'project-only';

  return {
    status,
    review_required: true,
    summary:
      status === 'reusable-candidate'
        ? 'This draft looks reusable after catalog review, but normal users only need to know it can be reused later.'
        : 'This draft should stay project-local until project/doc evidence and binding coverage are more complete.',
    recommended_action:
      status === 'reusable-candidate'
        ? 'review-for-catalog'
        : 'keep-project-local',
    reasons,
    blockers,
    publish:
      status === 'reusable-candidate'
        ? 'maintainer-review-only'
        : 'not-recommended'
  };
}

function listNamesFromDir(dirPath, extension) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return [];
  }

  return fs.readdirSync(dirPath)
    .filter(name => name.endsWith(extension))
    .map(name => name.slice(0, -extension.length))
    .sort();
}

function listRelativeFilesRecursive(baseDir, rootDir) {
  if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) {
    return [];
  }

  const result = [];
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    const absolutePath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listRelativeFilesRecursive(absolutePath, rootDir));
      continue;
    }
    result.push(path.relative(rootDir, absolutePath).replace(/\\/g, '/'));
  }
  return result.sort();
}

function resolveSingleName(explicitName, names, label) {
  const normalized = String(explicitName || '').trim();
  if (normalized) {
    if (!names.includes(normalized)) {
      throw new Error(`Derived ${label} not found: ${normalized}`);
    }
    return normalized;
  }

  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 0) {
    throw new Error(`No derived ${label} is available in the current project`);
  }

  throw new Error(`Multiple derived ${label}s exist; specify --${label}`);
}

function inspectDerivedSupport(options) {
  const settings = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
  const projectRoot = path.resolve(settings.projectRoot || process.cwd());
  const embRoot = runtime.getProjectExtDir(projectRoot);
  const toolExtRoot = path.join(embRoot, 'extensions', 'tools');
  const chipExtRoot = path.join(embRoot, 'extensions', 'chips');
  const routesRoot = path.join(embRoot, 'chip-support', 'routes');
  const coreRoot = path.join(embRoot, 'chip-support', 'core');

  const chipNames = listNamesFromDir(path.join(chipExtRoot, 'profiles'), '.json');
  const chipName = resolveSingleName(settings.chip, chipNames, 'chip');
  const chipPath = path.join(chipExtRoot, 'profiles', `${chipName}.json`);
  const chipProfile = runtime.readJson(chipPath);

  const familyNames = listNamesFromDir(path.join(toolExtRoot, 'families'), '.json');
  const familyName = resolveSingleName(settings.family || chipProfile.family, familyNames, 'family');
  const familyPath = path.join(toolExtRoot, 'families', `${familyName}.json`);
  const familyProfile = runtime.readJson(familyPath);

  const deviceNames = listNamesFromDir(path.join(toolExtRoot, 'devices'), '.json');
  const familyMatchedDevices = deviceNames.filter(name => {
    const filePath = path.join(toolExtRoot, 'devices', `${name}.json`);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    try {
      const profile = runtime.readJson(filePath);
      return String(profile.family || '').trim() === familyName;
    } catch {
      return false;
    }
  });
  const deviceName = resolveSingleName(
    settings.device,
    familyMatchedDevices.length > 0 ? familyMatchedDevices : deviceNames,
    'device'
  );
  const devicePath = path.join(toolExtRoot, 'devices', `${deviceName}.json`);
  const deviceProfile = runtime.readJson(devicePath);

  const routeNames = listNamesFromDir(routesRoot, '.cjs');
  const tools = runtime.unique([
    ...(Array.isArray(chipProfile.related_tools) ? chipProfile.related_tools : []),
    ...(Array.isArray(deviceProfile.supported_tools) ? deviceProfile.supported_tools : []),
    ...Object.keys(deviceProfile.bindings || {}),
    ...routeNames
  ]).filter(Boolean);

  const recommendations = tools.map(toolName => {
    const binding = deviceProfile.bindings && deviceProfile.bindings[toolName]
      ? deviceProfile.bindings[toolName]
      : null;
    const routePath = path.join(routesRoot, `${toolName}.cjs`);
    const trust = adapterQualityHelpers.evaluateToolRecommendationTrust({
      toolName,
      chipProfile,
      deviceProfile,
      familyProfile,
      tool: {
        name: toolName,
        status: 'draft-chip-support',
        implementation: 'external-chip-support-draft',
        chip_support_path: path.relative(projectRoot, routePath).replace(/\\/g, '/')
      },
      bindingInfo: {
        source: binding ? 'device' : 'none',
        binding
      }
    });

    return {
      tool: toolName,
      status: 'draft-chip-support',
      binding_source: binding ? 'device' : 'none',
      trust
    };
  });

  const summary = adapterQualityHelpers.summarizeAdapterHealth(recommendations, []);
  const trustReport = {
    status: summary.status,
    overall_grade: summary.overall_grade,
    safe_to_execute: summary.executable_tools > 0,
    primary: summary.primary,
    tools: recommendations.map(item => ({
      tool: item.tool,
      score: item.trust.score,
      grade: item.trust.grade,
      executable: item.trust.executable,
      recommended_action: item.trust.recommended_action,
      gaps: item.trust.gaps
    }))
  };

  const reusability = buildDerivedReusability({
    source_mode:
      chipProfile &&
      chipProfile.summary &&
      typeof chipProfile.summary === 'object' &&
      !Array.isArray(chipProfile.summary)
        ? chipProfile.summary.source_mode
        : 'manual',
    docs: Array.isArray(chipProfile.docs) ? chipProfile.docs : [],
    signals: Object.values(chipProfile.pins || {}),
    tools,
    bindings: deviceProfile.bindings || {}
  }, trustReport);

  const files = [
    {
      kind: 'tool-family',
      path: path.relative(embRoot, familyPath).replace(/\\/g, '/')
    },
    {
      kind: 'tool-device',
      path: path.relative(embRoot, devicePath).replace(/\\/g, '/')
    },
    {
      kind: 'chip-profile',
      path: path.relative(embRoot, chipPath).replace(/\\/g, '/')
    },
    ...tools
      .map(toolName => path.join(routesRoot, `${toolName}.cjs`))
      .filter(filePath => fs.existsSync(filePath))
      .map(filePath => ({
        kind: 'route',
        path: path.relative(embRoot, filePath).replace(/\\/g, '/')
      })),
    ...listRelativeFilesRecursive(coreRoot, embRoot).map(relativePath => ({
      kind: 'core',
      path: relativePath
    }))
  ];

  return {
    status: 'ok',
    project_root: projectRoot,
    emb_root: path.relative(projectRoot, embRoot).replace(/\\/g, '/') || path.basename(embRoot),
    family: familyName,
    device: deviceName,
    chip: chipName,
    vendor: chipProfile.vendor || familyProfile.vendor || '',
    series: chipProfile.series || familyProfile.series || '',
    package: chipProfile.package || '',
    tools,
    files,
    reusability,
    trust: trustReport,
    review_summary: {
      recommended_action: reusability.recommended_action,
      review_required: Boolean(reusability.review_required),
      reasons: Array.isArray(reusability.reasons) ? reusability.reasons : [],
      blockers: Array.isArray(reusability.blockers) ? reusability.blockers : []
    },
    notes: [
      reusability.summary,
      trustReport && trustReport.primary
        ? `Primary tool trust: ${trustReport.primary.tool} (${trustReport.primary.grade} ${trustReport.primary.score}/100).`
        : 'No primary trust signal is available yet.'
    ]
  };
}

function deriveProfiles(argv, options) {
  const config = parseArgs(argv || []);
  if (config.help) {
    usage();
    return { __side_effect_only: true };
  }

  const runtimeRoot = path.resolve((options && options.runtimeRoot) || ROOT);
  const projectRoot = path.resolve(config.projectRoot || ((options && options.projectRoot) || process.cwd()));
  const derived = resolveDerivedConfig(config, projectRoot);

  config.vendor = derived.vendor;
  config.series = derived.series;
  config.family = ensureNonEmpty(config.family || derived.family, '--family');
  config.device = ensureNonEmpty(config.device || derived.device, '--device');
  config.chip = ensureNonEmpty(config.chip || derived.chip, '--chip');
  config.package = config.package || derived.package || '';
  config.pinCount = config.pinCount || derived.pinCount || 0;
  config.architecture = config.architecture || derived.architecture || '';
  config.runtimeModel = config.runtimeModel || derived.runtimeModel || config.runtimeModel;
  config.tools = derived.tools.slice();
  config.supported_tools = config.tools.filter(toolName => {
    const binding = derived.bindings && derived.bindings[toolName];
    return !binding || binding.algorithm !== 'unsupported';
  });
  config.capabilities = derived.capabilities.slice();
  config.docs = derived.docs.slice();
  config.signals = (derived.signals || []).slice();
  config.peripherals = (derived.peripherals || []).slice();
  config.bindings = { ...(derived.bindings || {}) };
  config.inference_notes = derived.notes.slice();
  config.source_mode = [
    config.fromProject ? 'project' : '',
    config.fromDoc ? 'doc' : '',
    config.fromAnalysis ? 'analysis' : ''
  ].filter(Boolean).join('+') || 'manual';

  const embRoot = resolveEmbOutputRoot(runtimeRoot, projectRoot, config);
  const toolExtRoot = path.join(embRoot, 'extensions', 'tools');
  const chipExtRoot = path.join(embRoot, 'extensions', 'chips');
  const adapterRoutesRoot = path.join(embRoot, 'chip-support', 'routes');

  runtime.ensureDir(path.join(toolExtRoot, 'families'));
  runtime.ensureDir(path.join(toolExtRoot, 'devices'));
  runtime.ensureDir(path.join(chipExtRoot, 'profiles'));
  runtime.ensureDir(adapterRoutesRoot);

  const toolRegistryPath = path.join(toolExtRoot, 'registry.json');
  const chipRegistryPath = path.join(chipExtRoot, 'registry.json');

  if (!fs.existsSync(toolRegistryPath)) {
    runtime.writeJson(toolRegistryPath, { specs: [], families: [], devices: [] });
  }
  if (!fs.existsSync(chipRegistryPath)) {
    runtime.writeJson(chipRegistryPath, { devices: [] });
  }

  ensureRegistryValue(toolRegistryPath, { specs: [], families: [], devices: [] }, 'families', config.family);
  ensureRegistryValue(toolRegistryPath, { specs: [], families: [], devices: [] }, 'devices', config.device);
  ensureRegistryValue(chipRegistryPath, { devices: [] }, 'devices', config.chip);

  const familyPath = path.join(toolExtRoot, 'families', `${config.family}.json`);
  const devicePath = path.join(toolExtRoot, 'devices', `${config.device}.json`);
  const chipPath = path.join(chipExtRoot, 'profiles', `${config.chip}.json`);

  const writes = [
    {
      path: familyPath,
      status: writeJsonUnlessExists(familyPath, buildFamilyProfile(config), config.force)
    },
    {
      path: devicePath,
      status: writeJsonUnlessExists(devicePath, buildDeviceProfile(config), config.force)
    },
    {
      path: chipPath,
      status: writeJsonUnlessExists(chipPath, buildChipProfile(config), config.force)
    }
  ];

  config.tools.forEach(toolName => {
    const adapterPath = path.join(adapterRoutesRoot, `${toolName}.cjs`);
    writes.push({
      path: adapterPath,
      status: writeTextUnlessExists(adapterPath, buildDraftAdapterRoute(toolName, config), config.force)
    });
  });

  const trustReport = buildDerivedTrustReport(config, embRoot, projectRoot);
  const reusability = buildDerivedReusability(config, trustReport);

  return {
    status: 'ok',
    target: config.target,
    output_root: config.outputRoot || '',
    emb_root: embRoot,
    family: config.family,
    device: config.device,
    chip: config.chip,
    vendor: config.vendor,
    series: config.series,
    package: config.package,
    tools: config.tools,
    force: config.force,
    inferred: {
      from_project: Boolean(config.fromProject),
      from_doc: config.fromDoc || '',
      from_analysis: config.fromAnalysis || '',
      source_mode: config.source_mode,
      capabilities: config.capabilities,
      docs: config.docs.map(item => item.id),
      binding_tools: Object.keys(config.bindings || {})
    },
    registries: {
      tools: path.relative(projectRoot, toolRegistryPath) || path.basename(toolRegistryPath),
      chips: path.relative(projectRoot, chipRegistryPath) || path.basename(chipRegistryPath)
    },
    files: writes.map(item => ({
      path: path.relative(projectRoot, item.path) || path.basename(item.path),
      status: item.status
    })),
    reusability,
    trust: trustReport,
    notes: [
      'Family/device/chip drafts were generated, and device draft bindings were added from inferable information.',
      'The generated result is still draft chip support; do not treat tool output as ground truth yet.',
      reusability.summary,
      trustReport && trustReport.primary
        ? `Handle ${trustReport.primary.tool} first: ${trustReport.primary.recommended_action} (${trustReport.primary.grade} ${trustReport.primary.score}/100).`
        : 'Next, fill in device-binding details and chip-support implementation from manuals, examples, or verified code.',
      'Next, fill in device-binding details and chip-support implementation from manuals, examples, or verified code.'
    ]
  };
}

function runAdapterDeriveCli(argv, options) {
  const result = deriveProfiles(argv, options);
  if (result && result.__side_effect_only) {
    return;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = {
  deriveProfiles,
  inspectDerivedSupport,
  parseArgs,
  runAdapterDeriveCli,
  usage
};

if (require.main === module) {
  try {
    runAdapterDeriveCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`adapter-derive error: ${error.message}\n`);
    process.exit(1);
  }
}
