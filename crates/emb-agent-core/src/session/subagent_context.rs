use crate::hardware::project::{
    ProjectSnapshot, TaskRef, read_current_task_ref_for_session, snapshot_from_cwd,
};
use crate::json::json_quote;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_ARTIFACT_CHARS: usize = 12_000;
const MAX_TOTAL_ARTIFACT_CHARS: usize = 70_000;
const MAX_DIRECTORY_FILES: usize = 20;

#[derive(Debug, Clone)]
struct ContextArtifact {
    path: String,
    reason: String,
    content: String,
}

pub fn build_subagent_context_output_for_host(raw_input: &str, host: &str) -> String {
    let data: Value = serde_json::from_str(raw_input.trim()).unwrap_or(Value::Null);
    if let Some(tool_name) = string_member(&data, "tool_name")
        .or_else(|| string_member(&data, "toolName"))
        .or_else(|| string_member(&data, "name"))
        && !is_subagent_tool(&tool_name)
    {
        return String::new();
    }

    let cwd = payload_cwd(&data);
    let host = payload_host(&data, host);
    let snapshot = snapshot_from_cwd(&cwd);
    if !snapshot.initialized || snapshot.project_root.trim().is_empty() {
        return String::new();
    }

    let message = build_subagent_context_message(&snapshot, &data, &host, &cwd);
    if message.trim().is_empty() {
        return String::new();
    }

    let event_name = string_member(&data, "hook_event_name")
        .or_else(|| string_member(&data, "hookEventName"))
        .or_else(|| string_member(&data, "event"))
        .unwrap_or_else(|| "PreToolUse".to_string());
    build_additional_context_payload(&host, &event_name, &message)
}

pub fn build_shell_session_context_output_for_host(raw_input: &str, host: &str) -> String {
    let data: Value = serde_json::from_str(raw_input.trim()).unwrap_or(Value::Null);
    let host = payload_host(&data, host);
    if host.eq_ignore_ascii_case("cursor") {
        "{\"permission\":\"allow\"}".to_string()
    } else {
        String::new()
    }
}

fn build_subagent_context_message(
    snapshot: &ProjectSnapshot,
    data: &Value,
    host: &str,
    cwd: &str,
) -> String {
    let project_root = Path::new(&snapshot.project_root);
    let ext_dir = project_root.join(".emb-agent");
    let role = requested_role(data);
    let task_ref = read_current_task_ref_for_session(&ext_dir, Path::new(cwd), host)
        .or_else(|| fallback_task_ref(snapshot, project_root));

    let mut lines = vec![
        "<emb-agent-subagent-context>".to_string(),
        "This context was injected before spawning a host subagent. Use it silently; do not repeat it to the user.".to_string(),
        format!("Host: {host}"),
        format!("Requested role: {role}"),
        format!("Project root: {}", snapshot.project_root),
        format!("Workflow state: {}", snapshot.workflow_state),
        format!("Recommended next command: {}", snapshot.recommended_command),
        format!("Reason: {}", snapshot.recommended_reason),
    ];

    if let Some(task) = &task_ref {
        lines.push(format!(
            "Active task: [{}] {} ({})",
            task.priority, task.title, task.status
        ));
        if !task.name.trim().is_empty() {
            lines.push(format!("Task id: {}", task.name));
        }
        if !task.path.trim().is_empty() {
            lines.push(format!(
                "Task file: {}",
                relative_path(project_root, Path::new(&task.path))
            ));
        }
    } else {
        lines.push("Active task: none".to_string());
        lines.push("No active emb-agent task is selected. Keep this subagent read-only unless the parent session provides a narrower explicit scope.".to_string());
    }

    lines.extend([
        "Subagent rules:".to_string(),
        "- You are already a delegated subagent; do not spawn additional subagents.".to_string(),
        "- Stay inside the active task scope and included artifacts unless the parent prompt narrows or expands it explicitly.".to_string(),
        "- Do not ask the user to run emb-agent commands; report findings or edits back to the parent session.".to_string(),
        "- Do not guess hardware facts. Treat .emb-agent/hw.yaml and .emb-agent/req.yaml as required truth when present.".to_string(),
        "- Raw schematic/board files must go through emb-agent ingest outputs before inspection.".to_string(),
    ]);

    if let Some(block) = compact_workflow_breadcrumb(snapshot) {
        lines.push(String::new());
        lines.push("<workflow-breadcrumb>".to_string());
        lines.push(block);
        lines.push("</workflow-breadcrumb>".to_string());
    }

    let artifacts = task_ref
        .as_ref()
        .map(|task| collect_artifacts(project_root, task, &role))
        .unwrap_or_else(|| collect_project_truth_artifacts(project_root));

    if !artifacts.is_empty() {
        lines.push(String::new());
        lines.push("<artifacts>".to_string());
        for artifact in artifacts {
            lines.push(format!(
                "<artifact path=\"{}\" reason=\"{}\">",
                xml_attr(&artifact.path),
                xml_attr(&artifact.reason)
            ));
            lines.push(artifact.content);
            lines.push("</artifact>".to_string());
        }
        lines.push("</artifacts>".to_string());
    }

    lines.push("</emb-agent-subagent-context>".to_string());
    lines.join("\n")
}

