//! Cross-document alignment: canonicalization, synonym merging, and conflict
//! detection across truth files, wiki, and datasheet extractions.
//!
//! Produces `equivalent_to` edges between entities that are the same hardware
//! object under different names (e.g. STM32 `IWDG_KR` ≡ PIC `WDTCON` for the
//! "watchdog key register" role), and `conflicts` records when the same
//! canonical entity has divergent numeric/string fields across sources. Both
//! are surfaced as graph edges with explicit `basis` so reviewers can tell
//! LLM-synthesized equivalence from confirmed truth.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use super::extract::{ExtractedEntity, SectionExtraction};
use super::llm::{LlmConfig, complete, extract_json};

/// A section to extract from (produced by the caller from PageIndex trees,
/// wiki pages, truth files, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionInput {
    pub doc_id: String,
    pub section_path: String,
    pub title: String,
    pub text: String,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub line_num: Option<usize>,
    /// Source kind: "datasheet" | "wiki" | "truth" | "compound" | "task".
    pub source_kind: String,
}

/// An `equivalent_to` relationship between two entity node ids.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Equivalence {
    pub from: String,
    pub to: String,
    pub role: String,
    pub basis: String,
    pub confidence: f32,
}

/// A field conflict between two extractions of the same canonical entity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conflict {
    pub canonical: String,
    pub entity_type: String,
    pub field: String,
    pub value_a: String,
    pub source_a: String,
    pub value_b: String,
    pub source_b: String,
    pub basis: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlignmentReport {
    pub equivalences: Vec<Equivalence>,
    pub conflicts: Vec<Conflict>,
    pub canonical_counts: HashMap<String, usize>,
    pub llm_used: bool,
}

const ALIGN_PROMPT: &str = r#"You are an embedded-hardware ontology aligner. You are given a list of entities extracted from multiple documents, each with a canonical id, entity_type, name, summary, and source. Group entities that refer to the SAME hardware role/object across vendors or docs.

Return ONLY JSON:
{
  "equivalences": [
    {"from": "<canonical-a>", "to": "<canonical-b>", "role": "<shared role, e.g. 'watchdog key register'>", "confidence": <0.0-1.0>}
  ]
}

Rules:
- Only group entities of the same entity_type.
- `from`/`to` are canonical ids from the input.
- Group by functional role, not by name similarity. e.g. IWDG_KR (STM32 watchdog key) and WDTCON (PIC watchdog control) may share role "watchdog control register" if their summaries agree.
- confidence: 0.9+ when summaries+fields clearly match the same role; 0.6-0.9 for likely; <0.6 skip (do not emit).
- Do NOT group a register with a peripheral or a formula.
- Return {"equivalences": []} if none."#;

