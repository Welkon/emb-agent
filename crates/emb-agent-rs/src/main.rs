use std::env;
use std::path::{Path, PathBuf};

use emb_agent_core::{
    build_chip_diff_json, build_chip_swap_confirm_json, build_chip_swap_json,
    build_context_monitor_output, build_debug_output_json, build_health_json, build_hook_plan,
    build_hook_plan_json, build_hooks_diagnostics_json, build_host_session_start_payload,
    build_next_json, build_plan_output_json, build_project_state_json,
    build_project_state_paths_json, build_review_output_json, build_scan_output_json,
    build_session_context, build_start_json, build_status_json, build_statusline,
    build_task_list_json, build_task_show_json, build_verify_output_json, get_project_state_paths,
    json_string_field, project_state_from_cwd, read_all_tasks, read_task, snapshot_from_cwd,
    HookPlan, ProjectSnapshot, StatePathConfig,
};

fn main() {
    if let Err(error) = run(env::args().skip(1).collect()) {
        eprintln!("emb-agent-rs error: {error}");
        std::process::exit(1);
    }
}

fn action_cmd(args: &[String], builder: fn(&ProjectSnapshot) -> String) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let snapshot = snapshot_from_cwd(&cwd);
    println!("{}", builder(&snapshot));
    Ok(())
}

