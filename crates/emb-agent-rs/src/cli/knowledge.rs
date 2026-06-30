use super::util::{current_dir_string, option_value, positional_after};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const KNOWLEDGE_INDEX_VERSION: u32 = 3;
const KNOWLEDGE_EMBEDDING_CACHE_VERSION: u32 = 1;
const KNOWLEDGE_CHUNK_CHARS: usize = 6_000;
const KNOWLEDGE_CHUNK_OVERLAP: usize = 500;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct KnowledgeChunk {
    id: String,
    source_type: String,
    path: String,
    title: String,
    text: String,
    keywords: Vec<String>,
    vector: Vec<f32>,
    evidence: KnowledgeEvidence,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct KnowledgeEvidence {
    path: String,
    source_path: String,
    doc_id: String,
    provider: String,
    quality: String,
    line_start: usize,
    line_end: usize,
    page_start: Option<usize>,
    page_end: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct KnowledgeSourceManifest {
    source_type: String,
    path: String,
    title: String,
    hash: u64,
    bytes: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct KnowledgeEmbeddingCache {
    version: u32,
    provider: String,
    model: String,
    vectors: BTreeMap<String, Vec<f32>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct KnowledgeIndex {
    version: u32,
    generated_ms: u128,
    embedding_provider: String,
    embedding_model: String,
    manifest: Vec<KnowledgeSourceManifest>,
    chunks: Vec<KnowledgeChunk>,
}

#[derive(Clone, Debug)]
struct EmbeddingConfig {
    provider: String,
    model: String,
    api_base: String,
    api_key: String,
}

#[derive(Clone, Debug)]
struct RerankConfig {
    provider: String,
    model: String,
    api_base: String,
    api_key: String,
}

#[derive(Clone, Debug, Serialize)]
struct KnowledgeSearchResult {
    hits: Vec<KnowledgeHit>,
    rerank_provider: String,
    rerank_model: String,
}

#[derive(Clone, Debug, Serialize)]
struct KnowledgeHit {
    id: String,
    source_type: String,
    path: String,
    title: String,
    score: f32,
    rerank_score: Option<f32>,
    keywords: Vec<String>,
    evidence: KnowledgeEvidence,
    preview: String,
}

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let subcmd = args.get(1).map(String::as_str).unwrap_or("help");
    let project_root = Path::new(&cwd);
    match subcmd {
        "init" => init_knowledge(project_root),
        "index" => {
            let index = build_and_save_index(project_root)?;
            print_json(&serde_json::json!({
                "status": "ok",
                "index_path": knowledge_index_path(project_root),
                "chunks": index.chunks.len(),
                "sources": index.manifest.len(),
                "embedding_provider": index.embedding_provider,
                "embedding_model": index.embedding_model
            }))
        }
        "search" => {
            let query = option_value(args, "--query")
                .or_else(|| option_value(args, "--q"))
                .or_else(|| positional_after(args, 2))
                .ok_or("knowledge search requires --query <text>")?;
            let limit = option_value(args, "--limit")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(10);
            let force = args
                .iter()
                .any(|arg| arg == "--refresh" || arg == "--rebuild");
            let rerank = args.iter().any(|arg| arg == "--rerank");
            let result = search_index(project_root, &query, limit, force, rerank)?;
            print_json(&serde_json::json!({
                "query": query,
                "count": result.hits.len(),
                "rerank_provider": result.rerank_provider,
                "rerank_model": result.rerank_model,
                "hits": result.hits
            }))
        }
        "rerank" => {
            let query = option_value(args, "--query")
                .or_else(|| option_value(args, "--q"))
                .or_else(|| positional_after(args, 2))
                .ok_or("knowledge rerank requires --query <text>")?;
            let limit = option_value(args, "--limit")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(10);
            let result = search_index(project_root, &query, limit, false, true)?;
            print_json(&serde_json::json!({
                "query": query,
                "count": result.hits.len(),
                "rerank_provider": result.rerank_provider,
                "rerank_model": result.rerank_model,
                "hits": result.hits
            }))
        }
        "promote" => {
            let query = option_value(args, "--query")
                .or_else(|| option_value(args, "--q"))
                .or_else(|| positional_after(args, 2))
                .ok_or("knowledge promote requires --query <text>")?;
            let apply = args
                .iter()
                .any(|arg| arg == "--apply" || arg == "--confirm");
            promote_knowledge(project_root, &query, apply)
        }
        "diagnose" | "doctor" => diagnose_knowledge(project_root),
        "lint" => lint_knowledge(project_root),
        "show" => {
            let page = positional_after(args, 2).ok_or("knowledge show requires <wiki/path>")?;
            show_knowledge(project_root, &page)
        }
        "save-query" => run_save_wiki(project_root, args, "query"),
        "ingest" => run_save_wiki(project_root, args, "source"),
        "formula" => match args.get(2).map(String::as_str).unwrap_or("help") {
            "draft" => run_formula_draft(project_root, args),
            _ => Err("knowledge formula: expected draft".to_string()),
        },
        "graph" => match args.get(2).map(String::as_str).unwrap_or("report") {
            "refresh" | "build" | "update" => {
                let enrich = args.iter().any(|arg| arg == "--enrich" || arg == "--with-llm")
                    && !args.iter().any(|arg| arg == "--quick");
                match emb_agent_core::knowledge::graph::refresh_graph_with_enrichment(project_root, enrich) {
                    Ok(g) => {
                        println!("{}", serde_json::to_string_pretty(&serde_json::json!({"status":"ok","native":true,"enriched":enrich,"nodes":g.stats.nodes,"edges":g.stats.edges})).unwrap_or_default());
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }
            "report" => match emb_agent_core::knowledge::graph::graph_report(project_root) {
                Ok(r) => {
                    println!("{r}");
                    Ok(())
                }
                Err(e) => Err(e),
            },
            "lint" => lint_graph(project_root),
            "path" => run_graph_path(project_root, args),
            "query" => {
                let q = option_value(args, "--q")
                    .or_else(|| option_value(args, "--query"))
                    .or_else(|| positional_after(args, 3))
                    .ok_or("graph query requires <term> or --q <term>")?;
                let r = emb_agent_core::knowledge::graph::query_graph(project_root, &q)?;
                println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
                Ok(())
            }
            "explain" => {
                let n = option_value(args, "--id")
                    .or_else(|| option_value(args, "--node"))
                    .or_else(|| positional_after(args, 3))
                    .ok_or("graph explain requires <node-id> or --id <node-id>")?;
                let r = emb_agent_core::knowledge::graph::explain_graph(project_root, &n)?;
                println!("{}", serde_json::to_string_pretty(&r).unwrap_or_default());
                Ok(())
            }
            _ => Err("knowledge graph: expected refresh|report|query|explain|path|lint".to_string()),
        },
        "wiki" => match emb_agent_core::knowledge::graph::wiki_list(project_root) {
            Ok(p) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(
                        &serde_json::json!({"wiki_pages":p.len(),"pages":p})
                    )
                    .unwrap_or_default()
                );
                Ok(())
            }
            Err(e) => Err(e),
        },
        "ask" => run_ask(project_root, args),
        "extract" => run_extract(project_root, args),
        "align" => run_align(project_root, args),
        _ => Err("knowledge: expected init|index|search|rerank|promote|diagnose|lint|show|save-query|ingest|formula|graph|wiki|ask|extract|align".to_string()),
    }
}

fn print_json(value: &Value) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).map_err(|e| e.to_string())?
    );
    Ok(())
}

fn init_knowledge(project_root: &Path) -> Result<(), String> {
    let ext = project_root.join(".emb-agent");
    if !ext.exists() {
        return Err(
            "knowledge init requires an initialized .emb-agent project; run `init` first"
                .to_string(),
        );
    }
    let created = ensure_knowledge_dirs(project_root)?;
    let index_path = ext.join("wiki").join("index.md");
    if !index_path.exists() {
        fs::write(
            &index_path,
            format!(
                "---\ntitle: \"Knowledge Index\"\nkind: index\ndate: \"{}\"\nreferences: []\ntags: []\n---\n\n# Knowledge Index\n\n## Pages\n\n- sources/\n- chips/\n- decisions/\n- risks/\n- queries/\n",
                today()
            ),
        )
        .map_err(|e| format!("write {}: {e}", index_path.display()))?;
    }
    print_json(&serde_json::json!({
        "status": "ok",
        "created_dirs": created,
        "index": rel_path(project_root, &index_path)
    }))
}