/// Run alignment over a set of extractions. Canonicalization is already done
/// per-entity by the extractor; here we (1) bucket by canonical id to find
/// field conflicts, and (2) call the LLM once to propose cross-canonical
/// equivalences.
pub fn align(
    project_root: &Path,
    cfg: &LlmConfig,
    extractions: &[SectionExtraction],
) -> Result<AlignmentReport, String> {
    // project_root is reserved for future per-project extraction policy hooks;
    // the LLM config is caller-supplied so this fn stays embedding-free.
    let _ = project_root;
    // 1. Bucket entities by canonical id -> detect field conflicts.
    //    key: canonical (or name-fallback), value: Vec<(source, entity)>
    let mut by_canonical: HashMap<String, Vec<(String, ExtractedEntity)>> = HashMap::new();
    let mut canonical_counts: HashMap<String, usize> = HashMap::new();
    for ext in extractions {
        let source = format!("{}:{}", ext.doc_id, ext.section_path);
        for entity in &ext.entities {
            let key = if entity.canonical.is_empty() {
                super::extract::entity_node_id(entity)
            } else {
                entity.canonical.clone()
            };
            *canonical_counts.entry(key.clone()).or_default() += 1;
            by_canonical
                .entry(key)
                .or_default()
                .push((source.clone(), entity.clone()));
        }
    }

    let mut conflicts = Vec::new();
    for (canonical, entries) in &by_canonical {
        if entries.len() < 2 {
            continue;
        }
        // Compare each named field across entries; flag divergent non-empty values.
        let mut field_values: HashMap<String, Vec<(String, String)>> = HashMap::new();
        for (source, entity) in entries {
            for (field, value) in &entity.fields {
                if value.trim().is_empty() {
                    continue;
                }
                field_values
                    .entry(field.clone())
                    .or_default()
                    .push((source.clone(), value.clone()));
            }
        }
        let entity_type = entries[0].1.entity_type.clone();
        for (field, values) in &field_values {
            if values.len() < 2 {
                continue;
            }
            // Normalize for comparison (trim, lowercase).
            let first = values[0].clone();
            for second in values.iter().skip(1) {
                if norm(&first.1) != norm(&second.1) {
                    conflicts.push(Conflict {
                        canonical: canonical.clone(),
                        entity_type: entity_type.clone(),
                        field: field.clone(),
                        value_a: first.1.clone(),
                        source_a: first.0.clone(),
                        value_b: second.1.clone(),
                        source_b: second.0.clone(),
                        basis: "FIELD_DIVERGENCE".to_string(),
                    });
                    break; // one conflict per field is enough
                }
            }
        }
    }

    // 2. LLM cross-canonical equivalence proposal.
    let (equivalences, llm_used) = if cfg.available() {
        let prompt = build_align_prompt(extractions);
        match complete(cfg, &prompt) {
            Ok(resp) => {
                let parsed = extract_json(&resp);
                let equivs = parse_equivalences(parsed.get("equivalences"));
                (equivs, true)
            }
            Err(e) => {
                eprintln!("pageindex-align: LLM equivalence step failed: {e}");
                (Vec::new(), false)
            }
        }
    } else {
        (Vec::new(), false)
    };

    Ok(AlignmentReport {
        equivalences,
        conflicts,
        canonical_counts,
        llm_used,
    })
}

fn norm(s: &str) -> String {
    s.trim().to_lowercase().replace([' ', '_'], "")
}

fn build_align_prompt(extractions: &[SectionExtraction]) -> String {
    // Flatten to a compact entity list for the LLM.
    let mut entities: Vec<Value> = Vec::new();
    for ext in extractions {
        let source = format!("{}:{}", ext.doc_id, ext.section_path);
        for entity in &ext.entities {
            if entity.canonical.is_empty() || entity.confidence < 0.6 {
                continue;
            }
            entities.push(json!({
                "canonical": entity.canonical,
                "entity_type": entity.entity_type,
                "name": entity.name,
                "summary": entity.summary,
                "source": source,
            }));
        }
    }
    // Cap to keep the prompt bounded.
    entities.truncate(120);
    format!(
        "{ALIGN_PROMPT}\n\nEntities:\n{}",
        serde_json::to_string_pretty(&Value::Array(entities)).unwrap_or_default()
    )
}

fn parse_equivalences(value: Option<&Value>) -> Vec<Equivalence> {
    let Some(arr) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let from = item.get("from").and_then(Value::as_str)?.to_string();
            let to = item.get("to").and_then(Value::as_str)?.to_string();
            if from == to || from.is_empty() || to.is_empty() {
                return None;
            }
            let confidence = item
                .get("confidence")
                .and_then(Value::as_f64)
                .map(|f| f as f32)
                .unwrap_or(0.5);
            if confidence < 0.6 {
                return None;
            }
            Some(Equivalence {
                from,
                to,
                role: item
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                basis: "LLM_EQUIVALENCE".to_string(),
                confidence,
            })
        })
        .collect()
}

