use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

const MINERU_BASE_URL: &str = "https://mineru.net";
const ENV_EXAMPLE: &str = "# emb-agent integration secrets\n#\n# MinerU — PDF parsing API\nMINERU_API_KEY=\n#\n# Graphify — only needed if you want LLM-powered doc/PDF semantic extraction.\n# Code-only graph extraction is free (AST, local) and needs no key.\n# Pick one backend; if unset, graphify skips doc extraction and works code-only:\n# GEMINI_API_KEY=       # free tier available\n# DEEPSEEK_API_KEY=     # alternative for Chinese datasheets\n# OLLAMA_BASE_URL=http://localhost:11434  # fully local, no API key\n#\n# headroom — context compression (60-95% fewer tokens, local)\n# HEADROOM_PORT=8787        # proxy port, default: 8787\n# HEADROOM_MODEL=kompress-base  # compression model, default: kompress-base\n#\n# turbovec — experimental semantic vector search (emb-agent 0.x, opt-in)\nTURBOVEC_ENABLED=false\n# TURBOVEC_MODEL=BAAI/bge-small-en-v1.5   # embedding model (fastembed), default: BAAI/bge-small-en-v1.5\n# TURBOVEC_INDEX_DIR=.emb-agent/cache/turbovec  # where to persist the index\n";
const DEFAULT_LANGUAGE: &str = "ch";
const DEFAULT_MODEL_VERSION: &str = "vlm";
const DEFAULT_POLL_INTERVAL_MS: u64 = 3_000;
const DEFAULT_TIMEOUT_MS: u64 = 300_000;

#[derive(Debug, Clone)]
pub struct DocIngestOptions<'a> {
    pub file: &'a str,
    pub provider: &'a str,
    pub kind: &'a str,
    pub intended_to: &'a str,
    pub title: Option<&'a str>,
    pub language: Option<&'a str>,
    pub pages: Option<&'a str>,
    pub model_version: Option<&'a str>,
    pub force: bool,
    pub is_ocr: bool,
    pub enable_table: bool,
    pub enable_formula: bool,
    pub poll_interval_ms: Option<u64>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct EnvSetup {
    pub env_path: PathBuf,
    pub env_example_path: PathBuf,
    pub env_created: bool,
    pub env_example_created: bool,
    pub key_present: bool,
}

pub fn ensure_project_env(project_root: &Path) -> EnvSetup {
    let env_path = project_root.join(".env");
    let env_example_path = project_root.join(".env.example");
    let env_example_created = write_if_missing(&env_example_path, ENV_EXAMPLE);
    let env_created = write_if_missing(&env_path, ENV_EXAMPLE);
    ensure_gitignore_entry(project_root, ".env");
    EnvSetup {
        key_present: read_mineru_api_key(project_root).is_some(),
        env_path,
        env_example_path,
        env_created,
        env_example_created,
    }
}

