use super::util::{current_dir_string, option_value, positional_after};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let subcmd = args.get(1).map(String::as_str).unwrap_or("help");
    let project_root = Path::new(&cwd);
    match subcmd {
        "graph" => match args.get(2).map(String::as_str).unwrap_or("report") {
            "refresh" | "build" => {
                match emb_agent_core::knowledge::graph::refresh_graph(project_root) {
                    Ok(g) => {
                        println!("{}", serde_json::to_string_pretty(&serde_json::json!({"status":"ok","nodes":g.stats.nodes,"edges":g.stats.edges})).unwrap_or_default());
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }
            "report" => match emb_agent_core::knowledge::graph::graph_report(project_root) {
                Ok(r) => {
                    println!("{r}");
                    Ok(())
                }
                Err(e) => Err(e),
            },
            "query" => {
                let q = option_value(args, "--q")
                    .or_else(|| option_value(args, "--query"))
                    .or_else(|| positional_after(args, 3))
                    .ok_or("graph query requires <term> or --q <term>")?;
                let r = emb_agent_core::knowledge::graph::query_graph(project_root, &q)?;
                println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
                Ok(())
            }
            "explain" => {
                let n = option_value(args, "--id")
                    .or_else(|| option_value(args, "--node"))
                    .or_else(|| positional_after(args, 3))
                    .ok_or("graph explain requires <node-id> or --id <node-id>")?;
                let r = emb_agent_core::knowledge::graph::explain_graph(project_root, &n)?;
                println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
                Ok(())
            }
            _ => Err("knowledge graph: expected refresh|report|query|explain".to_string()),
        },
        "wiki" => match emb_agent_core::knowledge::graph::wiki_list(project_root) {
            Ok(p) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(
                        &serde_json::json!({"wiki_pages":p.len(),"pages":p})
                    )
                    .unwrap_or_default()
                );
                Ok(())
            }
            Err(e) => Err(e),
        },
        _ => Err("knowledge: expected graph|wiki".to_string()),
    }
}
