#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const schdocParser = require(path.join(ROOT, 'lib', 'schdoc-parser.cjs'));

const RAW_ALTIUM_EXTS = new Set(['.schdoc']);
const JSON_EXTS = new Set(['.json']);
const TEXT_EXTS = new Set(['.txt', '.log', '.net']);
const CSV_EXTS = new Set(['.csv']);

function usage() {
  process.stdout.write(
    [
      'ingest-schematic usage:',
      '  node scripts/ingest-schematic.cjs --file <path> [--format auto|altium-json|netlist|bom-csv|text] [--title <text>] [--force]',
      '  node scripts/ingest-schematic.cjs --file docs/board.json --format altium-json',
      '  node scripts/ingest-schematic.cjs --file docs/netlist.txt --format netlist'
    ].join('\n') + '\n'
  );
}

function parseArgs(argv) {
  const result = {
    project: '',
    file: '',
    format: 'auto',
    title: '',
    force: false,
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
    if (token === '--format') {
      result.format = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--title') {
      result.title = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--force') {
      result.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (result.help) {
    return result;
  }

  if (!result.file) {
    throw new Error('Missing path after --file');
  }
  if (!['auto', 'altium-json', 'netlist', 'bom-csv', 'text'].includes(result.format)) {
    throw new Error('format must be auto, altium-json, netlist, bom-csv, or text');
  }

  return result;
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
          const firstLine = (firstValue && typeof firstValue === 'object')
            ? `${currentIndent}- ${firstKey}:\n${toYaml(firstValue, `${currentIndent}    `)}`
            : `${currentIndent}- ${firstKey}: ${JSON.stringify(firstValue)}`;
          const rest = entries.slice(1).map(([key, nested]) => {
            if (nested && typeof nested === 'object') {
              return `${currentIndent}  ${key}:\n${toYaml(nested, `${currentIndent}    `)}`;
            }
            return `${currentIndent}  ${key}: ${JSON.stringify(nested)}`;
          });
          return [firstLine].concat(rest).join('\n');
        }

        return `${currentIndent}- ${JSON.stringify(item)}`;
      })
      .join('\n');
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, nested]) => {
        if (Array.isArray(nested)) {
          if (nested.length === 0) {
            return `${currentIndent}${key}: []`;
          }
          return `${currentIndent}${key}:\n${toYaml(nested, `${currentIndent}  `)}`;
        }
        if (nested && typeof nested === 'object') {
          return `${currentIndent}${key}:\n${toYaml(nested, `${currentIndent}  `)}`;
        }
        return `${currentIndent}${key}: ${JSON.stringify(nested)}`;
      })
      .join('\n');
  }

  return `${currentIndent}${JSON.stringify(value)}`;
}

