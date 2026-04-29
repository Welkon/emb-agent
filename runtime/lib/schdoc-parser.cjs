'use strict';

const CFB_SIGNATURE = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1
]);

const CFB_SPECIAL = {
  free: 0xffffffff,
  endOfChain: 0xfffffffe,
  fat: 0xfffffffd,
  difat: 0xfffffffc
};

function asUnsigned32(value) {
  return Number(value >>> 0);
}

function decodeText(buffer) {
  return Buffer.from(buffer || []).toString('utf8').replace(/\u0000+$/g, '');
}

function readSector(fileBuffer, sectorSize, sectorIndex) {
  const offset = (sectorIndex + 1) * sectorSize;
  const end = offset + sectorSize;
  if (offset < 0 || end > fileBuffer.length) {
    throw new Error(`CFB sector ${sectorIndex} is outside file bounds`);
  }
  return fileBuffer.subarray(offset, end);
}

function readHeader(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < 512) {
    throw new Error('SchDoc file is too small to contain a valid compound file header');
  }
  if (!fileBuffer.subarray(0, 8).equals(CFB_SIGNATURE)) {
    throw new Error('SchDoc file does not look like an OLE compound file');
  }

  return {
    sectorShift: fileBuffer.readUInt16LE(30),
    miniSectorShift: fileBuffer.readUInt16LE(32),
    numDirSectors: fileBuffer.readUInt32LE(40),
    numFatSectors: fileBuffer.readUInt32LE(44),
    firstDirSector: fileBuffer.readUInt32LE(48),
    miniStreamCutoff: fileBuffer.readUInt32LE(56),
    firstMiniFatSector: fileBuffer.readUInt32LE(60),
    numMiniFatSectors: fileBuffer.readUInt32LE(64),
    firstDifatSector: fileBuffer.readUInt32LE(68),
    numDifatSectors: fileBuffer.readUInt32LE(72),
    sectorSize: 1 << fileBuffer.readUInt16LE(30),
    miniSectorSize: 1 << fileBuffer.readUInt16LE(32)
  };
}

function collectDifatSectorIds(fileBuffer, header) {
  const difat = [];

  for (let index = 0; index < 109; index += 1) {
    const sectorId = fileBuffer.readUInt32LE(76 + index * 4);
    if (sectorId !== CFB_SPECIAL.free) {
      difat.push(sectorId);
    }
  }

  let nextDifatSector = header.firstDifatSector;
  let remaining = header.numDifatSectors;
  const maxEntriesPerDifatSector = header.sectorSize / 4 - 1;

  while (remaining > 0 && nextDifatSector !== CFB_SPECIAL.endOfChain && nextDifatSector !== CFB_SPECIAL.free) {
    const sector = readSector(fileBuffer, header.sectorSize, nextDifatSector);
    for (let index = 0; index < maxEntriesPerDifatSector; index += 1) {
      const sectorId = sector.readUInt32LE(index * 4);
      if (sectorId !== CFB_SPECIAL.free) {
        difat.push(sectorId);
      }
    }
    nextDifatSector = sector.readUInt32LE(header.sectorSize - 4);
    remaining -= 1;
  }

  return difat.slice(0, header.numFatSectors);
}

function buildFat(fileBuffer, header) {
  const fatSectorIds = collectDifatSectorIds(fileBuffer, header);
  const entries = [];

  fatSectorIds.forEach(sectorId => {
    const sector = readSector(fileBuffer, header.sectorSize, sectorId);
    for (let offset = 0; offset < sector.length; offset += 4) {
      entries.push(sector.readUInt32LE(offset));
    }
  });

  return entries;
}

function readChain(fileBuffer, sectorSize, fatEntries, startSector, expectedSize) {
  if (startSector === CFB_SPECIAL.endOfChain || startSector === CFB_SPECIAL.free) {
    return Buffer.alloc(0);
  }

  const seen = new Set();
  const chunks = [];
  let currentSector = startSector;

  while (currentSector !== CFB_SPECIAL.endOfChain && currentSector !== CFB_SPECIAL.free) {
    if (seen.has(currentSector)) {
      throw new Error(`CFB sector chain loop detected at sector ${currentSector}`);
    }
    if (currentSector >= fatEntries.length) {
      throw new Error(`CFB sector ${currentSector} is outside FAT range`);
    }

    seen.add(currentSector);
    chunks.push(readSector(fileBuffer, sectorSize, currentSector));
    currentSector = fatEntries[currentSector];
  }

  const data = Buffer.concat(chunks);
  return typeof expectedSize === 'number' ? data.subarray(0, expectedSize) : data;
}

