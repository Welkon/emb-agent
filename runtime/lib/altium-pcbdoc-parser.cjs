'use strict';

const CFB_SIGNATURE = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1
]);

const CFB_SPECIAL = {
  free: 0xffffffff,
  endOfChain: 0xfffffffe
};

const NO_STREAM = 0xffffffff;

function ensureString(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function unique(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(ensureString).filter(Boolean)));
}

function readHeader(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < 512) {
    throw new Error('PcbDoc file is too small to contain a valid compound file header');
  }
  if (!fileBuffer.subarray(0, 8).equals(CFB_SIGNATURE)) {
    throw new Error('PcbDoc file does not look like an OLE compound file');
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

function readSector(fileBuffer, header, sectorIndex) {
  const offset = (sectorIndex + 1) * header.sectorSize;
  const end = offset + header.sectorSize;
  if (offset < 0 || end > fileBuffer.length) {
    throw new Error(`CFB sector ${sectorIndex} is outside file bounds`);
  }
  return fileBuffer.subarray(offset, end);
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

  while (
    remaining > 0 &&
    nextDifatSector !== CFB_SPECIAL.endOfChain &&
    nextDifatSector !== CFB_SPECIAL.free
  ) {
    const sector = readSector(fileBuffer, header, nextDifatSector);
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
    const sector = readSector(fileBuffer, header, sectorId);
    for (let offset = 0; offset < sector.length; offset += 4) {
      entries.push(sector.readUInt32LE(offset));
    }
  });

  return entries;
}

function readChain(fileBuffer, header, fatEntries, startSector, expectedSize) {
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
    chunks.push(readSector(fileBuffer, header, currentSector));
    currentSector = fatEntries[currentSector];
  }

  const data = Buffer.concat(chunks);
  return typeof expectedSize === 'number' ? data.subarray(0, expectedSize) : data;
}

function parseDirectoryEntries(fileBuffer, header, fatEntries) {
  const directoryData = readChain(
    fileBuffer,
    header,
    fatEntries,
    header.firstDirSector,
    header.numDirSectors > 0 ? header.numDirSectors * header.sectorSize : undefined
  );
  const entries = [];

  for (let offset = 0; offset + 128 <= directoryData.length; offset += 128) {
    const nameLength = directoryData.readUInt16LE(offset + 64);
    const name = nameLength >= 2
      ? directoryData.subarray(offset, offset + nameLength - 2).toString('utf16le').replace(/\u0000+$/g, '')
      : '';

    entries.push({
      id: offset / 128,
      name,
      type: directoryData[offset + 66],
      left: directoryData.readUInt32LE(offset + 68),
      right: directoryData.readUInt32LE(offset + 72),
      child: directoryData.readUInt32LE(offset + 76),
      startingSector: directoryData.readUInt32LE(offset + 116),
      size: Number(directoryData.readBigUInt64LE(offset + 120))
    });
  }

  return entries.filter(entry => entry.name);
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
    header,
    fatEntries,
    header.firstMiniFatSector,
    header.numMiniFatSectors * header.sectorSize
  );
  const entries = [];
  for (let offset = 0; offset < miniFatData.length; offset += 4) {
    entries.push(miniFatData.readUInt32LE(offset));
  }
  return entries;
}