function hashString(text) {
  const payload = Buffer.isBuffer(text) ? text : Buffer.from(String(text || ''), 'utf8');
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function ensureString(value) {
  return String(value || '').trim();
}

function normalizePackage(value) {
  return ensureString(value).replace(/\s+/g, '');
}

function getSchematicCacheRoot(projectRoot) {
  return path.join(runtime.getProjectExtDir(projectRoot), 'cache', 'schematics');
}

function detectFormat(filePath, requestedFormat) {
  if (requestedFormat && requestedFormat !== 'auto') {
    return requestedFormat;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (JSON_EXTS.has(ext)) return 'altium-json';
  if (CSV_EXTS.has(ext)) return 'bom-csv';
  if (TEXT_EXTS.has(ext)) return 'netlist';
  if (RAW_ALTIUM_EXTS.has(ext)) return 'altium-raw';
  return 'text';
}

function makeArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectObjects(node, results, depth) {
  if (!node || depth > 8) {
    return;
  }

  if (Array.isArray(node)) {
    node.forEach(item => collectObjects(item, results, depth + 1));
    return;
  }

  if (typeof node !== 'object') {
    return;
  }

  results.push(node);
  Object.values(node).forEach(value => collectObjects(value, results, depth + 1));
}

function normalizeComponent(input) {
  const designator = ensureString(
    input.designator ||
    input.refdes ||
    input.ref
  );
  if (!designator || !/^[A-Za-z][A-Za-z0-9_+\-]{0,15}$/u.test(designator)) {
    return null;
  }

  const component = {
    designator,
    value: ensureString(input.value || input.comment || input.description || ''),
    comment: ensureString(input.comment || input.description || ''),
    library_ref: ensureString(input.libref || input.library_ref || input.symbol || ''),
    footprint: normalizePackage(input.footprint || input.package || input.pattern || ''),
    pins: makeArray(input.pins).map(pin => ({
      number: ensureString(pin.number || pin.pin || ''),
      name: ensureString(pin.name || pin.label || ''),
      net: ensureString(pin.net || pin.signal || '')
    })).filter(pin => pin.number || pin.name || pin.net)
  };
  component.type_guess = '';
  component.component_refs = [];
  return component;
}

function normalizeNet(input) {
  const hasGroupingFields =
    Object.prototype.hasOwnProperty.call(input || {}, 'members') ||
    Object.prototype.hasOwnProperty.call(input || {}, 'nodes') ||
    Object.prototype.hasOwnProperty.call(input || {}, 'connections') ||
    Object.prototype.hasOwnProperty.call(input || {}, 'pins');
  const hasNamedNetFields =
    Object.prototype.hasOwnProperty.call(input || {}, 'label') ||
    Object.prototype.hasOwnProperty.call(input || {}, 'signal');
  const hasPinShape =
    Object.prototype.hasOwnProperty.call(input || {}, 'number') ||
    Object.prototype.hasOwnProperty.call(input || {}, 'pin');
  const hasNetShape = hasGroupingFields || hasNamedNetFields || Object.prototype.hasOwnProperty.call(input || {}, 'net');
  if (hasPinShape && !hasGroupingFields && !hasNamedNetFields) {
    return null;
  }
  const name = ensureString(
    input.net ||
    input.label ||
    input.signal ||
    (hasNetShape ? input.name : '')
  );
  if (!name) {
    return null;
  }

  return {
    name,
    members: runtime.unique(
      makeArray(input.members || input.nodes || input.connections || input.pins)
        .map(item => {
          if (typeof item === 'string') {
            return ensureString(item);
          }
          if (!item || typeof item !== 'object') {
            return '';
          }
          return ensureString(
            item.ref ||
            item.designator ||
            item.pin ||
            item.node ||
            item.component
          );
        })
        .filter(Boolean)
    )
  };
}

function parseAltiumJson(text) {
  const raw = JSON.parse(text);
  const objects = [];
  collectObjects(raw, objects, 0);

  const components = objects
    .map(normalizeComponent)
    .filter(Boolean)
    .filter((item, index, list) => index === list.findIndex(other => other.designator === item.designator));

  const nets = objects
    .map(normalizeNet)
    .filter(Boolean)
    .filter((item, index, list) => index === list.findIndex(other => other.name === item.name));

  return {
    parser_mode: 'heuristic-json',
    components,
    nets,
    raw_summary: {
      top_level_keys: raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw).slice(0, 12) : [],
      object_count: objects.length
    }
  };
}

function parseBomCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return {
      parser_mode: 'bom-csv',
      components: [],
      nets: []
    };
  }

  const headers = lines[0].split(',').map(item => item.trim().toLowerCase());
  const designatorIndex = headers.findIndex(item => ['designator', 'designators', 'refdes'].includes(item));
  const valueIndex = headers.findIndex(item => ['value', 'comment', 'description'].includes(item));
  const footprintIndex = headers.findIndex(item => ['footprint', 'package', 'pattern'].includes(item));

  const components = lines.slice(1).flatMap(line => {
    const cols = line.split(',').map(item => item.trim());
    const designators = ensureString(cols[designatorIndex] || '')
      .split(/[;|/]/u)
      .map(item => item.trim())
      .filter(Boolean);

    return designators.map(designator => normalizeComponent({
      designator,
      value: cols[valueIndex] || '',
      footprint: cols[footprintIndex] || ''
    })).filter(Boolean);
  });

  return {
    parser_mode: 'bom-csv',
    components,
    nets: []
  };
}

function parseNetlistText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const components = [];
  const nets = [];

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    const componentMatch = trimmed.match(/\b([A-Za-z]{1,4}\d+)\b.*?\b(VS1838B?|HX1838|TSOP\d+|IRM\d+|MAX485|SP3485)\b/i);
    if (componentMatch) {
      const component = normalizeComponent({
        designator: componentMatch[1],
        value: componentMatch[2]
      });
      if (component) {
        components.push(component);
      }
    }

    const netMatch = trimmed.match(/\b([A-Za-z][A-Za-z0-9_/-]{1,63})\b\s*[:=-]?\s*(?:connects?|net)?/u);
    if (netMatch && /\b(ir|remote|uart|rx|tx|pwm|key)\b/i.test(netMatch[1])) {
      const net = normalizeNet({ name: netMatch[1] });
      if (net) {
        nets.push(net);
      }
    }
  });

  return {
    parser_mode: 'netlist-text',
    components: components.filter((item, index, list) => index === list.findIndex(other => other.designator === item.designator)),
    nets: nets.filter((item, index, list) => index === list.findIndex(other => other.name === item.name))
  };
}

function parsePlainText(text) {
  return parseNetlistText(text);
}