fn lint_knowledge(project_root: &Path) -> Result<(), String> {
    let ext = project_root.join(".emb-agent");
    let mut issues = Vec::<Value>::new();
    if !ext.exists() {
        issues.push(lint_issue(
            "missing-project-state",
            "error",
            ".emb-agent is missing; run `init` before using knowledge commands",
            ".emb-agent",
        ));
        return print_json(&serde_json::json!({
            "status": "failed",
            "issues": issues,
            "issue_count": issues.len()
        }));
    }

    for rel in [
        "wiki",
        "wiki/sources",
        "wiki/chips",
        "wiki/decisions",
        "wiki/risks",
        "wiki/queries",
        "graph",
        "cache/knowledge",
    ] {
        if !ext.join(rel).exists() {
            issues.push(lint_issue(
                "missing-knowledge-dir",
                "warning",
                &format!("knowledge directory is missing: .emb-agent/{rel}"),
                &format!(".emb-agent/{rel}"),
            ));
        }
    }

    if !knowledge_index_path(project_root).exists() {
        issues.push(lint_issue(
            "index-missing",
            "warning",
            "knowledge index is missing; run `knowledge index`",
            ".emb-agent/cache/knowledge/index.json",
        ));
    } else if index_is_stale(project_root) {
        issues.push(lint_issue(
            "index-stale",
            "warning",
            "knowledge index is stale; run `knowledge index --rebuild`",
            ".emb-agent/cache/knowledge/index.json",
        ));
    }

    let graph_path = ext.join("graph").join("graph.json");
    if !graph_path.exists() {
        issues.push(lint_issue(
            "graph-missing",
            "warning",
            "knowledge graph is missing; run `knowledge graph refresh`",
            ".emb-agent/graph/graph.json",
        ));
    } else if graph_is_stale(project_root, &graph_path) {
        issues.push(lint_issue(
            "graph-stale",
            "warning",
            "knowledge graph is older than one or more graph inputs; run `knowledge graph refresh`",
            ".emb-agent/graph/graph.json",
        ));
    }

    for page in wiki_markdown_paths(project_root) {
        let rel = rel_path(project_root, &page);
        if let Ok(text) = fs::read_to_string(&page) {
            if !text.trim_start().starts_with("---") {
                issues.push(lint_issue(
                    "wiki-frontmatter-missing",
                    "warning",
                    "wiki page has no frontmatter",
                    &rel,
                ));
            }
            if text.contains("FILL") || text.contains("[[FILL") {
                issues.push(lint_issue(
                    "wiki-placeholder",
                    "warning",
                    "wiki page still contains template placeholders",
                    &rel,
                ));
            }
        }
    }

    if let Some(model) = hw_model(project_root) {
        let chip_slug = slugify(&model);
        let chip_page = ext
            .join("wiki")
            .join("chips")
            .join(format!("{chip_slug}.md"));
        if !chip_page.exists() {
            issues.push(lint_issue(
                "chip-wiki-missing",
                "info",
                &format!("hw.yaml names MCU `{model}` but no matching chip wiki page exists"),
                &format!(".emb-agent/wiki/chips/{chip_slug}.md"),
            ));
        }
    }

    print_json(&serde_json::json!({
        "status": if issues.iter().any(|i| i.get("severity").and_then(Value::as_str) == Some("error")) {
            "failed"
        } else if issues.is_empty() {
            "ok"
        } else {
            "warning"
        },
        "issue_count": issues.len(),
        "issues": issues
    }))
}

fn show_knowledge(project_root: &Path, page: &str) -> Result<(), String> {
    let path = resolve_wiki_page_path(project_root, page)?;
    let content = fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    print_json(&serde_json::json!({
        "status": "ok",
        "path": rel_path(project_root, &path),
        "bytes": content.len(),
        "content": content
    }))
}

fn run_save_wiki(project_root: &Path, args: &[String], default_kind: &str) -> Result<(), String> {
    let title = option_value(args, "--title")
        .or_else(|| positional_after(args, 2))
        .ok_or("knowledge save-query/ingest requires a title")?;
    let requested_kind = option_value(args, "--kind").unwrap_or_else(|| default_kind.to_string());
    let kind = normalize_wiki_kind(&requested_kind);
    let summary = option_value(args, "--summary").unwrap_or_default();
    let body = option_value(args, "--body").unwrap_or_default();
    let link = option_value(args, "--link").unwrap_or_default();
    let apply = args
        .iter()
        .any(|arg| arg == "--apply" || arg == "--confirm");
    let force = args.iter().any(|arg| arg == "--force");
    ensure_knowledge_dirs(project_root)?;

    let dir = wiki_kind_dir(project_root, &kind);
    let slug = slugify(&title);
    let target = dir.join(format!("{slug}.md"));
    if target.exists() && apply && !force {
        return Err(format!(
            "{} already exists; pass --force to overwrite",
            rel_path(project_root, &target)
        ));
    }
    let content = render_wiki_page(&title, &kind, &summary, &body, &link);
    if apply {
        fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        fs::write(&target, &content).map_err(|e| format!("write {}: {e}", target.display()))?;
    }

    print_json(&serde_json::json!({
        "status": if apply { "applied" } else { "dry-run" },
        "kind": kind,
        "title": title,
        "target": rel_path(project_root, &target),
        "preview": content
    }))
}

fn run_formula_draft(project_root: &Path, args: &[String]) -> Result<(), String> {
    let source = option_value(args, "--from-tool-output")
        .or_else(|| option_value(args, "--file"))
        .ok_or("knowledge formula draft requires --from-tool-output <file>")?;
    let source_path = resolve_relative_project_path(project_root, &source);
    let text = fs::read_to_string(&source_path)
        .map_err(|e| format!("read {}: {e}", source_path.display()))?;
    let chip = option_value(args, "--chip").unwrap_or_default();
    let apply = args
        .iter()
        .any(|arg| arg == "--apply" || arg == "--confirm");
    let force = args.iter().any(|arg| arg == "--force");
    let formulas = formula_candidates(&text);
    let registers = register_candidates(&text);
    let slug_base = if chip.trim().is_empty() {
        source_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("formula")
            .to_string()
    } else {
        format!(
            "{}-{}",
            chip,
            source_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("formula")
        )
    };
    let target = project_root
        .join(".emb-agent")
        .join("formulas")
        .join(format!("{}.json", slugify(&slug_base)));
    if target.exists() && apply && !force {
        return Err(format!(
            "{} already exists; pass --force to overwrite",
            rel_path(project_root, &target)
        ));
    }
    let registry = serde_json::json!({
        "version": 1,
        "status": "draft",
        "chip": chip,
        "source": rel_path(project_root, &source_path),
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "formulas": formulas.iter().enumerate().map(|(i, expression)| {
            serde_json::json!({
                "id": format!("formula-{}", i + 1),
                "expression": expression,
                "variables": formula_variables(expression),
                "registers": registers,
                "evidence": [{
                    "path": rel_path(project_root, &source_path),
                    "kind": "tool-output"
                }]
            })
        }).collect::<Vec<_>>()
    });
    if apply {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        fs::write(
            &target,
            serde_json::to_string_pretty(&registry).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("write {}: {e}", target.display()))?;
    }
    print_json(&serde_json::json!({
        "status": if apply { "applied" } else { "dry-run" },
        "target": rel_path(project_root, &target),
        "formula_count": formulas.len(),
        "register_count": registers.len(),
        "registry": registry
    }))
}

fn lint_graph(project_root: &Path) -> Result<(), String> {
    let graph_path = project_root
        .join(".emb-agent")
        .join("graph")
        .join("graph.json");
    let mut issues = Vec::<Value>::new();
    let graph = match emb_agent_core::knowledge::graph::load_graph(project_root) {
        Ok(graph) => graph,
        Err(e) => {
            issues.push(lint_issue(
                "graph-missing",
                "error",
                &e,
                ".emb-agent/graph/graph.json",
            ));
            return print_json(&serde_json::json!({
                "status": "failed",
                "issue_count": issues.len(),
                "issues": issues
            }));
        }
    };

    let mut ids = HashSet::new();
    let mut duplicates = HashSet::new();
    for node in &graph.nodes {
        if !ids.insert(node.id.clone()) {
            duplicates.insert(node.id.clone());
        }
    }
    for duplicate in duplicates {
        issues.push(lint_issue(
            "duplicate-node",
            "warning",
            &format!("duplicate graph node id: {duplicate}"),
            &duplicate,
        ));
    }
    for edge in &graph.edges {
        if !ids.contains(&edge.from) {
            issues.push(lint_issue(
                "dangling-edge",
                "warning",
                &format!("edge source does not exist: {}", edge.from),
                &edge.from,
            ));
        }
        if !ids.contains(&edge.to) {
            issues.push(lint_issue(
                "dangling-edge",
                "warning",
                &format!("edge target does not exist: {}", edge.to),
                &edge.to,
            ));
        }
        if edge.edge_type.trim().is_empty() {
            issues.push(lint_issue(
                "ambiguous-edge",
                "warning",
                "edge has empty relationship type",
                &format!("{} -> {}", edge.from, edge.to),
            ));
        }
        if edge.basis.trim().is_empty() {
            issues.push(lint_issue(
                "missing-edge-basis",
                "info",
                "edge has no provenance basis",
                &format!("{} -> {}", edge.from, edge.to),
            ));
        }
    }
    if graph_is_stale(project_root, &graph_path) {
        issues.push(lint_issue(
            "graph-stale",
            "warning",
            "knowledge graph is older than one or more graph inputs; run `knowledge graph refresh`",
            ".emb-agent/graph/graph.json",
        ));
    }

    print_json(&serde_json::json!({
        "status": if issues.iter().any(|i| i.get("severity").and_then(Value::as_str) == Some("error")) {
            "failed"
        } else if issues.is_empty() {
            "ok"
        } else {
            "warning"
        },
        "nodes": graph.nodes.len(),
        "edges": graph.edges.len(),
        "issue_count": issues.len(),
        "issues": issues
    }))
}