function parseDirectoryEntries(fileBuffer, header, fatEntries) {
  const directoryData = readChain(
    fileBuffer,
    header.sectorSize,
    fatEntries,
    header.firstDirSector,
    header.numDirSectors > 0 ? header.numDirSectors * header.sectorSize : undefined
  );
  const entries = [];

  for (let offset = 0; offset + 128 <= directoryData.length; offset += 128) {
    const nameLength = directoryData.readUInt16LE(offset + 64);
    if (nameLength < 2) {
      continue;
    }

    const name = decodeText(directoryData.subarray(offset, offset + nameLength - 2).toString('utf16le'));
    const type = directoryData[offset + 66];
    const startingSector = directoryData.readUInt32LE(offset + 116);
    const size = Number(directoryData.readBigUInt64LE(offset + 120));

    entries.push({
      name,
      type,
      startingSector,
      size
    });
  }

  return entries;
}

function readMiniFat(fileBuffer, header, fatEntries) {
  if (
    header.numMiniFatSectors === 0 ||
    header.firstMiniFatSector === CFB_SPECIAL.endOfChain ||
    header.firstMiniFatSector === CFB_SPECIAL.free
  ) {
    return [];
  }

  const miniFatData = readChain(
    fileBuffer,
    header.sectorSize,
    fatEntries,
    header.firstMiniFatSector,
    header.numMiniFatSectors * header.sectorSize
  );
  const miniFatEntries = [];

  for (let offset = 0; offset < miniFatData.length; offset += 4) {
    miniFatEntries.push(miniFatData.readUInt32LE(offset));
  }

  return miniFatEntries;
}

function readMiniStream(entry, rootEntry, fileBuffer, header, fatEntries, miniFatEntries) {
  const rootStream = readChain(
    fileBuffer,
    header.sectorSize,
    fatEntries,
    rootEntry.startingSector,
    rootEntry.size
  );
  const chunks = [];
  const seen = new Set();
  let currentSector = entry.startingSector;

  while (currentSector !== CFB_SPECIAL.endOfChain && currentSector !== CFB_SPECIAL.free) {
    if (seen.has(currentSector)) {
      throw new Error(`CFB mini-sector chain loop detected at sector ${currentSector}`);
    }
    if (currentSector >= miniFatEntries.length) {
      throw new Error(`CFB mini-sector ${currentSector} is outside mini FAT range`);
    }

    const start = currentSector * header.miniSectorSize;
    const end = start + header.miniSectorSize;
    chunks.push(rootStream.subarray(start, end));
    seen.add(currentSector);
    currentSector = miniFatEntries[currentSector];
  }

  return Buffer.concat(chunks).subarray(0, entry.size);
}

function readNamedStream(fileBuffer, streamName) {
  const header = readHeader(fileBuffer);
  const fatEntries = buildFat(fileBuffer, header);
  const directoryEntries = parseDirectoryEntries(fileBuffer, header, fatEntries);
  const rootEntry = directoryEntries.find(entry => entry.type === 5);
  const entry = directoryEntries.find(item => item.type === 2 && item.name === streamName);

  if (!entry) {
    throw new Error(`CFB stream not found: ${streamName}`);
  }

  if (entry.size < header.miniStreamCutoff) {
    if (!rootEntry) {
      throw new Error('CFB root entry is missing; mini stream cannot be resolved');
    }
    const miniFatEntries = readMiniFat(fileBuffer, header, fatEntries);
    return readMiniStream(entry, rootEntry, fileBuffer, header, fatEntries, miniFatEntries);
  }

  return readChain(fileBuffer, header.sectorSize, fatEntries, entry.startingSector, entry.size);
}

function splitRecordLines(streamBuffer) {
  const payload = streamBuffer.subarray(5, Math.max(5, streamBuffer.length - 1));
  const lines = [];
  let start = 0;

  for (let index = 0; index <= payload.length - 6; index += 1) {
    if (payload[index + 3] === 0x00 && payload[index + 4] === 0x00 && payload[index + 5] === 0x7c) {
      lines.push(payload.subarray(start, index));
      start = index + 6;
      index += 5;
    }
  }

  if (start < payload.length) {
    lines.push(payload.subarray(start));
  }

  return lines.filter(line => line.length > 0);
}