function readMiniStream(entry, rootEntry, fileBuffer, header, fatEntries, miniFatEntries) {
  const rootStream = readChain(
    fileBuffer,
    header,
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

function buildCfb(fileBuffer) {
  const header = readHeader(fileBuffer);
  const fatEntries = buildFat(fileBuffer, header);
  const entries = parseDirectoryEntries(fileBuffer, header, fatEntries);
  const rootEntry = entries.find(entry => entry.type === 5) || entries[0];
  const miniFatEntries = readMiniFat(fileBuffer, header, fatEntries);

  function sortedChildren(parentId) {
    const parent = entries.find(entry => entry.id === parentId);
    const result = [];
    function walk(entryId) {
      if (entryId === NO_STREAM) return;
      const entry = entries.find(item => item.id === entryId);
      if (!entry) return;
      walk(entry.left);
      result.push(entry);
      walk(entry.right);
    }
    if (parent) {
      walk(parent.child);
    }
    return result;
  }

  function readStream(entry) {
    if (!entry || entry.type !== 2) {
      throw new Error('CFB entry is not a stream');
    }
    if (entry.size < header.miniStreamCutoff) {
      if (!rootEntry) {
        throw new Error('CFB root entry is missing; mini stream cannot be resolved');
      }
      return readMiniStream(entry, rootEntry, fileBuffer, header, fatEntries, miniFatEntries);
    }
    return readChain(fileBuffer, header, fatEntries, entry.startingSector, entry.size);
  }

  function streamFileRanges(entry) {
    if (!entry || entry.type !== 2) {
      throw new Error('CFB entry is not a stream');
    }
    if (entry.size < header.miniStreamCutoff) {
      throw new Error('CFB mini streams cannot be patched in place yet');
    }
    const ranges = [];
    const seen = new Set();
    let currentSector = entry.startingSector;
    let remaining = entry.size;
    let streamOffset = 0;
    while (currentSector !== CFB_SPECIAL.endOfChain && currentSector !== CFB_SPECIAL.free && remaining > 0) {
      if (seen.has(currentSector)) {
        throw new Error(`CFB sector chain loop detected at sector ${currentSector}`);
      }
      if (currentSector >= fatEntries.length) {
        throw new Error(`CFB sector ${currentSector} is outside FAT range`);
      }
      const file_offset = (currentSector + 1) * header.sectorSize;
      const length = Math.min(header.sectorSize, remaining);
      ranges.push({
        sector: currentSector,
        stream_offset: streamOffset,
        file_offset,
        length
      });
      seen.add(currentSector);
      streamOffset += length;
      remaining -= length;
      currentSector = fatEntries[currentSector];
    }
    if (remaining > 0) {
      throw new Error('CFB stream chain ended before declared stream size');
    }
    return ranges;
  }

  function listPaths() {
    const result = [];
    function visit(parentId, prefix) {
      sortedChildren(parentId).forEach(entry => {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        result.push({
          path,
          name: entry.name,
          type: entry.type,
          size: entry.size
        });
        if (entry.type === 1 || entry.type === 5) {
          visit(entry.id, path);
        }
      });
    }
    if (rootEntry) {
      result.push({
        path: rootEntry.name,
        name: rootEntry.name,
        type: rootEntry.type,
        size: rootEntry.size
      });
      visit(rootEntry.id, rootEntry.name);
    }
    return result;
  }

  function findEntryByPath(pathParts) {
    let current = rootEntry;
    const parts = Array.isArray(pathParts) ? pathParts : String(pathParts || '').split('/').filter(Boolean);
    const normalizedParts = parts[0] === (rootEntry && rootEntry.name) ? parts.slice(1) : parts;

    for (const part of normalizedParts) {
      const next = sortedChildren(current.id).find(entry => entry.name === part);
      if (!next) return null;
      current = next;
    }
    return current;
  }

  return {
    header,
    entries,
    rootEntry,
    listPaths,
    findEntryByPath,
    readStream,
    streamFileRanges
  };
}

function decodePcbText(streamBuffer) {
  if (!Buffer.isBuffer(streamBuffer) || streamBuffer.length === 0) {
    return '';
  }

  let start = 0;
  if (streamBuffer.length >= 4) {
    const declaredLength = streamBuffer.readUInt32LE(0);
    if (declaredLength > 0 && declaredLength <= streamBuffer.length - 4) {
      start = 4;
    }
  }

  return streamBuffer
    .subarray(start)
    .toString('latin1')
    .replace(/\u0000+$/g, '');
}

function readUInt32LengthPrefixedTextRecords(streamBuffer) {
  const records = [];
  let offset = 0;

  while (offset + 4 <= streamBuffer.length) {
    const length = streamBuffer.readUInt32LE(offset);
    const start = offset + 4;
    const end = start + length;
    if (length <= 0 || end > streamBuffer.length) {
      break;
    }

    records.push({
      offset,
      length,
      text: streamBuffer.subarray(start, end).toString('latin1').replace(/\u0000+$/g, '')
    });
    offset = end;
  }

  return records;
}

function splitLengthPrefixedRecords(streamBuffer, fallbackType) {
  const chunks = readUInt32LengthPrefixedTextRecords(streamBuffer);
  return chunks.map((chunk, index) => {
    const fields = parseKeyValueRecord(chunk.text);
    return {
      record_type: fields.RECORD || fallbackType || 'Unknown',
      fields,
      offset: chunk.offset,
      length: chunk.length,
      stream_index: index
    };
  }).filter(record => Object.keys(record.fields || {}).length > 0);
}

function splitEmbeddedKeyValueRecords(streamBuffer, marker, fallbackType) {
  if (!Buffer.isBuffer(streamBuffer) || streamBuffer.length === 0) return [];
  const text = streamBuffer.toString('latin1');
  const starts = [];
  let searchIndex = 0;
  while ((searchIndex = text.indexOf(marker, searchIndex)) !== -1) {
    starts.push(searchIndex);
    searchIndex += marker.length;
  }
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : text.length;
    const fields = parseKeyValueRecord(text.slice(start, end));
    return {
      record_type: fields.RECORD || fallbackType || 'Unknown',
      fields,
      offset: start,
      length: end - start,
      stream_index: index
    };
  }).filter(record => Object.keys(record.fields || {}).length > 0);
}

function embeddedRecordStarts(streamBuffer, marker) {
  if (!Buffer.isBuffer(streamBuffer) || streamBuffer.length === 0) return [];
  const text = streamBuffer.toString('latin1');
  const starts = [];
  let searchIndex = 0;
  while ((searchIndex = text.indexOf(marker, searchIndex)) !== -1) {
    starts.push(searchIndex);
    searchIndex += marker.length;
  }
  return starts;
}

function printableHeaderEnd(streamBuffer, start, end) {
  let printableEnd = start;
  for (let offset = start; offset < end; offset += 1) {
    const byte = streamBuffer[offset];
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
      printableEnd = offset + 1;
      continue;
    }
    if (offset > start + 20) break;
  }
  return printableEnd;
}

function splitRecords(text) {
  const value = String(text || '');
  const starts = [];
  const pattern = /\|RECORD=/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    starts.push(match.index);
  }

  const records = [];
  if (starts.length === 0) {
    const fields = parseKeyValueRecord(value);
    if (Object.keys(fields).length > 0) {
      records.push({
        record_type: fields.RECORD || 'Preamble',
        fields,
        offset: 0
      });
    }
    return records;
  }

  const preamble = value.slice(0, starts[0]);
  const preambleFields = parseKeyValueRecord(preamble);
  if (Object.keys(preambleFields).length > 0) {
    records.push({
      record_type: preambleFields.RECORD || 'Preamble',
      fields: preambleFields,
      offset: 0
    });
  }

  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : value.length;
    const fields = parseKeyValueRecord(value.slice(start, end));
    if (Object.keys(fields).length > 0) {
      records.push({
        record_type: fields.RECORD || 'Unknown',
        fields,
        offset: start
      });
    }
  });

  return records;
}

function parseKeyValueRecord(recordText) {
  const fields = {};
  String(recordText || '')
    .split('|')
    .forEach(part => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex <= 0) return;
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).replace(/[\u0000-\u001f]+$/g, '').trim();
      if (key) {
        fields[key] = value;
      }
    });
  return fields;
}

function parseLengthUnit(value) {
  const text = ensureString(value);
  if (!text) return null;
  const match = text.match(/^([-+]?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?)\s*(mil|mm|inch|in)?$/i);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'mm') return number;
  if (unit === 'inch' || unit === 'in') return number * 25.4;
  return number * 0.0254;
}

