use super::util::{current_dir_string, option_value};
use emb_agent_core::{build_schematic_json, query_schematic, SchematicQueryOptions};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let subject = args.get(1).map(String::as_str).unwrap_or("summary");
    let parsed = option_value(args, "--parsed");
    let file = option_value(args, "--file");
    let ref_ = option_value(args, "--ref");
    let name = option_value(args, "--name");
    let record = option_value(args, "--record").and_then(|s| s.parse::<usize>().ok());
    let limit = option_value(args, "--limit").and_then(|s| s.parse::<usize>().ok());
    match query_schematic(SchematicQueryOptions {
        project_root: Path::new(&cwd),
        subject,
        parsed_arg: parsed.as_deref(),
        file_arg: file.as_deref(),
        ref_arg: ref_.as_deref(),
        name_arg: name.as_deref(),
        record_arg: record,
        limit,
    }) {
        Ok(result) => {
            println!("{}", build_schematic_json(&result));
            Ok(())
        }
        Err(e) => Err(e),
    }
}
