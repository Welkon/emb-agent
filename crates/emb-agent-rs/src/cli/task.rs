use super::util::{current_dir_string, option_value};
use emb_agent_core::{build_task_list_json, read_all_tasks, read_task};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

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
            let output = emb_agent_core::task::task_ops::task_add_with_deps(
                &ext_dir,
                summary,
                &task_type,
                &priority,
                &blocked_by,
            );
            println!("{}", output);
            if let Some(name) = json_string_field(&output, "name") {
                run_lifecycle_hooks(Path::new(&cwd), &ext_dir, "after_create", &name);
            }
            Ok(())
        }
        Some("activate") => {
            let name = args.get(2).ok_or("task activate requires <name>")?;
            let use_worktree = args.iter().any(|a| a == "--worktree");
            let output = emb_agent_core::task::task_ops::task_activate_with_options(
                &ext_dir,
                name,
                use_worktree,
            );
            println!("{}", output);
            run_lifecycle_hooks(Path::new(&cwd), &ext_dir, "after_start", name);
            Ok(())
        }
        Some("resolve") => {
            let name = args
                .get(2)
                .filter(|arg| !arg.starts_with("--"))
                .cloned()
                .or_else(|| active_task_name(&ext_dir))
                .ok_or("task resolve requires <name> or an active task")?;
            let note = args.get(3).map(|s| s.as_str()).unwrap_or("");
            let output = emb_agent_core::task::task_ops::task_resolve(&ext_dir, &name, note);
            println!("{}", output);
            run_lifecycle_hooks(Path::new(&cwd), &ext_dir, "after_finish", &name);
            Ok(())
        }
        Some("delete") => {
            let name = args.get(2).ok_or("task delete requires <name>")?;
            let output = emb_agent_core::task::task_ops::task_delete(&ext_dir, name);
            println!("{}", output);
            run_lifecycle_hooks(Path::new(&cwd), &ext_dir, "after_archive", name);
            Ok(())
        }
        Some("aar") => match args.get(2).map(String::as_str) {
            Some("status") => {
                let name = args
                    .get(3)
                    .filter(|arg| !arg.starts_with("--"))
                    .cloned()
                    .or_else(|| active_task_name(&ext_dir))
                    .ok_or("task aar status requires <name> or an active task")?;
                println!(
                    "{}",
                    emb_agent_core::task::task_ops::task_aar_status(&ext_dir, &name)
                );
                Ok(())
            }
            Some("scan") => {
                let name = args
                    .get(3)
                    .filter(|arg| !arg.starts_with("--"))
                    .cloned()
                    .or_else(|| active_task_name(&ext_dir))
                    .ok_or("task aar scan requires <name> or an active task")?;
                let lessons = if args.iter().any(|a| a == "--lessons") {
                    Some(true)
                } else if args.iter().any(|a| a == "--no-lessons") {
                    Some(false)
                } else {
                    None
                };
                println!(
                    "{}",
                    emb_agent_core::task::task_ops::task_aar_scan(&ext_dir, &name, lessons)
                );
                Ok(())
            }
            Some("record") => {
                let name = args
                    .get(3)
                    .filter(|arg| !arg.starts_with("--"))
                    .cloned()
                    .or_else(|| active_task_name(&ext_dir))
                    .ok_or("task aar record requires <name> or an active task")?;
                let note = if args.get(3).map(|arg| arg.starts_with("--")).unwrap_or(true) {
                    args.get(3).map(|s| s.as_str()).unwrap_or("")
                } else {
                    args.get(4).map(|s| s.as_str()).unwrap_or("")
                };
                println!(
                    "{}",
                    emb_agent_core::task::task_ops::task_aar_record(&ext_dir, &name, note)
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

fn json_string_field(raw: &str, key: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    value
        .get("task")
        .and_then(|task| task.get(key))
        .and_then(serde_json::Value::as_str)
        .or_else(|| value.get(key).and_then(serde_json::Value::as_str))
        .map(str::to_string)
}

fn run_lifecycle_hooks(project_root: &Path, ext_dir: &Path, hook: &str, task_name: &str) {
    let commands = configured_hook_commands(&ext_dir.join("config.yaml"), hook);
    if commands.is_empty() {
        return;
    }
    let task_json = task_json_path(ext_dir, task_name);
    for command in commands {
        let status = Command::new(shell_binary())
            .arg(shell_arg())
            .arg(&command)
            .current_dir(project_root)
            .env("TASK_JSON_PATH", task_json.to_string_lossy().to_string())
            .status();
        match status {
            Ok(status) if status.success() => {}
            Ok(status) => {
                eprintln!("emb-agent lifecycle hook {hook} exited with {status}: {command}")
            }
            Err(error) => eprintln!("emb-agent lifecycle hook {hook} failed: {error}: {command}"),
        }
    }
}

fn configured_hook_commands(config_path: &Path, hook: &str) -> Vec<String> {
    let Ok(text) = fs::read_to_string(config_path) else {
        return Vec::new();
    };
    let mut in_hooks = false;
    let mut in_target = false;
    let mut out = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if !line.starts_with(' ') && trimmed.ends_with(':') {
            in_hooks = trimmed == "hooks:";
            in_target = false;
            continue;
        }
        if !in_hooks {
            continue;
        }
        if line.starts_with("  ") && !line.starts_with("    ") && trimmed.ends_with(':') {
            in_target = trimmed.trim_end_matches(':') == hook;
            continue;
        }
        if in_target && trimmed.starts_with('-') {
            let command = trimmed
                .trim_start_matches('-')
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();
            if !command.is_empty() {
                out.push(command);
            }
        }
    }
    out
}

fn task_json_path(ext_dir: &Path, task_name: &str) -> PathBuf {
    ext_dir.join("tasks").join(task_name).join("task.json")
}

fn shell_binary() -> &'static str {
    if cfg!(windows) { "cmd" } else { "sh" }
}

fn shell_arg() -> &'static str {
    if cfg!(windows) { "/C" } else { "-c" }
}

fn active_task_name(ext_dir: &Path) -> Option<String> {
    let state_dir = emb_agent_core::variant_ops::active_state_dir(ext_dir);
    let name = fs::read_to_string(state_dir.join(".current-task")).ok()?;
    let name = name.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn print_help() {
    println!(
        "emb-agent-rs task\n\nUSAGE:\n  task list\n  task show <name>\n  task add <summary> [--priority P1]\n  task activate <name> [--worktree]\n  task delete <name>\n  task aar status <name>\n  task aar scan <name> --no-lessons|--lessons\n  task aar record <name> <note>\n  task resolve <name> [note]\n  task worktree list\n  task worktree status [name]\n  task worktree show <name>\n  task worktree create <name> [--branch <branch>] [--base <base>]\n  task worktree cleanup <name>\n  task bug add <parent-task> <summary>\n  task bug list [parent-task] [--variant <name>]\n  task bug resolve <bug-id> [note]\n\nSTATUS FLOW:\n  pending → in_progress → completed → deleted\n  pending ⇄ in_progress (reversible)\n  completed can be re-activated to in_progress\n\nNOTES:\n  task containers are recommended for multi-step or resumable work, but narrow explanations,\n  one-off verification, and small scoped fixes can often stay direct.\n  task resolve auto-records a minimal no-lessons AAR when no durable lesson was captured.\n  If task aar scan uses --lessons, task aar record is still required before resolve.\n"
    );
}