pub fn ingest_document(
    project_root: &Path,
    options: DocIngestOptions<'_>,
) -> Result<Value, String> {
    let env = ensure_project_env(project_root);
    let provider = non_empty(options.provider, "mineru");
    let kind = non_empty(options.kind, "datasheet");
    let intended_to = non_empty(options.intended_to, "hardware");
    let language = non_empty(options.language.unwrap_or(""), DEFAULT_LANGUAGE);
    let model_version = non_empty(options.model_version.unwrap_or(""), DEFAULT_MODEL_VERSION);
    let file_path = resolve_project_path(project_root, options.file);
    let metadata =
        fs::metadata(&file_path).map_err(|e| format!("Cannot read {}: {e}", options.file))?;
    if !metadata.is_file() {
        return Err(format!("Document is not a file: {}", options.file));
    }

    let title = options
        .title
        .filter(|title| !title.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            Path::new(options.file)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(options.file)
                .to_string()
        });
    let doc_id = doc_id_for(options.file, options.pages.unwrap_or(""), metadata.len());
    let cache_dir = project_root
        .join(".emb-agent")
        .join("cache")
        .join("docs")
        .join(&doc_id);
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Cannot create doc cache: {e}"))?;

    let source_path = cache_dir.join("source.json");
    let parse_path = cache_dir.join("parse.md");
    let parse_json_path = cache_dir.join("parse.json");
    let summary_path = cache_dir.join("summary.json");
    let assets_path = cache_dir.join("assets.json");

    let rel_source_path = relative_json_path(project_root, &source_path);
    let rel_parse_path = relative_json_path(project_root, &parse_path);
    let rel_parse_json_path = relative_json_path(project_root, &parse_json_path);
    let rel_summary_path = relative_json_path(project_root, &summary_path);
    let rel_assets_path = relative_json_path(project_root, &assets_path);

    let source_json = json!({
        "provider": provider,
        "kind": kind,
        "title": title,
        "intended_to": intended_to,
        "source": normalize_path(options.file),
        "source_abs": file_path.to_string_lossy(),
        "pages": options.pages.unwrap_or(""),
        "language": language,
        "model_version": model_version,
        "doc_id": doc_id,
    });
    write_json(&source_path, &source_json)?;

    if parse_path.exists() && !options.force {
        let result = result_json(
            "cached",
            &doc_id,
            provider,
            kind,
            intended_to,
            &env,
            &rel_source_path,
            &rel_parse_path,
            &rel_parse_json_path,
            &rel_summary_path,
            Some(&rel_assets_path),
            json!({"direct": false}),
            "doc fetch --path <source> reads the cached parse.md.",
        );
        update_doc_index(project_root, &result)?;
        return Ok(result);
    }

    if provider == "local" {
        let content = read_text_document(&file_path)?;
        fs::write(&parse_path, content).map_err(|e| format!("Cannot write parse.md: {e}"))?;
        write_json(
            &parse_json_path,
            &json!({"provider": "local", "mode": "text", "parsed": true}),
        )?;
        write_summary(
            &summary_path,
            &doc_id,
            &rel_parse_path,
            &rel_parse_json_path,
            &rel_source_path,
        )?;
        let result = result_json(
            "ok",
            &doc_id,
            provider,
            kind,
            intended_to,
            &env,
            &rel_source_path,
            &rel_parse_path,
            &rel_parse_json_path,
            &rel_summary_path,
            None,
            json!({"direct": false}),
            "Document text cached. Use doc fetch --path <source> or inspect parse.md.",
        );
        update_doc_index(project_root, &result)?;
        return Ok(result);
    }

    if provider != "mineru" {
        return Err(format!(
            "Unsupported doc provider: {provider}. Expected: mineru or local"
        ));
    }

    let Some(api_key) = read_mineru_api_key(project_root) else {
        write_json(
            &parse_json_path,
            &json!({
                "provider": "mineru",
                "mode": "api",
                "parsed": false,
                "status": "needs_credentials",
                "required_env": "MINERU_API_KEY"
            }),
        )?;
        write_summary(
            &summary_path,
            &doc_id,
            &rel_parse_path,
            &rel_parse_json_path,
            &rel_source_path,
        )?;
        let result = result_json(
            "needs_credentials",
            &doc_id,
            provider,
            kind,
            intended_to,
            &env,
            &rel_source_path,
            &rel_parse_path,
            &rel_parse_json_path,
            &rel_summary_path,
            None,
            json!({"direct": false}),
            "Fill MINERU_API_KEY in .env, then rerun ingest doc --force.",
        );
        update_doc_index(project_root, &result)?;
        return Ok(result);
    };

    let file_bytes =
        fs::read(&file_path).map_err(|e| format!("Cannot read {}: {e}", options.file))?;
    let mineru = run_mineru_precise_parse(
        &api_key,
        &title,
        &file_bytes,
        MineruParseOptions {
            doc_id: &doc_id,
            language,
            pages: options.pages,
            model_version,
            is_ocr: options.is_ocr,
            enable_table: options.enable_table,
            enable_formula: options.enable_formula,
            poll_interval_ms: options.poll_interval_ms.unwrap_or(DEFAULT_POLL_INTERVAL_MS),
            timeout_ms: options.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS),
        },
    )?;

    let zip_url = mineru
        .get("result_zip_url")
        .and_then(Value::as_str)
        .filter(|url| !url.is_empty())
        .ok_or("MinerU completed without full_zip_url".to_string())?;
    let assets = download_and_extract_mineru_zip(zip_url, &cache_dir, &parse_path)?;
    write_json(&assets_path, &json!({"assets": assets}))?;
    write_json(&parse_json_path, &mineru)?;
    write_summary(
        &summary_path,
        &doc_id,
        &rel_parse_path,
        &rel_parse_json_path,
        &rel_source_path,
    )?;

    let result = result_json(
        "ok",
        &doc_id,
        provider,
        kind,
        intended_to,
        &env,
        &rel_source_path,
        &rel_parse_path,
        &rel_parse_json_path,
        &rel_summary_path,
        Some(&rel_assets_path),
        json!({"direct": false}),
        "MinerU parse cached. Use doc fetch --path <source> or inspect parse.md and images/ assets.",
    );
    update_doc_index(project_root, &result)?;
    Ok(result)
}

