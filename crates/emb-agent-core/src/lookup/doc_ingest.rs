use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use std::env;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

const MINERU_BASE_URL: &str = "https://mineru.net";
const ENV_EXAMPLE: &str = "# emb-agent integration secrets\n#\n# MinerU — optional PDF parsing API\nMINERU_API_KEY=\n#\n# emb-agent session memory embeddings — optional, opt-in.\n# Leave these blank/commented for fully local semantic-hash recall.\n# EMB_AGENT_EMBEDDING_PROVIDER=openai-compatible\n# EMB_AGENT_EMBEDDING_API_KEY=\n# EMB_AGENT_EMBEDDING_API_BASE=<openai-compatible-base-url>\n# EMB_AGENT_EMBEDDING_MODEL=<embedding-model>\n# EMB_AGENT_EMBEDDING_UPLOAD=summary-only\n#\n# emb-agent knowledge rerank — optional, opt-in.\n# Leave these blank/commented to use local rerank scoring.\n# EMB_AGENT_RERANK_PROVIDER=openai-compatible\n# EMB_AGENT_RERANK_API_KEY=\n# EMB_AGENT_RERANK_API_BASE=<openai-compatible-base-url>\n# EMB_AGENT_RERANK_MODEL=<rerank-model>\n";
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
    let env_example_created = ensure_env_example(&env_example_path);
    let env_created = false;
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
    let mut provider = non_empty(options.provider, "auto").to_string();
    let kind = non_empty(options.kind, "datasheet");
    let intended_to = non_empty(options.intended_to, "hardware");
    let language = non_empty(options.language.unwrap_or(""), DEFAULT_LANGUAGE);
    let model_version = non_empty(options.model_version.unwrap_or(""), DEFAULT_MODEL_VERSION);
    let local_tool_order = configured_local_tool_order(project_root);
    let mut fallback_local_parse: Option<LocalParseSuccess> = None;
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
        "provider": provider.as_str(),
        "kind": kind,
        "title": title.as_str(),
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
            &provider,
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

    if provider == "local" || provider == "auto" {
        match read_local_document(&file_path, &local_tool_order) {
            Ok(local) => {
                eprintln!(
                    "emb-agent ingest doc: local parse succeeded with {} ({} lines)",
                    local.tool, local.line_count
                );
                fs::write(&parse_path, &local.content)
                    .map_err(|e| format!("Cannot write parse.md: {e}"))?;
                write_json(
                    &parse_json_path,
                    &json!({
                        "provider": "local",
                        "requested_provider": provider.as_str(),
                        "mode": local.mode.as_str(),
                        "parsed": true,
                        "tool": local.tool.as_str(),
                        "line_count": local.line_count,
                        "char_count": local.char_count,
                        "quality": local_quality(local.line_count, local.char_count),
                        "local_tool_order": local_tool_order.clone()
                    }),
                )?;
                write_summary(
                    &summary_path,
                    &doc_id,
                    &rel_parse_path,
                    &rel_parse_json_path,
                    &rel_source_path,
                )?;
                if should_fallback_to_mineru(&local, provider.as_str(), env.key_present) {
                    eprintln!(
                        "emb-agent ingest doc: local parse is sparse; falling back to MinerU"
                    );
                    fallback_local_parse = Some(local.clone());
                    provider = "mineru".to_string();
                } else {
                    let mut result = result_json(
                        "ok",
                        &doc_id,
                        "local",
                        kind,
                        intended_to,
                        &env,
                        &rel_source_path,
                        &rel_parse_path,
                        &rel_parse_json_path,
                        &rel_summary_path,
                        None,
                        json!({"direct": false}),
                        "Document parsed locally. Inspect parse.md quality; if it is sparse or table-garbled, rerun with --provider mineru.",
                    );
                    attach_local_parse_info(&mut result, &local_tool_order, Some(&local), None);
                    if local_quality(local.line_count, local.char_count)
                        == "sparse-review-or-fallback"
                    {
                        result["quality_gate"] = json!("review_required");
                        result["recommended_action"] = json!(
                            "Review cached parse.md quality. If image-heavy or sparse, set MINERU_API_KEY and rerun ingest doc --provider mineru --force."
                        );
                    }
                    update_doc_index(project_root, &result)?;
                    return Ok(result);
                }
            }
            Err(local_error) if provider == "local" => {
                write_json(
                    &parse_json_path,
                    &json!({
                        "provider": "local",
                        "mode": "local-conversion",
                        "parsed": false,
                        "status": local_error.status.as_str(),
                        "error": local_error.message.as_str(),
                        "local_tool_order": local_tool_order.clone(),
                        "attempts": local_error.attempts.clone()
                    }),
                )?;
                write_summary(
                    &summary_path,
                    &doc_id,
                    &rel_parse_path,
                    &rel_parse_json_path,
                    &rel_source_path,
                )?;
                let mut result = result_json(
                    &local_error.status,
                    &doc_id,
                    "local",
                    kind,
                    intended_to,
                    &env,
                    &rel_source_path,
                    &rel_parse_path,
                    &rel_parse_json_path,
                    &rel_summary_path,
                    None,
                    json!({"direct": false}),
                    "Local PDF/document conversion did not produce usable text. Install/configure one of the local tools in integrations.doc_ingest.local_tool_priority, or rerun with --provider mineru and MINERU_API_KEY.",
                );
                attach_local_parse_info(&mut result, &local_tool_order, None, Some(&local_error));
                update_doc_index(project_root, &result)?;
                return Ok(result);
            }
            Err(local_error) => {
                if read_mineru_api_key(project_root).is_none() {
                    write_json(
                        &parse_json_path,
                        &json!({
                            "provider": "auto",
                            "mode": "local-first",
                            "parsed": false,
                            "status": local_error.status.as_str(),
                            "error": local_error.message.as_str(),
                            "required_env": "MINERU_API_KEY",
                            "local_tool_order": local_tool_order.clone(),
                            "attempts": local_error.attempts.clone()
                        }),
                    )?;
                    write_summary(
                        &summary_path,
                        &doc_id,
                        &rel_parse_path,
                        &rel_parse_json_path,
                        &rel_source_path,
                    )?;
                    let mut result = result_json(
                        &local_error.status,
                        &doc_id,
                        "auto",
                        kind,
                        intended_to,
                        &env,
                        &rel_source_path,
                        &rel_parse_path,
                        &rel_parse_json_path,
                        &rel_summary_path,
                        None,
                        json!({"direct": false}),
                        "Auto provider tried local conversion first. Install/configure a local converter, or configure MINERU_API_KEY and rerun with --force.",
                    );
                    attach_local_parse_info(
                        &mut result,
                        &local_tool_order,
                        None,
                        Some(&local_error),
                    );
                    update_doc_index(project_root, &result)?;
                    return Ok(result);
                }
                eprintln!(
                    "emb-agent ingest doc: local parse unavailable ({}); falling back to MinerU",
                    local_error.message
                );
                provider = "mineru".to_string();
            }
        }
    }

    if provider != "mineru" {
        return Err(format!(
            "Unsupported doc provider: {provider}. Expected: auto, local, or mineru"
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
            &provider,
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
        let mut result = result;
        attach_local_tool_order(&mut result, &local_tool_order);
        update_doc_index(project_root, &result)?;
        return Ok(result);
    };

    let file_bytes =
        fs::read(&file_path).map_err(|e| format!("Cannot read {}: {e}", options.file))?;
    let mineru = match run_mineru_precise_parse(
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
    ) {
        Ok(value) => value,
        Err(error) => {
            write_json(
                &parse_json_path,
                &json!({
                    "provider": "mineru",
                    "mode": "api",
                    "parsed": false,
                    "status": "failed",
                    "error": error
                }),
            )?;
            write_summary(
                &summary_path,
                &doc_id,
                &rel_parse_path,
                &rel_parse_json_path,
                &rel_source_path,
            )?;
            let mut result = result_json(
                "failed",
                &doc_id,
                &provider,
                kind,
                intended_to,
                &env,
                &rel_source_path,
                &rel_parse_path,
                &rel_parse_json_path,
                &rel_summary_path,
                None,
                json!({"direct": false}),
                "MinerU parse failed. Inspect metadata for the error, retry with --force, or use --provider local after configuring a local converter.",
            );
            result["error"] = json!(error);
            attach_local_tool_order(&mut result, &local_tool_order);
            update_doc_index(project_root, &result)?;
            return Ok(result);
        }
    };

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

    let mut result = result_json(
        "ok",
        &doc_id,
        &provider,
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
    if let Some(local) = fallback_local_parse.as_ref() {
        result["fallback_from"] = json!("local");
        result["local_parse_before_fallback"] = json!({
            "tool": local.tool,
            "mode": local.mode,
            "line_count": local.line_count,
            "char_count": local.char_count,
            "quality": local_quality(local.line_count, local.char_count),
            "fallback_reason": "sparse-review-or-fallback"
        });
    }
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
    eprintln!("emb-agent ingest doc: MinerU create upload URL");
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

    eprintln!(
        "emb-agent ingest doc: MinerU upload {} bytes",
        file_bytes.len()
    );
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
        eprintln!("emb-agent ingest doc: MinerU polling batch {batch_id}");
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
            eprintln!("emb-agent ingest doc: MinerU parse done");
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
        if !state.is_empty() {
            eprintln!("emb-agent ingest doc: MinerU state={state}");
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

#[derive(Debug, Clone)]
struct LocalParseSuccess {
    content: String,
    tool: String,
    mode: String,
    line_count: usize,
    char_count: usize,
}

#[derive(Debug, Clone)]
struct LocalParseError {
    status: String,
    message: String,
    attempts: Vec<Value>,
}

pub(crate) fn configured_local_tool_order(project_root: &Path) -> Vec<String> {
    if let Ok(raw) = env::var("EMB_AGENT_DOC_LOCAL_TOOLS") {
        let tools = split_tool_order(&raw);
        if !tools.is_empty() {
            return tools;
        }
    }
    if let Some(tools) = project_local_tool_order(project_root)
        && !tools.is_empty()
    {
        return tools;
    }
    vec![
        "markitdown".to_string(),
        "pdftotext".to_string(),
        "mutool".to_string(),
    ]
}

fn project_local_tool_order(project_root: &Path) -> Option<Vec<String>> {
    let path = project_root.join(".emb-agent").join("project.json");
    let raw = fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<Value>(&raw).ok()?;
    for pointer in [
        "/integrations/doc_ingest/local_tool_priority",
        "/integrations/doc_ingest/local_tools",
        "/integrations/document/local_tool_priority",
        "/integrations/document/local_tools",
    ] {
        let Some(items) = value.pointer(pointer).and_then(Value::as_array) else {
            continue;
        };
        let tools: Vec<String> = items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|tool| !tool.is_empty())
            .map(str::to_string)
            .collect();
        if !tools.is_empty() {
            return Some(tools);
        }
    }
    None
}

fn split_tool_order(raw: &str) -> Vec<String> {
    raw.split([',', ';', ':'])
        .map(str::trim)
        .filter(|tool| !tool.is_empty())
        .map(str::to_string)
        .collect()
}

fn read_local_document(
    path: &Path,
    tool_order: &[String],
) -> Result<LocalParseSuccess, LocalParseError> {
    let lower = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !is_converter_document_ext(&lower) {
        return fs::read_to_string(path)
            .map(|content| local_success(content, "utf8", "text"))
            .map_err(|e| LocalParseError {
                status: "local_parse_failed".to_string(),
                message: format!("read error: {e}"),
                attempts: vec![json!({"tool": "utf8", "available": true, "error": e.to_string()})],
            });
    }

    let mut attempts = Vec::new();
    for tool in tool_order {
        let tool = tool.trim();
        if tool.is_empty() {
            continue;
        }
        if !tool_supports_extension(tool, &lower) {
            attempts.push(
                json!({"tool": tool, "available": false, "skipped": "unsupported_extension"}),
            );
            continue;
        }
        if !command_available(tool) {
            attempts.push(json!({"tool": tool, "available": false}));
            continue;
        }
        eprintln!("emb-agent ingest doc: trying local converter {tool}");
        match run_local_converter(tool, path, &lower) {
            Ok((content, mode)) => return Ok(local_success(content, tool, mode)),
            Err(error) => attempts.push(json!({
                "tool": tool,
                "available": true,
                "error": error
            })),
        }
    }

    let any_available = attempts
        .iter()
        .any(|attempt| attempt.get("available").and_then(Value::as_bool) == Some(true));
    let status = if any_available {
        "local_parse_failed"
    } else {
        "local_tools_missing"
    };
    Err(LocalParseError {
        status: status.to_string(),
        message: if any_available {
            "local converters ran but did not produce usable text".to_string()
        } else {
            format!(
                "no configured local converter found; configured order: {}",
                tool_order.join(", ")
            )
        },
        attempts,
    })
}

fn tool_supports_extension(tool: &str, ext: &str) -> bool {
    match tool {
        "pdftotext" | "mutool" => ext == "pdf",
        _ => true,
    }
}

fn run_local_converter(
    tool: &str,
    path: &Path,
    ext: &str,
) -> Result<(String, &'static str), String> {
    let path_string = path.to_string_lossy();
    match tool {
        "pdftotext" if ext == "pdf" => {
            command_stdout(tool, &[path_string.as_ref(), "-"]).map(|content| (content, "text"))
        }
        "mutool" if ext == "pdf" => command_stdout(
            tool,
            &["draw", "-F", "txt", "-o", "-", path_string.as_ref()],
        )
        .map(|content| (content, "text")),
        "markitdown" => command_stdout(tool, &[path_string.as_ref()]).map(|content| {
            let mode = if ext == "pdf" { "markdown" } else { "text" };
            (content, mode)
        }),
        _ => command_stdout(tool, &[path_string.as_ref()]).map(|content| (content, "text")),
    }
}

fn local_success(content: String, tool: &str, mode: &str) -> LocalParseSuccess {
    let line_count = content.lines().count();
    let char_count = content.chars().count();
    LocalParseSuccess {
        content,
        tool: tool.to_string(),
        mode: mode.to_string(),
        line_count,
        char_count,
    }
}

fn command_stdout(command: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|e| format!("spawn failed: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "exit {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let content = String::from_utf8_lossy(&output.stdout).to_string();
    if content.trim().is_empty() {
        return Err("converter produced empty stdout".to_string());
    }
    Ok(content)
}

fn command_available(command: &str) -> bool {
    let Some(paths) = env::var_os("PATH") else {
        return false;
    };
    let names: Vec<String> = if cfg!(windows) {
        vec![format!("{command}.exe"), command.to_string()]
    } else {
        vec![command.to_string()]
    };
    env::split_paths(&paths).any(|dir| names.iter().any(|name| dir.join(name).is_file()))
}

fn is_converter_document_ext(ext: &str) -> bool {
    matches!(
        ext,
        "pdf" | "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx"
    )
}

fn local_quality(line_count: usize, char_count: usize) -> &'static str {
    if line_count >= 500 && char_count >= 10_000 {
        "good"
    } else if line_count >= 50 && char_count >= 2_000 {
        "review"
    } else {
        "sparse-review-or-fallback"
    }
}

fn should_fallback_to_mineru(local: &LocalParseSuccess, provider: &str, has_key: bool) -> bool {
    provider == "auto"
        && has_key
        && local_quality(local.line_count, local.char_count) == "sparse-review-or-fallback"
}

fn attach_local_parse_info(
    result: &mut Value,
    tool_order: &[String],
    success: Option<&LocalParseSuccess>,
    error: Option<&LocalParseError>,
) {
    attach_local_tool_order(result, tool_order);
    if let Some(success) = success {
        result["local_parse"] = json!({
            "tool": success.tool,
            "mode": success.mode,
            "line_count": success.line_count,
            "char_count": success.char_count,
            "quality": local_quality(success.line_count, success.char_count)
        });
    }
    if let Some(error) = error {
        result["local_parse"] = json!({
            "status": error.status,
            "error": error.message,
            "attempts": error.attempts
        });
    }
}

fn attach_local_tool_order(result: &mut Value, tool_order: &[String]) {
    result["local_pdf_tool_priority"] = json!(tool_order);
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
        "next": match status {
            "needs_credentials" => "fill .env then rerun ingest doc --force",
            "local_tools_missing" => "install/configure a local converter or configure MINERU_API_KEY, then rerun ingest doc --force",
            "local_parse_failed" => "inspect local_parse.attempts or rerun with --provider mineru",
            "failed" => "inspect error, retry with --force, or use another provider",
            _ => "doc fetch",
        },
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

fn ensure_env_example(path: &Path) -> bool {
    if !path.exists() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        return fs::write(path, ENV_EXAMPLE).is_ok();
    }
    let existing = fs::read_to_string(path).unwrap_or_default();
    let existing = remove_deprecated_env_example_keys(&existing);
    let mut updated = existing.trim_end().to_string();
    let mut changed = false;
    for (key, block) in [
        (
            "MINERU_API_KEY",
            "# emb-agent integration secrets\n#\n# MinerU — optional PDF parsing API\nMINERU_API_KEY=\n",
        ),
        (
            "EMB_AGENT_EMBEDDING_PROVIDER",
            "# emb-agent session memory embeddings — optional, opt-in.\n# Leave these blank/commented for fully local semantic-hash recall.\n# EMB_AGENT_EMBEDDING_PROVIDER=openai-compatible\n# EMB_AGENT_EMBEDDING_API_KEY=\n# EMB_AGENT_EMBEDDING_API_BASE=<openai-compatible-base-url>\n# EMB_AGENT_EMBEDDING_MODEL=<embedding-model>\n# EMB_AGENT_EMBEDDING_UPLOAD=summary-only\n",
        ),
        (
            "EMB_AGENT_RERANK_PROVIDER",
            "# emb-agent knowledge rerank — optional, opt-in.\n# Leave these blank/commented to use local rerank scoring.\n# EMB_AGENT_RERANK_PROVIDER=openai-compatible\n# EMB_AGENT_RERANK_API_KEY=\n# EMB_AGENT_RERANK_API_BASE=<openai-compatible-base-url>\n# EMB_AGENT_RERANK_MODEL=<rerank-model>\n",
        ),
    ] {
        if !existing.contains(key) {
            if !updated.is_empty() {
                updated.push_str("\n\n");
            }
            updated.push_str(block.trim_end());
            changed = true;
        }
    }
    if changed {
        updated.push('\n');
        let _ = fs::write(path, updated);
    } else {
        let _ = fs::write(path, existing);
    }
    false
}

fn remove_deprecated_env_example_keys(existing: &str) -> String {
    let graph_prefix = format!("{}{}", "GRA", "PHIFY");
    let graph_prefix2 = format!("{graph_prefix}Y");
    let deprecated_prefixes = [
        graph_prefix.as_str(),
        graph_prefix2.as_str(),
        "CODEX_ONLY",
        "CODEX-ONLY",
        "GEMINI_API_KEY",
        "DEEPSEEK_API_KEY",
        "OLLAMA_BASE_URL",
        "HEADROOM_",
        "TURBOVEC_",
    ];
    let lines = existing
        .lines()
        .filter(|line| {
            let key = line
                .trim()
                .trim_start_matches('#')
                .trim_start()
                .split_once('=')
                .map(|(key, _)| key.trim().to_ascii_uppercase());
            match key {
                Some(key) => !deprecated_prefixes
                    .iter()
                    .any(|prefix| key == *prefix || key.starts_with(prefix)),
                None => true,
            }
        })
        .collect::<Vec<_>>();
    format!("{}\n", lines.join("\n").trim_end())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn local(lines: usize, chars: usize) -> LocalParseSuccess {
        LocalParseSuccess {
            content: "x".repeat(chars),
            tool: "fixture".to_string(),
            mode: "text".to_string(),
            line_count: lines,
            char_count: chars,
        }
    }

    #[test]
    fn local_quality_thresholds_are_stable() {
        assert_eq!(local_quality(500, 10_000), "good");
        assert_eq!(local_quality(50, 2_000), "review");
        assert_eq!(local_quality(49, 2_000), "sparse-review-or-fallback");
        assert_eq!(local_quality(500, 1_999), "sparse-review-or-fallback");
    }

    #[test]
    fn auto_sparse_local_parse_falls_back_only_when_mineru_key_exists() {
        let sparse = local(10, 100);
        let review = local(60, 3_000);
        assert!(should_fallback_to_mineru(&sparse, "auto", true));
        assert!(!should_fallback_to_mineru(&sparse, "auto", false));
        assert!(!should_fallback_to_mineru(&sparse, "local", true));
        assert!(!should_fallback_to_mineru(&review, "auto", true));
    }
}
