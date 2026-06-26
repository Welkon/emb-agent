//! LLM schema-based extraction for document sections.
//!
//! Replaces the regex/keyword heuristics in `graph.rs`
//! (`extract_register_like_symbols`, `extract_domain_keywords`,
//! `extract_formula_like_lines`) with a single LLM call per section that
//! returns structured entities with confidence and provenance. The extracted
//! entities become graph nodes with `basis: LLM_SCHEMA` and a confidence score,
//! instead of the old `basis: HEURISTIC` blanket.
//!
//! Output is cached per section hash so re-extraction is incremental and cheap
//! to re-run.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::llm::{LlmConfig, complete, extract_json};

const EXTRACT_CACHE_VERSION: u32 = 1;

/// One structured entity extracted from a section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedEntity {
    pub entity_type: String,
    pub name: String,
    pub summary: String,
    /// Normalized canonical id for cross-document alignment, e.g.
    /// `register:wdtcon`. Empty if the extractor is not confident enough.
    pub canonical: String,
    /// Numeric/string fields, e.g. {"reset_value": "0x1F"} or {"timeout_ms": "16"}.
    pub fields: HashMap<String, String>,
    pub confidence: f32,
}

/// Extraction result for a single section, cached to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionExtraction {
    pub doc_id: String,
    pub section_path: String,
    pub title: String,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub line_num: Option<usize>,
    pub entities: Vec<ExtractedEntity>,
    pub model: String,
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ExtractCache {
    version: u32,
    model: String,
    sections: HashMap<String, SectionExtraction>,
}

fn cache_path(project_root: &Path) -> std::path::PathBuf {
    project_root
        .join(".emb-agent")
        .join("cache")
        .join("knowledge")
        .join("extract.json")
}

fn load_cache(project_root: &Path) -> ExtractCache {
    fs::read_to_string(cache_path(project_root))
        .ok()
        .and_then(|raw| serde_json::from_str::<ExtractCache>(&raw).ok())
        .filter(|c| c.version == EXTRACT_CACHE_VERSION)
        .unwrap_or(ExtractCache {
            version: EXTRACT_CACHE_VERSION,
            model: String::new(),
            sections: HashMap::new(),
        })
}

fn save_cache(project_root: &Path, cache: &ExtractCache) -> Result<(), String> {
    let path = cache_path(project_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(cache).unwrap_or_default(),
    )
    .map_err(|e| format!("write extract cache: {e}"))
}

fn stable_hash(text: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    h.finish()
}

const SCHEMA_PROMPT: &str = r#"You are an embedded-systems knowledge extractor. Given a section of a datasheet/manual/wiki, extract structured entities.

Return ONLY a JSON object:
{
  "entities": [
    {
      "entity_type": "register" | "field" | "peripheral" | "signal" | "formula" | "constraint" | "concept",
      "name": "<original name as written>",
      "summary": "<one short sentence: what it is / does>",
      "canonical": "<lowercase canonical id without vendor prefixes, e.g. 'wdtcon' or 'pwm_period'; empty string if unsure>",
      "fields": {"<field_name>": "<value as string>", ...},
      "confidence": <0.0-1.0>
    }
  ]
}

Rules:
- Extract only entities actually present in the text. Do not invent.
- `fields` examples: register -> {"address":"0x...","reset_value":"0x1F","bank":"..."}; formula -> {"expression":"T = PS * Tosc","variables":"PS,Tosc"}; constraint -> {"limit":"16mA","resource":"GPIO sink"}.
- `canonical` is the cross-document key: strip vendor prefixes (STM32 HAL_ / PIC _REG), lowercase, alnum+underscore only.
- confidence: 0.9+ for explicit definitions/tables; 0.6-0.9 for clear mentions; <0.6 for vague references (then leave canonical empty).
- Skip generic tokens like "the", "register", "bit" as standalone entities.
- Return {"entities": []} if the section has no hardware entities."#;

fn build_prompt(section: &super::align::SectionInput) -> String {
    let span = if let (Some(s), Some(e)) = (section.page_start, section.page_end) {
        format!(" (pp. {s}-{e})")
    } else if let Some(ln) = section.line_num {
        format!(" (line {ln})")
    } else {
        String::new()
    };
    format!(
        "{SCHEMA_PROMPT}\n\nSection title: {title}{span}\nSection text:\n{text}",
        title = section.title,
        span = span,
        text = section.text
    )
}

