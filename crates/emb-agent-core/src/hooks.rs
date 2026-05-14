use std::env;
use std::path::{Path, PathBuf};

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

pub fn build_hook_plan(host: &str, hook: &str, runtime_dir: &Path) -> HookPlan {
    let normalized_hook = normalize_hook_name(hook);
    let normalized_host = String::from(if host.trim().is_empty() {
        "external"
    } else {
        host.trim()
    });
    let node_command = build_node_hook_command(runtime_dir, &normalized_hook);
    let rust_supported = is_rust_hook_supported(&normalized_hook);

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
            if is_source_runtime_layout(runtime_dir) {
                let command =
                    build_rust_hook_command(runtime_dir, &normalized_host, &normalized_hook);
                HookPlan {
                    hook: normalized_hook,
                    host: normalized_host,
                    runtime: "rust".to_string(),
                    command,
                    fallback: node_command,
                    reason: "source-runtime-default".to_string(),
                    supported: true,
                }
            } else {
                HookPlan {
                    hook: normalized_hook,
                    host: normalized_host,
                    runtime: "node".to_string(),
                    command: node_command,
                    fallback: String::new(),
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
        "emb-statusline.js" | "statusLine" | "status_line" => "statusline".to_string(),
        "emb-context-monitor.js" | "PostToolUse" | "context_monitor" => {
            "context-monitor".to_string()
        }
        value if !value.is_empty() => value.to_string(),
        _ => "session-start".to_string(),
    }
}

pub fn is_rust_hook_supported(hook: &str) -> bool {
    matches!(hook, "session-start" | "statusline" | "context-monitor")
}

pub fn hook_file_name(hook: &str) -> &'static str {
    match hook {
        "session-start" => "emb-session-start.js",
        "statusline" => "emb-statusline.js",
        "context-monitor" => "emb-context-monitor.js",
        _ => "emb-session-start.js",
    }
}

pub fn build_node_hook_command(runtime_dir: &Path, hook: &str) -> String {
    format!(
        "node {}",
        shell_quote(&runtime_dir.join("hooks").join(hook_file_name(hook)))
    )
}

pub fn build_rust_hook_command(runtime_dir: &Path, host: &str, hook: &str) -> String {
    let source_root = runtime_dir.parent().unwrap_or_else(|| Path::new("."));
    let binary = rust_binary_path(source_root);
    let command_prefix = env::var("EMB_AGENT_RUST_HOOK_CMD")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if is_source_runtime_layout(runtime_dir) {
                shell_quote(&binary)
            } else if binary.exists() {
                shell_quote(&binary)
            } else {
                "emb-agent-rs".to_string()
            }
        });

    let mut parts = vec![command_prefix, "hook".to_string(), hook.to_string()];
    if hook == "session-start" {
        parts.push("--host".to_string());
        parts.push(host.to_string());
    }
    parts.join(" ")
}

pub fn rust_binary_path(source_root: &Path) -> PathBuf {
    source_root
        .join("target")
        .join("debug")
        .join(if cfg!(windows) {
            "emb-agent-rs.exe"
        } else {
            "emb-agent-rs"
        })
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
    let session_start = build_hook_plan(host, "session-start", runtime_dir);
    let statusline = build_hook_plan(host, "statusline", runtime_dir);
    let context_monitor = build_hook_plan(host, "context-monitor", runtime_dir);
    let source_root = runtime_dir.parent().unwrap_or_else(|| Path::new("."));
    let rust_binary = rust_binary_path(source_root);
    format!(
        "{{\"status\":\"ok\",\"runtime\":\"emb-agent-rs-spike\",\"host\":{},\"runtime_dir\":{},\"source_runtime\":{},\"rust_binary\":{},\"rust_binary_exists\":{},\"env\":{{\"EMB_AGENT_RUST_HOOKS\":{},\"EMB_AGENT_RUST_HOOK_CMD\":{}}},\"hooks\":{{\"session_start\":{},\"statusline\":{},\"context_monitor\":{}}}}}",
        json_quote(host),
        json_quote(&runtime_dir.to_string_lossy()),
        is_source_runtime_layout(runtime_dir),
        json_quote(&rust_binary.to_string_lossy()),
        rust_binary.exists(),
        json_quote(&env::var("EMB_AGENT_RUST_HOOKS").unwrap_or_default()),
        json_quote(&env::var("EMB_AGENT_RUST_HOOK_CMD").unwrap_or_default()),
        build_hook_plan_json(&session_start),
        build_hook_plan_json(&statusline),
        build_hook_plan_json(&context_monitor)
    )
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
        let plan = build_hook_plan("pi", "session-start", &runtime_dir);
        assert_eq!(plan.runtime, "rust");
        assert_eq!(plan.reason, "source-runtime-default");
        assert_eq!(
            plan.fallback,
            build_node_hook_command(&runtime_dir, "session-start")
        );
        assert!(plan.command.contains(" hook session-start --host pi"));
    }

    #[test]
    fn hook_resolver_defaults_context_monitor_to_rust_in_source_layout() {
        let runtime_dir = repo_root().join("runtime");
        let plan = build_hook_plan("cursor", "context-monitor", &runtime_dir);
        assert_eq!(plan.runtime, "rust");
        assert_eq!(plan.reason, "source-runtime-default");
        assert!(plan.command.contains(" hook context-monitor"));
        assert_eq!(
            plan.fallback,
            build_node_hook_command(&runtime_dir, "context-monitor")
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
        assert!(json.contains("\"hook\":\"context-monitor\""));
    }
}
