use super::config::{record_session_journal, run_configured_hooks};
use super::util::{
    current_dir_string, hook_cwd, option_value, positional_after, stdin_payload_or_cwd,
};
use emb_agent_core::{
    StatePathConfig, build_context_monitor_output_for_host, build_hooks_diagnostics_json,
    build_host_session_start_payload_for_trigger, build_project_state_json,
    build_project_state_paths_json, build_session_context_for_trigger,
    build_shell_session_context_output_for_host, build_statusline_for_host,
    build_subagent_context_output_for_host, build_tool_guard_output_for_host,
    build_welcome_message, get_project_state_paths, project_state_from_cwd, snapshot_from_cwd,
};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const UPDATE_HINT_TIMEOUT: Duration = Duration::from_millis(1500);
const UPDATE_HINT_COMMAND: &str = "npx emb-agent@latest update --target all --local";

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
        "event" => {
            let name = option_value(args, "--name")
                .or_else(|| positional_after(args, 2))
                .ok_or("hook event requires --name <event>")?;
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
            let host = option_value(args, "--host").unwrap_or_else(|| "external".to_string());
            let project_root = Path::new(&cwd);
            record_session_journal(project_root, &host, &name, &raw_payload);
            run_configured_hooks(
                project_root,
                &name,
                &[("EMB_AGENT_SESSION_EVENT", name.clone())],
            );
            println!("{}", serde_json::json!({"status":"ok","event":name}));
            Ok(())
        }
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
            let project_root = Path::new(&cwd);
            let ext_dir = project_root.join(".emb-agent");
            let _ = emb_agent_core::record_session_heartbeat(&ext_dir, project_root, &host);
            record_session_journal(project_root, &host, &trigger, &raw_payload);
            run_configured_hooks(
                project_root,
                "session_start",
                &[("EMB_AGENT_SESSION_EVENT", trigger.clone())],
            );
            let snapshot = snapshot_from_cwd(&cwd);
            let mut context = build_session_context_for_trigger(&snapshot, &trigger);
            if let Some(update_hint) =
                session_update_hint(project_root, &raw_payload, &trigger, &host)
            {
                context = format!("{update_hint}\n\n{context}");
            }
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
        "session-end" => {
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
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let project_root = Path::new(&cwd);
            record_session_journal(project_root, &host, "session_end", &raw_payload);
            run_configured_hooks(
                project_root,
                "session_end",
                &[("EMB_AGENT_SESSION_EVENT", "session_end".to_string())],
            );
            println!("{{\"status\":\"ok\",\"event\":\"session_end\"}}");
            Ok(())
        }
        "statusline" => {
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
            let host = option_value(args, "--host").unwrap_or_else(|| "pi".to_string());
            let project_root = Path::new(&cwd);
            let ext_dir = project_root.join(".emb-agent");
            let _ = emb_agent_core::record_session_heartbeat(&ext_dir, project_root, &host);
            record_session_journal(project_root, &host, "statusline", "");
            let snapshot = snapshot_from_cwd(&cwd);
            println!(
                "{}",
                build_statusline_for_host(&snapshot, &host, &raw_payload)
            );
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
                let project_root = Path::new(cwd);
                let ext_dir = project_root.join(".emb-agent");
                let _ = emb_agent_core::record_session_heartbeat(&ext_dir, project_root, host);
                record_session_journal(project_root, host, "context-monitor", &raw_payload);
                run_configured_hooks(
                    project_root,
                    "after_tool",
                    &[("EMB_AGENT_SESSION_EVENT", "after_tool".to_string())],
                );
            }
            let output = build_context_monitor_output_for_host(&raw_payload, &host_arg);
            if !output.is_empty() {
                println!("{output}");
            }
            Ok(())
        }
        "tool-guard" => {
            let host_arg = option_value(args, "--host").unwrap_or_else(|| "codex".to_string());
            let raw_payload = stdin_payload_or_cwd(args);
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw_payload)
                && let Some(cwd) = value.get("cwd").and_then(serde_json::Value::as_str)
            {
                let host = value
                    .get("host")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&host_arg);
                let project_root = Path::new(cwd);
                let ext_dir = project_root.join(".emb-agent");
                let _ = emb_agent_core::record_session_heartbeat(&ext_dir, project_root, host);
                record_session_journal(project_root, host, "tool-guard", &raw_payload);
                run_configured_hooks(
                    project_root,
                    "before_tool",
                    &[("EMB_AGENT_SESSION_EVENT", "before_tool".to_string())],
                );
            }
            let output = build_tool_guard_output_for_host(&raw_payload, &host_arg);
            if !output.is_empty() {
                println!("{output}");
            }
            Ok(())
        }
        "subagent-context" => {
            let host_arg = option_value(args, "--host").unwrap_or_else(|| "codex".to_string());
            let raw_payload = stdin_payload_or_cwd(args);
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw_payload)
                && let Some(cwd) = value.get("cwd").and_then(serde_json::Value::as_str)
            {
                let host = value
                    .get("host")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&host_arg);
                let project_root = Path::new(cwd);
                let ext_dir = project_root.join(".emb-agent");
                let _ = emb_agent_core::record_session_heartbeat(&ext_dir, project_root, host);
                record_session_journal(project_root, host, "subagent-context", &raw_payload);
                run_configured_hooks(
                    project_root,
                    "before_tool",
                    &[("EMB_AGENT_SESSION_EVENT", "before_tool".to_string())],
                );
            }
            let output = build_subagent_context_output_for_host(&raw_payload, &host_arg);
            if !output.is_empty() {
                println!("{output}");
            }
            Ok(())
        }
        "shell-session" => {
            let host_arg = option_value(args, "--host").unwrap_or_else(|| "cursor".to_string());
            let raw_payload = stdin_payload_or_cwd(args);
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw_payload)
                && let Some(cwd) = value.get("cwd").and_then(serde_json::Value::as_str)
            {
                let host = value
                    .get("host")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&host_arg);
                let project_root = Path::new(cwd);
                let ext_dir = project_root.join(".emb-agent");
                let _ = emb_agent_core::record_session_heartbeat(&ext_dir, project_root, host);
                record_session_journal(project_root, host, "shell-session", &raw_payload);
                run_configured_hooks(
                    project_root,
                    "shell_session",
                    &[("EMB_AGENT_SESSION_EVENT", "shell_session".to_string())],
                );
            }
            let output = build_shell_session_context_output_for_host(&raw_payload, &host_arg);
            if !output.is_empty() {
                println!("{output}");
            }
            Ok(())
        }
        "" => Err("missing hook name".to_string()),
        other => Err(format!("unknown hook: {other}")),
    }
}

