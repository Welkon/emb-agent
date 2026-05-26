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
            let mcu_candidates =
                emb_agent_core::schematic::ingest::identify_mcu_candidates(&parsed.components);

            println!("{}", serde_json::to_string_pretty(&serde_json::json!({
                "status": "ok", "parser_mode": parsed.parser_mode,
                "components_found": parsed.components.len(), "nets_found": parsed.nets.len(),
                "bom_lines": parsed.bom.len(), "visual_netlist": visual_netlist, "mcu_candidates": mcu_candidates,
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
