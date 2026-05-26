use serde_json::{Value, json};
use std::fs;
use std::path::Path;

use crate::json::json_quote;

/// Create a new task
pub fn task_add(ext_dir: &Path, summary: &str, _task_type: &str, priority: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let tasks_dir = state_dir.join("tasks");
    let _ = fs::create_dir_all(&tasks_dir);

    // Generate a unique task name from summary
    let name = summary
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let name = if name.len() > 60 {
        name[..60].to_string()
    } else {
        name
    };

    let task_dir = tasks_dir.join(&name);
    if task_dir.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"task-exists\",\"message\":\"Task already exists: {}\"}}}}",
            name
        );
    }
    let _ = fs::create_dir_all(&task_dir);

    let now = chrono_now();
    let task_id = format!(
        "{}-{}",
        now.split('T').next().unwrap_or("task"),
        &name[..8.min(name.len())]
    );

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
        "{{\"status\":\"ok\",\"created\":true,\"task\":{{\"name\":{},\"title\":{},\"status\":\"pending\",\"priority\":{}}},\"next\":\"task activate\",\"next_instructions\":\"Task created. Present the created task to the user and ask whether to activate it now. Do not ask the user to run a command.\",\"activation_command\":\"/emb:task activate {}\"}}",
        json_quote(&name),
        json_quote(summary),
        json_quote(priority),
        name
    )
}

/// Activate a task (set as current)
pub fn task_activate(ext_dir: &Path, name: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(name).join("task.json");
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
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );

    // Write current task file
    let current_task_file = state_dir.join(".current-task");
    let _ = fs::write(&current_task_file, name);

    format!(
        "{{\"status\":\"ok\",\"activated\":true,\"task\":{{\"name\":{},\"status\":\"in_progress\"}},\"next\":\"do\",\"next_instructions\":\"Task activated. Trigger `/emb:do` to start implementation.\"}}",
        json_quote(name)
    )
}

/// Resolve (complete) a task
pub fn task_resolve(ext_dir: &Path, name: &str, note: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(name).join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }

    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    let current_status = task.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if matches!(current_status, "completed" | "done" | "resolved" | "closed") {
        return format!(
            "{{\"status\":\"ok\",\"resolved\":false,\"already_completed\":true,\"task\":{{\"name\":{},\"status\":{}}},\"next\":\"next\",\"next_instructions\":\"Task is already completed. Trigger `/emb:next` for the next action.\"}}",
            json_quote(name),
            json_quote(current_status)
        );
    }

    let gate = aar_gate(&task);
    if !gate.allowed {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"aar-required\",\"message\":{}}},\"task\":{{\"name\":{}}},\"aar\":{{\"scan_completed\":{},\"record_required\":{},\"record_completed\":{}}},\"next\":{},\"next_instructions\":{}}}",
            json_quote(&gate.message),
            json_quote(name),
            gate.scan_completed,
            gate.record_required,
            gate.record_completed,
            json_quote(&gate.next),
            json_quote(&gate.instructions)
        );
    }

    if let Some(obj) = task.as_object_mut() {
        obj.insert("status".to_string(), json!("completed"));
        obj.insert("completedAt".to_string(), json!(chrono_now()));
        if !note.is_empty() {
            obj.insert("resolution_note".to_string(), json!(note));
        }
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );

    // Clear current task if this was active
    let current_task_file = state_dir.join(".current-task");
    if fs::read_to_string(&current_task_file)
        .unwrap_or_default()
        .trim()
        == name
    {
        let _ = fs::write(&current_task_file, "");
    }

    format!(
        "{{\"status\":\"ok\",\"resolved\":true,\"task\":{{\"name\":{},\"status\":\"completed\"}},\"next\":\"next\",\"next_instructions\":\"Task completed. Trigger `/emb:next` to find the next task or action.\"}}",
        json_quote(name)
    )
}

pub fn task_aar_status(ext_dir: &Path, name: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_path = state_dir.join("tasks").join(name).join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }
    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    let gate = aar_gate(&task);
    format!(
        "{{\"status\":\"ok\",\"task\":{{\"name\":{}}},\"aar\":{{\"scan_completed\":{},\"record_required\":{},\"record_completed\":{},\"allowed\":{},\"message\":{}}}}}",
        json_quote(name),
        gate.scan_completed,
        gate.record_required,
        gate.record_completed,
        gate.allowed,
        json_quote(&gate.message)
    )
}

