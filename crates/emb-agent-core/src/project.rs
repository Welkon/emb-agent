use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::json::json_string_field;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TaskSnapshot {
    pub name: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub package: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectSnapshot {
    pub initialized: bool,
    pub project_root: String,
    pub developer: String,
    pub mcu_model: String,
    pub mcu_package: String,
    pub default_package: String,
    pub active_package: String,
    pub git_branch: String,
    pub open_tasks: usize,
    pub wiki_pages: usize,
    pub current_task: Option<TaskSnapshot>,
    pub recommended_command: String,
    pub recommended_reason: String,
}

pub fn snapshot_from_cwd(cwd: &str) -> ProjectSnapshot {
    let Some(root) = find_project_root(Path::new(cwd)) else {
        return ProjectSnapshot {
            initialized: false,
            recommended_command: "init".to_string(),
            recommended_reason: "No .emb-agent directory found".to_string(),
            ..ProjectSnapshot::default()
        };
    };

    let ext = root.join(".emb-agent");
    let project_json = read_text(&ext.join("project.json"));
    let hw_yaml = read_text(&ext.join("hw.yaml"));
    let developer_json = read_text(&ext.join(".developer"));
    let current_task = read_current_task(&ext);
    let open_tasks = count_open_tasks(&ext);
    let wiki_pages = count_wiki_pages(&ext);
    let git_branch = git_branch(&root);
    let mcu_model = yaml_nested_string(&hw_yaml, "mcu", "model");
    let mcu_package = yaml_nested_string(&hw_yaml, "mcu", "package");

    let (recommended_command, recommended_reason) = if current_task.is_some() {
        ("do".to_string(), "Active task is selected".to_string())
    } else if mcu_model.is_empty() {
        (
            "declare hardware".to_string(),
            "MCU model is not declared".to_string(),
        )
    } else {
        (
            "next".to_string(),
            "Project has hardware context; continue workflow routing".to_string(),
        )
    };

    ProjectSnapshot {
        initialized: root.join(".emb-agent").join("project.json").exists(),
        project_root: root.to_string_lossy().to_string(),
        developer: json_string_field(&developer_json, "name"),
        mcu_model,
        mcu_package,
        default_package: json_string_field(&project_json, "default_package"),
        active_package: json_string_field(&project_json, "active_package"),
        git_branch,
        open_tasks,
        wiki_pages,
        current_task,
        recommended_command,
        recommended_reason,
    }
}

pub fn find_project_root(start: &Path) -> Option<PathBuf> {
    let mut current = if start.is_absolute() {
        start.to_path_buf()
    } else {
        env::current_dir().ok()?.join(start)
    };

    current = current.canonicalize().unwrap_or(current);

    loop {
        if current.join(".emb-agent").is_dir() {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}

pub fn read_current_task(ext: &Path) -> Option<TaskSnapshot> {
    let task_name = read_text(&ext.join(".current-task"));
    if task_name.is_empty() {
        return None;
    }

    let task_json = read_text(&ext.join("tasks").join(&task_name).join("task.json"));
    if task_json.is_empty() {
        return None;
    }

    let status = json_string_field(&task_json, "status");
    if is_closed_task(&status) {
        return None;
    }

    Some(TaskSnapshot {
        name: task_name.clone(),
        title: first_non_empty(&[
            json_string_field(&task_json, "title"),
            json_string_field(&task_json, "name"),
            task_name,
        ]),
        status,
        priority: first_non_empty(&[json_string_field(&task_json, "priority"), "P2".to_string()]),
        package: json_string_field(&task_json, "package"),
    })
}

pub fn count_open_tasks(ext: &Path) -> usize {
    let tasks_dir = ext.join("tasks");
    let Ok(entries) = fs::read_dir(tasks_dir) else {
        return 0;
    };

    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|ty| ty.is_dir()).unwrap_or(false))
        .filter(|entry| entry.file_name().to_string_lossy() != "archive")
        .filter(|entry| {
            let text = read_text(&entry.path().join("task.json"));
            !text.is_empty() && !is_closed_task(&json_string_field(&text, "status"))
        })
        .count()
}

pub fn count_wiki_pages(ext: &Path) -> usize {
    fn walk(dir: &Path, count: &mut usize) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, count);
                continue;
            }
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if name.ends_with(".md") && name != "index.md" && name != "log.md" {
                *count += 1;
            }
        }
    }

    let mut count = 0;
    walk(&ext.join("wiki"), &mut count);
    count
}

