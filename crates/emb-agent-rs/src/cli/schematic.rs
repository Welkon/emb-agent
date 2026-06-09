use super::util::{current_dir_string, option_value, positional_after};
use emb_agent_core::{SchematicQueryOptions, build_schematic_json, query_schematic};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let subject = args.get(1).map(String::as_str).unwrap_or("summary");
    let parsed = option_value(args, "--parsed");
    let positional = positional_after(args, 2);
    let file = option_value(args, "--file").or_else(|| match subject {
        "summary" | "components" | "nets" | "bom" | "advice" | "preview" => positional.clone(),
        _ => None,
    });
    let ref_ = option_value(args, "--ref").or_else(|| {
        if subject == "component" {
            positional.clone()
        } else {
            None
        }
    });
    let name = option_value(args, "--name").or_else(|| {
        if subject == "net" {
            positional.clone()
        } else {
            None
        }
    });
    let record = option_value(args, "--record")
        .or_else(|| {
            if subject == "raw" {
                positional.clone()
            } else {
                None
            }
        })
        .and_then(|s| s.parse::<usize>().ok());
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