fn run_graph_path(project_root: &Path, args: &[String]) -> Result<(), String> {
    let positionals = positional_values(args, 3);
    let from = option_value(args, "--from")
        .or_else(|| positionals.first().cloned())
        .ok_or("knowledge graph path requires <from> <to> or --from/--to")?;
    let to = option_value(args, "--to")
        .or_else(|| positionals.get(1).cloned())
        .ok_or("knowledge graph path requires <from> <to> or --from/--to")?;
    let max_depth = option_value(args, "--max-depth")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(6);
    let graph = emb_agent_core::knowledge::graph::load_graph(project_root)?;
    let result = graph_path(&graph, &from, &to, max_depth);
    print_json(&result)
}

fn ensure_knowledge_dirs(project_root: &Path) -> Result<Vec<String>, String> {
    let ext = project_root.join(".emb-agent");
    let mut created = Vec::new();
    for rel in [
        "wiki",
        "wiki/sources",
        "wiki/chips",
        "wiki/decisions",
        "wiki/risks",
        "wiki/queries",
        "wiki/promoted",
        "wiki/peripherals",
        "wiki/boards",
        "graph",
        "cache/knowledge",
        "formulas",
    ] {
        let path = ext.join(rel);
        let existed = path.exists();
        fs::create_dir_all(&path).map_err(|e| format!("create {}: {e}", path.display()))?;
        if !existed {
            created.push(format!(".emb-agent/{rel}"));
        }
    }
    Ok(created)
}

fn today() -> String {
    chrono::Utc::now().date_naive().to_string()
}

fn lint_issue(code: &str, severity: &str, message: &str, path: &str) -> Value {
    serde_json::json!({
        "code": code,
        "severity": severity,
        "message": message,
        "path": path
    })
}

fn index_is_stale(project_root: &Path) -> bool {
    let Ok(text) = fs::read_to_string(knowledge_index_path(project_root)) else {
        return true;
    };
    let Ok(index) = serde_json::from_str::<KnowledgeIndex>(&text) else {
        return true;
    };
    index.version != KNOWLEDGE_INDEX_VERSION
        || index.manifest != source_manifest(&collect_knowledge_docs(project_root))
}

fn graph_is_stale(project_root: &Path, graph_path: &Path) -> bool {
    let Some(graph_ms) = modified_ms(graph_path) else {
        return true;
    };
    latest_graph_input_mtime(project_root).is_some_and(|input_ms| input_ms > graph_ms)
}

fn latest_graph_input_mtime(project_root: &Path) -> Option<u128> {
    let ext = project_root.join(".emb-agent");
    [
        ext.join("hw.yaml"),
        ext.join("req.yaml"),
        ext.join("wiki"),
        ext.join("compound"),
        ext.join("tasks"),
        ext.join("cache").join("docs"),
        ext.join("cache").join("schematics"),
        ext.join("formulas"),
        project_root.join("docs").join("prd"),
    ]
    .iter()
    .filter_map(|path| max_mtime_ms(path))
    .max()
}

fn max_mtime_ms(path: &Path) -> Option<u128> {
    if path.is_file() {
        return modified_ms(path);
    }
    let mut latest = modified_ms(path);
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            latest = latest.max(max_mtime_ms(&entry.path()));
        }
    }
    latest
}

fn modified_ms(path: &Path) -> Option<u128> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis())
}

fn wiki_markdown_paths(project_root: &Path) -> Vec<PathBuf> {
    walk_files(&project_root.join(".emb-agent").join("wiki"))
        .into_iter()
        .filter(|path| path.extension().and_then(|s| s.to_str()) == Some("md"))
        .collect()
}

fn hw_model(project_root: &Path) -> Option<String> {
    let text = fs::read_to_string(project_root.join(".emb-agent").join("hw.yaml")).ok()?;
    for line in text.lines() {
        let trimmed = line.trim();
        let Some(raw) = trimmed.strip_prefix("model:") else {
            continue;
        };
        let value = raw.trim().trim_matches(['"', '\'']).to_string();
        if !value.is_empty() && !value.contains("{{") {
            return Some(value);
        }
    }
    None
}

fn resolve_wiki_page_path(project_root: &Path, page: &str) -> Result<PathBuf, String> {
    let mut rel = page.trim().replace('\\', "/");
    for prefix in [".emb-agent/wiki/", "wiki/"] {
        if let Some(stripped) = rel.strip_prefix(prefix) {
            rel = stripped.to_string();
        }
    }
    if rel.trim().is_empty() {
        return Err("wiki path is empty".to_string());
    }
    let mut path = PathBuf::from(&rel);
    if path.extension().is_none() {
        path.set_extension("md");
    }
    if !is_safe_relative_path(&path) {
        return Err(format!("unsafe wiki path: {page}"));
    }
    Ok(project_root.join(".emb-agent").join("wiki").join(path))
}

fn is_safe_relative_path(path: &Path) -> bool {
    !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn normalize_wiki_kind(kind: &str) -> String {
    match kind.trim().to_ascii_lowercase().as_str() {
        "source" | "datasheet" | "manual" | "schematic" => "source".to_string(),
        "query" | "qa" | "q&a" => "query".to_string(),
        "decision" | "decide" => "decision".to_string(),
        "risk" => "risk".to_string(),
        "chip" | "mcu" => "chip".to_string(),
        "peripheral" => "peripheral".to_string(),
        "board" => "board".to_string(),
        "domain" | "domain-knowledge" => "domain-knowledge".to_string(),
        "" => "source".to_string(),
        other => other.to_string(),
    }
}

fn wiki_kind_dir(project_root: &Path, kind: &str) -> PathBuf {
    let wiki = project_root.join(".emb-agent").join("wiki");
    match kind {
        "source" => wiki.join("sources"),
        "query" => wiki.join("queries"),
        "decision" => wiki.join("decisions"),
        "risk" => wiki.join("risks"),
        "chip" => wiki.join("chips"),
        "peripheral" => wiki.join("peripherals"),
        "board" => wiki.join("boards"),
        _ => wiki,
    }
}

fn render_wiki_page(title: &str, kind: &str, summary: &str, body: &str, link: &str) -> String {
    let references = if link.trim().is_empty() {
        "references: []".to_string()
    } else {
        format!("references:\n  - {}", yaml_string(link))
    };
    let summary = if summary.trim().is_empty() {
        "Review and refine this draft before treating it as authoritative."
    } else {
        summary.trim()
    };
    let body = if body.trim().is_empty() {
        "- Evidence and rationale still need review."
    } else {
        body.trim()
    };
    format!(
        "---\ntitle: {}\nkind: {}\ndate: \"{}\"\nstatus: draft\n{}\ntags: []\n---\n\n# {}\n\n## Summary\n\n{}\n\n## Notes\n\n{}\n",
        yaml_string(title),
        yaml_string(kind),
        today(),
        references,
        title,
        summary,
        body
    )
}

fn yaml_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn formula_candidates(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for line in text.lines().map(str::trim) {
        if line.len() < 5 || line.len() > 220 || !line.contains('=') {
            continue;
        }
        if !line
            .chars()
            .any(|ch| matches!(ch, '+' | '-' | '*' | '/' | '×' | '÷' | '%' | '<' | '>'))
        {
            continue;
        }
        let normalized = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if seen.insert(normalized.clone()) {
            out.push(normalized);
        }
    }
    out.truncate(40);
    out
}

fn register_candidates(text: &str) -> Vec<String> {
    let mut counts = BTreeMap::<String, usize>::new();
    for token in text.split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_') {
        let token = token.trim();
        if token.len() < 2 || token.len() > 32 {
            continue;
        }
        let has_upper = token.chars().any(|ch| ch.is_ascii_uppercase());
        let has_digit = token.chars().any(|ch| ch.is_ascii_digit());
        if has_upper && (has_digit || token.chars().all(|ch| ch.is_ascii_uppercase() || ch == '_'))
        {
            *counts.entry(token.to_string()).or_default() += 1;
        }
    }
    let mut rows = counts.into_iter().collect::<Vec<_>>();
    rows.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    rows.into_iter().take(40).map(|(token, _)| token).collect()
}

fn formula_variables(expression: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for token in expression.split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_') {
        let token = token.trim();
        if token.len() < 2 || token.chars().all(|ch| ch.is_ascii_digit()) {
            continue;
        }
        if seen.insert(token.to_string()) {
            out.push(token.to_string());
        }
    }
    out
}

fn positional_values(args: &[String], start: usize) -> Vec<String> {
    let mut values = Vec::new();
    let mut i = start;
    while i < args.len() {
        let token = &args[i];
        if token.starts_with("--") {
            i += if local_option_takes_value(token) {
                2
            } else {
                1
            };
        } else {
            values.push(token.clone());
            i += 1;
        }
    }
    values
}