/// Extract entities for a batch of sections, using the cache to skip unchanged
/// sections. Returns the full extraction map (cached + fresh).
pub fn extract_sections(
    project_root: &Path,
    cfg: &LlmConfig,
    sections: &[super::align::SectionInput],
) -> Result<Vec<SectionExtraction>, String> {
    let mut cache = load_cache(project_root);
    if !cfg.model.is_empty() {
        // Invalidate cache if the model changed.
        if cache.model != cfg.model {
            cache.sections.clear();
            cache.model = cfg.model.clone();
        }
    }

    let mut out: Vec<SectionExtraction> = Vec::with_capacity(sections.len());
    for section in sections {
        let hash = stable_hash(&section.text);
        let cache_key = format!("{}:{}", section.doc_id, section.section_path);
        if let Some(cached) = cache.sections.get(&cache_key)
            && cached.hash == hash
        {
            out.push(cached.clone());
            continue;
        }

        let prompt = build_prompt(section);
        let resp = match complete(cfg, &prompt) {
            Ok(r) => r,
            Err(e) => {
                // Don't fail the whole batch on one section; record empty.
                eprintln!("pageindex-extract: section {} failed: {e}", cache_key);
                let extraction = SectionExtraction {
                    doc_id: section.doc_id.clone(),
                    section_path: section.section_path.clone(),
                    title: section.title.clone(),
                    page_start: section.page_start,
                    page_end: section.page_end,
                    line_num: section.line_num,
                    entities: Vec::new(),
                    model: cfg.model.clone(),
                    hash,
                };
                cache.sections.insert(cache_key.clone(), extraction.clone());
                out.push(extraction);
                continue;
            }
        };
        let parsed = extract_json(&resp);
        let entities = parse_entities(parsed.get("entities"));
        let extraction = SectionExtraction {
            doc_id: section.doc_id.clone(),
            section_path: section.section_path.clone(),
            title: section.title.clone(),
            page_start: section.page_start,
            page_end: section.page_end,
            line_num: section.line_num,
            entities,
            model: cfg.model.clone(),
            hash,
        };
        cache.sections.insert(cache_key.clone(), extraction.clone());
        out.push(extraction);
    }
    save_cache(project_root, &cache)?;
    Ok(out)
}

fn parse_entities(value: Option<&Value>) -> Vec<ExtractedEntity> {
    let Some(arr) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let entity_type = item.get("entity_type").and_then(Value::as_str)?.to_string();
            let name = item.get("name").and_then(Value::as_str)?.to_string();
            if name.trim().is_empty() {
                return None;
            }
            let mut fields = HashMap::new();
            if let Some(obj) = item.get("fields").and_then(Value::as_object) {
                for (k, v) in obj {
                    let vs = match v {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    fields.insert(k.clone(), vs);
                }
            }
            Some(ExtractedEntity {
                entity_type,
                name,
                summary: item
                    .get("summary")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                canonical: canonicalize(
                    item.get("canonical").and_then(Value::as_str).unwrap_or(""),
                ),
                fields,
                confidence: item
                    .get("confidence")
                    .and_then(Value::as_f64)
                    .map(|f| f as f32)
                    .unwrap_or(0.5),
            })
        })
        .collect()
}

/// Lowercase, alnum+underscore only. Collapses consecutive underscores. Empty stays empty.
fn canonicalize(s: &str) -> String {
    let mut prev_underscore = false;
    let c: String = s
        .trim()
        .to_lowercase()
        .chars()
        .filter_map(|ch| {
            if ch.is_ascii_alphanumeric() {
                prev_underscore = false;
                Some(ch)
            } else if !prev_underscore {
                prev_underscore = true;
                Some('_')
            } else {
                None
            }
        })
        .collect();
    c.trim_matches('_').to_string()
}

/// Build a graph node id for an entity: `<entity_type>:<canonical>` (or
/// `<entity_type>:<name-lowercased>` if canonical is empty).
pub fn entity_node_id(entity: &ExtractedEntity) -> String {
    let key = if entity.canonical.is_empty() {
        canonicalize(&entity.name)
    } else {
        entity.canonical.clone()
    };
    if key.is_empty() {
        format!("{}:{}", entity.entity_type, stable_hash(&entity.name))
    } else {
        format!("{}:{}", entity.entity_type, key)
    }
}

/// Sanity self-test of the entity parser.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_entities_handles_full_and_partial() {
        let v = json!({"entities": [
            {"entity_type":"register","name":"WDTCON","summary":"WDT control","canonical":"wdtcon","fields":{"reset_value":"0x1F"},"confidence":0.9},
            {"entity_type":"formula","name":"T=PS*Tosc","canonical":"","fields":{"expression":"T=PS*Tosc"},"confidence":0.8},
            {"entity_type":"register","name":"","canonical":"x"}
        ]});
        let entities = parse_entities(v.get("entities"));
        assert_eq!(entities.len(), 2);
        assert_eq!(entities[0].canonical, "wdtcon");
        assert_eq!(
            entities[0].fields.get("reset_value").map(|s| s.as_str()),
            Some("0x1F")
        );
        assert!(entities[1].canonical.is_empty());
        assert_eq!(entity_node_id(&entities[1]), "formula:t_ps_tosc");
    }

    #[test]
    fn canonicalize_strips_punctuation_and_case() {
        assert_eq!(canonicalize("WDT_CON"), "wdt_con");
        assert_eq!(canonicalize("HAL_GPIOA->BSRR"), "hal_gpioa_bsrr");
        assert_eq!(canonicalize(""), "");
    }

    #[test]
    fn entity_node_id_falls_back_to_hash() {
        let e = ExtractedEntity {
            entity_type: "concept".into(),
            name: "".into(),
            summary: "".into(),
            canonical: "".into(),
            fields: HashMap::new(),
            confidence: 0.1,
        };
        let id = entity_node_id(&e);
        assert!(id.starts_with("concept:"));
    }
}
