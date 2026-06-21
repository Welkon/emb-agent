use std::collections::HashMap;

// === OLE Compound File Binary (CFB) Parser ===

const CFB_SIGNATURE: [u8; 8] = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const CFB_FREE: u32 = 0xFFFF_FFFF;
const CFB_END_OF_CHAIN: u32 = 0xFFFF_FFFE;

pub struct CfbHeader {
    pub sector_shift: u16,
    pub mini_sector_shift: u16,
    pub num_dir_sectors: u32,
    pub num_fat_sectors: u32,
    pub first_dir_sector: u32,
    pub mini_stream_cutoff: u32,
    pub first_mini_fat_sector: u32,
    pub num_mini_fat_sectors: u32,
    pub first_difat_sector: u32,
    pub num_difat_sectors: u32,
    pub sector_size: u32,
    pub mini_sector_size: u32,
}

fn read_u16le(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

fn read_u32le(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

fn read_u64le(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
    ])
}

pub fn parse_cfb_header(data: &[u8]) -> Result<CfbHeader, String> {
    if data.len() < 512 {
        return Err("File too small for CFB header".to_string());
    }
    if data[0..8] != CFB_SIGNATURE {
        return Err("Not a valid OLE compound file".to_string());
    }

    let sector_shift = read_u16le(data, 30);
    let mini_sector_shift = read_u16le(data, 32);
    let sector_size = 1u32 << sector_shift;
    let mini_sector_size = 1u32 << mini_sector_shift;

    Ok(CfbHeader {
        sector_shift,
        mini_sector_shift,
        num_dir_sectors: read_u32le(data, 40),
        num_fat_sectors: read_u32le(data, 44),
        first_dir_sector: read_u32le(data, 48),
        mini_stream_cutoff: read_u32le(data, 56),
        first_mini_fat_sector: read_u32le(data, 60),
        num_mini_fat_sectors: read_u32le(data, 64),
        first_difat_sector: read_u32le(data, 68),
        num_difat_sectors: read_u32le(data, 72),
        sector_size,
        mini_sector_size,
    })
}

fn read_sector(data: &[u8], sector_size: u32, sector_index: u32) -> Vec<u8> {
    let offset = (sector_index as usize + 1) * sector_size as usize;
    let end = offset + sector_size as usize;
    if end > data.len() {
        return vec![];
    }
    data[offset..end].to_vec()
}

fn collect_difat_sectors(data: &[u8], header: &CfbHeader) -> Vec<u32> {
    let mut difat = Vec::new();

    // First 109 DIFAT entries from header
    for i in 0..109 {
        let sector_id = read_u32le(data, 76 + i * 4);
        if sector_id != CFB_FREE {
            difat.push(sector_id);
        }
    }

    // Additional DIFAT sectors
    let mut next = header.first_difat_sector;
    let mut remaining = header.num_difat_sectors as usize;
    let max_per = (header.sector_size / 4 - 1) as usize;

    while remaining > 0 && next != CFB_END_OF_CHAIN && next != CFB_FREE {
        let sector = read_sector(data, header.sector_size, next);
        for i in 0..max_per {
            let sector_id = read_u32le(&sector, i * 4);
            if sector_id != CFB_FREE {
                difat.push(sector_id);
            }
        }
        next = read_u32le(&sector, header.sector_size as usize - 4);
        remaining = remaining.saturating_sub(1);
    }

    difat.truncate(header.num_fat_sectors as usize);
    difat
}

fn build_fat(data: &[u8], header: &CfbHeader) -> Vec<u32> {
    let fat_sectors = collect_difat_sectors(data, header);
    let mut entries = Vec::new();

    for sector_id in &fat_sectors {
        let sector = read_sector(data, header.sector_size, *sector_id);
        for i in (0..sector.len()).step_by(4) {
            entries.push(read_u32le(&sector, i));
        }
    }

    entries
}