function decodeUnicodeCsv(value) {
  const text = ensureString(value);
  if (!/^\d+(?:,\d+)*$/.test(text)) {
    return text;
  }
  return text
    .split(',')
    .map(item => String.fromCodePoint(Number(item)))
    .join('');
}

function altiumCoordToMm(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number((number / 10000 * 0.0254).toFixed(6));
}

function altiumWidthToMm(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number((number / 10000 * 0.0254).toFixed(6));
}

function pointFromInternal(x, y) {
  const xMm = altiumCoordToMm(x);
  const yMm = altiumCoordToMm(y);
  if (xMm === null || yMm === null) return null;
  return {
    x_mm: xMm,
    y_mm: yMm
  };
}

function pointFromFields(fields, xKey, yKey) {
  const x = parseLengthUnit(fields[xKey]);
  const y = parseLengthUnit(fields[yKey]);
  if (x === null || y === null) return null;
  return {
    x_mm: Number(x.toFixed(6)),
    y_mm: Number(y.toFixed(6))
  };
}

function boundsAroundCenter(center, widthMm, heightMm) {
  if (!center || !Number.isFinite(Number(widthMm)) || !Number.isFinite(Number(heightMm))) return null;
  const halfWidth = Number(widthMm) / 2;
  const halfHeight = Number(heightMm) / 2;
  return {
    min_x_mm: Number((Number(center.x_mm) - halfWidth).toFixed(6)),
    min_y_mm: Number((Number(center.y_mm) - halfHeight).toFixed(6)),
    max_x_mm: Number((Number(center.x_mm) + halfWidth).toFixed(6)),
    max_y_mm: Number((Number(center.y_mm) + halfHeight).toFixed(6)),
    width_mm: Number(Number(widthMm).toFixed(6)),
    height_mm: Number(Number(heightMm).toFixed(6))
  };
}

function extractOutline(records) {
  const candidates = [];
  records.forEach((record, recordIndex) => {
    const fields = record.fields || {};
    const points = [];
    for (let index = 0; index < 512; index += 1) {
      const point = pointFromFields(fields, `VX${index}`, `VY${index}`);
      if (!point) break;
      points.push(point);
    }
    if (points.length >= 3) {
      candidates.push({
        source_record: recordIndex,
        record_type: record.record_type,
        layer: fields.LAYER || '',
        polygon_type: fields.POLYGONTYPE || '',
        points
      });
    }
  });
  return candidates;
}

function boundsFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const xs = points.map(point => point.x_mm).filter(Number.isFinite);
  const ys = points.map(point => point.y_mm).filter(Number.isFinite);
  if (xs.length === 0 || ys.length === 0) return null;
  return {
    min_x_mm: Number(Math.min(...xs).toFixed(6)),
    min_y_mm: Number(Math.min(...ys).toFixed(6)),
    max_x_mm: Number(Math.max(...xs).toFixed(6)),
    max_y_mm: Number(Math.max(...ys).toFixed(6)),
    width_mm: Number((Math.max(...xs) - Math.min(...xs)).toFixed(6)),
    height_mm: Number((Math.max(...ys) - Math.min(...ys)).toFixed(6))
  };
}

function extractLayerStack(records) {
  const layers = [];
  records.forEach(record => {
    const fields = record.fields || {};
    Object.keys(fields).forEach(key => {
      const match = key.match(/^V9_(?:STACK|CACHE)_LAYER(\d+)_NAME$/);
      if (!match) return;
      const prefix = key.replace(/_NAME$/, '');
      layers.push({
        index: Number(match[1]),
        name: fields[key],
        layer_id: fields[`${prefix}_LAYERID`] || '',
        used_by_primitives: fields[`${prefix}_USEDBYPRIMS`] || '',
        copper_thickness: fields[`${prefix}_COPTHICK`] || '',
        component_placement: fields[`${prefix}_COMPONENTPLACEMENT`] || ''
      });
    });
  });
  return layers
    .filter((layer, index, list) => index === list.findIndex(other => other.layer_id === layer.layer_id && other.name === layer.name))
    .sort((a, b) => a.index - b.index);
}

function normalizeLayer(value) {
  const text = ensureString(value);
  if (/^top/i.test(text)) return 'F';
  if (/^bottom/i.test(text)) return 'B';
  return text;
}

function normalizeLayerCode(value) {
  const number = Number(value);
  if (number === 16777217) return 'F';
  if (number === 16842751) return 'B';
  if (number === 16973839) return 'multi';
  if (number === 16973830) return 'top-overlay';
  if (number === 16973831) return 'bottom-overlay';
  if (number === 794880) return 'top-overlay';
  if (number === 795136) return 'bottom-overlay';
  return Number.isFinite(number) ? String(number) : '';
}

function readStreamCount(cfb, storageName) {
  const headerEntry = cfb.findEntryByPath(`Root Entry/${storageName}/Header`);
  if (!headerEntry) return 0;
  const header = cfb.readStream(headerEntry);
  return header.length >= 4 ? header.readUInt32LE(0) : 0;
}

function readStorageData(cfb, storageName) {
  const entry = cfb.findEntryByPath(`Root Entry/${storageName}/Data`);
  return entry ? cfb.readStream(entry) : Buffer.alloc(0);
}

function readTextStreamRecords(cfb, storageName, fallbackType) {
  const data = readStorageData(cfb, storageName);
  return splitLengthPrefixedRecords(data, fallbackType);
}

function extractComponentClassNames(classRecords, componentCount) {
  const componentClass = classRecords.find(record => {
    const fields = record.fields || {};
    return fields.KIND === '1' && fields.NAME === 'Inside Board Components';
  });
  if (!componentClass) return [];

  const fields = componentClass.fields || {};
  const names = [];
  for (let index = 0; index < componentCount; index += 1) {
    const name = ensureString(fields[`M${index}`]);
    if (!name) break;
    names.push(name);
  }
  return names;
}

