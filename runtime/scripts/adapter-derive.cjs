#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));
const docCache = require(path.join(ROOT, 'lib', 'doc-cache.cjs'));

function usage() {
  process.stdout.write(
    [
      'adapter-derive usage:',
      '  node scripts/adapter-derive.cjs --family <slug> --device <slug> --chip <slug>',
      '    [--from-project] [--from-doc <doc-id>]',
      '    [--tool <name>] [--vendor <name>] [--series <name>] [--package <name>]',
      '    [--pin-count <n>] [--architecture <text>] [--runtime-model <name>]',
      '    [--target project|runtime] [--project <path>] [--force]'
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
    projectRoot: '',
    force: false,
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
    if (token === '--project') {
      result.projectRoot = argv[index + 1] || '';
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

  result.runtimeModel = ensureNonEmpty(result.runtimeModel, '--runtime-model');
  result.target = ensureNonEmpty(result.target || 'project', '--target');

  if (!result.fromProject && !result.fromDoc) {
    result.family = ensureNonEmpty(result.family, '--family');
    result.device = ensureNonEmpty(result.device, '--device');
    result.chip = ensureNonEmpty(result.chip, '--chip');
  }
  if (result.fromDoc) {
    result.fromDoc = ensureNonEmpty(result.fromDoc, '--from-doc');
  }
  if (!['project', 'runtime'].includes(result.target)) {
    throw new Error('--target must be project or runtime');
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
  const filePath = path.join(projectRoot, 'emb-agent', 'hw.yaml');
  const content = fs.existsSync(filePath) ? runtime.readText(filePath) : '';

  return {
    path: path.relative(projectRoot, filePath),
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
  return uniqueObjectsByName(signals).find(item => {
    return matcher.test(String(item.name || '')) || matcher.test(String(item.usage || ''));
  });
}

function buildBindingNotes(baseNotes, evidence) {
  return runtime.unique([
    '由 adapter derive 自动生成的 draft binding，仅供 agent/开发者继续补全。',
    '当前只补安全可推断字段；具体公式、寄存器位宽、时钟源和边界仍需查手册确认。',
    ...(baseNotes || []),
    ...(evidence || [])
  ]);
}

function buildTimerBinding(toolName, config) {
  const timer = findPeripheral(config.peripherals, /\bTIMER(?:\d+)?\b|\bT16\b|\bTM2\b|\bTM3\b/i);
  const timerName = timer ? String(timer.name) : '';

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {
      default_timer: timerName || undefined,
      timer_variants: timerName
        ? {
            [timerName]: {
              peripheral: timerName
            }
          }
        : {}
    },
    evidence: runtime.unique([
      timerName ? `peripheral:${timerName}` : '',
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [timerName ? `已从 truth/doc 识别到计时器外设 ${timerName}。` : '未识别到具体计时器名，需要手工补充。']
    )
  };
}

function buildPwmBinding(toolName, config) {
  const signal = findSignal(config.signals, /PWM/i);
  const outputPin = signal ? String(signal.pin || '') : '';
  const pwm = findPeripheral(config.peripherals, /\bPWM\b/i);
  const pwmName = pwm ? String(pwm.name) : 'PWM';
  const outputPins = outputPin
    ? {
        [outputPin]: {
          signal: String(signal.name || ''),
          role: 'pwm-output'
        }
      }
    : {};

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
      outputPin ? `signal:${outputPin}` : '',
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        pwmName ? `已识别 PWM 能力 ${pwmName}。` : '仅识别到 PWM 关键词，具体 block 未确认。',
        outputPin ? `已从项目 truth 识别默认 PWM 引脚 ${outputPin}。` : '默认 PWM 输出引脚未确认。'
      ]
    )
  };
}

function buildAdcBinding(toolName, config) {
  const adc = findPeripheral(config.peripherals, /\bADC\b/i);
  const adcName = adc ? String(adc.name) : 'ADC';
  const channelSignal = findSignal(config.signals, /ADC|ANALOG|SENSE/i);
  const channelName = channelSignal ? String(channelSignal.pin || '') : '';
  const channels = channelName
    ? {
        [channelName]: {
          signal: String(channelSignal.name || ''),
          role: 'adc-input'
        }
      }
    : {};

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
      channelName ? `signal:${channelName}` : '',
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [
        adcName ? `已识别 ADC 能力 ${adcName}。` : '仅识别到 ADC 关键词，通道映射未确认。',
        channelName ? `已从项目 truth 识别默认 ADC 通道候选 ${channelName}。` : '默认 ADC 通道未确认。'
      ]
    )
  };
}

