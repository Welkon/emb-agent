use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Schematic component from parsed.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicComponent {
    #[serde(default)]
    pub designator: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub libref: String,
    #[serde(default, alias = "library_ref")]
    pub library_ref: String,
    #[serde(default)]
    pub footprint: String,
    #[serde(default)]
    pub package: String,
    #[serde(default)]
    pub datasheet: String,
    #[serde(default)]
    pub manufacturer: String,
    #[serde(default)]
    pub mpn: String,
    #[serde(default)]
    pub parameters: serde_json::Value,
    #[serde(default)]
    pub pins: Vec<SchematicPin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicPin {
    #[serde(default)]
    pub number: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub net: String,
}

/// Schematic net from parsed.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicNet {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub members: Vec<String>,
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub evidence: Vec<serde_json::Value>,
    #[serde(default)]
    pub source_paths: Vec<String>,
    #[serde(default)]
    pub sheets: Vec<String>,
}

/// BOM row from parsed.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicBomRow {
    #[serde(default)]
    pub designators: Vec<String>,
    #[serde(default)]
    pub quantity: usize,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub libref: String,
    #[serde(default)]
    pub footprint: String,
    #[serde(default)]
    pub datasheet: String,
    #[serde(default)]
    pub manufacturer: String,
    #[serde(default)]
    pub mpn: String,
    #[serde(default)]
    pub parameters: serde_json::Value,
}

/// Visual netlist analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisualNetlist {
    #[serde(default)]
    pub page_count: usize,
    #[serde(default)]
    pub graph: serde_json::Value,
    #[serde(default)]
    pub nets: Vec<serde_json::Value>,
    #[serde(default)]
    pub signal_candidates: Vec<serde_json::Value>,
    #[serde(default)]
    pub dangling_nets: Vec<serde_json::Value>,
    #[serde(default)]
    pub cross_sheet_nets: Vec<serde_json::Value>,
}

