use crate::json::json_quote;
use std::fs;
use std::path::Path;

/// Create a bug in flat .emb-agent/bugs/ directory
pub fn bug_add(ext_dir: &Path, parent_task: &str, summary: &str) -> String {
    let bugs_dir = ext_dir.join("bugs");
    let _ = fs::create_dir_all(&bugs_dir);

    // Generate bug ID from summary
    let id = summary
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
    let id = format!("bug-{}", id.chars().take(50).collect::<String>());
    if id == "bug-" {
        return "{\"status\":\"error\",\"error\":{\"code\":\"bad-name\",\"message\":\"Bug summary must contain at least one alphanumeric character\"}}".to_string();
    }

    // Deduplicate: append number if exists
    let mut final_id = id.clone();
    let mut counter = 1;
    while bugs_dir.join(format!("{}.json", final_id)).exists() {
        final_id = format!("{}-{}", id, counter);
        counter += 1;
    }

    // Detect current variant and hardware version
    let variant = crate::variant_ops::active_variant_name(ext_dir).unwrap_or_default();
    let hw = detect_hw(ext_dir);

    // Write bug JSON
    let now = chrono_now();
    let bug_json = format!(
        "{{\n  \"id\": {},\n  \"title\": {},\n  \"parent_task\": {},\n  \"variant\": {},\n  \"hw\": {},\n  \"type\": \"bug\",\n  \"status\": \"open\",\n  \"priority\": \"P1\",\n  \"found_at\": {},\n  \"resolved_at\": null,\n  \"resolution_note\": null\n}}",
        json_quote(&final_id),
        json_quote(summary),
        json_quote(parent_task),
        json_quote(&variant),
        json_quote(&hw),
        json_quote(&now)
    );
    let _ = fs::write(bugs_dir.join(format!("{}.json", final_id)), &bug_json);

    format!(
        "{{\"status\":\"ok\",\"created\":true,\"bug\":{{\"id\":{},\"title\":{},\"parent_task\":{},\"variant\":{},\"hw\":{},\"status\":\"open\"}},\"next\":\"do\",\"next_instructions\":{}}}",
        json_quote(&final_id),
        json_quote(summary),
        json_quote(parent_task),
        json_quote(&variant),
        json_quote(&hw),
        json_quote(&format!(
            "Bug recorded. Fix the code, then trigger `/emb:task bug resolve {} 'fix note'` after evidence exists.",
            final_id
        ))
    )
}

/// List bugs, optionally filtered by task or status
pub fn bug_list(
    ext_dir: &Path,
    parent_task: Option<&str>,
    status_filter: Option<&str>,
    variant_filter: Option<&str>,
) -> String {
    let bugs_dir = ext_dir.join("bugs");
    let mut bugs = Vec::new();

    if let Ok(entries) = fs::read_dir(&bugs_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path)
                && let Ok(bug) = serde_json::from_str::<serde_json::Value>(&content)
            {
                let status = bug.get("status").and_then(|s| s.as_str()).unwrap_or("?");
                let pt = bug
                    .get("parent_task")
                    .and_then(|t| t.as_str())
                    .unwrap_or("?");
                let variant = bug.get("variant").and_then(|v| v.as_str()).unwrap_or("");

                // Filter
                if let Some(filter) = parent_task
                    && pt != filter
                {
                    continue;
                }
                if let Some(filter) = status_filter
                    && status != filter
                {
                    continue;
                }
                if let Some(filter) = variant_filter
                    && variant != filter
                {
                    continue;
                }

                let id = bug.get("id").and_then(|i| i.as_str()).unwrap_or("?");
                let title = bug.get("title").and_then(|t| t.as_str()).unwrap_or("?");
                let hw = bug.get("hw").and_then(|h| h.as_str()).unwrap_or("");
                let found = bug.get("found_at").and_then(|f| f.as_str()).unwrap_or("");

                bugs.push(format!(
                        "{{\"id\":{},\"title\":{},\"parent_task\":{},\"variant\":{},\"hw\":{},\"status\":{},\"found_at\":{}}}",
                        json_quote(id),
                        json_quote(title),
                        json_quote(pt),
                        json_quote(variant),
                        json_quote(hw),
                        json_quote(status),
                        json_quote(found)
                    ));
            }
        }
    }

    bugs.sort_by_key(|b| {
        if b.contains("\"open\"") {
            "0".to_string()
        } else {
            "1".to_string()
        }
    });

    format!(
        "{{\"status\":\"ok\",\"bugs\":[{}],\"count\":{}}}",
        bugs.join(","),
        bugs.len()
    )
}

/// Resolve a bug
pub fn bug_resolve(ext_dir: &Path, bug_id: &str, note: &str) -> String {
    let bug_path = ext_dir.join("bugs").join(format!("{}.json", bug_id));

    if !bug_path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Bug not found: {}\"}}}}",
            bug_id
        );
    }

    let content = fs::read_to_string(&bug_path).unwrap_or_default();
    let mut bug: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
    let now = chrono_now();
    if let Some(obj) = bug.as_object_mut() {
        obj.insert("status".to_string(), serde_json::json!("resolved"));
        obj.insert("resolved_at".to_string(), serde_json::json!(&now));
        if !note.is_empty() {
            obj.insert("resolution_note".to_string(), serde_json::json!(note));
        }
    }
    let _ = fs::write(
        &bug_path,
        serde_json::to_string_pretty(&bug).unwrap_or_default(),
    );

    let pt = bug
        .get("parent_task")
        .and_then(|t| t.as_str())
        .unwrap_or("?");

    format!(
        "{{\"status\":\"ok\",\"resolved\":true,\"bug\":{{\"id\":{},\"parent_task\":{},\"resolved_at\":{}}},\"next\":\"do\",\"next_instructions\":\"Bug resolved. Continue implementation by triggering `/emb:do`.\"}}",
        json_quote(bug_id),
        json_quote(pt),
        json_quote(&now)
    )
}

fn detect_hw(ext_dir: &Path) -> String {
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let hw_yaml = fs::read_to_string(state_dir.join("hw.yaml")).unwrap_or_default();
    let hw = crate::hardware::project::HardwareTruth::from_yaml(&hw_yaml);
    if hw.model.is_empty() {
        return "unknown".to_string();
    }
    if hw.package.is_empty() {
        return hw.model;
    }
    format!("{} {}", hw.model, hw.package)
}

fn chrono_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
