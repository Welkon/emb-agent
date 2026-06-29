use std::env;
use std::path::{Path, PathBuf};

use crate::hardware::project::HookConfig;
use crate::json::json_quote;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HookPlan {
    pub hook: String,
    pub host: String,
    pub runtime: String,
    pub command: String,
    pub fallback: String,
    pub reason: String,
    pub supported: bool,
}

pub fn build_hook_plan(
    host: &str,
    hook: &str,
    runtime_dir: &Path,
    hook_config: Option<&HookConfig>,
) -> HookPlan {
    let normalized_hook = normalize_hook_name(hook);
    let normalized_host = String::from(if host.trim().is_empty() {
        "external"
    } else {
        host.trim()
    });
    let node_command = build_node_hook_command(runtime_dir, &normalized_host, &normalized_hook);
    let rust_supported = is_rust_hook_supported(&normalized_hook);

    let entry = hook_config.map(|cfg| cfg.hook_entry(&normalized_hook));

    // Per-hook disable via config (env overrides take precedence below)
    if entry.map(|e| !e.enabled).unwrap_or(false) && env_flag("EMB_AGENT_RUST_HOOKS").is_none() {
        return HookPlan {
            hook: normalized_hook,
            host: normalized_host,
            runtime: "node".to_string(),
            command: String::new(),
            fallback: String::new(),
            reason: "hook-disabled-by-config".to_string(),
            supported: false,
        };
    }

    if !rust_supported {
        return HookPlan {
            hook: normalized_hook,
            host: normalized_host,
            runtime: "node".to_string(),
            command: node_command,
            fallback: String::new(),
            reason: "rust-hook-not-implemented".to_string(),
            supported: true,
        };
    }

    match env_flag("EMB_AGENT_RUST_HOOKS") {
        Some(false) => HookPlan {
            hook: normalized_hook,
            host: normalized_host,
            runtime: "node".to_string(),
            command: node_command,
            fallback: String::new(),
            reason: "forced-node".to_string(),
            supported: true,
        },
        Some(true) => {
            let command = build_rust_hook_command(runtime_dir, &normalized_host, &normalized_hook);
            HookPlan {
                hook: normalized_hook,
                host: normalized_host,
                runtime: "rust".to_string(),
                command,
                fallback: node_command,
                reason: "forced-rust".to_string(),
                supported: true,
            }
        }
        None => {
            // Per-hook runtime config: "rust" → force Rust, "node" → force Node
            let config_runtime = entry.map(|e| e.runtime.as_str()).unwrap_or("auto");
            let use_rust = match config_runtime {
                "rust" => true,
                "node" => false,
                _ => is_source_runtime_layout(runtime_dir),
            };

            if use_rust {
                let command =
                    build_rust_hook_command(runtime_dir, &normalized_host, &normalized_hook);
                let reason = if config_runtime == "rust" {
                    "config-rust"
                } else {
                    "source-runtime-default"
                };
                HookPlan {
                    hook: normalized_hook,
                    host: normalized_host,
                    runtime: "rust".to_string(),
                    command,
                    fallback: node_command,
                    reason: reason.to_string(),
                    supported: true,
                }
            } else if config_runtime == "node" {
                HookPlan {
                    hook: normalized_hook,
                    host: normalized_host,
                    runtime: "node".to_string(),
                    command: node_command,
                    fallback: String::new(),
                    reason: "config-node".to_string(),
                    supported: true,
                }
            } else {
                // Installed layout, auto runtime → Rust with Node fallback
                let command =
                    build_rust_hook_command(runtime_dir, &normalized_host, &normalized_hook);
                HookPlan {
                    hook: normalized_hook,
                    host: normalized_host,
                    runtime: "rust".to_string(),
                    command,
                    fallback: node_command,
                    reason: "installed-runtime-default".to_string(),
                    supported: true,
                }
            }
        }
    }
}