fn fallback_task_ref(snapshot: &ProjectSnapshot, project_root: &Path) -> Option<TaskRef> {
    let task = snapshot.current_task.as_ref()?;
    let path = project_root
        .join(".emb-agent")
        .join("tasks")
        .join(&task.name)
        .join("task.json");
    Some(TaskRef {
        name: task.name.clone(),
        title: task.title.clone(),
        status: task.status.clone(),
        priority: task.priority.clone(),
        package: task.package.clone(),
        path: path.to_string_lossy().to_string(),
    })
}

fn collect_project_truth_artifacts(project_root: &Path) -> Vec<ContextArtifact> {
    let mut collector = ArtifactCollector::new(project_root);
    collector.add_file(".emb-agent/hw.yaml", "hardware truth");
    collector.add_file(".emb-agent/req.yaml", "requirements truth");
    collector.add_file(".emb-agent/workflow.md", "workflow state source");
    collector.finish()
}

fn collect_artifacts(project_root: &Path, task: &TaskRef, role: &str) -> Vec<ContextArtifact> {
    let mut collector = ArtifactCollector::new(project_root);
    collector.add_file(".emb-agent/hw.yaml", "hardware truth");
    collector.add_file(".emb-agent/req.yaml", "requirements truth");

    let task_path = PathBuf::from(&task.path);
    let task_rel = relative_path(project_root, &task_path);
    collector.add_path(&task_path, &task_rel, "active task record");

    if let Ok(task_json) = fs::read_to_string(&task_path)
        && let Ok(value) = serde_json::from_str::<Value>(&task_json)
    {
        for prd_path in task_prd_paths(&value, &task.name) {
            collector.add_file(&prd_path, "task PRD");
        }
    }

    let task_dir = task_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| {
            project_root
                .join(".emb-agent")
                .join("tasks")
                .join(&task.name)
        });
    let task_dir_rel = relative_path(project_root, &task_dir);

    for file in [
        "design.md",
        "implement.md",
        "auto-specs.md",
        "code-writing-specs.md",
        "review.md",
        "verification.md",
        "aar.md",
    ] {
        let path = task_dir.join(file);
        let rel = join_rel(&task_dir_rel, file);
        collector.add_path(&path, &rel, "task-local artifact");
    }
    collector.add_directory_markdown(
        &task_dir.join("research"),
        &join_rel(&task_dir_rel, "research"),
        "task-local research",
    );

    let manifest = match role {
        "check" => "check.jsonl",
        "debug" => "debug.jsonl",
        _ => "implement.jsonl",
    };
    collector.add_jsonl_manifest(
        &task_dir.join(manifest),
        &join_rel(&task_dir_rel, manifest),
        role,
    );
    if role == "check" {
        collector.add_jsonl_manifest(
            &task_dir.join("implement.jsonl"),
            &join_rel(&task_dir_rel, "implement.jsonl"),
            "implementation context",
        );
    }

    collector.finish()
}

