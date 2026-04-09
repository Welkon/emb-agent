#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const templateCli = require(path.join(ROOT, 'scripts', 'template.cjs'));
const attachProject = require(path.join(ROOT, 'scripts', 'attach-project.cjs'));

function usage() {
  process.stdout.write(
    [
      'ingest-truth usage:',
      '  node scripts/ingest-truth.cjs hardware [--mcu <name>] [--board <name>] [--target <name>]',
      '    [--truth <text>] [--constraint <text>] [--unknown <text>] [--source <path>]',
      '    [--signal <name> --pin <pin> --dir <direction> [--default-state <state>] [--note <text>] [--confirmed <true|false>]]',
      '    [--peripheral <name> --usage <text>] [--force]',
      '  node scripts/ingest-truth.cjs requirements [--goal <text>] [--feature <text>] [--constraint <text>]',
      '    [--accept <text>] [--failure <text>] [--unknown <text>] [--source <path>] [--force]'
    ].join('\n') + '\n'
  );
}

function parseBooleanToken(value, token) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  throw new Error(`Expected true or false after ${token}`);
}

function parseArgs(argv) {
  const result = {
    domain: argv[0] || '',
    project: '',
    force: false,
    mcu: '',
    package: '',
    board: '',
    target: '',
    truths: [],
    constraints: [],
    unknowns: [],
    sources: [],
    signals: [],
    peripherals: [],
    goals: [],
    features: [],
    acceptance: [],
    failurePolicy: [],
    help: false
  };

  for (let index = 1; index < argv.length; index += 1) {
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
    if (token === '--mcu') {
      result.mcu = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--package') {
      result.package = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--board') {
      result.board = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--target') {
      result.target = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--signal') {
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value after --signal');
      }
      result.signals.push({
        name: value,
        pin: '',
        direction: '',
        default_state: '',
        confirmed: null,
        note: ''
      });
      index += 1;
      continue;
    }
    if (token === '--pin') {
      const currentSignal = result.signals[result.signals.length - 1];
      if (!currentSignal) {
        throw new Error('--pin must follow --signal');
      }
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value after --pin');
      }
      currentSignal.pin = value;
      index += 1;
      continue;
    }
    if (token === '--dir' || token === '--direction') {
      const currentSignal = result.signals[result.signals.length - 1];
      if (!currentSignal) {
        throw new Error(`${token} must follow --signal`);
      }
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error(`Missing value after ${token}`);
      }
      currentSignal.direction = value;
      index += 1;
      continue;
    }
    if (token === '--default-state' || token === '--default') {
      const currentSignal = result.signals[result.signals.length - 1];
      if (!currentSignal) {
        throw new Error(`${token} must follow --signal`);
      }
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error(`Missing value after ${token}`);
      }
      currentSignal.default_state = value;
      index += 1;
      continue;
    }
    if (token === '--note') {
      const currentSignal = result.signals[result.signals.length - 1];
      if (!currentSignal) {
        throw new Error('--note must follow --signal');
      }
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value after --note');
      }
      currentSignal.note = value;
      index += 1;
      continue;
    }
    if (token === '--confirmed') {
      const currentSignal = result.signals[result.signals.length - 1];
      if (!currentSignal) {
        throw new Error('--confirmed must follow --signal');
      }
      currentSignal.confirmed = parseBooleanToken(argv[index + 1] || '', '--confirmed');
      index += 1;
      continue;
    }
    if (token === '--peripheral') {
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value after --peripheral');
      }
      result.peripherals.push({
        name: value,
        usage: ''
      });
      index += 1;
      continue;
    }
    if (token === '--usage') {
      const currentPeripheral = result.peripherals[result.peripherals.length - 1];
      if (!currentPeripheral) {
        throw new Error('--usage must follow --peripheral');
      }
      const value = argv[index + 1] || '';
      if (!value) {
        throw new Error('Missing value after --usage');
      }
      currentPeripheral.usage = value;
      index += 1;
      continue;
    }
    if (token === '--truth') {
      result.truths.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--constraint') {
      result.constraints.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--unknown') {
      result.unknowns.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--source') {
      result.sources.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--goal') {
      result.goals.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--feature') {
      result.features.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--accept') {
      result.acceptance.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--failure') {
      result.failurePolicy.push(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--force') {
      result.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!['hardware', 'requirements'].includes(result.domain)) {
    throw new Error(`Unknown ingest domain: ${result.domain}`);
  }
  if (result.domain === 'requirements' && (result.signals.length > 0 || result.peripherals.length > 0)) {
    throw new Error('Signal and peripheral fields are only supported for hardware ingest');
  }

  return result;
}

function ensureTemplateFile(projectRoot, templateName) {
  const templates = templateCli.loadTemplates();
  const meta = templates[templateName];
  if (!meta) {
    throw new Error(`Template not found: ${templateName}`);
  }

  const outputPath = path.resolve(projectRoot, meta.default_output);
  if (!fs.existsSync(outputPath)) {
    templateCli.fillCommand(templateName, meta.default_output, {}, true);
  }
  return outputPath;
}

