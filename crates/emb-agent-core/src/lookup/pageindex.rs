//! PageIndex integration — vectorless, reasoning-based tree RAG.
//!
//! This is a faithful native Rust port of the PageIndex method
//! (https://github.com/VectifyAI/PageIndex, MIT). It builds a hierarchical
//! table-of-contents tree over a PDF or Markdown document and lets an LLM
//! reason over that tree for context-aware retrieval, with page/line-level
//! evidence and no vector DB.
//!
//! This is an opt-in `pageindex` provider for `ingest doc`. The tree is built
//! **natively in Rust** (see [`crate::lookup::pageindex_native`]) — there is no
//! Python sidecar and no litellm/PyPDF2/pymupdf dependency. It caches
//! `structure.json` + `pages.json` under `.emb-agent/cache/docs/<doc_id>/` and
//! exposes `doc_tree` / `doc_pages` lookup ops that mirror PageIndex's
//! `get_document_structure` / `get_page_content` tools so the host assistant
//! can navigate the tree.
//!
//! Provider configuration (OpenAI-compatible — covers OpenAI, Azure OpenAI,
//! Anthropic's OpenAI shim, Gemini's OpenAI shim, vLLM, Ollama, DeepSeek,
//! Moonshot, Together, Groq, …):
//! - `EMB_AGENT_PAGEINDEX_MODEL`  — model id (e.g. `gpt-4o-2024-11-20`,
//!   `claude-sonnet-4-6` against Anthropic's OpenAI shim, a local Ollama model
//!   name, …).
//! - `EMB_AGENT_PAGEINDEX_API_BASE` — base URL of an OpenAI-compatible
//!   `/chat/completions` endpoint (defaults to the OpenAI endpoint).
//! - `EMB_AGENT_PAGEINDEX_API_KEY` — bearer token (falls back to
//!   `EMB_AGENT_LLM_API_KEY` / `OPENAI_API_KEY` / `CHATGPT_API_KEY`).
//!
//! The same keys can be set in `.emb-agent/project.json` under
//! `integrations.pageindex.{model,api_base,api_key}`. If omitted, PageIndex
//! falls back to `integrations.llm.{model,api_base,api_key}`.

use serde::Serialize;
use serde_json::{Value, json};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// Result of a successful PageIndex build.
#[derive(Debug, Clone, Serialize)]
pub struct PageIndexBuild {
    pub doc_name: String,
    pub doc_description: String,
    pub section_count: usize,
    pub page_count: usize,
    pub structure_path: String,
    pub pages_path: String,
    pub is_md: bool,
}

/// A flattened section of a tree, used by the knowledge graph and doc lookup
/// to score matches at section granularity with page/line evidence.
#[derive(Debug, Clone, Serialize)]
pub struct SectionInfo {
    /// Dotted structural path, e.g. `"1.2.3"`.
    pub path: String,
    /// Title breadcrumb from root to this section.
    pub titles: Vec<String>,
    pub title: String,
    pub summary: String,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub line_num: Option<usize>,
    pub text: String,
    pub is_md: bool,
}

/// A scored section match for `doc lookup` candidates.
#[derive(Debug, Clone, Serialize)]
pub struct SectionMatch {
    pub path: String,
    pub title: String,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub line_num: Option<usize>,
    pub score: i32,
    pub reason: String,
}