/// Full parsed.json structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedSchematic {
    #[serde(default)]
    pub parser_mode: String,
    #[serde(default)]
    pub components: Vec<SchematicComponent>,
    #[serde(default)]
    pub nets: Vec<SchematicNet>,
    #[serde(default)]
    pub objects: Vec<serde_json::Value>,
    #[serde(default)]
    pub bom: Vec<SchematicBomRow>,
    #[serde(default, alias = "schematic_advice")]
    pub schematic_advice: Option<SchematicAdvice>,
    #[serde(default)]
    pub preview: Option<serde_json::Value>,
    #[serde(default, alias = "visual_netlist")]
    pub visual_netlist: Option<VisualNetlist>,
    #[serde(default)]
    pub raw_summary: serde_json::Value,
    #[serde(default)]
    pub sheets: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicAdvice {
    #[serde(default)]
    pub summary: Option<SchematicAdviceSummary>,
    #[serde(default)]
    pub findings: Vec<SchematicAdviceFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicAdviceSummary {
    #[serde(default)]
    pub findings: usize,
    #[serde(default)]
    pub errors: usize,
    #[serde(default)]
    pub warnings: usize,
    #[serde(default)]
    pub info: usize,
    #[serde(default)]
    pub categories: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchematicAdviceFinding {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub confidence: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub evidence: serde_json::Value,
    #[serde(default)]
    pub recommended_checks: Vec<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub dismissible: bool,
    #[serde(default)]
    pub blocking: bool,
    #[serde(default)]
    pub reminder_policy: String,
    #[serde(default)]
    pub note: String,
}

/// Result of schematic queries
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "command")]
pub enum SchematicResult {
    #[serde(rename = "schematic summary")]
    Summary {
        result_mode: String,
        scope: SchematicScope,
        summary: SchematicSummaryData,
    },
    #[serde(rename = "schematic components")]
    Components {
        result_mode: String,
        scope: SchematicScope,
        components: Vec<SchematicComponent>,
    },
    #[serde(rename = "schematic component")]
    Component {
        result_mode: String,
        scope: SchematicScope,
        ref_: String,
        component: Option<SchematicComponent>,
        pins: Vec<SchematicPin>,
    },
    #[serde(rename = "schematic nets")]
    Nets {
        result_mode: String,
        scope: SchematicScope,
        nets: Vec<serde_json::Value>,
    },
    #[serde(rename = "schematic net")]
    Net {
        result_mode: String,
        scope: SchematicScope,
        name: String,
        net: Option<SchematicNet>,
    },
    #[serde(rename = "schematic bom")]
    Bom {
        result_mode: String,
        scope: SchematicScope,
        bom: Vec<SchematicBomRow>,
    },
    #[serde(rename = "schematic advice")]
    Advice {
        result_mode: String,
        scope: SchematicScope,
        advice: SchematicAdviceResult,
    },
    #[serde(rename = "schematic preview")]
    Preview {
        result_mode: String,
        scope: SchematicScope,
        preview: Option<serde_json::Value>,
    },
    #[serde(rename = "schematic raw")]
    Raw {
        result_mode: String,
        scope: SchematicScope,
        record: Option<serde_json::Value>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct SchematicScope {
    pub project_root: String,
    pub parsed: String,
    pub source_schematic: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchematicSummaryData {
    pub parser_mode: String,
    pub components: usize,
    pub nets: usize,
    pub objects: usize,
    pub bom_lines: usize,
    pub advice: Option<SchematicAdviceSummary>,
    pub preview: Option<serde_json::Value>,
    pub visual_netlist: Option<serde_json::Value>,
    pub raw_summary: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchematicAdviceResult {
    pub available: bool,
    pub summary: Option<SchematicAdviceSummary>,
    pub findings: Vec<SchematicAdviceFinding>,
    pub path: String,
}

/// Load parsed.json from a schematic cache directory
pub fn load_parsed_schematic(parsed_path: &Path) -> Result<ParsedSchematic, String> {
    let content =
        fs::read_to_string(parsed_path).map_err(|e| format!("Cannot read parsed.json: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid parsed.json: {e}"))
}

/// Find schematic cache entries under .emb-agent/cache/schematics/
pub fn find_schematic_cache_dirs(project_root: &Path) -> Vec<PathBuf> {
    let cache_root = project_root
        .join(".emb-agent")
        .join("cache")
        .join("schematics");
    if !cache_root.exists() {
        return vec![];
    }

    let mut dirs = Vec::new();
    if let Ok(entries) = fs::read_dir(&cache_root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && path.join("parsed.json").exists() {
                dirs.push(path);
            }
        }
    }
    dirs
}

/// Resolve which parsed.json to use: explicit path, --file, or auto-discover
pub fn resolve_parsed_path(
    project_root: &Path,
    parsed_arg: Option<&str>,
    file_arg: Option<&str>,
) -> Result<(PathBuf, String), String> {
    // 1. Explicit --parsed path
    if let Some(parsed) = parsed_arg
        && !parsed.is_empty()
    {
        let abs = if Path::new(parsed).is_absolute() {
            PathBuf::from(parsed)
        } else {
            project_root.join(parsed)
        };
        if abs.exists() {
            return Ok((abs.clone(), format!("{}", abs.display())));
        }
        return Err(format!("Parsed file not found: {parsed}"));
    }

    // 2. --file (schematic source) → find matching cache
    if let Some(file) = file_arg
        && !file.is_empty()
    {
        let dirs = find_schematic_cache_dirs(project_root);
        for dir in &dirs {
            if let Ok(source) = fs::read_to_string(dir.join("source.json"))
                && let Ok(source_json) = serde_json::from_str::<serde_json::Value>(&source)
            {
                let source_path = source_json["source_path"].as_str().unwrap_or("");
                if source_path.contains(file) || file.contains(source_path) {
                    let parsed_path = dir.join("parsed.json");
                    return Ok((parsed_path.clone(), format!("{}", parsed_path.display())));
                }
            }
        }
        return Err(format!("No schematic cache found matching file: {file}"));
    }

    // 3. Auto-discover: use first available parsed.json
    let dirs = find_schematic_cache_dirs(project_root);
    if let Some(dir) = dirs.first() {
        let parsed_path = dir.join("parsed.json");
        return Ok((parsed_path.clone(), format!("{}", parsed_path.display())));
    }

    Err("No parsed.json found. Trigger `/emb:ingest schematic --file <path>` first.".to_string())
}

pub struct SchematicQueryOptions<'a> {
    pub project_root: &'a Path,
    pub subject: &'a str,
    pub parsed_arg: Option<&'a str>,
    pub file_arg: Option<&'a str>,
    pub ref_arg: Option<&'a str>,
    pub name_arg: Option<&'a str>,
    pub record_arg: Option<usize>,
    pub limit: Option<usize>,
}

/// Query schematic data
pub fn query_schematic(options: SchematicQueryOptions<'_>) -> Result<SchematicResult, String> {
    let (parsed_path, parsed_display) =
        resolve_parsed_path(options.project_root, options.parsed_arg, options.file_arg)?;
    let parsed = load_parsed_schematic(&parsed_path)?;

    let scope = SchematicScope {
        project_root: format!("{}", options.project_root.display()),
        parsed: parsed_display,
        source_schematic: options.file_arg.unwrap_or("").to_string(),
    };
    let limit = options.limit.unwrap_or(20);
    let result_mode = "analysis-only".to_string();

    match options.subject {
        "summary" => {
            let visual_netlist = parsed
                .visual_netlist
                .as_ref()
                .and_then(|v| serde_json::to_value(v).ok());
            let advice_summary = parsed
                .schematic_advice
                .as_ref()
                .and_then(|a| a.summary.clone());
            let preview = parsed
                .preview
                .clone()
                .and_then(|p| p.get("summary").cloned());
            Ok(SchematicResult::Summary {
                result_mode,
                scope,
                summary: SchematicSummaryData {
                    parser_mode: parsed.parser_mode,
                    components: parsed.components.len(),
                    nets: parsed.nets.len(),
                    objects: parsed.objects.len(),
                    bom_lines: parsed.bom.len(),
                    advice: advice_summary,
                    preview,
                    visual_netlist,
                    raw_summary: parsed.raw_summary,
                },
            })
        }
        "components" => Ok(SchematicResult::Components {
            result_mode,
            scope,
            components: parsed.components.into_iter().take(limit).collect(),
        }),
        "component" => {
            let ref_ = options.ref_arg.unwrap_or("").to_lowercase();
            let component = parsed
                .components
                .iter()
                .find(|c| c.designator.to_lowercase() == ref_)
                .cloned();
            let pins = component
                .as_ref()
                .map(|c| c.pins.clone())
                .unwrap_or_default();
            Ok(SchematicResult::Component {
                result_mode,
                scope,
                ref_: options.ref_arg.unwrap_or("").to_string(),
                component,
                pins,
            })
        }
        "nets" => Ok(SchematicResult::Nets {
            result_mode,
            scope,
            nets: parsed
                .nets
                .iter()
                .take(limit)
                .map(|n| {
                    serde_json::json!({
                        "name": n.name,
                        "members": n.members,
                        "confidence": n.confidence,
                        "evidence_count": n.evidence.len(),
                    })
                })
                .collect(),
        }),
        "net" => {
            let name = options.name_arg.unwrap_or("").to_lowercase();
            let net = parsed
                .nets
                .iter()
                .find(|n| n.name.to_lowercase() == name)
                .cloned();
            Ok(SchematicResult::Net {
                result_mode,
                scope,
                name: options.name_arg.unwrap_or("").to_string(),
                net,
            })
        }
        "bom" => Ok(SchematicResult::Bom {
            result_mode,
            scope,
            bom: parsed.bom.into_iter().take(limit).collect(),
        }),
        "advice" => {
            let advice_path = parsed_path
                .parent()
                .map(|d| d.join("analysis.schematic-advice.json"))
                .filter(|p| p.exists());
            let advice = parsed.schematic_advice.clone().or_else(|| {
                advice_path.and_then(|p| {
                    fs::read_to_string(&p)
                        .ok()
                        .and_then(|s| serde_json::from_str(&s).ok())
                })
            });
            let findings = advice
                .as_ref()
                .map(|a| a.findings.clone())
                .unwrap_or_default()
                .into_iter()
                .take(limit)
                .collect();
            Ok(SchematicResult::Advice {
                result_mode,
                scope,
                advice: SchematicAdviceResult {
                    available: advice.is_some(),
                    summary: advice.as_ref().and_then(|a| a.summary.clone()),
                    findings,
                    path: String::new(),
                },
            })
        }
        "preview" => {
            let preview = parsed.preview.clone().or_else(|| {
                let preview_path = parsed_path.parent().map(|d| d.join("preview.svg"));
                preview_path
                    .filter(|p| p.exists())
                    .map(|p| serde_json::json!({"svg_path": format!("{}", p.display())}))
            });
            Ok(SchematicResult::Preview {
                result_mode,
                scope,
                preview,
            })
        }
        "raw" => {
            let idx = options.record_arg.unwrap_or(0);
            let record = parsed.objects.get(idx).cloned();
            Ok(SchematicResult::Raw {
                result_mode,
                scope,
                record,
            })
        }
        _ => Err(format!(
            "Unknown schematic subject: {}. Expected: summary, components, component, nets, net, bom, advice, preview, raw",
            options.subject
        )),
    }
}

/// Print schematic result as JSON
pub fn build_schematic_json(result: &SchematicResult) -> String {
    serde_json::to_string_pretty(result).unwrap_or_else(|e| format!("{{\"error\": \"{e}\"}}"))
}
