use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct EmbAgentConfig {
    pub session_commit_message: String,
    pub max_journal_lines: usize,
    pub session_auto_commit: bool,
    pub codex_dispatch_mode: String,
    pub worker_guard_idle_timeout: String,
    pub worker_guard_max_live_workers: usize,
}

impl Default for EmbAgentConfig {
    fn default() -> Self {
        Self {
            session_commit_message: "chore: record emb-agent session".to_string(),
            max_journal_lines: 2000,
            session_auto_commit: false,
            codex_dispatch_mode: "inline".to_string(),
            worker_guard_idle_timeout: "5m".to_string(),
            worker_guard_max_live_workers: 6,
        }
    }
}

pub fn load_config(project_root: &Path) -> EmbAgentConfig {
    let path = project_root.join(".emb-agent").join("config.yaml");
    let Ok(text) = fs::read_to_string(path) else {
        return EmbAgentConfig::default();
    };
    parse_config(&text)
}

pub fn parse_config(text: &str) -> EmbAgentConfig {
    let mut cfg = EmbAgentConfig::default();
    let mut section = String::new();
    let mut sub_section = String::new();
    for raw in text.lines() {
        let line = strip_comment(raw);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !line.starts_with(' ') && trimmed.ends_with(':') {
            section = trimmed.trim_end_matches(':').to_string();
            sub_section.clear();
            continue;
        }
        if line.starts_with("  ") && !line.starts_with("    ") && trimmed.ends_with(':') {
            sub_section = trimmed.trim_end_matches(':').to_string();
            continue;
        }
        if let Some((key, value)) = trimmed.split_once(':') {
            let value = unquote(value.trim());
            match (section.as_str(), sub_section.as_str(), key.trim()) {
                ("", _, "session_commit_message") => cfg.session_commit_message = value,
                ("", _, "max_journal_lines") => {
                    cfg.max_journal_lines = value.parse().unwrap_or(cfg.max_journal_lines)
                }
                ("", _, "session_auto_commit") => cfg.session_auto_commit = parse_bool(&value),
                ("codex", _, "dispatch_mode") => {
                    cfg.codex_dispatch_mode = match value.as_str() {
                        "sub-agent" | "sub_agent" | "subagent" => "sub-agent".to_string(),
                        _ => "inline".to_string(),
                    }
                }
                ("channel", "worker_guard", "idle_timeout") => {
                    cfg.worker_guard_idle_timeout = value;
                }
                ("channel", "worker_guard", "max_live_workers") => {
                    cfg.worker_guard_max_live_workers =
                        value.parse().unwrap_or(cfg.worker_guard_max_live_workers);
                }
                _ => {}
            }
        }
    }
    cfg
}

pub fn hook_commands(project_root: &Path, hook: &str) -> Vec<String> {
    let path = project_root.join(".emb-agent").join("config.yaml");
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    parse_hook_commands(&text, hook)
}

pub fn parse_hook_commands(text: &str, hook: &str) -> Vec<String> {
    let mut in_hooks = false;
    let mut in_target = false;
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = strip_comment(raw);
        let trimmed = line.trim();
        if trimmed.is_empty() {
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
            let command = unquote(trimmed.trim_start_matches('-').trim());
            if !command.is_empty() {
                out.push(command);
            }
        }
    }
    out
}

pub fn record_session_journal(project_root: &Path, host: &str, event: &str, payload: &str) {
    let cfg = load_config(project_root);
    let ext_dir = project_root.join(".emb-agent");
    let sessions_dir = ext_dir.join("sessions");
    if fs::create_dir_all(&sessions_dir).is_err() {
        return;
    }
    let journal = sessions_dir.join("journal.jsonl");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let safe_payload = payload.chars().take(4000).collect::<String>();
    let line = serde_json::json!({
        "ts_ms": now,
        "host": host,
        "event": event,
        "cwd": project_root.to_string_lossy(),
        "payload_preview": safe_payload,
    })
    .to_string();
    let mut lines = fs::read_to_string(&journal)
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    lines.push(line);
    if cfg.max_journal_lines > 0 && lines.len() > cfg.max_journal_lines {
        let drop = lines.len() - cfg.max_journal_lines;
        lines.drain(0..drop);
    }
    let body = if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    };
    let _ = fs::write(&journal, body);
    if cfg.session_auto_commit {
        maybe_auto_commit_session(project_root, &cfg.session_commit_message);
    }
}

pub fn run_configured_hooks(project_root: &Path, hook: &str, extra_env: &[(&str, String)]) {
    for command in hook_commands(project_root, hook) {
        let mut cmd = Command::new(shell_binary());
        cmd.arg(shell_arg()).arg(&command).current_dir(project_root);
        for (key, value) in extra_env {
            cmd.env(key, value);
        }
        match cmd.status() {
            Ok(status) if status.success() => {}
            Ok(status) => {
                eprintln!("emb-agent lifecycle hook {hook} exited with {status}: {command}")
            }
            Err(error) => eprintln!("emb-agent lifecycle hook {hook} failed: {error}: {command}"),
        }
    }
}

fn maybe_auto_commit_session(project_root: &Path, message: &str) {
    if !project_root.join(".git").exists() {
        return;
    }
    let paths = [".emb-agent/sessions", ".emb-agent/cache/mem/index.json"];
    let _ = Command::new("git")
        .arg("add")
        .args(paths)
        .current_dir(project_root)
        .status();
    let dirty = Command::new("git")
        .args(["diff", "--cached", "--quiet", "--"])
        .current_dir(project_root)
        .status()
        .map(|status| !status.success())
        .unwrap_or(false);
    if dirty {
        let _ = Command::new("git")
            .args(["commit", "-m", message])
            .current_dir(project_root)
            .status();
    }
}

fn strip_comment(line: &str) -> String {
    let mut quote: Option<char> = None;
    for (idx, ch) in line.char_indices() {
        if ch == '"' || ch == '\'' {
            quote = if quote == Some(ch) {
                None
            } else if quote.is_none() {
                Some(ch)
            } else {
                quote
            };
        } else if ch == '#' && quote.is_none() {
            return line[..idx].to_string();
        }
    }
    line.to_string()
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    let quoted = (value.starts_with('"') && value.ends_with('"'))
        || (value.starts_with('\'') && value.ends_with('\''));
    if quoted && value.len() >= 2 {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
    }
}

fn parse_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

pub fn shell_binary() -> &'static str {
    if cfg!(windows) { "cmd" } else { "sh" }
}

pub fn shell_arg() -> &'static str {
    if cfg!(windows) { "/C" } else { "-c" }
}
