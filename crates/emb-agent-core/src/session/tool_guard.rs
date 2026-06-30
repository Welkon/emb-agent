use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::hardware::project::{TaskRef, find_project_root, read_current_task_ref_for_session};

const KNOWLEDGE_PRIMING_TTL_MS: u128 = 10 * 60 * 1000;
const SUBAGENT_CONTEXT_MARKER: &str = "<!-- emb-agent-hook-injected -->";

pub fn build_tool_guard_output_for_host(raw_input: &str, host: &str) -> String {
    let data: Value = serde_json::from_str(raw_input.trim()).unwrap_or_else(|_| json!({}));
    build_tool_guard_output_from_value_for_host(&data, host)
}

pub fn build_tool_guard_output_from_value_for_host(data: &Value, host: &str) -> String {
    if !is_workspace_trusted(data) {
        return String::new();
    }

    let project_root = project_root_from_payload(data);
    let tool = tool_name(data);
    let command = command_from_payload(data);

    if let Some(output) = build_subagent_context_output(&project_root, data, &tool, host) {
        return output;
    }

    if is_knowledge_search_tool_call(&tool, data, command.as_deref()) {
        record_knowledge_priming(&project_root, host, &tool, command.as_deref(), data);
        return String::new();
    }

    let paths = collect_path_like_strings(data);

    if should_block_raw_schematic(&tool, command.as_deref(), data, &paths) {
        return block_payload(if is_shell_tool(&tool) {
            "Do not inspect raw schematic files with shell tools. Use `ingest schematic --file <path>` or the host `ingest_doc` tool with `kind=schematic`, then inspect cached parsed JSON/advice/preview artifacts."
        } else {
            "Do not read raw schematic files directly. Use `ingest schematic --file <path>` or the host `ingest_doc` tool with `kind=schematic`, then inspect cached parsed JSON/advice/preview artifacts."
        });
    }

    if command
        .as_deref()
        .map(is_unbounded_filesystem_search)
        .unwrap_or(false)
    {
        return block_payload(
            "Do not search from filesystem root (`/`). Bound searches to the project, workspace, or a known toolchain directory, and use `rg --files`/`find <root> -maxdepth ...` with a narrow root.",
        );
    }

    if !has_fresh_knowledge_priming(&project_root)
        && should_block_source_inspection(&tool, command.as_deref(), &paths)
    {
        return block_payload(
            "Before reading firmware/source files, run `knowledge search --query \"<task/context>\" --rerank` or the host `knowledge_search` tool first. If the knowledge tool is unavailable, fails, or returns no useful evidence, state that fallback condition and then use bounded reads/searches on the narrowest relevant paths.",
        );
    }

    String::new()
}

fn block_payload(reason: &str) -> String {
    json!({
        "decision": "block",
        "reason": reason,
    })
    .to_string()
}

#[derive(Debug, Clone)]
struct SubagentCall {
    agent: String,
    prompt: String,
    tool_input: Value,
}

fn build_subagent_context_output(
    project_root: &Path,
    data: &Value,
    tool: &str,
    host: &str,
) -> Option<String> {
    let call = parse_subagent_call(data, tool)?;
    let agent = normalize_subagent_name(&call.agent);
    if !is_emb_subagent(&agent) || call.prompt.contains(SUBAGENT_CONTEXT_MARKER) {
        return None;
    }

    let current_task =
        read_current_task_ref_for_session(&project_root.join(".emb-agent"), project_root, host);
    let context = build_subagent_context(project_root, current_task.as_ref(), &agent);
    if context.trim().is_empty() {
        return None;
    }

    let injected_prompt =
        build_subagent_prompt(&agent, current_task.as_ref(), &context, &call.prompt);
    let updated_input = with_updated_prompt(call.tool_input, &injected_prompt);
    Some(subagent_context_payload(&updated_input))
}

fn parse_subagent_call(data: &Value, tool: &str) -> Option<SubagentCall> {
    let tool_input = tool_input_object(data);
    let normalized_tool = normalize_tool_name(tool);
    let mut agent = String::new();

    if matches!(
        normalized_tool.as_str(),
        "task" | "agent" | "subagent" | "sub_agent"
    ) || normalized_tool.ends_with("__task")
        || normalized_tool.ends_with("__agent")
    {
        agent = extract_subagent_type(&tool_input);
    } else if is_emb_subagent(&normalize_subagent_name(tool)) {
        agent = tool.to_string();
    }

    if agent.is_empty() {
        agent = string_path(data, &["agent_name"])
            .or_else(|| string_path(data, &["agentName"]))
            .unwrap_or_default();
    }
    if agent.is_empty() {
        return None;
    }

    let prompt = string_path(&tool_input, &["prompt"])
        .or_else(|| string_path(&tool_input, &["instructions"]))
        .or_else(|| string_path(data, &["prompt"]))
        .or_else(|| string_path(data, &["toolArgs"]))
        .unwrap_or_default();
    if prompt.trim().is_empty() {
        return None;
    }

    Some(SubagentCall {
        agent,
        prompt,
        tool_input,
    })
}