function isInternalId(value) {
  return /^[A-Z]{8}$/.test(ensureString(value));
}

function isReferenceDesignator(value) {
  return /^(?:R|RS|C|L|D|Q|U|IC|Y|X|J|JP|P|CN|CON|SW|S|T|TP|FB|F)\d+[A-Z]?$/i.test(ensureString(value));
}

function truthyLockedValue(value) {
  const text = ensureString(value).toLowerCase();
  if (!text) return false;
  return ['1', 'true', 'yes', 'y', 'locked', 'fixed'].includes(text);
}

function lockedFromFields(fields) {
  return [
    'LOCKED',
    'LOCK',
    'ISLOCKED',
    'COMPLOCKED',
    'FIXED',
    'LOCKPRIMS',
    'PRIMITIVESLOCKED'
  ].some(key => truthyLockedValue(fields[key]));
}

function extractComponents(records, classRecords) {
  const classNames = extractComponentClassNames(classRecords, records.length);
  return records
    .map((record, index) => {
      const fields = record.fields || {};
      const sourceDesignator = ensureString(fields.SOURCEDESIGNATOR || fields.DESIGNATOR || fields.NAME || '');
      const classDesignator = ensureString(classNames[index]);
      const designator = ensureString(classDesignator || sourceDesignator || fields.UNIQUEID);
      if (!designator) return null;
      const point = pointFromFields(fields, 'X', 'Y') ||
        pointFromFields(fields, 'LOCATION.X', 'LOCATION.Y') ||
        pointFromFields(fields, 'CENTERX', 'CENTERY');
      return {
        designator,
        source_designator: sourceDesignator,
        board_designator: classDesignator,
        designator_source: classDesignator ? 'component-class' : (sourceDesignator ? 'source-designator' : 'unique-id'),
        parser_warning: isInternalId(designator) ? 'display designator not decoded; using internal unique id' : '',
        value: fields.COMMENT || fields.VALUE || '',
        footprint: fields.PATTERN || fields.FOOTPRINT || fields.PCBLIBRARY || '',
        layer: normalizeLayer(fields.LAYER || ''),
        rotation: fields.ROTATION || '',
        center: point,
        locked: lockedFromFields(fields),
        unique_id: fields.UNIQUEID || '',
        channel_offset: fields.CHANNELOFFSET || '',
        source_record: record.stream_index !== undefined ? record.stream_index : index
      };
    })
    .filter(Boolean);
}

function findText6RecordStarts(streamBuffer, recordCount) {
  const starts = [];
  const layerCodes = new Set([794880, 795136, 801024, 802816, 803840]);

  for (let offset = 0; offset + 8 <= streamBuffer.length; offset += 1) {
    if (streamBuffer.readUInt16LE(offset) !== 0xfc05) continue;
    const layerCode = streamBuffer.readUInt32LE(offset + 4);
    if (!layerCodes.has(layerCode)) continue;
    starts.push(offset);
  }

  if (recordCount > 0 && starts.length > recordCount) {
    return starts.slice(0, recordCount);
  }
  return starts;
}

function extractAsciiSuffix(recordBuffer) {
  let end = recordBuffer.length;
  while (end > 0 && recordBuffer[end - 1] === 0) {
    end -= 1;
  }

  let start = end;
  while (start > 0) {
    const value = recordBuffer[start - 1];
    if (value < 32 || value > 126) break;
    start -= 1;
  }

  return recordBuffer.subarray(start, end).toString('latin1').trim();
}

function extractTextsFromBinary(streamBuffer, recordCount) {
  const starts = findText6RecordStarts(streamBuffer, recordCount);
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : streamBuffer.length;
    const recordBuffer = streamBuffer.subarray(start, end);
    const layerCode = recordBuffer.length >= 8 ? recordBuffer.readUInt32LE(4) : null;
    const point = recordBuffer.length >= 26
      ? pointFromInternal(recordBuffer.readInt32LE(18), recordBuffer.readInt32LE(22))
      : null;
    const text = extractAsciiSuffix(recordBuffer);
    return {
      kind: 'text',
      text,
      layer: normalizeLayerCode(layerCode),
      layer_code: layerCode,
      center: point,
      source_record: index,
      offset: start,
      length: end - start
    };
  }).filter(item => item.text);
}

function attachTextLabelsToComponents(components, texts) {
  const usefulTexts = (Array.isArray(texts) ? texts : [])
    .filter(text => text.center && text.text && text.text !== 'Comment' && text.text !== 'NC');

  return components.map(component => {
    if (!component.center) return component;
    const nearby = usefulTexts
      .map(text => ({
        text: text.text,
        layer: text.layer,
        center: text.center,
        distance_mm: distancePoints(component.center, text.center)
      }))
      .filter(item => item.distance_mm !== null && item.distance_mm <= 6)
      .sort((a, b) => a.distance_mm - b.distance_mm)
      .slice(0, 8)
      .map(item => ({
        ...item,
        distance_mm: Number(item.distance_mm.toFixed(3))
      }));
    const currentLooksUsable = isReferenceDesignator(component.designator);
    const nearbyRef = nearby.find(item => isReferenceDesignator(item.text));
    const shouldPromoteTextRef = nearbyRef && (
      (component.footprint && /\b(?:xh|header|conn|connector|usb)\b/i.test(component.footprint) && /^CON\d+/i.test(nearbyRef.text)) ||
      (!currentLooksUsable && isInternalId(component.designator) && nearbyRef.distance_mm <= 1.5)
    );
    return {
      ...component,
      designator: shouldPromoteTextRef ? nearbyRef.text : component.designator,
      display_designator: shouldPromoteTextRef ? nearbyRef.text : component.designator,
      designator_source: shouldPromoteTextRef ? 'nearby-silkscreen-text' : component.designator_source,
      original_designator: shouldPromoteTextRef ? component.designator : '',
      visible_texts: nearby
    };
  });
}

