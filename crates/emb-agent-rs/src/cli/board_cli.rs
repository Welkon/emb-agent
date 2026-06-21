use super::util::{current_dir_string, option_value};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let subject = args.get(1).map(String::as_str).unwrap_or("summary");
    let layout = option_value(args, "--layout");
    match emb_agent_core::lookup::query_board(Path::new(&cwd), subject, layout.as_deref()) {
        Ok(r) => {
            println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
            Ok(())
        }
        Err(e) => Err(e),
    }
}