struct MineruParseOptions<'a> {
    doc_id: &'a str,
    language: &'a str,
    pages: Option<&'a str>,
    model_version: &'a str,
    is_ocr: bool,
    enable_table: bool,
    enable_formula: bool,
    poll_interval_ms: u64,
    timeout_ms: u64,
}

fn run_mineru_precise_parse(
    api_key: &str,
    file_name: &str,
    file_bytes: &[u8],
    options: MineruParseOptions<'_>,
) -> Result<Value, String> {
    let auth = format!("Bearer {api_key}");
    let mut file_payload = json!({"name": file_name, "data_id": options.doc_id});
    if let Some(pages) = options.pages.filter(|pages| !pages.trim().is_empty()) {
        file_payload["page_ranges"] = json!(pages);
    }
    if options.is_ocr {
        file_payload["is_ocr"] = json!(true);
    }
    let create_payload = json!({
        "files": [file_payload],
        "model_version": options.model_version,
        "language": options.language,
        "enable_table": options.enable_table,
        "enable_formula": options.enable_formula,
    });
    let created: Value = ureq::post(&format!("{MINERU_BASE_URL}/api/v4/file-urls/batch"))
        .set("Authorization", &auth)
        .set("Content-Type", "application/json")
        .set("Accept", "*/*")
        .send_json(create_payload.clone())
        .map_err(|e| format!("MinerU create upload URL failed: {e}"))?
        .into_json()
        .map_err(|e| format!("MinerU create response was not JSON: {e}"))?;
    ensure_mineru_ok(&created, "create upload URL")?;
    let batch_id = created
        .pointer("/data/batch_id")
        .and_then(Value::as_str)
        .ok_or("MinerU create response missing data.batch_id".to_string())?
        .to_string();
    let file_url = created
        .pointer("/data/file_urls/0")
        .and_then(Value::as_str)
        .ok_or("MinerU create response missing data.file_urls[0]".to_string())?
        .to_string();

    let upload = ureq::put(&file_url)
        .send_bytes(file_bytes)
        .map_err(|e| format!("MinerU file upload failed: {e}"))?;
    if !(200..300).contains(&upload.status()) {
        return Err(format!(
            "MinerU file upload failed with HTTP {}",
            upload.status()
        ));
    }

    let deadline = Instant::now() + Duration::from_millis(options.timeout_ms);
    loop {
        let completed: Value = ureq::get(&format!(
            "{MINERU_BASE_URL}/api/v4/extract-results/batch/{batch_id}"
        ))
        .set("Authorization", &auth)
        .set("Accept", "*/*")
        .call()
        .map_err(|e| format!("MinerU result poll failed: {e}"))?
        .into_json()
        .map_err(|e| format!("MinerU result response was not JSON: {e}"))?;
        ensure_mineru_ok(&completed, "poll result")?;

        let extract = completed
            .pointer("/data/extract_result/0")
            .cloned()
            .unwrap_or(Value::Null);
        let state = extract.get("state").and_then(Value::as_str).unwrap_or("");
        if state == "done" {
            return Ok(json!({
                "provider": "mineru",
                "mode": "api",
                "task_id": batch_id,
                "metadata": {"created": created, "completed": completed},
                "result_zip_url": extract.get("full_zip_url").and_then(Value::as_str).unwrap_or("")
            }));
        }
        if state == "failed" {
            let err = extract
                .get("err_msg")
                .and_then(Value::as_str)
                .unwrap_or("unknown MinerU failure");
            return Err(format!("MinerU parse failed: {err}"));
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "MinerU parse timed out after {} ms; last response: {}",
                options.timeout_ms, completed
            ));
        }
        thread::sleep(Duration::from_millis(options.poll_interval_ms.max(500)));
    }
}

