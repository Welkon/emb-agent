use super::tooling::maybe_auto_ensure_markitdown;
use super::util::{current_dir_string, option_value, option_values};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let subcmd = args.get(1).map(String::as_str).unwrap_or("help");
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    match subcmd {
        "schematic" => {
            let files = option_values(args, "--file");
            if files.is_empty() {
                return Err("ingest schematic requires --file <path>".to_string());
            }
            let format = option_value(args, "--format");
            let mut sheets = Vec::new();
            for file in &files {
                let file_path = Path::new(&cwd).join(file);
                let ext = std::path::Path::new(file)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                let is_binary = matches!(ext.as_str(), "schdoc" | "pcbdoc");
                let data =
                    std::fs::read(&file_path).map_err(|e| format!("Cannot read {file}: {e}"))?;
                let text = if !is_binary {
                    Some(String::from_utf8_lossy(&data).to_string())
                } else {
                    None
                };
                let parsed = emb_agent_core::schematic::ingest::ingest_schematic_file(
                    if is_binary { Some(&data) } else { None },
                    text.as_deref(),
                    file,
                    format.as_deref(),
                )?;
                sheets.push((file.clone(), parsed));
            }

            let source_paths = files.clone();
            let parsed = merge_schematic_sheets(sheets);
            let visual_netlist = emb_agent_core::schematic::ingest::build_visual_netlist_analysis(
                &source_paths,
                &parsed,
            );
            let advice = emb_agent_core::schematic::advisor::analyze_schematic_advice(&parsed);
            let mcu_candidates =
                emb_agent_core::schematic::ingest::identify_mcu_candidates(&parsed.components);

            let cache_dir = Path::new(&cwd)
                .join(".emb-agent")
                .join("cache")
                .join("schematics")
                .join(cache_key_for_files(&files));
            std::fs::create_dir_all(&cache_dir)
                .map_err(|e| format!("Cannot create schematic cache: {e}"))?;
            let parsed_path = cache_dir.join("parsed.json");
            let visual_path = cache_dir.join("analysis.visual-netlist.json");
            let advice_path = cache_dir.join("analysis.schematic-advice.json");
            let source_path = cache_dir.join("source.json");
            let preview_path = cache_dir.join("preview.svg");

            write_schematic_preview(
                &preview_path,
                &files.join(", "),
                parsed.components.len(),
                parsed.nets.len(),
            )?;
            let mut parsed_json = serde_json::to_value(&parsed).unwrap_or_default();
            if let Some(obj) = parsed_json.as_object_mut() {
                obj.insert(
                    "visual_netlist".to_string(),
                    serde_json::to_value(&visual_netlist).unwrap_or_default(),
                );
                obj.insert(
                    "schematic_advice".to_string(),
                    serde_json::to_value(&advice).unwrap_or_default(),
                );
                obj.insert(
                    "preview".to_string(),
                    serde_json::json!({
                        "summary": {
                            "kind": "netlist-overview-svg",
                            "svg_path": preview_path.to_string_lossy().to_string(),
                            "components": parsed.components.len(),
                            "nets": parsed.nets.len()
                        }
                    }),
                );
            }
            std::fs::write(
                &parsed_path,
                serde_json::to_string_pretty(&parsed_json).unwrap_or_default(),
            )
            .map_err(|e| format!("Cannot write parsed.json: {e}"))?;
            std::fs::write(
                &visual_path,
                serde_json::to_string_pretty(&visual_netlist).unwrap_or_default(),
            )
            .map_err(|e| format!("Cannot write visual netlist: {e}"))?;
            std::fs::write(
                &advice_path,
                serde_json::to_string_pretty(&advice).unwrap_or_default(),
            )
            .map_err(|e| format!("Cannot write schematic advice: {e}"))?;
            std::fs::write(
                &source_path,
                serde_json::to_string_pretty(&serde_json::json!({
                    "source_path": files.first().cloned().unwrap_or_default(),
                    "source_paths": files,
                    "format": format,
                    "parser_mode": parsed.parser_mode.clone(),
                    "sheet_count": source_paths.len(),
                }))
                .unwrap_or_default(),
            )
            .map_err(|e| format!("Cannot write source.json: {e}"))?;

            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "status": "ok", "write_mode": "analysis-only", "truth_write": {"direct": false},
                    "parser_mode": parsed.parser_mode.clone(),
                    "sheet_count": source_paths.len(), "source_paths": source_paths,
                    "components_found": parsed.components.len(), "nets_found": parsed.nets.len(),
                    "bom_lines": parsed.bom.len(), "cache_dir": cache_dir,
                    "parsed_path": parsed_path, "visual_netlist_path": visual_path,
                    "schematic_advice_path": advice_path, "preview_path": preview_path,
                    "mcu_candidates": mcu_candidates,
                    "summary": {
                        "advice": advice.summary,
                        "visual_netlist": visual_netlist.graph
                    },
                    "next": "schematic summary --file <path>", "next_instructions": "Schematic extracted and cached. Present the summary/advice to the user; do not inspect the SchDoc binary manually."
                }))
                .unwrap_or_default()
            );
            Ok(())
        }
        "doc" => {
            let file = option_value(args, "--file")
                .or_else(|| args.get(2).cloned())
                .ok_or("ingest doc requires --file <path>")?;
            let provider = option_value(args, "--provider").unwrap_or_else(|| "auto".to_string());
            maybe_auto_ensure_markitdown(&provider, &cwd);
            let kind = option_value(args, "--kind").unwrap_or_else(|| "datasheet".to_string());
            let intended_to = option_value(args, "--to").unwrap_or_else(|| "hardware".to_string());
            let title = option_value(args, "--title");
            let language = option_value(args, "--language");
            let pages = option_value(args, "--pages");
            let model_version = option_value(args, "--model-version");
            let poll_interval_ms =
                option_value(args, "--poll-interval-ms").and_then(|s| s.parse().ok());
            let timeout_ms = option_value(args, "--timeout-ms").and_then(|s| s.parse().ok());
            let pageindex_model = option_value(args, "--pageindex-model");
            let pageindex_api_base = option_value(args, "--pageindex-api-base");
            let pageindex_api_key = option_value(args, "--pageindex-api-key");
            let result = emb_agent_core::lookup::ingest_document(
                Path::new(&cwd),
                emb_agent_core::lookup::DocIngestOptions {
                    file: &file,
                    provider: &provider,
                    kind: &kind,
                    intended_to: &intended_to,
                    title: title.as_deref(),
                    language: language.as_deref(),
                    pages: pages.as_deref(),
                    model_version: model_version.as_deref(),
                    force: args.iter().any(|arg| arg == "--force"),
                    is_ocr: args.iter().any(|arg| arg == "--ocr" || arg == "--is-ocr"),
                    enable_table: !args.iter().any(|arg| arg == "--no-table"),
                    enable_formula: !args.iter().any(|arg| arg == "--no-formula"),
                    poll_interval_ms,
                    timeout_ms,
                    pageindex_model: pageindex_model.as_deref(),
                    pageindex_api_base: pageindex_api_base.as_deref(),
                    pageindex_api_key: pageindex_api_key.as_deref(),
                },
            )?;
            println!(
                "{}",
                serde_json::to_string_pretty(&result).unwrap_or_default()
            );
            Ok(())
        }
        "board" => {
            let file = option_value(args, "--file").ok_or("ingest board requires --file <path>")?;
            let file_path = Path::new(&cwd).join(&file);
            let data = std::fs::read(&file_path).map_err(|e| format!("Cannot read {file}: {e}"))?;
            let mut summary = emb_agent_core::hardware::board::parse_pcbdoc(&data)?;
            summary.source_path = file;
            println!(
                "{}",
                serde_json::to_string_pretty(&summary).unwrap_or_default()
            );
            Ok(())
        }
        _ => Err("ingest: expected doc, schematic, or board".to_string()),
    }
}

