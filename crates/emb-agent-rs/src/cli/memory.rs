use super::util::{current_dir_string, option_value, positional_after};
use serde::Serialize;
use serde_json::Value;
use std::cmp::Reverse;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Clone, Debug, Serialize)]
struct MemSessionInfo {
    id: String,
    platform: String,
    path: String,
    project: String,
    created_ms: u128,
    updated_ms: u128,
    bytes: u64,
    turns: usize,
}

#[derive(Clone, Debug)]
struct DialogueTurn {
    role: String,
    text: String,
}

#[derive(Clone, Debug, Serialize)]
struct SearchHit {
    session: MemSessionInfo,
    score: usize,
    preview: String,
}

pub fn run(args: &[String]) -> Result<(), String> {
    if args.first().map(String::as_str) == Some("mem") {
        return run_session_mem(args);
    }
    let subcmd = args.get(1).map(String::as_str).unwrap_or("list");
    if matches!(
        subcmd,
        "projects" | "sessions" | "search" | "context" | "extract"
    ) {
        return run_session_mem(args);
    }
    run_project_memory(args)
}

fn run_project_memory(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let subcmd = args.get(1).map(String::as_str).unwrap_or("list");
    let project_root = Path::new(&cwd);
    match subcmd {
        "list" => match emb_agent_core::knowledge::graph::memory_list(project_root) {
            Ok(e) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(
                        &serde_json::json!({"entries":e.len(),"memories":e})
                    )
                    .unwrap_or_default()
                );
                Ok(())
            }
            Err(e) => Err(e),
        },
        "remember" => {
            let mt = option_value(args, "--type").unwrap_or_else(|| "reference".to_string());
            let s = option_value(args, "--summary").ok_or("memory remember requires --summary")?;
            let d = option_value(args, "--detail").unwrap_or_default();
            let id = emb_agent_core::knowledge::graph::memory_remember(project_root, &mt, &s, &d)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({"status":"ok","id":id}))
                    .unwrap_or_default()
            );
            Ok(())
        }
        _ => Err(
            "memory: expected list|remember or use `mem list|projects|search|context|extract`"
                .to_string(),
        ),
    }
}

fn run_session_mem(args: &[String]) -> Result<(), String> {
    let subcmd = args.get(1).map(String::as_str).unwrap_or("list");
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let platform = option_value(args, "--platform").unwrap_or_else(|| "all".to_string());
    let limit = option_value(args, "--limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(20);
    match subcmd {
        "list" | "sessions" => {
            let sessions = list_mem_sessions(&cwd, &platform, limit)?;
            print_json(&serde_json::json!({"sessions": sessions, "count": sessions.len()}))
        }
        "projects" => {
            let sessions = list_mem_sessions(&cwd, &platform, usize::MAX)?;
            let mut projects: BTreeMap<String, usize> = BTreeMap::new();
            for session in sessions {
                *projects.entry(session.project).or_insert(0) += 1;
            }
            let rows: Vec<Value> = projects
                .into_iter()
                .map(|(project, sessions)| serde_json::json!({"project": project, "sessions": sessions}))
                .collect();
            print_json(&serde_json::json!({"projects": rows, "count": rows.len()}))
        }
        "search" => {
            let query = option_value(args, "--query")
                .or_else(|| positional_after(args, 2))
                .ok_or("mem search requires --query <text> or positional query")?;
            let hits = search_mem_sessions(&cwd, &platform, &query, limit)?;
            print_json(&serde_json::json!({"query": query, "hits": hits, "count": hits.len()}))
        }
        "context" => {
            let query = option_value(args, "--query").or_else(|| positional_after(args, 2));
            let session_id = option_value(args, "--session").or_else(|| option_value(args, "--id"));
            let window = option_value(args, "--window")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(3);
            let session =
                resolve_session(&cwd, &platform, session_id.as_deref(), query.as_deref())?;
            let turns = read_dialogue(&session.path)?;
            let idx = query
                .as_deref()
                .and_then(|q| first_match_turn(&turns, q))
                .unwrap_or(0);
            let start = idx.saturating_sub(window);
            let end = (idx + window + 1).min(turns.len());
            let context: Vec<Value> = turns[start..end]
                .iter()
                .enumerate()
                .map(|(offset, turn)| serde_json::json!({"turn": start + offset, "role": turn.role, "text": turn.text}))
                .collect();
            print_json(
                &serde_json::json!({"session": session, "query": query, "window": window, "turns": context}),
            )
        }
        "extract" => {
            let phase = option_value(args, "--phase").unwrap_or_else(|| "all".to_string());
            let grep = option_value(args, "--grep");
            let session_id = option_value(args, "--session")
                .or_else(|| option_value(args, "--id"))
                .or_else(|| positional_after(args, 2));
            let session = resolve_session(&cwd, &platform, session_id.as_deref(), grep.as_deref())?;
            let turns = read_dialogue(&session.path)?;
            let sliced = slice_phase(&turns, &phase);
            let filtered: Vec<&DialogueTurn> = match grep.as_deref() {
                Some(g) => sliced
                    .iter()
                    .filter(|turn| contains_all_tokens(&turn.text, g))
                    .collect(),
                None => sliced.iter().collect(),
            };
            let text = filtered
                .iter()
                .map(|turn| format!("{}: {}", turn.role, turn.text))
                .collect::<Vec<_>>()
                .join("\n\n");
            println!("{text}");
            Ok(())
        }
        _ => Err("mem: expected list|projects|search|context|extract".to_string()),
    }
}

fn print_json(value: &Value) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).map_err(|e| e.to_string())?
    );
    Ok(())
}

