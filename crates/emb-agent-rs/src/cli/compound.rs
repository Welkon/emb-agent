use super::util::{current_dir_string, option_value};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cmd = args.first().map(String::as_str).unwrap_or("");
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let ext_dir = Path::new(&cwd).join(".emb-agent");

    match cmd {
        "compound" => {
            let sub = args.get(1).map(String::as_str).unwrap_or("list");
            match sub {
                "add" | "learn" | "decide" | "trap" | "explore" | "trick" => {
                    let doc_type = if sub == "add" {
                        option_value(args, "--type").unwrap_or_else(|| "learn".to_string())
                    } else if sub == "decide" {
                        "decision".to_string()
                    } else {
                        sub.to_string()
                    };
                    let slug = option_value(args, "--slug").unwrap_or_default();
                    let title = option_value(args, "--title").unwrap_or_default();
                    let summary = option_value(args, "--summary").unwrap_or_default();
                    let chip = option_value(args, "--chip").unwrap_or_default();
                    let peripheral = option_value(args, "--peripheral").unwrap_or_default();
                    let vendor = option_value(args, "--vendor").unwrap_or_default();
                    let severity = option_value(args, "--severity").unwrap_or_default();
                    let category = option_value(args, "--category").unwrap_or_default();

                    let mut extra: Vec<(&str, &str)> = Vec::new();
                    if !vendor.is_empty() {
                        extra.push(("vendor", vendor.as_str()));
                    }
                    if !severity.is_empty() {
                        extra.push(("severity", severity.as_str()));
                    }
                    if !category.is_empty() {
                        extra.push(("category", category.as_str()));
                    }

                    if slug.is_empty() {
                        return Err("compound add requires --slug".to_string());
                    }
                    if summary.is_empty() {
                        return Err("compound add requires --summary".to_string());
                    }

                    println!(
                        "{}",
                        emb_agent_core::compound::compound_add(
                            &ext_dir,
                            &doc_type,
                            &slug,
                            if title.is_empty() { &slug } else { &title },
                            &summary,
                            &chip,
                            &peripheral,
                            &extra
                        )
                    );
                    Ok(())
                }
                "search" => {
                    let doc_type = option_value(args, "--type").unwrap_or_default();
                    let query = option_value(args, "--query").unwrap_or_default();
                    let chip = option_value(args, "--chip").unwrap_or_default();
                    println!(
                        "{}",
                        emb_agent_core::compound::compound_search(
                            &ext_dir, &doc_type, &query, &chip
                        )
                    );
                    Ok(())
                }
                "list" => {
                    println!("{}", emb_agent_core::compound::compound_list(&ext_dir));
                    Ok(())
                }
                _ => Err(format!("compound: unknown subcommand: {sub}")),
            }
        }
        "attention" => {
            let sub = args.get(1).map(String::as_str).unwrap_or("show");
            match sub {
                "show" => {
                    println!("{}", emb_agent_core::compound::attention_show(&ext_dir));
                    Ok(())
                }
                "note" => {
                    let text = option_value(args, "--text").unwrap_or_default();
                    let section =
                        option_value(args, "--section").unwrap_or_else(|| "Notes".to_string());
                    if text.is_empty() {
                        return Err("attention note requires --text".to_string());
                    }
                    println!(
                        "{}",
                        emb_agent_core::compound::attention_note(&ext_dir, &text, &section)
                    );
                    Ok(())
                }
                _ => Err(format!("attention: unknown subcommand: {sub}")),
            }
        }
        "note" => {
            // Shortcut: emb note --text "..." [--section "..."]
            let text = option_value(args, "--text")
                .unwrap_or_else(|| args.get(1).cloned().unwrap_or_default());
            let section = option_value(args, "--section").unwrap_or_else(|| "Notes".to_string());
            if text.is_empty() {
                return Err("note requires text (--text or positional)".to_string());
            }
            println!(
                "{}",
                emb_agent_core::compound::attention_note(&ext_dir, &text, &section)
            );
            Ok(())
        }
        "arch" => {
            let sub = args.get(1).map(String::as_str).unwrap_or("status");
            match sub {
                "status" => {
                    println!("{}", emb_agent_core::compound::arch_status(&ext_dir));
                    Ok(())
                }
                "check" => {
                    println!("{}", emb_agent_core::compound::arch_check(&ext_dir));
                    Ok(())
                }
                _ => Err(format!("arch: unknown subcommand: {}", sub)),
            }
        }
        _ => Err(format!("unknown compound command: {cmd}")),
    }
}
