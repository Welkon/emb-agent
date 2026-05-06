'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./runtime.cjs');
const toolCatalog = require('./tool-catalog.cjs');
const chipSupportStatusHelpers = require('./chip-support-status.cjs');
const permissionGateHelpers = require('./permission-gates.cjs');

const HIGH_RISK_KEYWORDS = [
  'flash',
  'erase',
  'fuse',
  'efuse',
  'otp',
  'program',
  'burn',
  'write',
  'unlock',
  'mass-erase',
  'chip-erase',
  'option-byte'
];

const HIGH_RISK_FLAGS = [
  '--apply',
  '--commit',
  '--force',
  '--flash',
  '--erase',
  '--write',
  '--program',
  '--burn',
  '--unlock',
  '--fuse',
  '--efuse',
  '--otp'
];

function ensureString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeListToken(raw) {
  return String(raw)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function parseLongOptions(tokens) {
  const options = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected token: ${token}`);
    }

    const key = token.slice(2);
    const next = tokens[index + 1];

    if (!next || next.startsWith('--')) {
      options[key] = true;
      continue;
    }

    const values = normalizeListToken(next);
    if (!values.length) {
      throw new Error(`Missing value for --${key}`);
    }

    if (options[key] === undefined) {
      options[key] = values.length === 1 ? values[0] : values;
    } else {
      const current = Array.isArray(options[key]) ? options[key] : [options[key]];
      options[key] = current.concat(values);
    }

    index += 1;
  }

  return options;
}

function containsRiskKeyword(value) {
  const text = String(value || '').toLowerCase();
  if (!text) {
    return false;
  }

  return HIGH_RISK_KEYWORDS.some(keyword => text.includes(keyword));
}

function safeParseLongOptions(tokens) {
  try {
    return parseLongOptions(tokens || []);
  } catch {
    return {};
  }
}

function collectRiskSignals(toolName, tokens, options) {
  const signals = [];
  const name = String(toolName || '').toLowerCase();

  if (containsRiskKeyword(name)) {
    signals.push(`tool:${name}`);
  }

  for (const token of tokens || []) {
    const lower = String(token || '').toLowerCase();
    if (HIGH_RISK_FLAGS.includes(lower) || containsRiskKeyword(lower)) {
      signals.push(`arg:${lower}`);
    }
  }

  Object.entries(options || {}).forEach(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    if (containsRiskKeyword(key) || values.some(item => containsRiskKeyword(item))) {
      signals.push(`opt:${key}`);
    }
  });

  return [...new Set(signals)];
}

function buildHighRiskClarity(toolName, signals) {
  return {
    enabled: true,
    category: 'irreversible-hardware-write',
    warning: 'A potentially destructive erase / flash / fuse operation was detected. Use a clear confirmation template and do not skip critical checks.',
    requires_explicit_confirmation: true,
    matched_signals: signals,
    confirmation_template: {
      action: `tool run ${toolName}`,
      target: '<fill in target chip / partition / register>',
      irreversible_impact: '<fill in irreversible impact scope>',
      prechecks: [
        'Confirm the chip model, power state, and connector status are correct',
        'Confirm backup / readback paths are available and current state has been saved',
        'Run a dry-run or read-only probe command first'
      ],
      execute_cli: '<fill in final execution command>',
      rollback_plan: '<fill in recovery plan after failure>'
    }
  };
}

function attachHighRiskClarity(result, toolName, tokens) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }

  if (result.high_risk_clarity) {
    return result;
  }

  const options = safeParseLongOptions(tokens || []);
  const signals = collectRiskSignals(toolName, tokens || [], options);
  if (signals.length === 0) {
    return result;
  }

  const next = {
    ...result,
    high_risk_clarity: buildHighRiskClarity(toolName, signals)
  };

  return {
    ...next,
    permission_gates: permissionGateHelpers.buildPermissionGates(next)
  };
}

function attachPermissionGates(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }

  return {
    ...result,
    permission_gates: permissionGateHelpers.buildPermissionGates(result)
  };
}

function stripPermissionControlTokens(tokens) {
  const input = Array.isArray(tokens) ? tokens : [];
  const filtered = [];
  let explicitConfirmation = false;

  for (const token of input) {
    if (token === '--confirm') {
      explicitConfirmation = true;
      continue;
    }
    filtered.push(token);
  }

  return {
    explicit_confirmation: explicitConfirmation,
    tokens: filtered
  };
}

function loadProjectPermissionConfig(rootDir) {
  try {
    const runtimeConfig = runtime.loadRuntimeConfig(rootDir);
    const projectConfig = runtime.loadProjectConfig(process.cwd(), runtimeConfig);
    return projectConfig && projectConfig.permissions ? projectConfig.permissions : {};
  } catch {
    return {};
  }
}

function resolveAdapterCandidates(rootDir, toolName) {
  const projectExtDir = runtime.getProjectExtDir(process.cwd());
  const names = [
    path.join(rootDir, 'chip-support', `${toolName}.cjs`),
    path.join(rootDir, 'chip-support', toolName, 'index.cjs'),
    path.join(rootDir, 'chip-support', 'routes', `${toolName}.cjs`),
    path.join(rootDir, 'extensions', 'tools', `${toolName}.cjs`),
    path.join(rootDir, 'extensions', 'tools', toolName, 'index.cjs'),
    path.join(rootDir, 'extensions', 'tools', 'routes', `${toolName}.cjs`),
    path.join(projectExtDir, 'chip-support', `${toolName}.cjs`),
    path.join(projectExtDir, 'chip-support', toolName, 'index.cjs'),
    path.join(projectExtDir, 'chip-support', 'routes', `${toolName}.cjs`),
    path.join(projectExtDir, 'extensions', 'tools', `${toolName}.cjs`),
    path.join(projectExtDir, 'extensions', 'tools', toolName, 'index.cjs'),
    path.join(projectExtDir, 'extensions', 'tools', 'routes', `${toolName}.cjs`)
  ];

  return [...new Set(names)];
}

function loadExternalAdapter(rootDir, toolName) {
  const candidates = resolveAdapterCandidates(rootDir, toolName);

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const adapter = require(filePath);
    if (!adapter || typeof adapter.runTool !== 'function') {
      throw new Error(`Tool chip support module must export runTool(): ${filePath}`);
    }

    return {
      file_path: filePath,
      adapter
    };
  }

  return null;
}

function buildAdapterRequiredResult(rootDir, toolName, tokens) {
  const spec = toolCatalog.loadToolSpec(rootDir, toolName);
  const options = parseLongOptions(tokens || []);
  const searchPaths = resolveAdapterCandidates(rootDir, toolName);
  const deriveCommand = `adapter derive --from-project --tool ${spec.name}`;

  return {
    tool: spec.name,
    status: 'chip-support-required',
    implementation: 'abstract-only',
    inputs: {
      raw_tokens: tokens || [],
      options
    },
    chip_support_search_paths: searchPaths,
    lazy_generation: {
      trigger: 'tool-use',
      status: 'available',
      command: deriveCommand,
      confirm_command: `${deriveCommand} --confirm`,
      summary: 'Chip support is not generated during init. Generate a project-local draft only if this tool is needed now.'
    },
    next_steps: [
      `Run ${deriveCommand} only if this tool is needed now, then retry tool run ${spec.name}.`
    ],
    notes: [
      'emb-agent core only provides abstract tool specs and does not include any vendor family/device/chip bindings.',
      'To run this tool for real, generate or install chip support under runtime or the project directory when the tool is actually needed.',
      'Vendor/chip-specific formulas, register boundaries, and evidence sources should live in separate extensions rather than emb core.'
    ]
  };
}

function runTool(rootDir, toolName, tokens) {
  const name = ensureString(toolName, 'tool name');
  const control = stripPermissionControlTokens(tokens);
  const tokenList = control.tokens;
  const highRiskResult = attachHighRiskClarity({}, name, tokenList);
  const highRiskClarity = highRiskResult && highRiskResult.high_risk_clarity ? highRiskResult.high_risk_clarity : null;
  const permissionDecision = permissionGateHelpers.evaluateExecutionPermission({
    action_kind: 'tool',
    action_name: name,
    risk: highRiskClarity ? 'high' : 'normal',
    explicit_confirmation: control.explicit_confirmation,
    permissions: loadProjectPermissionConfig(rootDir)
  });

  if (permissionDecision.decision !== 'allow') {
    return permissionGateHelpers.applyPermissionDecision(
      attachHighRiskClarity({
        tool: name,
        status: 'permission-pending',
        implementation: 'permission-gated',
        inputs: {
          raw_tokens: tokenList,
          options: safeParseLongOptions(tokenList)
        }
      }, name, tokenList),
      permissionDecision
    );
  }

  const loaded = loadExternalAdapter(rootDir, name);

  if (!loaded) {
    return permissionGateHelpers.applyPermissionDecision(
      attachHighRiskClarity(
        buildAdapterRequiredResult(rootDir, name, tokenList),
        name,
        tokenList
      ),
      permissionDecision
    );
  }

  const result = chipSupportStatusHelpers.normalizeToolExecutionResult(loaded.adapter.runTool({
    rootDir,
    toolName: name,
    tokens: tokenList,
    spec: toolCatalog.loadToolSpec(rootDir, name),
    adapterPath: loaded.file_path,
    parseLongOptions
  }));

  return permissionGateHelpers.applyPermissionDecision(
    attachPermissionGates(attachHighRiskClarity(result, name, tokenList)),
    permissionDecision
  );
}

module.exports = {
  buildAdapterRequiredResult,
  loadExternalAdapter,
  parseLongOptions,
  resolveAdapterCandidates,
  runTool
};