function parseAltiumRaw(buffer) {
  const raw = schdocParser.parseSchDocBuffer(buffer);

  return {
    parser_mode: raw.parser_mode,
    components: (raw.components || [])
      .map(component => normalizeComponent(component))
      .filter(Boolean),
    nets: (raw.nets || [])
      .map(net => normalizeNet(net))
      .filter(Boolean)
      .filter((item, index, list) => index === list.findIndex(other => other.name === item.name)),
    raw_summary: raw.raw_summary || {}
  };
}

function isUnnamedNet(name) {
  return /^UNNAMED_NET_\d+$/i.test(String(name || ''));
}

function buildHardwareDraft(sourcePath, parsed) {
  const components = parsed.components || [];
  const nets = parsed.nets || [];
  const namedNets = runtime.unique(
    nets
      .map(net => ensureString(net.name))
      .filter(Boolean)
      .filter(name => !isUnnamedNet(name))
  );
  const truths = runtime.unique([
    `Normalized schematic source: ${sourcePath}`,
    `Normalized ${components.length} components and ${nets.length} nets from the schematic input`,
    namedNets.length > 0 ? `Named nets extracted: ${namedNets.join(', ')}` : 'No named nets were extracted from the schematic input'
  ]);
  const unknowns = runtime.unique([
    'Component roles, controller identity, and signal direction should be judged later by the agent from parsed.json',
    components.length > 0 ? '' : 'No components were normalized from the schematic input',
    nets.length > 0 ? '' : 'No nets were normalized from the schematic input'
  ].filter(Boolean));

  return {
    mcu: {
      vendor: '',
      model: '',
      package: ''
    },
    signals: [],
    peripherals: [],
    truths,
    constraints: [],
    unknowns,
    sources: [sourcePath],
    component_refs: []
  };
}

function countNamedNets(parsed) {
  return makeArray(parsed && parsed.nets)
    .map(item => ensureString(item && item.name))
    .filter(Boolean).length;
}

function buildAgentAnalysisHandoff(sourcePath, parsed, artifacts) {
  const components = makeArray(parsed && parsed.components);
  const candidateComponents = components
    .filter(component =>
      ensureString(component && component.designator) &&
      (
        ensureString(component && component.value) ||
        ensureString(component && component.comment) ||
        ensureString(component && component.footprint) ||
        ensureString(component && component.package) ||
        ensureString(component && component.datasheet)
      )
    )
    .slice(0, 8)
    .map(component => ({
      designator: ensureString(component.designator),
      value: ensureString(component.value),
      comment: ensureString(component.comment),
      package: ensureString(component.package || component.footprint),
      datasheet: ensureString(component.datasheet)
    }));

  return {
    required: true,
    status: 'agent-review-required',
    recommended_agent: 'emb-hw-scout',
    summary: 'Let emb-hw-scout inspect the normalized schematic before writing controller identity, signal roles, or peripheral truth into hw.yaml.',
    inputs: [
      artifacts.parsed,
      artifacts.hardware_facts,
      sourcePath
    ].filter(Boolean),
    evidence: {
      components: components.length,
      named_nets: countNamedNets(parsed),
      components_with_package: components.filter(item => ensureString(item.package || item.footprint)).length,
      components_with_datasheet: components.filter(item => ensureString(item.datasheet)).length
    },
    candidate_components: candidateComponents,
    confirmation_targets: [
      'mcu.vendor',
      'mcu.model',
      'mcu.package',
      'signals[]',
      'peripherals[]',
      'docs.datasheet[]'
    ],
    expected_output: [
      'Separate explicit schematic facts from engineering inference.',
      'Propose confirmation candidates instead of writing truth directly.',
      'List what still needs datasheet, BOM, board photo, or manual confirmation.'
    ],
    cli_hint: `Ask emb-hw-scout to inspect ${artifacts.parsed} and ${artifacts.hardware_facts} first.`
  };
}

function getArtifactPaths(projectRoot, cacheDir) {
  return {
    parsedJson: path.join(cacheDir, 'parsed.json'),
    summaryJson: path.join(cacheDir, 'summary.json'),
    hardwareYaml: path.join(cacheDir, 'facts.hardware.yaml'),
    hardwareJson: path.join(cacheDir, 'facts.hardware.json'),
    sourceJson: path.join(cacheDir, 'source.json')
  };
}