fn session_update_hint(
    project_root: &Path,
    raw_payload: &str,
    trigger: &str,
    host: &str,
) -> Option<String> {
    if !should_check_update_hint(trigger) || update_hint_disabled() {
        return None;
    }
    let ext_dir = project_root.join(".emb-agent");
    if !ext_dir.is_dir() {
        return None;
    }
    let marker = update_hint_marker_path(&ext_dir, raw_payload);
    if marker.exists() {
        return None;
    }
    let current_version = read_project_version(&ext_dir)?;
    let latest_version = resolve_latest_update_version(project_root, host)?;
    mark_update_hint_checked(&marker);
    let comparison = compare_versions(&current_version, &latest_version)?;
    if comparison >= 0 {
        return None;
    }
    Some(format!(
        "emb-agent update available: {current_version} -> {latest_version}, run {UPDATE_HINT_COMMAND}"
    ))
}

fn should_check_update_hint(trigger: &str) -> bool {
    matches!(
        trigger.trim().to_ascii_lowercase().as_str(),
        "startup" | "clear" | "compact"
    )
}

fn update_hint_disabled() -> bool {
    matches!(
        std::env::var("EMB_AGENT_UPDATE_HINT")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "0" | "false" | "off" | "no"
    ) || matches!(
        std::env::var("EMB_AGENT_DISABLE_UPDATE_HINT")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "on" | "yes"
    )
}

