use super::util::{
    current_dir_string, hook_cwd, option_value, positional_after, stdin_payload_or_cwd,
};
use emb_agent_core::{
    StatePathConfig, build_context_monitor_output_for_host, build_hooks_diagnostics_json,
    build_host_session_start_payload_for_trigger, build_project_state_json,
    build_project_state_paths_json, build_session_context_for_trigger, build_statusline,
    build_welcome_message, get_project_state_paths, project_state_from_cwd, snapshot_from_cwd,
};
use std::path::Path;

fn default_runtime_dir() -> String {
    if let Ok(exe) = std::env::current_exe()
        && let Some(bin_dir) = exe.parent()
        && bin_dir.file_name().and_then(|name| name.to_str()) == Some("bin")
        && let Some(runtime_dir) = bin_dir.parent()
    {
        return runtime_dir.to_string_lossy().to_string();
    }
    "runtime".to_string()
}

fn hook_trigger(payload: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) else {
        return "startup".to_string();
    };
    [
        "source",
        "matcher",
        "session_event",
        "reason",
        "hookEvent",
        "hook_event_name",
        "event",
    ]
    .into_iter()
    .find_map(|key| {
        value
            .get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToOwned::to_owned)
    })
    .unwrap_or_else(|| "startup".to_string())
}

pub fn run_hook(args: &[String]) -> Result<(), String> {
    match args.get(1).map(String::as_str).unwrap_or("") {
        "resolve" => {
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let hook = positional_after(args, 2).unwrap_or_else(|| "session-start".to_string());
            let runtime_dir =
                option_value(args, "--runtime-dir").unwrap_or_else(default_runtime_dir);
            let plan = emb_agent_core::build_hook_plan(&host, &hook, Path::new(&runtime_dir), None);
            println!("{}", emb_agent_core::build_hook_plan_json(&plan));
            Ok(())
        }
        "session-start" => {
            let raw_payload = stdin_payload_or_cwd(args);
            let cwd = serde_json::from_str::<serde_json::Value>(&raw_payload)
                .ok()
                .and_then(|value| {
                    value
                        .get("cwd")
                        .and_then(serde_json::Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| hook_cwd(args));
            let trigger = hook_trigger(&raw_payload);
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let ext_dir = Path::new(&cwd).join(".emb-agent");
            let _ = emb_agent_core::record_session_heartbeat(&ext_dir, Path::new(&cwd), &host);
            let snapshot = snapshot_from_cwd(&cwd);
            let context = build_session_context_for_trigger(&snapshot, &trigger);
            let welcome = if trigger.eq_ignore_ascii_case("startup") {
                build_welcome_message(&snapshot)
            } else {
                String::new()
            };
            println!(
                "{}",
                build_host_session_start_payload_for_trigger(&host, &context, &welcome, &trigger)
            );
            Ok(())
        }
        "statusline" => {
            let cwd = hook_cwd(args);
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let ext_dir = Path::new(&cwd).join(".emb-agent");
            let _ = emb_agent_core::record_session_heartbeat(&ext_dir, Path::new(&cwd), &host);
            let snapshot = snapshot_from_cwd(&cwd);
            println!("{}", build_statusline(&snapshot));
            Ok(())
        }
        "context-monitor" => {
            let host_arg = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let raw_payload = stdin_payload_or_cwd(args);
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw_payload)
                && let Some(cwd) = value.get("cwd").and_then(serde_json::Value::as_str)
            {
                let host = value
                    .get("host")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&host_arg);
                let ext_dir = Path::new(cwd).join(".emb-agent");
                let _ = emb_agent_core::record_session_heartbeat(&ext_dir, Path::new(cwd), host);
            }
            let output = build_context_monitor_output_for_host(&raw_payload, &host_arg);
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
                option_value(args, "--runtime-dir").unwrap_or_else(default_runtime_dir);
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
                option_value(args, "--runtime-dir").unwrap_or_else(default_runtime_dir);
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
