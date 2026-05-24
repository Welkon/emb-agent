use std::fs;
use std::path::Path;
use crate::json::json_quote;

/// List cached documents from .emb-agent/cache/docs/index.json
pub fn doc_list(ext_dir: &Path) -> String {
    let index_path = ext_dir.join("cache").join("docs").join("index.json");
    if !index_path.exists() {
        return r#"{"status":"ok","documents":[],"count":0}"#.to_string();
    }

    let content = fs::read_to_string(&index_path).unwrap_or_default();
    let docs: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
    let count = docs.get("documents").and_then(|d| d.as_array()).map(|a| a.len()).unwrap_or(0);

    format!(
        "{{\"status\":\"ok\",\"documents\":{},\"count\":{}}}",
        serde_json::to_string(docs.get("documents").unwrap_or(&serde_json::Value::Null)).unwrap_or_default(),
        count
    )
}

/// Knowledge graph status
pub fn knowledge_status(ext_dir: &Path) -> String {
    let graph_path = ext_dir.join("graph").join("graph.json");

    let graph_exists = graph_path.exists();
    let mut nodes = 0;
    let mut edges = 0;
    if graph_exists {
        if let Ok(content) = fs::read_to_string(&graph_path) {
            if let Ok(graph) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(stats) = graph.get("stats") {
                    nodes = stats.get("nodes").and_then(|n| n.as_u64()).unwrap_or(0) as usize;
                    edges = stats.get("edges").and_then(|e| e.as_u64()).unwrap_or(0) as usize;
                }
            }
        }
    }

    format!(
        "{{\"status\":\"ok\",\"graph\":{{\"exists\":{},\"nodes\":{},\"edges\":{},\"path\":{}}}}}",
        graph_exists,
        nodes,
        edges,
        json_quote(&graph_path.to_string_lossy())
    )
}

/// Session info
pub fn session_show(ext_dir: &Path) -> String {
    let session_path = ext_dir.join("state").join("default-session.json");
    let exists = session_path.exists();

    let (last_command, paused_at) = if exists {
        fs::read_to_string(&session_path).ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .map(|session| {
                let lc = session.get("last_command").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let pa = session.get("paused_at").and_then(|v| v.as_str()).unwrap_or("").to_string();
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
    let context_path = ext_dir.join("state").join("default-session.json");
    let exists = context_path.exists();

    let context_summary: String = if exists {
        fs::read_to_string(&context_path).ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .and_then(|session| session.get("context_summary").and_then(|v| v.as_str()).map(String::from))
            .unwrap_or_default()
    } else {
        String::new()
    };

    format!(
        "{{\"status\":\"ok\",\"context\":{{\"exists\":{},\"summary\":{}}}}}",
        exists,
        json_quote(&context_summary)
    )
}