fn list_mem_sessions(
    cwd: &str,
    platform: &str,
    limit: usize,
) -> Result<Vec<MemSessionInfo>, String> {
    let mut sessions = Vec::new();
    for (root, name) in session_roots() {
        if platform != "all" && platform != name {
            continue;
        }
        collect_jsonl(&root, name, &mut sessions)?;
    }
    let cwd_name = Path::new(cwd)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    sessions.sort_by_key(|session| Reverse(session.updated_ms));
    if !cwd_name.is_empty() {
        sessions.sort_by_key(|s| {
            if s.project.to_lowercase().contains(&cwd_name) {
                0
            } else {
                1
            }
        });
    }
    if sessions.len() > limit {
        sessions.truncate(limit);
    }
    Ok(sessions)
}

fn session_roots() -> Vec<(PathBuf, &'static str)> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut roots = Vec::new();
    roots.push((PathBuf::from(format!("{home}/.claude/projects")), "claude"));
    roots.push((PathBuf::from(format!("{home}/.codex/sessions")), "codex"));
    let pi = std::env::var("PI_CODING_AGENT_SESSION_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(format!("{home}/.pi/agent/sessions")));
    roots.push((pi, "pi"));
    roots
}

fn collect_jsonl(root: &Path, platform: &str, out: &mut Vec<MemSessionInfo>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|e| format!("read {}: {e}", root.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl(&path, platform, out)?;
        } else if path.extension().and_then(|s| s.to_str()) == Some("jsonl")
            && let Ok(info) = session_info(&path, platform)
        {
            out.push(info);
        }
    }
    Ok(())
}

fn session_info(path: &Path, platform: &str) -> Result<MemSessionInfo, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = meta.modified().ok();
    let updated_ms = modified
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let created_ms = meta
        .created()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(updated_ms);
    let id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("session")
        .to_string();
    let project = infer_project(path, platform);
    let turns = read_dialogue(&path.to_string_lossy())
        .map(|t| t.len())
        .unwrap_or(0);
    Ok(MemSessionInfo {
        id,
        platform: platform.to_string(),
        path: path.to_string_lossy().to_string(),
        project,
        created_ms,
        updated_ms,
        bytes: meta.len(),
        turns,
    })
}

fn infer_project(path: &Path, platform: &str) -> String {
    let parts: Vec<String> = path
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    if (platform == "claude" || platform == "pi") && parts.len() >= 2 {
        return parts[parts.len() - 2].clone();
    }
    parts
        .iter()
        .rev()
        .nth(2)
        .cloned()
        .unwrap_or_else(|| "unknown".to_string())
}

fn read_dialogue(path: &str) -> Result<Vec<DialogueTurn>, String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read {path}: {e}"))?;
    let mut turns = Vec::new();
    for line in raw.lines() {
        if let Some(turn) = parse_dialogue_line(line)
            && !turn.text.trim().is_empty()
        {
            turns.push(turn);
        }
    }
    Ok(turns)
}

fn parse_dialogue_line(line: &str) -> Option<DialogueTurn> {
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    if let Some(turn) = turn_from_value(&value) {
        return Some(turn);
    }
    for key in ["message", "item", "entry", "event"] {
        if let Some(child) = value.get(key).and_then(turn_from_value) {
            return Some(child);
        }
    }
    None
}