fn local_option_takes_value(name: &str) -> bool {
    !matches!(
        name,
        "--json"
            | "--brief"
            | "--confirm"
            | "--force"
            | "--apply"
            | "--answer"
            | "--rerank"
            | "--refresh"
            | "--rebuild"
            | "--enrich"
            | "--with-llm"
            | "--quick"
    )
}

fn graph_path(
    graph: &emb_agent_core::knowledge::graph::KnowledgeGraph,
    from: &str,
    to: &str,
    max_depth: usize,
) -> Value {
    let Some(start) = resolve_graph_node_id(graph, from) else {
        return serde_json::json!({
            "status": "not-found",
            "reason": "from node not found",
            "from": from,
            "to": to
        });
    };
    let Some(goal) = resolve_graph_node_id(graph, to) else {
        return serde_json::json!({
            "status": "not-found",
            "reason": "to node not found",
            "from": from,
            "to": to,
            "resolved_from": start
        });
    };
    if start == goal {
        return serde_json::json!({
            "status": "found",
            "from": from,
            "to": to,
            "resolved_from": start,
            "resolved_to": goal,
            "depth": 0,
            "nodes": [start],
            "edges": []
        });
    }

    let mut queue = VecDeque::new();
    let mut visited = HashSet::new();
    let mut parent: HashMap<String, (String, usize)> = HashMap::new();
    queue.push_back((start.clone(), 0usize));
    visited.insert(start.clone());

    while let Some((node, depth)) = queue.pop_front() {
        if depth >= max_depth {
            continue;
        }
        for (edge_idx, edge) in graph.edges.iter().enumerate() {
            let next = if edge.from == node {
                Some(edge.to.clone())
            } else if edge.to == node {
                Some(edge.from.clone())
            } else {
                None
            };
            let Some(next) = next else {
                continue;
            };
            if !visited.insert(next.clone()) {
                continue;
            }
            parent.insert(next.clone(), (node.clone(), edge_idx));
            if next == goal {
                return render_graph_path(graph, from, to, &start, &goal, &parent);
            }
            queue.push_back((next, depth + 1));
        }
    }

    serde_json::json!({
        "status": "not-found",
        "reason": "no path within max depth",
        "from": from,
        "to": to,
        "resolved_from": start,
        "resolved_to": goal,
        "max_depth": max_depth,
        "visited": visited.len()
    })
}

fn resolve_graph_node_id(
    graph: &emb_agent_core::knowledge::graph::KnowledgeGraph,
    value: &str,
) -> Option<String> {
    if graph.nodes.iter().any(|node| node.id == value) {
        return Some(value.to_string());
    }
    graph
        .nodes
        .iter()
        .find(|node| node.label == value)
        .map(|node| node.id.clone())
}

fn render_graph_path(
    graph: &emb_agent_core::knowledge::graph::KnowledgeGraph,
    from: &str,
    to: &str,
    start: &str,
    goal: &str,
    parent: &HashMap<String, (String, usize)>,
) -> Value {
    let mut nodes = vec![goal.to_string()];
    let mut edges = Vec::new();
    let mut current = goal.to_string();
    while current != start {
        let Some((previous, edge_idx)) = parent.get(&current) else {
            break;
        };
        if let Some(edge) = graph.edges.get(*edge_idx) {
            edges.push(serde_json::json!({
                "from": edge.from,
                "to": edge.to,
                "type": edge.edge_type,
                "label": edge.label,
                "basis": edge.basis,
                "confidence": edge.confidence
            }));
        }
        current = previous.clone();
        nodes.push(current.clone());
    }
    nodes.reverse();
    edges.reverse();
    serde_json::json!({
        "status": "found",
        "from": from,
        "to": to,
        "resolved_from": start,
        "resolved_to": goal,
        "depth": edges.len(),
        "nodes": nodes,
        "edges": edges
    })
}

fn knowledge_index_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".emb-agent")
        .join("cache")
        .join("knowledge")
        .join("index.json")
}

fn knowledge_embedding_cache_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".emb-agent")
        .join("cache")
        .join("knowledge")
        .join("embeddings.json")
}

fn knowledge_manifest_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".emb-agent")
        .join("cache")
        .join("knowledge")
        .join("manifest.json")
}

fn load_or_build_index(project_root: &Path, force: bool) -> Result<KnowledgeIndex, String> {
    if !force {
        let path = knowledge_index_path(project_root);
        if let Ok(text) = fs::read_to_string(&path)
            && let Ok(index) = serde_json::from_str::<KnowledgeIndex>(&text)
            && index.version == KNOWLEDGE_INDEX_VERSION
            && index.manifest == source_manifest(&collect_knowledge_docs(project_root))
        {
            return Ok(index);
        }
    }
    build_and_save_index(project_root)
}

fn build_and_save_index(project_root: &Path) -> Result<KnowledgeIndex, String> {
    let cfg = embedding_config(project_root);
    let docs = collect_knowledge_docs(project_root);
    let manifest = source_manifest(&docs);
    let mut cache = load_embedding_cache(project_root, &cfg);
    let chunks = docs
        .into_iter()
        .flat_map(split_knowledge_doc)
        .map(|chunk| {
            let summary_text = chunk.text.chars().take(8_000).collect::<String>();
            let vector = cached_embedding_vector(&cfg, &mut cache, &summary_text);
            KnowledgeChunk {
                id: chunk.id,
                source_type: chunk.source_type,
                path: chunk.path,
                title: chunk.title,
                keywords: keywords(&chunk.text),
                vector,
                evidence: chunk.evidence,
                text: chunk.text,
            }
        })
        .collect::<Vec<_>>();
    let index = KnowledgeIndex {
        version: KNOWLEDGE_INDEX_VERSION,
        generated_ms: now_ms(),
        embedding_provider: cfg.effective_provider(),
        embedding_model: cfg.effective_model(),
        manifest,
        chunks,
    };
    let path = knowledge_index_path(project_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(&index).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("write {}: {e}", path.display()))?;
    save_embedding_cache(project_root, &cache)?;
    fs::write(
        knowledge_manifest_path(project_root),
        serde_json::to_string_pretty(&index.manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("write manifest: {e}"))?;
    Ok(index)
}

fn search_index(
    project_root: &Path,
    query: &str,
    limit: usize,
    force: bool,
    rerank: bool,
) -> Result<KnowledgeSearchResult, String> {
    let index = load_or_build_index(project_root, force)?;
    let cfg = embedding_config(project_root);
    let mut cache = load_embedding_cache(project_root, &cfg);
    let query_vector = cached_embedding_vector(&cfg, &mut cache, query);
    let _ = save_embedding_cache(project_root, &cache);
    let mut hits = index
        .chunks
        .iter()
        .map(|chunk| {
            let semantic = cosine_similarity(&chunk.vector, &query_vector);
            let lexical = lexical_score(&chunk.text, query) as f32;
            KnowledgeHit {
                id: chunk.id.clone(),
                source_type: chunk.source_type.clone(),
                path: chunk.path.clone(),
                title: chunk.title.clone(),
                score: semantic + lexical,
                rerank_score: None,
                keywords: chunk.keywords.clone(),
                evidence: chunk.evidence.clone(),
                preview: preview(&chunk.text, query),
            }
        })
        .filter(|hit| hit.score > 0.0)
        .collect::<Vec<_>>();
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
    if hits.len() > limit.saturating_mul(3).max(limit) {
        hits.truncate(limit.saturating_mul(3).max(limit));
    }
    let (rerank_provider, rerank_model) = if rerank {
        apply_rerank(project_root, query, &mut hits)
    } else {
        ("none".to_string(), "none".to_string())
    };
    hits.sort_by(|a, b| {
        b.rerank_score
            .unwrap_or(b.score)
            .partial_cmp(&a.rerank_score.unwrap_or(a.score))
            .unwrap_or(Ordering::Equal)
    });
    if hits.len() > limit {
        hits.truncate(limit);
    }
    Ok(KnowledgeSearchResult {
        hits,
        rerank_provider,
        rerank_model,
    })
}

fn diagnose_knowledge(project_root: &Path) -> Result<(), String> {
    let docs = collect_knowledge_docs(project_root);
    let manifest = source_manifest(&docs);
    let index = fs::read_to_string(knowledge_index_path(project_root))
        .ok()
        .and_then(|text| serde_json::from_str::<KnowledgeIndex>(&text).ok());
    let cache = fs::read_to_string(knowledge_embedding_cache_path(project_root))
        .ok()
        .and_then(|text| serde_json::from_str::<KnowledgeEmbeddingCache>(&text).ok());
    let stale = index
        .as_ref()
        .map(|index| index.version != KNOWLEDGE_INDEX_VERSION || index.manifest != manifest)
        .unwrap_or(true);
    let source_counts = docs
        .iter()
        .fold(BTreeMap::<String, usize>::new(), |mut counts, doc| {
            *counts.entry(doc.source_type.clone()).or_default() += 1;
            counts
        });
    print_json(&serde_json::json!({
        "status": if stale { "stale" } else { "ok" },
        "index_version": index.as_ref().map(|idx| idx.version).unwrap_or(0),
        "expected_version": KNOWLEDGE_INDEX_VERSION,
        "sources": manifest.len(),
        "source_counts": source_counts,
        "chunks": index.as_ref().map(|idx| idx.chunks.len()).unwrap_or(0),
        "embedding_provider": index.as_ref().map(|idx| idx.embedding_provider.as_str()).unwrap_or("none"),
        "embedding_model": index.as_ref().map(|idx| idx.embedding_model.as_str()).unwrap_or("none"),
        "embedding_cache_vectors": cache.as_ref().map(|cache| cache.vectors.len()).unwrap_or(0),
        "stale": stale,
        "index_path": knowledge_index_path(project_root),
        "manifest_path": knowledge_manifest_path(project_root),
        "embedding_cache_path": knowledge_embedding_cache_path(project_root)
    }))
}

fn promote_knowledge(project_root: &Path, query: &str, apply: bool) -> Result<(), String> {
    let result = search_index(project_root, query, 5, false, true)?;
    let slug = slugify(query);
    let target = project_root
        .join(".emb-agent")
        .join("wiki")
        .join("promoted")
        .join(format!("{slug}.md"));
    let mut body = String::new();
    body.push_str(&format!("# {query}\n\n"));
    body.push_str("## Summary\n\nReview and refine this promoted knowledge draft before treating it as authoritative.\n\n");
    body.push_str("## Evidence\n\n");
    for hit in &result.hits {
        body.push_str(&format!(
            "- `{}` `{}` score={:.3} rerank={:.3} lines {}-{} pages {}-{}\n",
            hit.source_type,
            hit.path,
            hit.score,
            hit.rerank_score.unwrap_or(hit.score),
            hit.evidence.line_start,
            hit.evidence.line_end,
            hit.evidence
                .page_start
                .map(|v| v.to_string())
                .unwrap_or_else(|| "?".to_string()),
            hit.evidence
                .page_end
                .map(|v| v.to_string())
                .unwrap_or_else(|| "?".to_string())
        ));
    }
    body.push_str("\n## Draft Notes\n\n");
    for hit in &result.hits {
        body.push_str(&format!("- {}\n", hit.preview.replace('\n', " ")));
    }
    if apply {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        fs::write(&target, &body).map_err(|e| format!("write {}: {e}", target.display()))?;
    }
    print_json(&serde_json::json!({
        "status": if apply { "applied" } else { "dry-run" },
        "target": target,
        "query": query,
        "rerank_provider": result.rerank_provider,
        "hits": result.hits,
        "preview": body
    }))
}

fn slugify(value: &str) -> String {
    let slug = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        format!("knowledge-{}", now_ms())
    } else {
        slug.chars().take(80).collect()
    }
}