function splitOnByte(buffer, byteValue) {
  const result = [];
  let start = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === byteValue) {
      result.push(buffer.subarray(start, index));
      start = index + 1;
    }
  }

  result.push(buffer.subarray(start));
  return result;
}

function decodeDatum(lineBuffer) {
  const datum = {};

  splitOnByte(lineBuffer, 0x7c).forEach(pairBuffer => {
    const separatorIndex = pairBuffer.indexOf(0x3d);
    if (separatorIndex <= 0) {
      return;
    }

    const key = decodeText(pairBuffer.subarray(0, separatorIndex));
    const value = decodeText(pairBuffer.subarray(separatorIndex + 1));
    if (key) {
      datum[key] = value;
    }
  });

  return datum;
}

function parseSchDocRecords(fileBuffer) {
  const fileHeaderStream = readNamedStream(fileBuffer, 'FileHeader');
  const datums = splitRecordLines(fileHeaderStream).map(decodeDatum);
  const header = datums.filter(item => Object.prototype.hasOwnProperty.call(item, 'HEADER'));
  const records = datums.filter(item => Object.prototype.hasOwnProperty.call(item, 'RECORD'));

  records.forEach((record, index) => {
    record.index = index;
  });

  return {
    header,
    records,
    file_header_size: fileHeaderStream.length
  };
}

function getField(record, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(record || {}, name)) {
      return record[name];
    }
  }
  return '';
}

function getOwnerKey(record) {
  return String(getField(record, 'OwnerIndex', 'OWNERINDEX') || '');
}

function groupByOwner(records) {
  const grouped = new Map();

  records.forEach(record => {
    const ownerKey = getOwnerKey(record);
    if (!ownerKey) {
      return;
    }
    if (!grouped.has(ownerKey)) {
      grouped.set(ownerKey, []);
    }
    grouped.get(ownerKey).push(record);
  });

  return grouped;
}

function findNamedText(records, targetName) {
  const lowerTarget = String(targetName || '').toLowerCase();
  const record = records.find(item => {
    const recordName = String(getField(item, 'Name', 'NAME') || '').toLowerCase();
    return (item.RECORD === '41' || item.RECORD === '34') && recordName === lowerTarget;
  });

  if (!record) {
    return '';
  }

  return getField(record, '%UTF8%Text', 'Text', 'TEXT');
}

function normalizeComponentInput(partRecord, relatedRecords) {
  const designator = findNamedText(relatedRecords, 'Designator');
  if (!designator) {
    return null;
  }

  const footprint = findNamedText(relatedRecords, 'Footprint');
  const comment =
    findNamedText(relatedRecords, 'Comment') ||
    getField(partRecord, '%UTF8%ComponentDescription', 'ComponentDescription');
  const rawValue =
    findNamedText(relatedRecords, 'Value') ||
    getField(partRecord, 'DesignItemId', 'LibReference');
  const preferCommentAsValue =
    /^(sop-?\d+|soic-?\d+|qfn-?\d+|ssop-?\d+|tssop-?\d+|dip-?\d+|qfp-?\d+|r|c|d|led|testpoint)$/i.test(String(rawValue || '')) &&
    /[a-z]/i.test(String(comment || ''));
  const value = preferCommentAsValue ? comment : rawValue;
  const datasheet = findNamedText(relatedRecords, 'Datasheet');
  const pins = relatedRecords
    .filter(item => item.RECORD === '2')
    .map(pin => ({
      number: getField(pin, 'Designator', 'Number'),
      name: getField(pin, 'Name', 'PinName'),
      net: ''
    }))
    .filter(pin => pin.number || pin.name || pin.net);

  return {
    designator,
    value,
    comment,
    libref: getField(partRecord, 'LibReference'),
    description: getField(partRecord, '%UTF8%ComponentDescription', 'ComponentDescription'),
    footprint,
    package: footprint,
    datasheet,
    pins,
    raw_part_index: partRecord.index
  };
}

function pinDirection(rotation) {
  const normalized = ((rotation % 360) + 360) % 360;
  if (normalized === 0) return [1, 0];
  if (normalized === 90) return [0, 1];
  if (normalized === 180) return [-1, 0];
  if (normalized === 270) return [0, -1];
  return [0, 0];
}