fn turn_from_value(value: &Value) -> Option<DialogueTurn> {
    let role = value
        .get("role")
        .and_then(Value::as_str)
        .or_else(|| value.get("author").and_then(Value::as_str))
        .unwrap_or("");
    let text = value
        .get("content")
        .map(content_to_text)
        .or_else(|| {
            value
                .get("text")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| {
            value
                .get("delta")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default();
    if role.is_empty() && text.is_empty() {
        return None;
    }
    Some(DialogueTurn {
        role: if role.is_empty() {
            "event".to_string()
        } else {
            role.to_string()
        },
        text,
    })
}

fn content_to_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(content_part_to_text)
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => map
            .get("text")
            .or_else(|| map.get("content"))
            .or_else(|| map.get("thinking"))
            .map(content_to_text)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn content_part_to_text(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Object(map) => map
            .get("text")
            .or_else(|| map.get("content"))
            .or_else(|| map.get("thinking"))
            .map(content_to_text),
        _ => None,
    }
}

fn search_mem_sessions(
    cwd: &str,
    platform: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    let sessions = list_mem_sessions(cwd, platform, usize::MAX)?;
    let mut hits = Vec::new();
    for session in sessions {
        let turns = read_dialogue(&session.path).unwrap_or_default();
        let haystack = turns
            .iter()
            .map(|t| t.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let score = score_text(&haystack, query);
        if score == 0 {
            continue;
        }
        hits.push(SearchHit {
            session,
            score,
            preview: preview(&haystack, query),
        });
    }
    hits.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| b.session.updated_ms.cmp(&a.session.updated_ms))
    });
    if hits.len() > limit {
        hits.truncate(limit);
    }
    Ok(hits)
}

fn score_text(text: &str, query: &str) -> usize {
    query
        .split_whitespace()
        .filter(|token| text.to_lowercase().contains(&token.to_lowercase()))
        .count()
}

fn contains_all_tokens(text: &str, query: &str) -> bool {
    query
        .split_whitespace()
        .all(|token| text.to_lowercase().contains(&token.to_lowercase()))
}

fn preview(text: &str, query: &str) -> String {
    let lower = text.to_lowercase();
    let needle = query
        .split_whitespace()
        .next()
        .unwrap_or(query)
        .to_lowercase();
    let idx = lower.find(&needle).unwrap_or(0);
    let start = text[..idx].chars().count().saturating_sub(180);
    let snippet: String = text.chars().skip(start).take(540).collect();
    snippet
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn resolve_session(
    cwd: &str,
    platform: &str,
    id: Option<&str>,
    query: Option<&str>,
) -> Result<MemSessionInfo, String> {
    let sessions = list_mem_sessions(cwd, platform, usize::MAX)?;
    if let Some(id) = id {
        if let Some(session) = sessions
            .iter()
            .find(|s| s.id.contains(id) || s.path.contains(id))
        {
            return Ok(session.clone());
        }
        return Err(format!("session not found: {id}"));
    }
    if let Some(query) = query {
        return search_mem_sessions(cwd, platform, query, 1)?
            .into_iter()
            .next()
            .map(|hit| hit.session)
            .ok_or_else(|| format!("no session matched query: {query}"));
    }
    sessions
        .into_iter()
        .next()
        .ok_or_else(|| "no local sessions found".to_string())
}

fn first_match_turn(turns: &[DialogueTurn], query: &str) -> Option<usize> {
    turns
        .iter()
        .position(|turn| contains_all_tokens(&turn.text, query))
}

fn slice_phase(turns: &[DialogueTurn], phase: &str) -> Vec<DialogueTurn> {
    if phase == "all" {
        return turns.to_vec();
    }
    let create = turns.iter().position(|turn| is_create_boundary(&turn.text));
    let start = turns.iter().position(|turn| is_start_boundary(&turn.text));
    match phase {
        "brainstorm" => match (create, start) {
            (Some(c), Some(s)) if s > c => turns[c..s].to_vec(),
            (Some(c), _) => turns[c..].to_vec(),
            _ => turns.to_vec(),
        },
        "implement" => match start {
            Some(s) => turns[s..].to_vec(),
            None => Vec::new(),
        },
        _ => turns.to_vec(),
    }
}

fn is_create_boundary(text: &str) -> bool {
    let t = text.to_lowercase();
    (t.contains("task.py") && t.contains(" create"))
        || (t.contains("emb-agent") && t.contains("task") && t.contains("add"))
        || t.contains("prd-exploration")
        || t.contains("brainstorm")
        || text.contains("需求探索")
}

fn is_start_boundary(text: &str) -> bool {
    let t = text.to_lowercase();
    (t.contains("task.py") && t.contains(" start"))
        || (t.contains("emb-agent") && t.contains("task") && t.contains("activate"))
        || t.contains("implementation")
        || text.contains("开始实现")
}