pub fn task_aar_scan(ext_dir: &Path, name: &str, lessons: Option<bool>) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_dir = state_dir.join("tasks").join(name);
    let task_path = task_dir.join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }
    if lessons.is_none() {
        return format!(
            "{{\"status\":\"needs-answer\",\"task\":{{\"name\":{}}},\"questions\":[\"Did this task reveal a new hardware invariant?\",\"Did it reveal a reusable firmware pattern?\",\"Did it reveal a debugging pitfall or tool gotcha?\",\"Did it change project-local workflow rules?\"],\"next\":\"task aar scan\",\"next_instructions\":\"Ask the user these AAR questions. After the answers are clear, trigger `/emb:task aar scan {} --no-lessons` if all answers are no, or `/emb:task aar scan {} --lessons` if any answer is yes. Do not ask the user to run the command.\"}}",
            json_quote(name),
            name,
            name
        );
    }

    let record_required = lessons.unwrap_or(false);
    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    if let Some(obj) = task.as_object_mut() {
        obj.insert(
            "aar".to_string(),
            json!({
                "scan_completed": true,
                "record_required": record_required,
                "record_completed": !record_required,
                "updated_at": chrono_now()
            }),
        );
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );
    let aar_path = task_dir.join("aar.md");
    let body = if record_required {
        format!(
            "# AAR: {}\n\nScan completed. Lessons are present and must be recorded before resolve.\n",
            name
        )
    } else {
        format!(
            "# AAR: {}\n\nScan completed. No durable lessons were found.\n",
            name
        )
    };
    let _ = fs::write(&aar_path, body);
    format!(
        "{{\"status\":\"ok\",\"task\":{{\"name\":{}}},\"aar\":{{\"scan_completed\":true,\"record_required\":{},\"record_completed\":{}}},\"next\":{},\"next_instructions\":{}}}",
        json_quote(name),
        record_required,
        !record_required,
        json_quote(if record_required {
            "task aar record"
        } else {
            "task resolve"
        }),
        json_quote(if record_required {
            "Ask the user for the lesson note, then trigger `/emb:task aar record <task> <note>` before resolve. Do not ask the user to run the command."
        } else {
            "AAR gate is clear. Trigger `/emb:task resolve <task>` when the user confirms closure."
        })
    )
}

pub fn task_aar_record(ext_dir: &Path, name: &str, note: &str) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let task_dir = state_dir.join("tasks").join(name);
    let task_path = task_dir.join("task.json");
    if !task_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Task not found: {}\"}}}}",
            name
        );
    }
    let content = fs::read_to_string(&task_path).unwrap_or_default();
    let mut task: Value = serde_json::from_str(&content).unwrap_or(Value::Null);
    if let Some(obj) = task.as_object_mut() {
        obj.insert(
            "aar".to_string(),
            json!({
                "scan_completed": true,
                "record_required": true,
                "record_completed": true,
                "updated_at": chrono_now(),
                "note": note
            }),
        );
    }
    let _ = fs::write(
        &task_path,
        serde_json::to_string_pretty(&task).unwrap_or_default(),
    );
    let aar_path = task_dir.join("aar.md");
    let existing = fs::read_to_string(&aar_path).unwrap_or_else(|_| format!("# AAR: {}\n", name));
    let updated = format!(
        "{}\n\n## Recorded Lesson ({})\n\n{}\n",
        existing.trim_end(),
        chrono_now(),
        note
    );
    let _ = fs::write(&aar_path, updated);
    format!(
        "{{\"status\":\"ok\",\"recorded\":true,\"task\":{{\"name\":{}}},\"next\":\"task resolve\",\"next_instructions\":\"AAR recorded. Trigger `/emb:task resolve {}` when the user confirms closure.\"}}",
        json_quote(name),
        name
    )
}

struct AarGate {
    allowed: bool,
    scan_completed: bool,
    record_required: bool,
    record_completed: bool,
    message: String,
    next: String,
    instructions: String,
}

fn aar_gate(task: &Value) -> AarGate {
    let aar = task.get("aar").unwrap_or(&Value::Null);
    let scan_completed = aar
        .get("scan_completed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let record_required = aar
        .get("record_required")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let record_completed = aar
        .get("record_completed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !scan_completed {
        return AarGate {
            allowed: false,
            scan_completed,
            record_required,
            record_completed,
            message: "AAR scan is required before task resolve".to_string(),
            next: "task aar scan".to_string(),
            instructions: "Ask the AAR questions, then trigger `/emb:task aar scan <task> --no-lessons` or `--lessons`. Do not ask the user to run the command."
                .to_string(),
        };
    }
    if record_required && !record_completed {
        return AarGate {
            allowed: false,
            scan_completed,
            record_required,
            record_completed,
            message: "AAR record is required because scan found lessons".to_string(),
            next: "task aar record".to_string(),
            instructions: "Ask for the lesson note, then trigger `/emb:task aar record <task> <note>` before resolve. Do not ask the user to run the command.".to_string(),
        };
    }
    AarGate {
        allowed: true,
        scan_completed,
        record_required,
        record_completed,
        message: "AAR gate satisfied".to_string(),
        next: "task resolve".to_string(),
        instructions: "AAR gate is clear.".to_string(),
    }
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
