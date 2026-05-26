use crate::json::{json_quote, json_string_field};
use std::fs;
use std::path::Path;

/// Bootstrap status
pub fn bootstrap_status(ext_dir: &Path) -> String {
    let hw_path = ext_dir.join("hw.yaml");
    let req_path = ext_dir.join("req.yaml");
    let project_path = ext_dir.join("project.json");

    let has_hw = hw_path.exists();
    let has_req = req_path.exists();
    let initialized = project_path.exists();

    let mcu = if has_hw {
        let content = fs::read_to_string(&hw_path).unwrap_or_default();
        json_string_field(&content, "model")
    } else {
        String::new()
    };

    let needs = if !initialized {
        "init"
    } else if !has_hw {
        "declare-hardware"
    } else if !has_req {
        "declare-requirements"
    } else {
        "ready"
    };

    format!(
        "{{\"status\":\"ok\",\"bootstrap\":{{\"initialized\":{},\"has_hw\":{},\"has_req\":{},\"mcu\":{},\"needs\":{}}}}}",
        initialized,
        has_hw,
        has_req,
        json_quote(&mcu),
        json_quote(needs)
    )
}

/// Declare hardware (simple write to hw.yaml)
pub fn declare_hardware(ext_dir: &Path, mcu: &str, package: &str) -> String {
    let hw_path = ext_dir.join("hw.yaml");
    let existing = if hw_path.exists() {
        fs::read_to_string(&hw_path).unwrap_or_default()
    } else {
        String::new()
    };

    let mut new_yaml = String::new();
    let mut found_model = false;
    let mut found_package = false;

    for line in existing.lines() {
        if line.starts_with("model:") && !mcu.is_empty() {
            new_yaml.push_str(&format!("model: \"{}\"\n", mcu));
            found_model = true;
        } else if line.starts_with("package:") && !package.is_empty() {
            new_yaml.push_str(&format!("package: \"{}\"\n", package));
            found_package = true;
        } else {
            new_yaml.push_str(line);
            new_yaml.push('\n');
        }
    }

    if !found_model && !mcu.is_empty() {
        new_yaml.push_str(&format!("model: \"{}\"\n", mcu));
    }
    if !found_package && !package.is_empty() {
        new_yaml.push_str(&format!("package: \"{}\"\n", package));
    }

    let _ = fs::create_dir_all(ext_dir);
    let _ = fs::write(&hw_path, new_yaml);

    format!(
        "{{\"status\":\"ok\",\"declared\":true,\"mcu\":{},\"package\":{}}}",
        json_quote(mcu),
        json_quote(package)
    )
}

/// Pause session
pub fn pause_session(ext_dir: &Path, note: &str) -> String {
    let state_dir = ext_dir.join("state");
    let _ = fs::create_dir_all(&state_dir);
    let session_path = state_dir.join("default-session.json");

    let mut session: serde_json::Value = if session_path.exists() {
        let content = fs::read_to_string(&session_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };

    if let Some(obj) = session.as_object_mut() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_string();
        obj.insert(
            "last_command".to_string(),
            serde_json::Value::String("pause".to_string()),
        );
        obj.insert("paused_at".to_string(), serde_json::Value::String(now));
        if !note.is_empty() {
            obj.insert(
                "pause_note".to_string(),
                serde_json::Value::String(note.to_string()),
            );
        }
    }

    let _ = fs::write(
        &session_path,
        serde_json::to_string_pretty(&session).unwrap_or_default(),
    );

    "{\"status\":\"ok\",\"paused\":true}".to_string()
}