fn download_and_extract_mineru_zip(
    zip_url: &str,
    cache_dir: &Path,
    parse_path: &Path,
) -> Result<Vec<String>, String> {
    let mut response = ureq::get(zip_url)
        .call()
        .map_err(|e| format!("MinerU ZIP download failed: {e}"))?
        .into_reader();
    let mut bytes = Vec::new();
    response
        .read_to_end(&mut bytes)
        .map_err(|e| format!("MinerU ZIP download read failed: {e}"))?;
    let cursor = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Invalid MinerU ZIP: {e}"))?;
    let mut assets = Vec::new();
    let mut full_md: Option<Vec<u8>> = None;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("Cannot read MinerU ZIP entry {index}: {e}"))?;
        let Some(enclosed) = file.enclosed_name().map(|name| name.to_path_buf()) else {
            continue;
        };
        let out_path = cache_dir.join(&enclosed);
        if file.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Cannot create MinerU ZIP dir {:?}: {e}", enclosed))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create MinerU ZIP parent {:?}: {e}", parent))?;
        }
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)
            .map_err(|e| format!("Cannot extract MinerU ZIP entry {:?}: {e}", enclosed))?;
        fs::write(&out_path, &buf)
            .map_err(|e| format!("Cannot write MinerU ZIP entry {:?}: {e}", enclosed))?;
        let rel = enclosed.to_string_lossy().replace('\\', "/");
        if rel.ends_with("full.md") {
            full_md = Some(buf);
        }
        assets.push(rel);
    }
    let Some(markdown) = full_md else {
        return Err("MinerU ZIP did not contain full.md".to_string());
    };
    let mut out =
        fs::File::create(parse_path).map_err(|e| format!("Cannot create parse.md: {e}"))?;
    out.write_all(&markdown)
        .map_err(|e| format!("Cannot write parse.md: {e}"))?;
    Ok(assets)
}

fn ensure_mineru_ok(value: &Value, action: &str) -> Result<(), String> {
    let code = value.get("code").and_then(Value::as_i64).unwrap_or(-1);
    if code == 0 || code == 200 {
        return Ok(());
    }
    let msg = value
        .get("msg")
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    Err(format!("MinerU {action} returned code {code}: {msg}"))
}

fn read_text_document(path: &Path) -> Result<String, String> {
    let lower = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "pdf" | "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx"
    ) {
        return Err(format!(
            "{} is binary; use --provider mineru and configure MINERU_API_KEY in .env",
            path.display()
        ));
    }
    fs::read_to_string(path).map_err(|e| format!("read error: {e}"))
}

#[allow(clippy::too_many_arguments)]
fn result_json(
    status: &str,
    doc_id: &str,
    provider: &str,
    kind: &str,
    intended_to: &str,
    env: &EnvSetup,
    source_path: &str,
    markdown_path: &str,
    metadata_path: &str,
    summary_path: &str,
    assets_path: Option<&str>,
    truth_write: Value,
    next_instructions: &str,
) -> Value {
    json!({
        "status": status,
        "command": "ingest doc",
        "write_mode": "analysis-only",
        "truth_write": truth_write,
        "doc_id": doc_id,
        "provider": provider,
        "kind": kind,
        "intended_to": intended_to,
        "parsed": status == "ok" || status == "cached",
        "env": {
            "env_path": env.env_path.to_string_lossy(),
            "env_example_path": env.env_example_path.to_string_lossy(),
            "env_created": env.env_created,
            "env_example_created": env.env_example_created,
            "required_key": "MINERU_API_KEY",
            "key_present": env.key_present
        },
        "paths": {
            "source": source_path,
            "markdown": markdown_path,
            "metadata": metadata_path,
            "summary": summary_path,
            "assets_manifest": assets_path.unwrap_or("")
        },
        "next": if status == "needs_credentials" { "fill .env then rerun ingest doc --force" } else { "doc fetch" },
        "next_instructions": next_instructions
    })
}