function distancePoints(a, b) {
  if (!a || !b) return null;
  const dx = Number(a.x_mm) - Number(b.x_mm);
  const dy = Number(a.y_mm) - Number(b.y_mm);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return Math.sqrt(dx * dx + dy * dy);
}

function extractNetsFromRecords(records) {
  return records.map((record, index) => {
    const fields = record.fields || {};
    const name = decodeUnicodeCsv(fields.NAME || fields.NETNAME || '');
    return {
      index,
      name,
      visible: fields.VISIBLE || '',
      color: fields.COLOR || '',
      layer: normalizeLayer(fields.LAYER || ''),
      source_record: record.stream_index !== undefined ? record.stream_index : index
    };
  }).filter(net => net.name);
}

function netNameByIndex(nets, netIndex) {
  const numeric = Number(netIndex);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric >= nets.length) return '';
  const net = nets[numeric];
  return net ? net.name || '' : '';
}

function extractTracksFromBinary(streamBuffer, recordCount, nets) {
  const recordSize = recordCount > 0 ? Math.floor(streamBuffer.length / recordCount) : 0;
  if (!recordSize || recordSize < 40) return [];

  const tracks = [];
  for (let index = 0; index < recordCount; index += 1) {
    const offset = index * recordSize;
    if (offset + recordSize > streamBuffer.length) break;
    const layerCode = streamBuffer.readUInt32LE(offset + 4);
    const netIndex = streamBuffer.readInt16LE(offset + 12);
    const x1 = streamBuffer.readInt32LE(offset + 18);
    const y1 = streamBuffer.readInt32LE(offset + 22);
    const x2 = streamBuffer.readInt32LE(offset + 26);
    const y2 = streamBuffer.readInt32LE(offset + 30);
    const width = streamBuffer.readInt32LE(offset + 34);
    tracks.push({
      kind: 'track',
      layer: normalizeLayerCode(layerCode),
      layer_code: layerCode,
      net_index: netIndex >= 0 && netIndex < nets.length ? netIndex : null,
      raw_net_index: netIndex,
      net: netNameByIndex(nets, netIndex),
      start: pointFromInternal(x1, y1),
      end: pointFromInternal(x2, y2),
      width_mm: altiumWidthToMm(width),
      source_record: index
    });
  }
  return tracks;
}

function extractViasFromBinary(streamBuffer, recordCount, nets) {
  const recordSize = recordCount > 0 ? Math.floor(streamBuffer.length / recordCount) : 0;
  if (!recordSize || recordSize < 40) return [];

  const vias = [];
  for (let index = 0; index < recordCount; index += 1) {
    const offset = index * recordSize;
    if (offset + recordSize > streamBuffer.length) break;
    const netIndex = streamBuffer.readInt16LE(offset + 8);
    const x = streamBuffer.readInt32LE(offset + 18);
    const y = streamBuffer.readInt32LE(offset + 22);
    const diameter = streamBuffer.readInt32LE(offset + 26);
    const drill = streamBuffer.readInt32LE(offset + 30);
    vias.push({
      kind: 'via',
      layer: 'multi',
      net_index: netIndex >= 0 && netIndex < nets.length ? netIndex : null,
      raw_net_index: netIndex,
      net: netNameByIndex(nets, netIndex),
      center: pointFromInternal(x, y),
      drill_mm: altiumWidthToMm(drill),
      diameter_mm: altiumWidthToMm(diameter),
      source_record: index
    });
  }
  return vias;
}

function extractArcsFromBinary(streamBuffer, recordCount, nets) {
  const recordSize = recordCount > 0 ? Math.floor(streamBuffer.length / recordCount) : 0;
  if (!recordSize || recordSize < 56) return [];

  const arcs = [];
  for (let index = 0; index < recordCount; index += 1) {
    const offset = index * recordSize;
    if (offset + recordSize > streamBuffer.length) break;
    const layerCode = streamBuffer.readUInt32LE(offset + 4);
    const netIndex = streamBuffer.readInt16LE(offset + 12);
    const x = streamBuffer.readInt32LE(offset + 18);
    const y = streamBuffer.readInt32LE(offset + 22);
    const radius = streamBuffer.readInt32LE(offset + 26);
    const width = streamBuffer.readInt32LE(offset + 42);
    arcs.push({
      kind: 'arc',
      layer: normalizeLayerCode(layerCode),
      layer_code: layerCode,
      net_index: netIndex >= 0 ? netIndex : null,
      net: netNameByIndex(nets, netIndex),
      center: pointFromInternal(x, y),
      radius_mm: altiumWidthToMm(radius),
      width_mm: altiumWidthToMm(width),
      source_record: index
    });
  }
  return arcs;
}

function extractPolygons(records, nets) {
  return records.map((record, index) => {
    const fields = record.fields || {};
    const points = [];
    for (let pointIndex = 0; pointIndex < 2048; pointIndex += 1) {
      const point = pointFromFields(fields, `VX${pointIndex}`, `VY${pointIndex}`);
      if (!point) break;
      points.push(point);
    }
    const netIndex = fields.NET !== undefined ? Number(fields.NET) : null;
    return {
      kind: 'polygon',
      layer: normalizeLayer(fields.LAYER || ''),
      polygon_type: fields.POLYGONTYPE || '',
      net_index: Number.isFinite(netIndex) && netIndex >= 0 && netIndex < nets.length ? netIndex : null,
      raw_net_index: Number.isFinite(netIndex) ? netIndex : null,
      net: Number.isFinite(netIndex) ? netNameByIndex(nets, netIndex) : '',
      points,
      bounds: boundsFromPoints(points),
      source_record: record.stream_index !== undefined ? record.stream_index : index
    };
  }).filter(item => item.points.length > 0);
}

