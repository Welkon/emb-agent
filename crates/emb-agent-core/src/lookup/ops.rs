use serde::Serialize;
use std::fs;
use std::path::Path;

// === doc lookup ===

#[derive(Debug, Clone, Serialize)]
pub struct DocLookupResult {
    pub command: String,
    pub provider: String,
    pub scope: DocLookupScope,
    pub documents: Vec<DocCandidate>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocLookupScope {
    pub project_root: String,
    pub chip: String,
    pub vendor: String,
    pub package: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocCandidate {
    pub path: String,
    pub score: i32,
    pub confidence: String,
    pub reason: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sections: Vec<crate::lookup::pageindex::SectionMatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retrieval: Option<String>,
}

pub fn lookup_docs(
    project_root: &Path,
    chip: Option<&str>,
    vendor: Option<&str>,
    package: Option<&str>,
    keyword: Option<&str>,
    limit: Option<usize>,
) -> Result<DocLookupResult, String> {
    let mut candidates = Vec::new();

    // Load hardware identity from hw.yaml
    let hw_path = project_root.join(".emb-agent").join("hw.yaml");
    let hw_content = fs::read_to_string(&hw_path).unwrap_or_default();
    let hw_chip = extract_yaml_field(&hw_content, "  model: ");
    let hw_vendor = extract_yaml_field(&hw_content, "  vendor: ");
    let hw_package = extract_yaml_field(&hw_content, "  package: ");

    let search_chip = chip.unwrap_or(&hw_chip);
    let search_vendor = vendor.unwrap_or(&hw_vendor);
    let search_pkg = package.unwrap_or(&hw_package);

    // Walk docs/ directory
    let docs_dir = project_root.join("docs");
    if docs_dir.exists() {
        walk_docs(
            &docs_dir,
            project_root,
            &mut candidates,
            search_chip,
            search_vendor,
            search_pkg,
            keyword,
        );
    }

    // Also check .emb-agent/cache/docs/
    let cache_dir = project_root.join(".emb-agent").join("cache").join("docs");
    if cache_dir.exists() {
        let mut cache_candidates = Vec::new();
        walk_docs(
            &cache_dir,
            project_root,
            &mut cache_candidates,
            search_chip,
            search_vendor,
            search_pkg,
            keyword,
        );
        candidates.extend(cache_candidates);
    }

    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.score));
    let limit = limit.unwrap_or(10);
    candidates.truncate(limit);

    // Tree-aware boost: for docs ingested via the `pageindex` provider, score
    // individual sections (title + summary + text) against chip/vendor/keyword
    // and attach matched sections with page/line evidence so the host can jump
    // straight to `doc pages --doc-id <id> --pages <range>`.
    boost_tree_sections(&mut candidates, project_root, search_chip, keyword);
    candidates.sort_by_key(|candidate| std::cmp::Reverse(candidate.score));
    candidates.truncate(limit);

    Ok(DocLookupResult {
        command: "doc lookup".to_string(),
        provider: "local".to_string(),
        scope: DocLookupScope {
            project_root: project_root.to_string_lossy().to_string(),
            chip: search_chip.to_string(),
            vendor: search_vendor.to_string(),
            package: search_pkg.to_string(),
        },
        documents: candidates,
        summary: if !search_chip.is_empty() {
            format!("Searched project docs for chip: {search_chip}")
        } else {
            "Searched project docs (no chip filter)".to_string()
        },
    })
}

fn extract_yaml_field(content: &str, key: &str) -> String {
    let key = key.trim_start();
    for line in content.lines() {
        let trimmed = line.trim_start();
        if let Some(value) = trimmed.strip_prefix(key) {
            return value.trim().trim_matches('"').to_string();
        }
    }
    String::new()
}

