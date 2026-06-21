use serde_json::Value;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const FAILURE_BACKOFF_SECS: u64 = 24 * 60 * 60;

#[derive(Clone, Copy)]
struct ToolSpec {
    key: &'static str,
    binary: &'static str,
    package: &'static str,
    reason: &'static str,
}

const GRAPHIFY: ToolSpec = ToolSpec {
    key: "graphify",
    binary: "graphify",
    package: "graphifyy",
    reason: "PRD breakdown needs a project knowledge graph.",
};

const MARKITDOWN: ToolSpec = ToolSpec {
    key: "markitdown",
    binary: "markitdown",
    package: "markitdown",
    reason: "Local document ingestion prefers markitdown before heavier fallbacks.",
};

pub fn maybe_auto_ensure_markitdown(provider: &str, cwd: &str) {
    let normalized = provider.trim().to_ascii_lowercase();
    if !matches!(normalized.as_str(), "auto" | "local") {
        return;
    }
    let _ = auto_ensure_global_tool(&MARKITDOWN, Some(Path::new(cwd)));
}

pub fn maybe_auto_ensure_graphify_from_next_json(cwd: &str, json_text: &str) {
    if !next_json_needs_graphify(json_text) {
        return;
    }
    let _ = auto_ensure_global_tool(&GRAPHIFY, Some(Path::new(cwd)));
}

fn next_json_needs_graphify(json_text: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(json_text) else {
        return false;
    };
    let action = value.get("action").and_then(Value::as_str).unwrap_or("");
    let graph_status = value
        .get("graph_health")
        .and_then(|v| v.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let graph_required = value
        .get("agent_protocol")
        .and_then(|v| v.get("gate"))
        .and_then(|v| v.get("checks"))
        .and_then(|v| v.get("graphify_graph"))
        .and_then(Value::as_bool)
        .map(|ready| !ready)
        .unwrap_or(false);

    (action == "prd-breakdown" && graph_status == "missing") || graph_required
}

fn auto_ensure_global_tool(spec: &ToolSpec, project_root: Option<&Path>) -> Result<(), String> {
    if auto_ensure_disabled() {
        return Ok(());
    }

    if command_available(spec.binary) {
        return Ok(());
    }

    let now = unix_now();
    let state_path = auto_ensure_state_path();
    let state = read_state_file(&state_path);
    if install_backoff_active(state.get(spec.key), now) {
        eprintln!(
            "emb-agent auto-ensure: skipping `{}` install retry for now; last attempt failed recently.",
            spec.binary
        );
        return Ok(());
    }

    let Some(uv_bin) = resolve_uv_binary() else {
        eprintln!(
            "emb-agent auto-ensure: `{}` is missing, but `uv` is not available. {}",
            spec.binary, spec.reason
        );
        write_state_attempt(&state_path, spec.key, "failed-no-uv", now)?;
        return Ok(());
    };

    eprintln!(
        "emb-agent auto-ensure: `{}` not found. Installing `{}` globally via uv. {}",
        spec.binary, spec.package, spec.reason
    );
    let status = Command::new(&uv_bin)
        .args(["tool", "install", spec.package])
        .current_dir(project_root.unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| {
            format!(
                "failed to start uv tool install for {}: {error}",
                spec.package
            )
        })?;

    if !status.success() {
        write_state_attempt(&state_path, spec.key, "failed", now)?;
        eprintln!(
            "emb-agent auto-ensure: uv could not install `{}`. Continuing without it.",
            spec.package
        );
        return Ok(());
    }

    if let Some(bin_dir) = uv_tool_bin_dir(&uv_bin) {
        prepend_process_path(&bin_dir);
    }

    if command_available(spec.binary) {
        write_state_attempt(&state_path, spec.key, "installed", now)?;
        eprintln!(
            "emb-agent auto-ensure: `{}` is now available for this session.",
            spec.binary
        );
        return Ok(());
    }

    write_state_attempt(&state_path, spec.key, "installed-path-pending", now)?;
    eprintln!(
        "emb-agent auto-ensure: `{}` was installed, but it is not yet visible in PATH. A fresh shell/session may be needed.",
        spec.binary
    );
    Ok(())
}

fn auto_ensure_disabled() -> bool {
    matches!(
        env::var("EMB_AGENT_AUTO_ENSURE_TOOLS")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "0" | "false" | "no"
    )
}

fn resolve_uv_binary() -> Option<String> {
    if let Ok(override_bin) = env::var("EMB_AGENT_AUTO_ENSURE_UV_BIN") {
        let trimmed = override_bin.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if command_path_in_env("uv").is_some() {
        Some("uv".to_string())
    } else {
        None
    }
}

fn uv_tool_bin_dir(uv_bin: &str) -> Option<PathBuf> {
    let output = Command::new(uv_bin)
        .args(["tool", "dir", "--bin"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(PathBuf::from(value))
    }
}

fn prepend_process_path(bin_dir: &Path) {
    if !bin_dir.is_dir() {
        return;
    }
    let current = env::var_os("PATH").unwrap_or_default();
    let current_paths: Vec<PathBuf> = env::split_paths(&current).collect();
    if current_paths.iter().any(|entry| entry == bin_dir) {
        return;
    }
    let mut updated = Vec::with_capacity(current_paths.len() + 1);
    updated.push(bin_dir.to_path_buf());
    updated.extend(current_paths);
    if let Ok(joined) = env::join_paths(updated) {
        // SAFETY: emb-agent-rs is a short-lived single-process CLI; updating PATH here only affects
        // child command resolution for this process after auto-install completes.
        unsafe {
            env::set_var("PATH", joined);
        }
    }
}

fn command_available(command: &str) -> bool {
    if command_path_in_env(command).is_some() {
        return true;
    }
    resolve_uv_binary()
        .and_then(|uv_bin| uv_tool_bin_dir(&uv_bin))
        .and_then(|dir| command_path_in_dir(command, &dir))
        .is_some()
}

fn command_path_in_env(command: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path).find_map(|dir| command_path_in_dir(command, &dir))
}

fn command_path_in_dir(command: &str, dir: &Path) -> Option<PathBuf> {
    let candidate = dir.join(command);
    if candidate.is_file() {
        return Some(candidate);
    }
    if env::consts::EXE_EXTENSION.is_empty() {
        return None;
    }
    let with_ext = dir.join(format!("{}.{}", command, env::consts::EXE_EXTENSION));
    if with_ext.is_file() {
        Some(with_ext)
    } else {
        None
    }
}

fn auto_ensure_state_path() -> PathBuf {
    if let Ok(override_dir) = env::var("EMB_AGENT_AUTO_ENSURE_STATE_DIR") {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            return Path::new(trimmed).join("tool-auto-ensure.json");
        }
    }

    if let Ok(cache_root) = env::var("XDG_CACHE_HOME") {
        let trimmed = cache_root.trim();
        if !trimmed.is_empty() {
            return Path::new(trimmed)
                .join("emb-agent")
                .join("tool-auto-ensure.json");
        }
    }

    if let Ok(home) = env::var("HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return Path::new(trimmed)
                .join(".cache")
                .join("emb-agent")
                .join("tool-auto-ensure.json");
        }
    }

    env::temp_dir()
        .join("emb-agent")
        .join("tool-auto-ensure.json")
}