fn tool_input_object(data: &Value) -> Value {
    for key in [
        "tool_input",
        "toolInput",
        "input",
        "arguments",
        "args",
        "params",
    ] {
        if let Some(value) = data.get(key) {
            return value.clone();
        }
    }
    Value::Object(serde_json::Map::new())
}

fn extract_subagent_type(tool_input: &Value) -> String {
    for key in [
        "subagent_type",
        "subagentType",
        "subagent_type_name",
        "subagentTypeName",
        "agent_type",
        "agentType",
        "name",
    ] {
        if let Some(value) = tool_input.get(key) {
            let name = extract_subagent_name(value);
            if !name.is_empty() {
                return name;
            }
        }
    }
    String::new()
}

fn extract_subagent_name(value: &Value) -> String {
    if let Some(value) = value.as_str() {
        return value.trim().to_string();
    }
    let Some(map) = value.as_object() else {
        return String::new();
    };

    for key in ["name", "subagent_type_name", "subagentTypeName"] {
        if let Some(value) = map.get(key).and_then(Value::as_str) {
            let value = value.trim();
            if !value.is_empty() {
                return value.to_string();
            }
        }
    }

    if let Some(custom) = map.get("custom").and_then(Value::as_object)
        && let Some(name) = custom.get("name").and_then(Value::as_str)
        && !name.trim().is_empty()
    {
        return name.trim().to_string();
    }

    if let Some(oneof) = map.get("type").and_then(Value::as_object) {
        if oneof.get("case").and_then(Value::as_str) == Some("custom")
            && let Some(nested) = oneof.get("value").and_then(Value::as_object)
            && let Some(name) = nested.get("name").and_then(Value::as_str)
            && !name.trim().is_empty()
        {
            return name.trim().to_string();
        }
        if let Some(case_name) = oneof.get("case").and_then(Value::as_str)
            && !case_name.trim().is_empty()
        {
            return case_name.trim().to_string();
        }
    }

    if map.get("case").and_then(Value::as_str) == Some("custom")
        && let Some(nested) = map.get("value").and_then(Value::as_object)
        && let Some(name) = nested.get("name").and_then(Value::as_str)
        && !name.trim().is_empty()
    {
        return name.trim().to_string();
    }

    map.get("case")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn normalize_subagent_name(value: &str) -> String {
    let value = value
        .trim()
        .rsplit(['/', ':'])
        .next()
        .unwrap_or(value.trim())
        .replace('_', "-")
        .to_ascii_lowercase();
    value
        .strip_prefix("emb-agent-")
        .unwrap_or(&value)
        .to_string()
}

fn is_emb_subagent(agent: &str) -> bool {
    matches!(
        agent,
        "fw-doer"
            | "release-checker"
            | "sys-reviewer"
            | "arch-reviewer"
            | "bug-hunter"
            | "hw-scout"
            | "researcher"
            | "onboard"
    )
}

fn build_subagent_context(project_root: &Path, task: Option<&TaskRef>, agent: &str) -> String {
    let mut parts = Vec::new();
    push_file_context(
        project_root,
        &mut parts,
        ".emb-agent/workflow.md",
        "Workflow and layout",
    );
    push_file_context(
        project_root,
        &mut parts,
        ".emb-agent/attention.md",
        "Current project attention",
    );
    push_file_context(
        project_root,
        &mut parts,
        ".emb-agent/hw.yaml",
        "Hardware truth",
    );
    push_file_context(
        project_root,
        &mut parts,
        ".emb-agent/req.yaml",
        "Requirement truth",
    );

    if matches!(
        agent,
        "fw-doer" | "release-checker" | "sys-reviewer" | "arch-reviewer"
    ) {
        push_file_context(
            project_root,
            &mut parts,
            ".emb-agent/ARCHITECTURE.md",
            "Architecture map",
        );
    }

    if let Some(task) = task {
        push_task_context(project_root, &mut parts, task, agent);
    } else {
        parts.push(
            "=== Active task ===\nNo active emb-agent task is set. Read-only research/scout/review work may proceed if the parent prompt is explicit. Implementation agents must report that the parent session needs to select or activate a task before editing broadly.".to_string(),
        );
    }

    join_context_parts(parts)
}

fn push_task_context(project_root: &Path, parts: &mut Vec<String>, task: &TaskRef, agent: &str) {
    let Some(task_dir) = task_dir_from_ref(project_root, task) else {
        return;
    };
    let task_rel = relative_path(project_root, &task_dir);
    push_file_context(
        project_root,
        parts,
        &format!("{task_rel}/task.json"),
        "Active task metadata",
    );

    for prd in task_prd_paths(project_root, &task_dir, task) {
        push_file_context(project_root, parts, &prd, "Task PRD");
    }

    for file in [
        "design.md",
        "implement.md",
        "review.md",
        "validation.md",
        "aar.md",
    ] {
        push_file_context(
            project_root,
            parts,
            &format!("{task_rel}/{file}"),
            "Task artifact",
        );
    }

    match agent {
        "fw-doer" => push_manifest_context(project_root, parts, &task_rel, "implement.jsonl"),
        "release-checker" | "sys-reviewer" | "arch-reviewer" => {
            push_manifest_context(project_root, parts, &task_rel, "check.jsonl")
        }
        "bug-hunter" => {
            push_manifest_context(project_root, parts, &task_rel, "debug.jsonl");
            push_manifest_context(project_root, parts, &task_rel, "check.jsonl");
        }
        _ => {}
    }

    push_markdown_directory_context(
        project_root,
        parts,
        &format!("{task_rel}/research"),
        "Task research",
        20,
    );
}

fn task_dir_from_ref(project_root: &Path, task: &TaskRef) -> Option<PathBuf> {
    let task_json = PathBuf::from(&task.path);
    if task_json.is_absolute()
        && task_json
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == "task.json")
    {
        return task_json.parent().map(Path::to_path_buf);
    }
    let ext = project_root.join(".emb-agent");
    let state_dir = crate::variant_ops::active_state_dir(&ext);
    Some(state_dir.join("tasks").join(&task.name))
}

