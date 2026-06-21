use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

/// Check if adding `new_deps` to `task_name`'s blockedBy would create a cycle.
/// `tasks_dir` is the .emb-agent/tasks/ directory containing task.json files.
pub fn detect_cycle(tasks_dir: &Path, task_name: &str, new_deps: &[String]) -> bool {
    let Ok(edges) = build_dep_graph(tasks_dir, task_name, new_deps) else {
        return true;
    };
    has_cycle(&edges)
}

/// Build an adjacency map: task_name -> [names it depends on].
/// Merges `new_deps` into `task_name`'s edge set for cycle detection.
fn build_dep_graph(
    tasks_dir: &Path,
    task_name: &str,
    new_deps: &[String],
) -> Result<HashMap<String, Vec<String>>, ()> {
    let Ok(entries) = fs::read_dir(tasks_dir) else {
        return Err(());
    };
    let mut edges: HashMap<String, Vec<String>> = HashMap::new();
    for entry in entries.flatten() {
        let path = entry.path().join("task.json");
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(task) = serde_json::from_str::<Value>(&content) else {
            continue;
        };
        let name = task
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let status = task.get("status").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() || status == "deleted" {
            continue;
        }
        let deps: Vec<String> = task
            .get("blockedBy")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        edges.insert(name, deps);
    }

    // Merge new deps for the target task
    edges
        .entry(task_name.to_string())
        .or_default()
        .extend(new_deps.iter().cloned());

    Ok(edges)
}

fn has_cycle(edges: &HashMap<String, Vec<String>>) -> bool {
    let mut visited = HashSet::new();
    let mut visiting = HashSet::new();

    fn dfs(
        node: &str,
        edges: &HashMap<String, Vec<String>>,
        visited: &mut HashSet<String>,
        visiting: &mut HashSet<String>,
    ) -> bool {
        if visiting.contains(node) {
            return true;
        }
        if visited.contains(node) {
            return false;
        }
        visiting.insert(node.to_string());
        for dep in edges.get(node).unwrap_or(&vec![]) {
            if dfs(dep, edges, visited, visiting) {
                return true;
            }
        }
        visiting.remove(node);
        visited.insert(node.to_string());
        false
    }

    for node in edges.keys() {
        if dfs(node, edges, &mut visited, &mut visiting) {
            return true;
        }
    }
    false
}

/// Build inverse adjacency: for each task, list which other tasks block on it.
pub fn derive_blocks(tasks_dir: &Path) -> HashMap<String, Vec<String>> {
    let Ok(entries) = fs::read_dir(tasks_dir) else {
        return HashMap::new();
    };
    let mut blocks: HashMap<String, Vec<String>> = HashMap::new();
    for entry in entries.flatten() {
        let path = entry.path().join("task.json");
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(task) = serde_json::from_str::<Value>(&content) else {
            continue;
        };
        let name = task
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let status = task.get("status").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() || status == "deleted" {
            continue;
        }
        if let Some(deps) = task.get("blockedBy").and_then(Value::as_array) {
            for dep in deps.iter().filter_map(|v| v.as_str()) {
                blocks
                    .entry(dep.to_string())
                    .or_default()
                    .push(name.clone());
            }
        }
    }
    blocks
}

/// Validate blockedBy references in task.json.
/// Returns (blocked_by_names, error_message).
pub fn validate_blocked_by(
    tasks_dir: &Path,
    task_name: &str,
    blocked_by: &[String],
) -> (Vec<String>, Option<String>) {
    let mut valid: Vec<String> = Vec::new();
    for dep_name in blocked_by {
        let dep_path = tasks_dir.join(dep_name).join("task.json");
        let Ok(content) = fs::read_to_string(&dep_path) else {
            return (
                valid,
                Some(format!("blockedBy: task not found: {dep_name}")),
            );
        };
        let Ok(task) = serde_json::from_str::<Value>(&content) else {
            return (valid, Some(format!("blockedBy: invalid task: {dep_name}")));
        };
        let status = task.get("status").and_then(Value::as_str).unwrap_or("");
        if status == "deleted" {
            return (valid, Some(format!("blockedBy: {dep_name} is deleted")));
        }
        if dep_name == task_name {
            return (
                valid,
                Some("blockedBy: cannot depend on itself".to_string()),
            );
        }
        valid.push(dep_name.to_string());
    }

    if detect_cycle(tasks_dir, task_name, &valid) {
        return (valid, Some("blockedBy: would create a cycle".to_string()));
    }

    (valid, None)
}

/// Format blockedBy for JSON output: dependencies + blocks.
pub fn blocked_by_summary(tasks_dir: &Path, task_name: &str) -> String {
    let task_path = tasks_dir.join(task_name).join("task.json");
    let Ok(content) = fs::read_to_string(&task_path) else {
        return "\"depends_on\":[],\"blocks\":[]".to_string();
    };
    let Ok(task) = serde_json::from_str::<Value>(&content) else {
        return "\"depends_on\":[],\"blocks\":[]".to_string();
    };

    let depends_on: Vec<&str> = task
        .get("blockedBy")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    let all_blocks = derive_blocks(tasks_dir);
    let blocks: Vec<String> = all_blocks.get(task_name).cloned().unwrap_or_default();

    format!(
        "\"depends_on\":{},\"blocks\":{}",
        serde_json::to_string(&depends_on).unwrap_or_else(|_| "[]".to_string()),
        serde_json::to_string(&blocks).unwrap_or_else(|_| "[]".to_string())
    )
}