fn walk_docs(
    dir: &Path,
    base: &Path,
    candidates: &mut Vec<DocCandidate>,
    chip: &str,
    vendor: &str,
    package: &str,
    keyword: Option<&str>,
) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk_docs(&path, base, candidates, chip, vendor, package, keyword);
                continue;
            }

            let rel = path.strip_prefix(base).unwrap_or(&path);
            let rel_str = rel.to_string_lossy().to_lowercase();
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            let meta_text = doc_metadata_text(&path).to_lowercase();
            let content_text = doc_search_content(&path).to_lowercase();
            let hay = format!("{rel_str} {name} {meta_text} {content_text}");

            // Skip non-document files
            if !matches_extension(&rel_str) {
                continue;
            }

            let mut score = 0;
            let mut reasons = Vec::new();

            if !chip.is_empty() && contains_chip_key(&hay, chip) {
                score += 30;
                reasons.push(format!("chip match: {chip}"));
            }
            if !vendor.is_empty() && hay.contains(&vendor.to_lowercase()) {
                score += 20;
                reasons.push(format!("vendor match: {vendor}"));
            }
            if !package.is_empty() && hay.contains(&package.to_lowercase()) {
                score += 10;
                reasons.push(format!("package match: {package}"));
            }
            if let Some(kw) = keyword {
                let (kw_score, kw_reasons) = keyword_score(&hay, kw);
                if kw_score > 0 {
                    score += kw_score;
                    reasons.extend(kw_reasons);
                }
            }

            // Bonus for datasheet-like names
            if name.contains("datasheet") || name.contains("manual") || name.contains("user") {
                score += 5;
            }
            if name.contains("reference") || name.contains("guide") {
                score += 3;
            }
            // Penalty for non-document PDFs
            if name.contains("test") || name.contains("report") {
                score -= 5;
            }

            if score > 0 || (!chip.is_empty() && score == 0 && name.contains(&chip.to_lowercase()))
            {
                let confidence = if score >= 25 {
                    "high"
                } else if score >= 10 {
                    "medium"
                } else {
                    "low"
                };
                candidates.push(DocCandidate {
                    path: rel.to_string_lossy().to_string(),
                    score,
                    confidence: confidence.to_string(),
                    reason: reasons.join(", "),
                    sections: Vec::new(),
                    doc_id: None,
                    retrieval: None,
                });
            }
        }
    }
}

fn doc_metadata_text(path: &Path) -> String {
    let source_path = if path.file_name().and_then(|name| name.to_str()) == Some("source.json") {
        path.to_path_buf()
    } else {
        path.parent()
            .map(|parent| parent.join("source.json"))
            .unwrap_or_else(|| path.with_file_name("source.json"))
    };
    let Ok(raw) = fs::read_to_string(source_path) else {
        return String::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return raw.chars().take(4_000).collect();
    };
    [
        "title",
        "source",
        "source_abs",
        "kind",
        "provider",
        "doc_id",
        "intended_to",
        "language",
    ]
    .iter()
    .filter_map(|key| value.get(*key).and_then(serde_json::Value::as_str))
    .collect::<Vec<_>>()
    .join(" ")
}

