//! Unified fusion search — `knowledge ask <query>`.
//!
//! Combines the three retrieval channels into one ranked, cited answer:
//!   1. **vector** hits (chunk RAG over wiki/compound/tasks/PRDs) — caller-supplied
//!   2. **graph** hits (substring over the knowledge graph) — core
//!   3. **tree** hits (PageIndex `doc_section` matching) — core
//!
//! Evidence strength weights the final rank in this order: page-level
//! datasheet sections, then graph nodes, then vector chunks. The optional LLM
//! fusion step writes a short cited answer, replacing the old workflow of
//! running three commands and eyeballing them.

use serde::{Deserialize, Serialize};
use std::path::Path;

use super::llm::{LlmConfig, complete};

/// A vector-channel hit supplied by the caller (the CLI owns the embedding
/// index; core stays embedding-free).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VectorHit {
    pub source_type: String,
    pub path: String,
    pub title: String,
    pub score: f32,
    pub preview: String,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
}

/// One unified hit after fusion ranking.
#[derive(Debug, Clone, Serialize)]
pub struct AskHit {
    pub channel: String,
    pub source_type: String,
    pub path: String,
    pub title: String,
    pub score: f32,
    pub evidence_strength: &'static str,
    pub preview: String,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
    pub node_id: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AskResult {
    pub query: String,
    pub hits: Vec<AskHit>,
    pub llm_used: bool,
    pub answer: Option<String>,
    pub channels: Vec<String>,
}

const EVIDENCE_PAGE: &str = "page";
const EVIDENCE_SECTION: &str = "section";
const EVIDENCE_CHUNK: &str = "chunk";

/// Fuse hits. `vector_hits` is the caller's vector search result (may be
/// empty). `graph_hits` and `tree_sections` are gathered by the caller from
/// core APIs (`query_graph`, `collect_sections` over loaded structures) —
/// keeping the call site explicit about what it fuses.
pub fn ask(
    project_root: &Path,
    query: &str,
    vector_hits: Vec<VectorHit>,
    graph_hits: Vec<GraphHit>,
    tree_sections: Vec<TreeHit>,
    limit: usize,
    cfg: &LlmConfig,
    llm_answer: bool,
) -> Result<AskResult, String> {
    let _ = project_root; // reserved for per-project fusion policy hooks
    let lower = query.to_lowercase();
    let mut hits: Vec<AskHit> = Vec::new();

    // 1. Vector channel -> chunk evidence.
    for v in vector_hits {
        hits.push(AskHit {
            channel: "vector".to_string(),
            source_type: v.source_type,
            path: v.path,
            title: v.title,
            score: v.score * 1.0, // chunk weight = 1.0
            evidence_strength: EVIDENCE_CHUNK,
            preview: v.preview,
            page_start: v.page_start,
            page_end: v.page_end,
            line_start: v.line_start,
            line_end: v.line_end,
            node_id: None,
            reason: "vector+lexical chunk match".to_string(),
        });
    }

    // 2. Graph channel -> section evidence.
    for g in graph_hits {
        hits.push(AskHit {
            channel: "graph".to_string(),
            source_type: g.node_type,
            path: g.source,
            title: g.label,
            score: g.score * 1.5, // section weight = 1.5
            evidence_strength: EVIDENCE_SECTION,
            preview: g.summary,
            page_start: None,
            page_end: None,
            line_start: None,
            line_end: None,
            node_id: Some(g.node_id),
            reason: g.reason,
        });
    }

    // 3. Tree channel -> page evidence (datasheet sections).
    for t in tree_sections {
        let hay = format!("{} {} {}", t.title, t.summary, t.text).to_lowercase();
        let score = tree_section_score(&hay, &lower);
        if score <= 0.0 {
            continue;
        }
        hits.push(AskHit {
            channel: "tree".to_string(),
            source_type: "datasheet".to_string(),
            path: t.structure_path,
            title: t.title,
            score: score * 2.0, // page weight = 2.0
            evidence_strength: EVIDENCE_PAGE,
            preview: truncate(&t.text, 240),
            page_start: t.page_start,
            page_end: t.page_end,
            line_start: None,
            line_end: None,
            node_id: None,
            reason: "tree section match (page-level evidence)".to_string(),
        });
    }

    // De-dup by (channel, path, title) keeping the highest score.
    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut seen: std::collections::HashSet<(String, String, String)> =
        std::collections::HashSet::new();
    hits.retain(|h| {
        let key = (h.channel.clone(), h.path.clone(), h.title.clone());
        if seen.contains(&key) {
            false
        } else {
            seen.insert(key);
            true
        }
    });
    if hits.len() > limit {
        hits.truncate(limit);
    }

    // Optional LLM fusion answer with citations.
    let (llm_used, answer) = if llm_answer && cfg.available() && !hits.is_empty() {
        match synthesize_answer(cfg, query, &hits) {
            Ok(a) => (true, Some(a)),
            Err(e) => {
                eprintln!("pageindex-ask: LLM answer step failed: {e}");
                (true, None)
            }
        }
    } else {
        (false, None)
    };

    Ok(AskResult {
        query: query.to_string(),
        hits,
        llm_used,
        answer,
        channels: vec![
            "vector".to_string(),
            "graph".to_string(),
            "tree".to_string(),
        ],
    })
}

/// A graph-channel hit (caller builds these from `query_graph` output).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphHit {
    pub node_id: String,
    pub node_type: String,
    pub label: String,
    pub summary: String,
    pub source: String,
    pub score: f32,
    pub reason: String,
}