fn read_chain(
    data: &[u8],
    sector_size: u32,
    fat: &[u32],
    start_sector: u32,
    max_size: usize,
) -> Vec<u8> {
    if start_sector == CFB_END_OF_CHAIN || start_sector == CFB_FREE {
        return vec![];
    }

    let mut seen = HashSet::new();
    let mut chunks = Vec::new();
    let mut current = start_sector;

    while current != CFB_END_OF_CHAIN && current != CFB_FREE {
        if seen.contains(&current) {
            break; // loop detected
        }
        if current as usize >= fat.len() {
            break;
        }
        seen.insert(current);
        chunks.push(read_sector(data, sector_size, current));
        current = fat[current as usize];
    }

    let result: Vec<u8> = chunks.into_iter().flatten().collect();
    if result.len() > max_size {
        result[..max_size].to_vec()
    } else {
        result
    }
}

#[derive(Debug)]
pub struct CfbDirectoryEntry {
    pub name: String,
    pub entry_type: u8, // 1=storage, 2=stream, 5=root
    pub starting_sector: u32,
    pub size: u64,
}

fn decode_utf16le(data: &[u8]) -> String {
    let mut chars = Vec::new();
    for chunk in data.chunks_exact(2) {
        let code = u16::from_le_bytes([chunk[0], chunk[1]]);
        if code == 0 {
            break;
        }
        if let Some(c) = char::from_u32(code as u32) {
            chars.push(c);
        }
    }
    chars.into_iter().collect()
}

fn parse_directory_entries(data: &[u8], header: &CfbHeader, fat: &[u32]) -> Vec<CfbDirectoryEntry> {
    let max_dir_size = if header.num_dir_sectors > 0 {
        (header.num_dir_sectors * header.sector_size) as usize
    } else {
        usize::MAX
    };
    let dir_data = read_chain(
        data,
        header.sector_size,
        fat,
        header.first_dir_sector,
        max_dir_size,
    );
    let mut entries = Vec::new();

    for offset in (0..dir_data.len()).step_by(128) {
        if offset + 128 > dir_data.len() {
            break;
        }
        let name_len = read_u16le(&dir_data, offset + 64) as usize;
        if name_len < 2 {
            continue;
        }
        let name = decode_utf16le(&dir_data[offset..offset + name_len - 2]);
        let entry_type = dir_data[offset + 66];
        let starting_sector = read_u32le(&dir_data, offset + 116);
        let size = read_u64le(&dir_data, offset + 120);

        entries.push(CfbDirectoryEntry {
            name,
            entry_type,
            starting_sector,
            size,
        });
    }

    entries
}

fn read_mini_fat(data: &[u8], header: &CfbHeader, fat: &[u32]) -> Vec<u32> {
    if header.num_mini_fat_sectors == 0
        || header.first_mini_fat_sector == CFB_END_OF_CHAIN
        || header.first_mini_fat_sector == CFB_FREE
    {
        return vec![];
    }

    let mini_fat_data = read_chain(
        data,
        header.sector_size,
        fat,
        header.first_mini_fat_sector,
        (header.num_mini_fat_sectors * header.sector_size) as usize,
    );
    let mut entries = Vec::new();

    for i in (0..mini_fat_data.len()).step_by(4) {
        entries.push(read_u32le(&mini_fat_data, i));
    }

    entries
}

fn read_mini_stream(
    data: &[u8],
    entry: &CfbDirectoryEntry,
    root: &CfbDirectoryEntry,
    header: &CfbHeader,
    fat: &[u32],
    mini_fat: &[u32],
) -> Vec<u8> {
    let root_stream = read_chain(
        data,
        header.sector_size,
        fat,
        root.starting_sector,
        root.size as usize,
    );

    let mut seen = HashSet::new();
    let mut chunks = Vec::new();
    let mut current = entry.starting_sector;

    while current != CFB_END_OF_CHAIN && current != CFB_FREE {
        if seen.contains(&current) {
            break;
        }
        if current as usize >= mini_fat.len() {
            break;
        }
        seen.insert(current);
        let start = current as usize * header.mini_sector_size as usize;
        let end = start + header.mini_sector_size as usize;
        if end <= root_stream.len() {
            chunks.push(root_stream[start..end].to_vec());
        }
        current = mini_fat[current as usize];
    }

    let result: Vec<u8> = chunks.into_iter().flatten().collect();
    if result.len() > entry.size as usize {
        result[..entry.size as usize].to_vec()
    } else {
        result
    }
}

