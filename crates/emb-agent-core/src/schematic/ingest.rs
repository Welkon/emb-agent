use crate::schematic::{ParsedSchematic, SchematicComponent};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Visual netlist analysis result
#[derive(Debug, Clone, Serialize)]
pub struct VisualNetlistAnalysis {
    pub version: u32,
    pub status: String,
    pub source_paths: Vec<String>,
    pub page_count: usize,
    pub pages: Vec<VisualNetlistPage>,
    pub graph: VisualNetlistGraph,
    pub nets: Vec<NetDetail>,
    pub cross_sheet_nets: Vec<CrossSheetNet>,
    pub dangling_nets: Vec<DanglingNet>,
    pub signal_candidates: Vec<SignalCandidate>,
    pub review_focus: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VisualNetlistPage {
    pub id: String,
    pub source_path: String,
    pub parser_mode: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct VisualNetlistGraph {
    pub components: usize,
    pub nets: usize,
    pub named_nets: usize,
    pub unnamed_nets: usize,
    pub cross_sheet_nets: usize,
    pub dangling_nets: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct NetDetail {
    pub name: String,
    pub members: Vec<String>,
    pub sheets: Vec<String>,
    pub source_paths: Vec<String>,
    pub confidence: String,
    pub evidence_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct CrossSheetNet {
    pub name: String,
    pub sheets: Vec<String>,
    pub source_paths: Vec<String>,
    pub members: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DanglingNet {
    pub name: String,
    pub members: Vec<String>,
    pub sheets: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SignalCandidate {
    pub name: String,
    pub members: Vec<String>,
    pub sheets: Vec<String>,
}

/// MCU candidate from component scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McuCandidate {
    pub designator: String,
    pub value: String,
    pub comment: String,
    pub libref: String,
    pub footprint: String,
    pub pin_count: usize,
    pub score: i32,
    pub vendor_guess: String,
    pub reasons: Vec<String>,
    pub datasheet: String,
}

fn ensure_string(value: &str) -> String {
    value.trim().to_string()
}

fn is_power_net_name(name: &str) -> bool {
    let n = name.trim().to_lowercase();
    matches!(
        n.as_str(),
        "gnd"
            | "ground"
            | "agnd"
            | "dgnd"
            | "vss"
            | "vdd"
            | "vcc"
            | "vin"
            | "vbat"
            | "bat+"
            | "3v3"
            | "3.3v"
            | "5v"
            | "12v"
            | "24v"
    ) || n.starts_with("bat")
        || (n.ends_with('v')
            && n.len() <= 6
            && n.chars()
                .all(|c| c.is_ascii_digit() || c == '.' || c == 'v'))
}

fn is_unnamed_net(name: &str) -> bool {
    let n = ensure_string(name);
    n.to_uppercase().starts_with("UNNAMED_NET_") || n.contains(":UNNAMED_NET_")
}

/// Build visual netlist analysis from parsed schematic data
pub fn build_visual_netlist_analysis(
    source_paths: &[String],
    parsed: &ParsedSchematic,
) -> VisualNetlistAnalysis {
    let components = &parsed.components;
    let nets = &parsed.nets;
    let sheets = &parsed.sheets;

    let named_nets: Vec<_> = nets
        .iter()
        .filter(|net| {
            let name = ensure_string(&net.name);
            !name.is_empty() && !is_unnamed_net(&name) && !name.contains(":UNNAMED_NET_")
        })
        .collect();

    let cross_sheet_nets: Vec<_> = named_nets
        .iter()
        .filter(|net| net.sheets.len() > 1 || net.source_paths.len() > 1)
        .map(|net| CrossSheetNet {
            name: ensure_string(&net.name),
            sheets: net.sheets.clone(),
            source_paths: net.source_paths.clone(),
            members: net.members.clone(),
        })
        .collect();

    let dangling_nets: Vec<_> = nets
        .iter()
        .filter(|net| net.members.len() <= 1)
        .take(50)
        .map(|net| DanglingNet {
            name: ensure_string(&net.name),
            members: net.members.clone(),
            sheets: net.sheets.clone(),
        })
        .collect();

    let signal_keywords = [
        "ir", "uart", "rx", "tx", "pwm", "key", "sda", "scl", "spi", "mosi", "miso", "clk", "rst",
        "reset", "adc", "dac", "i2c", "swclk", "swdio", "int", "en",
    ];

    let signal_candidates: Vec<_> = named_nets
        .iter()
        .filter(|net| {
            let name = ensure_string(&net.name).to_lowercase();
            !is_power_net_name(&name) && signal_keywords.iter().any(|kw| name.contains(kw))
        })
        .take(32)
        .map(|net| SignalCandidate {
            name: ensure_string(&net.name),
            members: net.members.iter().take(12).cloned().collect(),
            sheets: net.sheets.clone(),
        })
        .collect();

    let net_details: Vec<_> = nets
        .iter()
        .take(100)
        .map(|net| NetDetail {
            name: ensure_string(&net.name),
            members: net.members.clone(),
            sheets: net.sheets.clone(),
            source_paths: net.source_paths.clone(),
            confidence: ensure_string(&net.confidence),
            evidence_count: net.evidence.len(),
        })
        .collect();

    let page_count = sheets.len().max(source_paths.len());

    let pages: Vec<_> = if !sheets.is_empty() {
        sheets
            .iter()
            .enumerate()
            .map(|(i, sheet)| {
                let id = sheet
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let id = if id.is_empty() {
                    format!("sheet-{}", i + 1)
                } else {
                    id
                };
                let source = sheet
                    .get("source_path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let parser = sheet
                    .get("parser_mode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                VisualNetlistPage {
                    id,
                    source_path: source,
                    parser_mode: parser,
                }
            })
            .collect()
    } else {
        source_paths
            .iter()
            .enumerate()
            .map(|(i, sp)| VisualNetlistPage {
                id: format!("sheet-{}", i + 1),
                source_path: sp.clone(),
                parser_mode: String::new(),
            })
            .collect()
    };

    let unnamed_count = nets
        .iter()
        .filter(|net| {
            let name = ensure_string(&net.name);
            is_unnamed_net(&name) || name.contains(":UNNAMED_NET_")
        })
        .count();

    VisualNetlistAnalysis {
        version: 1,
        status: "analysis-only".to_string(),
        source_paths: source_paths.to_vec(),
        page_count,
        pages,
        graph: VisualNetlistGraph {
            components: components.len(),
            nets: nets.len(),
            named_nets: named_nets.len(),
            unnamed_nets: unnamed_count,
            cross_sheet_nets: cross_sheet_nets.len(),
            dangling_nets: dangling_nets.len(),
        },
        nets: net_details,
        cross_sheet_nets,
        dangling_nets,
        signal_candidates,
        review_focus: vec![
            "Confirm whether same-name nets are intended to be global across sheets.",
            "Review dangling and unnamed nets before deriving pin roles.",
            "Use datasheets or MCU manuals before promoting schematic-derived signal roles into hw.yaml.",
        ],
    }
}

// === MCU Candidate Identification ===

const MCU_PATTERNS: &[(&str, &str)] = &[
    ("esp32", "espressif"),
    ("esp8266", "espressif"),
    ("stm32", "stmicro"),
    ("stm8", "stmicro"),
    ("nrf51", "nordic"),
    ("nrf52", "nordic"),
    ("nrf53", "nordic"),
    ("nrf54", "nordic"),
    ("nrf91", "nordic"),
    ("atmega", "microchip"),
    ("attiny", "microchip"),
    ("atsam", "microchip"),
    ("at89", "microchip"),
    ("pic12", "microchip"),
    ("pic16", "microchip"),
    ("pic18", "microchip"),
    ("pic24", "microchip"),
    ("pic32", "microchip"),
    ("msp430", "ti"),
    ("cc13", "ti"),
    ("cc25", "ti"),
    ("cc26", "ti"),
    ("cc32", "ti"),
    ("tm4c", "ti"),
    ("lpc", "nxp"),
    ("mk", "nxp"),
    ("gd32", "gigadevice"),
    ("ch32", "wch"),
    ("ch55", "wch"),
    ("ch57", "wch"),
    ("ch58", "wch"),
    ("hc32", "hdsc"),
    ("mm32", "mindmotion"),
    ("bl60", "bouffalo"),
    ("bl61", "bouffalo"),
    ("bl70", "bouffalo"),
    ("rp2040", "raspberrypi"),
    ("rp2350", "raspberrypi"),
    ("f1c", "allwinner"),
    ("ca51", "cachip"),
];

const MCU_PACKAGE_PATTERNS: &[&str] = &[
    "qfp", "tqfp", "vqfp", "htqfp", "qfn", "dqfn", "vqfn", "uqfn", "hvqfn", "bga", "fbga", "lga",
    "wlcsp", "sop-", "ssop-", "tssop-", "soic-",
];

fn is_ic_designator(designator: &str) -> bool {
    let d = designator.trim();
    d.starts_with('U') && d[1..].chars().all(|c| c.is_ascii_digit()) || d.starts_with("IC")
}

fn is_passive_designator(designator: &str) -> bool {
    let d = designator.trim();
    let first = d.chars().next().unwrap_or(' ');
    let rest: String = d.chars().skip(1).collect();
    let numeric_suffix = rest.chars().all(|c| c.is_ascii_digit());

    matches!(first, 'R' | 'C' | 'L' | 'J' | 'P' | 'X' | 'Y' | 'F') && numeric_suffix
        || d.starts_with("TP")
        || d.starts_with("CN")
        || d.starts_with("USB")
}

fn is_mcu_package(footprint: &str) -> bool {
    let f = footprint.to_lowercase();
    MCU_PACKAGE_PATTERNS.iter().any(|p| f.contains(p))
}

/// Identify MCU candidates from schematic components
pub fn identify_mcu_candidates(components: &[SchematicComponent]) -> Vec<McuCandidate> {
    let mut candidates = Vec::new();

    for c in components {
        let designator = ensure_string(&c.designator);
        let value = ensure_string(&c.value);
        let comment = ensure_string(&c.comment);
        let libref = ensure_string(&c.libref);
        let footprint = ensure_string(&c.footprint);
        let pin_count = c.pins.len();
        let datasheet = ensure_string(&c.datasheet);

        let mut score: i32 = 0;
        let mut reasons = Vec::new();
        let mut vendor_guess = String::new();

        // IC designator bonus
        if is_ic_designator(&designator) {
            score += 10;
            reasons.push("IC designator (U)".to_string());
        } else if designator.starts_with('D') || designator.starts_with('M') {
            score += 3;
            reasons.push("possible IC designator".to_string());
        }

        // Passive penalty
        if is_passive_designator(&designator) {
            score -= 20;
            reasons.push("passive/connector designator".to_string());
        }

        // Pin count scoring
        if pin_count >= 48 {
            score += 20;
            reasons.push(format!("high pin count ({pin_count})"));
        } else if pin_count >= 20 {
            score += 15;
            reasons.push(format!("medium-high pin count ({pin_count})"));
        } else if pin_count >= 8 {
            score += 8;
            reasons.push(format!("moderate pin count ({pin_count})"));
        } else if (3..=4).contains(&pin_count) {
            score -= 5;
            reasons.push("low pin count".to_string());
        } else if pin_count <= 2 {
            score -= 15;
            reasons.push("passive pin count".to_string());
        }

        // Known MCU pattern matching
        let search_text = format!("{value} {libref} {comment}").to_lowercase();
        for (pattern, vendor) in MCU_PATTERNS {
            if search_text.contains(*pattern) {
                score += 25;
                vendor_guess = vendor.to_string();
                reasons.push(format!("known MCU pattern: {vendor}"));
                break;
            }
        }

        // Package matching
        if is_mcu_package(&footprint) {
            score += 10;
            reasons.push("MCU-like package".to_string());
        }

        // MCU keyword
        if search_text.contains("mcu")
            || search_text.contains("microcontroller")
            || search_text.contains("soc")
            || search_text.contains("processor")
        {
            score += 15;
            reasons.push("MCU keyword".to_string());
        }

        // Passive-like value penalty
        if value.to_lowercase().ends_with("k")
            || value.to_lowercase().ends_with("r")
            || value.to_lowercase().ends_with("ohm")
            || value.to_lowercase().ends_with("nf")
            || value.to_lowercase().ends_with("uf")
            || value.to_lowercase().ends_with("pf")
        {
            score -= 10;
            reasons.push("passive-like value".to_string());
        }

        // Datasheet bonus
        if !datasheet.is_empty() {
            score += 5;
            reasons.push("has datasheet".to_string());
        }

        if score > 0 {
            candidates.push(McuCandidate {
                designator: designator.clone(),
                value,
                comment,
                libref,
                footprint,
                pin_count,
                score,
                vendor_guess,
                reasons,
                datasheet,
            });
        }
    }

    candidates.sort_by(|a, b| b.score.cmp(&a.score));
    candidates.truncate(5);
    candidates
}

// === Hardware Draft Generation ===

#[derive(Debug, Clone, Serialize)]
pub struct HardwareDraft {
    pub mcu: HardwareDraftMcu,
    pub signals: Vec<serde_json::Value>,
    pub peripherals: Vec<serde_json::Value>,
    pub truths: Vec<String>,
    pub constraints: Vec<String>,
    pub unknowns: Vec<String>,
    pub sources: Vec<String>,
    pub mcu_candidates: Vec<McuCandidate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HardwareDraftMcu {
    pub vendor: String,
    pub model: String,
    pub package: String,
}

/// Build hardware truth draft from parsed schematic data
pub fn build_hardware_draft(
    source_paths: &[String],
    parsed: &ParsedSchematic,
    mcu_candidates: &[McuCandidate],
) -> HardwareDraft {
    let components = &parsed.components;
    let nets = &parsed.nets;
    let source_summary = if source_paths.len() == 1 {
        source_paths[0].clone()
    } else {
        source_paths.join(", ")
    };

    let named_net_names: Vec<_> = nets
        .iter()
        .map(|n| ensure_string(&n.name))
        .filter(|n| !n.is_empty() && !is_unnamed_net(n))
        .collect();
    let named_nets_str = named_net_names.join(", ");

    let top = mcu_candidates.first();
    let top_label = top.map(|t| {
        format!(
            "Top MCU candidate: {} ({} {}, score={})",
            t.designator, t.libref, t.value, t.score
        )
    });

    let truths = [
        format!("Normalized schematic source: {source_summary}"),
        format!(
            "Normalized {} components and {} nets from the schematic input",
            components.len(),
            nets.len()
        ),
        if parsed.sheets.len() > 1 {
            format!("Multi-page schematic ingest: {} pages", parsed.sheets.len())
        } else {
            String::new()
        },
        if !named_nets_str.is_empty() {
            format!("Named nets extracted: {named_nets_str}")
        } else {
            "No named nets were extracted from the schematic input".to_string()
        },
        top_label.unwrap_or_default(),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect();

    let unknowns = [
        "Component roles, controller identity, and signal direction should be judged later by the agent from parsed.json"
            .to_string(),
        if components.is_empty() {
            "No components were normalized from the schematic input".to_string()
        } else {
            String::new()
        },
        if nets.is_empty() {
            "No nets were normalized from the schematic input".to_string()
        } else {
            String::new()
        },
        if top.is_none() {
            "No MCU candidate could be identified from the schematic components".to_string()
        } else {
            String::new()
        },
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect();

    HardwareDraft {
        mcu: HardwareDraftMcu {
            vendor: top.map(|t| t.vendor_guess.clone()).unwrap_or_default(),
            model: top
                .map(|t| {
                    if !t.libref.is_empty() {
                        t.libref.clone()
                    } else {
                        t.value.clone()
                    }
                })
                .unwrap_or_default(),
            package: top.map(|t| t.footprint.clone()).unwrap_or_default(),
        },
        signals: vec![],
        peripherals: vec![],
        truths,
        constraints: vec![],
        unknowns,
        sources: source_paths.to_vec(),
        mcu_candidates: mcu_candidates.to_vec(),
    }
}

// === Full Visual Netlist Data Structure for parsed.json ===

/// Attach visual netlist analysis to the parsed schematic
pub fn attach_visual_netlist(source_paths: &[String], parsed: &mut ParsedSchematic) {
    let analysis = build_visual_netlist_analysis(source_paths, parsed);
    parsed.visual_netlist = Some(
        serde_json::to_value(&analysis)
            .ok()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_else(|| {
                // Manual conversion if serde round-trip fails
                crate::schematic::VisualNetlist {
                    page_count: analysis.page_count,
                    graph: serde_json::to_value(&analysis.graph).unwrap_or_default(),
                    nets: serde_json::to_value(&analysis.nets)
                        .ok()
                        .and_then(|v| serde_json::from_value(v).ok())
                        .unwrap_or_default(),
                    signal_candidates: serde_json::to_value(&analysis.signal_candidates)
                        .ok()
                        .and_then(|v| serde_json::from_value(v).ok())
                        .unwrap_or_default(),
                    dangling_nets: serde_json::to_value(&analysis.dangling_nets)
                        .ok()
                        .and_then(|v| serde_json::from_value(v).ok())
                        .unwrap_or_default(),
                    cross_sheet_nets: serde_json::to_value(&analysis.cross_sheet_nets)
                        .ok()
                        .and_then(|v| serde_json::from_value(v).ok())
                        .unwrap_or_default(),
                }
            }),
    );
}

// === Multi-Format Parsers ===

use crate::schematic::{SchematicBomRow, SchematicNet, SchematicPin};
use serde_json::Value;

/// Parse Altium JSON export format
pub fn parse_altium_json(text: &str) -> Result<ParsedSchematic, String> {
    let raw: Value = serde_json::from_str(text).map_err(|e| format!("Invalid JSON: {e}"))?;

    // Recursively collect all objects from the JSON
    let mut objects = Vec::new();
    collect_json_objects(&raw, &mut objects, 0);

    let components: Vec<SchematicComponent> = objects
        .iter()
        .filter_map(normalize_component_from_json)
        .collect();

    // Deduplicate by designator
    let mut seen = HashSet::new();
    let components: Vec<_> = components
        .into_iter()
        .filter(|c| seen.insert(c.designator.to_lowercase()))
        .collect();

    let nets: Vec<SchematicNet> = objects.iter().filter_map(normalize_net_from_json).collect();

    let mut seen = HashSet::new();
    let nets: Vec<_> = nets
        .into_iter()
        .filter(|n| seen.insert(n.name.to_lowercase()))
        .collect();

    let bom = build_bom_from_components(&components);

    Ok(ParsedSchematic {
        parser_mode: "heuristic-json".to_string(),
        components,
        nets,
        objects: vec![],
        bom,
        schematic_advice: None,
        preview: None,
        visual_netlist: None,
        raw_summary: serde_json::json!({
            "object_count": objects.len(),
        }),
        sheets: vec![],
    })
}

fn collect_json_objects(value: &Value, results: &mut Vec<Value>, depth: usize) {
    if depth > 8 {
        return;
    }
    match value {
        Value::Array(arr) => {
            for item in arr {
                collect_json_objects(item, results, depth + 1);
            }
        }
        Value::Object(_) => {
            results.push(value.clone());
            if let Value::Object(map) = value {
                for v in map.values() {
                    collect_json_objects(v, results, depth + 1);
                }
            }
        }
        _ => {}
    }
}

fn json_str(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

fn normalize_component_from_json(obj: &Value) -> Option<SchematicComponent> {
    let designator = obj
        .get("designator")
        .or(obj.get("refdes"))
        .or(obj.get("ref"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if designator.is_empty() || !designator.chars().next()?.is_ascii_alphabetic() {
        return None;
    }

    let value = json_str(obj, "value");
    let comment = json_str(obj, "comment");
    let comment = if comment.is_empty() {
        json_str(obj, "description")
    } else {
        comment
    };
    let libref = json_str(obj, "libref");
    let libref = if libref.is_empty() {
        json_str(obj, "library_ref")
    } else {
        libref
    };
    let libref = if libref.is_empty() {
        json_str(obj, "symbol")
    } else {
        libref
    };
    let footprint = json_str(obj, "footprint");
    let footprint = if footprint.is_empty() {
        json_str(obj, "package")
    } else {
        footprint
    };
    let footprint = if footprint.is_empty() {
        json_str(obj, "pattern")
    } else {
        footprint
    };
    let datasheet = json_str(obj, "datasheet");
    let mfr = json_str(obj, "manufacturer");
    let mfr = if mfr.is_empty() {
        json_str(obj, "mfr")
    } else {
        mfr
    };
    let mpn = json_str(obj, "mpn");
    let mpn = if mpn.is_empty() {
        json_str(obj, "part_number")
    } else {
        mpn
    };
    let mpn = if mpn.is_empty() {
        json_str(obj, "manufacturer_part_number")
    } else {
        mpn
    };

    let parameters = obj
        .get("parameters")
        .cloned()
        .unwrap_or(Value::Object(serde_json::Map::new()));

    let pins: Vec<SchematicPin> = obj
        .get("pins")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|p| SchematicPin {
                    number: json_str(p, "number"),
                    name: json_str(p, "name"),
                    net: json_str(p, "net"),
                })
                .filter(|p| !p.number.is_empty() || !p.name.is_empty() || !p.net.is_empty())
                .collect()
        })
        .unwrap_or_default();

    Some(SchematicComponent {
        designator,
        value: if !value.is_empty() {
            value
        } else {
            comment.clone()
        },
        comment,
        libref: libref.clone(),
        library_ref: libref,
        footprint: footprint.clone(),
        package: footprint,
        datasheet,
        manufacturer: mfr,
        mpn,
        parameters,
        pins,
    })
}

fn normalize_net_from_json(obj: &Value) -> Option<SchematicNet> {
    let name = obj
        .get("net")
        .or(obj.get("label"))
        .or(obj.get("signal"))
        .or(obj.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        return None;
    }

    let members: Vec<String> = obj
        .get("members")
        .or(obj.get("nodes"))
        .or(obj.get("connections"))
        .or(obj.get("pins"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|m| {
                    if let Some(s) = m.as_str() {
                        s.trim().to_string()
                    } else {
                        let ref_ = json_str(m, "ref");
                        if ref_.is_empty() {
                            json_str(m, "designator")
                        } else {
                            ref_
                        }
                    }
                })
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    Some(SchematicNet {
        name,
        members,
        confidence: String::new(),
        evidence: vec![],
        source_paths: vec![],
        sheets: vec![],
    })
}

/// Parse BOM CSV format
pub fn parse_bom_csv(text: &str) -> Result<ParsedSchematic, String> {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.is_empty() {
        return Ok(ParsedSchematic {
            parser_mode: "bom-csv".to_string(),
            components: vec![],
            nets: vec![],
            objects: vec![],
            bom: vec![],
            schematic_advice: None,
            preview: None,
            visual_netlist: None,
            raw_summary: Value::Null,
            sheets: vec![],
        });
    }

    let headers: Vec<String> = lines[0]
        .split(',')
        .map(|h| h.trim().to_lowercase())
        .collect();

    let des_idx = headers
        .iter()
        .position(|h| ["designator", "designators", "refdes"].contains(&h.as_str()));
    let val_idx = headers
        .iter()
        .position(|h| ["value", "comment", "description"].contains(&h.as_str()));
    let fp_idx = headers
        .iter()
        .position(|h| ["footprint", "package", "pattern"].contains(&h.as_str()));

    let mut components = Vec::new();
    for line in &lines[1..] {
        let cols: Vec<String> = line.split(',').map(|c| c.trim().to_string()).collect();
        let designators_str = des_idx
            .and_then(|i| cols.get(i))
            .cloned()
            .unwrap_or_default();
        let value = val_idx
            .and_then(|i| cols.get(i))
            .cloned()
            .unwrap_or_default();
        let footprint = fp_idx
            .and_then(|i| cols.get(i))
            .cloned()
            .unwrap_or_default();

        for des in designators_str.split([';', '|', '/']) {
            let des = des.trim();
            if !des.is_empty() && des.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
                components.push(SchematicComponent {
                    designator: des.to_string(),
                    value: value.clone(),
                    comment: value.clone(),
                    libref: String::new(),
                    library_ref: String::new(),
                    footprint: footprint.clone(),
                    package: footprint.clone(),
                    datasheet: String::new(),
                    manufacturer: String::new(),
                    mpn: String::new(),
                    parameters: Value::Null,
                    pins: vec![],
                });
            }
        }
    }

    let bom = build_bom_from_components(&components);

    Ok(ParsedSchematic {
        parser_mode: "bom-csv".to_string(),
        components,
        nets: vec![],
        objects: vec![],
        bom,
        schematic_advice: None,
        preview: None,
        visual_netlist: None,
        raw_summary: Value::Null,
        sheets: vec![],
    })
}

/// Build BOM from components (group by value+footprint)
fn build_bom_from_components(components: &[SchematicComponent]) -> Vec<SchematicBomRow> {
    let mut groups: HashMap<String, SchematicBomRow> = HashMap::new();
    for c in components {
        let key = format!("{}|{}|{}", c.value, c.footprint, c.datasheet);
        let entry = groups.entry(key).or_insert_with(|| SchematicBomRow {
            designators: vec![],
            quantity: 0,
            value: c.value.clone(),
            comment: c.comment.clone(),
            libref: c.libref.clone(),
            footprint: c.footprint.clone(),
            datasheet: c.datasheet.clone(),
            manufacturer: c.manufacturer.clone(),
            mpn: c.mpn.clone(),
            parameters: c.parameters.clone(),
        });
        entry.designators.push(c.designator.clone());
        entry.quantity += 1;
    }
    let mut bom: Vec<_> = groups.into_values().collect();
    for item in &mut bom {
        item.designators.sort();
    }
    bom.sort_by(|a, b| a.designators.first().cmp(&b.designators.first()));
    bom
}

/// Full ingest: detect format, parse, analyze, return complete result
pub enum IngestedFormat {
    AltiumRaw,
    AltiumJson,
    BomCsv,
    Netlist,
    Text,
}

pub fn detect_format(file_path: &str) -> IngestedFormat {
    let lower = file_path.to_lowercase();
    if lower.ends_with(".schdoc") {
        IngestedFormat::AltiumRaw
    } else if lower.ends_with(".json") {
        IngestedFormat::AltiumJson
    } else if lower.ends_with(".csv") {
        IngestedFormat::BomCsv
    } else if lower.ends_with(".txt") || lower.ends_with(".net") || lower.ends_with(".log") {
        IngestedFormat::Netlist
    } else {
        IngestedFormat::Text
    }
}

/// Ingest a schematic file, detecting format and running full analysis
pub fn ingest_schematic_file(
    binary_data: Option<&[u8]>,
    text_data: Option<&str>,
    file_path: &str,
    format: Option<&str>,
) -> Result<ParsedSchematic, String> {
    let fmt = if let Some(f) = format {
        match f {
            "altium-raw" => IngestedFormat::AltiumRaw,
            "altium-json" => IngestedFormat::AltiumJson,
            "bom-csv" => IngestedFormat::BomCsv,
            "netlist" => IngestedFormat::Netlist,
            _ => detect_format(file_path),
        }
    } else {
        detect_format(file_path)
    };

    match fmt {
        IngestedFormat::AltiumRaw => {
            let data = binary_data.ok_or("SchDoc binary data required")?;
            let (ext_components, ext_nets) = super::schdoc::parse_schdoc_buffer_full(data)?;
            let components: Vec<SchematicComponent> = ext_components
                .iter()
                .map(|c| SchematicComponent {
                    designator: c.designator.clone(),
                    value: c.value.clone(),
                    comment: c.comment.clone(),
                    libref: c.libref.clone(),
                    library_ref: c.libref.clone(),
                    footprint: c.footprint.clone(),
                    package: c.package.clone(),
                    datasheet: c.datasheet.clone(),
                    manufacturer: String::new(),
                    mpn: String::new(),
                    parameters: Value::Null,
                    pins: vec![],
                })
                .collect();
            let nets: Vec<SchematicNet> = ext_nets
                .iter()
                .map(|n| SchematicNet {
                    name: n.name.clone(),
                    members: n.members.clone(),
                    confidence: n.confidence.clone(),
                    evidence: vec![],
                    source_paths: vec![file_path.to_string()],
                    sheets: vec![],
                })
                .collect();
            let bom = build_bom_from_components(&components);
            Ok(ParsedSchematic {
                parser_mode: "altium-raw-internal".to_string(),
                components,
                nets,
                objects: vec![],
                bom,
                schematic_advice: None,
                preview: None,
                visual_netlist: None,
                raw_summary: Value::Null,
                sheets: vec![],
            })
        }
        IngestedFormat::AltiumJson => {
            let text = text_data.ok_or("JSON text data required")?;
            parse_altium_json(text)
        }
        IngestedFormat::BomCsv => {
            let text = text_data.ok_or("CSV text data required")?;
            parse_bom_csv(text)
        }
        IngestedFormat::Netlist | IngestedFormat::Text => {
            let text = text_data.unwrap_or("");
            // Simple netlist: extract component-like lines and net-like lines
            let mut components = Vec::new();
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                // Basic component match: D123 or U123 followed by value
                if let Some((des, val)) = parse_netlist_component(trimmed) {
                    components.push(SchematicComponent {
                        designator: des,
                        value: val,
                        comment: String::new(),
                        libref: String::new(),
                        library_ref: String::new(),
                        footprint: String::new(),
                        package: String::new(),
                        datasheet: String::new(),
                        manufacturer: String::new(),
                        mpn: String::new(),
                        parameters: Value::Null,
                        pins: vec![],
                    });
                }
            }
            let bom = build_bom_from_components(&components);
            Ok(ParsedSchematic {
                parser_mode: "netlist-text".to_string(),
                components,
                nets: vec![],
                objects: vec![],
                bom,
                schematic_advice: None,
                preview: None,
                visual_netlist: None,
                raw_summary: Value::Null,
                sheets: vec![],
            })
        }
    }
}

fn parse_netlist_component(line: &str) -> Option<(String, String)> {
    // Match patterns like: "U1  STM32F103" or "R1 10K"
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 2 {
        let first = parts[0];
        if first.len() >= 2
            && first.chars().next()?.is_ascii_alphabetic()
            && first[1..].chars().all(|c| c.is_ascii_digit() || c == '?')
        {
            return Some((first.to_string(), parts[1..].join(" ")));
        }
    }
    None
}
