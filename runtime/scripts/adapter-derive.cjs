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
      '    [--from-project] [--from-doc <doc-id>]',
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

  if (!result.fromProject && !result.fromDoc) {
    result.family = ensureNonEmpty(result.family, '--family');
    result.device = ensureNonEmpty(result.device, '--device');
    result.chip = ensureNonEmpty(result.chip, '--chip');
  }
  if (result.fromDoc) {
    result.fromDoc = ensureNonEmpty(result.fromDoc, '--from-doc');
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

function inferTools(peripherals, extraTextParts) {
  const haystack = runtime.unique([
    ...(peripherals || []).map(item => (item && item.name) || ''),
    ...(extraTextParts || [])
  ]).join('\n');

  const patterns = [
    ['timer-calc', /\bTIMER(?:\d+)?\b|\bT16\b|\bTM2\b|\bTM3\b/i],
    ['pwm-calc', /\bPWM\b/i],
    ['lpwmg-calc', /\bLPWMG\b|\bLPG\dPWM\b/i],
    ['lvdc-threshold', /\bLVDC\b|\bLVD\b|low-voltage detection/i],
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
  const timers = matchPeripherals(config.peripherals, /\bTIMER(?:\d+)?\b|\bT16\b|\bTM2\b|\bTM3\b/i)
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
  const lpwmg = findPeripheral(config.peripherals, /\bLPWMG\b|\bLPG\dPWM\b/i);
  const lpwmgName = lpwmg ? String(lpwmg.name) : 'LPWMG';
  const lpwmgSignals = matchSignals(config.signals, /\bLPWMG\b|\bLPG\dPWM\b|PWM|pwm-output/i);
  const channelPins = {
    lpwmg0: buildBindingMap(
      lpwmgSignals.filter(item => /\bLPWMG0\b|\bLPG0PWM\b/i.test(signalHaystack(item))),
      'lpwmg-output'
    ),
    lpwmg1: buildBindingMap(
      lpwmgSignals.filter(item => /\bLPWMG1\b|\bLPG1PWM\b/i.test(signalHaystack(item))),
      'lpwmg-output'
    ),
    lpwmg2: buildBindingMap(
      lpwmgSignals.filter(item => /\bLPWMG2\b|\bLPG2PWM\b/i.test(signalHaystack(item))),
      'lpwmg-output'
    )
  };
  const defaultChannel = Object.entries(channelPins).find(([, pins]) => Object.keys(pins).length > 0);
  const defaultPin = defaultChannel ? Object.keys(defaultChannel[1])[0] : '';

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {
      default_channel: defaultChannel ? defaultChannel[0] : undefined,
      default_output_pin: defaultPin || undefined,
      channels: channelPins
    },
    evidence: runtime.unique([
      lpwmgName ? `peripheral:${lpwmgName}` : '',
      ...Object.values(channelPins).flatMap(pins => Object.keys(pins).map(pin => `signal:${pin}`)),
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        lpwmgName ? `LPWMG capability ${lpwmgName} was identified.` : 'Only LPWMG keywords were identified; the exact channel still needs manual confirmation.',
        defaultPin
          ? `Default LPWMG output candidate ${defaultPin} was identified from project truth.`
          : 'The default LPWMG output pin is unconfirmed.'
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
  const lvdc = findPeripheral(config.peripherals, /\bLVDC\b|\bLVD\b/i);
  const lvdcName = lvdc ? String(lvdc.name) : 'LVDC';

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {
      register_name: 'LVDC'
    },
    evidence: runtime.unique([
      lvdcName ? `peripheral:${lvdcName}` : '',
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        lvdcName ? `Low-voltage detection capability ${lvdcName} was identified.` : 'Only LVDC/LVD keywords were identified; exact register fields still need manual confirmation.'
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
    params: {
      control_macro: 'CHG_CTRL',
      status_register: 'CHG_TEMP'
    },
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
  let vendor = config.vendor || '';
  let model = '';
  let pkg = config.package || '';
  const signals = [];
  const peripherals = [];
  const truths = [];
  const constraints = [];
  const unknowns = [];
  const notes = [];

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

  const vendorResolved = vendor || 'VendorName';
  const deviceResolved = config.device || compactSlug(model);
  const seriesResolved = config.series || model || deviceResolved || 'SeriesName';
  const familyResolved = config.family || normalizeSlug(`${vendorResolved}-${seriesResolved}`);
  const chipSeed = compactSlug(model || deviceResolved);
  const packageSeed = compactSlug(pkg);
  const chipResolved = config.chip || compactSlug(`${chipSeed}${packageSeed}`);
  const inferredTools = inferTools(peripherals, [...truths, ...constraints, ...unknowns]);
  const toolsResolved = config.tools.length > 0 ? config.tools.slice() : (inferredTools.length > 0 ? inferredTools : ['timer-calc']);
  const resolved = {
    vendor: vendorResolved,
    series: seriesResolved,
    family: familyResolved,
    device: deviceResolved,
    chip: chipResolved,
    package: pkg,
    pinCount: config.pinCount || inferPinCountFromPackage(pkg),
    tools: runtime.unique(toolsResolved),
    capabilities: runtime.unique(peripherals.map(item => (item && item.name) || '')),
    docs: buildDocReference(docInfo, model, pkg),
    signals: buildSignals(signals, [...truths, ...constraints, ...unknowns]),
    peripherals: uniqueObjectsByName(peripherals),
    notes: runtime.unique([
      ...notes,
      truthInfo ? `truths=${(truthInfo.data.truths || []).length}` : '',
      docInfo ? `doc_id=${docInfo.entry.doc_id}` : ''
    ])
  };

  return {
    truthInfo,
    docInfo,
    ...resolved,
    bindings: buildDraftBindings(resolved)
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
    '        adapter_path: context.adapterPath,',
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
    "          'No matching binding has been found yet. Add device/family bindings first, or run support derive again.'",
    '        ]',
    '      };',
    '    }',
    '',
    '    return {',
    '      tool: context.toolName,',
    "      status: 'draft-chip-support',",
    "      implementation: 'external-chip-support-draft',",
    '      adapter_name: ADAPTER_NAME,',
    '      adapter_path: context.adapterPath,',
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
      supported_tools: config.tools.slice(),
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
      supported_tools: config.tools.slice(),
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
    related_tools: config.tools.slice(),
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
        adapter_path: path.relative(projectRoot, path.join(embRoot, 'adapters', 'routes', `${toolName}.cjs`)) || `${toolName}.cjs`
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
  config.tools = derived.tools.slice();
  config.capabilities = derived.capabilities.slice();
  config.docs = derived.docs.slice();
  config.signals = (derived.signals || []).slice();
  config.peripherals = (derived.peripherals || []).slice();
  config.bindings = { ...(derived.bindings || {}) };
  config.inference_notes = derived.notes.slice();
  config.source_mode = config.fromDoc && config.fromProject ? 'project+doc' : config.fromDoc ? 'doc' : config.fromProject ? 'project' : 'manual';

  const embRoot = resolveEmbOutputRoot(runtimeRoot, projectRoot, config);
  const toolExtRoot = path.join(embRoot, 'extensions', 'tools');
  const chipExtRoot = path.join(embRoot, 'extensions', 'chips');
  const adapterRoutesRoot = path.join(embRoot, 'adapters', 'routes');

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
    trust: trustReport,
    notes: [
      'Family/device/chip drafts were generated, and device draft bindings were added from inferable information.',
      'The generated result is still draft chip support; do not treat tool output as ground truth yet.',
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