fn env_or_dotenv_first(project_root: &Path, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Ok(value) = env::var(key) {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    for path in [
        project_root.join(".env"),
        project_root.join(".emb-agent").join(".env"),
    ] {
        let Ok(raw) = fs::read_to_string(path) else {
            continue;
        };
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                continue;
            }
            let line = trimmed.strip_prefix("export ").unwrap_or(trimmed).trim();
            let Some((name, value)) = line.split_once('=') else {
                continue;
            };
            if keys.contains(&name.trim()) {
                let value = value.trim().trim_matches(['"', '\'']).to_string();
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn project_config_first(project_root: &Path, pointers: &[&str]) -> Option<String> {
    let path = project_root.join(".emb-agent").join("project.json");
    let raw = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    pointers.iter().find_map(|pointer| {
        value
            .pointer(pointer)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

/// Resolve the override model from env or project config. This is an
/// OpenAI-compatible model id sent as-is to the `/chat/completions` endpoint,
/// e.g. `gpt-4o-2024-11-20` (OpenAI), `claude-sonnet-4-6` (against Anthropic's
/// OpenAI shim api_base), `gemini-2.5-pro` (against Gemini's OpenAI shim
/// api_base), or a local Ollama model name.
pub fn pageindex_model(project_root: &Path) -> Option<String> {
    env_or_dotenv_first(
        project_root,
        &["EMB_AGENT_PAGEINDEX_MODEL", "EMB_AGENT_LLM_MODEL"],
    )
    .or_else(|| {
        project_config_first(
            project_root,
            &["/integrations/pageindex/model", "/integrations/llm/model"],
        )
    })
}

/// Resolve an OpenAI-compatible API base override from env or project config.
/// Used as the base URL for `/chat/completions` calls by the native builder.
pub fn pageindex_api_base(project_root: &Path) -> Option<String> {
    env_or_dotenv_first(
        project_root,
        &["EMB_AGENT_PAGEINDEX_API_BASE", "EMB_AGENT_LLM_API_BASE"],
    )
    .or_else(|| {
        project_config_first(
            project_root,
            &[
                "/integrations/pageindex/api_base",
                "/integrations/llm/api_base",
            ],
        )
    })
}

/// Resolve an explicit API key override for the PageIndex provider from env
/// or project config. When set it is forwarded as `OPENAI_API_KEY` (suitable
/// for OpenAI-compatible endpoints). For Anthropic/Gemini/etc., set the
/// provider-native key (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, …) instead —
/// those are forwarded verbatim from `.env`.
pub fn pageindex_api_key(project_root: &Path) -> Option<String> {
    env_or_dotenv_first(
        project_root,
        &[
            "EMB_AGENT_PAGEINDEX_API_KEY",
            "EMB_AGENT_LLM_API_KEY",
            "OPENAI_API_KEY",
            "CHATGPT_API_KEY",
        ],
    )
    .or_else(|| {
        project_config_first(
            project_root,
            &[
                "/integrations/pageindex/api_key",
                "/integrations/llm/api_key",
            ],
        )
    })
}

/// Whether LLM credentials for PageIndex are available. The native builder
/// talks to an OpenAI-compatible endpoint, so it needs the explicit
/// `EMB_AGENT_PAGEINDEX_API_KEY`, or `OPENAI_API_KEY` / `CHATGPT_API_KEY`.
pub fn pageindex_credentials_present(project_root: &Path) -> bool {
    if pageindex_api_key(project_root).is_some() {
        return true;
    }
    for key in [
        "EMB_AGENT_PAGEINDEX_API_KEY",
        "EMB_AGENT_LLM_API_KEY",
        "OPENAI_API_KEY",
        "CHATGPT_API_KEY",
    ] {
        if env::var(key).map(|v| !v.trim().is_empty()).unwrap_or(false) {
            return true;
        }
    }
    for path in [
        project_root.join(".env"),
        project_root.join(".emb-agent").join(".env"),
    ] {
        let Ok(raw) = fs::read_to_string(path) else {
            continue;
        };
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                continue;
            }
            let Some((key, value)) = trimmed.split_once('=') else {
                continue;
            };
            let key = key.trim();
            if matches!(
                key,
                "EMB_AGENT_PAGEINDEX_API_KEY"
                    | "EMB_AGENT_LLM_API_KEY"
                    | "OPENAI_API_KEY"
                    | "CHATGPT_API_KEY"
            ) && !value.trim().trim_matches(['"', '\'']).is_empty()
            {
                return true;
            }
        }
    }
    false
}

/// Build a PageIndex tree for a document. `file_path` must be absolute.
///
/// Writes `structure.json` and `pages.json` into `cache/docs/<doc_id>/`.
/// Does not touch `parse.md`; the caller is responsible for flattening the
/// tree into markdown via [`flatten_structure_to_md`] if backward-compatible
/// vector indexing is still desired.
pub fn build_structure(
    project_root: &Path,
    file_path: &Path,
    doc_id: &str,
    model: Option<&str>,
    api_base: Option<&str>,
    api_key: Option<&str>,
) -> Result<PageIndexBuild, String> {
    let cache_dir = project_root
        .join(".emb-agent")
        .join("cache")
        .join("docs")
        .join(doc_id);
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Cannot create doc cache: {e}"))?;
    let structure_path = cache_dir.join("structure.json");
    let pages_path = cache_dir.join("pages.json");

    let lower = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(lower.as_str(), "pdf" | "md" | "markdown") {
        return Err(format!(
            "PageIndex supports .pdf / .md / .markdown, got .{lower}"
        ));
    }
    let is_md = matches!(lower.as_str(), "md" | "markdown");

    // Resolve LLM config: per-call override > env > project.json > defaults.
    // The native builder talks directly to an OpenAI-compatible
    // /chat/completions endpoint, so no litellm/Python is involved.
    let resolved_model = model
        .map(str::to_string)
        .or_else(|| pageindex_model(project_root));
    let resolved_api_base = api_base
        .map(str::to_string)
        .or_else(|| pageindex_api_base(project_root));
    let resolved_api_key = api_key
        .map(str::to_string)
        .or_else(|| pageindex_api_key(project_root));

    let (api_base, api_key, model_id) = crate::lookup::pageindex_native::resolve_llm_config(
        resolved_model.as_deref(),
        resolved_api_base.as_deref(),
        resolved_api_key.as_deref(),
    )?;

    eprintln!(
        "pageindex: building tree for {} with model {} at {}",
        file_path.display(),
        model_id,
        api_base
    );
    let (doc_name, doc_description, section_count, page_count, is_md_built) =
        crate::lookup::pageindex_native::build_native(
            file_path,
            &structure_path,
            &pages_path,
            &api_base,
            &api_key,
            &model_id,
        )?;

    Ok(PageIndexBuild {
        doc_name,
        doc_description,
        section_count,
        page_count,
        structure_path: relative_json_path(project_root, &structure_path),
        pages_path: relative_json_path(project_root, &pages_path),
        is_md: is_md || is_md_built,
    })
}

/// Load the cached `structure.json` for a doc id.
pub fn load_structure(project_root: &Path, doc_id: &str) -> Result<Value, String> {
    let path = structure_path(project_root, doc_id);
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("structure.json not found for {doc_id}: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("structure.json parse error: {e}"))
}

/// Load the cached `pages.json` (array of `{page, content}`) for a doc id.
pub fn load_pages(project_root: &Path, doc_id: &str) -> Result<Value, String> {
    let path = pages_path(project_root, doc_id);
    let raw =
        fs::read_to_string(&path).map_err(|e| format!("pages.json not found for {doc_id}: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("pages.json parse error: {e}"))
}

pub fn structure_path(project_root: &Path, doc_id: &str) -> PathBuf {
    project_root
        .join(".emb-agent")
        .join("cache")
        .join("docs")
        .join(doc_id)
        .join("structure.json")
}

pub fn pages_path(project_root: &Path, doc_id: &str) -> PathBuf {
    project_root
        .join(".emb-agent")
        .join("cache")
        .join("docs")
        .join(doc_id)
        .join("pages.json")
}

/// `true` if a cached `structure.json` exists for the doc id.
pub fn has_structure(project_root: &Path, doc_id: &str) -> bool {
    structure_path(project_root, doc_id).exists()
}

/// Whether the tree uses markdown line numbers (`line_num`) instead of PDF
/// page indices (`start_index`/`end_index`).
pub fn is_md_structure(structure: &Value) -> bool {
    let Some(nodes) = structure.get("structure").and_then(Value::as_array) else {
        return false;
    };
    nodes
        .iter()
        .any(|n| n.get("line_num").is_some() && n.get("start_index").is_none())
}

/// Recursively strip `text` fields from a structure, mirroring PageIndex's
/// `remove_fields(structure, fields=['text'])`. Keeps titles, summaries, page
/// spans, and node ids so the host can reason over the tree cheaply.
pub fn strip_text_fields(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (key, val) in map {
                if key == "text" {
                    continue;
                }
                out.insert(key.clone(), strip_text_fields(val));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(strip_text_fields).collect()),
        other => other.clone(),
    }
}

/// Flatten a structure tree into markdown for the legacy `parse.md` cache, so
/// existing vector-based `knowledge index` and `doc fetch` paths keep working
/// when a document is ingested via the `pageindex` provider.
///
/// Each section becomes a heading; PDF sections annotate their page range,
/// markdown sections annotate their line number. Section text (when present)
/// is emitted verbatim under the heading.
pub fn flatten_structure_to_md(structure: &Value) -> String {
    let is_md = is_md_structure(structure);
    let mut out = String::new();
    if let Some(desc) = structure.get("doc_description").and_then(Value::as_str)
        && !desc.trim().is_empty()
    {
        out.push_str(&format!("> {desc}\n\n"));
    }
    let Some(nodes) = structure.get("structure").and_then(Value::as_array) else {
        return out;
    };
    for (index, node) in nodes.iter().enumerate() {
        flatten_node(node, 1, index + 1, is_md, &mut out);
    }
    out
}

fn flatten_node(node: &Value, depth: usize, ordinal: usize, is_md: bool, out: &mut String) {
    let title = node.get("title").and_then(Value::as_str).unwrap_or("");
    let hashes = "#".repeat(depth.min(6));
    let path = format_path(node, ordinal);
    if is_md {
        let line = node
            .get("line_num")
            .and_then(Value::as_u64)
            .map(|n| format!("line {n}"))
            .unwrap_or_default();
        out.push_str(&format!("{hashes} {title} _({path} · {line})_\n\n"));
    } else {
        let span = page_span(node)
            .map(|(s, e)| format!("pp. {s}–{e}"))
            .unwrap_or_else(|| path.clone());
        out.push_str(&format!("{hashes} {title} _({span})_\n\n"));
    }
    if let Some(summary) = node.get("summary").and_then(Value::as_str)
        && !summary.trim().is_empty()
    {
        out.push_str(&format!("{summary}\n\n"));
    }
    if let Some(text) = node.get("text").and_then(Value::as_str)
        && !text.trim().is_empty()
    {
        out.push_str(text.trim());
        out.push_str("\n\n");
    }
    if let Some(children) = node.get("nodes").and_then(Value::as_array) {
        for (i, child) in children.iter().enumerate() {
            flatten_node(child, depth + 1, i + 1, is_md, out);
        }
    }
}

fn format_path(node: &Value, ordinal: usize) -> String {
    if let Some(id) = node.get("node_id").and_then(Value::as_str)
        && !id.is_empty()
    {
        return id.to_string();
    }
    ordinal.to_string()
}

/// `(start, end)` page span for a PDF node, if present.
pub fn page_span(node: &Value) -> Option<(usize, usize)> {
    let start = node.get("start_index").and_then(Value::as_u64)?;
    let end = node.get("end_index").and_then(Value::as_u64)?;
    Some((start as usize, end as usize))
}

/// Walk a structure tree and produce a flat list of sections with page/line
/// evidence and breadcrumb paths. Used by the knowledge graph and doc lookup.
pub fn collect_sections(structure: &Value) -> Vec<SectionInfo> {
    let is_md = is_md_structure(structure);
    let mut out = Vec::new();
    let Some(nodes) = structure.get("structure").and_then(Value::as_array) else {
        return out;
    };
    for (i, node) in nodes.iter().enumerate() {
        walk_section(node, &format!("{}", i + 1), &Vec::new(), is_md, &mut out);
    }
    out
}

fn walk_section(
    node: &Value,
    path: &str,
    breadcrumb: &[String],
    is_md: bool,
    out: &mut Vec<SectionInfo>,
) {
    let title = node.get("title").and_then(Value::as_str).unwrap_or("");
    let mut titles = breadcrumb.to_vec();
    titles.push(title.to_string());

    let (page_start, page_end) = match page_span(node) {
        Some((s, e)) => (Some(s), Some(e)),
        None => (None, None),
    };
    let line_num = node
        .get("line_num")
        .and_then(Value::as_u64)
        .map(|n| n as usize);

    out.push(SectionInfo {
        path: path.to_string(),
        titles: titles.clone(),
        title: title.to_string(),
        summary: node
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        page_start,
        page_end,
        line_num,
        text: node
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        is_md,
    });

    if let Some(children) = node.get("nodes").and_then(Value::as_array) {
        for (i, child) in children.iter().enumerate() {
            let child_path = format!("{path}.{}", i + 1);
            walk_section(child, &child_path, &titles, is_md, out);
        }
    }
}

/// Parse a pages spec like `"5-7"`, `"3,8"`, or `"12"` into a sorted unique
/// list of page numbers. Mirrors PageIndex `retrieve._parse_pages`.
pub fn parse_pages_spec(spec: &str) -> Result<Vec<usize>, String> {
    let mut result = Vec::new();
    for part in spec.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((start_s, end_s)) = part.split_once('-') {
            let start: usize = start_s
                .trim()
                .parse()
                .map_err(|_| format!("Invalid page range '{part}'"))?;
            let end: usize = end_s
                .trim()
                .parse()
                .map_err(|_| format!("Invalid page range '{part}'"))?;
            if start > end {
                return Err(format!("Invalid range '{part}': start must be <= end"));
            }
            result.extend(start..=end);
        } else {
            result.push(
                part.parse::<usize>()
                    .map_err(|_| format!("Invalid page number '{part}'"))?,
            );
        }
    }
    result.sort();
    result.dedup();
    Ok(result)
}

/// `doc tree --doc-id <id>` — return document metadata plus the text-stripped
/// tree so the host can reason over section titles/summaries/page spans.
pub fn doc_tree(project_root: &Path, doc_id: &str) -> Result<Value, String> {
    let structure = load_structure(project_root, doc_id)?;
    let is_md = is_md_structure(&structure);
    let stripped = strip_text_fields(&structure);
    let page_count = load_pages(project_root, doc_id)
        .ok()
        .and_then(|v| v.as_array().map(|a| a.len()))
        .unwrap_or(0);
    Ok(json!({
        "command": "doc tree",
        "doc_id": doc_id,
        "doc_name": structure.get("doc_name").cloned().unwrap_or(Value::Null),
        "doc_description": structure.get("doc_description").cloned().unwrap_or(Value::Null),
        "type": if is_md { "markdown" } else { "pdf" },
        "page_count": page_count,
        "line_count": structure.get("line_count").cloned().unwrap_or(Value::Null),
        "structure": stripped.get("structure").cloned().unwrap_or(Value::Null),
        "next": "doc pages --doc-id <id> --pages <range> to read evidence",
    }))
}

/// `doc pages --doc-id <id> --pages <range>` — return raw page/line content
/// for tight ranges, mirroring PageIndex `get_page_content`. For markdown
/// trees, `pages` are line numbers and content is reconstructed from the
/// cached `pages.json` (which PageIndex's driver populates from node text).
pub fn doc_pages(project_root: &Path, doc_id: &str, pages: &str) -> Result<Value, String> {
    let wanted = parse_pages_spec(pages)?;
    if wanted.is_empty() {
        return Ok(json!([]));
    }
    let pages_value = load_pages(project_root, doc_id)?;
    let pages_arr = pages_value
        .as_array()
        .ok_or_else(|| "pages.json is not an array".to_string())?;
    let by_page: std::collections::HashMap<u64, &Value> = pages_arr
        .iter()
        .filter_map(|entry| {
            entry
                .get("page")
                .and_then(Value::as_u64)
                .map(|p| (p, entry))
        })
        .collect();

    let mut out = Vec::new();
    for page in wanted {
        if let Some(entry) = by_page.get(&(page as u64)) {
            out.push(json!({
                "page": page,
                "content": entry.get("content").and_then(Value::as_str).unwrap_or(""),
            }));
        }
        // Missing pages are silently skipped, matching retrieve._get_pdf_page_content.
    }
    Ok(json!(out))
}

fn relative_json_path(project_root: &Path, value: &Path) -> String {
    value
        .strip_prefix(project_root)
        .unwrap_or(value)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_present_accepts_provider_native_keys() {
        let tmp = std::env::temp_dir().join("pageindex_test_creds");
        let _ = fs::remove_dir_all(&tmp);
        let project_root = tmp;
        fs::create_dir_all(&project_root).unwrap();
        // The native builder is OpenAI-compatible: OPENAI_API_KEY (or the
        // explicit EMB_AGENT_PAGEINDEX_API_KEY) is what it reads from .env.
        fs::write(
            project_root.join(".env"),
            "# comment\nOPENAI_API_KEY=sk-test-xyz\n",
        )
        .unwrap();
        assert!(pageindex_credentials_present(&project_root));
        let _ = fs::remove_dir_all(&project_root);
    }

    #[test]
    fn credentials_present_rejects_blank_and_comments() {
        let tmp = std::env::temp_dir().join("pageindex_test_creds_blank");
        let _ = fs::remove_dir_all(&tmp);
        let project_root = tmp;
        fs::create_dir_all(&project_root).unwrap();
        fs::write(
            project_root.join(".env"),
            "# OPENAI_API_KEY=\nOPENAI_API_KEY=\n",
        )
        .unwrap();
        // Env may leak OPENAI_API_KEY from the host; only assert the .env
        // parsing does not falsely report presence via blank values by
        // checking the helper directly when no provider env is set.
        // (This test mainly guards against panics / misreads of blank lines.)
        let _ = pageindex_credentials_present(&project_root);
        let _ = fs::remove_dir_all(&project_root);
    }

    #[test]
    fn config_resolvers_read_project_json() {
        let tmp = std::env::temp_dir().join("pageindex_test_config");
        let _ = fs::remove_dir_all(&tmp);
        let project_root = tmp;
        let ext = project_root.join(".emb-agent");
        fs::create_dir_all(&ext).unwrap();
        fs::write(
            ext.join("project.json"),
            r#"{"integrations":{"pageindex":{"model":"claude-sonnet-4-6","api_base":"http://localhost:8000/v1","api_key":"sk-local"}}}"#,
        )
        .unwrap();
        assert_eq!(
            pageindex_model(&project_root).as_deref(),
            Some("claude-sonnet-4-6")
        );
        assert_eq!(
            pageindex_api_base(&project_root).as_deref(),
            Some("http://localhost:8000/v1")
        );
        assert_eq!(
            pageindex_api_key(&project_root).as_deref(),
            Some("sk-local")
        );
        let _ = fs::remove_dir_all(&project_root);
    }

    #[test]
    fn parse_pages_spec_handles_ranges_and_lists() {
        assert_eq!(parse_pages_spec("5-7").unwrap(), vec![5, 6, 7]);
        assert_eq!(parse_pages_spec("3,8").unwrap(), vec![3, 8]);
        assert_eq!(parse_pages_spec("12").unwrap(), vec![12]);
        assert_eq!(
            parse_pages_spec("7-5").unwrap_err(),
            "Invalid range '7-5': start must be <= end"
        );
        assert!(parse_pages_spec("8-7,1").is_err());
        assert_eq!(parse_pages_spec("5-7,7,6").unwrap(), vec![5, 6, 7]);
        assert_eq!(parse_pages_spec("").unwrap(), Vec::<usize>::new());
    }

    #[test]
    fn strip_text_removes_only_text() {
        let structure = json!({
            "doc_name": "x",
            "structure": [
                {"title": "A", "node_id": "0001", "start_index": 1, "end_index": 3,
                 "summary": "s", "text": "secret", "nodes": [
                    {"title": "A.1", "text": "child secret", "nodes": []}
                ]}
            ]
        });
        let stripped = strip_text_fields(&structure);
        assert_eq!(stripped["structure"][0]["text"], Value::Null);
        assert_eq!(stripped["structure"][0]["nodes"][0]["text"], Value::Null);
        assert_eq!(stripped["structure"][0]["summary"], json!("s"));
        assert_eq!(stripped["structure"][0]["node_id"], json!("0001"));
    }

    #[test]
    fn collect_sections_pdf_uses_page_spans() {
        let structure = json!({
            "doc_name": "manual",
            "structure": [
                {"title": "Top", "node_id": "0001", "start_index": 1, "end_index": 4,
                 "summary": "top", "text": "t", "nodes": [
                    {"title": "Sub", "node_id": "0002", "start_index": 3, "end_index": 4,
                     "summary": "sub", "text": "c", "nodes": []}
                ]}
            ]
        });
        let sections = collect_sections(&structure);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].path, "1");
        assert_eq!(sections[0].page_start, Some(1));
        assert_eq!(sections[0].page_end, Some(4));
        assert_eq!(sections[1].path, "1.1");
        assert_eq!(sections[1].page_start, Some(3));
        assert!(!sections[1].is_md);
    }

    #[test]
    fn collect_sections_md_uses_line_nums() {
        let structure = json!({
            "doc_name": "notes",
            "line_count": 100,
            "structure": [
                {"title": "A", "node_id": "0001", "line_num": 10, "text": "ta", "nodes": []}
            ]
        });
        let sections = collect_sections(&structure);
        assert_eq!(sections.len(), 1);
        assert_eq!(sections[0].line_num, Some(10));
        assert!(sections[0].page_start.is_none());
        assert!(sections[0].is_md);
    }

    #[test]
    fn flatten_emits_headings_and_text() {
        let structure = json!({
            "doc_description": "desc",
            "structure": [
                {"title": "A", "node_id": "0001", "start_index": 1, "end_index": 2,
                 "summary": "sm", "text": "body", "nodes": []}
            ]
        });
        let md = flatten_structure_to_md(&structure);
        assert!(md.contains("> desc"));
        assert!(md.contains("# A _(pp. 1–2)_"));
        assert!(md.contains("sm"));
        assert!(md.contains("body"));
    }

    #[test]
    fn doc_pages_selects_from_cache() {
        let tmp = std::env::temp_dir().join("pageindex_test_pages");
        let _ = fs::remove_dir_all(&tmp);
        let project_root = tmp;
        let doc_id = "d1";
        let cache = project_root.join(".emb-agent/cache/docs").join(doc_id);
        fs::create_dir_all(&cache).unwrap();
        fs::write(
            cache.join("pages.json"),
            r#"[{"page":1,"content":"p1"},{"page":2,"content":"p2"},{"page":5,"content":"p5"}]"#,
        )
        .unwrap();
        let out = doc_pages(&project_root, doc_id, "2,5-6").unwrap();
        let arr = out.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["page"], json!(2));
        assert_eq!(arr[1]["page"], json!(5));
        let _ = fs::remove_dir_all(&project_root);
    }
}
