use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::hardware::project::find_project_root;

const KNOWLEDGE_PRIMING_TTL_MS: u128 = 10 * 60 * 1000;

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

fn input_values<'a>(data: &'a Value) -> Vec<&'a Value> {
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
    let mut iter = tokens.iter().enumerate();
    while let Some((index, token)) = iter.next() {
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
    tool.trim()
        .replace('-', "_")
        .replace(' ', "_")
        .to_ascii_lowercase()
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
}
