use super::util::{current_dir_string, hook_cwd, option_value, stdin_payload_or_cwd};
use emb_agent_core::{
    StatePathConfig, build_context_monitor_output, build_hooks_diagnostics_json,
    build_host_session_start_payload, build_project_state_json, build_project_state_paths_json,
    build_session_context, build_statusline, build_welcome_message, get_project_state_paths,
    project_state_from_cwd, snapshot_from_cwd,
};
use std::path::Path;

pub fn run_hook(args: &[String]) -> Result<(), String> {
    match args.get(1).map(String::as_str).unwrap_or("") {
        "resolve" => {
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let runtime_dir =
                option_value(args, "--runtime-dir").unwrap_or_else(|| "runtime".to_string());
            let plan = emb_agent_core::build_hook_plan(
                &host,
                "session-start",
                Path::new(&runtime_dir),
                None,
            );
            println!("{}", emb_agent_core::build_hook_plan_json(&plan));
            Ok(())
        }
        "session-start" => {
            let cwd = hook_cwd(args);
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let snapshot = snapshot_from_cwd(&cwd);
            let context = build_session_context(&snapshot);
            let welcome = build_welcome_message(&snapshot);
            println!(
                "{}",
                build_host_session_start_payload(&host, &context, &welcome)
            );
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
        "" => Err("missing hook name".to_string()),
        other => Err(format!("unknown hook: {other}")),
    }
}

pub fn run_diagnostics(args: &[String]) -> Result<(), String> {
    match args.get(1).map(String::as_str).unwrap_or("") {
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
        "" => Err("missing diagnostics topic".to_string()),
        other => Err(format!("unknown diagnostics topic: {other}")),
    }
}
