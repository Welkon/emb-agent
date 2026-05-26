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
            &docs_dir,
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
            &cache_dir,
            &mut cache_candidates,
            search_chip,
            search_vendor,
            search_pkg,
            keyword,
        );
        candidates.extend(cache_candidates);
    }

    candidates.sort_by(|a, b| b.score.cmp(&a.score));
    let limit = limit.unwrap_or(10);
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
    for line in content.lines() {
        if line.trim_start().starts_with(key.trim_start()) {
            return line.trim_start()[key.len()..]
                .trim()
                .trim_matches('"')
                .to_string();
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

            // Skip non-document files
            if !matches_extension(&rel_str) {
                continue;
            }

            let mut score = 0;
            let mut reasons = Vec::new();

            if !chip.is_empty() && rel_str.contains(&chip.to_lowercase()) {
                score += 30;
                reasons.push(format!("chip match: {chip}"));
            }
            if !vendor.is_empty() && rel_str.contains(&vendor.to_lowercase()) {
                score += 20;
                reasons.push(format!("vendor match: {vendor}"));
            }
            if !package.is_empty() && rel_str.contains(&package.to_lowercase()) {
                score += 10;
                reasons.push(format!("package match: {package}"));
            }
            if let Some(kw) = keyword
                && !kw.is_empty()
                && rel_str.contains(&kw.to_lowercase())
            {
                score += 15;
                reasons.push(format!("keyword match: {kw}"));
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
                });
            }
        }
    }
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
    ref_filter: Option<&str>,
    limit: Option<usize>,
) -> Result<ComponentLookupResult, String> {
    // Load parsed.json if available
    let components = if let Some(pp) = parsed_path {
        let path = if Path::new(pp).is_absolute() {
            Path::new(pp).to_path_buf()
        } else {
            project_root.join(pp)
        };
        if path.exists() {
            let content = fs::read_to_string(&path).map_err(|e| format!("read error: {e}"))?;
            let parsed: serde_json::Value =
                serde_json::from_str(&content).map_err(|e| format!("json error: {e}"))?;
            parsed["components"].as_array().cloned().unwrap_or_default()
        } else {
            // Try auto-discover
            let schem_dir = project_root
                .join(".emb-agent")
                .join("cache")
                .join("schematics");
            let mut found = None;
            if schem_dir.exists()
                && let Ok(entries) = fs::read_dir(&schem_dir)
            {
                for entry in entries.flatten() {
                    let p = entry.path().join("parsed.json");
                    if p.exists() {
                        let content = fs::read_to_string(&p).unwrap_or_default();
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                            found = parsed["components"].as_array().cloned();
                            break;
                        }
                    }
                }
            }
            found.unwrap_or_default()
        }
    } else {
        // Auto-discover
        let schem_dir = project_root
            .join(".emb-agent")
            .join("cache")
            .join("schematics");
        let mut found = None;
        if schem_dir.exists()
            && let Ok(entries) = fs::read_dir(&schem_dir)
        {
            for entry in entries.flatten() {
                let p = entry.path().join("parsed.json");
                if p.exists() {
                    let content = fs::read_to_string(&p).unwrap_or_default();
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
                        found = parsed["components"].as_array().cloned();
                        break;
                    }
                }
            }
        }
        found.unwrap_or_default()
    };

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
            from_schematic: String::new(),
            parsed: parsed_path.unwrap_or("").to_string(),
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
    // Try project-relative path
    let path = project_root.join(doc_path);
    if path.exists() {
        return fs::read_to_string(&path).map_err(|e| format!("read error: {e}"));
    }

    // Try absolute path
    let abs = Path::new(doc_path);
    if abs.exists() {
        return fs::read_to_string(abs).map_err(|e| format!("read error: {e}"));
    }

    // Try cache path
    let cache_path = project_root.join(".emb-agent").join("cache").join("docs");
    for entry in walk_dir(&cache_path) {
        let p = entry.join("parse.md");
        if p.exists() && p.strip_prefix(&cache_path).is_ok() {
            // Check if this cache dir matches the doc
            let source_path = entry.join("source.json");
            if source_path.exists()
                && let Ok(content) = fs::read_to_string(&source_path)
                && content.contains(doc_path)
            {
                return fs::read_to_string(&p).map_err(|e| format!("read error: {e}"));
            }
        }
    }

    Err(format!("Document not found: {doc_path}"))
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