function findPadRecordStarts(streamBuffer, recordCount) {
  if (recordCount <= 0) return [];
  const markerOffsets = [];
  for (let offset = 0; offset + 3 <= streamBuffer.length; offset += 1) {
    if (streamBuffer[offset] === 0x7c && streamBuffer[offset + 1] === 0x26 && streamBuffer[offset + 2] === 0x7c) {
      markerOffsets.push(offset);
    }
  }

  if (markerOffsets.length >= recordCount) {
    return markerOffsets.slice(0, recordCount).map(offset => Math.max(0, offset - 17));
  }

  const fallbackSize = Math.floor(streamBuffer.length / recordCount);
  if (!fallbackSize) return [];
  const starts = [];
  for (let index = 0; index < recordCount; index += 1) {
    starts.push(index * fallbackSize);
  }
  return starts;
}

function extractPrimitiveUniqueIds(records, objectId) {
  const map = new Map();
  records.forEach(record => {
    const fields = record.fields || {};
    if (ensureString(fields.PRIMITIVEOBJECTID).toLowerCase() !== ensureString(objectId).toLowerCase()) return;
    const index = Number(fields.PRIMITIVEINDEX);
    const uniqueId = ensureString(fields.UNIQUEID);
    if (Number.isInteger(index) && uniqueId) {
      map.set(index, uniqueId);
    }
  });
  return map;
}

function nearestComponentForPoint(point, components) {
  if (!point || !Array.isArray(components)) return null;
  const nearest = components
    .filter(component => component.center)
    .map(component => ({
      component,
      distance_mm: distancePoints(point, component.center)
    }))
    .filter(item => item.distance_mm !== null)
    .sort((a, b) => a.distance_mm - b.distance_mm)[0];
  if (!nearest || nearest.distance_mm > 3.5) return null;
  return nearest;
}

function nearestComponentForBody(point, components) {
  if (!point || !Array.isArray(components)) return null;
  const nearest = components
    .filter(component => component.center)
    .map(component => ({
      component,
      distance_mm: distancePoints(point, component.center)
    }))
    .filter(item => item.distance_mm !== null)
    .sort((a, b) => a.distance_mm - b.distance_mm)[0];
  if (!nearest || nearest.distance_mm > 5) return null;
  return nearest;
}

function padNameFromRecord(streamBuffer, offset) {
  const value = streamBuffer[offset + 6];
  if (value >= 32 && value <= 126) {
    return String.fromCharCode(value);
  }
  return '';
}

function padSizeFromRecord(streamBuffer, offset) {
  if (offset + 59 > streamBuffer.length) return null;
  const width = altiumCoordToMm(streamBuffer.readInt32LE(offset + 51));
  const height = altiumCoordToMm(streamBuffer.readInt32LE(offset + 55));
  if (width === null || height === null || width <= 0 || height <= 0 || width > 100 || height > 100) {
    return null;
  }
  return {
    x_size_mm: width,
    y_size_mm: height
  };
}

function extractPadsFromBinary(streamBuffer, recordCount, nets, components, primitiveIds) {
  const recordStarts = findPadRecordStarts(streamBuffer, recordCount);
  if (recordStarts.length === 0) return [];

  const pads = [];
  for (let index = 0; index < recordStarts.length; index += 1) {
    const offset = recordStarts[index];
    const nextOffset = index + 1 < recordStarts.length ? recordStarts[index + 1] : streamBuffer.length;
    if (offset + 51 > streamBuffer.length || nextOffset - offset < 64) continue;

    const center = pointFromInternal(
      streamBuffer.readInt32LE(offset + 43),
      streamBuffer.readInt32LE(offset + 47)
    );
    const size = padSizeFromRecord(streamBuffer, offset);
    const netIndex = streamBuffer[offset + 33];
    const nearest = nearestComponentForPoint(center, components);
    pads.push({
      kind: 'pad',
      name: padNameFromRecord(streamBuffer, offset),
      unique_id: primitiveIds && primitiveIds.get(index) || '',
      net_index: netIndex >= 0 && netIndex < nets.length ? netIndex : null,
      raw_net_index: netIndex,
      net: netNameByIndex(nets, netIndex),
      center,
      x_size_mm: size ? size.x_size_mm : null,
      y_size_mm: size ? size.y_size_mm : null,
      bounds: size ? boundsAroundCenter(center, size.x_size_mm, size.y_size_mm) : null,
      component: nearest ? nearest.component.designator : '',
      component_source_record: nearest ? nearest.component.source_record : null,
      component_distance_mm: nearest ? Number(nearest.distance_mm.toFixed(3)) : null,
      source_record: index,
      parser_note: center ? 'center decoded from Pads6 binary record' : 'center not decoded yet'
    });
  }
  return pads;
}

function extractComponentBodies(records, components, streamName) {
  return records.map((record, index) => {
    const fields = record.fields || {};
    const center = pointFromFields(fields, 'MODEL.2D.X', 'MODEL.2D.Y') ||
      pointFromFields(fields, 'TEXTURECENTERX', 'TEXTURECENTERY');
    const nearest = nearestComponentForBody(center, components);
    return {
      kind: 'component-body',
      stream: streamName,
      layer: normalizeLayer(fields.V7_LAYER || fields.LAYER || ''),
      body_kind: fields.KIND || '',
      union_index: fields.UNIONINDEX || '',
      model_id: fields.MODELID || '',
      model_name: fields['MODEL.NAME'] || fields.IDENTIFIER || '',
      model_type: fields['MODEL.MODELTYPE'] || '',
      center,
      component: nearest ? nearest.component.designator : '',
      component_source_record: nearest ? nearest.component.source_record : null,
      component_distance_mm: nearest ? Number(nearest.distance_mm.toFixed(3)) : null,
      height_mm: parseLengthUnit(fields.OVERALLHEIGHT || fields.CAVITYHEIGHT || '') || null,
      source_record: record.stream_index !== undefined ? record.stream_index : index,
      source_offset: record.offset || 0,
      parser_note: nearest ? 'component body associated by nearest component center' : 'component body center not associated with a component'
    };
  }).filter(body => body.center || body.model_name);
}