fn write_summary(
    path: &Path,
    doc_id: &str,
    parse_path: &str,
    parse_json_path: &str,
    source_path: &str,
) -> Result<(), String> {
    write_json(
        path,
        &json!({
            "doc_id": doc_id,
            "artifacts": [source_path, parse_path, parse_json_path],
            "inputs": [parse_path],
            "status": "analysis-only"
        }),
    )
}

fn update_doc_index(project_root: &Path, result: &Value) -> Result<(), String> {
    let cache_dir = project_root.join(".emb-agent").join("cache").join("docs");
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Cannot create doc index dir: {e}"))?;
    let index_path = cache_dir.join("index.json");
    let mut index = fs::read_to_string(&index_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| json!({"documents": []}));
    let doc_id = result.get("doc_id").and_then(Value::as_str).unwrap_or("");
    let docs = index
        .get_mut("documents")
        .and_then(Value::as_array_mut)
        .ok_or("doc index documents field is not an array".to_string())?;
    docs.retain(|doc| doc.get("doc_id").and_then(Value::as_str) != Some(doc_id));
    docs.push(json!({
        "doc_id": doc_id,
        "provider": result.get("provider").and_then(Value::as_str).unwrap_or(""),
        "kind": result.get("kind").and_then(Value::as_str).unwrap_or(""),
        "title": result.pointer("/paths/source").and_then(Value::as_str).unwrap_or(""),
        "intended_to": result.get("intended_to").and_then(Value::as_str).unwrap_or(""),
        "parsed": result.get("parsed").and_then(Value::as_bool).unwrap_or(false),
        "status": result.get("status").and_then(Value::as_str).unwrap_or(""),
        "paths": result.get("paths").cloned().unwrap_or(Value::Null)
    }));
    write_json(&index_path, &index)
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create {:?}: {e}", parent))?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(value).unwrap_or_default(),
    )
    .map_err(|e| format!("Cannot write {}: {e}", path.display()))
}

fn read_mineru_api_key(project_root: &Path) -> Option<String> {
    if let Ok(value) = std::env::var("MINERU_API_KEY") {
        let value = value.trim().to_string();
        if !value.is_empty() {
            return Some(value);
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
            if let Some(value) = trimmed.strip_prefix("MINERU_API_KEY=") {
                let value = value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string();
                if !value.is_empty() {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn write_if_missing(path: &Path, content: &str) -> bool {
    if path.exists() {
        return false;
    }
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(path, content).is_ok()
}

fn ensure_gitignore_entry(project_root: &Path, entry: &str) {
    let path = project_root.join(".gitignore");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    if existing.lines().any(|line| line.trim() == entry) {
        return;
    }
    let mut updated = existing.trim_end().to_string();
    if !updated.is_empty() {
        updated.push('\n');
    }
    updated.push_str(entry);
    updated.push('\n');
    let _ = fs::write(path, updated);
}

fn resolve_project_path(project_root: &Path, value: &str) -> PathBuf {
    let path = Path::new(value);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        project_root.join(path)
    }
}

fn relative_json_path(project_root: &Path, value: &Path) -> String {
    value
        .strip_prefix(project_root)
        .unwrap_or(value)
        .to_string_lossy()
        .replace('\\', "/")
}

fn normalize_path(value: &str) -> String {
    value.replace('\\', "/")
}

fn non_empty<'a>(value: &'a str, default: &'a str) -> &'a str {
    let trimmed = value.trim();
    if trimmed.is_empty() { default } else { trimmed }
}

fn doc_id_for(source: &str, pages: &str, size: u64) -> String {
    let mut hasher = Sha1::new();
    hasher.update(normalize_path(source).as_bytes());
    hasher.update(b"\0");
    hasher.update(pages.as_bytes());
    hasher.update(b"\0");
    hasher.update(size.to_string().as_bytes());
    let digest = hasher.finalize();
    let hex = format!("{digest:x}");
    hex.chars().take(16).collect()
}