pub fn read_named_stream(data: &[u8], stream_name: &str) -> Result<Vec<u8>, String> {
    let header = parse_cfb_header(data)?;
    let fat = build_fat(data, &header);
    let dir_entries = parse_directory_entries(data, &header, &fat);
    let root = dir_entries
        .iter()
        .find(|e| e.entry_type == 5)
        .ok_or("CFB root entry not found")?;
    let entry = dir_entries
        .iter()
        .find(|e| e.entry_type == 2 && e.name == stream_name)
        .ok_or(format!("CFB stream not found: {stream_name}"))?;

    if entry.size < header.mini_stream_cutoff as u64 {
        let mini_fat = read_mini_fat(data, &header, &fat);
        Ok(read_mini_stream(
            data, entry, root, &header, &fat, &mini_fat,
        ))
    } else {
        Ok(read_chain(
            data,
            header.sector_size,
            &fat,
            entry.starting_sector,
            entry.size as usize,
        ))
    }
}

// === Altium SchDoc Record Parser ===

use std::collections::HashSet;

/// Split a CFB stream into SchDoc records (delimited by 00 00 7c)
fn split_record_lines(stream: &[u8]) -> Vec<Vec<u8>> {
    let payload = if stream.len() > 5 {
        &stream[5..stream.len().saturating_sub(1)]
    } else {
        return vec![];
    };
    let mut lines = Vec::new();
    let mut start = 0;

    let mut i = 0;
    while i + 6 <= payload.len() {
        if payload[i + 3] == 0x00 && payload[i + 4] == 0x00 && payload[i + 5] == 0x7c {
            lines.push(payload[start..i].to_vec());
            start = i + 6;
            i += 5;
        }
        i += 1;
    }

    if start < payload.len() {
        lines.push(payload[start..].to_vec());
    }

    lines.into_iter().filter(|l| !l.is_empty()).collect()
}

/// Decode one record line: pairs separated by 0x7c, each pair key=value
fn decode_record(line: &[u8]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let parts: Vec<&[u8]> = line.split(|b| *b == 0x7c).collect();

    for part in parts {
        if let Some(sep_pos) = part.iter().position(|b| *b == 0x3d) {
            if sep_pos == 0 {
                continue;
            }
            let key = String::from_utf8_lossy(&part[..sep_pos]).to_string();
            let value = String::from_utf8_lossy(&part[sep_pos + 1..])
                .trim_end_matches('\0')
                .to_string();
            if !key.is_empty() {
                map.insert(key, value);
            }
        }
    }

    map
}

#[derive(Debug, Clone)]
pub struct SchDocRecord {
    pub index: usize,
    pub record_type: String,
    pub fields: HashMap<String, String>,
}

pub fn parse_schdoc_records(data: &[u8]) -> Result<Vec<SchDocRecord>, String> {
    let file_header = read_named_stream(data, "FileHeader")?;
    let lines = split_record_lines(&file_header);
    let mut records = Vec::new();

    for line in lines.iter() {
        let fields = decode_record(line);
        if let Some(rec_type) = fields.get("RECORD").cloned() {
            let idx = records.len();
            records.push(SchDocRecord {
                index: idx,
                record_type: rec_type,
                fields,
            });
        }
    }

    Ok(records)
}

fn get_field(record: &SchDocRecord, names: &[&str]) -> String {
    for name in names {
        if let Some(v) = record.fields.get(*name) {
            return v.clone();
        }
    }
    String::new()
}

fn get_owner_key(record: &SchDocRecord) -> String {
    get_field(record, &["OwnerIndex", "OWNERINDEX"])
}

fn visible_text(record: &SchDocRecord) -> String {
    get_field(record, &["%UTF8%Text", "Text", "TEXT"])
}