fn task_prd_paths(value: &Value, task_name: &str) -> Vec<String> {
    let mut out = Vec::new();
    for path in [
        value
            .get("artifacts")
            .and_then(|artifacts| artifacts.get("prd"))
            .and_then(Value::as_str),
        value.get("prd").and_then(Value::as_str),
        value.get("prd_path").and_then(Value::as_str),
    ]
    .into_iter()
    .flatten()
    {
        push_unique(&mut out, path);
    }
    push_unique(&mut out, &format!("docs/prd/tasks/{task_name}.md"));
    out
}

struct ArtifactCollector<'a> {
    project_root: &'a Path,
    seen: HashSet<String>,
    artifacts: Vec<ContextArtifact>,
    total_chars: usize,
}

impl<'a> ArtifactCollector<'a> {
    fn new(project_root: &'a Path) -> Self {
        Self {
            project_root,
            seen: HashSet::new(),
            artifacts: Vec::new(),
            total_chars: 0,
        }
    }

    fn add_file(&mut self, rel: &str, reason: &str) {
        let path = self.project_root.join(rel);
        self.add_path(&path, rel, reason);
    }

    fn add_path(&mut self, path: &Path, display_path: &str, reason: &str) {
        if self.total_chars >= MAX_TOTAL_ARTIFACT_CHARS || self.seen.contains(display_path) {
            return;
        }
        let Ok(meta) = fs::metadata(path) else {
            return;
        };
        if !meta.is_file() || meta.len() > 512 * 1024 {
            return;
        }
        let Ok(raw) = fs::read_to_string(path) else {
            return;
        };
        let content = compact_artifact(&raw, MAX_ARTIFACT_CHARS);
        if content.trim().is_empty() {
            return;
        }
        let remaining = MAX_TOTAL_ARTIFACT_CHARS.saturating_sub(self.total_chars);
        if remaining == 0 {
            return;
        }
        let content = compact_artifact(&content, remaining.min(MAX_ARTIFACT_CHARS));
        self.total_chars += content.chars().count();
        self.seen.insert(display_path.to_string());
        self.artifacts.push(ContextArtifact {
            path: display_path.to_string(),
            reason: reason.to_string(),
            content,
        });
    }

    fn add_directory_markdown(&mut self, dir: &Path, display_dir: &str, reason: &str) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        let mut files = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file()
                    && path
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .map(|ext| ext.eq_ignore_ascii_case("md"))
                        .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        files.sort();
        for path in files.into_iter().take(MAX_DIRECTORY_FILES) {
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            self.add_path(&path, &join_rel(display_dir, name), reason);
        }
    }

    fn add_jsonl_manifest(&mut self, path: &Path, display_path: &str, role: &str) {
        let Ok(raw) = fs::read_to_string(path) else {
            return;
        };
        for line in raw.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let file = value
                .get("file")
                .or_else(|| value.get("path"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty());
            let Some(file) = file else {
                continue;
            };
            let reason = value
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or(role)
                .trim();
            if value
                .get("type")
                .and_then(Value::as_str)
                .map(|kind| kind.eq_ignore_ascii_case("directory"))
                .unwrap_or(false)
                || file.ends_with('/')
            {
                self.add_directory_markdown(
                    &self.project_root.join(file),
                    file.trim_end_matches('/'),
                    reason,
                );
            } else {
                self.add_file(file, reason);
            }
        }
        self.add_path(path, display_path, "role context manifest");
    }

    fn finish(self) -> Vec<ContextArtifact> {
        self.artifacts
    }
}