function extractBinaryRegions(streamBuffer, streamName) {
  const starts = embeddedRecordStarts(streamBuffer, 'V7_LAYER=');
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : streamBuffer.length;
    const headerEnd = printableHeaderEnd(streamBuffer, start, end);
    const fields = parseKeyValueRecord(streamBuffer.subarray(start, headerEnd).toString('latin1'));
    let tailStart = headerEnd;
    while (tailStart < end && streamBuffer[tailStart] === 0) tailStart += 1;
    const pointCount = tailStart + 4 <= end ? streamBuffer.readUInt32LE(tailStart) : 0;
    const points = [];
    if (pointCount > 0 && pointCount < 5000 && tailStart + 8 + pointCount * 16 <= end) {
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
        const offset = tailStart + 8 + pointIndex * 16;
        const x = streamBuffer.readFloatLE(offset);
        const y = streamBuffer.readFloatLE(offset + 8);
        if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 100000 && Math.abs(y) < 100000) {
          points.push({ x_raw: Number(x.toFixed(6)), y_raw: Number(y.toFixed(6)) });
        }
      }
    }
    const rawBounds = points.length > 0
      ? {
          min_x_raw: Number(Math.min(...points.map(point => point.x_raw)).toFixed(6)),
          min_y_raw: Number(Math.min(...points.map(point => point.y_raw)).toFixed(6)),
          max_x_raw: Number(Math.max(...points.map(point => point.x_raw)).toFixed(6)),
          max_y_raw: Number(Math.max(...points.map(point => point.y_raw)).toFixed(6))
        }
      : null;
    if (rawBounds) {
      rawBounds.width_raw = Number((rawBounds.max_x_raw - rawBounds.min_x_raw).toFixed(6));
      rawBounds.height_raw = Number((rawBounds.max_y_raw - rawBounds.min_y_raw).toFixed(6));
    }
    const estimatedSize = rawBounds
      ? {
          width_mm: Number((rawBounds.width_raw * 25.4).toFixed(6)),
          height_mm: Number((rawBounds.height_raw * 25.4).toFixed(6)),
          basis: 'raw-float-delta-x-25.4',
          confidence: 'experimental'
        }
      : null;
    return {
      kind: 'binary-region',
      stream: streamName,
      layer: normalizeLayer(fields.V7_LAYER || fields.LAYER || ''),
      subpoly_index: fields.SUBPOLYINDEX || '',
      union_index: fields.UNIONINDEX || '',
      shape_kind: fields.KIND || '',
      arc_resolution: fields.ARCRESOLUTION || '',
      is_shape_based: fields.ISSHAPEBASED || '',
      source_record: index,
      source_offset: start,
      binary_bytes: Math.max(0, end - tailStart),
      point_count: points.length,
      raw_bounds: rawBounds,
      estimated_size: estimatedSize,
      sample_points: points.slice(0, 8),
      coordinate_note: 'Region float points are parsed as local/raw geometry; do not treat x_raw/y_raw as board coordinates without a stream-specific transform.'
    };
  }).filter(region => region.point_count > 0);
}

function extractFallbackTextTracks(records, nets) {
  return records
    .map((record, index) => {
      const fields = record.fields || {};
      const start = pointFromFields(fields, 'X1', 'Y1') || pointFromFields(fields, 'STARTX', 'STARTY');
      const end = pointFromFields(fields, 'X2', 'Y2') || pointFromFields(fields, 'ENDX', 'ENDY');
      const center = pointFromFields(fields, 'X', 'Y') || pointFromFields(fields, 'CENTERX', 'CENTERY');
      const netIndex = fields.NET !== undefined ? Number(fields.NET) : null;
      return {
        kind: ensureString(record.record_type || fields.RECORD).toLowerCase(),
        net_index: Number.isFinite(netIndex) ? netIndex : null,
        net: Number.isFinite(netIndex) ? netNameByIndex(nets, netIndex) : (fields.NET || fields.NETNAME || ''),
        layer: normalizeLayer(fields.LAYER || ''),
        start,
        end,
        center,
        width_mm: parseLengthUnit(fields.WIDTH || fields.TRACKWIDTH || fields.SIZE) || null,
        source_record: record.stream_index !== undefined ? record.stream_index : index
      };
    })
    .filter(item => item.start || item.end || item.center);
}

function collectStreamInfo(cfb, storageNames) {
  return storageNames.map(name => {
    const dataEntry = cfb.findEntryByPath(`Root Entry/${name}/Data`);
    return {
      name,
      count: readStreamCount(cfb, name),
      data_bytes: dataEntry ? dataEntry.size : 0
    };
  });
}