function buildComparatorBinding(toolName, config) {
  const cmp = findPeripheral(config.peripherals, /\bCOMPARATOR\b|\bCMP\b/i);
  const cmpName = cmp ? String(cmp.name) : 'Comparator';

  return {
    algorithm: `${config.device}-${slugSuffix(toolName)}`,
    draft: true,
    params: {
      positive_sources: {},
      negative_sources: {}
    },
    evidence: runtime.unique([
      cmpName ? `peripheral:${cmpName}` : '',
      ...(config.docs || []).map(item => `doc:${item.id}`)
    ]),
    notes: buildBindingNotes(
      [],
      [cmpName ? `已识别比较器能力 ${cmpName}。` : '仅识别到比较器关键词，输入源未确认。']
    )
  };
}

function buildDraftBindings(config) {
  const builders = {
    'timer-calc': buildTimerBinding,
    'pwm-calc': buildPwmBinding,
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
    signals: uniqueObjectsByName(signals),
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
  return path.join(projectRoot, 'emb-agent');
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
        '由 adapter derive 生成的 family 草稿。',
        '如不同 device 仅参数不同，优先在 device bindings/params 里补齐。',
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
        '由 adapter derive 生成的 device 草稿。',
        '已自动补 draft bindings；请根据手册、例程或已验证代码补真实算法参数。',
        ...(config.inference_notes || [])
      ]
  };
}

function buildChipPackages(config) {
  if (!config.package) {
    return [];
  }

  return [
    {
      name: config.package,
      pin_count: config.pinCount || undefined,
      pins: [],
      notes: ['TODO: 按封装补充物理引脚表。']
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
    pins: {},
    docs: (config.docs || []).slice(),
    related_tools: config.tools.slice(),
    source_modules: [],
    notes: [
      '由 adapter derive 生成的 chip 草稿。',
      '建议把可复用能力放在 pins/packages，避免把引脚知识散落到 tool params。',
      ...(config.inference_notes || [])
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
  config.tools = derived.tools.slice();
  config.capabilities = derived.capabilities.slice();
  config.docs = derived.docs.slice();
  config.signals = (derived.signals || []).slice();
  config.peripherals = (derived.peripherals || []).slice();
  config.bindings = { ...(derived.bindings || {}) };
  config.inference_notes = derived.notes.slice();
  config.source_mode = config.fromDoc && config.fromProject ? 'project+doc' : config.fromDoc ? 'doc' : config.fromProject ? 'project' : 'manual';

  const embRoot = targetEmbRoot(runtimeRoot, projectRoot, config.target);
  const toolExtRoot = path.join(embRoot, 'extensions', 'tools');
  const chipExtRoot = path.join(embRoot, 'extensions', 'chips');

  runtime.ensureDir(path.join(toolExtRoot, 'families'));
  runtime.ensureDir(path.join(toolExtRoot, 'devices'));
  runtime.ensureDir(path.join(chipExtRoot, 'profiles'));

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

  return {
    status: 'ok',
    target: config.target,
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
    notes: [
      '已生成 family/device/chip 草稿，并按可推断信息补了 device draft bindings。',
      '下一步应结合手册、例程或已验证代码补齐 device bindings 细节与外部 adapter 实现。'
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