/// Resume session
pub fn resume_session(ext_dir: &Path) -> String {
    let session_path = ext_dir.join("state").join("default-session.json");
    if !session_path.exists() {
        return r#"{"status":"ok","resumed":true}"#.to_string();
    }

    let content = fs::read_to_string(&session_path).unwrap_or_default();
    let mut session: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
    if let Some(obj) = session.as_object_mut() {
        obj.insert(
            "last_command".to_string(),
            serde_json::Value::String("resume".to_string()),
        );
        obj.insert("paused_at".to_string(), serde_json::Value::Null);
    }
    let _ = fs::write(
        &session_path,
        serde_json::to_string_pretty(&session).unwrap_or_default(),
    );

    r#"{"status":"ok","resumed":true}"#.to_string()
}

/// List cached documents
pub fn doc_list(ext_dir: &Path) -> String {
    let index_path = ext_dir.join("cache").join("docs").join("index.json");
    if !index_path.exists() {
        return r#"{"status":"ok","documents":[],"count":0}"#.to_string();
    }
    let content = fs::read_to_string(&index_path).unwrap_or_default();
    let docs: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
    let count = docs
        .get("documents")
        .and_then(|d| d.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    format!(
        "{{\"status\":\"ok\",\"documents\":{},\"count\":{}}}",
        serde_json::to_string(docs.get("documents").unwrap_or(&serde_json::Value::Null))
            .unwrap_or_default(),
        count
    )
}

/// Knowledge graph status
pub fn knowledge_status(ext_dir: &Path) -> String {
    let graph_path = ext_dir.join("graph").join("graph.json");
    let graph_exists = graph_path.exists();
    let mut nodes = 0;
    let mut edges = 0;
    if graph_exists
        && let Ok(content) = fs::read_to_string(&graph_path)
        && let Ok(graph) = serde_json::from_str::<serde_json::Value>(&content)
        && let Some(stats) = graph.get("stats")
    {
        nodes = stats.get("nodes").and_then(|n| n.as_u64()).unwrap_or(0) as usize;
        edges = stats.get("edges").and_then(|e| e.as_u64()).unwrap_or(0) as usize;
    }
    format!(
        "{{\"status\":\"ok\",\"graph\":{{\"exists\":{},\"nodes\":{},\"edges\":{}}}}}",
        graph_exists, nodes, edges
    )
}

/// Session info
pub fn session_show(ext_dir: &Path) -> String {
    let session_path = ext_dir.join("state").join("default-session.json");
    let exists = session_path.exists();
    let (last_command, paused_at) = if exists {
        fs::read_to_string(&session_path)
            .ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .map(|s| {
                let lc = s
                    .get("last_command")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let pa = s
                    .get("paused_at")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                (lc, pa)
            })
            .unwrap_or_default()
    } else {
        (String::new(), String::new())
    };
    format!(
        "{{\"status\":\"ok\",\"session\":{{\"exists\":{},\"last_command\":{},\"paused_at\":{}}}}}",
        exists,
        json_quote(&last_command),
        json_quote(&paused_at)
    )
}

/// Context summary
pub fn context_show(ext_dir: &Path) -> String {
    let ctx_path = ext_dir.join("state").join("default-session.json");
    let exists = ctx_path.exists();
    let summary: String = if exists {
        fs::read_to_string(&ctx_path)
            .ok()
            .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
            .and_then(|s| {
                s.get("context_summary")
                    .and_then(|v| v.as_str())
                    .map(String::from)
            })
            .unwrap_or_default()
    } else {
        String::new()
    };
    format!(
        "{{\"status\":\"ok\",\"context\":{{\"exists\":{},\"summary\":{}}}}}",
        exists,
        json_quote(&summary)
    )
}

pub fn config_show(ext_dir: &Path) -> String {
    let config_path = ext_dir.join("project.json");
    match std::fs::read_to_string(&config_path) {
        Ok(content) => serde_json::to_string_pretty(&serde_json::json!({
            "status": "ok",
            "config": serde_json::from_str::<serde_json::Value>(&content).unwrap_or_default()
        }))
        .unwrap_or_default(),
        Err(_) => r#"{"status":"error","message":"project.json not found"}"#.to_string(),
    }
}
