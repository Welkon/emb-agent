use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const SESSION_TTL_MS: u128 = 5 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceStatus {
    pub kind: String,
    pub cwd: String,
    pub repo_root: String,
    pub main_worktree: String,
    pub branch: String,
    pub dirty: bool,
    pub git_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionHeartbeat {
    pub session_id: String,
    pub host: String,
    pub cwd: String,
    pub repo_root: String,
    pub workspace_kind: String,
    pub branch: String,
    pub task: String,
    pub pid: u32,
    pub updated_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorktreePolicy {
    pub decision: String,
    pub reason: String,
    pub target_task: String,
    pub recommended_command: String,
    pub workspace: WorkspaceStatus,
    pub active_sessions: Vec<SessionHeartbeat>,
    pub task_worktree_path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ActiveTaskSelection {
    pub task: String,
    pub source: String,
    pub session_id: String,
}

pub fn current_workspace_status(cwd: &Path) -> WorkspaceStatus {
    let cwd_string = cwd.to_string_lossy().to_string();
    let repo_root = match git_stdout(cwd, &["rev-parse", "--show-toplevel"]) {
        Some(root) if !root.trim().is_empty() => root,
        _ => {
            return WorkspaceStatus {
                kind: "non-git".to_string(),
                cwd: cwd_string,
                repo_root: String::new(),
                main_worktree: String::new(),
                branch: String::new(),
                dirty: false,
                git_available: false,
            };
        }
    };
    let main_worktree = git_stdout(
        Path::new(&repo_root),
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )
    .and_then(|git_common| {
        let git_common_path = PathBuf::from(git_common);
        git_common_path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
    })
    .unwrap_or_else(|| repo_root.clone());
    let branch =
        git_stdout(Path::new(&repo_root), &["branch", "--show-current"]).unwrap_or_default();
    let kind = if same_path(Path::new(&repo_root), Path::new(&main_worktree)) {
        "main"
    } else {
        "worktree"
    };

    WorkspaceStatus {
        kind: kind.to_string(),
        cwd: cwd_string,
        repo_root: repo_root.clone(),
        main_worktree,
        branch,
        dirty: is_git_dirty(Path::new(&repo_root)),
        git_available: true,
    }
}

pub fn record_session_heartbeat(
    ext_dir: &Path,
    cwd: &Path,
    host: &str,
) -> Option<SessionHeartbeat> {
    write_session_heartbeat(ext_dir, cwd, host, None)
}

pub fn set_session_active_task(
    ext_dir: &Path,
    cwd: &Path,
    host: &str,
    task_name: &str,
) -> Option<SessionHeartbeat> {
    write_session_heartbeat(ext_dir, cwd, host, Some(task_name.trim()))
}

pub fn clear_session_active_task(ext_dir: &Path, cwd: &Path, task_name: &str) -> usize {
    let workspace = current_workspace_status(cwd);
    let registry_ext_dir = session_registry_ext_dir(ext_dir, &workspace);
    let mut cleared = clear_task_from_sessions_dir(&registry_ext_dir, task_name);
    if registry_ext_dir != ext_dir {
        cleared += clear_task_from_sessions_dir(ext_dir, task_name);
    }
    cleared
}

pub fn resolve_active_task_name(ext_dir: &Path, cwd: &Path, _host: &str) -> ActiveTaskSelection {
    let workspace = current_workspace_status(cwd);
    let registry_ext_dir = session_registry_ext_dir(ext_dir, &workspace);
    prune_stale_sessions(&registry_ext_dir);

    if let Some(session_id) = env_session_id()
        && let Some(session) = read_session(&registry_ext_dir, &session_id)
        && !session.task.trim().is_empty()
    {
        return ActiveTaskSelection {
            task: session.task.trim().to_string(),
            source: format!("session:{session_id}"),
            session_id,
        };
    }

    if env_session_id().is_none() {
        let sessions = active_sessions(&registry_ext_dir);
        if sessions.len() == 1 {
            let session = &sessions[0];
            if !session.task.trim().is_empty() {
                return ActiveTaskSelection {
                    task: session.task.trim().to_string(),
                    source: format!("session-fallback:{}", session.session_id),
                    session_id: session.session_id.clone(),
                };
            }
        }
    }

    let global_task = current_task_name(ext_dir);
    if global_task.is_empty() {
        ActiveTaskSelection::default()
    } else {
        ActiveTaskSelection {
            task: global_task,
            source: "global".to_string(),
            session_id: String::new(),
        }
    }
}

fn write_session_heartbeat(
    ext_dir: &Path,
    cwd: &Path,
    host: &str,
    task_override: Option<&str>,
) -> Option<SessionHeartbeat> {
    let workspace = current_workspace_status(cwd);
    if !workspace.git_available {
        return write_non_git_session_heartbeat(ext_dir, cwd, host, task_override);
    }
    let registry_ext_dir = session_registry_ext_dir(ext_dir, &workspace);
    let sessions_dir = registry_ext_dir.join("sessions");
    fs::create_dir_all(&sessions_dir).ok()?;
    prune_stale_sessions(&registry_ext_dir);

    let session_id = session_id_from_env(host, &workspace.repo_root);
    let path = sessions_dir.join(format!("{}.json", safe_file_stem(&session_id)));
    let task = task_override
        .map(|task| task.trim().to_string())
        .filter(|task| !task.is_empty())
        .or_else(|| read_session_task_from_path(&path))
        .unwrap_or_else(|| current_task_name(ext_dir));
    let heartbeat = SessionHeartbeat {
        session_id: session_id.clone(),
        host: host.to_string(),
        cwd: cwd.to_string_lossy().to_string(),
        repo_root: workspace.repo_root.clone(),
        workspace_kind: workspace.kind.clone(),
        branch: workspace.branch.clone(),
        task,
        pid: std::process::id(),
        updated_at_ms: now_ms(),
    };
    let body = serde_json::to_string_pretty(&heartbeat).ok()?;
    fs::write(path, body).ok()?;
    Some(heartbeat)
}

fn write_non_git_session_heartbeat(
    ext_dir: &Path,
    cwd: &Path,
    host: &str,
    task_override: Option<&str>,
) -> Option<SessionHeartbeat> {
    let sessions_dir = ext_dir.join("sessions");
    fs::create_dir_all(&sessions_dir).ok()?;
    prune_stale_sessions(ext_dir);

    let repo_root = cwd
        .canonicalize()
        .unwrap_or_else(|_| cwd.to_path_buf())
        .to_string_lossy()
        .to_string();
    let session_id = session_id_from_env(host, &repo_root);
    let path = sessions_dir.join(format!("{}.json", safe_file_stem(&session_id)));
    let task = task_override
        .map(|task| task.trim().to_string())
        .filter(|task| !task.is_empty())
        .or_else(|| read_session_task_from_path(&path))
        .unwrap_or_else(|| current_task_name(ext_dir));
    let heartbeat = SessionHeartbeat {
        session_id: session_id.clone(),
        host: host.to_string(),
        cwd: cwd.to_string_lossy().to_string(),
        repo_root,
        workspace_kind: "non-git".to_string(),
        branch: String::new(),
        task,
        pid: std::process::id(),
        updated_at_ms: now_ms(),
    };
    let body = serde_json::to_string_pretty(&heartbeat).ok()?;
    fs::write(path, body).ok()?;
    Some(heartbeat)
}

pub fn prune_stale_sessions(ext_dir: &Path) {
    let sessions_dir = ext_dir.join("sessions");
    let Ok(entries) = fs::read_dir(&sessions_dir) else {
        return;
    };
    let now = now_ms();
    let ttl_ms = worker_guard_idle_timeout_ms(ext_dir);
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if path.file_name().and_then(|s| s.to_str()) == Some("tool-guard-state.json") {
            continue;
        }
        let stale = fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<SessionHeartbeat>(&content).ok())
            .map(|session| now.saturating_sub(session.updated_at_ms) > ttl_ms)
            .unwrap_or(true);
        if stale {
            let _ = fs::remove_file(path);
        }
    }
}

pub fn active_sessions(ext_dir: &Path) -> Vec<SessionHeartbeat> {
    prune_stale_sessions(ext_dir);
    let sessions_dir = ext_dir.join("sessions");
    let now = now_ms();
    let ttl_ms = worker_guard_idle_timeout_ms(ext_dir);
    let mut sessions = Vec::new();
    if let Ok(entries) = fs::read_dir(&sessions_dir) {
        for entry in entries.flatten() {
            if entry.path().file_name().and_then(|s| s.to_str()) == Some("tool-guard-state.json") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(entry.path())
                && let Ok(session) = serde_json::from_str::<SessionHeartbeat>(&content)
                && now.saturating_sub(session.updated_at_ms) <= ttl_ms
            {
                sessions.push(session);
            }
        }
    }
    sessions.sort_by(|a, b| a.session_id.cmp(&b.session_id));
    sessions
}

pub fn evaluate_worktree_policy(
    ext_dir: &Path,
    cwd: &Path,
    target_task: Option<&str>,
) -> WorktreePolicy {
    let workspace = current_workspace_status(cwd);
    let registry_ext_dir = session_registry_ext_dir(ext_dir, &workspace);
    let sessions = active_sessions(&registry_ext_dir)
        .into_iter()
        .filter(|session| {
            !workspace.repo_root.is_empty()
                && (session.repo_root == workspace.repo_root
                    || session.repo_root == workspace.main_worktree
                    || session.cwd == workspace.main_worktree)
        })
        .collect::<Vec<_>>();
    let task_name = target_task.unwrap_or(" ").trim().to_string();
    let current_task = current_task_name(ext_dir);
    let task_worktree_path = if task_name.is_empty() {
        String::new()
    } else {
        task_recorded_worktree_path(ext_dir, &task_name)
    };

    let current_session_id = session_id_from_env("current", &workspace.repo_root);
    let other_main_sessions = sessions
        .iter()
        .filter(|session| {
            session.workspace_kind == "main"
                && session.session_id != current_session_id
                && session.pid != std::process::id()
                && (task_name.is_empty() || session.task.is_empty() || session.task != task_name)
        })
        .count();
    let max_live_workers = worker_guard_max_live_workers(&registry_ext_dir);

    let (decision, reason) = if workspace.kind == "non-git" {
        (
            "not-needed",
            "current project is not inside a git repository",
        )
    } else if !task_name.is_empty()
        && workspace.kind == "worktree"
        && (!task_worktree_path.is_empty()
            && same_path(
                Path::new(&workspace.repo_root),
                Path::new(&task_worktree_path),
            )
            || workspace.branch == format!("task/{task_name}"))
    {
        ("not-needed", "already inside this task worktree")
    } else if max_live_workers > 0 && sessions.len() > max_live_workers {
        (
            "required",
            "active AI session count exceeds channel.worker_guard.max_live_workers",
        )
    } else if workspace.kind == "main" && other_main_sessions > 0 {
        (
            "required",
            "another active AI session is using the main workspace",
        )
    } else if workspace.kind == "main"
        && workspace.dirty
        && !task_name.is_empty()
        && !current_task.is_empty()
        && current_task != task_name
    {
        (
            "required",
            "main workspace has dirty changes for a different active task",
        )
    } else if !task_worktree_path.is_empty() && Path::new(&task_worktree_path).exists() {
        ("recommended", "this task already has a recorded worktree")
    } else if workspace.kind == "main" && workspace.dirty {
        ("recommended", "main workspace has dirty changes")
    } else {
        ("not-needed", "single clean workspace or read-only flow")
    };

    WorktreePolicy {
        decision: decision.to_string(),
        reason: reason.to_string(),
        target_task: task_name.clone(),
        recommended_command: if task_name.is_empty() {
            "/emb:task worktree status".to_string()
        } else {
            format!("/emb:task activate {task_name} --worktree")
        },
        workspace,
        active_sessions: sessions,
        task_worktree_path,
    }
}

pub fn worktree_policy_json(policy: &WorktreePolicy) -> Value {
    serde_json::to_value(policy).unwrap_or_else(|_| json!({}))
}

fn session_registry_ext_dir(ext_dir: &Path, workspace: &WorkspaceStatus) -> PathBuf {
    if workspace.git_available && !workspace.main_worktree.is_empty() {
        let main_ext = Path::new(&workspace.main_worktree).join(".emb-agent");
        if main_ext.exists() || workspace.kind == "worktree" {
            return main_ext;
        }
    }
    ext_dir.to_path_buf()
}

fn read_session(ext_dir: &Path, session_id: &str) -> Option<SessionHeartbeat> {
    let path = ext_dir
        .join("sessions")
        .join(format!("{}.json", safe_file_stem(session_id)));
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<SessionHeartbeat>(&content).ok()
}

fn read_session_task_from_path(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<SessionHeartbeat>(&content).ok())
        .map(|session| session.task.trim().to_string())
        .filter(|task| !task.is_empty())
}

