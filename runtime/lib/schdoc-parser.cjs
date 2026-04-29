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

function truthyFlag(value) {
  return value === true || value === 'T' || value === 't' || value === '1';
}

function parseNumberField(record, fallback, ...names) {
  const raw = getField(record, ...names);
  if (raw === '') {
    return fallback || 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : (fallback || 0);
}

function parseCoord(record, key) {
  const intPart = parseNumberField(record, 0, key, key.toUpperCase());
  const fracPart = parseNumberField(record, 0, `${key}_Frac`, `${key.toUpperCase()}_FRAC`);
  return fracPart ? intPart + fracPart / 1000000 : intPart;
}

function readPoint(record, prefix) {
  return {
    x: parseCoord(record, `${prefix}.X`),
    y: parseCoord(record, `${prefix}.Y`)
  };
}

function readLocation(record) {
  return readPoint(record, 'Location');
}

function readCorner(record) {
  return readPoint(record, 'Corner');
}

function parsePointList(record) {
  const points = [];
  const locationCount = parseNumberField(record, 0, 'LocationCount', 'LOCATIONCOUNT');
  for (let index = 1; index <= locationCount; index += 1) {
    const hasX = getField(record, `X${index}`) !== '';
    const hasY = getField(record, `Y${index}`) !== '';
    if (hasX && hasY) {
      points.push({
        x: parseCoord(record, `X${index}`),
        y: parseCoord(record, `Y${index}`)
      });
    }
  }
  return points;
}

function visibleText(record) {
  return getField(record, '%UTF8%Text', 'Text', 'TEXT');
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
  const parameters = {};
  relatedRecords
    .filter(item => item.RECORD === '41' || item.RECORD === '34')
    .forEach(item => {
      const name = getField(item, 'Name', 'NAME');
      const text = getField(item, '%UTF8%Text', 'Text', 'TEXT');
      if (name && text && !['Designator', 'Comment', 'Value', 'Footprint', 'Datasheet'].includes(name)) {
        parameters[name] = text;
      }
    });
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
    parameters,
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

  if (['17', '18', '25', '29'].includes(record.RECORD)) {
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

function deviceKind(device) {
  if (device.RECORD === '2') return 'pin';
  if (device.RECORD === '17') return 'power_port';
  if (device.RECORD === '18') return 'port';
  if (device.RECORD === '25') return 'net_label';
  if (device.RECORD === '27') return 'wire';
  if (device.RECORD === '29') return 'junction';
  return 'unknown';
}

function getDeviceNetText(device) {
  return getField(device || {}, '%UTF8%Text', 'Text', 'TEXT');
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

  const aText = getDeviceNetText(a);
  const bText = getDeviceNetText(b);
  if (aText && bText && aText === bText && ['17', '18', '25'].includes(a.RECORD) && ['17', '18', '25'].includes(b.RECORD)) {
    return true;
  }

  return false;
}

function buildNets(records, partMap) {
  const devices = records
    .filter(record => ['2', '17', '18', '25', '27', '29'].includes(record.RECORD))
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

    const namedDevice = group.find(item => ['17', '18', '25'].includes(item.RECORD));
    const name = getDeviceNetText(namedDevice) || `UNNAMED_NET_${nets.length + 1}`;
    const members = runtimeLikeUnique(
      group
        .filter(item => item.RECORD === '2' && item.component_designator)
        .map(item => {
          const pinId = item.pin_number || item.pin_name || '?';
          return `${item.component_designator}.${pinId}`;
        })
    );
    const evidence = group.map(item => ({
      kind: deviceKind(item),
      record_index: item.index,
      text: getDeviceNetText(item),
      component: item.component_designator || '',
      pin: item.pin_number || item.pin_name || '',
      coords: item.coords || []
    }));

    nets.push({
      name,
      members,
      evidence,
      confidence: name.startsWith('UNNAMED_NET_') ? 'heuristic-unnamed' : 'heuristic-named'
    });
  });

  return nets;
}

function buildTypedObjects(records, partMap) {
  return records
    .map(record => {
      if (record.RECORD === '1') {
        const component = partMap.get(String(record.index));
        return component ? {
          kind: 'component',
          record_index: record.index,
          designator: component.designator || '',
          value: component.value || '',
          comment: component.comment || '',
          libref: component.libref || '',
          footprint: component.footprint || '',
          datasheet: component.datasheet || '',
          parameters: component.parameters || {}
        } : null;
      }
      if (record.RECORD === '2') {
        const pin = buildDevice(record, partMap);
        return pin ? {
          kind: 'pin',
          record_index: record.index,
          owner: pin.component_designator || '',
          number: pin.pin_number || '',
          name: pin.pin_name || '',
          coords: pin.coords || []
        } : null;
      }
      if (record.RECORD === '27') {
        const wire = buildDevice(record, partMap);
        return wire ? {
          kind: 'wire',
          record_index: record.index,
          points: wire.coords || []
        } : null;
      }
      if (['17', '18', '25', '29'].includes(record.RECORD)) {
        const device = buildDevice(record, partMap);
        return device ? {
          kind: deviceKind(device),
          record_index: record.index,
          text: getDeviceNetText(device),
          coords: device.coords || []
        } : null;
      }
      return null;
    })
    .filter(Boolean);
}

function buildBom(components) {
  const groups = new Map();
  (components || []).forEach(component => {
    const key = [
      component.value || component.comment || component.libref || '',
      component.footprint || component.package || '',
      component.datasheet || ''
    ].join('|');
    const current = groups.get(key) || {
      designators: [],
      quantity: 0,
      value: component.value || '',
      comment: component.comment || '',
      libref: component.libref || '',
      footprint: component.footprint || component.package || '',
      datasheet: component.datasheet || '',
      parameters: component.parameters || {}
    };
    current.designators.push(component.designator);
    current.quantity += 1;
    groups.set(key, current);
  });
  return Array.from(groups.values())
    .map(item => ({
      ...item,
      designators: item.designators.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    }))
    .sort((a, b) => String(a.designators[0] || '').localeCompare(String(b.designators[0] || ''), undefined, { numeric: true }));
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

function previewPinBodyPoint(pin) {
  if (Number.isFinite(Number(pin.body_x)) && Number.isFinite(Number(pin.body_y))) {
    return { x: Number(pin.body_x), y: Number(pin.body_y) };
  }
  const length = Math.max(Number(pin.pinLength || 0), 10);
  const orientation = ((Number(pin.orientation || 0) % 4) + 4) % 4;
  if (orientation === 0) return { x: pin.x - length, y: pin.y };
  if (orientation === 1) return { x: pin.x, y: pin.y - length };
  if (orientation === 2) return { x: pin.x + length, y: pin.y };
  if (orientation === 3) return { x: pin.x, y: pin.y + length };
  return { x: pin.x, y: pin.y };
}

function previewPinDelta(orientation, pinLength) {
  const length = Math.max(Number(pinLength || 0), 10);
  const normalized = ((Number(orientation || 0) % 4) + 4) % 4;
  if (normalized === 0) return { dx: length, dy: 0 };
  if (normalized === 1) return { dx: 0, dy: length };
  if (normalized === 2) return { dx: -length, dy: 0 };
  if (normalized === 3) return { dx: 0, dy: -length };
  return { dx: 0, dy: 0 };
}

function previewPinCandidates(record, partMap) {
  const owner = partMap.get(getOwnerKey(record));
  const location = readLocation(record);
  const orientation = parseNumberField(record, 0, 'PinConglomerate', 'PINCONGLOMERATE') & 0x03;
  const pinLength = parseNumberField(record, 0, 'PinLength', 'PINLENGTH');
  const delta = previewPinDelta(orientation, pinLength);
  const bodyLocation = {
    x: location.x,
    y: location.y
  };
  const bodyBasedEndpoint = {
    x: location.x + delta.dx,
    y: location.y + delta.dy
  };
  const hotspotBasedBody = {
    x: location.x - delta.dx,
    y: location.y - delta.dy
  };

  return {
    base: {
      record_index: record.index,
      orientation,
      pinLength,
      designator: owner ? owner.designator : '',
      pin: getField(record, 'Designator'),
      pinName: getField(record, 'Name')
    },
    candidates: [
      {
        x: bodyBasedEndpoint.x,
        y: bodyBasedEndpoint.y,
        body_x: bodyLocation.x,
        body_y: bodyLocation.y,
        source: 'body-location'
      },
      {
        x: location.x,
        y: location.y,
        body_x: hotspotBasedBody.x,
        body_y: hotspotBasedBody.y,
        source: 'hotspot-location'
      }
    ]
  };
}

function previewPointDistanceToSegment(point, a, b) {
  const px = Number(point.x);
  const py = Number(point.y);
  const ax = Number(a.x);
  const ay = Number(a.y);
  const bx = Number(b.x);
  const by = Number(b.y);
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function previewPinConnectionScore(point, segments, connectionPoints) {
  let best = Number.POSITIVE_INFINITY;
  segments.forEach(segment => {
    best = Math.min(best, previewPointDistanceToSegment(point, segment.a, segment.b));
  });
  connectionPoints.forEach(candidate => {
    best = Math.min(best, Math.hypot(Number(point.x) - Number(candidate.x), Number(point.y) - Number(candidate.y)));
  });
  return best;
}

function reconcilePreviewPins(pinDrafts, wires, busses, junctions, powerPorts, netLabels) {
  const segments = [...(wires || []), ...(busses || [])];
  const connectionPoints = [
    ...(junctions || []),
    ...(powerPorts || []),
    ...(netLabels || [])
  ];

  return pinDrafts.map(draft => {
    const ranked = draft.candidates
      .map((candidate, index) => ({
        ...candidate,
        index,
        score: previewPinConnectionScore(candidate, segments, connectionPoints)
      }))
      .sort((a, b) => (a.score - b.score) || (a.index - b.index));
    const selected = ranked[0] || draft.candidates[0];
    return {
      ...draft.base,
      x: selected.x,
      y: selected.y,
      body_x: selected.body_x,
      body_y: selected.body_y,
      endpoint_source: selected.source,
      endpoint_score: Number.isFinite(selected.score) ? Number(selected.score.toFixed(6)) : null
    };
  });
}

function buildPreviewPrimitive(record) {
  if (record.RECORD === '13') {
    return { kind: 'line', a: readLocation(record), b: readCorner(record), record_index: record.index };
  }
  if (record.RECORD === '6') {
    const points = parsePointList(record);
    return points.length >= 2 ? { kind: 'polyline', points, record_index: record.index } : null;
  }
  if (record.RECORD === '14') {
    return { kind: 'rectangle', a: readLocation(record), b: readCorner(record), record_index: record.index };
  }
  if (record.RECORD === '10') {
    return {
      kind: 'roundRect',
      a: readLocation(record),
      b: readCorner(record),
      rx: parseCoord(record, 'CornerXRadius'),
      ry: parseCoord(record, 'CornerYRadius'),
      record_index: record.index
    };
  }
  if (record.RECORD === '12' || record.RECORD === '11') {
    return {
      kind: 'arc',
      center: readLocation(record),
      radius: parseCoord(record, 'Radius'),
      startAngle: parseNumberField(record, 0, 'StartAngle', 'STARTANGLE'),
      endAngle: parseNumberField(record, 360, 'EndAngle', 'ENDANGLE'),
      record_index: record.index
    };
  }
  if (record.RECORD === '8') {
    const radius = parseCoord(record, 'Radius');
    const secondaryRadius = getField(record, 'SecondaryRadius', 'SECONDARYRADIUS') === ''
      ? radius
      : parseCoord(record, 'SecondaryRadius');
    return {
      kind: 'ellipse',
      center: readLocation(record),
      rx: radius,
      ry: secondaryRadius,
      record_index: record.index
    };
  }
  if (record.RECORD === '7') {
    const points = parsePointList(record);
    return points.length >= 3 ? {
      kind: 'polygon',
      points,
      filled: truthyFlag(getField(record, 'IsSolid', 'ISSOLID')),
      record_index: record.index
    } : null;
  }
  if (record.RECORD === '5') {
    const points = parsePointList(record);
    return points.length >= 4 ? { kind: 'bezier', points: points.slice(0, 4), record_index: record.index } : null;
  }
  return null;
}

function previewPrimitivePoints(primitive) {
  if (!primitive) return [];
  if (primitive.kind === 'line' || primitive.kind === 'rectangle' || primitive.kind === 'roundRect') {
    return [primitive.a, primitive.b];
  }
  if (primitive.kind === 'polyline' || primitive.kind === 'polygon' || primitive.kind === 'bezier') {
    return primitive.points || [];
  }
  if (primitive.kind === 'arc') {
    return [
      { x: primitive.center.x - primitive.radius, y: primitive.center.y - primitive.radius },
      { x: primitive.center.x + primitive.radius, y: primitive.center.y + primitive.radius }
    ];
  }
  if (primitive.kind === 'ellipse') {
    return [
      { x: primitive.center.x - primitive.rx, y: primitive.center.y - primitive.ry },
      { x: primitive.center.x + primitive.rx, y: primitive.center.y + primitive.ry }
    ];
  }
  return [];
}

function boundsFromPoints(points) {
  const valid = (points || [])
    .map(point => point && typeof point === 'object'
      ? { x: Number(point.x), y: Number(point.y) }
      : null)
    .filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((bounds, point) => ({
    min_x: Math.min(bounds.min_x, point.x),
    min_y: Math.min(bounds.min_y, point.y),
    max_x: Math.max(bounds.max_x, point.x),
    max_y: Math.max(bounds.max_y, point.y)
  }), {
    min_x: valid[0].x,
    min_y: valid[0].y,
    max_x: valid[0].x,
    max_y: valid[0].y
  });
}

function buildPreviewInput(records, components, partMap) {
  const componentByIndex = new Map();
  (components || []).forEach(component => {
    componentByIndex.set(String(component.raw_part_index), component);
  });

  const componentPrimitives = new Map();
  const lines = [];
  const polylines = [];
  const rectangles = [];
  const roundRects = [];
  const arcs = [];
  const ellipses = [];
  const polygons = [];
  const beziers = [];
  const busses = [];
  const busEntries = [];
  const noErcs = [];
  const junctions = [];
  const netLabels = [];
  const powerPorts = [];
  const texts = [];
  const wires = [];
  const pinDrafts = [];
  let sheetSize = null;

  records.forEach(record => {
    if (record.RECORD === '31' && truthyFlag(getField(record, 'UseCustomSheet', 'USECUSTOMSHEET'))) {
      sheetSize = {
        x: parseCoord(record, 'CustomX'),
        y: parseCoord(record, 'CustomY')
      };
    }

    const primitive = buildPreviewPrimitive(record);
    if (primitive) {
      const ownerKey = getOwnerKey(record);
      if (componentByIndex.has(ownerKey)) {
        const current = componentPrimitives.get(ownerKey) || [];
        current.push(primitive);
        componentPrimitives.set(ownerKey, current);
      }
      if (primitive.kind === 'line') lines.push({ a: primitive.a, b: primitive.b });
      if (primitive.kind === 'polyline') polylines.push(primitive.points);
      if (primitive.kind === 'rectangle') rectangles.push({ a: primitive.a, b: primitive.b });
      if (primitive.kind === 'roundRect') roundRects.push({ a: primitive.a, b: primitive.b, rx: primitive.rx, ry: primitive.ry });
      if (primitive.kind === 'arc') arcs.push({
        center: primitive.center,
        radius: primitive.radius,
        startAngle: primitive.startAngle,
        endAngle: primitive.endAngle
      });
      if (primitive.kind === 'ellipse') ellipses.push({ center: primitive.center, rx: primitive.rx, ry: primitive.ry });
      if (primitive.kind === 'polygon') polygons.push({ points: primitive.points, filled: primitive.filled });
      if (primitive.kind === 'bezier') beziers.push({ points: primitive.points });
    }

    if (record.RECORD === '27') {
      const points = parsePointList(record);
      for (let index = 0; index < points.length - 1; index += 1) {
        wires.push({ a: points[index], b: points[index + 1] });
      }
    }
    if (record.RECORD === '26') {
      const points = parsePointList(record);
      for (let index = 0; index < points.length - 1; index += 1) {
        busses.push({ a: points[index], b: points[index + 1] });
      }
    }
    if (record.RECORD === '33') {
      busEntries.push({ a: readLocation(record), b: readCorner(record) });
    }
    if (record.RECORD === '36') {
      noErcs.push(readLocation(record));
    }
    if (record.RECORD === '29') {
      junctions.push(readLocation(record));
    }
    if (record.RECORD === '25') {
      const point = readLocation(record);
      netLabels.push({
        x: point.x,
        y: point.y,
        text: visibleText(record),
        orientation: parseNumberField(record, 0, 'Orientation', 'ORIENTATION'),
        justification: parseNumberField(record, 0, 'Justification', 'JUSTIFICATION')
      });
    }
    if (record.RECORD === '17') {
      const point = readLocation(record);
      powerPorts.push({
        x: point.x,
        y: point.y,
        text: visibleText(record),
        orientation: parseNumberField(record, 0, 'Orientation', 'ORIENTATION'),
        style: parseNumberField(record, 0, 'Style', 'STYLE')
      });
    }
    if (record.RECORD === '4' || record.RECORD === '34' || (record.RECORD === '41' && !truthyFlag(getField(record, 'IsHidden', 'ISHIDDEN')))) {
      const text = visibleText(record);
      if (text) {
        const point = readLocation(record);
        texts.push({
          x: point.x,
          y: point.y,
          text,
          orientation: parseNumberField(record, 0, 'Orientation', 'ORIENTATION'),
          kind: record.RECORD === '34' ? 'designator' : (record.RECORD === '41' ? 'parameter' : 'label')
        });
      }
    }
    if (record.RECORD === '2') {
      pinDrafts.push(previewPinCandidates(record, partMap));
    }
  });

  const pins = reconcilePreviewPins(pinDrafts, wires, busses, junctions, powerPorts, netLabels);

  const pinsByOwner = new Map();
  pins.forEach(pin => {
    if (!pin.designator) return;
    const current = pinsByOwner.get(pin.designator) || [];
    current.push(pin);
    pinsByOwner.set(pin.designator, current);
  });

  const fallbackComponents = [];
  (components || []).forEach(component => {
    const primitives = componentPrimitives.get(String(component.raw_part_index)) || [];
    if (primitives.length > 0) {
      return;
    }
    const componentPins = pinsByOwner.get(component.designator) || [];
    const pinPoints = componentPins.flatMap(pin => [
      { x: pin.x, y: pin.y },
      previewPinBodyPoint(pin)
    ]);
    const bounds = boundsFromPoints(pinPoints);
    if (!bounds) {
      return;
    }
    const minWidth = 24;
    const minHeight = 18;
    const width = Math.max(bounds.max_x - bounds.min_x, minWidth);
    const height = Math.max(bounds.max_y - bounds.min_y, minHeight);
    const cx = (bounds.min_x + bounds.max_x) / 2;
    const cy = (bounds.min_y + bounds.max_y) / 2;
    fallbackComponents.push({
      record_index: component.raw_part_index,
      designator: component.designator || '',
      value: component.value || component.comment || '',
      x: cx - width / 2,
      y: cy - height / 2,
      w: width,
      h: height
    });
  });

  return {
    version: 1,
    renderer: 'emb-agent-schdoc-svg-preview-v1',
    sheetSize,
    wires,
    busses,
    busEntries,
    lines,
    polylines,
    rectangles,
    roundRects,
    arcs,
    ellipses,
    polygons,
    beziers,
    noErcs,
    texts,
    components: fallbackComponents,
    pins,
    junctions,
    netLabels,
    powerPorts
  };
}

function svgEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgBoundsOf(input) {
  const points = [];
  const add = point => {
    if (point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))) {
      points.push({ x: Number(point.x), y: Number(point.y) });
    }
  };

  (input.wires || []).forEach(item => { add(item.a); add(item.b); });
  (input.busses || []).forEach(item => { add(item.a); add(item.b); });
  (input.busEntries || []).forEach(item => { add(item.a); add(item.b); });
  (input.lines || []).forEach(item => { add(item.a); add(item.b); });
  (input.polylines || []).forEach(item => (item || []).forEach(add));
  (input.rectangles || []).forEach(item => { add(item.a); add(item.b); });
  (input.roundRects || []).forEach(item => { add(item.a); add(item.b); });
  (input.arcs || []).forEach(item => {
    add({ x: item.center.x - item.radius, y: item.center.y - item.radius });
    add({ x: item.center.x + item.radius, y: item.center.y + item.radius });
  });
  (input.ellipses || []).forEach(item => {
    add({ x: item.center.x - item.rx, y: item.center.y - item.ry });
    add({ x: item.center.x + item.rx, y: item.center.y + item.ry });
  });
  (input.polygons || []).forEach(item => (item.points || []).forEach(add));
  (input.beziers || []).forEach(item => (item.points || []).forEach(add));
  (input.noErcs || []).forEach(add);
  (input.texts || []).forEach(item => add({ x: item.x, y: item.y }));
  (input.components || []).forEach(item => {
    add({ x: item.x, y: item.y });
    add({ x: item.x + item.w, y: item.y + item.h });
  });
  (input.pins || []).forEach(item => {
    add({ x: item.x, y: item.y });
    add(previewPinBodyPoint(item));
  });
  (input.junctions || []).forEach(add);
  (input.netLabels || []).forEach(item => add({ x: item.x, y: item.y }));
  (input.powerPorts || []).forEach(item => add({ x: item.x, y: item.y }));
  if (input.sheetSize) {
    add({ x: 0, y: 0 });
    add(input.sheetSize);
  }
  const bounds = boundsFromPoints(points);
  if (!bounds) {
    return { min_x: 0, min_y: 0, max_x: 1000, max_y: 700 };
  }
  const pad = 40;
  return {
    min_x: bounds.min_x - pad,
    min_y: bounds.min_y - pad,
    max_x: bounds.max_x + pad,
    max_y: bounds.max_y + pad
  };
}

function arcPathD(tx, ty, center, radius, startDeg, endDeg) {
  const start = (Number(startDeg || 0) * Math.PI) / 180;
  const end = (Number(endDeg || 360) * Math.PI) / 180;
  const sx = tx(center.x + radius * Math.cos(start));
  const sy = ty(center.y + radius * Math.sin(start));
  const ex = tx(center.x + radius * Math.cos(end));
  const ey = ty(center.y + radius * Math.sin(end));
  let sweep = Number(endDeg || 360) - Number(startDeg || 0);
  while (sweep < 0) sweep += 360;
  return `M ${sx} ${sy} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${ex} ${ey}`;
}

function arcSweepDegrees(startDeg, endDeg) {
  let sweep = Number(endDeg || 360) - Number(startDeg || 0);
  while (sweep < 0) sweep += 360;
  return sweep;
}

function svgRotationDeg(orientation) {
  const normalized = ((Number(orientation || 0) % 4) + 4) % 4;
  if (normalized === 1) return 90;
  if (normalized === 2) return 180;
  if (normalized === 3) return -90;
  return 0;
}

function svgTextAnchorForJustification(justification) {
  const normalized = Number(justification || 0);
  if (normalized === 2 || normalized === 5 || normalized === 8) return 'middle';
  if (normalized === 3 || normalized === 6 || normalized === 9) return 'end';
  return 'start';
}

function svgBaselineForJustification(justification) {
  const normalized = Number(justification || 0);
  if (normalized === 7 || normalized === 8 || normalized === 9) return 'hanging';
  if (normalized === 4 || normalized === 5 || normalized === 6) return 'central';
  return 'text-after-edge';
}

function previewPinLabelPlacement(pin, tx, ty) {
  const body = previewPinBodyPoint(pin);
  const dx = Number(body.x) - Number(pin.x);
  const dy = Number(body.y) - Number(pin.y);
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const offset = 3.5;
  if (horizontal) {
    return {
      x: tx(body.x) + (dx >= 0 ? offset : -offset),
      y: ty(body.y),
      anchor: dx >= 0 ? 'start' : 'end',
      baseline: 'central'
    };
  }
  return {
    x: tx(body.x) + offset,
    y: ty(body.y),
    anchor: 'start',
    baseline: 'central'
  };
}

function previewNetLabelPlacement(label) {
  const orientation = ((Number(label.orientation || 0) % 4) + 4) % 4;
  if (orientation === 1) return { x: 0, y: 4 };
  if (orientation === 3) return { x: 0, y: -4 };
  return { x: 0, y: -4 };
}

function previewPowerPortPlacement(port, tx, ty) {
  const orientation = ((Number(port.orientation || 0) % 4) + 4) % 4;
  const offset = 7;
  if (orientation === 0) {
    return { x: tx(port.x) + offset, y: ty(port.y), anchor: 'start', baseline: 'central' };
  }
  if (orientation === 2) {
    return { x: tx(port.x) - offset, y: ty(port.y), anchor: 'end', baseline: 'central' };
  }
  if (orientation === 3) {
    return { x: tx(port.x), y: ty(port.y) + offset, anchor: 'middle', baseline: 'hanging' };
  }
  return { x: tx(port.x), y: ty(port.y) - offset, anchor: 'middle', baseline: 'text-after-edge' };
}

function buildPreviewSvg(input) {
  const preview = input || {};
  const bounds = svgBoundsOf(preview);
  const width = bounds.max_x - bounds.min_x;
  const height = bounds.max_y - bounds.min_y;
  const tx = x => Number(x) - bounds.min_x;
  const ty = y => bounds.max_y - Number(y);
  const parts = [];

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${Math.ceil(width * 4)}" height="${Math.ceil(height * 4)}" preserveAspectRatio="xMidYMid meet">`);
  parts.push(`<style>
    svg { shape-rendering: geometricPrecision; background: #ffffff; }
    .preview-sheet-bg { fill: #ffffff; }
    .preview-sheet { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1; }
    .preview-wire { stroke: #2563eb; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; fill: none; shape-rendering: crispEdges; }
    .preview-bus { stroke: #7c3aed; stroke-width: 2.5; stroke-linecap: round; fill: none; }
    .preview-bus-entry { stroke: #7c3aed; stroke-width: 2; stroke-linecap: round; fill: none; }
    .preview-line { stroke: #1f2937; stroke-width: 0.9; stroke-linecap: round; fill: none; opacity: 0.82; }
    .preview-box { fill: none; stroke: #1f2937; stroke-width: 0.9; opacity: 0.82; }
    .preview-fill { fill: rgba(37, 99, 235, 0.12); stroke: #1f2937; stroke-width: 0.9; opacity: 0.9; }
    .preview-pin { stroke: #b45309; stroke-width: 1.1; stroke-linecap: round; shape-rendering: crispEdges; }
    .preview-pin-hotspot { fill: #f59e0b; stroke: #ffffff; stroke-width: 0.3; opacity: 0.95; }
    .preview-junction { fill: #2563eb; }
    .preview-component-body { fill: rgba(37, 99, 235, 0.08); stroke: #2563eb; stroke-width: 0.9; stroke-dasharray: 3 3; }
    .preview-text { font-family: Arial, sans-serif; pointer-events: none; fill: #111827; font-size: 6px; dominant-baseline: middle; }
    .preview-text-designator { font-size: 7px; font-weight: 600; }
    .preview-text-parameter { font-size: 5.5px; fill: #166534; }
    .preview-pin-label { font-size: 4.8px; fill: #334155; font-weight: 500; }
    .preview-netlabel { font-size: 6px; fill: #b45309; font-weight: 500; }
    .preview-powerport { font-size: 7px; fill: #7c3aed; font-weight: 600; text-anchor: middle; }
    .preview-noerc { stroke: #ca8a04; stroke-width: 1.2; stroke-linecap: round; }
  </style>`);
  parts.push(`<rect class="preview-sheet-bg" x="0" y="0" width="${width}" height="${height}"/>`);
  if (preview.sheetSize) {
    parts.push(`<rect class="preview-sheet" x="${tx(0)}" y="${ty(preview.sheetSize.y)}" width="${preview.sheetSize.x}" height="${preview.sheetSize.y}"/>`);
  }
  (preview.components || []).forEach(component => {
    parts.push(`<rect class="preview-component-body" data-ref-kind="component" data-ref-id="${component.record_index}" data-designator="${svgEscape(component.designator)}" x="${tx(component.x)}" y="${ty(component.y + component.h)}" width="${component.w}" height="${component.h}" rx="2" ry="2"/>`);
  });
  (preview.wires || []).forEach(item => {
    parts.push(`<line class="preview-wire" x1="${tx(item.a.x)}" y1="${ty(item.a.y)}" x2="${tx(item.b.x)}" y2="${ty(item.b.y)}"/>`);
  });
  (preview.busses || []).forEach(item => {
    parts.push(`<line class="preview-bus" x1="${tx(item.a.x)}" y1="${ty(item.a.y)}" x2="${tx(item.b.x)}" y2="${ty(item.b.y)}"/>`);
  });
  (preview.busEntries || []).forEach(item => {
    parts.push(`<line class="preview-bus-entry" x1="${tx(item.a.x)}" y1="${ty(item.a.y)}" x2="${tx(item.b.x)}" y2="${ty(item.b.y)}"/>`);
  });
  (preview.lines || []).forEach(item => {
    parts.push(`<line class="preview-line" x1="${tx(item.a.x)}" y1="${ty(item.a.y)}" x2="${tx(item.b.x)}" y2="${ty(item.b.y)}"/>`);
  });
  (preview.polylines || []).forEach(polyline => {
    parts.push(`<polyline class="preview-line" points="${polyline.map(point => `${tx(point.x)},${ty(point.y)}`).join(' ')}" stroke-linejoin="miter"/>`);
  });
  (preview.rectangles || []).forEach(rectangle => {
    const minX = Math.min(rectangle.a.x, rectangle.b.x);
    const maxX = Math.max(rectangle.a.x, rectangle.b.x);
    const minY = Math.min(rectangle.a.y, rectangle.b.y);
    const maxY = Math.max(rectangle.a.y, rectangle.b.y);
    parts.push(`<rect class="preview-box" x="${tx(minX)}" y="${ty(maxY)}" width="${maxX - minX}" height="${maxY - minY}"/>`);
  });
  (preview.roundRects || []).forEach(rectangle => {
    const minX = Math.min(rectangle.a.x, rectangle.b.x);
    const maxX = Math.max(rectangle.a.x, rectangle.b.x);
    const minY = Math.min(rectangle.a.y, rectangle.b.y);
    const maxY = Math.max(rectangle.a.y, rectangle.b.y);
    parts.push(`<rect class="preview-box" x="${tx(minX)}" y="${ty(maxY)}" width="${maxX - minX}" height="${maxY - minY}" rx="${rectangle.rx}" ry="${rectangle.ry}"/>`);
  });
  (preview.arcs || []).forEach(arc => {
    if (arcSweepDegrees(arc.startAngle, arc.endAngle) >= 359.9) {
      parts.push(`<circle class="preview-box" cx="${tx(arc.center.x)}" cy="${ty(arc.center.y)}" r="${arc.radius}"/>`);
    } else {
      parts.push(`<path class="preview-line" d="${arcPathD(tx, ty, arc.center, arc.radius, arc.startAngle, arc.endAngle)}" fill="none"/>`);
    }
  });
  (preview.ellipses || []).forEach(ellipse => {
    parts.push(`<ellipse class="preview-box" cx="${tx(ellipse.center.x)}" cy="${ty(ellipse.center.y)}" rx="${ellipse.rx}" ry="${ellipse.ry}"/>`);
  });
  (preview.polygons || []).forEach(polygon => {
    const points = (polygon.points || []).map(point => `${tx(point.x)},${ty(point.y)}`).join(' ');
    parts.push(`<polygon class="${polygon.filled ? 'preview-fill' : 'preview-box'}" points="${points}"/>`);
  });
  (preview.beziers || []).forEach(bezier => {
    const points = bezier.points || [];
    if (points.length >= 4) {
      parts.push(`<path class="preview-line" d="M ${tx(points[0].x)} ${ty(points[0].y)} C ${tx(points[1].x)} ${ty(points[1].y)}, ${tx(points[2].x)} ${ty(points[2].y)}, ${tx(points[3].x)} ${ty(points[3].y)}"/>`);
    }
  });
  (preview.pins || []).forEach(pin => {
    const body = previewPinBodyPoint(pin);
    const tooltip = `${svgEscape(pin.designator)}-${svgEscape(pin.pin)}${pin.pinName ? ` (${svgEscape(pin.pinName)})` : ''}`;
    parts.push(`<line class="preview-pin" data-ref-kind="pin" data-ref-id="${pin.record_index}" data-designator="${svgEscape(pin.designator)}" data-pin="${svgEscape(pin.pin)}" x1="${tx(pin.x)}" y1="${ty(pin.y)}" x2="${tx(body.x)}" y2="${ty(body.y)}"><title>${tooltip}</title></line>`);
    parts.push(`<circle class="preview-pin-hotspot" data-ref-kind="pin" data-ref-id="${pin.record_index}" data-designator="${svgEscape(pin.designator)}" data-pin="${svgEscape(pin.pin)}" cx="${tx(pin.x)}" cy="${ty(pin.y)}" r="1.8"><title>${tooltip}</title></circle>`);
    const label = String(pin.pinName || pin.pin || '').trim();
    if (label) {
      const placement = previewPinLabelPlacement(pin, tx, ty);
      parts.push(`<text class="preview-text preview-pin-label" data-ref-kind="pin-label" data-ref-id="${pin.record_index}" x="${placement.x}" y="${placement.y}" text-anchor="${placement.anchor}" dominant-baseline="${placement.baseline}">${svgEscape(label)}</text>`);
    }
  });
  (preview.texts || []).forEach(text => {
    const x = tx(text.x);
    const y = ty(text.y);
    const rotation = svgRotationDeg(text.orientation);
    const transform = rotation !== 0 ? ` transform="rotate(${rotation} ${x} ${y})"` : '';
    const cssClass = text.kind === 'designator'
      ? 'preview-text preview-text-designator'
      : text.kind === 'parameter'
        ? 'preview-text preview-text-parameter'
        : 'preview-text';
    parts.push(`<text class="${cssClass}" x="${x}" y="${y}"${transform}>${svgEscape(text.text)}</text>`);
  });
  (preview.junctions || []).forEach(point => {
    parts.push(`<circle class="preview-junction" cx="${tx(point.x)}" cy="${ty(point.y)}" r="2.5"/>`);
  });
  (preview.noErcs || []).forEach(point => {
    const x = tx(point.x);
    const y = ty(point.y);
    const size = 4;
    parts.push(`<g class="preview-noerc"><line x1="${x - size}" y1="${y - size}" x2="${x + size}" y2="${y + size}"/><line x1="${x - size}" y1="${y + size}" x2="${x + size}" y2="${y - size}"/></g>`);
  });
  (preview.netLabels || []).forEach(label => {
    const x = tx(label.x);
    const y = ty(label.y);
    const rotation = svgRotationDeg(label.orientation || 0);
    const transform = rotation !== 0 ? ` transform="translate(${x} ${y}) rotate(${rotation})"` : ` transform="translate(${x} ${y})"`;
    const anchor = svgTextAnchorForJustification(label.justification);
    const baseline = svgBaselineForJustification(label.justification);
    const placement = previewNetLabelPlacement(label);
    parts.push(`<g${transform}><text class="preview-text preview-netlabel" data-ref-kind="netlabel" x="${placement.x}" y="${placement.y}" text-anchor="${anchor}" dominant-baseline="${baseline}">${svgEscape(label.text)}</text></g>`);
  });
  (preview.powerPorts || []).forEach(port => {
    const placement = previewPowerPortPlacement(port, tx, ty);
    parts.push(`<text class="preview-text preview-powerport" data-ref-kind="power" x="${placement.x}" y="${placement.y}" text-anchor="${placement.anchor}" dominant-baseline="${placement.baseline}">${svgEscape(port.text)}</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n');
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
  const objects = buildTypedObjects(parsed.records, partMap);
  const bom = buildBom(components);
  const previewInput = buildPreviewInput(parsed.records, components, partMap);
  const previewSvg = buildPreviewSvg(previewInput);

  return {
    parser_mode: 'altium-raw-internal',
    components,
    nets,
    objects,
    bom,
    preview: {
      input: previewInput,
      svg: previewSvg,
      summary: {
        renderer: previewInput.renderer,
        wires: previewInput.wires.length,
        pins: previewInput.pins.length,
        lines: previewInput.lines.length,
        polylines: previewInput.polylines.length,
        rectangles: previewInput.rectangles.length,
        round_rects: previewInput.roundRects.length,
        arcs: previewInput.arcs.length,
        ellipses: previewInput.ellipses.length,
        polygons: previewInput.polygons.length,
        beziers: previewInput.beziers.length,
        texts: previewInput.texts.length,
        fallback_components: previewInput.components.length
      }
    },
    raw_summary: {
      records: parsed.records.length,
      components: components.length,
      nets: nets.length,
      objects: objects.length,
      bom_lines: bom.length,
      preview: {
        renderer: previewInput.renderer,
        svg_bytes: Buffer.byteLength(previewSvg, 'utf8'),
        primitives: previewInput.lines.length +
          previewInput.polylines.length +
          previewInput.rectangles.length +
          previewInput.roundRects.length +
          previewInput.arcs.length +
          previewInput.ellipses.length +
          previewInput.polygons.length +
          previewInput.beziers.length
      },
      visual: visualSummary,
      file_header_size: parsed.file_header_size
    }
  };
}

module.exports = {
  buildPreviewSvg,
  parseSchDocBuffer,
  readNamedStream
};
