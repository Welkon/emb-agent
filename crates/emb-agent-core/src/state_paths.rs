use std::env;
use std::path::{Component, Path, PathBuf};

use sha1::{Digest, Sha1};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatePathConfig {
    pub project_state_dir: String,
    pub legacy_project_state_dir: String,
}

impl Default for StatePathConfig {
    fn default() -> Self {
        Self {
            project_state_dir: "../state/emb-agent/projects".to_string(),
            legacy_project_state_dir: "state/projects".to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectStateFilePaths {
    pub state_dir: String,
    pub session_path: String,
    pub handoff_path: String,
    pub context_summary_path: String,
    pub lock_path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectStatePaths {
    pub project_root: String,
    pub project_key: String,
    pub state_dir: String,
    pub legacy_state_dir: String,
    pub fallback_state_dir: String,
    pub session_path: String,
    pub handoff_path: String,
    pub context_summary_path: String,
    pub lock_path: String,
    pub legacy_session_path: String,
    pub legacy_handoff_path: String,
    pub legacy_lock_path: String,
    pub fallback_session_path: String,
    pub fallback_handoff_path: String,
    pub fallback_context_summary_path: String,
    pub fallback_lock_path: String,
    pub primary_state_dir: String,
    pub primary_session_path: String,
    pub primary_handoff_path: String,
    pub primary_context_summary_path: String,
    pub primary_lock_path: String,
    pub storage_mode: String,
}

pub fn get_project_state_paths(
    root_dir: &Path,
    cwd: &Path,
    config: &StatePathConfig,
) -> ProjectStatePaths {
    let runtime_root = absolute_lexical_path(root_dir);
    let project_root = canonicalize_project_root(cwd);
    let project_key = get_project_key_from_canonical_root(&project_root);
    let state_dir = normalize_path(&absolute_lexical_path(
        &runtime_root.join(&config.project_state_dir),
    ));
    let legacy_state_dir = normalize_path(&absolute_lexical_path(
        &runtime_root.join(&config.legacy_project_state_dir),
    ));
    let fallback_state_dir = get_fallback_project_state_dir(&runtime_root);

    let primary_paths = build_project_state_file_paths(Path::new(&state_dir), &project_key);
    let legacy_paths = build_project_state_file_paths(Path::new(&legacy_state_dir), &project_key);
    let fallback_paths =
        build_project_state_file_paths(Path::new(&fallback_state_dir), &project_key);

    ProjectStatePaths {
        project_root,
        project_key,
        state_dir: primary_paths.state_dir.clone(),
        legacy_state_dir,
        fallback_state_dir: fallback_paths.state_dir.clone(),
        session_path: primary_paths.session_path.clone(),
        handoff_path: primary_paths.handoff_path.clone(),
        context_summary_path: primary_paths.context_summary_path.clone(),
        lock_path: primary_paths.lock_path.clone(),
        legacy_session_path: legacy_paths.session_path,
        legacy_handoff_path: legacy_paths.handoff_path,
        legacy_lock_path: legacy_paths.lock_path,
        fallback_session_path: fallback_paths.session_path,
        fallback_handoff_path: fallback_paths.handoff_path,
        fallback_context_summary_path: fallback_paths.context_summary_path,
        fallback_lock_path: fallback_paths.lock_path,
        primary_state_dir: primary_paths.state_dir,
        primary_session_path: primary_paths.session_path,
        primary_handoff_path: primary_paths.handoff_path,
        primary_context_summary_path: primary_paths.context_summary_path,
        primary_lock_path: primary_paths.lock_path,
        storage_mode: "primary".to_string(),
    }
}

pub fn build_project_state_file_paths(
    state_dir: &Path,
    project_key: &str,
) -> ProjectStateFilePaths {
    let state_dir = normalize_path(state_dir);
    let state_dir_path = Path::new(&state_dir);
    ProjectStateFilePaths {
        state_dir: state_dir.clone(),
        session_path: normalize_path(&state_dir_path.join(format!("{project_key}.json"))),
        handoff_path: normalize_path(&state_dir_path.join(format!("{project_key}.handoff.json"))),
        context_summary_path: normalize_path(
            &state_dir_path.join(format!("{project_key}.context-summary.json")),
        ),
        lock_path: normalize_path(&state_dir_path.join(format!("{project_key}.lock"))),
    }
}

pub fn get_fallback_project_state_dir(root_dir: &Path) -> String {
    if let Ok(value) = env::var("EMB_AGENT_PROJECT_STATE_FALLBACK_DIR") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return normalize_path(&PathBuf::from(trimmed));
        }
    }

    let runtime_key = sha1_hex12(&normalize_path(&absolute_lexical_path(root_dir)));
    normalize_path(
        &env::temp_dir()
            .join("emb-agent-state")
            .join(runtime_key)
            .join("projects"),
    )
}

pub fn get_project_key(project_root: &Path) -> String {
    get_project_key_from_canonical_root(&canonicalize_project_root(project_root))
}

pub fn get_project_key_from_canonical_root(project_root: &str) -> String {
    sha1_hex12(project_root)
}

pub fn canonicalize_project_root(project_root: &Path) -> String {
    let resolved = if project_root.is_absolute() {
        project_root.to_path_buf()
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(project_root)
    };
    let real_path = resolved.canonicalize().unwrap_or(resolved);
    normalize_case_insensitive_project_root(&normalize_path(&real_path))
}

pub fn normalize_case_insensitive_project_root(project_root: &str) -> String {
    let normalized = project_root.replace('\\', "/");
    let Some(rest) = normalized.strip_prefix("/mnt/") else {
        return normalized;
    };
    let mut chars = rest.chars();
    let Some(drive) = chars.next() else {
        return normalized;
    };
    let tail = chars.as_str();
    if tail.is_empty() {
        return format!("/mnt/{}", drive.to_ascii_lowercase());
    }
    if let Some(path_tail) = tail.strip_prefix('/') {
        return format!(
            "/mnt/{}/{}",
            drive.to_ascii_lowercase(),
            path_tail.to_ascii_lowercase()
        );
    }
    normalized
}

pub fn get_project_asset_relative_path(parts: &[&str]) -> String {
    let mut normalized = vec![".emb-agent".to_string()];
    for part in parts {
        let value = part.replace('\\', "/");
        for segment in value.split('/') {
            let trimmed = segment.trim_matches('/').trim();
            if !trimmed.is_empty() {
                normalized.push(trimmed.to_string());
            }
        }
    }
    normalized.join("/")
}

pub fn normalize_project_relative_path(value: &str) -> String {
    let text = value.trim();
    if text.is_empty() {
        return String::new();
    }
    let normalized = text.replace('\\', "/");
    if normalized == "emb-agent" {
        return ".emb-agent".to_string();
    }
    if let Some(rest) = normalized.strip_prefix("emb-agent/") {
        return format!(".emb-agent/{rest}");
    }
    normalized
}

pub fn resolve_project_data_path(project_root: &Path, parts: &[&str]) -> String {
    let current_path = project_root.join(get_project_asset_relative_path(parts));
    if current_path.exists() {
        return normalize_path(&current_path);
    }
    let legacy_path = project_root
        .join("emb-agent")
        .join(parts.iter().collect::<PathBuf>());
    if legacy_path.exists() {
        return normalize_path(&legacy_path);
    }
    normalize_path(&current_path)
}

pub fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn absolute_lexical_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    lexical_normalize(&absolute)
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

pub fn build_project_state_paths_json(paths: &ProjectStatePaths) -> String {
    serde_json::json!({
        "status": "ok",
        "runtime": "emb-agent-rs-spike",
        "project_root": paths.project_root,
        "project_key": paths.project_key,
        "storage_mode": paths.storage_mode,
        "state_dir": paths.state_dir,
        "legacy_state_dir": paths.legacy_state_dir,
        "fallback_state_dir": paths.fallback_state_dir,
        "session_path": paths.session_path,
        "handoff_path": paths.handoff_path,
        "context_summary_path": paths.context_summary_path,
        "lock_path": paths.lock_path,
        "primary": {
            "state_dir": paths.primary_state_dir,
            "session_path": paths.primary_session_path,
            "handoff_path": paths.primary_handoff_path,
            "context_summary_path": paths.primary_context_summary_path,
            "lock_path": paths.primary_lock_path,
        },
        "legacy": {
            "state_dir": paths.legacy_state_dir,
            "session_path": paths.legacy_session_path,
            "handoff_path": paths.legacy_handoff_path,
            "lock_path": paths.legacy_lock_path,
        },
        "fallback": {
            "state_dir": paths.fallback_state_dir,
            "session_path": paths.fallback_session_path,
            "handoff_path": paths.fallback_handoff_path,
            "context_summary_path": paths.fallback_context_summary_path,
            "lock_path": paths.fallback_lock_path,
        },
    })
    .to_string()
}

pub fn sha1_hex12(value: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    format!("{digest:x}").chars().take(12).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        env::temp_dir().join(format!("{prefix}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn project_key_matches_node_sha1_shape() {
        assert_eq!(sha1_hex12("/tmp/example"), "88030e5027ce");
        assert_eq!(
            get_project_key_from_canonical_root("/tmp/example"),
            "88030e5027ce"
        );
    }

    #[test]
    fn normalizes_wsl_mount_roots_like_node_runtime() {
        assert_eq!(
            normalize_case_insensitive_project_root("/mnt/C/Users/Felix/Proj"),
            "/mnt/c/users/felix/proj"
        );
        assert_eq!(
            normalize_case_insensitive_project_root("/home/Felix/Proj"),
            "/home/Felix/Proj"
        );
    }

    #[test]
    fn builds_project_state_paths_with_primary_legacy_and_fallback() {
        let runtime_root = Path::new("/home/felix/.codex/emb-agent");
        let project_root = Path::new("/tmp/demo-project");
        let paths =
            get_project_state_paths(runtime_root, project_root, &StatePathConfig::default());
        assert_eq!(paths.project_root, "/tmp/demo-project");
        assert_eq!(paths.project_key, sha1_hex12("/tmp/demo-project"));
        assert_eq!(
            paths.state_dir,
            "/home/felix/.codex/state/emb-agent/projects"
        );
        assert_eq!(
            paths.legacy_state_dir,
            "/home/felix/.codex/emb-agent/state/projects"
        );
        assert!(
            paths
                .session_path
                .ends_with(&format!("{}.json", paths.project_key))
        );
        assert!(
            paths
                .handoff_path
                .ends_with(&format!("{}.handoff.json", paths.project_key))
        );
        assert!(
            paths
                .context_summary_path
                .ends_with(&format!("{}.context-summary.json", paths.project_key))
        );
        assert!(
            paths
                .lock_path
                .ends_with(&format!("{}.lock", paths.project_key))
        );
        assert!(paths.fallback_state_dir.contains("/emb-agent-state/"));
        assert_eq!(paths.storage_mode, "primary");
    }

    #[test]
    fn project_asset_paths_preserve_current_and_legacy_names() {
        assert_eq!(
            get_project_asset_relative_path(&["tasks", "task-1", "task.json"]),
            ".emb-agent/tasks/task-1/task.json"
        );
        assert_eq!(
            normalize_project_relative_path("emb-agent/hw.yaml"),
            ".emb-agent/hw.yaml"
        );
        assert_eq!(
            normalize_project_relative_path(".emb-agent/req.yaml"),
            ".emb-agent/req.yaml"
        );
    }

    #[test]
    fn resolves_legacy_project_data_path_when_current_file_is_missing() {
        let root = temp_dir("emb-agent-rs-state-paths");
        fs::create_dir_all(root.join("emb-agent")).unwrap();
        fs::write(root.join("emb-agent/hw.yaml"), "mcu:\n").unwrap();
        assert!(resolve_project_data_path(&root, &["hw.yaml"]).ends_with("emb-agent/hw.yaml"));
        fs::create_dir_all(root.join(".emb-agent")).unwrap();
        fs::write(root.join(".emb-agent/hw.yaml"), "mcu:\n").unwrap();
        assert!(resolve_project_data_path(&root, &["hw.yaml"]).ends_with(".emb-agent/hw.yaml"));
        let _ = fs::remove_dir_all(root);
    }
}
