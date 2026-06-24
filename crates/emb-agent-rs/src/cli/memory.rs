use super::util::{current_dir_string, option_value, positional_after};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const INDEX_VERSION: u32 = 2;
const INDEX_TEXT_LIMIT: usize = 96_000;
const SUMMARY_LIMIT: usize = 1_200;

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
struct DialogueTurn {
    role: String,
    text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct IndexedSession {
    session: MemSessionInfo,
    mtime_ms: u128,
    size: u64,
    summary: String,
    keywords: Vec<String>,
    text_tail: String,
    #[serde(default)]
    semantic_vector: Vec<f32>,
    #[serde(default)]
    phases: Vec<PhaseSpan>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct PhaseSpan {
    phase: String,
    start_turn: usize,
    end_turn: usize,
    preview: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct MemIndex {
    version: u32,
    generated_ms: u128,
    root: String,
    sessions: Vec<IndexedSession>,
}

#[derive(Clone, Debug, Serialize)]
struct SearchHit {
    session: MemSessionInfo,
    score: usize,
    exact_score: usize,
    keyword_score: usize,
    semantic_score: f32,
    preview: String,
    keywords: Vec<String>,
    matched_aliases: Vec<String>,
}

pub fn run(args: &[String]) -> Result<(), String> {
    if args.first().map(String::as_str) == Some("mem") {
        return run_session_mem(args);
    }
    let subcmd = args.get(1).map(String::as_str).unwrap_or("list");
    if matches!(
        subcmd,
        "projects"
            | "sessions"
            | "search"
            | "context"
            | "extract"
            | "show"
            | "timeline"
            | "related"
            | "summary"
            | "summarize"
            | "reindex"
            | "stats"
            | "doctor"
            | "prune"
            | "open"
            | "explain"
            | "export"
            | "diff"
            | "writeback"
            | "promote"
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
    let force = args
        .iter()
        .any(|arg| arg == "--refresh" || arg == "--force");
    match subcmd {
        "list" | "sessions" => {
            let sessions = list_mem_sessions(&cwd, &platform, limit)?;
            print_json(&serde_json::json!({"sessions": sessions, "count": sessions.len()}))
        }
        "projects" => {
            let index = load_or_build_index(&cwd, &platform, force)?;
            let mut projects: BTreeMap<String, usize> = BTreeMap::new();
            for session in index.sessions {
                *projects.entry(session.session.project).or_insert(0) += 1;
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
            let hits = search_mem_sessions(&cwd, &platform, &query, limit, force)?;
            print_json(&serde_json::json!({"query": query, "hits": hits, "count": hits.len()}))
        }
        "context" => {
            let query = option_value(args, "--query").or_else(|| positional_after(args, 2));
            let session_id = option_value(args, "--session").or_else(|| option_value(args, "--id"));
            let window = option_value(args, "--window")
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(3);
            let session =
                resolve_session(&cwd, &platform, session_id.as_deref(), query.as_deref(), force)?;
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
            let session = resolve_session(&cwd, &platform, session_id.as_deref(), grep.as_deref(), force)?;
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
        "show" => {
            let id = option_value(args, "--session")
                .or_else(|| option_value(args, "--id"))
                .or_else(|| positional_after(args, 2));
            let session = resolve_session(&cwd, &platform, id.as_deref(), None, force)?;
            let indexed = indexed_session(&cwd, &platform, &session.id, force)?;
            print_json(&serde_json::json!({"session": session, "summary": indexed.summary, "keywords": indexed.keywords, "phases": indexed.phases}))
        }
        "timeline" => {
            let mut sessions = list_mem_sessions(&cwd, &platform, limit)?;
            sessions.sort_by_key(|s| s.created_ms);
            let rows: Vec<Value> = sessions
                .into_iter()
                .map(|s| serde_json::json!({"time_ms": s.created_ms, "platform": s.platform, "project": s.project, "id": s.id, "path": s.path, "turns": s.turns}))
                .collect();
            print_json(&serde_json::json!({"timeline": rows, "count": rows.len()}))
        }
        "related" => {
            let id = option_value(args, "--session")
                .or_else(|| option_value(args, "--id"))
                .or_else(|| positional_after(args, 2))
                .ok_or("mem related requires <session-id> or --session <id>")?;
            let base = indexed_session(&cwd, &platform, &id, force)?;
            let query = base.keywords.join(" ");
            let mut hits = search_mem_sessions(&cwd, &platform, &query, limit + 1, force)?;
            hits.retain(|hit| hit.session.path != base.session.path);
            if hits.len() > limit {
                hits.truncate(limit);
            }
            print_json(&serde_json::json!({"session": base.session, "related": hits, "count": hits.len()}))
        }
        "summary" | "summarize" => {
            let id = option_value(args, "--session")
                .or_else(|| option_value(args, "--id"))
                .or_else(|| positional_after(args, 2));
            let session = resolve_session(&cwd, &platform, id.as_deref(), None, force)?;
            let indexed = indexed_session(&cwd, &platform, &session.id, force)?;
            println!("{}", indexed.summary);
            Ok(())
        }
        "reindex" => {
            let index = build_and_save_index(&cwd, &platform)?;
            print_json(&serde_json::json!({"status":"ok", "index_path": index_path(&cwd).to_string_lossy(), "sessions": index.sessions.len(), "generated_ms": index.generated_ms}))
        }
        "stats" => {
            let index = load_or_build_index(&cwd, &platform, force)?;
            let bytes: u64 = index.sessions.iter().map(|s| s.session.bytes).sum();
            let turns: usize = index.sessions.iter().map(|s| s.session.turns).sum();
            let mut by_platform: BTreeMap<String, usize> = BTreeMap::new();
            for item in &index.sessions {
                *by_platform.entry(item.session.platform.clone()).or_insert(0) += 1;
            }
            print_json(&serde_json::json!({"index_path": index_path(&cwd), "sessions": index.sessions.len(), "bytes": bytes, "turns": turns, "by_platform": by_platform, "generated_ms": index.generated_ms}))
        }
        "doctor" => {
            let roots: Vec<Value> = session_roots()
                .into_iter()
                .map(|(root, platform)| serde_json::json!({"platform": platform, "path": root, "exists": root.exists()}))
                .collect();
            let idx = index_path(&cwd);
            print_json(&serde_json::json!({"status":"ok", "index_path": idx, "index_exists": idx.exists(), "roots": roots}))
        }
        "prune" => {
            let path = index_path(&cwd);
            if path.exists() {
                fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
            }
            print_json(&serde_json::json!({"status":"ok", "removed": path}))
        }
        "open" => {
            let id = option_value(args, "--session")
                .or_else(|| option_value(args, "--id"))
                .or_else(|| positional_after(args, 2));
            let session = resolve_session(&cwd, &platform, id.as_deref(), None, force)?;
            print_json(&serde_json::json!({"session": session, "open": {"path": session.path, "hint": "Open this local JSONL transcript with your editor; emb-agent never uploads it."}}))
        }
        "explain" => {
            let query = option_value(args, "--query")
                .or_else(|| positional_after(args, 2))
                .ok_or("mem explain requires --query <text> or positional query")?;
            let hits = search_mem_sessions(&cwd, &platform, &query, limit, force)?;
            let explanation: Vec<Value> = hits
                .into_iter()
                .map(|hit| serde_json::json!({
                    "session": hit.session,
                    "score": hit.score,
                    "exact_score": hit.exact_score,
                    "keyword_score": hit.keyword_score,
                    "semantic_score": hit.semantic_score,
                    "matched_keywords": hit.keywords.into_iter().filter(|kw| query.to_lowercase().contains(kw) || hit.preview.to_lowercase().contains(kw)).collect::<Vec<_>>(),
                    "matched_aliases": hit.matched_aliases,
                    "preview": hit.preview
                }))
                .collect();
            print_json(&serde_json::json!({"query": query, "explanation": explanation, "count": explanation.len()}))
        }
        "export" => {
            let format = option_value(args, "--format").unwrap_or_else(|| "json".to_string());
            let index = load_or_build_index(&cwd, &platform, force)?;
            if format == "markdown" || format == "md" {
                for item in index.sessions.into_iter().take(limit) {
                    println!("## {} {}\n\nPath: `{}`\n\nKeywords: {}\n\nPhases: {}\n\n{}\n", item.session.platform, item.session.id, item.session.path, item.keywords.join(", "), item.phases.iter().map(|p| p.phase.as_str()).collect::<Vec<_>>().join(", "), item.summary);
                }
                Ok(())
            } else {
                print_json(&serde_json::json!({"sessions": index.sessions, "count": index.sessions.len()}))
            }
        }
        "diff" => {
            let left = option_value(args, "--left").or_else(|| positional_after(args, 2)).ok_or("mem diff requires --left <session> or two positional ids")?;
            let right = option_value(args, "--right").or_else(|| positional_after(args, 3)).ok_or("mem diff requires --right <session> or two positional ids")?;
            let a = indexed_session(&cwd, &platform, &left, force)?;
            let b = indexed_session(&cwd, &platform, &right, force)?;
            let ka: BTreeSet<String> = a.keywords.iter().cloned().collect();
            let kb: BTreeSet<String> = b.keywords.iter().cloned().collect();
            let shared = ka.intersection(&kb).cloned().collect::<Vec<_>>();
            let only_left = ka.difference(&kb).cloned().collect::<Vec<_>>();
            let only_right = kb.difference(&ka).cloned().collect::<Vec<_>>();
            print_json(&serde_json::json!({"left": a.session, "right": b.session, "shared_keywords": shared, "left_only_keywords": only_left, "right_only_keywords": only_right}))
        }
        "writeback" => {
            let target = option_value(args, "--target").unwrap_or_else(|| "auto".to_string());
            let summary = option_value(args, "--summary").or_else(|| positional_after(args, 2)).ok_or("mem writeback requires --summary <text>")?;
            let detail = option_value(args, "--detail").unwrap_or_default();
            writeback_memory(Path::new(&cwd), &target, &summary, &detail)
        }
        "promote" => {
            let query = option_value(args, "--query")
                .or_else(|| positional_after(args, 2))
                .ok_or("mem promote requires --query <text> or positional query")?;
            let target = option_value(args, "--target").unwrap_or_else(|| "auto".to_string());
            let apply = args.iter().any(|arg| arg == "--apply");
            promote_memory(Path::new(&cwd), &cwd, &platform, &query, &target, limit, force, apply)
        }
        _ => Err("mem: expected list|projects|search|context|extract|show|timeline|related|summary|reindex|stats|doctor|prune|open|explain|export|diff|writeback|promote".to_string()),
    }
}

fn writeback_memory(
    project_root: &Path,
    target: &str,
    summary: &str,
    detail: &str,
) -> Result<(), String> {
    let target = if target == "auto" {
        auto_writeback_target(summary, detail)
    } else {
        target.to_string()
    };
    match target.as_str() {
        "memory" | "durable" => {
            let id = emb_agent_core::knowledge::graph::memory_remember(
                project_root,
                "session-insight",
                summary,
                detail,
            )?;
            print_json(
                &serde_json::json!({"status":"ok", "target":"memory", "memory_type":"session-insight", "id": id, "strategy":"auto-or-explicit"}),
            )
        }
        "attention" => {
            let ext_dir = project_root.join(".emb-agent");
            println!(
                "{}",
                emb_agent_core::compound::attention_note(&ext_dir, summary, "Session Insight")
            );
            Ok(())
        }
        "trap" | "trick" | "decision" | "learn" => {
            let doc_type = if target == "learn" {
                "learn"
            } else {
                target.as_str()
            };
            let ext_dir = project_root.join(".emb-agent");
            let slug = safe_slug(summary);
            let compound_summary = if detail.is_empty() { summary } else { detail };
            let output = emb_agent_core::compound::compound_add(
                &ext_dir,
                emb_agent_core::compound::CompoundAdd {
                    doc_type,
                    slug: &slug,
                    title: summary,
                    summary: compound_summary,
                    chip: "",
                    peripheral: "",
                    extra: &[("source", "mem-writeback")],
                },
            );
            println!("{output}");
            Ok(())
        }
        "task" | "prd" => print_json(&serde_json::json!({
            "status": "manual",
            "target": target,
            "summary": summary,
            "detail": detail,
            "next": "Use this insight in the current PRD/task update. emb-agent does not invent exact requirement/task wording without local context."
        })),
        other => Err(format!("mem writeback unknown target: {other}")),
    }
}

#[allow(clippy::too_many_arguments)]
fn promote_memory(
    project_root: &Path,
    cwd: &str,
    platform: &str,
    query: &str,
    target: &str,
    limit: usize,
    force: bool,
    apply: bool,
) -> Result<(), String> {
    let hits = search_mem_sessions(cwd, platform, query, limit, force)?;
    let mut candidates = Vec::new();
    let mut applied = Vec::new();
    for hit in hits {
        let summary = promotion_summary(query, &hit);
        let detail = promotion_detail(&hit);
        let chosen_target = if target == "auto" {
            auto_writeback_target(&summary, &detail)
        } else {
            target.to_string()
        };
        let candidate = serde_json::json!({
            "target": chosen_target,
            "summary": summary,
            "detail": detail,
            "session": hit.session,
            "score": hit.score,
            "semantic_score": hit.semantic_score,
            "matched_aliases": hit.matched_aliases,
            "apply_command": format!("mem promote --query {} --target {} --apply", shell_quote(query), shell_quote(target)),
        });
        if apply {
            applied.push(apply_promotion(
                project_root,
                &chosen_target,
                &summary,
                &detail,
            )?);
        }
        candidates.push(candidate);
    }
    print_json(&serde_json::json!({
        "status": if apply { "applied" } else { "dry-run" },
        "query": query,
        "apply": apply,
        "candidates": candidates,
        "applied": applied,
        "note": "Default is dry-run. Re-run with --apply to write selected insights locally."
    }))
}

fn promotion_summary(query: &str, hit: &SearchHit) -> String {
    let preview = hit
        .preview
        .split('.')
        .next()
        .unwrap_or(&hit.preview)
        .trim()
        .chars()
        .take(140)
        .collect::<String>();
    if preview.is_empty() {
        format!("Session insight for {query}")
    } else {
        format!("Session insight for {query}: {preview}")
    }
}

fn promotion_detail(hit: &SearchHit) -> String {
    format!(
        "Source: {} {}\nPath: {}\nScore: {} exact={} keyword={} semantic={:.3}\nKeywords: {}\nPreview: {}",
        hit.session.platform,
        hit.session.id,
        hit.session.path,
        hit.score,
        hit.exact_score,
        hit.keyword_score,
        hit.semantic_score,
        hit.keywords.join(", "),
        hit.preview
    )
}

fn apply_promotion(
    project_root: &Path,
    target: &str,
    summary: &str,
    detail: &str,
) -> Result<Value, String> {
    match target {
        "memory" | "durable" => {
            let id = emb_agent_core::knowledge::graph::memory_remember(
                project_root,
                "session-insight",
                summary,
                detail,
            )?;
            Ok(serde_json::json!({"target":"memory", "id": id}))
        }
        "attention" => {
            let ext_dir = project_root.join(".emb-agent");
            let output =
                emb_agent_core::compound::attention_note(&ext_dir, summary, "Session Insight");
            Ok(
                serde_json::json!({"target":"attention", "output": serde_json::from_str::<Value>(&output).unwrap_or(Value::String(output))}),
            )
        }
        "trap" | "trick" | "decision" | "learn" => {
            let doc_type = if target == "learn" { "learn" } else { target };
            let ext_dir = project_root.join(".emb-agent");
            let slug = safe_slug(summary);
            let output = emb_agent_core::compound::compound_add(
                &ext_dir,
                emb_agent_core::compound::CompoundAdd {
                    doc_type,
                    slug: &slug,
                    title: summary,
                    summary: detail,
                    chip: "",
                    peripheral: "",
                    extra: &[("source", "mem-promote")],
                },
            );
            Ok(
                serde_json::json!({"target":target, "output": serde_json::from_str::<Value>(&output).unwrap_or(Value::String(output))}),
            )
        }
        "task" | "prd" => Ok(serde_json::json!({
            "target": target,
            "status": "manual",
            "summary": summary,
            "next": "Copy this candidate into the active task/PRD after human review."
        })),
        other => Err(format!("mem promote unknown target: {other}")),
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn auto_writeback_target(summary: &str, detail: &str) -> String {
    let text = format!("{} {}", summary, detail).to_lowercase();
    if ["trap", "quirk", "errata", "gotcha", "坑", "陷阱"]
        .iter()
        .any(|token| text.contains(token))
    {
        "trap".to_string()
    } else if ["decision", "tradeoff", "decide", "选择", "决策"]
        .iter()
        .any(|token| text.contains(token))
    {
        "decision".to_string()
    } else if ["pattern", "trick", "sequence", "recipe", "技巧", "套路"]
        .iter()
        .any(|token| text.contains(token))
    {
        "trick".to_string()
    } else if ["blocker", "urgent", "must remember", "注意", "阻塞"]
        .iter()
        .any(|token| text.contains(token))
    {
        "attention".to_string()
    } else if ["requirement", "prd", "acceptance", "需求"]
        .iter()
        .any(|token| text.contains(token))
    {
        "prd".to_string()
    } else {
        "memory".to_string()
    }
}

fn safe_slug(value: &str) -> String {
    let slug = value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "session-insight".to_string()
    } else {
        slug
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

fn index_path(cwd: &str) -> PathBuf {
    Path::new(cwd)
        .join(".emb-agent")
        .join("cache")
        .join("mem")
        .join("index.json")
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

fn load_or_build_index(cwd: &str, platform: &str, force: bool) -> Result<MemIndex, String> {
    if !force
        && let Some(index) = read_index(cwd)
        && index.version == INDEX_VERSION
        && index_is_fresh(&index, platform)
    {
        return Ok(filter_index(index, platform));
    }
    build_and_save_index(cwd, platform)
}

fn read_index(cwd: &str) -> Option<MemIndex> {
    let path = index_path(cwd);
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn index_is_fresh(index: &MemIndex, platform: &str) -> bool {
    let sessions = list_mem_sessions(&index.root, platform, usize::MAX).unwrap_or_default();
    if sessions.len()
        != index
            .sessions
            .iter()
            .filter(|s| platform == "all" || s.session.platform == platform)
            .count()
    {
        return false;
    }
    for session in sessions {
        let Some(existing) = index
            .sessions
            .iter()
            .find(|item| item.session.path == session.path)
        else {
            return false;
        };
        if existing.mtime_ms != session.updated_ms || existing.size != session.bytes {
            return false;
        }
    }
    true
}

fn filter_index(mut index: MemIndex, platform: &str) -> MemIndex {
    if platform != "all" {
        index
            .sessions
            .retain(|item| item.session.platform == platform);
    }
    index
}

fn build_and_save_index(cwd: &str, platform: &str) -> Result<MemIndex, String> {
    let sessions = list_mem_sessions(cwd, platform, usize::MAX)?;
    let mut indexed = Vec::new();
    for session in sessions {
        let turns = read_dialogue(&session.path).unwrap_or_default();
        let text = turns
            .iter()
            .map(|turn| format!("{}: {}", turn.role, turn.text))
            .collect::<Vec<_>>()
            .join("\n\n");
        let text_tail = tail_chars(&text, INDEX_TEXT_LIMIT);
        indexed.push(IndexedSession {
            mtime_ms: session.updated_ms,
            size: session.bytes,
            summary: summarize_text(&text),
            keywords: keywords(&text),
            semantic_vector: semantic_vector(&text_tail),
            phases: phase_spans(&turns),
            text_tail,
            session,
        });
    }
    indexed.sort_by_key(|item| Reverse(item.session.updated_ms));
    let index = MemIndex {
        version: INDEX_VERSION,
        generated_ms: now_ms(),
        root: cwd.to_string(),
        sessions: indexed,
    };
    let path = index_path(cwd);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(&index).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(index)
}

fn indexed_session(
    cwd: &str,
    platform: &str,
    id: &str,
    force: bool,
) -> Result<IndexedSession, String> {
    let index = load_or_build_index(cwd, platform, force)?;
    index
        .sessions
        .into_iter()
        .find(|item| item.session.id.contains(id) || item.session.path.contains(id))
        .ok_or_else(|| format!("session not found: {id}"))
}

fn search_mem_sessions(
    cwd: &str,
    platform: &str,
    query: &str,
    limit: usize,
    force: bool,
) -> Result<Vec<SearchHit>, String> {
    let index = load_or_build_index(cwd, platform, force)?;
    let query_expanded = expand_query(query);
    let query_vector = semantic_vector(&query_expanded);
    let mut hits = Vec::new();
    for item in index.sessions {
        let exact_score = score_text(&item.text_tail, &query_expanded);
        let keyword_score = keyword_score(&item.keywords, &query_expanded);
        let semantic_score = cosine_similarity(&item.semantic_vector, &query_vector);
        let semantic_points = (semantic_score * 24.0).round().max(0.0) as usize;
        let score = exact_score + keyword_score + semantic_points;
        if score == 0 || (exact_score == 0 && keyword_score == 0 && semantic_score < 0.08) {
            continue;
        }
        hits.push(SearchHit {
            session: item.session,
            score,
            exact_score,
            keyword_score,
            semantic_score,
            preview: preview(&item.text_tail, &query_expanded),
            keywords: item.keywords,
            matched_aliases: matched_aliases(query),
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
    let lower = text.to_lowercase();
    query
        .split_whitespace()
        .map(|token| {
            let token = token.to_lowercase();
            if token.is_empty() {
                0
            } else {
                lower
                    .matches(&token)
                    .count()
                    .max(usize::from(lower.contains(&token)))
            }
        })
        .sum()
}

fn keyword_score(keywords: &[String], query: &str) -> usize {
    let set = keywords.iter().map(|s| s.as_str()).collect::<BTreeSet<_>>();
    query
        .split_whitespace()
        .filter(|token| set.contains(token.to_lowercase().as_str()))
        .count()
        * 3
}

fn expand_query(query: &str) -> String {
    let mut parts = query
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    let lower = query.to_lowercase();
    for group in SEMANTIC_ALIASES {
        if group
            .iter()
            .any(|token| lower.contains(&token.to_lowercase()))
        {
            parts.extend(group.iter().map(|token| token.to_string()));
        }
    }
    parts.join(" ")
}

fn matched_aliases(query: &str) -> Vec<String> {
    let lower = query.to_lowercase();
    let mut out = Vec::new();
    for group in SEMANTIC_ALIASES {
        if group
            .iter()
            .any(|token| lower.contains(&token.to_lowercase()))
        {
            out.push(group.join("|"));
        }
    }
    out
}

fn semantic_vector(text: &str) -> Vec<f32> {
    const DIM: usize = 64;
    let expanded = expand_query(text);
    let mut vector = vec![0.0_f32; DIM];
    for token in tokenize_terms(&expanded) {
        let hash = stable_hash(&token);
        let idx = (hash as usize) % DIM;
        let sign = if hash & 1 == 0 { 1.0 } else { -1.0 };
        vector[idx] += sign;
    }
    normalize_vector(vector)
}

fn tokenize_terms(text: &str) -> Vec<String> {
    text.split(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-')
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.len() >= 2 && !STOP_WORDS.contains(&token.as_str()))
        .collect()
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn normalize_vector(mut vector: Vec<f32>) -> Vec<f32> {
    let norm = vector.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in &mut vector {
            *value /= norm;
        }
    }
    vector
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right.iter())
        .map(|(a, b)| a * b)
        .sum::<f32>()
        .max(0.0)
}

fn phase_spans(turns: &[DialogueTurn]) -> Vec<PhaseSpan> {
    let boundaries = phase_boundaries(turns);
    let mut spans = Vec::new();
    let brainstorm_start = boundaries.create.unwrap_or(0);
    let brainstorm_end = boundaries.start.unwrap_or(turns.len());
    if brainstorm_end > brainstorm_start {
        spans.push(make_phase_span(
            "brainstorm",
            brainstorm_start,
            brainstorm_end,
            turns,
        ));
    }
    if let Some(start) = boundaries.start {
        let end = boundaries.finish.unwrap_or(turns.len());
        if end > start {
            spans.push(make_phase_span("implement", start, end, turns));
        }
    }
    if let Some(start) = boundaries.finish
        && turns.len() > start
    {
        spans.push(make_phase_span("review", start, turns.len(), turns));
    }
    if spans.is_empty() && !turns.is_empty() {
        spans.push(make_phase_span("all", 0, turns.len(), turns));
    }
    spans
}

fn make_phase_span(phase: &str, start: usize, end: usize, turns: &[DialogueTurn]) -> PhaseSpan {
    let preview = turns[start..end]
        .iter()
        .map(|turn| format!("{}: {}", turn.role, turn.text))
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(360)
        .collect::<String>();
    PhaseSpan {
        phase: phase.to_string(),
        start_turn: start,
        end_turn: end,
        preview,
    }
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
    force: bool,
) -> Result<MemSessionInfo, String> {
    if let Some(id) = id {
        return indexed_session(cwd, platform, id, force).map(|item| item.session);
    }
    if let Some(query) = query {
        return search_mem_sessions(cwd, platform, query, 1, force)?
            .into_iter()
            .next()
            .map(|hit| hit.session)
            .ok_or_else(|| format!("no session matched query: {query}"));
    }
    list_mem_sessions(cwd, platform, 1)?
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
    let boundaries = phase_boundaries(turns);
    match phase {
        "brainstorm" => {
            let start = boundaries.create.unwrap_or(0);
            let end = boundaries.start.unwrap_or(turns.len());
            if end > start {
                turns[start..end].to_vec()
            } else {
                turns.to_vec()
            }
        }
        "implement" => boundaries
            .start
            .map(|start| turns[start..boundaries.finish.unwrap_or(turns.len())].to_vec())
            .unwrap_or_default(),
        "review" | "finish" => boundaries
            .finish
            .map(|start| turns[start..].to_vec())
            .unwrap_or_default(),
        _ => turns.to_vec(),
    }
}

struct PhaseBoundaries {
    create: Option<usize>,
    start: Option<usize>,
    finish: Option<usize>,
}

fn phase_boundaries(turns: &[DialogueTurn]) -> PhaseBoundaries {
    PhaseBoundaries {
        create: turns.iter().position(|turn| is_create_boundary(&turn.text)),
        start: turns.iter().position(|turn| is_start_boundary(&turn.text)),
        finish: turns.iter().position(|turn| is_finish_boundary(&turn.text)),
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

fn is_finish_boundary(text: &str) -> bool {
    let t = text.to_lowercase();
    (t.contains("task.py") && (t.contains(" finish") || t.contains(" archive")))
        || (t.contains("emb-agent")
            && t.contains("task")
            && (t.contains("resolve") || t.contains("delete")))
        || t.contains("aar")
        || t.contains("review")
        || text.contains("完成")
}

fn summarize_text(text: &str) -> String {
    let mut out = Vec::new();
    for paragraph in text.split("\n\n") {
        let p = paragraph.trim().replace('\n', " ");
        if p.len() < 20 {
            continue;
        }
        out.push(p);
        if out.join("\n").chars().count() > SUMMARY_LIMIT {
            break;
        }
    }
    tail_chars(&out.join("\n"), SUMMARY_LIMIT)
}

fn keywords(text: &str) -> Vec<String> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for token in text
        .split(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-')
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.len() >= 4 && !STOP_WORDS.contains(&token.as_str()))
    {
        *counts.entry(token).or_insert(0) += 1;
    }
    let mut rows = counts.into_iter().collect::<Vec<_>>();
    rows.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    rows.into_iter().take(24).map(|(token, _)| token).collect()
}

fn tail_chars(text: &str, max_chars: usize) -> String {
    let len = text.chars().count();
    if len <= max_chars {
        return text.to_string();
    }
    text.chars().skip(len - max_chars).collect()
}

const SEMANTIC_ALIASES: &[&[&str]] = &[
    &["watchdog", "wdt", "iwdg", "wwdg", "看门狗"],
    &[
        "sleep",
        "low-power",
        "lowpower",
        "standby",
        "stop",
        "休眠",
        "低功耗",
    ],
    &["timer", "pwm", "capture", "compare", "定时器", "脉宽"],
    &["uart", "usart", "serial", "串口"],
    &["i2c", "twi", "smbus", "eeprom"],
    &["spi", "qspi", "flash"],
    &["adc", "sampling", "采样"],
    &["gpio", "pin", "io", "引脚"],
    &["interrupt", "irq", "isr", "中断"],
    &["boot", "bootloader", "startup", "启动"],
    &["trap", "quirk", "errata", "gotcha", "坑", "陷阱"],
    &["decision", "tradeoff", "choice", "选择", "决策"],
];

const STOP_WORDS: &[&str] = &[
    "about",
    "after",
    "agent",
    "assistant",
    "before",
    "code",
    "content",
    "could",
    "from",
    "have",
    "into",
    "message",
    "need",
    "should",
    "task",
    "that",
    "this",
    "user",
    "with",
    "would",
    "your",
    "进行",
    "已经",
    "这个",
    "需要",
    "实现",
];
