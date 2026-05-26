use super::util::{current_dir_string, option_value};
use emb_agent_core::{build_task_list_json, build_task_show_json, read_all_tasks, read_task};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print_help();
        return Ok(());
    }
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let ext_dir = Path::new(&cwd).join(".emb-agent");
    match args.get(1).map(String::as_str) {
        Some("list") => {
            let tasks = read_all_tasks(&ext_dir);
            println!("{}", build_task_list_json(&tasks));
            Ok(())
        }
        Some("show") => {
            let name = args.get(2).ok_or("task show requires <name>")?;
            match read_task(&ext_dir, name) {
                Some(task) => {
                    println!("{}", build_task_show_json(&task.to_string()));
                    Ok(())
                }
                None => Err(format!("task not found: {name}")),
            }
        }
        Some("add") => {
            let summary = args.get(2).map(|s| s.as_str()).unwrap_or("New task");
            let task_type = option_value(args, "--type").unwrap_or_else(|| "implement".to_string());
            let priority = option_value(args, "--priority").unwrap_or_else(|| "P2".to_string());
            println!(
                "{}",
                emb_agent_core::task::task_ops::task_add(&ext_dir, summary, &task_type, &priority)
            );
            Ok(())
        }
        Some("activate") => {
            let name = args.get(2).ok_or("task activate requires <name>")?;
            println!(
                "{}",
                emb_agent_core::task::task_ops::task_activate(&ext_dir, name)
            );
            Ok(())
        }
        Some("resolve") => {
            let name = args.get(2).ok_or("task resolve requires <name>")?;
            let note = args.get(3).map(|s| s.as_str()).unwrap_or("");
            println!(
                "{}",
                emb_agent_core::task::task_ops::task_resolve(&ext_dir, name, note)
            );
            Ok(())
        }
        Some("aar") => match args.get(2).map(String::as_str) {
            Some("status") => {
                let name = args.get(3).ok_or("task aar status requires <name>")?;
                println!(
                    "{}",
                    emb_agent_core::task::task_ops::task_aar_status(&ext_dir, name)
                );
                Ok(())
            }
            Some("scan") => {
                let name = args.get(3).ok_or("task aar scan requires <name>")?;
                let lessons = if args.iter().any(|a| a == "--lessons") {
                    Some(true)
                } else if args.iter().any(|a| a == "--no-lessons") {
                    Some(false)
                } else {
                    None
                };
                println!(
                    "{}",
                    emb_agent_core::task::task_ops::task_aar_scan(&ext_dir, name, lessons)
                );
                Ok(())
            }
            Some("record") => {
                let name = args
                    .get(3)
                    .ok_or("task aar record requires <name> <note>")?;
                let note = args.get(4).map(|s| s.as_str()).unwrap_or("");
                println!(
                    "{}",
                    emb_agent_core::task::task_ops::task_aar_record(&ext_dir, name, note)
                );
                Ok(())
            }
            _ => Err("task aar: expected status, scan, or record".to_string()),
        },
        Some("bug") => match args.get(2).map(String::as_str) {
            Some("add") => {
                let parent = args
                    .get(3)
                    .ok_or("task bug add requires <parent-task> <summary>")?;
                let summary = args.get(4).map(|s| s.as_str()).unwrap_or("Bug");
                println!(
                    "{}",
                    emb_agent_core::bug_ops::bug_add(&ext_dir, parent, summary)
                );
                Ok(())
            }
            Some("list") => {
                let parent = args
                    .get(3)
                    .filter(|s| !s.starts_with("--"))
                    .map(|s| s.as_str());
                println!(
                    "{}",
                    emb_agent_core::bug_ops::bug_list(
                        &ext_dir,
                        parent,
                        None,
                        option_value(args, "--variant").as_deref()
                    )
                );
                Ok(())
            }
            Some("resolve") => {
                let bug_id = args.get(3).ok_or("task bug resolve requires <bug-id>")?;
                let note = args.get(4).map(|s| s.as_str()).unwrap_or("");
                println!(
                    "{}",
                    emb_agent_core::bug_ops::bug_resolve(&ext_dir, bug_id, note)
                );
                Ok(())
            }
            _ => Err("task bug: expected add, list, or resolve".to_string()),
        },
        _ => Err("task: expected list, show, add, activate, resolve, aar, or bug".to_string()),
    }
}

fn print_help() {
    println!(
        "emb-agent-rs task\n\nUSAGE:\n  task list\n  task show <name>\n  task add <summary> [--priority P1]\n  task activate <name>\n  task aar status <name>\n  task aar scan <name> --no-lessons|--lessons\n  task aar record <name> <note>\n  task resolve <name> [note]\n  task bug add <parent-task> <summary>\n  task bug list [parent-task] [--variant <name>]\n  task bug resolve <bug-id> [note]\n\nGATES:\n  task resolve requires task aar scan. If scan uses --lessons, task aar record is required before resolve.\n"
    );
}