fn task_prd_paths(project_root: &Path, task_dir: &Path, task: &TaskRef) -> Vec<String> {
    let mut paths = Vec::new();
    let task_json = task_dir.join("task.json");
    if let Ok(text) = fs::read_to_string(&task_json)
        && let Ok(value) = serde_json::from_str::<Value>(&text)
        && let Some(path) = value
            .pointer("/artifacts/prd")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    {
        paths.push(path.to_string());
    }
    paths.push(format!("docs/prd/tasks/{}.md", task.name));
    paths.push(format!("{}/prd.md", relative_path(project_root, task_dir)));
    paths.sort();
    paths.dedup();
    paths
}

fn push_manifest_context(project_root: &Path, parts: &mut Vec<String>, task_rel: &str, file: &str) {
    let manifest_rel = format!("{task_rel}/{file}");
    let Some(manifest_path) = safe_project_path(project_root, &manifest_rel) else {
        return;
    };
    let Ok(text) = fs::read_to_string(manifest_path) else {
        return;
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(item) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(path) = item
            .get("file")
            .or_else(|| item.get("path"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if item.get("type").and_then(Value::as_str) == Some("directory") {
            push_markdown_directory_context(project_root, parts, path, "Manifest directory", 20);
        } else {
            push_file_context(project_root, parts, path, "Manifest file");
        }
    }
}

fn push_file_context(project_root: &Path, parts: &mut Vec<String>, rel: &str, label: &str) {
    let Some(path) = safe_project_path(project_root, rel) else {
        return;
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return;
    };
    if text.trim().is_empty() {
        return;
    }
    let rel = relative_path(project_root, &path);
    parts.push(format!(
        "=== {rel} ({label}) ===\n{}",
        truncate_context(&text, 20_000)
    ));
}

fn push_markdown_directory_context(
    project_root: &Path,
    parts: &mut Vec<String>,
    rel: &str,
    label: &str,
    max_files: usize,
) {
    let Some(dir) = safe_project_path(project_root, rel) else {
        return;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("md")
        })
        .collect();
    files.sort();
    for path in files.into_iter().take(max_files) {
        let rel = relative_path(project_root, &path);
        push_file_context(project_root, parts, &rel, label);
    }
}

fn safe_project_path(project_root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.trim().trim_start_matches("./");
    if rel.is_empty() {
        return None;
    }
    let path = PathBuf::from(rel);
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return None;
    }
    if path.is_absolute() {
        if path.starts_with(project_root) {
            Some(path)
        } else {
            None
        }
    } else {
        Some(project_root.join(path))
    }
}

fn relative_path(project_root: &Path, path: &Path) -> String {
    path.strip_prefix(project_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn truncate_context(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out = text
        .chars()
        .take(max_chars.saturating_sub(80))
        .collect::<String>();
    out.push_str("\n\n[emb-agent truncated this injected file context]\n");
    out
}

fn join_context_parts(parts: Vec<String>) -> String {
    let mut out = String::new();
    for part in parts {
        if part.trim().is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        if out.chars().count() + part.chars().count() > 90_000 {
            out.push_str("[emb-agent stopped context injection at 90000 chars]\n");
            break;
        }
        out.push_str(&part);
    }
    out
}

fn build_subagent_prompt(
    agent: &str,
    task: Option<&TaskRef>,
    context: &str,
    original_prompt: &str,
) -> String {
    let task_line = task
        .map(|task| format!("Target task: {}", task.name))
        .unwrap_or_else(|| "Target task: (none active)".to_string());
    format!(
        "{SUBAGENT_CONTEXT_MARKER}\n# emb-agent Subagent Context\n\nAgent: `{agent}`\n{task_line}\n\nThe parent session has injected the current emb-agent task and project context below. Treat it as routing context, then execute the original task. Do not spawn more emb-agent subagents.\n\n## Injected Context\n\n{context}\n\n---\n\n## Original Task\n\n{}",
        original_prompt.trim()
    )
}

fn with_updated_prompt(tool_input: Value, prompt: &str) -> Value {
    match tool_input {
        Value::Object(mut map) => {
            map.insert("prompt".to_string(), Value::String(prompt.to_string()));
            Value::Object(map)
        }
        _ => json!({ "prompt": prompt }),
    }
}

fn subagent_context_payload(updated_input: &Value) -> String {
    json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": updated_input,
        },
        "permission": "allow",
        "updated_input": updated_input,
        "updatedInput": updated_input,
    })
    .to_string()
}

