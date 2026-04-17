'use strict';

const fs = require('fs');

function parseScalar(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (/^(true|false)$/i.test(text)) {
    return text.toLowerCase() === 'true';
  }

  return text.replace(/^['"]|['"]$/g, '');
}

function parseScalarByKey(content, key) {
  const line = String(content || '')
    .split(/\r?\n/)
    .find(item => item.trim().startsWith(`${key}:`));

  if (!line) {
    return '';
  }

  return parseScalar(
    line
      .split(':')
      .slice(1)
      .join(':')
      .trim()
  );
}

function parseYamlObjectLine(line, prefix) {
  if (!line.startsWith(prefix)) {
    return null;
  }

  const body = line.slice(prefix.length);
  const separator = body.indexOf(':');
  if (separator === -1) {
    return null;
  }

  return {
    key: body.slice(0, separator).trim(),
    value: parseScalar(body.slice(separator + 1).trim())
  };
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

function normalizeSignalEntry(entry) {
  const confirmed = entry && Object.prototype.hasOwnProperty.call(entry, 'confirmed')
    ? entry.confirmed
    : null;

  return {
    name: String((entry && entry.name) || '').trim(),
    pin: String((entry && entry.pin) || '').trim(),
    direction: String((entry && entry.direction) || '').trim(),
    default_state: String((entry && entry.default_state) || '').trim(),
    confirmed: typeof confirmed === 'boolean'
      ? confirmed
      : /^(true|false)$/i.test(String(confirmed || '').trim())
        ? String(confirmed).trim().toLowerCase() === 'true'
        : null,
    note: String((entry && entry.note) || '').trim()
  };
}

function normalizePeripheralEntry(entry) {
  return {
    name: String((entry && entry.name) || '').trim(),
    usage: String((entry && entry.usage) || '').trim()
  };
}

function loadHardwareTruth(runtime, projectRoot) {
  const hwPath = runtime.resolveProjectDataPath(projectRoot, 'hw.yaml');
  if (!fs.existsSync(hwPath)) {
    return {
      file: runtime.getProjectAssetRelativePath('hw.yaml'),
      vendor: '',
      model: '',
      package: '',
      signals: [],
      peripherals: []
    };
  }

  const content = runtime.readText(hwPath);

  return {
    file: runtime.getProjectAssetRelativePath('hw.yaml'),
    vendor: String(parseScalarByKey(content, 'vendor') || ''),
    model: String(parseScalarByKey(content, 'model') || ''),
    package: String(parseScalarByKey(content, 'package') || ''),
    signals: readObjectList(content, 'signals:', '  ').map(normalizeSignalEntry),
    peripherals: readObjectList(content, 'peripherals:', '  ').map(normalizePeripheralEntry)
  };
}

module.exports = {
  parseScalar,
  parseScalarByKey,
  parseYamlObjectLine,
  readObjectList,
  normalizeSignalEntry,
  normalizePeripheralEntry,
  loadHardwareTruth
};