fn run(args: Vec<String>) -> Result<(), String> {
    let command = args.first().map(String::as_str).unwrap_or("help");

    match command {
        "statusline" => {
            let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
            let snapshot = snapshot_from_cwd(&cwd);
            println!("{}", build_statusline(&snapshot));
            Ok(())
        }
        "scan" => action_cmd(&args, build_scan_output_json),
        "plan" => action_cmd(&args, build_plan_output_json),
        "review" => action_cmd(&args, build_review_output_json),
        "verify" => action_cmd(&args, build_verify_output_json),
        "debug" => action_cmd(&args, build_debug_output_json),
        "chip" => match args.get(1).map(String::as_str) {
            Some("diff") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let from = option_value(&args, "--from").ok_or("missing --from")?;
                let to = option_value(&args, "--to").ok_or("missing --to")?;
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                println!("{}", build_chip_diff_json(&ext_dir, &from, &to));
                Ok(())
            }
            Some("swap") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let from = option_value(&args, "--from").ok_or("missing --from")?;
                let to = option_value(&args, "--to").ok_or("missing --to")?;
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                let hw_path = ext_dir.join("hw.yaml");
                let hw_yaml = std::fs::read_to_string(&hw_path).unwrap_or_default();
                if args.iter().any(|a| a == "--confirm") {
                    println!(
                        "{}",
                        build_chip_swap_confirm_json(&ext_dir, &hw_yaml, &from, &to)
                    );
                } else {
                    println!("{}", build_chip_swap_json(&ext_dir, &hw_yaml, &from, &to));
                }
                Ok(())
            }
            _ => Err("chip: expected diff or swap subcommand".to_string()),
        },
        "hook" => run_hook(&args),
        "diagnostics" => run_diagnostics(&args),
        "start" => {
            let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
            let snapshot = snapshot_from_cwd(&cwd);
            if args.iter().any(|arg| arg == "--json") || args.iter().any(|arg| arg == "--brief") {
                println!("{}", build_start_json(&snapshot));
            } else {
                println!("{}", build_session_context(&snapshot));
            }
            Ok(())
        }
        "next" => {
            let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
            let snapshot = snapshot_from_cwd(&cwd);
            if args.iter().any(|arg| arg == "--json") || args.iter().any(|arg| arg == "--brief") {
                println!("{}", build_next_json(&snapshot));
            } else {
                println!("{}", build_session_context(&snapshot));
            }
            Ok(())
        }
        "status" => {
            let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
            let snapshot = snapshot_from_cwd(&cwd);
            println!("{}", build_status_json(&snapshot));
            Ok(())
        }
        "task" => match args.get(1).map(String::as_str) {
            Some("list") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                let tasks = read_all_tasks(&ext_dir);
                println!("{}", build_task_list_json(&tasks));
                Ok(())
            }
            Some("show") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let name = args.get(2).ok_or("task show requires <name>")?;
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                match read_task(&ext_dir, name) {
                    Some(task) => {
                        println!("{}", build_task_show_json(&task.to_string()));
                        Ok(())
                    }
                    None => Err(format!("task not found: {name}")),
                }
            }
            Some("add") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let summary = args.get(2).map(|s| s.as_str()).unwrap_or("New task");
                let task_type =
                    option_value(&args, "--type").unwrap_or_else(|| "implement".to_string());
                let priority =
                    option_value(&args, "--priority").unwrap_or_else(|| "P2".to_string());
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                println!(
                    "{}",
                    emb_agent_core::task_ops::task_add(&ext_dir, summary, &task_type, &priority)
                );
                Ok(())
            }
            Some("activate") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let name = args.get(2).ok_or("task activate requires <name>")?;
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                println!(
                    "{}",
                    emb_agent_core::task_ops::task_activate(&ext_dir, name)
                );
                Ok(())
            }
            Some("resolve") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let name = args.get(2).ok_or("task resolve requires <name>")?;
                let note = args.get(3).map(|s| s.as_str()).unwrap_or("");
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                println!(
                    "{}",
                    emb_agent_core::task_ops::task_resolve(&ext_dir, name, note)
                );
                Ok(())
            }
            _ => Err("task: expected list, show, add, activate, or resolve".to_string()),
        },
        "health" => {
            let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
            let snapshot = snapshot_from_cwd(&cwd);
            println!("{}", build_health_json(&snapshot));
            Ok(())
        }
        "prd" => match args.get(1).map(String::as_str) {
            Some("status") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                println!("{}", emb_agent_core::prd_ops::prd_status(&ext_dir));
                Ok(())
            }
            _ => Err("prd: expected status".to_string()),
        },
        "doc" => match args.get(1).map(String::as_str) {
            Some("list") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                println!("{}", emb_agent_core::meta_ops::doc_list(&ext_dir));
                Ok(())
            }
            _ => Err("doc: expected list".to_string()),
        },
        "knowledge" => match args.get(1).map(String::as_str) {
            Some("status") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                println!("{}", emb_agent_core::meta_ops::knowledge_status(&ext_dir));
                Ok(())
            }
            _ => Err("knowledge: expected status".to_string()),
        },
        "session" => match args.get(1).map(String::as_str) {
            Some("show") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                println!("{}", emb_agent_core::meta_ops::session_show(&ext_dir));
                Ok(())
            }
            _ => Err("session: expected show".to_string()),
        },
        "context" => match args.get(1).map(String::as_str) {
            Some("show") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                println!("{}", emb_agent_core::meta_ops::context_show(&ext_dir));
                Ok(())
            }
            _ => Err("context: expected show".to_string()),
        },
        "bootstrap" => match args.get(1).map(String::as_str) {
            Some("status") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                println!("{}", emb_agent_core::meta_ops::bootstrap_status(&ext_dir));
                Ok(())
            }
            _ => Err("bootstrap: expected status".to_string()),
        },
        "declare" => match args.get(1).map(String::as_str) {
            Some("hardware") => {
                let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
                let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
                let mcu = option_value(&args, "--mcu").unwrap_or_default();
                let pkg = option_value(&args, "--package").unwrap_or_default();
                println!("{}", emb_agent_core::meta_ops::declare_hardware(&ext_dir, &mcu, &pkg));
                Ok(())
            }
            _ => Err("declare: expected hardware".to_string()),
        },
        "pause" => {
            let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
            let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
            let note = args.get(1).map(|s| s.as_str()).unwrap_or("");
            println!("{}", emb_agent_core::meta_ops::pause_session(&ext_dir, note));
            Ok(())
        },
        "resume" => {
            let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
            let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
            println!("{}", emb_agent_core::meta_ops::resume_session(&ext_dir));
            Ok(())
        },
        "resolve" => {
            let cwd = option_value(&args, "--cwd").unwrap_or_else(current_dir_string);
            let name = args.get(1).ok_or("resolve requires <task-name>")?;
            let note = args.get(2).map(|s| s.as_str()).unwrap_or("");
            let ext_dir = std::path::Path::new(&cwd).join(".emb-agent");
            println!("{}", emb_agent_core::task_ops::task_resolve(&ext_dir, name, note));
            Ok(())
        },
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        other => Err(format!("unknown command: {other}")),
    }
}