fn is_workspace_trusted(data: &Value) -> bool {
    for name in [
        "EMB_AGENT_FORCE_WORKSPACE_TRUST",
        "EMB_AGENT_WORKSPACE_TRUST",
    ] {
        if let Ok(value) = env::var(name)
            && let Some(parsed) = parse_boolean_value(&Value::String(value))
        {
            return parsed;
        }
    }

    for value in [
        data.get("workspace_trusted"),
        data.get("workspaceTrusted"),
        data.get("trusted"),
        data.get("is_trusted"),
        data.get("isTrusted"),
        data.get("trust_established"),
        data.get("trustEstablished"),
        data.pointer("/workspace/trusted"),
        data.pointer("/workspace/is_trusted"),
        data.pointer("/workspace/isTrusted"),
        data.pointer("/security/workspace_trusted"),
        data.pointer("/security/trusted"),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(parsed) = parse_boolean_value(value) {
            return parsed;
        }
    }

    true
}

fn parse_boolean_value(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(value) => Some(*value),
        Value::Number(value) => {
            if value.as_i64() == Some(1) {
                Some(true)
            } else if value.as_i64() == Some(0) {
                Some(false)
            } else {
                None
            }
        }
        Value::String(value) => match value.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "y" | "on" | "trusted" => Some(true),
            "0" | "false" | "no" | "n" | "off" | "untrusted" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn project_root_from_payload(data: &Value) -> PathBuf {
    let cwd = string_at(
        data,
        &[&["cwd"], &["workspace", "cwd"], &["session", "cwd"]],
    )
    .unwrap_or_else(|| ".".to_string());
    let path = PathBuf::from(&cwd);
    let absolute = if path.is_absolute() {
        path
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    if let Some(root) = find_project_root(&absolute) {
        return root;
    }

    absolute.canonicalize().unwrap_or(absolute)
}

fn tool_name(data: &Value) -> String {
    for path in [
        &["tool_name"][..],
        &["toolName"][..],
        &["tool", "name"][..],
        &["tool", "tool_name"][..],
        &["tool", "toolName"][..],
        &["toolCall", "name"][..],
        &["tool_call", "name"][..],
        &["name"][..],
    ] {
        if let Some(value) = string_path(data, path) {
            return value;
        }
    }

    data.get("tool")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .to_string()
}

fn command_from_payload(data: &Value) -> Option<String> {
    for path in [
        &["tool_input", "command"][..],
        &["toolInput", "command"][..],
        &["input", "command"][..],
        &["arguments", "command"][..],
        &["args", "command"][..],
        &["params", "command"][..],
        &["command"][..],
        &["cmd"][..],
    ] {
        if let Some(value) = string_path(data, path) {
            return Some(value);
        }
    }
    None
}

fn input_values(data: &Value) -> Vec<&Value> {
    let mut values = vec![data];
    for key in [
        "tool_input",
        "toolInput",
        "input",
        "arguments",
        "args",
        "params",
        "tool",
        "toolCall",
        "tool_call",
    ] {
        if let Some(value) = data.get(key) {
            values.push(value);
        }
    }
    values
}

fn string_at(data: &Value, paths: &[&[&str]]) -> Option<String> {
    paths.iter().find_map(|path| string_path(data, path))
}

fn string_path(data: &Value, path: &[&str]) -> Option<String> {
    let mut current = data;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn collect_path_like_strings(data: &Value) -> Vec<String> {
    let mut out = Vec::new();
    for value in input_values(data) {
        collect_path_like_strings_inner(value, &mut out);
    }
    out.sort();
    out.dedup();
    out
}

fn collect_path_like_strings_inner(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let normalized = normalize_key(key);
                if matches!(
                    normalized.as_str(),
                    "path"
                        | "filepath"
                        | "filename"
                        | "file"
                        | "uri"
                        | "absolutepath"
                        | "relativepath"
                        | "paths"
                        | "files"
                        | "pattern"
                        | "glob"
                        | "include"
                ) {
                    collect_string_values(child, out);
                }
                collect_path_like_strings_inner(child, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_path_like_strings_inner(child, out);
            }
        }
        _ => {}
    }
}

fn collect_string_values(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(value) => {
            let cleaned = clean_path_like_value(value);
            if !cleaned.is_empty() {
                out.push(cleaned);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_string_values(item, out);
            }
        }
        Value::Object(map) => {
            for child in map.values() {
                collect_string_values(child, out);
            }
        }
        _ => {}
    }
}

