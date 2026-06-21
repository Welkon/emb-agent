use super::util::{current_dir_string, option_value};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    if args.get(1).map(String::as_str).unwrap_or("lookup") == "lookup" {
        let parsed = option_value(args, "--parsed");
        let file = option_value(args, "--file");
        let ref_ = option_value(args, "--ref");
        let limit = option_value(args, "--limit").and_then(|s| s.parse::<usize>().ok());
        match emb_agent_core::lookup::lookup_components(
            Path::new(&cwd),
            parsed.as_deref(),
            file.as_deref(),
            ref_.as_deref(),
            limit,
        ) {
            Ok(r) => {
                println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
                Ok(())
            }
            Err(e) => Err(e),
        }
    } else {
        Err("component: expected lookup".to_string())
    }
}