#[derive(Clone, Debug)]
struct KnowledgeDoc {
    source_type: String,
    path: String,
    title: String,
    text: String,
    evidence: KnowledgeEvidence,
}

#[derive(Clone, Debug)]
struct RawKnowledgeChunk {
    id: String,
    source_type: String,
    path: String,
    title: String,
    text: String,
    evidence: KnowledgeEvidence,
}

fn split_knowledge_doc(doc: KnowledgeDoc) -> Vec<RawKnowledgeChunk> {
    let chars = doc.text.chars().collect::<Vec<_>>();
    if chars.len() <= KNOWLEDGE_CHUNK_CHARS {
        return vec![raw_knowledge_chunk(
            &doc.source_type,
            &doc.path,
            &doc.title,
            doc.text,
            0,
            doc.evidence,
        )];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    let mut ordinal = 0;
    let mut line_start = doc.evidence.line_start.max(1);
    while start < chars.len() {
        let mut end = (start + KNOWLEDGE_CHUNK_CHARS).min(chars.len());
        if end < chars.len()
            && let Some(split_at) = chars[start..end]
                .iter()
                .rposition(|c| *c == '\n' || *c == '。' || *c == '.')
        {
            let candidate = start + split_at + 1;
            if candidate > start + (KNOWLEDGE_CHUNK_CHARS / 2) {
                end = candidate;
            }
        }
        let chunk_text = chars[start..end].iter().collect::<String>();
        let line_count = chunk_text.matches('\n').count().max(1);
        let mut evidence = doc.evidence.clone();
        evidence.line_start = line_start;
        evidence.line_end = line_start + line_count.saturating_sub(1);
        if doc.source_type == "doc-parse" {
            evidence.page_start = Some(line_to_page(evidence.line_start));
            evidence.page_end = Some(line_to_page(evidence.line_end));
        }
        chunks.push(raw_knowledge_chunk(
            &doc.source_type,
            &doc.path,
            &doc.title,
            chunk_text,
            ordinal,
            evidence,
        ));
        ordinal += 1;
        if end >= chars.len() {
            break;
        }
        line_start += chars[start..end]
            .iter()
            .filter(|character| **character == '\n')
            .count()
            .saturating_sub(KNOWLEDGE_CHUNK_OVERLAP / 80);
        start = end.saturating_sub(KNOWLEDGE_CHUNK_OVERLAP);
    }
    chunks
}

fn line_to_page(line: usize) -> usize {
    ((line.saturating_sub(1)) / 50) + 1
}

fn raw_knowledge_chunk(
    source_type: &str,
    path: &str,
    title: &str,
    text: String,
    ordinal: usize,
    mut evidence: KnowledgeEvidence,
) -> RawKnowledgeChunk {
    let chunk_path = if ordinal == 0 {
        path.to_string()
    } else {
        format!("{path}#chunk-{ordinal}")
    };
    let chunk_title = if ordinal == 0 {
        title.to_string()
    } else {
        format!("{title} · chunk {ordinal}")
    };
    evidence.path = chunk_path.clone();
    if source_type == "doc-parse" && evidence.page_start.is_none() {
        evidence.page_start = Some(line_to_page(evidence.line_start));
        evidence.page_end = Some(line_to_page(evidence.line_end));
    }
    RawKnowledgeChunk {
        id: format!(
            "{}:{}",
            source_type,
            stable_hash(&format!("{chunk_path}:{chunk_title}"))
        ),
        source_type: source_type.to_string(),
        path: chunk_path,
        title: chunk_title,
        text,
        evidence,
    }
}

fn collect_knowledge_docs(project_root: &Path) -> Vec<KnowledgeDoc> {
    let mut docs = Vec::new();
    let ext = project_root.join(".emb-agent");
    for (source_type, rel) in [
        ("truth", "hw.yaml"),
        ("truth", "req.yaml"),
        ("attention", "attention.md"),
    ] {
        push_file_doc(&mut docs, &ext.join(rel), source_type, rel);
    }
    for root in [
        ("architecture", ext.join("ARCHITECTURE.md")),
        ("architecture", ext.join("architecture")),
        ("compound", ext.join("compound")),
        ("wiki", ext.join("wiki")),
        ("prd", project_root.join("docs").join("prd")),
    ] {
        if root.1.is_file() {
            push_file_doc(&mut docs, &root.1, root.0, ".emb-agent/ARCHITECTURE.md");
        } else {
            collect_markdown(&mut docs, &root.1, root.0, project_root);
        }
    }
    collect_cached_doc_parses(&mut docs, project_root);
    let tasks = ext.join("tasks");
    for path in walk_files(&tasks) {
        if path.file_name().and_then(|s| s.to_str()) == Some("task.json")
            && let Ok(text) = fs::read_to_string(&path)
        {
            let title = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v.get("title").and_then(Value::as_str).map(str::to_string))
                .unwrap_or_else(|| "task".to_string());
            docs.push(KnowledgeDoc {
                source_type: "task".to_string(),
                path: rel_path(project_root, &path),
                title,
                evidence: {
                    let mut evidence = default_evidence(&rel_path(project_root, &path), "task");
                    evidence.line_end = text.lines().count().max(1);
                    evidence
                },
                text,
            });
        }
    }
    docs
}

