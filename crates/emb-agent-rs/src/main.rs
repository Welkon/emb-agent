use std::env;
use std::path::{Path, PathBuf};

use emb_agent_core::{
    build_chip_diff_json, build_chip_swap_json, build_context_monitor_output,
    build_debug_output_json, build_hook_plan, build_hook_plan_json, build_hooks_diagnostics_json,
    build_host_session_start_payload, build_plan_output_json, build_project_state_json,
    build_project_state_paths_json, build_review_output_json, build_scan_output_json,
    build_session_context, build_start_json, build_statusline, build_verify_output_json,
    get_project_state_paths, json_string_field, project_state_from_cwd, snapshot_from_cwd,
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
                println!("{}", build_chip_swap_json(&ext_dir, &hw_yaml, &from, &to));
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
        "emb-agent-rs\n\nUSAGE:\n  emb-agent-rs scan [--cwd DIR]\n  emb-agent-rs plan [--cwd DIR]\n  emb-agent-rs review [--cwd DIR]\n  emb-agent-rs verify [--cwd DIR]\n  emb-agent-rs debug [--cwd DIR]\n  emb-agent-rs start --brief --json [--cwd DIR]\n  emb-agent-rs statusline [--cwd DIR]\n  emb-agent-rs hook resolve --hook session-start --host pi --runtime-dir ./runtime --json\n  emb-agent-rs hook session-start [--cwd DIR] [--host pi|codex|cursor]\n  emb-agent-rs hook statusline [--cwd DIR]\n  emb-agent-rs hook context-monitor [--cwd DIR]\n  emb-agent-rs diagnostics hooks --json [--host pi] [--runtime-dir ./runtime]\n  emb-agent-rs diagnostics project --json [--cwd DIR]\n  emb-agent-rs diagnostics state-paths --json [--cwd DIR] [--runtime-dir ./runtime]\n"
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