fn doc_search_content(path: &Path) -> String {
    let lower = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !(lower.ends_with(".md")
        || lower.ends_with(".txt")
        || lower.ends_with(".json")
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml"))
    {
        return String::new();
    }
    fs::read_to_string(path)
        .map(|text| text.chars().take(200_000).collect())
        .unwrap_or_default()
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

fn keyword_score(hay: &str, keyword: &str) -> (i32, Vec<String>) {
    let kw = keyword.trim().to_lowercase();
    if kw.is_empty() {
        return (0, Vec::new());
    }
    let mut score = 0;
    let mut reasons = Vec::new();
    if hay.contains(&kw) {
        score += 20;
        reasons.push(format!("keyword phrase match: {keyword}"));
    }
    let mut token_hits = 0;
    for token in kw
        .split(|ch: char| {
            ch.is_whitespace()
                || matches!(
                    ch,
                    ',' | ';'
                        | ':'
                        | '/'
                        | '\\'
                        | '('
                        | ')'
                        | '['
                        | ']'
                        | '，'
                        | '；'
                        | '：'
                        | '、'
                )
        })
        .map(str::trim)
        .filter(|token| token.chars().count() >= 2)
    {
        if hay.contains(token) {
            token_hits += 1;
        }
    }
    if token_hits > 0 {
        score += (token_hits * 4).min(24);
        reasons.push(format!("{token_hits} keyword token match(es)"));
    }
    (score, reasons)
}

fn matches_extension(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".pdf")
        || lower.ends_with(".md")
        || lower.ends_with(".txt")
        || lower.ends_with(".html")
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml")
        || lower.ends_with(".json")
}

/// Tree-aware section scoring for docs ingested via the `pageindex` provider.
///
/// Loads `cache/docs/index.json`, and for every parsed doc that has a cached
/// `structure.json`, scores each tree section (title + summary + text) against
/// the chip and keyword filters. Matched sections are attached to the matching
/// `DocCandidate` (or a new one is pushed) with page/line evidence, so the host
/// can call `doc pages --doc-id <id> --pages <range>` directly.
fn boost_tree_sections(
    candidates: &mut Vec<DocCandidate>,
    project_root: &Path,
    chip: &str,
    keyword: Option<&str>,
) {
    let index_path = project_root
        .join(".emb-agent")
        .join("cache")
        .join("docs")
        .join("index.json");
    let Ok(raw) = fs::read_to_string(&index_path) else {
        return;
    };
    let Ok(index) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let Some(entries) = index.get("documents").and_then(serde_json::Value::as_array) else {
        return;
    };

    let kw = keyword
        .map(|k| k.trim().to_lowercase())
        .filter(|k| !k.is_empty());
    let chip_l = chip.to_lowercase();

    for entry in entries {
        if entry.get("parsed").and_then(serde_json::Value::as_bool) != Some(true) {
            continue;
        }
        let Some(structure_rel) = entry
            .pointer("/paths/structure")
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let doc_id = entry
            .get("doc_id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string();
        let structure_path = project_root.join(structure_rel);
        let Ok(structure_raw) = fs::read_to_string(&structure_path) else {
            continue;
        };
        let Ok(structure) = serde_json::from_str::<serde_json::Value>(&structure_raw) else {
            continue;
        };

        let sections = crate::lookup::pageindex::collect_sections(&structure);
        let mut matched: Vec<crate::lookup::pageindex::SectionMatch> = Vec::new();
        for section in &sections {
            let hay =
                format!("{} {} {}", section.title, section.summary, section.text).to_lowercase();
            let mut score = 0i32;
            let mut reasons = Vec::new();
            if !chip_l.is_empty() && hay.contains(&chip_l) {
                score += 30;
                if section.title.to_lowercase().contains(&chip_l) {
                    score += 10;
                    reasons.push(format!("section title chip match: {chip}"));
                } else {
                    reasons.push(format!("section chip match: {chip}"));
                }
            }
            if let Some(kw) = &kw
                && hay.contains(kw)
            {
                score += 15;
                reasons.push(format!("section keyword match: {kw}"));
            }
            if score > 0 {
                matched.push(crate::lookup::pageindex::SectionMatch {
                    path: section.path.clone(),
                    title: section.title.clone(),
                    page_start: section.page_start,
                    page_end: section.page_end,
                    line_num: section.line_num,
                    score,
                    reason: reasons.join(", "),
                });
            }
        }
        if matched.is_empty() {
            continue;
        }
        matched.sort_by_key(|m| std::cmp::Reverse(m.score));
        matched.truncate(5);

        let doc_boost = matched.iter().take(3).map(|m| m.score).sum::<i32>().min(60)
            + 5 * matched.len().min(4) as i32;

        let source_rel = entry
            .pointer("/paths/source")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_string();

        // Try to boost an existing candidate that points at the same source.
        let existing = candidates
            .iter_mut()
            .find(|c| same_doc_path(&c.path, &source_rel));
        if let Some(candidate) = existing {
            candidate.score += doc_boost;
            candidate.sections = matched.clone();
            candidate.doc_id = Some(doc_id.clone());
            candidate.retrieval = Some("tree".to_string());
            if !candidate.reason.contains("tree section match") {
                candidate.reason.push_str(", tree section match");
            }
        } else {
            candidates.push(DocCandidate {
                path: source_rel,
                score: doc_boost,
                confidence: if doc_boost >= 25 { "high" } else { "medium" }.to_string(),
                reason: "tree section match".to_string(),
                sections: matched.clone(),
                doc_id: Some(doc_id.clone()),
                retrieval: Some("tree".to_string()),
            });
        }
    }
}

fn same_doc_path(candidate_path: &str, source_rel: &str) -> bool {
    let a = candidate_path.replace('\\', "/").to_lowercase();
    let b = source_rel.replace('\\', "/").to_lowercase();
    if a == b {
        return true;
    }
    // Fallback to filename equality for cache-vs-docs path mismatches.
    let name_a = a.rsplit('/').next().unwrap_or("");
    let name_b = b.rsplit('/').next().unwrap_or("");
    !name_a.is_empty() && name_a == name_b
}

// === component lookup ===

#[derive(Debug, Clone, Serialize)]
pub struct ComponentLookupResult {
    pub command: String,
    pub provider: String,
    pub scope: ComponentLookupScope,
    pub components: Vec<ComponentMatch>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComponentLookupScope {
    pub project_root: String,
    pub from_schematic: String,
    pub parsed: String,
    pub ref_: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComponentMatch {
    pub designator: String,
    pub value: String,
    pub libref: String,
    pub footprint: String,
    pub datasheet: String,
}

pub fn lookup_components(
    project_root: &Path,
    parsed_path: Option<&str>,
    file_path: Option<&str>,
    ref_filter: Option<&str>,
    limit: Option<usize>,
) -> Result<ComponentLookupResult, String> {
    let (resolved_path, parsed_display) =
        crate::schematic::resolve_parsed_path(project_root, parsed_path, file_path)?;
    let content = fs::read_to_string(&resolved_path).map_err(|e| format!("read error: {e}"))?;
    let parsed: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("json error: {e}"))?;
    let components = parsed["components"].as_array().cloned().unwrap_or_default();

    let limit = limit.unwrap_or(10);
    let matches: Vec<_> = components
        .into_iter()
        .filter(|c| {
            if let Some(ref_) = ref_filter {
                c["designator"].as_str().unwrap_or("").to_lowercase() == ref_.to_lowercase()
            } else {
                true
            }
        })
        .take(limit)
        .map(|c| ComponentMatch {
            designator: c["designator"].as_str().unwrap_or("").to_string(),
            value: c["value"].as_str().unwrap_or("").to_string(),
            libref: c["libref"].as_str().unwrap_or("").to_string(),
            footprint: c["footprint"].as_str().unwrap_or("").to_string(),
            datasheet: c["datasheet"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(ComponentLookupResult {
        command: "component lookup".to_string(),
        provider: "local".to_string(),
        scope: ComponentLookupScope {
            project_root: project_root.to_string_lossy().to_string(),
            from_schematic: file_path.unwrap_or("").to_string(),
            parsed: parsed_display,
            ref_: ref_filter.unwrap_or("").to_string(),
        },
        components: matches,
    })
}

// === board query ===

#[derive(Debug, Clone, Serialize)]
pub struct BoardQueryResult {
    pub command: String,
    pub scope: BoardQueryScope,
    pub summary: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct BoardQueryScope {
    pub project_root: String,
    pub layout: String,
}

pub fn query_board(
    project_root: &Path,
    subject: &str,
    layout_path: Option<&str>,
) -> Result<BoardQueryResult, String> {
    let layout = if let Some(lp) = layout_path {
        let path = if Path::new(lp).is_absolute() {
            Path::new(lp).to_path_buf()
        } else {
            project_root.join(lp)
        };
        if path.exists() {
            fs::read_to_string(&path).map_err(|e| format!("read error: {e}"))?
        } else {
            return Err(format!("Layout file not found: {lp}"));
        }
    } else {
        // Auto-discover board cache
        let board_dir = project_root.join(".emb-agent").join("cache").join("boards");
        let mut found = None;
        if board_dir.exists()
            && let Ok(entries) = fs::read_dir(&board_dir)
        {
            for entry in entries.flatten() {
                let p = entry.path().join("analysis.board-layout.json");
                if p.exists() {
                    found = Some(fs::read_to_string(&p).unwrap_or_default());
                    break;
                }
            }
        }
        found.unwrap_or_else(|| "{}".to_string())
    };

    let parsed: serde_json::Value = serde_json::from_str(&layout).unwrap_or_default();

    let summary = match subject {
        "summary" => serde_json::json!({
            "components": parsed["coverage"]["components"].as_u64().unwrap_or(0),
            "tracks": parsed["coverage"]["tracks"].as_u64().unwrap_or(0),
            "vias": parsed["coverage"]["vias"].as_u64().unwrap_or(0),
            "nets": parsed["coverage"]["nets"].as_u64().unwrap_or(0),
            "bounds": parsed["board"]["bounds"],
        }),
        "advice" => {
            let advice = parsed["board_advice"].clone();
            serde_json::json!({
                "available": !advice.is_null(),
                "findings": advice["findings"].as_array().map(|a| a.len()).unwrap_or(0),
            })
        }
        _ => serde_json::json!({
            "note": format!("board {subject} not yet implemented"),
        }),
    };

    Ok(BoardQueryResult {
        command: format!("board {subject}"),
        scope: BoardQueryScope {
            project_root: project_root.to_string_lossy().to_string(),
            layout: layout_path.unwrap_or("").to_string(),
        },
        summary,
    })
}

// === fetch document ===

pub fn fetch_document(project_root: &Path, doc_path: &str) -> Result<String, String> {
    if is_schematic_path(doc_path) {
        if let Some(content) = fetch_cached_schematic_parse(project_root, doc_path)? {
            return Ok(content);
        }
        return Err(format!(
            "Schematic not found or not parsed: {doc_path}. Run `ingest schematic --file {doc_path}` first."
        ));
    }

    if let Some(content) = fetch_cached_parse(project_root, doc_path)? {
        return Ok(content);
    }

    // Try project-relative path
    let path = project_root.join(doc_path);
    if path.exists() {
        return read_fetchable_text(&path, doc_path);
    }

    // Try absolute path
    let abs = Path::new(doc_path);
    if abs.exists() {
        return read_fetchable_text(abs, doc_path);
    }

    Err(format!(
        "Document not found or not parsed: {doc_path}. Run `ingest doc --file {doc_path} --provider auto` first."
    ))
}

fn fetch_cached_schematic_parse(
    project_root: &Path,
    doc_path: &str,
) -> Result<Option<String>, String> {
    let cache_path = project_root
        .join(".emb-agent")
        .join("cache")
        .join("schematics");
    for entry in walk_dir(&cache_path) {
        let parsed = entry.join("parsed.json");
        if parsed.exists() {
            let source_path = entry.join("source.json");
            if source_path.exists()
                && let Ok(content) = fs::read_to_string(&source_path)
                && (content.contains(doc_path)
                    || content.contains(
                        Path::new(doc_path)
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or(""),
                    ))
            {
                return fs::read_to_string(&parsed)
                    .map(Some)
                    .map_err(|e| format!("read error: {e}"));
            }
        }
    }
    Ok(None)
}

fn is_schematic_path(doc_path: &str) -> bool {
    matches!(
        Path::new(doc_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "schdoc" | "pcbdoc" | "sch" | "dsn" | "kicad_sch"
    )
}

fn fetch_cached_parse(project_root: &Path, doc_path: &str) -> Result<Option<String>, String> {
    let cache_path = project_root.join(".emb-agent").join("cache").join("docs");
    for entry in walk_dir(&cache_path) {
        let p = entry.join("parse.md");
        if p.exists() && p.strip_prefix(&cache_path).is_ok() {
            let source_path = entry.join("source.json");
            if source_path.exists()
                && let Ok(content) = fs::read_to_string(&source_path)
                && content.contains(doc_path)
            {
                return fs::read_to_string(&p)
                    .map(Some)
                    .map_err(|e| format!("read error: {e}"));
            }
        }
    }
    Ok(None)
}

fn read_fetchable_text(path: &Path, requested: &str) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        ext.as_str(),
        "pdf" | "doc" | "docx" | "ppt" | "pptx" | "xls" | "xlsx"
    ) {
        return Err(format!(
            "Document is binary and has no cached parse.md: {requested}. Run `ingest doc --file {requested} --provider auto` first."
        ));
    }
    fs::read_to_string(path).map_err(|e| format!("read error: {e}"))
}

fn walk_dir(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                result.push(path.clone());
                result.extend(walk_dir(&path));
            }
        }
    }
    result
}