function normalizeExistingList(lines, start, end, itemIndent, placeholders) {
  const ignored = new Set([
    '""',
    "''",
    ...((placeholders || []).map(item => JSON.stringify(item))),
    ...(placeholders || [])
  ]);

  return lines
    .slice(start + 1, end)
    .map(line => line.replace(`${itemIndent}- `, '').trim())
    .filter(item => item && !ignored.has(item));
}

function appendListBlock(content, keyLine, itemIndent, values, placeholders) {
  if (!values || values.length === 0) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => line === keyLine);
  if (start === -1) {
    return content;
  }

  let end = start + 1;
  while (end < lines.length && lines[end].startsWith(`${itemIndent}- `)) {
    end += 1;
  }

  const existing = normalizeExistingList(lines, start, end, itemIndent, placeholders);
  const merged = runtime.unique([...existing, ...values.filter(Boolean)]);
  const nextItems = merged.length > 0
    ? merged.map(value => `${itemIndent}- ${JSON.stringify(value)}`)
    : [`${itemIndent}- ""`];

  lines.splice(start + 1, end - (start + 1), ...nextItems);
  return lines.join('\n');
}

function parseScalar(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseYamlObjectLine(line, prefix) {
  if (!line.startsWith(prefix)) {
    return null;
  }
  const body = line.slice(prefix.length);
  const separator = body.indexOf(':');
  if (separator === -1) {
    return null;
  }

  return {
    key: body.slice(0, separator).trim(),
    value: parseScalar(body.slice(separator + 1).trim())
  };
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

function normalizeSignalEntry(entry) {
  return {
    name: String((entry && entry.name) || '').trim(),
    pin: String((entry && entry.pin) || '').trim(),
    direction: String((entry && entry.direction) || '').trim(),
    default_state: String((entry && entry.default_state) || '').trim(),
    confirmed: typeof entry.confirmed === 'boolean' ? entry.confirmed : null,
    note: String((entry && entry.note) || '').trim()
  };
}

function normalizePeripheralEntry(entry) {
  return {
    name: String((entry && entry.name) || '').trim(),
    usage: String((entry && entry.usage) || '').trim()
  };
}

function isPlaceholderSignal(entry) {
  const normalized = normalizeSignalEntry(entry);
  if (!normalized.name) {
    return true;
  }

  const placeholders = [
    ['INPUT_1', 'PA0', 'input'],
    ['OUTPUT_1', 'PA1', 'output']
  ];

  return placeholders.some(([name, pin, direction]) =>
    normalized.name === name &&
    normalized.pin === pin &&
    normalized.direction === direction
  );
}

function isPlaceholderPeripheral(entry) {
  const normalized = normalizePeripheralEntry(entry);
  return !normalized.name && !normalized.usage;
}

function mergeSignalEntries(existing, incoming) {
  const merged = [];
  const indexByKey = new Map();

  function pushSignal(entry) {
    const normalized = normalizeSignalEntry(entry);
    if (!normalized.name) {
      return;
    }
    const key = normalized.name.toLowerCase();
    if (indexByKey.has(key)) {
      const current = merged[indexByKey.get(key)];
      merged[indexByKey.get(key)] = {
        ...current,
        pin: normalized.pin || current.pin,
        direction: normalized.direction || current.direction,
        default_state: normalized.default_state || current.default_state,
        confirmed: typeof normalized.confirmed === 'boolean' ? normalized.confirmed : current.confirmed,
        note: normalized.note || current.note
      };
      return;
    }
    indexByKey.set(key, merged.length);
    merged.push(normalized);
  }

  (existing || []).filter(entry => !isPlaceholderSignal(entry)).forEach(pushSignal);
  (incoming || []).forEach(pushSignal);

  return merged;
}

function mergePeripheralEntries(existing, incoming) {
  const merged = [];
  const indexByKey = new Map();

  function pushPeripheral(entry) {
    const normalized = normalizePeripheralEntry(entry);
    if (!normalized.name) {
      return;
    }
    const key = normalized.name.toLowerCase();
    if (indexByKey.has(key)) {
      const current = merged[indexByKey.get(key)];
      merged[indexByKey.get(key)] = {
        ...current,
        usage: normalized.usage || current.usage
      };
      return;
    }
    indexByKey.set(key, merged.length);
    merged.push(normalized);
  }

  (existing || []).filter(entry => !isPlaceholderPeripheral(entry)).forEach(pushPeripheral);
  (incoming || []).forEach(pushPeripheral);

  return merged;
}

function replaceObjectListBlock(content, keyLine, itemIndent, entries, renderEntry) {
  if (!entries || entries.length === 0) {
    return content;
  }

  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(line => line === keyLine);
  if (start === -1) {
    return content;
  }

  let end = start + 1;
  while (end < lines.length && lines[end].startsWith(itemIndent)) {
    end += 1;
  }

  const rendered = entries.flatMap(entry => renderEntry(entry, itemIndent));
  lines.splice(start + 1, end - (start + 1), ...rendered);
  return lines.join('\n');
}

function renderSignalEntry(entry, itemIndent) {
  const normalized = normalizeSignalEntry(entry);
  return [
    `${itemIndent}- name: ${JSON.stringify(normalized.name)}`,
    `${itemIndent}  pin: ${JSON.stringify(normalized.pin)}`,
    `${itemIndent}  direction: ${JSON.stringify(normalized.direction)}`,
    `${itemIndent}  default_state: ${JSON.stringify(normalized.default_state)}`,
    `${itemIndent}  confirmed: ${typeof normalized.confirmed === 'boolean' ? String(normalized.confirmed) : 'false'}`,
    `${itemIndent}  note: ${JSON.stringify(normalized.note)}`
  ];
}

function renderPeripheralEntry(entry, itemIndent) {
  const normalized = normalizePeripheralEntry(entry);
  return [
    `${itemIndent}- name: ${JSON.stringify(normalized.name)}`,
    `${itemIndent}  usage: ${JSON.stringify(normalized.usage)}`
  ];
}

function ingestHardware(projectRoot, args) {
  const filePath = ensureTemplateFile(projectRoot, 'hw-truth');
  let content = runtime.readText(filePath);
  const nextSignals = mergeSignalEntries(
    readObjectList(content, 'signals:', '  '),
    args.signals || []
  );
  const nextPeripherals = mergePeripheralEntries(
    readObjectList(content, 'peripherals:', '  '),
    args.peripherals || []
  );

  content = attachProject.replaceScalarLine(content, '  model: ', args.mcu, args.force);
  content = attachProject.replaceScalarLine(content, '  package: ', args.package, args.force);
  content = attachProject.replaceScalarLine(content, '  name: ', args.board, args.force);
  content = attachProject.replaceScalarLine(content, '  target: ', args.target, args.force);
  content = replaceObjectListBlock(content, 'signals:', '  ', nextSignals, renderSignalEntry);
  content = replaceObjectListBlock(content, 'peripherals:', '  ', nextPeripherals, renderPeripheralEntry);
  content = appendListBlock(content, 'truths:', '  ', args.truths, ['']);
  content = appendListBlock(content, 'constraints:', '  ', args.constraints, ['']);
  content = appendListBlock(content, 'unknowns:', '  ', args.unknowns, ['']);
  content = appendListBlock(content, '  datasheet:', '    ', args.sources, ['']);

  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');

  return {
    domain: 'hardware',
    target: path.relative(projectRoot, filePath),
    updated: {
      truths: args.truths,
      constraints: args.constraints,
      unknowns: args.unknowns,
      sources: args.sources,
      signals: nextSignals,
      peripherals: nextPeripherals
    }
  };
}

function ingestRequirements(projectRoot, args) {
  const filePath = ensureTemplateFile(projectRoot, 'req-truth');
  let content = runtime.readText(filePath);

  content = appendListBlock(content, 'goals:', '  ', args.goals, ['Define the first deliverable target for the current project']);
  content = appendListBlock(content, 'features:', '  ', args.features, ['Complete the most critical board-level behavior or feature closure']);
  content = appendListBlock(content, 'constraints:', '  ', args.constraints, ['Prefer reusing the existing codebase and hardware truth before expanding architecture']);
  content = appendListBlock(content, 'acceptance:', '  ', args.acceptance, ['The current goal can be confirmed at board level or through a minimal verification path']);
  content = appendListBlock(content, 'failure_policy:', '  ', args.failurePolicy, ['When hardware or requirements are unconfirmed, record an unknown first instead of guessing']);
  content = appendListBlock(content, 'unknowns:', '  ', args.unknowns, ['Customer or production requirements still need confirmation']);
  content = appendListBlock(content, 'sources:', '  ', args.sources, ['']);

  fs.writeFileSync(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');

  return {
    domain: 'requirements',
    target: path.relative(projectRoot, filePath),
    updated: {
      goals: args.goals,
      features: args.features,
      constraints: args.constraints,
      acceptance: args.acceptance,
      failure_policy: args.failurePolicy,
      unknowns: args.unknowns,
      sources: args.sources
    }
  };
}

function ingestTruth(argv) {
  const args = parseArgs(argv || []);
  if (args.help) {
    return { help: true };
  }

  const projectRoot = path.resolve(args.project || process.cwd());
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Project root not found: ${projectRoot}`);
  }

  if (args.domain === 'hardware') {
    return ingestHardware(projectRoot, args);
  }

  return ingestRequirements(projectRoot, args);
}

function main(argv) {
  const args = parseArgs(argv || process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  process.stdout.write(JSON.stringify(ingestTruth(argv || process.argv.slice(2)), null, 2) + '\n');
}

module.exports = {
  appendListBlock,
  ingestHardware,
  ingestRequirements,
  ingestTruth,
  main,
  parseArgs
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ingest-truth error: ${error.message}\n`);
    process.exit(1);
  }
}
