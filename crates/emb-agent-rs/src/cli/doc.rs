use super::util::{current_dir_string, option_value};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let subcmd = args.get(1).map(String::as_str).unwrap_or("lookup");
    match subcmd {
        "lookup" => {
            let chip = option_value(args, "--chip");
            let vendor = option_value(args, "--vendor");
            let package = option_value(args, "--package");
            let keyword = option_value(args, "--keyword");
            let limit = option_value(args, "--limit").and_then(|s| s.parse::<usize>().ok());
            match emb_agent_core::lookup::lookup_docs(
                Path::new(&cwd),
                chip.as_deref(),
                vendor.as_deref(),
                package.as_deref(),
                keyword.as_deref(),
                limit,
            ) {
                Ok(r) => {
                    println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
                    Ok(())
                }
                Err(e) => Err(e),
            }
        }
        "fetch" => {
            let doc_path = option_value(args, "--path")
                .or_else(|| args.get(2).cloned())
                .ok_or("doc fetch requires --path")?;
            match emb_agent_core::lookup::fetch_document(Path::new(&cwd), &doc_path) {
                Ok(content) => {
                    println!("{content}");
                    Ok(())
                }
                Err(e) => Err(e),
            }
        }
        "list" => {
            let ext_dir = Path::new(&cwd).join(".emb-agent");
            println!("{}", emb_agent_core::meta_ops::doc_list(&ext_dir));
            Ok(())
        }
        "tree" => {
            let doc_id = option_value(args, "--doc-id")
                .or_else(|| args.get(2).cloned())
                .ok_or("doc tree requires --doc-id")?;
            match emb_agent_core::lookup::doc_tree(Path::new(&cwd), &doc_id) {
                Ok(r) => {
                    println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
                    Ok(())
                }
                Err(e) => Err(e),
            }
        }
        "pages" => {
            let doc_id = option_value(args, "--doc-id")
                .or_else(|| args.get(2).cloned())
                .ok_or("doc pages requires --doc-id")?;
            let pages = option_value(args, "--pages")
                .ok_or("doc pages requires --pages <range> (e.g. 5-7 or 3,8)")?;
            match emb_agent_core::lookup::doc_pages(Path::new(&cwd), &doc_id, &pages) {
                Ok(r) => {
                    println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
                    Ok(())
                }
                Err(e) => Err(e),
            }
        }
        _ => Err("doc: expected lookup, fetch, list, tree, or pages".to_string()),
    }
}