fn read_state_file(path: &Path) -> serde_json::Map<String, Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

fn write_state_attempt(path: &Path, tool: &str, status: &str, now: u64) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create tool state dir {}: {error}",
                parent.display()
            )
        })?;
    }
    let mut root = read_state_file(path);
    root.insert(
        tool.to_string(),
        serde_json::json!({
            "last_attempt_status": status,
            "last_attempt_at": now
        }),
    );
    fs::write(
        path,
        serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default(),
    )
    .map_err(|error| format!("failed to write tool state {}: {error}", path.display()))
}

fn install_backoff_active(entry: Option<&Value>, now: u64) -> bool {
    let Some(entry) = entry else {
        return false;
    };
    let status = entry
        .get("last_attempt_status")
        .and_then(Value::as_str)
        .unwrap_or("");
    let attempted_at = entry
        .get("last_attempt_at")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    status.starts_with("failed") && now.saturating_sub(attempted_at) < FAILURE_BACKOFF_SECS
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::{FAILURE_BACKOFF_SECS, install_backoff_active, next_json_needs_graphify};

    #[test]
    fn next_json_detects_missing_graphify_for_prd_breakdown() {
        let payload = serde_json::json!({
            "action": "prd-breakdown",
            "graph_health": {
                "status": "missing"
            }
        });
        assert!(next_json_needs_graphify(&payload.to_string()));
    }

    #[test]
    fn next_json_detects_preflight_graph_requirement() {
        let payload = serde_json::json!({
            "action": "prd-breakdown",
            "agent_protocol": {
                "gate": {
                    "checks": {
                        "graphify_graph": false
                    }
                }
            }
        });
        assert!(next_json_needs_graphify(&payload.to_string()));
    }

    #[test]
    fn next_json_ignores_other_actions() {
        let payload = serde_json::json!({
            "action": "clarify",
            "graph_health": {
                "status": "missing"
            }
        });
        assert!(!next_json_needs_graphify(&payload.to_string()));
    }

    #[test]
    fn recent_failed_attempt_enables_backoff() {
        let now = 1_000_000;
        let entry = serde_json::json!({
            "last_attempt_status": "failed",
            "last_attempt_at": now - 60
        });
        assert!(install_backoff_active(Some(&entry), now));
    }

    #[test]
    fn old_failure_backoff_expires() {
        let now = 1_000_000;
        let entry = serde_json::json!({
            "last_attempt_status": "failed",
            "last_attempt_at": now - FAILURE_BACKOFF_SECS - 5
        });
        assert!(!install_backoff_active(Some(&entry), now));
    }
}