fn clear_task_from_sessions_dir(ext_dir: &Path, task_name: &str) -> usize {
    let task_name = task_name.trim();
    if task_name.is_empty() {
        return 0;
    }
    let sessions_dir = ext_dir.join("sessions");
    let Ok(entries) = fs::read_dir(&sessions_dir) else {
        return 0;
    };
    let mut cleared = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(mut session) = serde_json::from_str::<SessionHeartbeat>(&content) else {
            continue;
        };
        if session.task.trim() != task_name {
            continue;
        }
        session.task.clear();
        session.updated_at_ms = now_ms();
        if let Ok(body) = serde_json::to_string_pretty(&session)
            && fs::write(path, body).is_ok()
        {
            cleared += 1;
        }
    }
    cleared
}

fn current_task_name(ext_dir: &Path) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    fs::read_to_string(state_dir.join(".current-task"))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn task_recorded_worktree_path(ext_dir: &Path, task_name: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(task_name).join("task.json");
    let Ok(content) = fs::read_to_string(task_path) else {
        return String::new();
    };
    let Ok(task) = serde_json::from_str::<Value>(&content) else {
        return String::new();
    };
    task.get("worktree_path")
        .and_then(Value::as_str)
        .or_else(|| {
            task.get("worktree")
                .and_then(|w| w.get("path"))
                .and_then(Value::as_str)
        })
        .unwrap_or("")
        .to_string()
}