fn collect_cached_doc_parses(docs: &mut Vec<KnowledgeDoc>, project_root: &Path) {
    let docs_cache = project_root.join(".emb-agent").join("cache").join("docs");
    let index_path = docs_cache.join("index.json");
    let mut seen = BTreeMap::<String, bool>::new();
    if let Ok(text) = fs::read_to_string(&index_path)
        && let Ok(value) = serde_json::from_str::<Value>(&text)
        && let Some(items) = value.get("documents").and_then(Value::as_array)
    {
        for item in items {
            if item.get("parsed").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let Some(markdown) = item
                .pointer("/paths/markdown")
                .and_then(Value::as_str)
                .filter(|path| !path.trim().is_empty())
            else {
                continue;
            };
            let title = item
                .get("title")
                .and_then(Value::as_str)
                .or_else(|| item.pointer("/paths/source").and_then(Value::as_str))
                .unwrap_or("parsed document");
            let doc_id = item.get("doc_id").and_then(Value::as_str).unwrap_or("");
            let provider = item.get("provider").and_then(Value::as_str).unwrap_or("");
            let quality = item
                .pointer("/local_parse/quality")
                .or_else(|| item.pointer("/paths/quality"))
                .and_then(Value::as_str)
                .unwrap_or("parsed");
            let source_path = item
                .pointer("/paths/source")
                .and_then(Value::as_str)
                .unwrap_or("");
            push_cached_doc_parse(
                docs,
                project_root,
                markdown,
                title,
                &mut seen,
                CachedDocMeta {
                    doc_id: doc_id.to_string(),
                    provider: provider.to_string(),
                    quality: quality.to_string(),
                    source_path: source_path.to_string(),
                    title: Some(title.to_string()),
                },
            );
        }
    }

    for path in walk_files(&docs_cache) {
        if path.file_name().and_then(|name| name.to_str()) == Some("parse.md") {
            let rel = rel_path(project_root, &path);
            if !seen.contains_key(&rel) {
                let title = path
                    .parent()
                    .and_then(|parent| parent.file_name())
                    .and_then(|name| name.to_str())
                    .unwrap_or("parsed document");
                let meta = cached_doc_meta_from_dir(path.parent(), "", "cache", "parsed", "");
                let fallback_title = meta
                    .title
                    .clone()
                    .filter(|title| !title.trim().is_empty())
                    .unwrap_or_else(|| title.to_string());
                push_cached_doc_parse(docs, project_root, &rel, &fallback_title, &mut seen, meta);
            }
        }
    }
}

#[derive(Clone, Debug)]
struct CachedDocMeta {
    doc_id: String,
    provider: String,
    quality: String,
    source_path: String,
    title: Option<String>,
}

fn cached_doc_meta_from_dir(
    dir: Option<&Path>,
    fallback_doc_id: &str,
    fallback_provider: &str,
    fallback_quality: &str,
    fallback_source_path: &str,
) -> CachedDocMeta {
    let Some(dir) = dir else {
        return CachedDocMeta {
            doc_id: fallback_doc_id.to_string(),
            provider: fallback_provider.to_string(),
            quality: fallback_quality.to_string(),
            source_path: fallback_source_path.to_string(),
            title: None,
        };
    };
    let source = fs::read_to_string(dir.join("source.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let parse = fs::read_to_string(dir.join("parse.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());
    let fallback_doc_id = if fallback_doc_id.is_empty() {
        dir.file_name().and_then(|name| name.to_str()).unwrap_or("")
    } else {
        fallback_doc_id
    };
    CachedDocMeta {
        doc_id: source
            .as_ref()
            .and_then(|value| value.get("doc_id"))
            .and_then(Value::as_str)
            .unwrap_or(fallback_doc_id)
            .to_string(),
        provider: parse
            .as_ref()
            .and_then(|value| value.get("provider"))
            .and_then(Value::as_str)
            .or_else(|| {
                source
                    .as_ref()
                    .and_then(|value| value.get("provider"))
                    .and_then(Value::as_str)
            })
            .unwrap_or(fallback_provider)
            .to_string(),
        quality: parse
            .as_ref()
            .and_then(|value| value.get("quality"))
            .and_then(Value::as_str)
            .unwrap_or(fallback_quality)
            .to_string(),
        source_path: source
            .as_ref()
            .and_then(|value| value.get("source"))
            .and_then(Value::as_str)
            .or_else(|| {
                source
                    .as_ref()
                    .and_then(|value| value.get("source_abs"))
                    .and_then(Value::as_str)
            })
            .unwrap_or(fallback_source_path)
            .to_string(),
        title: source
            .as_ref()
            .and_then(|value| value.get("title"))
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

fn push_cached_doc_parse(
    docs: &mut Vec<KnowledgeDoc>,
    project_root: &Path,
    markdown: &str,
    title: &str,
    seen: &mut BTreeMap<String, bool>,
    meta: CachedDocMeta,
) {
    let rel = markdown.trim().replace('\\', "/");
    if seen.contains_key(&rel) {
        return;
    }
    let path = resolve_relative_project_path(project_root, &rel);
    if let Ok(text) = fs::read_to_string(&path)
        && !text.trim().is_empty()
    {
        docs.push(KnowledgeDoc {
            source_type: "doc-parse".to_string(),
            path: rel.clone(),
            title: title.to_string(),
            evidence: KnowledgeEvidence {
                path: rel.clone(),
                source_path: meta.source_path,
                doc_id: meta.doc_id,
                provider: meta.provider,
                quality: meta.quality,
                line_start: 1,
                line_end: text.lines().count().max(1),
                page_start: None,
                page_end: None,
            },
            text,
        });
        seen.insert(rel, true);
    }
}

fn resolve_relative_project_path(project_root: &Path, rel: &str) -> PathBuf {
    let path = Path::new(rel);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        project_root.join(path)
    }
}

fn collect_markdown(
    docs: &mut Vec<KnowledgeDoc>,
    root: &Path,
    source_type: &str,
    project_root: &Path,
) {
    for path in walk_files(root) {
        if path.extension().and_then(|s| s.to_str()) == Some("md") {
            let rel = rel_path(project_root, &path);
            push_file_doc(docs, &path, source_type, &rel);
        }
    }
}

fn push_file_doc(docs: &mut Vec<KnowledgeDoc>, path: &Path, source_type: &str, rel: &str) {
    if let Ok(text) = fs::read_to_string(path) {
        let title = text
            .lines()
            .find_map(|line| line.trim().strip_prefix("# ").map(str::to_string))
            .unwrap_or_else(|| {
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string()
            });
        docs.push(KnowledgeDoc {
            source_type: source_type.to_string(),
            path: rel.to_string(),
            title,
            evidence: {
                let mut evidence = default_evidence(rel, source_type);
                evidence.line_end = text.lines().count().max(1);
                evidence
            },
            text,
        });
    }
}

fn default_evidence(path: &str, source_type: &str) -> KnowledgeEvidence {
    KnowledgeEvidence {
        path: path.to_string(),
        source_path: path.to_string(),
        doc_id: String::new(),
        provider: source_type.to_string(),
        quality: "source".to_string(),
        line_start: 1,
        line_end: 1,
        page_start: None,
        page_end: None,
    }
}

fn source_manifest(docs: &[KnowledgeDoc]) -> Vec<KnowledgeSourceManifest> {
    docs.iter()
        .map(|doc| KnowledgeSourceManifest {
            source_type: doc.source_type.clone(),
            path: doc.path.clone(),
            title: doc.title.clone(),
            hash: stable_hash(&doc.text),
            bytes: doc.text.len(),
        })
        .collect()
}

fn walk_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if !root.exists() {
        return files;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return files;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            files.extend(walk_files(&path));
        } else {
            files.push(path);
        }
    }
    files
}

fn rel_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

impl EmbeddingConfig {
    fn external_enabled(&self) -> bool {
        self.provider == "openai-compatible"
            && !self.api_key.is_empty()
            && !self.api_base.is_empty()
    }

    fn effective_provider(&self) -> String {
        if self.external_enabled() {
            self.provider.clone()
        } else {
            "local-hash".to_string()
        }
    }

    fn effective_model(&self) -> String {
        if self.external_enabled() {
            self.model.clone()
        } else {
            "semantic-hash-v1".to_string()
        }
    }
}

fn embedding_config(project_root: &Path) -> EmbeddingConfig {
    EmbeddingConfig {
        provider: env_or_dotenv(project_root, "EMB_AGENT_EMBEDDING_PROVIDER")
            .unwrap_or_else(|| "local-hash".to_string())
            .to_ascii_lowercase(),
        model: env_or_dotenv(project_root, "EMB_AGENT_EMBEDDING_MODEL")
            .unwrap_or_else(|| "text-embedding-3-small".to_string()),
        api_base: env_or_dotenv(project_root, "EMB_AGENT_EMBEDDING_API_BASE").unwrap_or_default(),
        api_key: env_or_dotenv(project_root, "EMB_AGENT_EMBEDDING_API_KEY").unwrap_or_default(),
    }
}

impl RerankConfig {
    fn external_enabled(&self) -> bool {
        self.provider == "openai-compatible"
            && !self.api_key.is_empty()
            && !self.api_base.is_empty()
            && !self.model.is_empty()
    }

    fn effective_provider(&self, external_used: bool) -> String {
        if external_used {
            self.provider.clone()
        } else {
            "local-fallback".to_string()
        }
    }

    fn effective_model(&self, external_used: bool) -> String {
        if external_used {
            self.model.clone()
        } else {
            "lexical-semantic-v1".to_string()
        }
    }
}

