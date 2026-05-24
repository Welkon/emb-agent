use std::fs;
use std::path::Path;
use serde_json::{json, Value};

use crate::json::json_quote;

/// Create a new task
pub fn task_add(ext_dir: &Path, summary: &str, _task_type: &str, priority: &str) -> String {
    let tasks_dir = ext_dir.join("tasks");
    let _ = fs::create_dir_all(&tasks_dir);

    // Generate a unique task name from summary
    let name = summary
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let name = if name.len() > 60 { name[..60].to_string() } else { name };

    let task_dir = tasks_dir.join(&name);
    if task_dir.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"task-exists\",\"message\":\"Task already exists: {}\"}}}}",
            name
        );
    }
    let _ = fs::create_dir_all(&task_dir);

    let now = chrono_now();
    let task_id = format!("{}-{}", now.split('T').next().unwrap_or("task"), &name[..8.min(name.len())]);

    let task = json!({
        "id": task_id,
        "name": name,
        "title": summary,
        "description": summary,
        "status": "pending",
        "dev_type": "embedded",
        "scope": format!("task-{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()),
        "package": "",
        "priority": priority,
        "creator": "",
        "assignee": "",
        "createdAt": now,
        "completedAt": null,
        "branch": format!("task/{}", name),
        "base_branch": "",
        "worktree_path": null,
        "current_phase": 1,
        "next_action": [
            {"phase": 1, "action": "implement"},
            {"phase": 2, "action": "check"},
            {"phase": 3, "action": "finish"},
            {"phase": 4, "action": "create-pr"}
        ],
        "commit": "",
        "pr_url": "",
        "pr": {"status": ""},
        "artifacts": {
            "prd": format!("docs/prd/tasks/{}.md", name),
            "implement": [],
            "check": [],
            "debug": [],
            "aar": format!(".emb-agent/tasks/{}/aar.md", name)
        },
        "context": {
            "implement": [],
            "check": [],
            "debug": []
        },
        "injected_specs": []
    });

    let _ = fs::write(
        task_dir.join("task.json"),
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );

    // Create empty context files
    for f in &["implement.jsonl", "check.jsonl", "debug.jsonl"] {
        let _ = fs::write(task_dir.join(f), "");
    }

    format!(
        "{{\"status\":\"ok\",\"created\":true,\"task\":{{\"name\":{},\"title\":{},\"status\":\"pending\",\"priority\":{}}},\"next_step\":\"task activate {}\"}}",
        json_quote(&name),
        json_quote(summary),
        json_quote(priority),
        name
    )
}

/// Activate a task (set as current)
pub fn task_activate(ext_dir: &Path, name: &str) -> String {
    let task_path = ext_dir.join("tasks").join(name).join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }

    // Read task, update status
    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    if let Some(obj) = task.as_object_mut() {
        obj.insert("status".to_string(), json!("in_progress"));
    }
    let _ = fs::write(&task_path, serde_json::to_string_pretty(&task).unwrap_or_default());

    // Write current task file
    let current_task_file = ext_dir.join(".current-task");
    let _ = fs::write(&current_task_file, name);

    format!(
        "{{\"status\":\"ok\",\"activated\":true,\"task\":{{\"name\":{},\"status\":\"in_progress\"}}}}",
        json_quote(name)
    )
}

/// Resolve (complete) a task
pub fn task_resolve(ext_dir: &Path, name: &str, note: &str) -> String {
    let task_path = ext_dir.join("tasks").join(name).join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }

    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    if let Some(obj) = task.as_object_mut() {
        obj.insert("status".to_string(), json!("completed"));
        obj.insert("completedAt".to_string(), json!(chrono_now()));
        if !note.is_empty() {
            obj.insert("resolution_note".to_string(), json!(note));
        }
    }
    let _ = fs::write(&task_path, serde_json::to_string_pretty(&task).unwrap_or_default());

    // Clear current task if this was active
    let current_task_file = ext_dir.join(".current-task");
    if fs::read_to_string(&current_task_file).unwrap_or_default().trim() == name {
        let _ = fs::write(&current_task_file, "");
    }

    format!(
        "{{\"status\":\"ok\",\"resolved\":true,\"task\":{{\"name\":{},\"status\":\"completed\"}}}}",
        json_quote(name)
    )
}

fn chrono_now() -> String {
    // ISO 8601 without chrono dependency
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // Approximate: YYYY-MM-DDTHH:MM:SS.sssZ
    let days = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let mins = (time_secs % 3600) / 60;
    let secs_rem = time_secs % 60;
    // Simple date calculation from epoch (2026)
    let total_days = days as i64 + 19719; // days from 1970-01-01 to 2026-01-01 approx
    let year = 1970 + (total_days / 365);
    let day_of_year = total_days % 365;
    let month_days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 1;
    let mut remaining = day_of_year;
    for (i, &md) in month_days.iter().enumerate() {
        if remaining < md as i64 {
            month = i + 1;
            break;
        }
        remaining -= md as i64;
    }
    let day = remaining + 1;
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        year, month, day, hours, mins, secs_rem
    )
}