fn session_id_from_env(host: &str, repo_root: &str) -> String {
    if let Some(value) = env_session_id() {
        return value;
    }
    let safe_repo = safe_file_stem(repo_root);
    format!("{host}-{safe_repo}")
}

fn env_session_id() -> Option<String> {
    [
        "EMB_AGENT_SESSION_ID",
        "PI_SESSION_ID",
        "CODEX_SESSION_ID",
        "CLAUDE_SESSION_ID",
    ]
    .into_iter()
    .find_map(|key| {
        std::env::var(key)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn git_stdout(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() { None } else { Some(value) }
}

fn is_git_dirty(path: &Path) -> bool {
    Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(path)
        .output()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .any(|line| !line.contains(".emb-agent/sessions/"))
        })
        .unwrap_or(false)
}

fn same_path(a: &Path, b: &Path) -> bool {
    let ac = a.canonicalize().unwrap_or_else(|_| a.to_path_buf());
    let bc = b.canonicalize().unwrap_or_else(|_| b.to_path_buf());
    ac == bc
}

fn safe_file_stem(value: &str) -> String {
    let safe = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if safe.is_empty() {
        "session".to_string()
    } else {
        safe
    }
}

fn worker_guard_idle_timeout_ms(ext_dir: &Path) -> u128 {
    config_scalar(ext_dir, "channel", "worker_guard", "idle_timeout")
        .and_then(|value| parse_duration_ms(&value))
        .unwrap_or(SESSION_TTL_MS)
}

fn worker_guard_max_live_workers(ext_dir: &Path) -> usize {
    config_scalar(ext_dir, "channel", "worker_guard", "max_live_workers")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(6)
}

fn config_scalar(ext_dir: &Path, section: &str, sub_section: &str, key: &str) -> Option<String> {
    let text = fs::read_to_string(ext_dir.join("config.yaml")).ok()?;
    let mut current = "";
    let mut sub = "";
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("");
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !line.starts_with(' ') && trimmed.ends_with(':') {
            current = trimmed.trim_end_matches(':');
            sub = "";
            continue;
        }
        if line.starts_with("  ") && !line.starts_with("    ") && trimmed.ends_with(':') {
            sub = trimmed.trim_end_matches(':');
            continue;
        }
        if current == section
            && sub == sub_section
            && let Some((k, v)) = trimmed.split_once(':')
            && k.trim() == key
        {
            return Some(v.trim().trim_matches('"').trim_matches('\'').to_string());
        }
    }
    None
}

fn parse_duration_ms(value: &str) -> Option<u128> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (number, multiplier) = if let Some(v) = trimmed.strip_suffix("ms") {
        (v, 1)
    } else if let Some(v) = trimmed.strip_suffix('s') {
        (v, 1_000)
    } else if let Some(v) = trimmed.strip_suffix('m') {
        (v, 60_000)
    } else if let Some(v) = trimmed.strip_suffix('h') {
        (v, 60 * 60_000)
    } else {
        (trimmed, 1)
    };
    number.trim().parse::<u128>().ok().map(|n| n * multiplier)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
