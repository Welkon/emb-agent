use super::util::{current_dir_string, option_value, positional_after};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const KNOWLEDGE_INDEX_VERSION: u32 = 2;
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
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct KnowledgeIndex {
    version: u32,
    generated_ms: u128,
    embedding_provider: String,
    embedding_model: String,
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
    preview: String,
}

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let subcmd = args.get(1).map(String::as_str).unwrap_or("help");
    let project_root = Path::new(&cwd);
    match subcmd {
        "index" => {
            let index = build_and_save_index(project_root)?;
            print_json(&serde_json::json!({
                "status": "ok",
                "index_path": knowledge_index_path(project_root),
                "chunks": index.chunks.len(),
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
        "graph" => match args.get(2).map(String::as_str).unwrap_or("report") {
            "refresh" | "build" => {
                match emb_agent_core::knowledge::graph::refresh_graph(project_root) {
                    Ok(g) => {
                        println!("{}", serde_json::to_string_pretty(&serde_json::json!({"status":"ok","native":true,"nodes":g.stats.nodes,"edges":g.stats.edges})).unwrap_or_default());
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
            _ => Err("knowledge graph: expected refresh|report|query|explain".to_string()),
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
        _ => Err("knowledge: expected index|search|rerank|graph|wiki".to_string()),
    }
}

fn print_json(value: &Value) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).map_err(|e| e.to_string())?
    );
    Ok(())
}

fn knowledge_index_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".emb-agent")
        .join("cache")
        .join("knowledge")
        .join("index.json")
}

fn load_or_build_index(project_root: &Path, force: bool) -> Result<KnowledgeIndex, String> {
    if !force {
        let path = knowledge_index_path(project_root);
        if let Ok(text) = fs::read_to_string(&path)
            && let Ok(index) = serde_json::from_str::<KnowledgeIndex>(&text)
            && index.version == KNOWLEDGE_INDEX_VERSION
        {
            return Ok(index);
        }
    }
    build_and_save_index(project_root)
}

fn build_and_save_index(project_root: &Path) -> Result<KnowledgeIndex, String> {
    let cfg = embedding_config(project_root);
    let docs = collect_knowledge_docs(project_root);
    let chunks = docs
        .into_iter()
        .flat_map(|(source_type, path, title, text)| {
            split_knowledge_doc(&source_type, &path, &title, &text)
                .into_iter()
                .map(|chunk| {
                    let summary_text = chunk.text.chars().take(8_000).collect::<String>();
                    KnowledgeChunk {
                        id: chunk.id,
                        source_type: chunk.source_type,
                        path: chunk.path,
                        title: chunk.title,
                        keywords: keywords(&chunk.text),
                        vector: embedding_vector(&cfg, &summary_text),
                        text: chunk.text,
                    }
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();
    let index = KnowledgeIndex {
        version: KNOWLEDGE_INDEX_VERSION,
        generated_ms: now_ms(),
        embedding_provider: cfg.effective_provider(),
        embedding_model: cfg.effective_model(),
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
    let query_vector = embedding_vector(&cfg, query);
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

#[derive(Clone, Debug)]
struct RawKnowledgeChunk {
    id: String,
    source_type: String,
    path: String,
    title: String,
    text: String,
}

fn split_knowledge_doc(
    source_type: &str,
    path: &str,
    title: &str,
    text: &str,
) -> Vec<RawKnowledgeChunk> {
    let chars = text.chars().collect::<Vec<_>>();
    if chars.len() <= KNOWLEDGE_CHUNK_CHARS {
        return vec![raw_knowledge_chunk(
            source_type,
            path,
            title,
            text.to_string(),
            0,
        )];
    }

    let mut chunks = Vec::new();
    let mut start = 0;
    let mut ordinal = 0;
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
        chunks.push(raw_knowledge_chunk(
            source_type,
            path,
            title,
            chunk_text,
            ordinal,
        ));
        ordinal += 1;
        if end >= chars.len() {
            break;
        }
        start = end.saturating_sub(KNOWLEDGE_CHUNK_OVERLAP);
    }
    chunks
}

fn raw_knowledge_chunk(
    source_type: &str,
    path: &str,
    title: &str,
    text: String,
    ordinal: usize,
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
    }
}

fn collect_knowledge_docs(project_root: &Path) -> Vec<(String, String, String, String)> {
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
        ("architecture", ext.join("architecture")),
        ("compound", ext.join("compound")),
        ("wiki", ext.join("wiki")),
        ("prd", project_root.join("docs").join("prd")),
    ] {
        collect_markdown(&mut docs, &root.1, root.0, project_root);
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
            docs.push((
                "task".to_string(),
                rel_path(project_root, &path),
                title,
                text,
            ));
        }
    }
    docs
}

fn collect_cached_doc_parses(
    docs: &mut Vec<(String, String, String, String)>,
    project_root: &Path,
) {
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
            push_cached_doc_parse(docs, project_root, markdown, title, &mut seen);
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
                push_cached_doc_parse(docs, project_root, &rel, title, &mut seen);
            }
        }
    }
}

fn push_cached_doc_parse(
    docs: &mut Vec<(String, String, String, String)>,
    project_root: &Path,
    markdown: &str,
    title: &str,
    seen: &mut BTreeMap<String, bool>,
) {
    let rel = markdown.trim().replace('\\', "/");
    if seen.contains_key(&rel) {
        return;
    }
    let path = resolve_relative_project_path(project_root, &rel);
    if let Ok(text) = fs::read_to_string(&path)
        && !text.trim().is_empty()
    {
        docs.push((
            "doc-parse".to_string(),
            rel.clone(),
            title.to_string(),
            text,
        ));
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
    docs: &mut Vec<(String, String, String, String)>,
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

fn push_file_doc(
    docs: &mut Vec<(String, String, String, String)>,
    path: &Path,
    source_type: &str,
    rel: &str,
) {
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
        docs.push((source_type.to_string(), rel.to_string(), title, text));
    }
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
        for hit in hits {
            hit.rerank_score = Some(hit.score + lexical_score(&hit.preview, query) as f32);
        }
    }
    (
        cfg.effective_provider(external_used),
        cfg.effective_model(external_used),
    )
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
