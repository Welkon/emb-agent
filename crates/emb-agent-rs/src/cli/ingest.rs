use super::util::{current_dir_string, option_value};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let subcmd = args.get(1).map(String::as_str).unwrap_or("help");
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    match subcmd {
        "schematic" => {
            let file =
                option_value(args, "--file").ok_or("ingest schematic requires --file <path>")?;
            let file_path = Path::new(&cwd).join(&file);
            let format = option_value(args, "--format");
            let ext = std::path::Path::new(&file)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            let is_binary = matches!(ext.as_str(), "schdoc" | "pcbdoc");
            let data = std::fs::read(&file_path).map_err(|e| format!("Cannot read {file}: {e}"))?;
            let text = if !is_binary {
                Some(String::from_utf8_lossy(&data).to_string())
            } else {
                None
            };

            let parsed = emb_agent_core::schematic::ingest::ingest_schematic_file(
                if is_binary { Some(&data) } else { None },
                text.as_deref(),
                &file,
                format.as_deref(),
            )?;
            let visual_netlist = emb_agent_core::schematic::ingest::build_visual_netlist_analysis(
                std::slice::from_ref(&file),
                &parsed,
            );
            let advice = emb_agent_core::schematic::advisor::analyze_schematic_advice(&parsed);
            let mcu_candidates =
                emb_agent_core::schematic::ingest::identify_mcu_candidates(&parsed.components);

            let cache_dir = Path::new(&cwd)
                .join(".emb-agent")
                .join("cache")
                .join("schematics")
                .join(cache_key_for_file(&file));
            std::fs::create_dir_all(&cache_dir)
                .map_err(|e| format!("Cannot create schematic cache: {e}"))?;
            let parsed_path = cache_dir.join("parsed.json");
            let visual_path = cache_dir.join("analysis.visual-netlist.json");
            let advice_path = cache_dir.join("analysis.schematic-advice.json");
            let source_path = cache_dir.join("source.json");

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
                    "source_path": file,
                    "format": format,
                    "parser_mode": parsed.parser_mode,
                }))
                .unwrap_or_default(),
            )
            .map_err(|e| format!("Cannot write source.json: {e}"))?;

            println!("{}", serde_json::to_string_pretty(&serde_json::json!({
                "status": "ok", "write_mode": "analysis-only", "truth_write": {"direct": false},
                "parser_mode": parsed.parser_mode,
                "components_found": parsed.components.len(), "nets_found": parsed.nets.len(),
                "bom_lines": parsed.bom.len(), "cache_dir": cache_dir,
                "parsed_path": parsed_path, "visual_netlist_path": visual_path,
                "schematic_advice_path": advice_path,
                "visual_netlist": visual_netlist, "schematic_advice": advice, "mcu_candidates": mcu_candidates,
                "next": "schematic summary", "next_instructions": "Schematic extracted and cached. Present the summary/advice to the user; do not inspect the SchDoc binary manually."
            })).unwrap_or_default());
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
        _ => Err("ingest: expected schematic or board".to_string()),
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