pub fn normalize_hook_name(hook: &str) -> String {
    match hook.trim() {
        "emb-session-start.js" | "SessionStart" | "session_start" => "session-start".to_string(),
        "SessionEnd" | "session_end" | "session-end" => "session-end".to_string(),
        "emb-statusline.js" | "statusLine" | "status_line" => "statusline".to_string(),
        "emb-context-monitor.js" | "PostToolUse" | "context_monitor" => {
            "context-monitor".to_string()
        }
        "emb-tool-guard.js" | "PreToolUse" | "pre_tool_use" | "tool_guard" => {
            "tool-guard".to_string()
        }
        value if !value.is_empty() => value.to_string(),
        _ => "session-start".to_string(),
    }
}

pub fn is_rust_hook_supported(hook: &str) -> bool {
    matches!(
        hook,
        "session-start" | "session-end" | "statusline" | "context-monitor" | "tool-guard"
    )
}

pub fn hook_file_name(hook: &str) -> &'static str {
    match hook {
        "session-start" => "emb-session-start.js",
        "statusline" => "emb-statusline.js",
        "context-monitor" => "emb-context-monitor.js",
        "tool-guard" => "emb-tool-guard.js",
        _ => "emb-session-start.js",
    }
}

pub fn build_node_hook_command(runtime_dir: &Path, host: &str, hook: &str) -> String {
    let wrapper = runtime_dir.join("bin").join("emb-agent.cjs");
    let mut parts = vec![
        "node".to_string(),
        shell_quote(&wrapper),
        "hook".to_string(),
        hook.to_string(),
    ];
    parts.push("--host".to_string());
    parts.push(host.to_string());
    parts.join(" ")
}

pub fn build_rust_hook_command(runtime_dir: &Path, host: &str, hook: &str) -> String {
    let command_prefix = env::var("EMB_AGENT_RUST_HOOK_CMD")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            let binary = rust_binary_path(runtime_dir);
            if binary.exists() {
                shell_quote(&binary)
            } else if is_source_runtime_layout(runtime_dir) {
                // Source layout without built binary: suggest cargo build.
                shell_quote(&binary)
            } else {
                // Installed but binary missing: try PATH fallback.
                "emb-agent-rs".to_string()
            }
        });

    let mut parts = vec![command_prefix, "hook".to_string(), hook.to_string()];
    parts.push("--host".to_string());
    parts.push(host.to_string());
    parts.join(" ")
}

pub fn rust_binary_path(runtime_or_root: &Path) -> PathBuf {
    let exe_name = if cfg!(windows) {
        "emb-agent-rs.exe"
    } else {
        "emb-agent-rs"
    };

    if is_source_runtime_layout(runtime_or_root) {
        let source_root = runtime_or_root.parent().unwrap_or_else(|| Path::new("."));
        let source_layout = source_root.join("target").join("debug").join(exe_name);
        if source_layout.exists() {
            return source_layout;
        }
        return source_layout;
    }

    let installed = runtime_or_root.join("bin").join(exe_name);
    if installed.exists() {
        return installed;
    }

    let nested_installed = runtime_or_root.join("emb-agent").join("bin").join(exe_name);
    if nested_installed.exists() {
        return nested_installed;
    }

    let source_layout = runtime_or_root.join("target").join("debug").join(exe_name);
    if source_layout.exists() {
        return source_layout;
    }

    installed
}

pub fn is_source_runtime_layout(runtime_dir: &Path) -> bool {
    runtime_dir
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name == "runtime")
        .unwrap_or(false)
        && runtime_dir
            .parent()
            .map(|parent| parent.join("Cargo.toml").exists())
            .unwrap_or(false)
}