fn read_project_version(ext_dir: &Path) -> Option<String> {
    read_install_runtime_version(ext_dir).or_else(|| {
        fs::read_to_string(ext_dir.join(".version"))
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn read_install_runtime_version(ext_dir: &Path) -> Option<String> {
    let raw = fs::read_to_string(ext_dir.join(".install").join("runtime-version.json")).ok()?;
    let value = serde_json::from_str::<Value>(&raw).ok()?;
    value
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            value
                .get("hosts")
                .and_then(Value::as_array)
                .and_then(|hosts| {
                    hosts.iter().find_map(|host| {
                        host.get("version")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|item| !item.is_empty())
                            .map(ToOwned::to_owned)
                    })
                })
        })
}

fn update_hint_marker_path(ext_dir: &Path, raw_payload: &str) -> PathBuf {
    let key = update_context_key(raw_payload);
    ext_dir
        .join(".runtime")
        .join(format!("update-check-{}.marker", safe_marker_key(&key)))
}

fn update_context_key(raw_payload: &str) -> String {
    let payload = serde_json::from_str::<Value>(raw_payload).unwrap_or(Value::Null);
    for key in [
        "session_id",
        "sessionId",
        "conversation_id",
        "conversationId",
        "thread_id",
        "threadId",
        "context_id",
        "contextId",
        "transcript_path",
        "transcriptPath",
    ] {
        if let Some(value) = payload
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
        {
            return value.to_string();
        }
    }
    for key in [
        "EMB_AGENT_CONTEXT_ID",
        "EMB_AGENT_SESSION_ID",
        "CURSOR_SESSION_ID",
        "CODEX_SESSION_ID",
        "CLAUDE_SESSION_ID",
        "PI_SESSION_ID",
        "TERM_SESSION_ID",
    ] {
        if let Ok(value) = std::env::var(key) {
            let value = value.trim();
            if !value.is_empty() {
                return value.to_string();
            }
        }
    }
    parent_process_key()
}

#[cfg(unix)]
fn parent_process_key() -> String {
    format!("ppid-{}", std::os::unix::process::parent_id())
}

#[cfg(not(unix))]
fn parent_process_key() -> String {
    format!("pid-{}", std::process::id())
}

fn safe_marker_key(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            out.push(ch);
        } else if !out.ends_with('_') {
            out.push('_');
        }
        if out.len() >= 160 {
            break;
        }
    }
    let out = out.trim_matches(['.', '_', '-']).to_string();
    if out.is_empty() {
        "session".to_string()
    } else {
        out
    }
}

fn mark_update_hint_checked(marker: &Path) {
    if let Some(parent) = marker.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(marker, "checked\n");
}

fn resolve_latest_update_version(project_root: &Path, host: &str) -> Option<String> {
    if let Ok(output) = std::env::var("EMB_AGENT_UPDATE_CHECK_OUTPUT") {
        if output.trim() == "__NONE__" {
            return None;
        }
        return extract_latest_update_version(&output);
    }
    let wrapper = update_check_wrapper(project_root, host)?;
    let output = run_update_check_wrapper(&wrapper)?;
    extract_latest_update_version(&output)
}

