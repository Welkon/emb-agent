use super::util::{current_dir_string, option_value};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let subcmd = args.get(1).map(String::as_str).unwrap_or("list");
    let project_root = Path::new(&cwd);
    match subcmd {
        "list" => match emb_agent_core::knowledge::graph::memory_list(project_root) {
            Ok(e) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(
                        &serde_json::json!({"entries":e.len(),"memories":e})
                    )
                    .unwrap_or_default()
                );
                Ok(())
            }
            Err(e) => Err(e),
        },
        "remember" => {
            let mt = option_value(args, "--type").unwrap_or_else(|| "reference".to_string());
            let s = option_value(args, "--summary").ok_or("memory remember requires --summary")?;
            let d = option_value(args, "--detail").unwrap_or_default();
            let id = emb_agent_core::knowledge::graph::memory_remember(project_root, &mt, &s, &d)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({"status":"ok","id":id}))
                    .unwrap_or_default()
            );
            Ok(())
        }
        _ => Err("memory: expected list|remember".to_string()),
    }
}