pub fn env_flag(name: &str) -> Option<bool> {
    match env::var(name).ok()?.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

pub fn build_hook_plan_json(plan: &HookPlan) -> String {
    format!(
        "{{\"hook\":{},\"host\":{},\"runtime\":{},\"command\":{},\"fallback\":{},\"reason\":{},\"supported\":{}}}",
        json_quote(&plan.hook),
        json_quote(&plan.host),
        json_quote(&plan.runtime),
        json_quote(&plan.command),
        json_quote(&plan.fallback),
        json_quote(&plan.reason),
        plan.supported
    )
}

pub fn build_hooks_diagnostics_json(host: &str, runtime_dir: &Path) -> String {
    let session_start = build_hook_plan(host, "session-start", runtime_dir, None);
    let statusline = build_hook_plan(host, "statusline", runtime_dir, None);
    let context_monitor = build_hook_plan(host, "context-monitor", runtime_dir, None);
    let tool_guard = build_hook_plan(host, "tool-guard", runtime_dir, None);
    let rust_binary = rust_binary_path(runtime_dir);
    let rust_binary_exists = rust_binary.exists();
    let hooks_ready = rust_binary_exists
        && session_start.supported
        && context_monitor.supported
        && (host != "codex" || tool_guard.supported);
    let readiness_status = if hooks_ready { "ok" } else { "warn" };
    let next_steps = hook_diagnostics_next_steps(host, hooks_ready);
    format!(
        "{{\"status\":{},\"runtime\":\"emb-agent-rs\",\"host\":{},\"runtime_dir\":{},\"source_runtime\":{},\"rust_binary\":{},\"rust_binary_exists\":{},\"readiness\":{{\"status\":{},\"session_start\":{},\"context_monitor\":{},\"tool_guard_required\":{},\"tool_guard\":{},\"message\":{}}},\"next_steps\":{},\"env\":{{\"EMB_AGENT_RUST_HOOKS\":{},\"EMB_AGENT_RUST_HOOK_CMD\":{}}},\"hooks\":{{\"session_start\":{},\"statusline\":{},\"context_monitor\":{},\"tool_guard\":{}}}}}",
        json_quote(readiness_status),
        json_quote(host),
        json_quote(&runtime_dir.to_string_lossy()),
        is_source_runtime_layout(runtime_dir),
        json_quote(&rust_binary.to_string_lossy()),
        rust_binary_exists,
        json_quote(readiness_status),
        session_start.supported,
        context_monitor.supported,
        host == "codex",
        tool_guard.supported,
        json_quote(if hooks_ready {
            "Hook runtime and required hook plans are present."
        } else {
            "Hook runtime or required hook plans are incomplete; follow next_steps."
        }),
        json_string_array(&next_steps),
        json_quote(&env::var("EMB_AGENT_RUST_HOOKS").unwrap_or_default()),
        json_quote(&env::var("EMB_AGENT_RUST_HOOK_CMD").unwrap_or_default()),
        build_hook_plan_json(&session_start),
        build_hook_plan_json(&statusline),
        build_hook_plan_json(&context_monitor),
        build_hook_plan_json(&tool_guard)
    )
}

fn hook_diagnostics_next_steps(host: &str, hooks_ready: bool) -> Vec<String> {
    let mut steps = Vec::new();
    if hooks_ready {
        steps.push("Start a new host session, then ask for /emb-start or /emb-next.".to_string());
    } else {
        steps.push("Run emb-agent repair/update for this host, then restart the host session.".to_string());
    }
    match host {
        "codex" => {
            steps.push("In Codex, run /hooks and trust the project hooks if they are pending review.".to_string());
            steps.push("Confirm ~/.codex/config.toml enables hooks if project hooks do not run.".to_string());
        }
        "cursor" => {
            steps.push("Reload the Cursor window if hooks or commands are not visible.".to_string());
        }
        "claude" => {
            steps.push("Start a new Claude Code session after hook changes.".to_string());
        }
        _ => {}
    }
    steps
}

fn json_string_array(values: &[String]) -> String {
    let mut out = String::from("[");
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str(&json_quote(value));
    }
    out.push(']');
    out
}

