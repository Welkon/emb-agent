'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./runtime.cjs');
const toolCatalog = require('./tool-catalog.cjs');

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
    warning: '检测到潜在擦写/烧录/熔丝类高风险操作，请使用清晰确认模板，不要省略关键检查。',
    requires_explicit_confirmation: true,
    matched_signals: signals,
    confirmation_template: {
      action: `tool run ${toolName}`,
      target: '<填写芯片/分区/寄存器目标>',
      irreversible_impact: '<填写不可逆影响范围>',
      prechecks: [
        '确认芯片型号、供电和连接器状态正确',
        '确认备份/回读路径可用，且已保存当前状态',
        '先执行 dry-run 或只读探测命令'
      ],
      execute_cli: '<填写最终执行命令>',
      rollback_plan: '<填写失败后的恢复方案>'
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

  return {
    ...result,
    high_risk_clarity: buildHighRiskClarity(toolName, signals)
  };
}

function resolveAdapterCandidates(rootDir, toolName) {
  const projectExtDir = runtime.getProjectExtDir(process.cwd());
  const names = [
    path.join(rootDir, 'adapters', `${toolName}.cjs`),
    path.join(rootDir, 'adapters', toolName, 'index.cjs'),
    path.join(rootDir, 'adapters', 'routes', `${toolName}.cjs`),
    path.join(rootDir, 'extensions', 'tools', `${toolName}.cjs`),
    path.join(rootDir, 'extensions', 'tools', toolName, 'index.cjs'),
    path.join(rootDir, 'extensions', 'tools', 'routes', `${toolName}.cjs`),
    path.join(projectExtDir, 'adapters', `${toolName}.cjs`),
    path.join(projectExtDir, 'adapters', toolName, 'index.cjs'),
    path.join(projectExtDir, 'adapters', 'routes', `${toolName}.cjs`),
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
      throw new Error(`Tool adapter must export runTool(): ${filePath}`);
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

  return {
    tool: spec.name,
    status: 'adapter-required',
    implementation: 'abstract-only',
    inputs: {
      raw_tokens: tokens || [],
      options
    },
    adapter_search_paths: searchPaths,
    notes: [
      'emb-agent core 只提供抽象工具规格，不内置任何厂商 family/device/chip 绑定。',
      '若要实际运行该工具，请在 runtime 或项目目录下提供外部 adapter。',
      '建议把厂商/芯片相关公式、寄存器边界和证据源放到独立扩展，而不是放进 emb core。'
    ]
  };
}

function runTool(rootDir, toolName, tokens) {
  const name = ensureString(toolName, 'tool name');
  const tokenList = Array.isArray(tokens) ? tokens : [];
  const loaded = loadExternalAdapter(rootDir, name);

  if (!loaded) {
    return attachHighRiskClarity(
      buildAdapterRequiredResult(rootDir, name, tokenList),
      name,
      tokenList
    );
  }

  const result = loaded.adapter.runTool({
    rootDir,
    toolName: name,
    tokens: tokenList,
    spec: toolCatalog.loadToolSpec(rootDir, name),
    adapterPath: loaded.file_path,
    parseLongOptions
  });

  return attachHighRiskClarity(result, name, tokenList);
}

module.exports = {
  buildAdapterRequiredResult,
  loadExternalAdapter,
  parseLongOptions,
  resolveAdapterCandidates,
  runTool
};