/// Extract component info from part records (RECORD=1)
#[derive(Debug, Clone)]
pub struct ExtractedComponent {
    pub designator: String,
    pub value: String,
    pub comment: String,
    pub libref: String,
    pub footprint: String,
    pub package: String,
    pub datasheet: String,
    pub parameters: HashMap<String, String>,
    pub raw_part_index: usize,
    pub pin_count: usize,
}

fn find_named_text(records: &[&SchDocRecord], target: &str) -> String {
    let lower = target.to_lowercase();
    for r in records {
        let name = get_field(r, &["Name", "NAME"]).to_lowercase();
        let rec_type = &r.record_type;
        if (rec_type == "41" || rec_type == "34") && name == lower {
            return visible_text(r);
        }
    }
    String::new()
}

pub fn extract_components(records: &[SchDocRecord]) -> Vec<ExtractedComponent> {
    // Group records by owner
    let mut by_owner: HashMap<String, Vec<usize>> = HashMap::new();
    for r in records {
        let owner = get_owner_key(r);
        if !owner.is_empty() {
            by_owner.entry(owner).or_default().push(r.index);
        }
    }

    let mut components = Vec::new();

    for r in records.iter().filter(|r| r.record_type == "1") {
        let owner_key = r.index.to_string();
        let related: Vec<&SchDocRecord> = by_owner
            .get(&owner_key)
            .map(|indices| indices.iter().filter_map(|&i| records.get(i)).collect())
            .unwrap_or_default();

        let designator = find_named_text(&related, "Designator");
        if designator.is_empty() {
            continue;
        }

        let footprint = find_named_text(&related, "Footprint");
        let comment = find_named_text(&related, "Comment");
        let desc = get_field(r, &["%UTF8%ComponentDescription", "ComponentDescription"]);
        let comment = if comment.is_empty() { desc } else { comment };

        let raw_value = get_field(r, &["DesignItemId", "LibReference"]);
        let libref = get_field(r, &["LibReference"]);
        let prefer_comment = is_footprint_like(&raw_value) && has_alpha(&comment);
        let value = if prefer_comment {
            comment.clone()
        } else {
            raw_value
        };

        let datasheet = find_named_text(&related, "Datasheet");

        let mut parameters = HashMap::new();
        for rel in &related {
            let name = get_field(rel, &["Name", "NAME"]);
            let text = visible_text(rel);
            if !name.is_empty()
                && !text.is_empty()
                && name != "Designator"
                && name != "Comment"
                && name != "Value"
                && name != "Footprint"
                && name != "Datasheet"
            {
                parameters.insert(name, text);
            }
        }

        let pin_count = related.iter().filter(|r| r.record_type == "2").count();

        components.push(ExtractedComponent {
            designator,
            value,
            comment,
            libref,
            footprint: footprint.clone(),
            package: footprint,
            datasheet,
            parameters,
            raw_part_index: r.index,
            pin_count,
        });
    }

    components
}

fn is_footprint_like(value: &str) -> bool {
    let v = value.to_lowercase();
    v.starts_with("sop-")
        || v.starts_with("soic-")
        || v.starts_with("qfn-")
        || v.starts_with("ssop-")
        || v.starts_with("tssop-")
        || v.starts_with("dip-")
        || v.starts_with("qfp-")
        || v == "r"
        || v == "c"
        || v == "d"
        || v == "led"
        || v == "testpoint"
}

fn has_alpha(s: &str) -> bool {
    s.chars().any(|c| c.is_alphabetic())
}

// === Net Extraction from geometric connectivity ===

#[derive(Debug, Clone)]
pub struct ExtractedNet {
    pub name: String,
    pub members: Vec<String>,
    pub evidence_count: usize,
    pub confidence: String,
}