function parseAltiumPcbDocBuffer(fileBuffer) {
  const cfb = buildCfb(fileBuffer);
  const paths = cfb.listPaths();
  const boardStorage = paths.find(item => item.type === 1 && /^Root Entry\/Board\d+$/i.test(item.path));
  if (!boardStorage) {
    throw new Error('Altium PcbDoc Board storage was not found');
  }

  const boardDataEntry = cfb.findEntryByPath(`${boardStorage.path}/Data`);
  if (!boardDataEntry) {
    throw new Error(`Altium PcbDoc board data stream was not found under ${boardStorage.path}`);
  }

  const fileHeaderEntry = cfb.findEntryByPath('Root Entry/FileHeader');
  const fileHeader = fileHeaderEntry
    ? cfb.readStream(fileHeaderEntry).toString('utf16le').replace(/\u0000+$/g, '')
    : '';
  const boardData = cfb.readStream(boardDataEntry);
  const boardText = decodePcbText(boardData);
  const records = splitRecords(boardText);
  const componentRecords = readTextStreamRecords(cfb, 'Components6', 'Component');
  const netRecords = readTextStreamRecords(cfb, 'Nets6', 'Net');
  const polygonRecords = readTextStreamRecords(cfb, 'Polygons6', 'Polygon');
  const regionRecords = readTextStreamRecords(cfb, 'Regions6', 'Region');
  const classRecords = readTextStreamRecords(cfb, 'Classes6', 'Class');
  const primitiveRecords = readTextStreamRecords(cfb, 'UniqueIDPrimitiveInformation', 'PrimitiveUniqueId');
  const componentBodyRecords = splitEmbeddedKeyValueRecords(readStorageData(cfb, 'ComponentBodies6'), 'V7_LAYER=', 'ComponentBody');
  const shapeBasedComponentBodyRecords = splitEmbeddedKeyValueRecords(readStorageData(cfb, 'ShapeBasedComponentBodies6'), 'V7_LAYER=', 'ShapeBasedComponentBody');
  const binaryRegions = extractBinaryRegions(readStorageData(cfb, 'Regions6'), 'Regions6');
  const outlines = extractOutline(records);
  const allOutlinePoints = outlines.flatMap(outline => outline.points || []);
  const texts = extractTextsFromBinary(
    readStorageData(cfb, 'Texts6'),
    readStreamCount(cfb, 'Texts6')
  );
  const components = attachTextLabelsToComponents(extractComponents(componentRecords, classRecords), texts);
  const nets = extractNetsFromRecords(netRecords);
  const tracks = extractTracksFromBinary(
    readStorageData(cfb, 'Tracks6'),
    readStreamCount(cfb, 'Tracks6'),
    nets
  );
  const vias = extractViasFromBinary(
    readStorageData(cfb, 'Vias6'),
    readStreamCount(cfb, 'Vias6'),
    nets
  );
  const arcs = extractArcsFromBinary(
    readStorageData(cfb, 'Arcs6'),
    readStreamCount(cfb, 'Arcs6'),
    nets
  );
  const pads = extractPadsFromBinary(
    readStorageData(cfb, 'Pads6'),
    readStreamCount(cfb, 'Pads6'),
    nets,
    components,
    extractPrimitiveUniqueIds(primitiveRecords, 'Pad')
  );
  const componentBodies = [
    ...extractComponentBodies(componentBodyRecords, components, 'ComponentBodies6'),
    ...extractComponentBodies(shapeBasedComponentBodyRecords, components, 'ShapeBasedComponentBodies6')
  ];
  const allBinaryRegions = binaryRegions;
  const polygons = extractPolygons([...polygonRecords, ...regionRecords], nets);
  const layerStack = extractLayerStack(records);
  const recordCounts = {};
    [...records, ...componentRecords, ...netRecords, ...polygonRecords, ...regionRecords, ...classRecords, ...primitiveRecords, ...componentBodyRecords, ...shapeBasedComponentBodyRecords].forEach(record => {
    const key = record.record_type || 'Unknown';
    recordCounts[key] = (recordCounts[key] || 0) + 1;
  });

  return {
    parser_mode: 'altium-pcbdoc-cfb-multistream',
    format: 'altium-pcbdoc',
    file_header: fileHeader,
    cfb: {
      streams: paths.filter(item => item.type === 2).map(item => ({
        path: item.path,
        size: item.size
      })),
      board_storage: boardStorage.path,
      board_data_stream: `${boardStorage.path}/Data`,
      board_data_bytes: boardData.length,
      parsed_storages: collectStreamInfo(cfb, [
        'Board6',
        'Components6',
        'Nets6',
        'Pads6',
        'Tracks6',
        'Vias6',
        'Arcs6',
        'Polygons6',
        'Regions6',
        'Texts6',
        'Classes6',
        'UniqueIDPrimitiveInformation',
        'ComponentBodies6',
        'ShapeBasedComponentBodies6',
        'ShapeBasedRegions6'
      ])
    },
    metadata: {
      kind: records[0] && records[0].fields ? records[0].fields.KIND || '' : '',
      version: records[0] && records[0].fields ? records[0].fields.VERSION || '' : '',
      date: records[0] && records[0].fields ? records[0].fields.DATE || '' : '',
      time: records[0] && records[0].fields ? records[0].fields.TIME || '' : ''
    },
    board: {
      bounds: boundsFromPoints(allOutlinePoints),
      outlines
    },
    layer_stack: layerStack,
    components,
    pads,
    component_bodies: componentBodies,
    binary_regions: allBinaryRegions,
    texts,
    tracks,
    vias,
    arcs,
    polygons,
    nets,
    objects: [...records, ...componentRecords, ...netRecords, ...polygonRecords, ...regionRecords, ...classRecords, ...primitiveRecords, ...componentBodyRecords, ...shapeBasedComponentBodyRecords].map((record, index) => ({
      index,
      record_type: record.record_type,
      offset: record.offset,
      length: record.length || 0,
      field_count: Object.keys(record.fields || {}).length,
      fields: record.fields
    })),
    coverage: {
      records: records.length + componentRecords.length + netRecords.length + polygonRecords.length + regionRecords.length + classRecords.length + primitiveRecords.length + texts.length,
      record_counts: recordCounts,
      outlines: outlines.length,
      components: components.length,
      pads: pads.length,
      component_bodies: componentBodies.length,
      binary_regions: allBinaryRegions.length,
      texts: texts.length,
      tracks: tracks.length,
      vias: vias.length,
      arcs: arcs.length,
      polygons: polygons.length,
      nets: nets.length,
      layer_stack: layerStack.length
    }
  };
}

module.exports = {
  buildCfb,
  parseAltiumPcbDocBuffer,
  parseLengthUnit,
  splitLengthPrefixedRecords,
  splitRecords
};
