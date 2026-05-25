use crate::json::json_quote;
use std::fs;
use std::path::Path;

/// Create a bug sub-task under a parent task
pub fn bug_add(ext_dir: &Path, parent_task: &str, summary: &str) -> String {
    let bugs_dir = ext_dir
        .join("tasks")
        .join(parent_task)
        .join("bugs");
    let _ = fs::create_dir_all(&bugs_dir);

    // Generate bug name from summary
    let name = summary
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let name = if name.len() > 50 {
        format!("bug-{}", &name[..50])
    } else {
        format!("bug-{}", name)
    };

    let bug_dir = bugs_dir.join(&name);
    if bug_dir.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"bug-exists\",\"message\":\"Bug already exists: {}\"}}}}",
            name
        );
    }
    let _ = fs::create_dir_all(&bug_dir);

    // Write bug manifest
    let now = chrono_now();
    let bug_json = format!(
        "{{\n  \"name\": {},\n  \"title\": {},\n  \"parent_task\": {},\n  \"type\": \"bug\",\n  \"status\": \"open\",\n  \"priority\": \"P1\",\n  \"found_at\": {},\n  \"phase\": \"debug\"\n}}",
        json_quote(&name),
        json_quote(summary),
        json_quote(parent_task),
        json_quote(&now)
    );
    let _ = fs::write(bug_dir.join("bug.json"), &bug_json);

    // Write evidence skeleton
    let evidence = format!(
        "# Bug: {}\n\n**Parent task:** {}\n**Found:** {}\n**Status:** open\n\n## Symptoms\n\n(Describe what went wrong)\n\n## Root Cause\n\n(What caused the bug)\n\n## Fix\n\n(How it was fixed)\n\n## Verification\n\n(How the fix was verified)\n",
        summary, parent_task, now
    );
    let _ = fs::write(bug_dir.join("evidence.md"), evidence);

    format!(
        "{{\"status\":\"ok\",\"created\":true,\"bug\":{{\"name\":{},\"title\":{},\"parent_task\":{},\"status\":\"open\",\"phase\":\"debug\"}},\"next\":\"do\",\"next_instructions\":\"Bug recorded. Continue fixing: read the bug evidence at .emb-agent/tasks/{}/bugs/{}/evidence.md, fix the code, run `emb-agent-rs verify`.\"}}",
        json_quote(&name),
        json_quote(summary),
        json_quote(parent_task),
        parent_task,
        name
    )
}

/// List bugs for a task or all bugs
pub fn bug_list(ext_dir: &Path, parent_task: Option<&str>) -> String {
    let tasks_dir = ext_dir.join("tasks");
    let mut bugs = Vec::new();

    if let Ok(task_entries) = fs::read_dir(&tasks_dir) {
        for task_entry in task_entries.flatten() {
            let task_name = task_entry.file_name().to_string_lossy().to_string();
            if let Some(filter) = parent_task
                && task_name != filter {
                    continue;
                }
            let bugs_dir = task_entry.path().join("bugs");
            if let Ok(bug_entries) = fs::read_dir(&bugs_dir) {
                for bug_entry in bug_entries.flatten() {
                    let bug_json = bug_entry.path().join("bug.json");
                    if let Ok(content) = fs::read_to_string(&bug_json)
                        && let Ok(bug) = serde_json::from_str::<serde_json::Value>(&content) {
                            let status = bug
                                .get("status")
                                .and_then(|s| s.as_str())
                                .unwrap_or("?");
                            let title = bug
                                .get("title")
                                .and_then(|t| t.as_str())
                                .unwrap_or("?");
                            let name = bug
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("?");
                            bugs.push(format!(
                                "{{\"name\":{},\"title\":{},\"parent_task\":{},\"status\":{}}}",
                                json_quote(name),
                                json_quote(title),
                                json_quote(&task_name),
                                json_quote(status)
                            ));
                        }
                }
            }
        }
    }

    format!(
        "{{\"status\":\"ok\",\"bugs\":[{}],\"count\":{}}}",
        bugs.join(","),
        bugs.len()
    )
}

/// Resolve a bug sub-task
pub fn bug_resolve(ext_dir: &Path, parent_task: &str, bug_name: &str, note: &str) -> String {
    let bug_dir = ext_dir
        .join("tasks")
        .join(parent_task)
        .join("bugs")
        .join(bug_name);
    let bug_json = bug_dir.join("bug.json");

    if !bug_json.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Bug not found: {} under task {}\"}}}}",
            bug_name, parent_task
        );
    }

    let content = fs::read_to_string(&bug_json).unwrap_or_default();
    let mut bug: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
    if let Some(obj) = bug.as_object_mut() {
        obj.insert("status".to_string(), serde_json::json!("resolved"));
        obj.insert(
            "resolved_at".to_string(),
            serde_json::json!(chrono_now()),
        );
        if !note.is_empty() {
            obj.insert("resolution_note".to_string(), serde_json::json!(note));
        }
    }
    let _ = fs::write(
        &bug_json,
        serde_json::to_string_pretty(&bug).unwrap_or_default(),
    );

    // Update evidence.md with resolution
    let evidence_path = bug_dir.join("evidence.md");
    if let Ok(existing) = fs::read_to_string(&evidence_path) {
        let updated = format!(
            "{}\n\n## Resolution ({})\n\n{}\n",
            existing.trim_end(),
            chrono_now(),
            if note.is_empty() { "Fixed." } else { note }
        );
        let _ = fs::write(&evidence_path, updated);
    }

    format!(
        "{{\"status\":\"ok\",\"resolved\":true,\"bug\":{{\"name\":{},\"parent_task\":{}}},\"next\":\"do\",\"next_instructions\":\"Bug resolved. Continue implementation: run `emb-agent-rs do`.\"}}",
        json_quote(bug_name),
        json_quote(parent_task)
    )
}

fn chrono_now() -> String {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // Simple ISO 8601
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Calculate year/month/day from days since epoch (approximate)
    let mut y = 1970i64;
    let mut remaining_days = days_since_epoch as i64;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        y += 1;
    }
    let month_days = if is_leap(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut m = 1usize;
    for &md in month_days.iter() {
        if remaining_days < md as i64 {
            break;
        }
        remaining_days -= md as i64;
        m += 1;
    }
    let d = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, m, d, hours, minutes, seconds
    )
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}