function buildDevice(record, partMap) {
  if (record.RECORD === '2') {
    const rotation = (parseInt(getField(record, 'PinConglomerate', 'PINCONGLOMERATE') || '0', 10) & 0x03) * 90;
    const pinLength = parseInt(getField(record, 'PinLength', 'PINLENGTH') || '0', 10);
    const locationX = parseInt(getField(record, 'Location.X', 'LOCATION.X') || '0', 10);
    const locationY = parseInt(getField(record, 'Location.Y', 'LOCATION.Y') || '0', 10);
    const [dx, dy] = pinDirection(rotation);
    const owner = partMap.get(getOwnerKey(record));

    return {
      ...record,
      coords: [[locationX + dx * pinLength, locationY + dy * pinLength]],
      component_designator: owner ? owner.designator : '',
      pin_number: getField(record, 'Designator'),
      pin_name: getField(record, 'Name')
    };
  }

  if (record.RECORD === '27') {
    const coords = [];
    const locationCount = parseInt(getField(record, 'LocationCount') || '0', 10);
    for (let index = 1; index <= locationCount; index += 1) {
      const x = getField(record, `X${index}`);
      const y = getField(record, `Y${index}`);
      if (x !== '' && y !== '') {
        coords.push([parseInt(x, 10), parseInt(y, 10)]);
      }
    }

    return {
      ...record,
      coords
    };
  }

  if (record.RECORD === '17' || record.RECORD === '25') {
    return {
      ...record,
      coords: [[
        parseInt(getField(record, 'Location.X', 'LOCATION.X') || '0', 10),
        parseInt(getField(record, 'Location.Y', 'LOCATION.Y') || '0', 10)
      ]]
    };
  }

  return null;
}

function pointOnSegment(point, segmentStart, segmentEnd) {
  const minX = Math.min(segmentStart[0], segmentEnd[0]);
  const maxX = Math.max(segmentStart[0], segmentEnd[0]);
  const minY = Math.min(segmentStart[1], segmentEnd[1]);
  const maxY = Math.max(segmentStart[1], segmentEnd[1]);

  if (point[0] < minX || point[0] > maxX || point[1] < minY || point[1] > maxY) {
    return false;
  }

  const cross =
    (segmentEnd[0] - segmentStart[0]) * (point[1] - segmentStart[1]) -
    (segmentEnd[1] - segmentStart[1]) * (point[0] - segmentStart[0]);
  return cross === 0;
}

function toSegments(device) {
  const coords = Array.isArray(device.coords) ? device.coords : [];
  if (device.RECORD === '27') {
    const segments = [];
    for (let index = 0; index < coords.length - 1; index += 1) {
      segments.push([coords[index], coords[index + 1]]);
    }
    return segments;
  }
  if (coords.length > 0) {
    return [[coords[0], coords[0]]];
  }
  return [];
}

function devicesConnected(a, b) {
  const aSegments = toSegments(a);
  const bSegments = toSegments(b);

  for (const [start, end] of aSegments) {
    if (pointOnSegment(start, start, end) && bSegments.some(([otherStart, otherEnd]) => pointOnSegment(start, otherStart, otherEnd))) {
      return true;
    }
    if (pointOnSegment(end, start, end) && bSegments.some(([otherStart, otherEnd]) => pointOnSegment(end, otherStart, otherEnd))) {
      return true;
    }
  }

  for (const [start, end] of bSegments) {
    if (pointOnSegment(start, start, end) && aSegments.some(([otherStart, otherEnd]) => pointOnSegment(start, otherStart, otherEnd))) {
      return true;
    }
    if (pointOnSegment(end, start, end) && aSegments.some(([otherStart, otherEnd]) => pointOnSegment(end, otherStart, otherEnd))) {
      return true;
    }
  }

  if (
    a.RECORD === '17' &&
    b.RECORD === '17' &&
    getField(a, 'Text', 'TEXT') &&
    getField(a, 'Text', 'TEXT') === getField(b, 'Text', 'TEXT')
  ) {
    return true;
  }

  return false;
}