function ingestSchematic(argv, options) {
  const args = parseArgs(argv || []);
  if (args.help) {
    usage();
    return { __side_effect_only: true };
  }

  const projectRoot = path.resolve(args.project || ((options && options.projectRoot) || process.cwd()));
  const absolutePath = path.resolve(projectRoot, args.file);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Schematic source not found: ${args.file}`);
  }

  runtime.initProjectLayout(projectRoot);
  const sourceBuffer = fs.readFileSync(absolutePath);
  const relativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
  const detectedFormat = detectFormat(absolutePath, args.format);
  const cacheKey = hashString(JSON.stringify({
    file: relativePath,
    format: detectedFormat,
    title: args.title,
    content_hash: hashString(sourceBuffer)
  }));
  const schematicId = `schematic-${cacheKey.slice(0, 12)}`;
  const cacheDir = path.join(getSchematicCacheRoot(projectRoot), schematicId);
  const artifactPaths = getArtifactPaths(projectRoot, cacheDir);

  runtime.ensureDir(getSchematicCacheRoot(projectRoot));

  if (!args.force && fs.existsSync(artifactPaths.summaryJson) && fs.existsSync(artifactPaths.hardwareJson)) {
    const cached = runtime.readJson(artifactPaths.summaryJson);
    return {
      ...cached,
      cached: true,
      last_files: [path.relative(projectRoot, artifactPaths.summaryJson).replace(/\\/g, '/')]
    };
  }

  const sourceText = sourceBuffer.toString('utf8');
  const parsed = detectedFormat === 'altium-json'
    ? parseAltiumJson(sourceText)
    : detectedFormat === 'bom-csv'
      ? parseBomCsv(sourceText)
      : detectedFormat === 'netlist'
        ? parseNetlistText(sourceText)
        : detectedFormat === 'altium-raw'
          ? parseAltiumRaw(sourceBuffer)
          : parsePlainText(sourceText);

  const hardwareDraft = buildHardwareDraft(relativePath, parsed);
  const componentRefs = [];
  const signalCandidates = [];
  const summary = {
    status: 'ok',
    domain: 'schematic',
    cached: false,
    source_path: relativePath,
    format: detectedFormat,
    schematic_id: schematicId,
    parser: {
      mode: parsed.parser_mode || detectedFormat,
      summary: 'Schematic input was normalized into reusable board facts; all inferred pins and roles still need datasheet/manual confirmation'
    },
    summary: {
      components: (parsed.components || []).length,
      nets: (parsed.nets || []).length,
      signal_candidates: signalCandidates.length,
      component_ref_candidates: componentRefs.length
    },
    component_refs: componentRefs,
    signal_candidates: signalCandidates,
    next_steps: [
      `Use the generated hardware draft as a starting point before editing ${runtime.getProjectAssetRelativePath('hw.yaml')}`,
      `Inspect ${path.relative(projectRoot, artifactPaths.parsedJson).replace(/\\/g, '/')} and let the agent judge controller, signals, and peripherals from the normalized data`
    ],
    cache_dir: path.relative(projectRoot, cacheDir).replace(/\\/g, '/'),
    artifacts: {
      parsed: path.relative(projectRoot, artifactPaths.parsedJson).replace(/\\/g, '/'),
      summary: path.relative(projectRoot, artifactPaths.summaryJson).replace(/\\/g, '/'),
      hardware_facts: path.relative(projectRoot, artifactPaths.hardwareYaml).replace(/\\/g, '/'),
      hardware_facts_json: path.relative(projectRoot, artifactPaths.hardwareJson).replace(/\\/g, '/'),
      source: path.relative(projectRoot, artifactPaths.sourceJson).replace(/\\/g, '/')
    },
    agent_analysis: null,
    last_files: [
      path.relative(projectRoot, artifactPaths.parsedJson).replace(/\\/g, '/'),
      path.relative(projectRoot, artifactPaths.hardwareYaml).replace(/\\/g, '/'),
      path.relative(projectRoot, artifactPaths.summaryJson).replace(/\\/g, '/')
    ]
  };
  summary.agent_analysis = buildAgentAnalysisHandoff(relativePath, parsed, summary.artifacts);

  runtime.writeJson(artifactPaths.sourceJson, {
    source_path: relativePath,
    title: args.title || path.basename(relativePath),
    format: detectedFormat,
    parser_mode: parsed.parser_mode || detectedFormat
  });
  runtime.writeJson(artifactPaths.parsedJson, parsed);
  runtime.writeJson(artifactPaths.hardwareJson, hardwareDraft);
  fs.writeFileSync(artifactPaths.hardwareYaml, `${toYaml(hardwareDraft)}\n`, 'utf8');
  runtime.writeJson(artifactPaths.summaryJson, summary);

  return summary;
}

module.exports = {
  ingestSchematic,
  parseArgs,
  usage
};

if (require.main === module) {
  try {
    const result = ingestSchematic(process.argv.slice(2));
    if (result && !result.__side_effect_only) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
  } catch (error) {
    process.stderr.write(`ingest-schematic error: ${error.message}\n`);
    process.exit(1);
  }
}