fn clean_path_like_value(value: &str) -> String {
    let trimmed = value.trim().trim_matches('"').trim_matches('\'');
    if let Some(path) = trimmed.strip_prefix("file://") {
        path.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| *ch != '_' && *ch != '-')
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_knowledge_search_tool_call(tool: &str, data: &Value, command: Option<&str>) -> bool {
    let normalized = normalize_tool_name(tool);
    if normalized.contains("knowledge_search") || normalized.ends_with("knowledgesearch") {
        return true;
    }
    if command.map(is_knowledge_search_command).unwrap_or(false) {
        return true;
    }
    input_string_for_key(data, "name")
        .map(|value| value == "knowledge_search")
        .unwrap_or(false)
}

fn is_knowledge_search_command(command: &str) -> bool {
    let tokens = shell_tokens(command);
    if !has_adjacent_tokens(&tokens, "knowledge", "search") {
        return false;
    }
    if tokens.iter().any(|token| token.contains("emb-agent")) {
        return true;
    }
    tokens
        .windows(2)
        .any(|pair| pair[0] == "knowledge" && pair[1] == "search")
}

fn record_knowledge_priming(
    project_root: &Path,
    host: &str,
    tool: &str,
    command: Option<&str>,
    data: &Value,
) {
    let path = tool_guard_state_path(project_root);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let payload = json!({
        "knowledge_primed_at_ms": now_ms(),
        "host": host,
        "tool": if tool.trim().is_empty() { "knowledge_search" } else { tool.trim() },
        "query": knowledge_query(data, command).unwrap_or_default(),
        "status": "attempted",
        "source": "pre-tool-use",
    });
    let _ = fs::write(path, payload.to_string());
}

fn knowledge_query(data: &Value, command: Option<&str>) -> Option<String> {
    input_string_for_key(data, "query")
        .or_else(|| input_string_for_key(data, "q"))
        .or_else(|| command.and_then(query_from_knowledge_command))
}

fn query_from_knowledge_command(command: &str) -> Option<String> {
    let tokens = shell_tokens_original(command);
    for (index, token) in tokens.iter().enumerate() {
        if token == "--query" || token == "-q" {
            return tokens.get(index + 1).cloned();
        }
        if let Some(value) = token.strip_prefix("--query=") {
            return Some(value.to_string());
        }
    }
    None
}

fn input_string_for_key(data: &Value, key: &str) -> Option<String> {
    for value in input_values(data) {
        if let Some(found) = find_string_for_key(value, key) {
            return Some(found);
        }
    }
    None
}

fn find_string_for_key(value: &Value, target_key: &str) -> Option<String> {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if normalize_key(key) == normalize_key(target_key)
                    && let Some(value) = child.as_str()
                {
                    let trimmed = value.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
                if let Some(found) = find_string_for_key(child, target_key) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items
            .iter()
            .find_map(|child| find_string_for_key(child, target_key)),
        _ => None,
    }
}

fn has_fresh_knowledge_priming(project_root: &Path) -> bool {
    let Ok(text) = fs::read_to_string(tool_guard_state_path(project_root)) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return false;
    };
    let timestamp = value
        .get("knowledge_primed_at_ms")
        .or_else(|| value.get("timestamp"))
        .and_then(Value::as_u64)
        .unwrap_or(0) as u128;
    timestamp > 0 && now_ms().saturating_sub(timestamp) <= KNOWLEDGE_PRIMING_TTL_MS
}

fn tool_guard_state_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".emb-agent")
        .join("sessions")
        .join("tool-guard-state.json")
}

fn should_block_raw_schematic(
    tool: &str,
    command: Option<&str>,
    data: &Value,
    paths: &[String],
) -> bool {
    if is_schematic_ingest_tool_call(tool, data, command) {
        return false;
    }
    if is_shell_tool(tool) {
        return command.map(is_raw_schematic_shell_command).unwrap_or(false);
    }
    is_read_like_tool(tool) && paths.iter().any(|path| is_schematic_path(path))
}

fn is_schematic_ingest_tool_call(tool: &str, data: &Value, command: Option<&str>) -> bool {
    if command.map(is_schematic_ingest_command).unwrap_or(false) {
        return true;
    }
    let normalized = normalize_tool_name(tool);
    (normalized.contains("ingest_doc") || normalized.contains("ingestdoc"))
        && input_kind_is_schematic(data)
}

fn input_kind_is_schematic(data: &Value) -> bool {
    input_string_for_key(data, "kind")
        .or_else(|| input_string_for_key(data, "document_kind"))
        .or_else(|| input_string_for_key(data, "documentKind"))
        .map(|value| value.to_ascii_lowercase().contains("schematic"))
        .unwrap_or(false)
}