fn rerank_config(project_root: &Path) -> RerankConfig {
    RerankConfig {
        provider: env_or_dotenv(project_root, "EMB_AGENT_RERANK_PROVIDER")
            .or_else(|| env_or_dotenv(project_root, "EMB_AGENT_EMBEDDING_PROVIDER"))
            .unwrap_or_else(|| "local".to_string())
            .to_ascii_lowercase(),
        model: env_or_dotenv(project_root, "EMB_AGENT_RERANK_MODEL").unwrap_or_default(),
        api_base: env_or_dotenv(project_root, "EMB_AGENT_RERANK_API_BASE")
            .or_else(|| env_or_dotenv(project_root, "EMB_AGENT_EMBEDDING_API_BASE"))
            .unwrap_or_default(),
        api_key: env_or_dotenv(project_root, "EMB_AGENT_RERANK_API_KEY")
            .or_else(|| env_or_dotenv(project_root, "EMB_AGENT_EMBEDDING_API_KEY"))
            .unwrap_or_default(),
    }
}

fn env_or_dotenv(project_root: &Path, key: &str) -> Option<String> {
    if let Ok(value) = std::env::var(key)
        && !value.trim().is_empty()
    {
        return Some(value);
    }
    for path in [
        project_root.join(".env"),
        project_root.join(".emb-agent").join(".env"),
    ] {
        if let Some(value) = read_dotenv_value(&path, key) {
            return Some(value);
        }
    }
    None
}

fn read_dotenv_value(path: &Path, key: &str) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim();
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        if name.trim() == key {
            return Some(unquote(value.trim()));
        }
    }
    None
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
    }
}

fn cached_embedding_vector(
    cfg: &EmbeddingConfig,
    cache: &mut KnowledgeEmbeddingCache,
    text: &str,
) -> Vec<f32> {
    let key = format!(
        "{}:{}:{}",
        cfg.effective_provider(),
        cfg.effective_model(),
        stable_hash(text)
    );
    if let Some(vector) = cache.vectors.get(&key)
        && !vector.is_empty()
    {
        return vector.clone();
    }
    let vector = embedding_vector(cfg, text);
    cache.vectors.insert(key, vector.clone());
    vector
}

fn load_embedding_cache(project_root: &Path, cfg: &EmbeddingConfig) -> KnowledgeEmbeddingCache {
    let path = knowledge_embedding_cache_path(project_root);
    if let Ok(text) = fs::read_to_string(&path)
        && let Ok(cache) = serde_json::from_str::<KnowledgeEmbeddingCache>(&text)
        && cache.version == KNOWLEDGE_EMBEDDING_CACHE_VERSION
        && cache.provider == cfg.effective_provider()
        && cache.model == cfg.effective_model()
    {
        return cache;
    }
    KnowledgeEmbeddingCache {
        version: KNOWLEDGE_EMBEDDING_CACHE_VERSION,
        provider: cfg.effective_provider(),
        model: cfg.effective_model(),
        vectors: BTreeMap::new(),
    }
}

fn save_embedding_cache(
    project_root: &Path,
    cache: &KnowledgeEmbeddingCache,
) -> Result<(), String> {
    let path = knowledge_embedding_cache_path(project_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("write {}: {e}", path.display()))
}

fn embedding_vector(cfg: &EmbeddingConfig, text: &str) -> Vec<f32> {
    if cfg.external_enabled()
        && let Some(vector) = external_embedding_vector(cfg, text)
    {
        return normalize_vector(vector);
    }
    semantic_vector(text)
}

fn external_embedding_vector(cfg: &EmbeddingConfig, text: &str) -> Option<Vec<f32>> {
    let url = format!("{}/embeddings", cfg.api_base.trim_end_matches('/'));
    let payload = serde_json::json!({"model": cfg.model, "input": text});
    let output = Command::new("curl")
        .arg("-fsS")
        .arg("--max-time")
        .arg("30")
        .arg("-H")
        .arg(format!("Authorization: Bearer {}", cfg.api_key))
        .arg("-H")
        .arg("Content-Type: application/json")
        .arg("-d")
        .arg(payload.to_string())
        .arg(url)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value: Value = serde_json::from_slice(&output.stdout).ok()?;
    value
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("embedding"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_f64().map(|f| f as f32))
                .collect::<Vec<_>>()
        })
        .filter(|vector| !vector.is_empty())
}

fn apply_rerank(project_root: &Path, query: &str, hits: &mut [KnowledgeHit]) -> (String, String) {
    let cfg = rerank_config(project_root);
    let external_used = cfg.external_enabled() && external_rerank(&cfg, query, hits);
    if !external_used {
        for hit in hits.iter_mut() {
            hit.rerank_score = Some(hit.score + lexical_score(&hit.preview, query) as f32);
        }
    }
    let chip = hw_model(project_root);
    for hit in hits.iter_mut() {
        let base = hit.rerank_score.unwrap_or(hit.score);
        hit.rerank_score = Some(base + ranking_adjustment(hit, query, chip.as_deref()));
    }
    (
        cfg.effective_provider(external_used),
        cfg.effective_model(external_used),
    )
}

fn ranking_adjustment(hit: &KnowledgeHit, query: &str, chip: Option<&str>) -> f32 {
    let query_tokens = tokenize(query);
    let hay = format!(
        "{} {} {} {}",
        hit.path, hit.title, hit.preview, hit.evidence.source_path
    )
    .to_lowercase();
    let token_hits = query_tokens
        .iter()
        .filter(|token| hay.contains(token.as_str()))
        .count();
    let mut boost = 0.0_f32;
    match hit.source_type.as_str() {
        "truth" => {
            boost += 1.0;
            if hit.path.ends_with("hw.yaml") || hit.path.ends_with("req.yaml") {
                boost += 0.5;
            }
            if hit.path.ends_with("hw.yaml") && is_board_fact_query(query) {
                boost += 8.0;
            }
            if token_hits > 0 {
                boost += 0.4;
            }
        }
        "attention" | "architecture" | "prd" | "task" | "compound" | "wiki" => {
            if token_hits > 0 {
                boost += 0.2;
            }
        }
        "doc-parse" => {
            if let Some(chip) = chip {
                if contains_chip_key(&hay, chip) {
                    boost += 0.25;
                } else if hay.contains("sc8") || hay.contains("ca51") || hay.contains("stm32") {
                    boost -= 0.45;
                }
            }
        }
        _ => {}
    }
    boost
}

fn is_board_fact_query(query: &str) -> bool {
    let q = query.to_lowercase();
    q.contains("三极管")
        || q.contains("transistor")
        || q.contains("mosfet")
        || q.contains("s8050")
        || q.contains("q1")
        || q.contains("控制输出")
        || q.contains("输出状态")
        || q.contains("output state")
        || q.contains("pin")
        || q.contains("引脚")
        || q.contains("焊盘")
}

fn contains_chip_key(hay: &str, chip: &str) -> bool {
    let chip_l = chip.trim().to_lowercase();
    if chip_l.is_empty() {
        return false;
    }
    if hay.contains(&chip_l) {
        return true;
    }
    for len in [7usize, 6usize] {
        if chip_l.len() >= len && hay.contains(&chip_l[..len]) {
            return true;
        }
    }
    false
}

fn external_rerank(cfg: &RerankConfig, query: &str, hits: &mut [KnowledgeHit]) -> bool {
    let url = format!("{}/rerank", cfg.api_base.trim_end_matches('/'));
    let documents = hits
        .iter()
        .map(|hit| hit.preview.clone())
        .collect::<Vec<_>>();
    let payload = serde_json::json!({"model": cfg.model, "query": query, "documents": documents});
    let Ok(output) = Command::new("curl")
        .arg("-fsS")
        .arg("--max-time")
        .arg("30")
        .arg("-H")
        .arg(format!("Authorization: Bearer {}", cfg.api_key))
        .arg("-H")
        .arg("Content-Type: application/json")
        .arg("-d")
        .arg(payload.to_string())
        .arg(url)
        .output()
    else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) else {
        return false;
    };
    let Some(results) = value
        .get("results")
        .or_else(|| value.get("data"))
        .and_then(Value::as_array)
    else {
        return false;
    };
    for item in results {
        let idx = item
            .get("index")
            .and_then(Value::as_u64)
            .or_else(|| item.get("document_index").and_then(Value::as_u64))
            .unwrap_or(usize::MAX as u64) as usize;
        let score = item
            .get("relevance_score")
            .and_then(Value::as_f64)
            .or_else(|| item.get("score").and_then(Value::as_f64))
            .unwrap_or(0.0) as f32;
        if let Some(hit) = hits.get_mut(idx) {
            hit.rerank_score = Some(score);
        }
    }
    hits.iter().any(|hit| hit.rerank_score.is_some())
}

fn semantic_vector(text: &str) -> Vec<f32> {
    const DIM: usize = 64;
    let mut vector = vec![0.0_f32; DIM];
    for token in tokenize(text) {
        let hash = stable_hash(&token);
        let idx = (hash as usize) % DIM;
        let sign = if hash & 1 == 0 { 1.0 } else { -1.0 };
        vector[idx] += sign;
    }
    normalize_vector(vector)
}

fn tokenize(text: &str) -> Vec<String> {
    text.split(|ch: char| !ch.is_alphanumeric() && ch != '_' && ch != '-')
        .map(|token| token.trim().to_lowercase())
        .filter(|token| token.len() >= 2)
        .collect()
}