fn compact_workflow_breadcrumb(snapshot: &ProjectSnapshot) -> Option<String> {
    let mut lines = vec![
        format!("Workflow state: {}", snapshot.workflow_state),
        format!("Recommended next command: {}", snapshot.recommended_command),
        format!("Open tasks: {}", snapshot.open_tasks),
    ];
    if let Some(task) = &snapshot.current_task {
        lines.push(format!(
            "Active task: [{}] {} ({})",
            task.priority, task.title, task.status
        ));
    }
    if !snapshot.developer.trim().is_empty() {
        lines.push(format!("Developer: {}", snapshot.developer));
    }
    if snapshot.power_management_risk {
        lines.push("Embedded power-risk: keep watchdog, sleep/wake, config-bit truth, and idle-current acceptance visible.".to_string());
    }
    let joined = lines.join("\n");
    if joined.trim().is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn requested_role(data: &Value) -> String {
    let mut haystack = String::new();
    collect_strings(
        data.get("tool_input").or_else(|| data.get("toolInput")),
        &mut haystack,
    );
    collect_strings(data.get("input"), &mut haystack);
    collect_strings(data.get("agent"), &mut haystack);
    let haystack = haystack.to_ascii_lowercase();
    if contains_any(
        &haystack,
        &[
            "release-checker",
            "sys-reviewer",
            "arch-reviewer",
            "review",
            "check",
        ],
    ) {
        "check".to_string()
    } else if contains_any(&haystack, &["bug-hunter", "debug", "repro", "failure"]) {
        "debug".to_string()
    } else if contains_any(
        &haystack,
        &["researcher", "hw-scout", "scout", "research", "evidence"],
    ) {
        "research".to_string()
    } else {
        "implement".to_string()
    }
}

fn collect_strings(value: Option<&Value>, out: &mut String) {
    match value {
        Some(Value::String(text)) => {
            out.push(' ');
            out.push_str(text);
        }
        Some(Value::Array(items)) => {
            for item in items {
                collect_strings(Some(item), out);
            }
        }
        Some(Value::Object(map)) => {
            for value in map.values() {
                collect_strings(Some(value), out);
            }
        }
        _ => {}
    }
}

fn is_subagent_tool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "task" | "agent" | "subagent" | "sub-agent"
    )
}

fn payload_cwd(data: &Value) -> String {
    string_member(data, "cwd")
        .or_else(|| string_at(data, &["workspace", "cwd"]))
        .or_else(|| string_at(data, &["session", "cwd"]))
        .unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .to_string_lossy()
                .to_string()
        })
}

fn payload_host(data: &Value, fallback: &str) -> String {
    string_member(data, "host")
        .map(|host| host.trim().to_string())
        .filter(|host| !host.is_empty())
        .unwrap_or_else(|| {
            if fallback.trim().is_empty() {
                "external".to_string()
            } else {
                fallback.trim().to_string()
            }
        })
}

fn build_additional_context_payload(host: &str, event_name: &str, message: &str) -> String {
    if host.eq_ignore_ascii_case("cursor") {
        return format!("{{\"additional_context\":{}}}", json_quote(message));
    }

    format!(
        "{{\"hookSpecificOutput\":{{\"hookEventName\":{},\"additionalContext\":{}}}}}",
        json_quote(event_name),
        json_quote(message)
    )
}

fn string_member(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
}

fn relative_path(project_root: &Path, path: &Path) -> String {
    path.strip_prefix(project_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn join_rel(base: &str, child: &str) -> String {
    if base.trim().is_empty() {
        child.to_string()
    } else {
        format!(
            "{}/{}",
            base.trim_end_matches('/'),
            child.trim_start_matches('/')
        )
    }
}

fn compact_artifact(raw: &str, max_chars: usize) -> String {
    if raw.chars().count() <= max_chars {
        return raw.trim().to_string();
    }
    let mut out = raw
        .chars()
        .take(max_chars.saturating_sub(80))
        .collect::<String>();
    out.push_str("\n\n[... artifact truncated by emb-agent hook ...]");
    out
}

fn contains_any(value: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| value.contains(needle))
}

fn push_unique(out: &mut Vec<String>, value: &str) {
    let value = value.trim();
    if !value.is_empty() && !out.iter().any(|item| item == value) {
        out.push(value.to_string());
    }
}

fn xml_attr(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
