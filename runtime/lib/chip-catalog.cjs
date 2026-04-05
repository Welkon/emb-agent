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
