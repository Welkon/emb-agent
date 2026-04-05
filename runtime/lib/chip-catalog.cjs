'use strict';

const path = require('path');
const runtime = require('./runtime.cjs');

function ensureObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function ensureString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function ensureStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => ensureString(item, `${label}[${index}]`));
}

function ensureOptionalStringArray(value, label) {
  if (value === undefined || value === null) {
    return [];
  }
  return ensureStringArray(value, label);
}

function ensureOptionalString(value, label) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  return ensureString(value, label);
}

function ensureOptionalPositiveInteger(value, label) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return number;
}

function ensureOptionalNonNegativeInteger(value, label) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return number;
}

function ensureOptionalBoolean(value, label, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function chipsRoot(rootDir) {
  return path.join(rootDir, 'chips');
}

function ensureUniqueStrings(values) {
  return [...new Set(values)];
}

function extensionChipsRoots(rootDir) {
  return ensureUniqueStrings([
    path.join(rootDir, 'extensions', 'chips'),
    path.join(process.cwd(), 'emb-agent', 'extensions', 'chips')
  ]);
}

function runtimePathExists(filePath) {
  try {
    runtime.requireFile(filePath, 'Path');
    return true;
  } catch {
    return false;
  }
}

function loadRegistry(rootDir) {
  const filePath = path.join(chipsRoot(rootDir), 'registry.json');
  const raw = runtime.readJson(filePath);
  ensureObject(raw, 'Chip registry');

  const devices = ensureStringArray(raw.devices || [], 'registry.devices');

  for (const extRoot of extensionChipsRoots(rootDir)) {
    const registryPath = path.join(extRoot, 'registry.json');
    if (!runtimePathExists(registryPath)) {
      continue;
    }

    const ext = runtime.readJson(registryPath);
    ensureObject(ext, `External chip registry ${registryPath}`);
    devices.push(...ensureStringArray(ext.devices || [], `External chip registry ${registryPath}.devices`));
  }

  return {
    devices: ensureUniqueStrings(devices)
  };
}

function validateSummary(name, value) {
  ensureObject(value, `chip ${name} summary`);
  const summary = {};
  Object.keys(value).forEach(key => {
    summary[key] = ensureString(value[key], `chip ${name} summary.${key}`);
  });
  return summary;
}

function validateDocEntry(name, value, index) {
  ensureObject(value, `chip ${name} docs[${index}]`);
  return {
    id: ensureString(value.id, `chip ${name} docs[${index}].id`),
    kind: ensureString(value.kind, `chip ${name} docs[${index}].kind`),
    title: ensureString(value.title, `chip ${name} docs[${index}].title`),
    lookup_keys: ensureOptionalStringArray(value.lookup_keys, `chip ${name} docs[${index}].lookup_keys`),
    notes: ensureOptionalStringArray(value.notes, `chip ${name} docs[${index}].notes`)
  };
}

function validatePackagePin(name, packageName, value, index) {
  ensureObject(value, `chip ${name} packages.${packageName}.pins[${index}]`);
  return {
    number: ensureOptionalPositiveInteger(
      value.number,
      `chip ${name} packages.${packageName}.pins[${index}].number`
    ),
    signal: ensureString(value.signal, `chip ${name} packages.${packageName}.pins[${index}].signal`),
    label: ensureOptionalString(value.label, `chip ${name} packages.${packageName}.pins[${index}].label`),
    default_function: ensureOptionalString(
      value.default_function,
      `chip ${name} packages.${packageName}.pins[${index}].default_function`
    ),
    mux: ensureOptionalStringArray(
      value.mux,
      `chip ${name} packages.${packageName}.pins[${index}].mux`
    ),
    notes: ensureOptionalStringArray(
      value.notes,
      `chip ${name} packages.${packageName}.pins[${index}].notes`
    )
  };
}

function validatePackageEntry(name, value, index) {
  ensureObject(value, `chip ${name} packages[${index}]`);
  const packageName = ensureString(value.name, `chip ${name} packages[${index}].name`);
  const pins = Array.isArray(value.pins)
    ? value.pins.map((item, pinIndex) => validatePackagePin(name, packageName, item, pinIndex))
    : [];

  return {
    name: packageName,
    pin_count: ensureOptionalPositiveInteger(value.pin_count, `chip ${name} packages[${index}].pin_count`),
    pins,
    notes: ensureOptionalStringArray(value.notes, `chip ${name} packages[${index}].notes`)
  };
}

function validatePinEntry(name, key, value) {
  ensureObject(value, `chip ${name} pins.${key}`);
  const packageLocations = value.package_locations || {};
  ensureObject(packageLocations, `chip ${name} pins.${key}.package_locations`);

  const normalizedLocations = {};
  Object.entries(packageLocations).forEach(([packageName, pinNumber]) => {
    normalizedLocations[ensureString(packageName, `chip ${name} pins.${key}.package_locations key`)] =
      ensureOptionalPositiveInteger(
        pinNumber,
        `chip ${name} pins.${key}.package_locations.${packageName}`
      );
  });

  return {
    name: ensureString(value.name || key, `chip ${name} pins.${key}.name`),
    port: ensureOptionalString(value.port, `chip ${name} pins.${key}.port`),
    bit: ensureOptionalNonNegativeInteger(value.bit, `chip ${name} pins.${key}.bit`),
    functions: ensureOptionalStringArray(value.functions, `chip ${name} pins.${key}.functions`),
    interrupts: ensureOptionalStringArray(value.interrupts, `chip ${name} pins.${key}.interrupts`),
    package_locations: normalizedLocations,
    notes: ensureOptionalStringArray(value.notes, `chip ${name} pins.${key}.notes`)
  };
}

function validatePins(name, value) {
  if (value === undefined || value === null) {
    return {};
  }

  ensureObject(value, `chip ${name} pins`);
  const normalized = {};

  Object.entries(value).forEach(([key, pin]) => {
    normalized[ensureString(key, `chip ${name} pins key`)] = validatePinEntry(name, key, pin);
  });

  return normalized;
}

function validateChip(name, value) {
  ensureObject(value, `Chip ${name}`);
  return {
    name: ensureString(value.name || name, `chip ${name} name`),
    vendor: ensureString(value.vendor, `chip ${name} vendor`),
    family: ensureString(value.family, `chip ${name} family`),
    sample: ensureOptionalBoolean(value.sample, `chip ${name} sample`, false),
    series: ensureOptionalString(value.series, `chip ${name} series`),
    package: ensureOptionalString(value.package, `chip ${name} package`),
    architecture: ensureOptionalString(value.architecture, `chip ${name} architecture`),
    runtime_model: ensureOptionalString(value.runtime_model, `chip ${name} runtime_model`),
    description: ensureString(value.description, `chip ${name} description`),
    summary: value.summary ? validateSummary(name, value.summary) : {},
    capabilities: ensureOptionalStringArray(value.capabilities, `chip ${name} capabilities`),
    packages: Array.isArray(value.packages)
      ? value.packages.map((item, index) => validatePackageEntry(name, item, index))
      : [],
    pins: validatePins(name, value.pins),
    docs: Array.isArray(value.docs) ? value.docs.map((item, index) => validateDocEntry(name, item, index)) : [],
    related_tools: ensureOptionalStringArray(value.related_tools, `chip ${name} related_tools`),
    source_modules: ensureOptionalStringArray(value.source_modules, `chip ${name} source_modules`),
    notes: ensureOptionalStringArray(value.notes, `chip ${name} notes`)
  };
}

function loadChip(rootDir, name) {
  const candidates = [path.join(chipsRoot(rootDir), 'devices', `${name}.json`)];

  for (const extRoot of extensionChipsRoots(rootDir)) {
    candidates.push(path.join(extRoot, 'devices', `${name}.json`));
  }

  for (const filePath of ensureUniqueStrings(candidates)) {
    if (!runtimePathExists(filePath)) {
      continue;
    }
    return validateChip(name, runtime.readJson(filePath));
  }

  throw new Error(`Chip profile not found: ${name}`);
}

function listChips(rootDir) {
  return loadRegistry(rootDir).devices.map(name => {
    const chip = loadChip(rootDir, name);
    return {
      name: chip.name,
      vendor: chip.vendor,
      family: chip.family,
      sample: chip.sample,
      package: chip.package,
      description: chip.description
    };
  });
}

module.exports = {
  chipsRoot,
  extensionChipsRoots,
  listChips,
  loadChip,
  loadRegistry,
  validateChip
};