pub fn is_closed_task(status: &str) -> bool {
    matches!(
        status.trim().to_ascii_lowercase().as_str(),
        "completed" | "resolved" | "closed" | "rejected" | "archived" | "cancelled" | "canceled"
    )
}

pub fn git_branch(project_root: &Path) -> String {
    if !project_root.join(".git").exists() {
        return String::new();
    }
    Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(project_root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

pub fn read_text(path: &Path) -> String {
    fs::read_to_string(path)
        .unwrap_or_default()
        .trim()
        .to_string()
}

pub fn yaml_nested_string(source: &str, parent: &str, child: &str) -> String {
    let mut inside_parent = false;
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let is_top_level = !line.starts_with(' ') && !line.starts_with('\t');
        if is_top_level {
            inside_parent = trimmed == format!("{parent}:");
            continue;
        }
        if inside_parent {
            let child_prefix = format!("{child}:");
            if let Some(value) = trimmed.strip_prefix(&child_prefix) {
                return unquote_yaml_scalar(value.trim()).to_string();
            }
        }
    }
    String::new()
}

pub fn unquote_yaml_scalar(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        if (bytes[0] == b'"' && bytes[trimmed.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[trimmed.len() - 1] == b'\'')
        {
            return &trimmed[1..trimmed.len() - 1];
        }
    }
    trimmed
}

pub fn first_non_empty(values: &[String]) -> String {
    values
        .iter()
        .find(|value| !value.trim().is_empty())
        .cloned()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = env::temp_dir().join(format!("emb-agent-rs-test-{nonce}"));
        fs::create_dir_all(root.join(".emb-agent/tasks/task-1")).unwrap();
        fs::create_dir_all(root.join(".emb-agent/wiki/chips")).unwrap();
        fs::write(
            root.join(".emb-agent/hw.yaml"),
            "mcu:\n  vendor: Espressif\n  model: ESP32-C3\n  package: QFN32\n",
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/project.json"),
            "{\"default_package\":\"core\",\"active_package\":\"core\"}",
        )
        .unwrap();
        fs::write(root.join(".emb-agent/.developer"), "{\"name\":\"Felix\"}").unwrap();
        fs::write(root.join(".emb-agent/.current-task"), "task-1\n").unwrap();
        fs::write(
            root.join(".emb-agent/tasks/task-1/task.json"),
            "{\"title\":\"Implement ADC\",\"status\":\"active\",\"priority\":\"P1\"}",
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/wiki/chips/esp32-c3.md"),
            "# ESP32-C3\n",
        )
        .unwrap();
        root
    }

    #[test]
    fn reads_project_snapshot() {
        let root = temp_project();
        let snapshot = snapshot_from_cwd(root.to_str().unwrap());
        assert!(snapshot.initialized);
        assert_eq!(snapshot.mcu_model, "ESP32-C3");
        assert_eq!(snapshot.mcu_package, "QFN32");
        assert_eq!(snapshot.developer, "Felix");
        assert_eq!(snapshot.open_tasks, 1);
        assert_eq!(snapshot.wiki_pages, 1);
        assert_eq!(snapshot.recommended_command, "do");
        assert_eq!(snapshot.current_task.unwrap().title, "Implement ADC");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn closed_tasks_are_not_active() {
        assert!(is_closed_task("completed"));
        assert!(is_closed_task("CANCELED"));
        assert!(!is_closed_task("active"));
    }

    #[test]
    fn yaml_nested_string_reads_child_scalar() {
        let yaml = "mcu:\n  model: \"ESP32-C3\"\n  package: 'QFN32'\n";
        assert_eq!(yaml_nested_string(yaml, "mcu", "model"), "ESP32-C3");
        assert_eq!(yaml_nested_string(yaml, "mcu", "package"), "QFN32");
    }
}
