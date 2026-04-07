'use strict';

const fs = require('fs');
const path = require('path');
const runtime = require('./runtime.cjs');
const toolCatalog = require('./tool-catalog.cjs');

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
  const loaded = loadExternalAdapter(rootDir, name);

  if (!loaded) {
    return buildAdapterRequiredResult(rootDir, name, tokens || []);
  }

  return loaded.adapter.runTool({
    rootDir,
    toolName: name,
    tokens: tokens || [],
    spec: toolCatalog.loadToolSpec(rootDir, name),
    adapterPath: loaded.file_path,
    parseLongOptions
  });
}

module.exports = {
  buildAdapterRequiredResult,
  loadExternalAdapter,
  parseLongOptions,
  resolveAdapterCandidates,
  runTool
};