fn is_schematic_ingest_command(command: &str) -> bool {
    let tokens = shell_tokens(command);
    has_adjacent_tokens(&tokens, "ingest", "schematic")
        || (has_adjacent_tokens(&tokens, "ingest", "doc")
            && tokens.iter().any(|token| token.contains("schematic")))
        || command
            .to_ascii_lowercase()
            .replace(' ', "")
            .contains("kind=schematic")
}

fn is_raw_schematic_shell_command(command: &str) -> bool {
    if is_schematic_ingest_command(command) {
        return false;
    }
    if !command_references_schematic(command) {
        return false;
    }
    shell_tokens(command).iter().any(|token| {
        matches!(
            token_basename(token).as_str(),
            "cat"
                | "head"
                | "tail"
                | "strings"
                | "grep"
                | "rg"
                | "sed"
                | "awk"
                | "python"
                | "python3"
                | "perl"
                | "node"
                | "xxd"
                | "hexdump"
                | "less"
                | "more"
                | "bat"
        )
    })
}

fn command_references_schematic(command: &str) -> bool {
    shell_tokens(command)
        .iter()
        .any(|token| is_schematic_path(token))
}

fn is_schematic_path(path: &str) -> bool {
    let lower = normalize_path_text(path);
    [".schdoc", ".sch", ".dsn", ".kicad_sch"]
        .iter()
        .any(|ext| lower.ends_with(ext) || lower.contains(&format!("{ext}/")))
}

fn is_unbounded_filesystem_search(command: &str) -> bool {
    let tokens = shell_tokens(command);
    for (index, token) in tokens.iter().enumerate() {
        let tool = token_basename(token);
        if tool == "find" && next_non_option_token(&tokens, index + 1) == Some("/") {
            return true;
        }
        if matches!(tool.as_str(), "rg" | "ag" | "fd")
            && tokens.iter().skip(index + 1).any(|token| token == "/")
        {
            return true;
        }
        if tool == "grep"
            && tokens.iter().skip(index + 1).any(|token| token == "/")
            && tokens.iter().skip(index + 1).any(|token| {
                let lower = token.to_ascii_lowercase();
                lower == "-r" || lower == "-R" || lower.contains('r')
            })
        {
            return true;
        }
    }
    false
}

fn next_non_option_token(tokens: &[String], start: usize) -> Option<&str> {
    tokens
        .iter()
        .skip(start)
        .find(|token| !token.starts_with('-'))
        .map(String::as_str)
}

fn should_block_source_inspection(tool: &str, command: Option<&str>, paths: &[String]) -> bool {
    if is_shell_tool(tool) {
        return command
            .map(is_source_inspection_shell_command)
            .unwrap_or(false);
    }

    if !is_read_like_tool(tool) && !is_search_like_tool(tool) {
        return false;
    }

    paths.iter().any(|path| is_source_inspection_path(path))
}

fn is_source_inspection_shell_command(command: &str) -> bool {
    let tokens = shell_tokens(command);
    let has_inspection_tool = tokens.iter().any(|token| {
        matches!(
            token_basename(token).as_str(),
            "find"
                | "rg"
                | "grep"
                | "cat"
                | "head"
                | "tail"
                | "sed"
                | "awk"
                | "ls"
                | "fd"
                | "bat"
                | "less"
                | "more"
        )
    });
    if !has_inspection_tool {
        return false;
    }

    if command_references_source(command) {
        return true;
    }

    let has_broad_search = tokens.iter().any(|token| {
        matches!(
            token_basename(token).as_str(),
            "find" | "rg" | "grep" | "fd"
        )
    });
    has_broad_search && !command_references_docs_only(command)
}

fn command_references_source(command: &str) -> bool {
    shell_tokens(command)
        .iter()
        .any(|token| is_source_inspection_path(token))
}

fn command_references_docs_only(command: &str) -> bool {
    let tokens = shell_tokens(command);
    let path_tokens: Vec<&str> = tokens
        .iter()
        .map(String::as_str)
        .filter(|token| token.contains('/') || token.starts_with('.'))
        .collect();
    !path_tokens.is_empty()
        && path_tokens
            .iter()
            .all(|token| is_safe_non_source_reference(token))
}

fn is_safe_non_source_reference(path: &str) -> bool {
    let p = normalize_path_text(path);
    p == "."
        || p.starts_with("./docs")
        || p.starts_with("docs/")
        || p.contains("/docs/")
        || p.starts_with("./.emb-agent")
        || p.starts_with(".emb-agent/")
        || p.contains("/.emb-agent/")
        || p.ends_with("/readme.md")
        || p == "readme.md"
}

