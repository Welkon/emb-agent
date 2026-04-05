#!/usr/bin/env node

'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'lib', 'runtime.cjs'));

function usage() {
  process.stdout.write(
    [
      'adapter-derive usage:',
      '  node scripts/adapter-derive.cjs --family <slug> --device <slug> --chip <slug>',
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
    vendor: 'VendorName',
    series: 'SeriesName',
    package: '',
    pinCount: 0,
    architecture: '',
    runtimeModel: 'main_loop_plus_isr',
    target: 'project',
    projectRoot: '',
    force: false,
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

  result.family = ensureNonEmpty(result.family, '--family');
  result.device = ensureNonEmpty(result.device, '--device');
  result.chip = ensureNonEmpty(result.chip, '--chip');
  result.vendor = ensureNonEmpty(result.vendor, '--vendor');
  result.series = ensureNonEmpty(result.series, '--series');
  result.runtimeModel = ensureNonEmpty(result.runtimeModel, '--runtime-model');
  result.target = ensureNonEmpty(result.target || 'project', '--target');

  if (!['project', 'runtime'].includes(result.target)) {
    throw new Error('--target must be project or runtime');
  }
  if (result.pinCount !== 0 && (!Number.isInteger(result.pinCount) || result.pinCount < 1)) {
    throw new Error('--pin-count must be a positive integer');
  }

  result.tools = runtime.unique(
    (result.tools.length > 0 ? result.tools : ['timer-calc']).map(name => ensureNonEmpty(name, '--tool'))
  );

  return result;
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
  if (require('fs').existsSync(filePath) && !force) {
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
      '如不同 device 仅参数不同，优先在 device bindings/params 里补齐。'
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
    bindings: {},
    notes: [
      '由 adapter derive 生成的 device 草稿。',
      '请根据手册、例程或已验证代码补真实 bindings。'
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
    summary: {},
    capabilities: [],
    packages: buildChipPackages(config),
    pins: {},
    docs: [],
    related_tools: config.tools.slice(),
    source_modules: [],
    notes: [
      '由 adapter derive 生成的 chip 草稿。',
      '建议把可复用能力放在 pins/packages，避免把引脚知识散落到 tool params。'
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
  const embRoot = targetEmbRoot(runtimeRoot, projectRoot, config.target);
  const toolExtRoot = path.join(embRoot, 'extensions', 'tools');
  const chipExtRoot = path.join(embRoot, 'extensions', 'chips');

  runtime.ensureDir(path.join(toolExtRoot, 'families'));
  runtime.ensureDir(path.join(toolExtRoot, 'devices'));
  runtime.ensureDir(path.join(chipExtRoot, 'devices'));

  const toolRegistryPath = path.join(toolExtRoot, 'registry.json');
  const chipRegistryPath = path.join(chipExtRoot, 'registry.json');

  if (!require('fs').existsSync(toolRegistryPath)) {
    runtime.writeJson(toolRegistryPath, { specs: [], families: [], devices: [] });
  }
  if (!require('fs').existsSync(chipRegistryPath)) {
    runtime.writeJson(chipRegistryPath, { devices: [] });
  }

  ensureRegistryValue(toolRegistryPath, { specs: [], families: [], devices: [] }, 'families', config.family);
  ensureRegistryValue(toolRegistryPath, { specs: [], families: [], devices: [] }, 'devices', config.device);
  ensureRegistryValue(chipRegistryPath, { devices: [] }, 'devices', config.chip);

  const familyPath = path.join(toolExtRoot, 'families', `${config.family}.json`);
  const devicePath = path.join(toolExtRoot, 'devices', `${config.device}.json`);
  const chipPath = path.join(chipExtRoot, 'devices', `${config.chip}.json`);

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
    tools: config.tools,
    force: config.force,
    registries: {
      tools: path.relative(projectRoot, toolRegistryPath) || path.basename(toolRegistryPath),
      chips: path.relative(projectRoot, chipRegistryPath) || path.basename(chipRegistryPath)
    },
    files: writes.map(item => ({
      path: path.relative(projectRoot, item.path) || path.basename(item.path),
      status: item.status
    })),
    notes: [
      '只生成 family/device/chip 草稿，不会伪造 bindings 参数。',
      '下一步应结合手册、例程或已验证代码补 device bindings 与 algorithm params。'
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