fn run_diagnostics(args: &[String]) -> Result<(), String> {
    let topic = args.get(1).map(String::as_str).unwrap_or("");
    match topic {
        "hooks" => {
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let runtime_dir =
                option_value(args, "--runtime-dir").unwrap_or_else(|| "runtime".to_string());
            println!(
                "{}",
                build_hooks_diagnostics_json(&host, Path::new(&runtime_dir))
            );
            Ok(())
        }
        "project" => {
            let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
            let state = project_state_from_cwd(&cwd);
            println!("{}", build_project_state_json(&state));
            Ok(())
        }
        "state-paths" => {
            let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
            let runtime_dir =
                option_value(args, "--runtime-dir").unwrap_or_else(|| "runtime".to_string());
            let paths = get_project_state_paths(
                Path::new(&runtime_dir),
                Path::new(&cwd),
                &StatePathConfig::default(),
            );
            println!("{}", build_project_state_paths_json(&paths));
            Ok(())
        }
        "" => Err("missing diagnostics topic; expected hooks, project, or state-paths".to_string()),
        other => Err(format!("unknown diagnostics topic: {other}")),
    }
}

fn run_hook(args: &[String]) -> Result<(), String> {
    let hook_name = args.get(1).map(String::as_str).unwrap_or("");
    match hook_name {
        "resolve" => {
            let plan = resolve_hook_plan_from_args(args);
            println!("{}", build_hook_plan_json(&plan));
            Ok(())
        }
        "session-start" => {
            let cwd = hook_cwd(args);
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let snapshot = snapshot_from_cwd(&cwd);
            let context = build_session_context(&snapshot);
            println!("{}", build_host_session_start_payload(&host, &context));
            Ok(())
        }
        "statusline" => {
            let cwd = hook_cwd(args);
            let snapshot = snapshot_from_cwd(&cwd);
            println!("{}", build_statusline(&snapshot));
            Ok(())
        }
        "context-monitor" => {
            let output = build_context_monitor_output(&stdin_payload_or_cwd(args));
            if !output.is_empty() {
                println!("{output}");
            }
            Ok(())
        }
        "" => Err(
            "missing hook name; expected resolve, session-start, statusline, or context-monitor"
                .to_string(),
        ),
        other => Err(format!("unknown hook: {other}")),
    }
}

fn print_help() {
    println!(
        "emb-agent-rs\n\nUSAGE:\n  Session:    start, next, status, health, pause [note], resume\n  Tasks:      task list, task show <name>, task add <summary>, task activate <name>, task resolve <name> [note], resolve <name>\n  Chips:      chip diff --from X --to Y, chip swap --from X --to Y [--confirm]\n  Actions:    scan, plan, do, review, verify, debug [--cwd DIR]\n  Truth:      prd status, doc list, knowledge status, session show, context show\n  Hardware:   declare hardware --mcu <name> [--package <name>], bootstrap status\n  Hooks:      hook session-start|statusline|context-monitor, statusline\n  Diag:       diagnostics hooks|project|state-paths --json\n  Options:    --cwd DIR, --brief, --json\n"
    );
}

fn current_dir_string() -> String {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .to_string_lossy()
        .to_string()
}

fn option_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

fn hook_cwd(args: &[String]) -> String {
    option_value(args, "--cwd")
        .or_else(|| stdin_json_string_field("cwd"))
        .unwrap_or_else(current_dir_string)
}

fn stdin_json_string_field(key: &str) -> Option<String> {
    let raw = read_stdin_payload()?;
    let value = json_string_field(&raw, key);
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn stdin_payload_or_cwd(args: &[String]) -> String {
    let raw = read_stdin_payload().unwrap_or_default();
    if raw.trim().is_empty() {
        format!(
            "{{\"cwd\":{},\"workspace_trusted\":true}}",
            emb_agent_core::json_quote(
                &option_value(args, "--cwd").unwrap_or_else(current_dir_string)
            )
        )
    } else {
        raw
    }
}

fn read_stdin_payload() -> Option<String> {
    use std::io::{IsTerminal, Read};
    let mut stdin = std::io::stdin();
    if stdin.is_terminal() {
        return None;
    }
    let mut raw = String::new();
    if stdin.read_to_string(&mut raw).is_err() {
        return None;
    }
    Some(raw)
}

fn resolve_hook_plan_from_args(args: &[String]) -> HookPlan {
    let hook = option_value(args, "--hook").unwrap_or_else(|| "session-start".to_string());
    let host = option_value(args, "--host").unwrap_or_else(|| "external".to_string());
    let runtime_dir = option_value(args, "--runtime-dir").unwrap_or_else(|| "runtime".to_string());

    // Read per-hook config from the project if a --cwd was provided
    let hook_config = option_value(args, "--cwd").and_then(|cwd| {
        let state = project_state_from_cwd(&cwd);
        if state.initialized {
            Some(state.config.hooks)
        } else {
            None
        }
    });

    build_hook_plan(&host, &hook, Path::new(&runtime_dir), hook_config.as_ref())
}
