use super::util::{current_dir_string, option_value};
use emb_agent_core::{build_task_list_json, read_all_tasks, read_task};
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
                    let tasks_dir = ext_dir.join("tasks");
                    let blocked_info = emb_agent_core::blocked_by_summary(&tasks_dir, name);
                    let mut value = task;
                    if let Some(obj) = value.as_object_mut()
                        && let Ok(info) = serde_json::from_str::<serde_json::Value>(&format!(
                            "{{{blocked_info}}}"
                        ))
                    {
                        for (k, v) in info.as_object().unwrap_or(&serde_json::Map::new()) {
                            obj.insert(k.clone(), v.clone());
                        }
                    }
                    println!(
                        "{}",
                        serde_json::to_string_pretty(&value).unwrap_or_default()
                    );
                    Ok(())
                }
                None => Err(format!("task not found: {name}")),
            }
        }
        Some("add") => {
            let summary = args.get(2).map(|s| s.as_str()).unwrap_or("New task");
            let task_type = option_value(args, "--category")
                .or_else(|| option_value(args, "--type"))
                .unwrap_or_else(|| "feature".to_string());
            let priority = option_value(args, "--priority").unwrap_or_else(|| "P2".to_string());
            let blocked_by_str = option_value(args, "--blocked-by").unwrap_or_default();
            let blocked_by: Vec<String> = if blocked_by_str.is_empty() {
                vec![]
            } else {
                blocked_by_str
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            };
            println!(
                "{}",
                emb_agent_core::task::task_ops::task_add_with_deps(
                    &ext_dir,
                    summary,
                    &task_type,
                    &priority,
                    &blocked_by,
                )
            );
            Ok(())
        }
        Some("activate") => {
            let name = args.get(2).ok_or("task activate requires <name>")?;
            let use_worktree = args.iter().any(|a| a == "--worktree");
            println!(
                "{}",
                emb_agent_core::task::task_ops::task_activate_with_options(
                    &ext_dir,
                    name,
                    use_worktree,
                )
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
        Some("delete") => {
            let name = args.get(2).ok_or("task delete requires <name>")?;
            println!(
                "{}",
                emb_agent_core::task::task_ops::task_delete(&ext_dir, name)
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
        Some("worktree") => match args.get(2).map(String::as_str) {
            Some("list") => {
                println!(
                    "{}",
                    emb_agent_core::task::task_ops::task_worktree_list(&ext_dir)
                );
                Ok(())
            }
            Some("status") => {
                if let Some(name) = args.get(3).filter(|s| !s.starts_with("--")) {
                    let worktree = serde_json::from_str::<serde_json::Value>(
                        &emb_agent_core::task::task_ops::task_worktree_show(&ext_dir, name),
                    )
                    .unwrap_or_default();
                    let policy = emb_agent_core::evaluate_worktree_policy(
                        &ext_dir,
                        Path::new(&cwd),
                        Some(name),
                    );
                    println!(
                        "{}",
                        serde_json::json!({
                            "status": "ok",
                            "worktree_status": worktree,
                            "worktree_policy": emb_agent_core::worktree_policy_json(&policy)
                        })
                    );
                } else {
                    let policy =
                        emb_agent_core::evaluate_worktree_policy(&ext_dir, Path::new(&cwd), None);
                    println!(
                        "{}",
                        serde_json::json!({
                            "status": "ok",
                            "worktree_policy": emb_agent_core::worktree_policy_json(&policy)
                        })
                    );
                }
                Ok(())
            }
            Some("show") => {
                let name = args.get(3).ok_or("task worktree show requires <name>")?;
                println!(
                    "{}",
                    emb_agent_core::task::task_ops::task_worktree_show(&ext_dir, name)
                );
                Ok(())
            }
            Some("create") => {
                let name = args.get(3).ok_or("task worktree create requires <name>")?;
                println!(
                    "{}",
                    emb_agent_core::task::task_ops::task_worktree_create(
                        &ext_dir,
                        name,
                        option_value(args, "--branch").as_deref(),
                        option_value(args, "--base").as_deref(),
                    )
                );
                Ok(())
            }
            Some("cleanup") => {
                let name = args.get(3).ok_or("task worktree cleanup requires <name>")?;
                println!(
                    "{}",
                    emb_agent_core::task::task_ops::task_worktree_cleanup(&ext_dir, name)
                );
                Ok(())
            }
            _ => Err("task worktree: expected list, show/status, create, or cleanup".to_string()),
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
        _ => Err(
            "task: expected list, show, add, activate, resolve, delete, aar, worktree, or bug"
                .to_string(),
        ),
    }
}

fn print_help() {
    println!(
        "emb-agent-rs task\n\nUSAGE:\n  task list\n  task show <name>\n  task add <summary> [--priority P1]\n  task activate <name> [--worktree]\n  task delete <name>\n  task aar status <name>\n  task aar scan <name> --no-lessons|--lessons\n  task aar record <name> <note>\n  task resolve <name> [note]\n  task worktree list\n  task worktree status [name]\n  task worktree show <name>\n  task worktree create <name> [--branch <branch>] [--base <base>]\n  task worktree cleanup <name>\n  task bug add <parent-task> <summary>\n  task bug list [parent-task] [--variant <name>]\n  task bug resolve <bug-id> [note]\n\nSTATUS FLOW:\n  pending → in_progress → completed → deleted\n  pending ⇄ in_progress (reversible)\n  completed can be re-activated to in_progress\n\nGATES:\n  task resolve requires task aar scan. If scan uses --lessons, task aar record is required before resolve.\n"
    );
}