fn update_check_wrapper(project_root: &Path, host: &str) -> Option<PathBuf> {
    let host_dir = match host {
        "codex" => ".codex",
        "cursor" => ".cursor",
        "claude" => ".claude",
        "pi" => ".pi",
        "omp" => ".omp",
        "windsurf" => ".windsurf",
        _ => "",
    };
    if !host_dir.is_empty() {
        let path = project_root
            .join(host_dir)
            .join("emb-agent")
            .join("bin")
            .join("emb-agent.cjs");
        if path.exists() {
            return Some(path);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let sibling = exe.parent()?.join("emb-agent.cjs");
    if sibling.exists() {
        Some(sibling)
    } else {
        None
    }
}

fn run_update_check_wrapper(wrapper: &Path) -> Option<String> {
    let mut child = Command::new("node")
        .arg(wrapper)
        .arg("update")
        .arg("--brief")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let start = Instant::now();
    loop {
        if child.try_wait().ok()?.is_some() {
            let output = child.wait_with_output().ok()?;
            if !output.status.success() {
                return None;
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            if !stdout.trim().is_empty() {
                return Some(stdout.to_string());
            }
            return Some(String::from_utf8_lossy(&output.stderr).to_string());
        }
        if start.elapsed() >= UPDATE_HINT_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn extract_latest_update_version(output: &str) -> Option<String> {
    if let Ok(value) = serde_json::from_str::<Value>(output)
        && let Some(latest) = value
            .get("latest_version")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
    {
        return Some(latest.to_string());
    }
    version_tokens(output).pop()
}

fn version_tokens(output: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in output.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' {
            current.push(ch);
        } else if !current.is_empty() {
            if parse_version(&current).is_some() {
                tokens.push(current.clone());
            }
            current.clear();
        }
    }
    if !current.is_empty() && parse_version(&current).is_some() {
        tokens.push(current);
    }
    tokens
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedVersion {
    numbers: [u64; 3],
    prerelease: Option<Vec<String>>,
}

fn parse_version(value: &str) -> Option<ParsedVersion> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let (number_part, prerelease) = value
        .split_once('-')
        .map(|(left, right)| (left, Some(right)))
        .unwrap_or((value, None));
    let pieces = number_part.split('.').collect::<Vec<_>>();
    if pieces.is_empty() || pieces.len() > 3 {
        return None;
    }
    let mut numbers = [0_u64; 3];
    for (index, piece) in pieces.iter().enumerate() {
        if piece.is_empty() || !piece.chars().all(|ch| ch.is_ascii_digit()) {
            return None;
        }
        numbers[index] = piece.parse::<u64>().ok()?;
    }
    let prerelease = prerelease
        .map(|value| {
            value
                .split('.')
                .map(|piece| piece.trim().to_string())
                .filter(|piece| !piece.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|pieces| !pieces.is_empty());
    Some(ParsedVersion {
        numbers,
        prerelease,
    })
}

fn compare_versions(left: &str, right: &str) -> Option<i8> {
    let left = parse_version(left)?;
    let right = parse_version(right)?;
    if left.numbers != right.numbers {
        return Some(if left.numbers > right.numbers { 1 } else { -1 });
    }
    Some(compare_prerelease(
        left.prerelease.as_deref(),
        right.prerelease.as_deref(),
    ))
}

fn compare_prerelease(left: Option<&[String]>, right: Option<&[String]>) -> i8 {
    match (left, right) {
        (None, None) => 0,
        (None, Some(_)) => 1,
        (Some(_), None) => -1,
        (Some(left), Some(right)) => {
            for (left_part, right_part) in left.iter().zip(right.iter()) {
                if left_part == right_part {
                    continue;
                }
                let left_num = left_part.parse::<u64>().ok();
                let right_num = right_part.parse::<u64>().ok();
                return match (left_num, right_num) {
                    (Some(left_num), Some(right_num)) => {
                        if left_num > right_num {
                            1
                        } else {
                            -1
                        }
                    }
                    (Some(_), None) => -1,
                    (None, Some(_)) => 1,
                    (None, None) => {
                        if left_part > right_part {
                            1
                        } else {
                            -1
                        }
                    }
                };
            }
            if left.len() == right.len() {
                0
            } else if left.len() > right.len() {
                1
            } else {
                -1
            }
        }
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