/// Build nets by geometric connectivity analysis of SchDoc records
fn build_nets(records: &[SchDocRecord], components: &[ExtractedComponent]) -> Vec<ExtractedNet> {
    use std::collections::HashMap;

    // Build device records from wire/pin/junction/port/netlabel records
    #[derive(Debug, Clone)]
    struct Device {
        record_type: String,
        coords: Vec<(f64, f64)>,
        text: String,
        component_designator: String,
        pin_number: String,
        pin_name: String,
    }

    // Build component map for lookup
    let mut part_map: HashMap<String, &ExtractedComponent> = HashMap::new();
    for c in components {
        part_map.insert(c.raw_part_index.to_string(), c);
    }

    fn get_owner(record: &SchDocRecord) -> String {
        record
            .fields
            .get("OwnerIndex")
            .or(record.fields.get("OWNERINDEX"))
            .cloned()
            .unwrap_or_default()
    }

    fn parse_int(fields: &HashMap<String, String>, key: &str) -> i32 {
        fields.get(key).and_then(|v| v.parse().ok()).unwrap_or(0)
    }

    let mut devices: Vec<Device> = Vec::new();

    for r in records {
        match r.record_type.as_str() {
            // Pin (RECORD=2)
            "2" => {
                let rotation = (parse_int(&r.fields, "PinConglomerate") & 0x03) * 90;
                let pin_length = parse_int(&r.fields, "PinLength");
                let lx = r
                    .fields
                    .get("Location.X")
                    .and_then(|v| v.parse::<f64>().ok())
                    .unwrap_or(0.0);
                let ly = r
                    .fields
                    .get("Location.Y")
                    .and_then(|v| v.parse::<f64>().ok())
                    .unwrap_or(0.0);
                let (dx, dy) = match rotation {
                    0 => (1.0, 0.0),
                    90 => (0.0, 1.0),
                    180 => (-1.0, 0.0),
                    270 => (0.0, -1.0),
                    _ => (0.0, 0.0),
                };
                let owner = get_owner(r);
                let comp = part_map.get(&owner);
                let des = r.fields.get("Designator").cloned().unwrap_or_default();
                let pname = r.fields.get("Name").cloned().unwrap_or_default();
                devices.push(Device {
                    record_type: "2".to_string(),
                    coords: vec![(lx + dx * pin_length as f64, ly + dy * pin_length as f64)],
                    text: String::new(),
                    component_designator: comp.map(|c| c.designator.clone()).unwrap_or_default(),
                    pin_number: des.clone(),
                    pin_name: pname.clone(),
                });
            }
            // Wire (RECORD=27)
            "27" => {
                let count = parse_int(&r.fields, "LocationCount");
                let mut coords = Vec::new();
                for i in 1..=count {
                    let x = r
                        .fields
                        .get(&format!("X{i}"))
                        .and_then(|v| v.parse::<f64>().ok())
                        .unwrap_or(0.0);
                    let y = r
                        .fields
                        .get(&format!("Y{i}"))
                        .and_then(|v| v.parse::<f64>().ok())
                        .unwrap_or(0.0);
                    if x != 0.0 || y != 0.0 {
                        coords.push((x, y));
                    }
                }
                devices.push(Device {
                    record_type: "27".to_string(),
                    coords,
                    text: String::new(),
                    component_designator: String::new(),
                    pin_number: String::new(),
                    pin_name: String::new(),
                });
            }
            // Power port (RECORD=17), Port (RECORD=18), Net label (RECORD=25), Junction (RECORD=29)
            "17" | "18" | "25" | "29" => {
                let lx = r
                    .fields
                    .get("Location.X")
                    .and_then(|v| v.parse::<f64>().ok())
                    .unwrap_or(0.0);
                let ly = r
                    .fields
                    .get("Location.Y")
                    .and_then(|v| v.parse::<f64>().ok())
                    .unwrap_or(0.0);
                let text = r
                    .fields
                    .get("%UTF8%Text")
                    .or(r.fields.get("Text"))
                    .or(r.fields.get("TEXT"))
                    .cloned()
                    .unwrap_or_default();
                devices.push(Device {
                    record_type: r.record_type.clone(),
                    coords: vec![(lx, ly)],
                    text,
                    component_designator: String::new(),
                    pin_number: String::new(),
                    pin_name: String::new(),
                });
            }
            _ => {}
        }
    }

    // Check if two points are within tolerance
    fn points_close(a: (f64, f64), b: (f64, f64)) -> bool {
        let dx = a.0 - b.0;
        let dy = a.1 - b.1;
        (dx * dx + dy * dy).sqrt() < 5.0
    }

    // Check if two devices are connected
    fn devices_connected(a: &Device, b: &Device) -> bool {
        // Same-text ports/power-ports/net-labels connect
        if !a.text.is_empty()
            && !b.text.is_empty()
            && a.text == b.text
            && matches!(a.record_type.as_str(), "17" | "18" | "25")
            && matches!(b.record_type.as_str(), "17" | "18" | "25")
        {
            return true;
        }

        // Geometric connection: any point of A touches any point of B
        for pa in &a.coords {
            for pb in &b.coords {
                if points_close(*pa, *pb) {
                    return true;
                }
            }
        }

        false
    }

    // Build connected components (nets) via BFS
    let mut visited = HashSet::new();
    let mut nets: Vec<ExtractedNet> = Vec::new();

    for dev_idx in 0..devices.len() {
        if visited.contains(&dev_idx) {
            continue;
        }

        let mut stack = vec![dev_idx];
        let mut group = Vec::new();

        while let Some(current) = stack.pop() {
            if visited.contains(&current) {
                continue;
            }
            visited.insert(current);
            group.push(&devices[current]);

            for (j, candidate) in devices.iter().enumerate() {
                if !visited.contains(&j) && devices_connected(&devices[current], candidate) {
                    stack.push(j);
                }
            }
        }

        // Find a named device in the group
        let named = group
            .iter()
            .find(|d| matches!(d.record_type.as_str(), "17" | "18" | "25") && !d.text.is_empty());
        let net_name = named
            .map(|d| d.text.clone())
            .unwrap_or_else(|| format!("UNNAMED_NET_{}", nets.len() + 1));

        // Collect pin members
        let mut members = Vec::new();
        for d in &group {
            if d.record_type == "2" && !d.component_designator.is_empty() {
                let pin_id = if !d.pin_number.is_empty() {
                    &d.pin_number
                } else {
                    &d.pin_name
                };
                if !pin_id.is_empty() {
                    members.push(format!("{}.{}", d.component_designator, pin_id));
                }
            }
        }
        members.sort();
        members.dedup();

        let confidence = if net_name.starts_with("UNNAMED_NET_") {
            "heuristic-unnamed"
        } else {
            "heuristic-named"
        };

        nets.push(ExtractedNet {
            name: net_name,
            members,
            evidence_count: group.len(),
            confidence: confidence.to_string(),
        });
    }

    nets
}

// === SchDoc binary entry point ===

/// Parse an Altium SchDoc binary file, returning extracted components and nets
pub fn parse_schdoc_buffer_full(
    data: &[u8],
) -> Result<(Vec<ExtractedComponent>, Vec<ExtractedNet>), String> {
    let records = parse_schdoc_records(data)?;
    let components = extract_components(&records);
    let nets = build_nets(&records, &components);
    Ok((components, nets))
}

pub type SchDocParseWithRecords = (
    Vec<ExtractedComponent>,
    Vec<ExtractedNet>,
    Vec<SchDocRecord>,
);

/// Parse an Altium SchDoc binary file, returning extracted components, nets, and raw records.
pub fn parse_schdoc_buffer_full_with_records(
    data: &[u8],
) -> Result<SchDocParseWithRecords, String> {
    let records = parse_schdoc_records(data)?;
    let components = extract_components(&records);
    let nets = build_nets(&records, &components);
    Ok((components, nets, records))
}

/// Parse an Altium SchDoc binary file, returning extracted components only
pub fn parse_schdoc_buffer(data: &[u8]) -> Result<Vec<ExtractedComponent>, String> {
    let records = parse_schdoc_records(data)?;
    Ok(extract_components(&records))
}