fn keywords(text: &str) -> Vec<String> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for token in tokenize(text) {
        if token.len() >= 4 {
            *counts.entry(token).or_default() += 1;
        }
    }
    let mut rows = counts.into_iter().collect::<Vec<_>>();
    rows.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    rows.into_iter().take(16).map(|(token, _)| token).collect()
}

fn lexical_score(text: &str, query: &str) -> usize {
    let lower = text.to_lowercase();
    tokenize(query)
        .into_iter()
        .map(|token| {
            lower
                .matches(&token)
                .count()
                .max(usize::from(lower.contains(&token)))
        })
        .sum()
}

fn preview(text: &str, query: &str) -> String {
    let lower = text.to_lowercase();
    let needle = tokenize(query).into_iter().next().unwrap_or_default();
    let idx = if needle.is_empty() {
        0
    } else {
        lower.find(&needle).unwrap_or(0)
    };
    let start = text[..idx].chars().count().saturating_sub(180);
    text.chars()
        .skip(start)
        .take(540)
        .collect::<String>()
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right.iter())
        .map(|(a, b)| a * b)
        .sum::<f32>()
        .max(0.0)
}

fn normalize_vector(mut vector: Vec<f32>) -> Vec<f32> {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        for value in &mut vector {
            *value /= norm;
        }
    }
    vector
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

// === knowledge ask (unified fusion search) ================================

fn run_ask(project_root: &Path, args: &[String]) -> Result<(), String> {
    let query = option_value(args, "--query")
        .or_else(|| option_value(args, "--q"))
        .or_else(|| positional_after(args, 2))
        .ok_or("knowledge ask requires --query <text>")?;
    let limit = option_value(args, "--limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(10);
    let llm_answer = args.iter().any(|a| a == "--answer");
    let rerank = args.iter().any(|a| a == "--rerank");

    // 1. Vector hits.
    let force = args.iter().any(|a| a == "--refresh" || a == "--rebuild");
    let vector: Vec<emb_agent_core::knowledge::ask::VectorHit> =
        match search_index(project_root, &query, 20, force, rerank) {
            Ok(r) => r
                .hits
                .into_iter()
                .map(|h| emb_agent_core::knowledge::ask::VectorHit {
                    source_type: h.source_type,
                    path: h.path,
                    title: h.title,
                    score: h.score,
                    preview: h.preview,
                    page_start: h.evidence.page_start,
                    page_end: h.evidence.page_end,
                    line_start: Some(h.evidence.line_start),
                    line_end: Some(h.evidence.line_end),
                })
                .collect(),
            Err(_) => Vec::new(),
        };

    // 2. Graph hits.
    let graph: Vec<emb_agent_core::knowledge::ask::GraphHit> =
        match emb_agent_core::knowledge::graph::query_graph(project_root, &query) {
            Ok(r) => r
                .get("nodes")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .enumerate()
                        .map(|(i, n)| emb_agent_core::knowledge::ask::GraphHit {
                            node_id: n
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            node_type: n
                                .get("type")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            label: n
                                .get("label")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            summary: n
                                .get("summary")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            source: String::new(),
                            score: 1.0 - (i as f32 * 0.08),
                            reason: "graph substring match".to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        };

    // 3. Tree hits from cached PageIndex structures.
    let tree = collect_tree_hits(project_root, &query);

    let cfg = emb_agent_core::knowledge::llm::resolve_llm_config(project_root);
    let result = emb_agent_core::knowledge::ask::ask(
        project_root,
        &query,
        vector,
        graph,
        tree,
        emb_agent_core::knowledge::ask::AskOptions {
            limit,
            cfg: &cfg,
            llm_answer,
        },
    )?;
    let output = serde_json::to_string_pretty(&result).unwrap_or_default();
    println!("{output}");
    Ok(())
}

fn collect_tree_hits(
    project_root: &Path,
    query: &str,
) -> Vec<emb_agent_core::knowledge::ask::TreeHit> {
    use emb_agent_core::knowledge::ask::TreeHit;
    let index_path = project_root
        .join(".emb-agent")
        .join("cache")
        .join("docs")
        .join("index.json");
    let index: Value = match fs::read_to_string(&index_path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => return Vec::new(),
        },
        Err(_) => return Vec::new(),
    };
    let Some(entries) = index.get("documents").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut hits = Vec::new();
    for entry in entries {
        let Some(structure_rel) = entry
            .pointer("/paths/structure")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let doc_id = entry
            .get("doc_id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let structure = match emb_agent_core::lookup::load_structure(project_root, &doc_id) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let sections = emb_agent_core::lookup::collect_sections(&structure);
        for sec in sections {
            let hay = format!("{} {} {}", sec.title, sec.summary, sec.text);
            let lower = query.to_lowercase();
            if !hay.to_lowercase().contains(&lower) {
                continue;
            }
            hits.push(TreeHit {
                doc_id: doc_id.clone(),
                structure_path: structure_rel.to_string(),
                title: sec.title,
                summary: sec.summary,
                text: sec.text,
                page_start: sec.page_start,
                page_end: sec.page_end,
                line_num: sec.line_num,
            });
        }
    }
    hits.truncate(20);
    hits
}

// === knowledge extract (LLM-schema extraction) ============================

fn run_extract(project_root: &Path, args: &[String]) -> Result<(), String> {
    let _force = args.iter().any(|a| a == "--force" || a == "--rebuild");
    let cfg = emb_agent_core::knowledge::llm::resolve_llm_config(project_root);
    if !cfg.available() {
        return Err("knowledge extract requires an LLM: set EMB_AGENT_LLM_MODEL + EMB_AGENT_LLM_API_KEY (or OPENAI_API_KEY)".to_string());
    }
    // Gather sections from doc_parse nodes in the graph.
    let sections = gather_sections_for_extract(project_root)?;
    if sections.is_empty() {
        println!(
            "{}",
            serde_json::json!({
                "status": "skipped",
                "reason": "no doc_section nodes found; run `knowledge graph refresh` first"
            })
        );
        return Ok(());
    }
    let extractions =
        emb_agent_core::knowledge::extract::extract_sections(project_root, &cfg, &sections)?;
    let output = serde_json::to_string_pretty(&serde_json::json!({
        "status": "ok",
        "sections": sections.len(),
        "extractions": extractions.len(),
        "entities": extractions.iter().map(|e| e.entities.len()).sum::<usize>(),
        "model": cfg.model,
    }))
    .unwrap_or_default();
    println!("{output}");
    Ok(())
}

fn gather_sections_for_extract(
    project_root: &Path,
) -> Result<Vec<emb_agent_core::knowledge::align::SectionInput>, String> {
    let graph = emb_agent_core::knowledge::graph::load_graph(project_root)?;
    let mut sections = Vec::new();
    for node in &graph.nodes {
        if node.node_type != "doc_section" {
            continue;
        }
        let parts: Vec<&str> = node.id.splitn(3, ':').collect();
        if parts.len() < 3 {
            continue;
        }
        let doc_id = parts[1];
        let section_path = parts[2];
        let structure = emb_agent_core::lookup::load_structure(project_root, doc_id).ok();
        let (text, page_start, page_end, line_num) = structure
            .as_ref()
            .and_then(|s| {
                emb_agent_core::lookup::collect_sections(s)
                    .into_iter()
                    .find(|sec| sec.path == section_path)
            })
            .map(|sec| (sec.text, sec.page_start, sec.page_end, sec.line_num))
            .unwrap_or_default();
        if text.trim().is_empty() {
            continue;
        }
        sections.push(emb_agent_core::knowledge::align::SectionInput {
            doc_id: doc_id.to_string(),
            section_path: section_path.to_string(),
            title: node.label.clone(),
            text,
            page_start,
            page_end,
            line_num,
            source_kind: "datasheet".to_string(),
        });
    }
    Ok(sections)
}

// === knowledge align (cross-document equivalence + conflict) ===============

fn run_align(project_root: &Path, _args: &[String]) -> Result<(), String> {
    let cfg = emb_agent_core::knowledge::llm::resolve_llm_config(project_root);
    let sections = gather_sections_for_extract(project_root)?;
    if sections.is_empty() {
        println!(
            "{}",
            serde_json::json!({
                "status": "skipped",
                "reason": "no doc_section nodes"
            })
        );
        return Ok(());
    }
    let extractions =
        emb_agent_core::knowledge::extract::extract_sections(project_root, &cfg, &sections)?;
    let report = emb_agent_core::knowledge::align::align(project_root, &cfg, &extractions)?;
    let output = serde_json::to_string_pretty(&serde_json::json!({
        "status": "ok",
        "equivalences": report.equivalences.len(),
        "conflicts": report.conflicts.len(),
        "canonicals": report.canonical_counts.len(),
        "llm_used": report.llm_used,
        "equivalences_detail": report.equivalences.iter().take(20).collect::<Vec<_>>(),
        "conflicts_detail": report.conflicts.iter().take(20).collect::<Vec<_>>(),
    }))
    .unwrap_or_default();
    println!("{output}");
    Ok(())
}