fn is_source_inspection_path(path: &str) -> bool {
    let p = normalize_path_text(path);
    if p.is_empty()
        || p.contains("/.emb-agent/")
        || p.starts_with(".emb-agent/")
        || p.contains("/docs/")
        || p.starts_with("docs/")
        || p.ends_with("/readme.md")
        || p == "readme.md"
        || p.contains("/.codex/emb-agent/")
        || p.contains("/.cursor/emb-agent/")
        || p.contains("/.pi/emb-agent/")
    {
        return false;
    }

    if p.contains("/firmware/") || p.starts_with("firmware/") {
        return true;
    }

    if p.contains("/src/")
        || p.starts_with("src/")
        || p.contains("/include/")
        || p.starts_with("include/")
        || p.contains("/driver/")
        || p.contains("/drivers/")
        || p.starts_with("driver/")
        || p.starts_with("drivers/")
        || p.contains("/app/")
        || p.starts_with("app/")
        || p.contains("/hal/")
        || p.starts_with("hal/")
        || p.contains("/bsp/")
        || p.starts_with("bsp/")
    {
        return has_source_extension(&p);
    }

    has_source_extension(&p)
        || p.ends_with("/makefile")
        || p == "makefile"
        || p.ends_with("/cmakelists.txt")
        || p == "cmakelists.txt"
}

fn has_source_extension(path: &str) -> bool {
    [
        ".c", ".h", ".cc", ".cpp", ".hpp", ".s", ".asm", ".inc", ".rs", ".scw", ".mcw", ".uvproj",
        ".uvprojx", ".ioc", ".ld", ".lds", ".mk",
    ]
    .iter()
    .any(|ext| path.ends_with(ext))
}

fn is_shell_tool(tool: &str) -> bool {
    let normalized = normalize_tool_name(tool);
    matches!(
        normalized.as_str(),
        "bash" | "shell" | "exec" | "exec_command" | "external_command"
    ) || normalized.contains("shell")
        || normalized.contains("bash")
}

fn is_read_like_tool(tool: &str) -> bool {
    let normalized = normalize_tool_name(tool);
    matches!(
        normalized.as_str(),
        "read" | "readfile" | "read_file" | "view" | "open"
    ) || normalized.contains("read_file")
        || normalized.contains("readfile")
        || normalized.ends_with("__read")
}

fn is_search_like_tool(tool: &str) -> bool {
    let normalized = normalize_tool_name(tool);
    matches!(normalized.as_str(), "grep" | "glob" | "search" | "find")
        || normalized.contains("grep")
        || normalized.contains("glob")
        || normalized.contains("search")
}

fn normalize_tool_name(tool: &str) -> String {
    tool.trim().replace(['-', ' '], "_").to_ascii_lowercase()
}

fn normalize_path_text(path: &str) -> String {
    clean_path_like_value(path)
        .replace('\\', "/")
        .trim_matches('"')
        .trim_matches('\'')
        .trim_start_matches("./")
        .to_ascii_lowercase()
}

fn shell_tokens(command: &str) -> Vec<String> {
    shell_tokens_original(command)
        .into_iter()
        .map(|token| token.to_ascii_lowercase())
        .collect()
}

fn shell_tokens_original(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single = false;
    let mut in_double = false;
    let mut escaped = false;

    for ch in command.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' && !in_single {
            escaped = true;
            continue;
        }
        if ch == '\'' && !in_double {
            in_single = !in_single;
            continue;
        }
        if ch == '"' && !in_single {
            in_double = !in_double;
            continue;
        }
        if !in_single && !in_double && (ch.is_whitespace() || matches!(ch, ';' | '|' | '&')) {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            continue;
        }
        current.push(ch);
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn has_adjacent_tokens(tokens: &[String], first: &str, second: &str) -> bool {
    tokens
        .windows(2)
        .any(|pair| pair[0] == first && pair[1] == second)
}