function buildNets(records, partMap) {
  const devices = records
    .filter(record => ['2', '17', '25', '27'].includes(record.RECORD))
    .map(record => buildDevice(record, partMap))
    .filter(Boolean);
  const visited = new Set();
  const nets = [];

  devices.forEach(device => {
    if (visited.has(device.index)) {
      return;
    }

    const stack = [device];
    const group = [];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || visited.has(current.index)) {
        continue;
      }

      visited.add(current.index);
      group.push(current);

      devices.forEach(candidate => {
        if (!visited.has(candidate.index) && devicesConnected(current, candidate)) {
          stack.push(candidate);
        }
      });
    }

    const namedDevice = group.find(item => item.RECORD === '17' || item.RECORD === '25');
    const name = getField(namedDevice || {}, '%UTF8%Text', 'Text', 'TEXT') || `UNNAMED_NET_${nets.length + 1}`;
    const members = runtimeLikeUnique(
      group
        .filter(item => item.RECORD === '2' && item.component_designator)
        .map(item => {
          const pinId = item.pin_number || item.pin_name || '?';
          return `${item.component_designator}.${pinId}`;
        })
    );

    nets.push({
      name,
      members
    });
  });

  return nets;
}

function runtimeLikeUnique(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function applyNetMembership(components, nets) {
  const netByMember = new Map();

  nets.forEach(net => {
    net.members.forEach(member => {
      netByMember.set(member, net.name);
    });
  });

  components.forEach(component => {
    component.pins = (component.pins || []).map(pin => {
      const key = `${component.designator}.${pin.number || pin.name || '?'}`;
      return {
        ...pin,
        net: netByMember.get(key) || pin.net || ''
      };
    });
  });

  return components;
}

function collectPointBounds(points) {
  const validPoints = (points || [])
    .filter(point => Array.isArray(point) && point.length >= 2)
    .map(point => [Number(point[0]), Number(point[1])])
    .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));

  if (validPoints.length === 0) {
    return null;
  }

  return validPoints.reduce((bounds, point) => ({
    min_x: Math.min(bounds.min_x, point[0]),
    min_y: Math.min(bounds.min_y, point[1]),
    max_x: Math.max(bounds.max_x, point[0]),
    max_y: Math.max(bounds.max_y, point[1])
  }), {
    min_x: validPoints[0][0],
    min_y: validPoints[0][1],
    max_x: validPoints[0][0],
    max_y: validPoints[0][1]
  });
}

function buildVisualSummary(records, partMap) {
  const devices = records
    .filter(record => ['2', '17', '25', '27'].includes(record.RECORD))
    .map(record => buildDevice(record, partMap))
    .filter(Boolean);
  const recordCounts = {};

  records.forEach(record => {
    const key = String(record.RECORD || 'unknown');
    recordCounts[key] = (recordCounts[key] || 0) + 1;
  });

  return {
    primitives: {
      parts: recordCounts['1'] || 0,
      pins: recordCounts['2'] || 0,
      wires: recordCounts['27'] || 0,
      net_labels: recordCounts['25'] || 0,
      power_ports: recordCounts['17'] || 0,
      junctions: recordCounts['29'] || 0,
      ports: recordCounts['18'] || 0,
      sheet_symbols: recordCounts['15'] || 0
    },
    record_counts: recordCounts,
    bounds: collectPointBounds(devices.flatMap(device => Array.isArray(device.coords) ? device.coords : []))
  };
}

function parseSchDocBuffer(fileBuffer) {
  const parsed = parseSchDocRecords(fileBuffer);
  const relatedByOwner = groupByOwner(parsed.records);
  const partRecords = parsed.records.filter(record => record.RECORD === '1');
  const components = [];
  const partMap = new Map();

  partRecords.forEach(partRecord => {
    const relatedRecords = relatedByOwner.get(String(partRecord.index)) || [];
    const normalized = normalizeComponentInput(partRecord, relatedRecords);
    if (!normalized) {
      return;
    }
    components.push(normalized);
    partMap.set(String(partRecord.index), normalized);
  });

  const nets = buildNets(parsed.records, partMap);
  applyNetMembership(components, nets);
  const visualSummary = buildVisualSummary(parsed.records, partMap);

  return {
    parser_mode: 'altium-raw-internal',
    components,
    nets,
    raw_summary: {
      records: parsed.records.length,
      components: components.length,
      nets: nets.length,
      visual: visualSummary,
      file_header_size: parsed.file_header_size
    }
  };
}

module.exports = {
  parseSchDocBuffer,
  readNamedStream
};