fn cache_key_for_file(file: &str) -> String {
    let stem = Path::new(file)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("schematic");
    let safe = stem
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if safe.is_empty() {
        "schematic".to_string()
    } else {
        safe
    }
}

fn cache_key_for_files(files: &[String]) -> String {
    if files.len() == 1 {
        return cache_key_for_file(&files[0]);
    }
    let joined = files
        .iter()
        .map(|file| cache_key_for_file(file))
        .collect::<Vec<_>>()
        .join("--");
    if joined.len() <= 96 {
        joined
    } else {
        joined.chars().take(96).collect()
    }
}

fn merge_schematic_sheets(
    mut sheets: Vec<(String, emb_agent_core::schematic::ParsedSchematic)>,
) -> emb_agent_core::schematic::ParsedSchematic {
    if sheets.len() == 1 {
        return sheets.remove(0).1;
    }

    let sheet_count = sheets.len();
    let mut parser_modes = Vec::new();
    let mut components = Vec::new();
    let mut nets: Vec<emb_agent_core::schematic::SchematicNet> = Vec::new();
    let mut objects = Vec::new();
    let mut bom = Vec::new();
    let mut sheet_summaries = Vec::new();
    let mut object_count = 0usize;

    for (source, mut parsed) in sheets {
        parser_modes.push(parsed.parser_mode.clone());
        let component_count = parsed.components.len();
        let net_count = parsed.nets.len();
        let parsed_object_count = parsed.objects.len();
        object_count += parsed_object_count;
        sheet_summaries.push(serde_json::json!({
            "source_path": source,
            "parser_mode": parsed.parser_mode,
            "components": component_count,
            "nets": net_count,
            "objects": parsed_object_count,
        }));
        components.append(&mut parsed.components);
        merge_nets(&mut nets, parsed.nets);
        objects.append(&mut parsed.objects);
        bom.append(&mut parsed.bom);
        sheet_summaries.append(&mut parsed.sheets);
    }

    emb_agent_core::schematic::ParsedSchematic {
        parser_mode: format!("multi-sheet:{}", parser_modes.join(",")),
        components,
        nets,
        objects,
        bom,
        schematic_advice: None,
        preview: None,
        visual_netlist: None,
        raw_summary: serde_json::json!({
            "sheet_count": sheet_count,
            "object_count": object_count,
        }),
        sheets: sheet_summaries,
    }
}
fn merge_nets(
    target: &mut Vec<emb_agent_core::schematic::SchematicNet>,
    nets: Vec<emb_agent_core::schematic::SchematicNet>,
) {
    for mut net in nets {
        if !net.name.is_empty()
            && let Some(existing) = target.iter_mut().find(|existing| existing.name == net.name)
        {
            append_unique(&mut existing.members, net.members);
            append_unique(&mut existing.source_paths, net.source_paths);
            append_unique(&mut existing.sheets, net.sheets);
            existing.evidence.append(&mut net.evidence);
            if existing.confidence.is_empty() {
                existing.confidence = net.confidence;
            }
        } else {
            target.push(net);
        }
    }
}

fn append_unique(target: &mut Vec<String>, values: Vec<String>) {
    for value in values {
        if !target.iter().any(|existing| existing == &value) {
            target.push(value);
        }
    }
}

fn write_schematic_preview(
    path: &Path,
    source: &str,
    components: usize,
    nets: usize,
) -> Result<(), String> {
    let source = escape_xml(source);
    let svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"720\" height=\"180\" viewBox=\"0 0 720 180\"><rect width=\"720\" height=\"180\" fill=\"#fff\"/><text x=\"24\" y=\"44\" font-family=\"monospace\" font-size=\"20\" fill=\"#111\">emb-agent schematic preview</text><text x=\"24\" y=\"82\" font-family=\"monospace\" font-size=\"15\" fill=\"#333\">source: {source}</text><text x=\"24\" y=\"114\" font-family=\"monospace\" font-size=\"15\" fill=\"#333\">components: {components}</text><text x=\"24\" y=\"146\" font-family=\"monospace\" font-size=\"15\" fill=\"#333\">nets: {nets}</text></svg>"
    );
    std::fs::write(path, svg).map_err(|e| format!("Cannot write schematic preview: {e}"))
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