fn token_basename(token: &str) -> String {
    token
        .rsplit('/')
        .next()
        .unwrap_or(token)
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_project(name: &str) -> PathBuf {
        let root = env::temp_dir().join(format!("emb-agent-tool-guard-{name}-{}", now_ms()));
        fs::create_dir_all(root.join(".emb-agent")).unwrap();
        root
    }

    #[test]
    fn blocks_source_read_before_knowledge_search() {
        let root = temp_project("source-read");
        let output = build_tool_guard_output_from_value_for_host(
            &json!({
                "hook_event_name": "PreToolUse",
                "cwd": root,
                "tool_name": "Read",
                "tool_input": { "path": "firmware/src/main.c" }
            }),
            "codex",
        );
        assert!(output.contains("\"decision\":\"block\""));
        assert!(output.contains("knowledge search"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn knowledge_search_primes_source_reads() {
        let root = temp_project("knowledge-prime");
        let knowledge = build_tool_guard_output_from_value_for_host(
            &json!({
                "cwd": root,
                "tool_name": "Bash",
                "tool_input": { "command": "node .codex/emb-agent/bin/emb-agent.cjs knowledge search --query \"timer\" --rerank" }
            }),
            "codex",
        );
        assert_eq!(knowledge, "");

        let output = build_tool_guard_output_from_value_for_host(
            &json!({
                "cwd": root,
                "tool_name": "Read",
                "tool_input": { "path": "firmware/src/main.c" }
            }),
            "codex",
        );
        assert_eq!(output, "");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn blocks_raw_schematic_reads_even_after_knowledge_search() {
        let root = temp_project("schematic");
        record_knowledge_priming(&root, "codex", "knowledge_search", None, &json!({}));
        let output = build_tool_guard_output_from_value_for_host(
            &json!({
                "cwd": root,
                "tool_name": "Bash",
                "tool_input": { "command": "strings docs/board.SchDoc" }
            }),
            "codex",
        );
        assert!(output.contains("\"decision\":\"block\""));
        assert!(output.contains("schematic"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn allows_schematic_ingest_command() {
        let root = temp_project("schematic-ingest");
        let output = build_tool_guard_output_from_value_for_host(
            &json!({
                "cwd": root,
                "tool_name": "Bash",
                "tool_input": { "command": "node .codex/emb-agent/bin/emb-agent.cjs ingest schematic --file docs/board.SchDoc" }
            }),
            "codex",
        );
        assert_eq!(output, "");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn blocks_root_search() {
        let root = temp_project("root-search");
        let output = build_tool_guard_output_from_value_for_host(
            &json!({
                "cwd": root,
                "tool_name": "Bash",
                "tool_input": { "command": "find / -name '*.c'" }
            }),
            "codex",
        );
        assert!(output.contains("\"decision\":\"block\""));
        assert!(output.contains("filesystem root"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn injects_active_task_context_for_subagent_spawn() {
        let root = temp_project("subagent-context");
        fs::write(root.join(".emb-agent/workflow.md"), "# Workflow\n").unwrap();
        fs::write(root.join(".emb-agent/attention.md"), "# Attention\n").unwrap();
        fs::write(root.join(".emb-agent/hw.yaml"), "mcu:\n  model: SC8F072\n").unwrap();
        fs::write(
            root.join(".emb-agent/req.yaml"),
            "goals:\n  - PWM dimming\n",
        )
        .unwrap();
        fs::write(root.join(".emb-agent/ARCHITECTURE.md"), "# Architecture\n").unwrap();
        fs::create_dir_all(root.join(".emb-agent/tasks/pwm-led/research")).unwrap();
        fs::create_dir_all(root.join("docs/prd/tasks")).unwrap();
        fs::write(root.join(".emb-agent/.current-task"), "pwm-led\n").unwrap();
        fs::write(
            root.join(".emb-agent/tasks/pwm-led/task.json"),
            r#"{"name":"pwm-led","title":"Implement PWM","status":"in_progress","priority":"P1","artifacts":{"prd":"docs/prd/tasks/pwm-led.md"}}"#,
        )
        .unwrap();
        fs::write(
            root.join("docs/prd/tasks/pwm-led.md"),
            "# PWM PRD\n\nUse timer PWM.\n",
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/tasks/pwm-led/implement.md"),
            "# Implement\n\nTouch pwm.c only.\n",
        )
        .unwrap();
        fs::write(
            root.join(".emb-agent/tasks/pwm-led/research/timer.md"),
            "# Timer Research\n\nTMR2 supports PWM.\n",
        )
        .unwrap();

        let output = build_tool_guard_output_from_value_for_host(
            &json!({
                "cwd": root,
                "tool_name": "Task",
                "tool_input": {
                    "subagent_type": "fw-doer",
                    "prompt": "Implement the PWM task."
                }
            }),
            "claude",
        );

        assert!(output.contains("hookSpecificOutput"), "output: {output}");
        assert!(output.contains("permissionDecision"), "output: {output}");
        assert!(output.contains(SUBAGENT_CONTEXT_MARKER), "output: {output}");
        assert!(output.contains("Target task: pwm-led"), "output: {output}");
        assert!(
            output.contains("docs/prd/tasks/pwm-led.md"),
            "output: {output}"
        );
        assert!(output.contains("implement.md"), "output: {output}");
        assert!(output.contains("research/timer.md"), "output: {output}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn injects_project_context_for_researcher_without_active_task() {
        let root = temp_project("researcher-no-task");
        fs::write(
            root.join(".emb-agent/workflow.md"),
            "# Workflow\n\nResearch first for SDK questions.\n",
        )
        .unwrap();
        fs::write(root.join(".emb-agent/attention.md"), "# Attention\n").unwrap();

        let output = build_tool_guard_output_from_value_for_host(
            &json!({
                "cwd": root,
                "tool_name": "Task",
                "tool_input": {
                    "subagent_type": "researcher",
                    "prompt": "Research the vendor SDK timer API."
                }
            }),
            "codex",
        );

        assert!(output.contains(SUBAGENT_CONTEXT_MARKER), "output: {output}");
        assert!(
            output.contains("No active emb-agent task"),
            "output: {output}"
        );
        assert!(
            output.contains("Research first for SDK questions"),
            "output: {output}"
        );
        let _ = fs::remove_dir_all(root);
    }
}