pub fn shell_quote(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if value.contains(' ') || value.contains('"') {
        json_quote(&value)
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
            .unwrap()
            .to_path_buf()
    }

    #[test]
    fn hook_resolver_defaults_source_runtime_to_rust() {
        let runtime_dir = repo_root().join("runtime");
        let plan = build_hook_plan("pi", "session-start", &runtime_dir, None);
        assert_eq!(plan.runtime, "rust");
        assert_eq!(plan.reason, "source-runtime-default");
        assert_eq!(
            plan.fallback,
            build_node_hook_command(&runtime_dir, "pi", "session-start")
        );
        assert!(plan.command.contains(" hook session-start --host pi"));
    }

    #[test]
    fn hook_resolver_defaults_context_monitor_to_rust_in_source_layout() {
        let runtime_dir = repo_root().join("runtime");
        let plan = build_hook_plan("cursor", "context-monitor", &runtime_dir, None);
        assert_eq!(plan.runtime, "rust");
        assert_eq!(plan.reason, "source-runtime-default");
        assert!(plan.command.contains(" hook context-monitor --host cursor"));
        assert_eq!(
            plan.fallback,
            build_node_hook_command(&runtime_dir, "cursor", "context-monitor")
        );
    }

    #[test]
    fn hook_resolver_supports_codex_tool_guard() {
        let runtime_dir = repo_root().join("runtime");
        let plan = build_hook_plan("codex", "PreToolUse", &runtime_dir, None);
        assert_eq!(plan.hook, "tool-guard");
        assert_eq!(plan.runtime, "rust");
        assert!(plan.command.contains(" hook tool-guard --host codex"));
        assert_eq!(
            plan.fallback,
            build_node_hook_command(&runtime_dir, "codex", "tool-guard")
        );
    }

    #[test]
    fn hook_plan_json_is_machine_readable() {
        let plan = HookPlan {
            hook: "statusline".to_string(),
            host: "pi".to_string(),
            runtime: "rust".to_string(),
            command: "emb-agent-rs hook statusline".to_string(),
            fallback: "node runtime/hooks/emb-statusline.js".to_string(),
            reason: "test".to_string(),
            supported: true,
        };
        let json = build_hook_plan_json(&plan);
        assert!(json.contains("\"hook\":\"statusline\""));
        assert!(json.contains("\"runtime\":\"rust\""));
        assert!(json.contains("\"supported\":true"));
    }

    #[test]
    fn hook_diagnostics_json_includes_all_hook_plans() {
        let runtime_dir = repo_root().join("runtime");
        let json = build_hooks_diagnostics_json("pi", &runtime_dir);
        assert!(json.contains("\"status\":\"ok\""));
        assert!(json.contains("\"host\":\"pi\""));
        assert!(json.contains("\"session_start\""));
        assert!(json.contains("\"statusline\""));
        assert!(json.contains("\"context_monitor\""));
        assert!(json.contains("\"tool_guard\""));
        assert!(json.contains("\"hook\":\"context-monitor\""));
        assert!(json.contains("\"hook\":\"tool-guard\""));
    }

    #[test]
    fn hook_resolver_defaults_installed_runtime_to_rust_with_node_fallback() {
        let tmp = std::env::temp_dir().join(format!(
            "emb-agent-rs-test-installed-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime_dir = tmp.join("emb-agent").join("runtime");
        std::fs::create_dir_all(&runtime_dir).unwrap();
        // No Cargo.toml in parent → not a source layout
        let plan = build_hook_plan("claude", "statusline", &runtime_dir, None);
        assert_eq!(plan.runtime, "rust");
        assert_eq!(plan.reason, "installed-runtime-default");
        assert!(!plan.fallback.is_empty());
        assert!(plan.fallback.contains("node"));
        // Without the binary present, falls back to PATH lookup
        assert!(plan.command.contains("emb-agent-rs"));
        let _ = std::fs::remove_dir_all(tmp);
    }
}