/// Persist the alignment report to `.emb-agent/graph/alignment.json`.
pub fn save_report(project_root: &Path, report: &AlignmentReport) -> Result<(), String> {
    let path = project_root
        .join(".emb-agent")
        .join("graph")
        .join("alignment.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    fs::write(
        &path,
        serde_json::to_string_pretty(report).unwrap_or_default(),
    )
    .map_err(|e| format!("write alignment.json: {e}"))
}

/// Load a previously saved alignment report.
pub fn load_report(project_root: &Path) -> Option<AlignmentReport> {
    let path = project_root
        .join(".emb-agent")
        .join("graph")
        .join("alignment.json");
    serde_json::from_str::<AlignmentReport>(&fs::read_to_string(path).ok()?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn entity(canonical: &str, etype: &str, fields: &[(&str, &str)]) -> ExtractedEntity {
        let mut m = HashMap::new();
        for (k, v) in fields {
            m.insert(k.to_string(), v.to_string());
        }
        ExtractedEntity {
            entity_type: etype.to_string(),
            name: canonical.to_string(),
            summary: String::new(),
            canonical: canonical.to_string(),
            fields: m,
            confidence: 0.9,
        }
    }

    fn ext(doc: &str, path: &str, entities: Vec<ExtractedEntity>) -> SectionExtraction {
        SectionExtraction {
            doc_id: doc.to_string(),
            section_path: path.to_string(),
            title: path.to_string(),
            page_start: Some(1),
            page_end: Some(2),
            line_num: None,
            entities,
            model: "test".to_string(),
            hash: 0,
        }
    }

    #[test]
    fn detects_field_conflict_across_sources() {
        let extractions = vec![
            ext(
                "ds_a",
                "1",
                vec![entity("wdtcon", "register", &[("reset_value", "0x1F")])],
            ),
            ext(
                "ds_b",
                "2",
                vec![entity("wdtcon", "register", &[("reset_value", "0x00")])],
            ),
        ];
        // Use a dummy project root in tempdir; align() only reads LLM config, which we skip.
        let tmp = std::env::temp_dir().join("align_test_conflict");
        let _ = std::fs::remove_dir_all(&tmp);
        let cfg = LlmConfig {
            api_base: String::new(),
            api_key: String::new(),
            model: String::new(),
        };
        let report = align(&tmp, &cfg, &extractions).unwrap();
        assert_eq!(report.conflicts.len(), 1);
        assert_eq!(report.conflicts[0].field, "reset_value");
        assert_eq!(report.conflicts[0].value_a, "0x1F");
        assert_eq!(report.conflicts[0].value_b, "0x00");
        assert!(!report.llm_used);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn no_conflict_when_values_agree() {
        let extractions = vec![
            ext(
                "ds_a",
                "1",
                vec![entity("wdtcon", "register", &[("reset_value", "0x1F")])],
            ),
            ext(
                "ds_b",
                "2",
                vec![entity("wdtcon", "register", &[("reset_value", "0x1f")])],
            ),
        ];
        let tmp = std::env::temp_dir().join("align_test_agree");
        let _ = std::fs::remove_dir_all(&tmp);
        let cfg = LlmConfig {
            api_base: String::new(),
            api_key: String::new(),
            model: String::new(),
        };
        let report = align(&tmp, &cfg, &extractions).unwrap();
        assert!(report.conflicts.is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn parse_equivalences_filters_low_confidence_and_self() {
        let v = json!({"equivalences": [
            {"from":"wdtcon","to":"iwdg_kr","role":"watchdog control register","confidence":0.9},
            {"from":"x","to":"x","role":"","confidence":0.99},
            {"from":"a","to":"b","role":"","confidence":0.4}
        ]});
        let equivs = parse_equivalences(v.get("equivalences"));
        assert_eq!(equivs.len(), 1);
        assert_eq!(equivs[0].from, "wdtcon");
        assert_eq!(equivs[0].role, "watchdog control register");
    }
}
