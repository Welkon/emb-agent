'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS = 15000;

const DEFAULT_HOSTS = {
  codex: {
    name: 'codex',
    label: 'Codex',
    defaultHomeDirName: '.codex',
    configFileName: 'config.toml'
  },
  claude: {
    name: 'claude',
    label: 'Claude Code',
    defaultHomeDirName: '.claude',
    configFileName: 'settings.json'
  },
  cursor: {
    name: 'cursor',
    label: 'Cursor',
    defaultHomeDirName: '.cursor',
    configFileName: 'settings.json'
  }
};

function splitCommandWords(command) {
  const input = String(command || '').trim();
  if (!input) {
    return [];
  }

  const parts = [];
  let current = '';
  let quote = '';
  let escape = false;

  for (const char of input) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function resolveSubagentBridge(metadata) {
  const envCommand = String(process.env.EMB_AGENT_SUBAGENT_BRIDGE_CMD || '').trim();
  const metadataBridge =
    metadata && metadata.subagent_bridge && typeof metadata.subagent_bridge === 'object' && !Array.isArray(metadata.subagent_bridge)
      ? metadata.subagent_bridge
      : {};
  const command = envCommand || String(metadataBridge.command || '').trim();
  const timeoutSource = envCommand
    ? process.env.EMB_AGENT_SUBAGENT_BRIDGE_TIMEOUT_MS
    : metadataBridge.timeout_ms;
  const timeoutMs = Number(timeoutSource || DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS);

  const mode = !command
    ? 'disabled'
    : command.startsWith('mock://')
      ? 'mock'
      : 'stdio-json';

  return {
    available: Boolean(command),
    mode,
    command,
    command_argv: mode === 'stdio-json' ? splitCommandWords(command) : [],
    timeout_ms: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS,
    source: envCommand ? 'env' : (command ? 'host-metadata' : 'none')
  };
}

function normalizeHostName(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return DEFAULT_HOSTS[normalized] ? normalized : 'codex';
}

function getHostDefaults(name) {
  return DEFAULT_HOSTS[normalizeHostName(name)];
}

function getHostMetadataPath(runtimeRoot) {
  return path.join(runtimeRoot, 'HOST.json');
}

function isSourceRuntimeLayout(runtimeRoot) {
  return path.basename(runtimeRoot) === 'runtime' && fs.existsSync(path.resolve(runtimeRoot, '..', 'package.json'));
}

function readHostMetadata(runtimeRoot) {
  const metadataPath = getHostMetadataPath(runtimeRoot);
  if (!fs.existsSync(metadataPath)) {
    return null;
  }

  try {
    const value = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function inferHostName(runtimeRoot, metadata) {
  if (metadata && metadata.name) {
    return normalizeHostName(metadata.name);
  }

  const homeDirName = path.basename(path.resolve(runtimeRoot, '..'));
  if (homeDirName === '.claude') {
    return 'claude';
  }
  if (homeDirName === '.cursor') {
    return 'cursor';
  }
  if (homeDirName === '.codex') {
    return 'codex';
  }

  return 'codex';
}

function shortenHomePath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  const home = os.homedir().replace(/\\/g, '/');

  if (normalized === home) {
    return '~';
  }
  if (normalized.startsWith(`${home}/`)) {
    return `~${normalized.slice(home.length)}`;
  }

  return normalized;
}

function quoteShellPath(filePath) {
  if (!/[\s"]/u.test(filePath)) {
    return filePath;
  }

  return JSON.stringify(filePath);
}

function getSourceCliDisplayPath(name) {
  const host = getHostDefaults(name);
  return `~/${host.defaultHomeDirName}/emb-agent/bin/emb-agent.cjs`;
}

function resolveRuntimeHost(runtimeRoot) {
  const resolvedRoot = path.resolve(runtimeRoot);
  const sourceLayout = isSourceRuntimeLayout(resolvedRoot);
  const metadata = readHostMetadata(resolvedRoot) || {};
  const name = inferHostName(resolvedRoot, metadata);
  const defaults = getHostDefaults(name);
  const runtimeHome = path.resolve(resolvedRoot, '..');
  const cliPath = path.join(resolvedRoot, 'bin', 'emb-agent.cjs');
  const cliDisplayPath = sourceLayout ? getSourceCliDisplayPath(name) : shortenHomePath(cliPath);

  return {
    ...metadata,
    name,
    label: metadata.label || defaults.label,
    configFileName: metadata.config_file_name || defaults.configFileName,
    runtimeRoot: resolvedRoot,
    runtimeHome,
    stateRoot: sourceLayout
      ? path.join(runtimeHome, '.tmp', 'state', 'emb-agent')
      : path.join(runtimeHome, 'state', 'emb-agent'),
    cliPath,
    cliDisplayPath,
    cliCommand: `node ${quoteShellPath(cliDisplayPath)}`,
    hostMetadataPath: getHostMetadataPath(resolvedRoot),
    sourceLayout,
    subagentBridge: resolveSubagentBridge(metadata)
  };
}

function resolveRuntimeHostFromModuleDir(moduleDir) {
  return resolveRuntimeHost(path.resolve(moduleDir, '..'));
}

function buildCliCommand(runtimeHost, args) {
  const parts = Array.isArray(args)
    ? args.filter(item => item !== undefined && item !== null && String(item).trim() !== '').map(String)
    : [];

  return parts.length > 0
    ? `${runtimeHost.cliCommand} ${parts.join(' ')}`
    : runtimeHost.cliCommand;
}

function createInstallHostMetadata(targetDir, target, args) {
  const metadata = {
    name: target.name,
    label: target.label,
    config_file_name: target.configFileName || '',
    install_scope: args && args.local ? 'local' : 'global',
    install_profile: String((args && args.profile) || 'core').trim() || 'core',
    target_dir: path.resolve(targetDir).replace(/\\/g, '/'),
    runtime_dir_name: target.runtimeDirName || 'emb-agent'
  };

  const subagentBridgeCommand = String((args && args.subagentBridgeCmd) || '').trim();
  const subagentBridgeTimeoutMs = Number(args && args.subagentBridgeTimeoutMs);

  if (subagentBridgeCommand) {
    metadata.subagent_bridge = {
      command: subagentBridgeCommand,
      timeout_ms: Number.isInteger(subagentBridgeTimeoutMs) && subagentBridgeTimeoutMs > 0
        ? subagentBridgeTimeoutMs
        : DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS
    };
  }

  return metadata;
}

module.exports = {
  DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS,
  buildCliCommand,
  createInstallHostMetadata,
  getHostMetadataPath,
  getHostDefaults,
  isSourceRuntimeLayout,
  readHostMetadata,
  resolveSubagentBridge,
  resolveRuntimeHost,
  resolveRuntimeHostFromModuleDir,
  splitCommandWords,
  shortenHomePath
};