/// A tree-channel hit (caller builds these from loaded PageIndex structures
/// via `collect_sections`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeHit {
    pub doc_id: String,
    pub structure_path: String,
    pub title: String,
    pub summary: String,
    pub text: String,
    pub page_start: Option<usize>,
    pub page_end: Option<usize>,
    pub line_num: Option<usize>,
}

fn tree_section_score(hay: &str, query: &str) -> f32 {
    let terms: Vec<&str> = query.split_whitespace().filter(|t| t.len() >= 2).collect();
    if terms.is_empty() {
        return 0.0;
    }
    let mut matched = 0usize;
    for term in &terms {
        if hay.contains(term) {
            matched += 1;
        }
    }
    (matched as f32) / (terms.len() as f32)
}

fn truncate(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        s.to_string()
    } else {
        let mut t: String = chars[..max].iter().collect();
        t.push('…');
        t
    }
}

fn synthesize_answer(cfg: &LlmConfig, query: &str, hits: &[AskHit]) -> Result<String, String> {
    let mut context = String::new();
    for (i, hit) in hits.iter().take(8).enumerate() {
        let cite = citation(hit);
        context.push_str(&format!(
            "[{}] ({}, {}) {} — {}\n  {}\n\n",
            i + 1,
            hit.channel,
            hit.evidence_strength,
            hit.title,
            cite,
            hit.preview.replace('\n', " ")
        ));
    }
    let prompt = format!(
        "Answer the embedded-engineering question using ONLY the cited evidence below. \
Be concise. Cite as [n]. If the evidence is insufficient, say so and list what's missing.\n\n\
Question: {query}\n\nEvidence:\n{context}",
    );
    let answer = complete(cfg, &prompt)?;
    Ok(answer.trim().to_string())
}

fn citation(hit: &AskHit) -> String {
    let mut parts = Vec::new();
    if !hit.path.is_empty() {
        parts.push(hit.path.clone());
    }
    match (hit.page_start, hit.page_end) {
        (Some(s), Some(e)) if s == e => parts.push(format!("p.{s}")),
        (Some(s), Some(e)) => parts.push(format!("pp.{s}-{e}")),
        _ => {}
    }
    if let (Some(ls), Some(le)) = (hit.line_start, hit.line_end) {
        parts.push(format!("L{ls}-{le}"));
    }
    if parts.is_empty() {
        "no location".to_string()
    } else {
        parts.join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vhit(score: f32, path: &str, title: &str) -> VectorHit {
        VectorHit {
            source_type: "wiki".to_string(),
            path: path.to_string(),
            title: title.to_string(),
            score,
            preview: "preview".to_string(),
            page_start: None,
            page_end: None,
            line_start: None,
            line_end: None,
        }
    }

    fn ghit(score: f32, label: &str, src: &str) -> GraphHit {
        GraphHit {
            node_id: format!("register:{label}"),
            node_type: "register".to_string(),
            label: label.to_string(),
            summary: "sum".to_string(),
            source: src.to_string(),
            score,
            reason: "graph match".to_string(),
        }
    }

    fn thit(title: &str, text: &str, page: usize, path: &str) -> TreeHit {
        TreeHit {
            doc_id: "d1".to_string(),
            structure_path: path.to_string(),
            title: title.to_string(),
            summary: String::new(),
            text: text.to_string(),
            page_start: Some(page),
            page_end: Some(page),
            line_num: None,
        }
    }

    #[test]
    fn fuses_and_ranks_by_evidence_strength() {
        let tmp = std::env::temp_dir().join("ask_test_rank");
        let _ = std::fs::remove_dir_all(&tmp);
        let cfg = LlmConfig {
            api_base: String::new(),
            api_key: String::new(),
            model: String::new(),
        };
        // vector score 0.9 -> 0.9 (chunk)
        // graph  score 0.9 -> 1.35 (section)
        // tree   score 1.0 -> 2.0  (page)  -- but tree score depends on query terms
        let vector = vec![vhit(0.9, "wiki/x.md", "WDT notes")];
        let graph = vec![ghit(0.9, "WDTCON", "ds_a:1")];
        let tree = vec![thit(
            "Watchdog",
            "the watchdog WDTCON resets the chip",
            5,
            "ds_b/structure.json",
        )];
        let result = ask(
            &tmp,
            "watchdog wdtcon",
            vector,
            graph,
            tree,
            10,
            &cfg,
            false,
        )
        .unwrap();
        // Tree (page) should rank first due to 2.0x weight.
        assert_eq!(result.hits[0].channel, "tree");
        assert_eq!(result.hits[0].evidence_strength, EVIDENCE_PAGE);
        assert_eq!(result.hits[0].page_start, Some(5));
        // Graph (section) second, vector (chunk) third.
        assert_eq!(result.hits[1].channel, "graph");
        assert_eq!(result.hits[2].channel, "vector");
        assert!(!result.llm_used);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn dedups_same_channel_path_title() {
        let tmp = std::env::temp_dir().join("ask_test_dedup");
        let _ = std::fs::remove_dir_all(&tmp);
        let cfg = LlmConfig {
            api_base: String::new(),
            api_key: String::new(),
            model: String::new(),
        };
        let vector = vec![
            vhit(0.5, "wiki/x.md", "WDT"),
            vhit(0.9, "wiki/x.md", "WDT"), // dup, higher score should win
        ];
        let result = ask(&tmp, "wdt", vector, vec![], vec![], 10, &cfg, false).unwrap();
        assert_eq!(result.hits.len(), 1);
        assert!((result.hits[0].score - 0.9).abs() < 1e-6);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn tree_section_score_requires_term_overlap() {
        assert!(tree_section_score("watchdog timer control", "watchdog timer") > 0.0);
        assert_eq!(tree_section_score("uart baud rate", "watchdog"), 0.0);
    }
}
