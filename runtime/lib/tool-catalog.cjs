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

function ensureOptionalBoolean(value, label, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function ensureOptionalNamedObjectMap(value, label) {
  if (value === undefined || value === null) {
    return {};
  }

  ensureObject(value, label);
  const normalized = {};

  Object.entries(value).forEach(([key, entry]) => {
    const name = ensureString(key, `${label} key`);
    ensureObject(entry, `${label}.${name}`);
    normalized[name] = entry;
  });

  return normalized;
}

function ensureOptionalIntentProfile(value, label) {
  if (value === undefined || value === null) {
    return {
      domains: [],
      actions: [],
      targets: [],
      keywords: [],
      anti_keywords: [],
      preference_signals: [],
      anchor_preferences: []
    };
  }

  ensureObject(value, label);
  return {
    domains: ensureOptionalStringArray(value.domains, `${label}.domains`),
    actions: ensureOptionalStringArray(value.actions, `${label}.actions`),
    targets: ensureOptionalStringArray(value.targets, `${label}.targets`),
    keywords: ensureOptionalStringArray(value.keywords, `${label}.keywords`),
    anti_keywords: ensureOptionalStringArray(value.anti_keywords, `${label}.anti_keywords`),
    preference_signals: ensureOptionalStringArray(value.preference_signals, `${label}.preference_signals`),
    anchor_preferences: ensureOptionalStringArray(value.anchor_preferences, `${label}.anchor_preferences`)
  };
}

function toolsRoot(rootDir) {
  return path.join(rootDir, 'tools');
}

function ensureUniqueStrings(values) {
  return [...new Set(values)];
}

function extensionToolsRoots(rootDir) {
  return ensureUniqueStrings([
    path.join(rootDir, 'extensions', 'tools'),
    path.join(runtime.getProjectExtDir(process.cwd()), 'extensions', 'tools')
  ]);
}

function readRegistryFile(filePath, label) {
  const raw = runtime.readJson(filePath);
  ensureObject(raw, label);

  return {
    specs: ensureStringArray(raw.specs || [], `${label}.specs`),
    families: ensureStringArray(raw.families || [], `${label}.families`),
    devices: ensureStringArray(raw.devices || [], `${label}.devices`)
  };
}

function loadRegistry(rootDir) {
  const builtIn = readRegistryFile(path.join(toolsRoot(rootDir), 'registry.json'), 'Tool registry');
  const merged = {
    specs: builtIn.specs.slice(),
    families: builtIn.families.slice(),
    devices: builtIn.devices.slice()
  };

  for (const extRoot of extensionToolsRoots(rootDir)) {
    const registryPath = path.join(extRoot, 'registry.json');
    if (!path.isAbsolute(registryPath) || !runtimePathExists(registryPath)) {
      continue;
    }

    const ext = readRegistryFile(registryPath, `External tool registry ${registryPath}`);
    merged.specs.push(...ext.specs);
    merged.families.push(...ext.families);
    merged.devices.push(...ext.devices);
  }

  return {
    specs: ensureUniqueStrings(merged.specs),
    families: ensureUniqueStrings(merged.families),
    devices: ensureUniqueStrings(merged.devices)
  };
}

function runtimePathExists(filePath) {
  try {
    runtime.requireFile(filePath, 'Path');
    return true;
  } catch {
    return false;
  }
}

function validateToolSpec(name, value) {
  ensureObject(value, `Tool spec ${name}`);
  return {
    name: ensureString(value.name || name, `tool ${name} name`),
    kind: ensureString(value.kind, `tool ${name} kind`),
    status: ensureString(value.status, `tool ${name} status`),
    sample: ensureOptionalBoolean(value.sample, `tool ${name} sample`, false),
    description: ensureString(value.description, `tool ${name} description`),
    inputs: ensureOptionalStringArray(value.inputs, `tool ${name} inputs`),
    outputs: ensureOptionalStringArray(value.outputs, `tool ${name} outputs`),
    family_profiles: ensureOptionalStringArray(value.family_profiles, `tool ${name} family_profiles`),
    device_profiles: ensureOptionalStringArray(value.device_profiles, `tool ${name} device_profiles`),
    source_modules: ensureOptionalStringArray(value.source_modules, `tool ${name} source_modules`),
    notes: ensureOptionalStringArray(value.notes, `tool ${name} notes`),
    intent_profile: ensureOptionalIntentProfile(value.intent_profile, `tool ${name} intent_profile`)
  };
}

function validateFamily(name, value) {
  ensureObject(value, `Tool family ${name}`);
  return {
    name: ensureString(value.name || name, `family ${name} name`),
    vendor: ensureString(value.vendor, `family ${name} vendor`),
    series: ensureString(value.series, `family ${name} series`),
    sample: ensureOptionalBoolean(value.sample, `family ${name} sample`, false),
    description: ensureString(value.description, `family ${name} description`),
    supported_tools: ensureOptionalStringArray(value.supported_tools, `family ${name} supported_tools`),
    source_refs: ensureOptionalStringArray(value.source_refs, `family ${name} source_refs`),
    component_refs: ensureOptionalStringArray(value.component_refs, `family ${name} component_refs`),
    clock_sources: ensureOptionalStringArray(value.clock_sources, `family ${name} clock_sources`),
    bindings: ensureOptionalNamedObjectMap(value.bindings, `family ${name} bindings`),
    notes: ensureOptionalStringArray(value.notes, `family ${name} notes`)
  };
}

function validateDevice(name, value) {
  ensureObject(value, `Tool device ${name}`);
  return {
    name: ensureString(value.name || name, `device ${name} name`),
    family: ensureString(value.family, `device ${name} family`),
    sample: ensureOptionalBoolean(value.sample, `device ${name} sample`, false),
    description: ensureString(value.description, `device ${name} description`),
    supported_tools: ensureOptionalStringArray(value.supported_tools, `device ${name} supported_tools`),
    source_refs: ensureOptionalStringArray(value.source_refs, `device ${name} source_refs`),
    component_refs: ensureOptionalStringArray(value.component_refs, `device ${name} component_refs`),
    bindings: ensureOptionalNamedObjectMap(value.bindings, `device ${name} bindings`),
    notes: ensureOptionalStringArray(value.notes, `device ${name} notes`)
  };
}

function resolveJsonCandidates(rootDir, dirName, name) {
  const candidates = [path.join(toolsRoot(rootDir), dirName, `${name}.json`)];

  for (const extRoot of extensionToolsRoots(rootDir)) {
    candidates.push(path.join(extRoot, dirName, `${name}.json`));
  }

  return ensureUniqueStrings(candidates);
}

function loadJsonByName(rootDir, dirName, name, validator, kind) {
  const candidates = resolveJsonCandidates(rootDir, dirName, name);

  for (const filePath of candidates) {
    if (!runtimePathExists(filePath)) {
      continue;
    }
    return validator(name, runtime.readJson(filePath));
  }

  throw new Error(`${kind} not found: ${name}`);
}

function loadToolSpec(rootDir, name) {
  return loadJsonByName(rootDir, 'specs', name, validateToolSpec, 'Tool spec');
}

function loadFamily(rootDir, name) {
  return loadJsonByName(rootDir, 'families', name, validateFamily, 'Tool family');
}

function loadDevice(rootDir, name) {
  return loadJsonByName(rootDir, 'devices', name, validateDevice, 'Tool device');
}

function listToolSpecs(rootDir) {
  return loadRegistry(rootDir).specs.map(name => {
    const spec = loadToolSpec(rootDir, name);
    return {
      name: spec.name,
      kind: spec.kind,
      status: spec.status,
      sample: spec.sample,
      description: spec.description
    };
  });
}

function listFamilies(rootDir) {
  return loadRegistry(rootDir).families.map(name => {
    const family = loadFamily(rootDir, name);
    return {
      name: family.name,
      vendor: family.vendor,
      series: family.series,
      sample: family.sample,
      description: family.description
    };
  });
}

function listDevices(rootDir) {
  return loadRegistry(rootDir).devices.map(name => {
    const device = loadDevice(rootDir, name);
    return {
      name: device.name,
      family: device.family,
      sample: device.sample,
      description: device.description
    };
  });
}

module.exports = {
  listDevices,
  listFamilies,
  listToolSpecs,
  loadDevice,
  loadFamily,
  loadRegistry,
  loadToolSpec,
  toolsRoot,
  extensionToolsRoots,
  validateDevice,
  validateFamily,
  validateToolSpec
};
