use crate::compound::extract_yaml_field;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Knowledge graph node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub label: String,
    pub summary: String,
    pub status: String,
    #[serde(default)]
    pub category: String,
}

/// Knowledge graph edge
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    #[serde(rename = "type")]
    pub edge_type: String,
    pub label: String,
    /// Provenance basis: HEURISTIC (regex/keyword), LLM_SCHEMA (extracted by
    /// the LLM extractor), LLM_EQUIVALENCE (aligned by the aligner),
    /// FIELD_DIVERGENCE (conflict), or TRUTH (from a confirmed truth file).
    #[serde(default)]
    pub basis: String,
    /// Confidence in [0,1] for LLM-synthesized edges; 1.0 for truth-derived.
    #[serde(default)]
    pub confidence: f32,
}

/// Full knowledge graph
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeGraph {
    pub version: u32,
    pub generated_at: String,
    pub graph_dir: String,
    pub stats: GraphStats,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub manifest: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphStats {
    pub nodes: usize,
    pub edges: usize,
    pub ambiguous_edges: usize,
    #[serde(rename = "by_type")]
    pub by_type: HashMap<String, usize>,
}

/// Load existing graph.json
pub fn load_graph(project_root: &Path) -> Result<KnowledgeGraph, String> {
    let path = project_root
        .join(".emb-agent")
        .join("graph")
        .join("graph.json");
    if !path.exists() {
        return Err(
            "graph.json not found. Trigger `/emb:knowledge graph refresh` first.".to_string(),
        );
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read error: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("parse error: {e}"))
}

/// Query graph for nodes matching a term
pub fn query_graph(project_root: &Path, query: &str) -> Result<serde_json::Value, String> {
    let graph = load_graph(project_root)?;
    let lower = query.to_lowercase();

    let matching_nodes: Vec<&GraphNode> = graph
        .nodes
        .iter()
        .filter(|n| {
            n.id.to_lowercase().contains(&lower)
                || n.label.to_lowercase().contains(&lower)
                || n.summary.to_lowercase().contains(&lower)
        })
        .take(20)
        .collect();

    let matching_edges: Vec<&GraphEdge> = graph
        .edges
        .iter()
        .filter(|e| {
            e.from.to_lowercase().contains(&lower)
                || e.to.to_lowercase().contains(&lower)
                || e.label.to_lowercase().contains(&lower)
        })
        .take(20)
        .collect();

    Ok(serde_json::json!({
        "query": query,
        "nodes_found": matching_nodes.len(),
        "edges_found": matching_edges.len(),
        "nodes": matching_nodes,
        "edges": matching_edges,
    }))
}

/// Explain a graph node by its ID
pub fn explain_graph(project_root: &Path, node_id: &str) -> Result<serde_json::Value, String> {
    let graph = load_graph(project_root)?;

    let node = graph
        .nodes
        .iter()
        .find(|n| n.id == node_id)
        .ok_or(format!("Node not found: {node_id}"))?;

    let incoming: Vec<&GraphEdge> = graph.edges.iter().filter(|e| e.to == node_id).collect();
    let outgoing: Vec<&GraphEdge> = graph.edges.iter().filter(|e| e.from == node_id).collect();

    Ok(serde_json::json!({
        "node": node,
        "incoming_edges": incoming.len(),
        "outgoing_edges": outgoing.len(),
        "incoming": incoming,
        "outgoing": outgoing,
    }))
}

/// Generate graph report from existing graph.json
pub fn graph_report(project_root: &Path) -> Result<String, String> {
    let graph = load_graph(project_root)?;

    let mut report = String::new();
    report.push_str("# Knowledge Graph Report\n\n");
    report.push_str(&format!("Generated: {}\n\n", graph.generated_at));
    report.push_str("## Summary\n\n");
    report.push_str(&format!("- Nodes: {}\n", graph.stats.nodes));
    report.push_str(&format!("- Edges: {}\n", graph.stats.edges));
    report.push_str(&format!(
        "- Ambiguous edges: {}\n\n",
        graph.stats.ambiguous_edges
    ));
    report.push_str("## Node Types\n\n");
    for (typ, count) in &graph.stats.by_type {
        report.push_str(&format!("- {typ}: {count}\n"));
    }
    report.push_str("\n## Hot Nodes\n\n");

    // Find nodes with most edges
    let mut node_degrees: HashMap<&str, usize> = HashMap::new();
    for e in &graph.edges {
        *node_degrees.entry(&e.from).or_default() += 1;
        *node_degrees.entry(&e.to).or_default() += 1;
    }
    let mut hot: Vec<_> = node_degrees.into_iter().collect();
    hot.sort_by_key(|(_, degree)| std::cmp::Reverse(*degree));

    for (node_id, degree) in hot.iter().take(10) {
        if let Some(node) = graph.nodes.iter().find(|n| n.id == *node_id) {
            report.push_str(&format!("- {} ({}) - {}.\n", node_id, degree, node.summary));
        }
    }

    // Write report back
    let report_path = project_root
        .join(".emb-agent")
        .join("graph")
        .join("GRAPH_REPORT.md");
    fs::write(&report_path, &report).map_err(|e| format!("write error: {e}"))?;

    Ok(report)
}

/// Refresh/build graph by scanning project files
/// LLM-schema enrichment: when an LLM is configured, run the schema extractor
/// over each `doc_section` node's text (loaded from the cached PageIndex
/// `structure.json`) and inject structured entities as graph nodes/edges with
/// `basis: LLM_SCHEMA`. Then run the aligner to add `equivalent_to` edges
/// (`basis: LLM_EQUIVALENCE`) and persist conflicts to `alignment.json`.
/// When no LLM is configured, this is a no-op and the heuristic extraction
/// already done in `refresh_graph` stands.
fn enrich_with_llm(
    project_root: &Path,
    nodes: &mut Vec<GraphNode>,
    edges: &mut Vec<GraphEdge>,
    by_type: &mut HashMap<String, usize>,
) {
    let cfg = crate::knowledge::llm::resolve_llm_config(project_root);
    if !cfg.available() {
        return;
    }

    // Gather doc_section nodes and their text from the cached structure.json.
    // doc_section node id format: "doc_section:<doc_id>:<path>".
    let mut sections: Vec<crate::knowledge::align::SectionInput> = Vec::new();
    let mut doc_section_ids: Vec<String> = Vec::new();
    for node in nodes.iter().filter(|n| n.node_type == "doc_section") {
        // id = doc_section:<doc_id>:<rest>
        let parts: Vec<&str> = node.id.splitn(3, ':').collect();
        if parts.len() < 3 {
            continue;
        }
        let doc_id = parts[1];
        let section_path = parts[2];
        let structure = crate::lookup::pageindex::load_structure(project_root, doc_id).ok();
        let text = structure
            .as_ref()
            .and_then(|s| {
                crate::lookup::pageindex::collect_sections(s)
                    .into_iter()
                    .find(|sec| sec.path == section_path)
            })
            .map(|sec| sec.text)
            .unwrap_or_default();
        if text.trim().is_empty() {
            continue;
        }
        let (page_start, page_end) =
            parse_page_span_from_summary(&node.summary).unwrap_or((None, None));
        sections.push(crate::knowledge::align::SectionInput {
            doc_id: doc_id.to_string(),
            section_path: section_path.to_string(),
            title: node.label.clone(),
            text,
            page_start,
            page_end,
            line_num: None,
            source_kind: "datasheet".to_string(),
        });
        doc_section_ids.push(node.id.clone());
    }
    if sections.is_empty() {
        return;
    }

    let extractions =
        match crate::knowledge::extract::extract_sections(project_root, &cfg, &sections) {
            Ok(e) => e,
            Err(e) => {
                eprintln!("pageindex-graph: LLM enrichment failed: {e}");
                return;
            }
        };

    // Inject entities as nodes + doc_section -> entity edges.
    let mut existing_ids: std::collections::HashSet<String> =
        nodes.iter().map(|n| n.id.clone()).collect();
    for (ext, section_node_id) in extractions.iter().zip(doc_section_ids.iter()) {
        for entity in &ext.entities {
            let eid = crate::knowledge::extract::entity_node_id(entity);
            if !existing_ids.contains(&eid) {
                nodes.push(GraphNode {
                    id: eid.clone(),
                    node_type: entity.entity_type.clone(),
                    label: entity.name.clone(),
                    summary: entity.summary.clone(),
                    status: "extracted".to_string(),
                    category: "llm-schema".to_string(),
                });
                *by_type.entry(entity.entity_type.clone()).or_default() += 1;
                existing_ids.insert(eid.clone());
            }
            edges.push(GraphEdge {
                from: section_node_id.clone(),
                to: eid,
                edge_type: "mentions".to_string(),
                label: entity.entity_type.clone(),
                basis: "LLM_SCHEMA".to_string(),
                confidence: entity.confidence,
            });
        }
    }

    // Align: equivalences + conflicts.
    let report = match crate::knowledge::align::align(project_root, &cfg, &extractions) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("pageindex-graph: alignment failed: {e}");
            return;
        }
    };
    for eq in &report.equivalences {
        let from_id = ensure_entity_node_id(&eq.from, nodes, by_type);
        let to_id = ensure_entity_node_id(&eq.to, nodes, by_type);
        edges.push(GraphEdge {
            from: from_id,
            to: to_id,
            edge_type: "equivalent_to".to_string(),
            label: eq.role.clone(),
            basis: "LLM_EQUIVALENCE".to_string(),
            confidence: eq.confidence,
        });
    }
    let _ = crate::knowledge::align::save_report(project_root, &report);
}

/// Parse "pp. 12-14" / "line 7" from a doc_section summary to recover page
/// span. Best-effort; returns None on miss.
fn parse_page_span_from_summary(summary: &str) -> Option<(Option<usize>, Option<usize>)> {
    // "(pp. 12-14)" or "(pp. 12-14"
    let lower = summary.to_lowercase();
    let start = lower.find("pp.")?;
    let rest = &summary[start + 3..];
    let nums: Vec<&str> = rest
        .split(|c: char| !c.is_ascii_digit() && c != '-')
        .filter(|s| !s.is_empty())
        .collect();
    if nums.is_empty() {
        return None;
    }
    let s: usize = nums[0].parse().ok()?;
    let e: usize = nums.get(1).and_then(|n| n.parse().ok()).unwrap_or(s);
    Some((Some(s), Some(e)))
}

/// Ensure an entity node exists for a canonical id; create a placeholder if not.
fn ensure_entity_node_id(
    canonical: &str,
    nodes: &mut Vec<GraphNode>,
    by_type: &mut HashMap<String, usize>,
) -> String {
    // canonical may already be a full node id like "register:wdtcon" or a bare
    // "wdtcon". Normalize to a best-guess id by trying common entity types.
    if nodes.iter().any(|n| n.id == canonical) {
        return canonical.to_string();
    }
    // Try entity-type-prefixed forms.
    for etype in [
        "register",
        "peripheral",
        "signal",
        "formula",
        "constraint",
        "concept",
        "field",
    ] {
        let candidate = format!("{etype}:{canonical}");
        if let Some(n) = nodes.iter().find(|n| n.id == candidate) {
            return n.id.clone();
        }
    }
    // Fallback: create a generic concept node under the canonical id.
    let id = if canonical.contains(':') {
        canonical.to_string()
    } else {
        format!("concept:{canonical}")
    };
    nodes.push(GraphNode {
        id: id.clone(),
        node_type: "concept".to_string(),
        label: canonical.to_string(),
        summary: String::new(),
        status: "aligned".to_string(),
        category: "llm-equivalence".to_string(),
    });
    *by_type.entry("concept".to_string()).or_default() += 1;
    id
}

pub fn refresh_graph(project_root: &Path) -> Result<KnowledgeGraph, String> {
    refresh_graph_with_enrichment(project_root, false)
}

pub fn refresh_graph_with_enrichment(
    project_root: &Path,
    enrich: bool,
) -> Result<KnowledgeGraph, String> {
    let ext_dir = project_root.join(".emb-agent");
    let graph_dir = ext_dir.join("graph");
    fs::create_dir_all(&graph_dir).map_err(|e| format!("mkdir error: {e}"))?;

    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut by_type: HashMap<String, usize> = HashMap::new();

    // Scan schematics cache for components and nets
    let schem_dir = ext_dir.join("cache").join("schematics");
    if schem_dir.exists() {
        for entry in walk_dirs(&schem_dir) {
            let parsed_path = entry.join("parsed.json");
            if !parsed_path.exists() {
                continue;
            }
            let content = fs::read_to_string(&parsed_path).unwrap_or_default();
            let parsed: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();

            // Components
            if let Some(comps) = parsed["components"].as_array() {
                for c in comps {
                    let des = c["designator"].as_str().unwrap_or("?");
                    let val = c["value"].as_str().unwrap_or("");
                    let id = format!("component:{des}");
                    nodes.push(GraphNode {
                        id: id.clone(),
                        node_type: "component".to_string(),
                        label: des.to_string(),
                        summary: val.to_string(),
                        status: "candidate".to_string(),
                        category: String::new(),
                    });
                    *by_type.entry("component".to_string()).or_default() += 1;

                    // Edge: component → net (from pins)
                    if let Some(pins) = c["pins"].as_array() {
                        for p in pins {
                            if let Some(net) = p["net"].as_str()
                                && !net.is_empty()
                            {
                                edges.push(GraphEdge {
                                    from: id.clone(),
                                    to: format!("net:{net}"),
                                    edge_type: "connected_to".to_string(),
                                    label: String::new(),
                                    basis: "HEURISTIC".to_string(),
                                    confidence: 1.0,
                                });
                            }
                        }
                    }
                }
            }

            // Nets
            if let Some(nets) = parsed["nets"].as_array() {
                for n in nets {
                    let name = n["name"].as_str().unwrap_or("?");
                    let id = format!("net:{name}");
                    nodes.push(GraphNode {
                        id,
                        node_type: "net".to_string(),
                        label: name.to_string(),
                        summary: String::new(),
                        status: "candidate".to_string(),
                        category: String::new(),
                    });
                    *by_type.entry("net".to_string()).or_default() += 1;
                }
            }
        }
    }

    // Scan tasks
    let tasks_dir = ext_dir.join("tasks");
    if tasks_dir.exists() {
        for entry in walk_dirs(&tasks_dir) {
            let task_path = entry.join("task.json");
            if !task_path.exists() {
                continue;
            }
            let content = fs::read_to_string(&task_path).unwrap_or_default();
            let task: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
            let name = task["name"].as_str().unwrap_or("?");
            let title = task["title"].as_str().unwrap_or("");
            let status = task["status"].as_str().unwrap_or("planning");
            let id = format!("task:{name}");
            nodes.push(GraphNode {
                id: id.clone(),
                node_type: "task".to_string(),
                label: name.to_string(),
                summary: title.to_string(),
                status: status.to_string(),
                category: String::new(),
            });
            *by_type.entry("task".to_string()).or_default() += 1;

            let mut task_text = content.clone();
            for related in ["prd.md", "aar.md", "review.md", "validation.md"] {
                let related_path = entry.join(related);
                if related_path.exists() {
                    task_text.push('\n');
                    task_text.push_str(&fs::read_to_string(&related_path).unwrap_or_default());
                }
            }
            add_text_mentions(
                &mut nodes,
                &mut edges,
                &mut by_type,
                &id,
                &task_text,
                title,
                "task",
            );

            // Edge: task → related files
            if let Some(refs) = task["references"].as_array() {
                for r in refs {
                    if let Some(path_str) = r.as_str() {
                        edges.push(GraphEdge {
                            from: id.clone(),
                            to: format!("file:{path_str}"),
                            edge_type: "references".to_string(),
                            label: String::new(),
                            basis: "TRUTH".to_string(),
                            confidence: 1.0,
                        });
                        *by_type.entry("file".to_string()).or_default() += 1;
                    }
                }
            }
        }
    }

    // Scan wiki pages
    let wiki_dir = ext_dir.join("wiki");
    if wiki_dir.exists() {
        for entry in walk_files(&wiki_dir) {
            if !entry.ends_with(".md") {
                continue;
            }
            let path = Path::new(&entry);
            let name = path.file_stem().unwrap_or_default().to_string_lossy();
            let id = format!("wiki_page:{name}");
            nodes.push(GraphNode {
                id,
                node_type: "wiki_page".to_string(),
                label: name.to_string(),
                summary: entry.clone(),
                status: "active".to_string(),
                category: String::new(),
            });
            *by_type.entry("wiki_page".to_string()).or_default() += 1;
        }
    }

    // Scan compound entries and link to chip peripherals
    let compound_dir = ext_dir.join("compound");
    if compound_dir.exists() {
        for entry in walk_files(&compound_dir) {
            if !entry.ends_with(".md") {
                continue;
            }
            let path = compound_dir.join(&entry);
            let content = fs::read_to_string(&path).unwrap_or_default();
            let slug = extract_yaml_field(&content, "slug");
            let summary = extract_yaml_field(&content, "summary");
            let doc_type = extract_yaml_field(&content, "doc_type");
            let chip = extract_yaml_field(&content, "chip");
            let peripheral = extract_yaml_field(&content, "peripheral");

            let id = format!("compound:{slug}");
            nodes.push(GraphNode {
                id: id.clone(),
                node_type: format!("compound_{}", doc_type),
                label: slug.clone(),
                summary,
                status: "active".to_string(),
                category: String::new(),
            });
            *by_type.entry("compound".to_string()).or_default() += 1;

            // Edge: compound → chip
            if !chip.is_empty() {
                let chip_id = format!("chip:{}", chip.to_lowercase());
                edges.push(GraphEdge {
                    from: id.clone(),
                    to: chip_id.clone(),
                    edge_type: "relates_to".to_string(),
                    label: "chip".to_string(),

                    basis: "HEURISTIC".to_string(),
                    confidence: 1.0,
                });
                // Add chip node if not already present
                if !nodes.iter().any(|n| n.id == chip_id) {
                    nodes.push(GraphNode {
                        id: chip_id.clone(),
                        node_type: "chip".to_string(),
                        label: chip.clone(),
                        summary: format!("Chip referenced by compound: {slug}"),
                        status: "active".to_string(),
                        category: String::new(),
                    });
                    *by_type.entry("chip".to_string()).or_default() += 1;
                }
            }

            // Edge: compound → peripheral (via chip)
            if !peripheral.is_empty() && !chip.is_empty() {
                let chip_id = format!("chip:{}", chip.to_lowercase());
                let periph_id = format!("{}:peripheral:{}", chip_id, peripheral.to_lowercase());
                edges.push(GraphEdge {
                    from: id.clone(),
                    to: periph_id.clone(),
                    edge_type: "uses".to_string(),
                    label: format!("peripheral:{peripheral}"),
                    basis: "HEURISTIC".to_string(),
                    confidence: 1.0,
                });
                // Add peripheral node
                nodes.push(GraphNode {
                    id: periph_id,
                    node_type: "peripheral".to_string(),
                    label: format!("{}::{}", chip, peripheral),
                    summary: format!("Peripheral {} on {}", peripheral, chip),
                    status: "active".to_string(),
                    category: String::new(),
                });
                *by_type.entry("peripheral".to_string()).or_default() += 1;
            }
        }
    }

    // Scan hw.yaml signals
    let hw_path = ext_dir.join("hw.yaml");
    if hw_path.exists() {
        let content = fs::read_to_string(&hw_path).unwrap_or_default();
        let hw_id = "truth:hw".to_string();
        nodes.push(GraphNode {
            id: hw_id.clone(),
            node_type: "truth".to_string(),
            label: "hw.yaml".to_string(),
            summary: "Hardware truth file".to_string(),
            status: "active".to_string(),
            category: String::new(),
        });
        *by_type.entry("truth".to_string()).or_default() += 1;
        add_text_mentions(
            &mut nodes,
            &mut edges,
            &mut by_type,
            &hw_id,
            &content,
            "hw.yaml",
            "truth",
        );
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("- name:") {
                let name = trimmed
                    .trim_start_matches("- name:")
                    .trim()
                    .trim_matches('"');
                let id = format!("signal:{name}");
                nodes.push(GraphNode {
                    id,
                    node_type: "signal".to_string(),
                    label: name.to_string(),
                    summary: "Hardware signal from hw.yaml".to_string(),
                    status: "active".to_string(),
                    category: String::new(),
                });
                *by_type.entry("signal".to_string()).or_default() += 1;
            }
        }
    }

    // Add requirement nodes from req.yaml
    let req_path = ext_dir.join("req.yaml");
    if req_path.exists() {
        let content = fs::read_to_string(&req_path).unwrap_or_default();
        let req_id = "truth:req".to_string();
        nodes.push(GraphNode {
            id: req_id.clone(),
            node_type: "truth".to_string(),
            label: "req.yaml".to_string(),
            summary: "Requirement truth file".to_string(),
            status: "active".to_string(),
            category: String::new(),
        });
        *by_type.entry("truth".to_string()).or_default() += 1;
        add_text_mentions(
            &mut nodes,
            &mut edges,
            &mut by_type,
            &req_id,
            &content,
            "req.yaml",
            "truth",
        );
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("- goal:") {
                let goal = trimmed
                    .trim_start_matches("- goal:")
                    .trim()
                    .trim_matches('"');
                let id = format!("requirement:{goal}");
                nodes.push(GraphNode {
                    id,
                    node_type: "requirement".to_string(),
                    label: goal.chars().take(40).collect::<String>(),
                    summary: goal.to_string(),
                    status: "active".to_string(),
                    category: String::new(),
                });
                *by_type.entry("requirement".to_string()).or_default() += 1;
            }
        }
    }

    // Scan parsed document cache (MinerU/local PDF parses)
    let docs_cache = ext_dir.join("cache").join("docs");
    let doc_index_path = docs_cache.join("index.json");
    if doc_index_path.exists() {
        let content = fs::read_to_string(&doc_index_path).unwrap_or_default();
        let index: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
        if let Some(documents) = index.get("documents").and_then(serde_json::Value::as_array) {
            for doc in documents {
                if doc.get("parsed").and_then(serde_json::Value::as_bool) == Some(false) {
                    continue;
                }
                let doc_id = doc
                    .get("doc_id")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown");
                let title = doc
                    .get("title")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| {
                        doc.pointer("/paths/source")
                            .and_then(serde_json::Value::as_str)
                    })
                    .unwrap_or("parsed document");
                let provider = doc
                    .get("provider")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("cache");
                let markdown = doc
                    .pointer("/paths/markdown")
                    .and_then(serde_json::Value::as_str)
                    .filter(|path| !path.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        let parse_path = ext_dir
                            .join("cache")
                            .join("docs")
                            .join(doc_id)
                            .join("parse.md");
                        parse_path
                            .strip_prefix(project_root)
                            .unwrap_or(&parse_path)
                            .to_string_lossy()
                            .replace('\\', "/")
                    });
                let id = format!("doc_parse:{doc_id}");
                nodes.push(GraphNode {
                    id: id.clone(),
                    node_type: "doc_parse".to_string(),
                    label: title.to_string(),
                    summary: markdown.to_string(),
                    status: "parsed".to_string(),
                    category: provider.to_string(),
                });
                *by_type.entry("doc_parse".to_string()).or_default() += 1;

                if let Some(source) = doc
                    .pointer("/paths/source")
                    .and_then(serde_json::Value::as_str)
                    && !source.is_empty()
                {
                    edges.push(GraphEdge {
                        from: id.clone(),
                        to: format!("file:{source}"),
                        edge_type: "parsed_from".to_string(),
                        label: provider.to_string(),
                        basis: "HEURISTIC".to_string(),
                        confidence: 1.0,
                    });
                }

                let structure_rel = doc
                    .pointer("/paths/structure")
                    .and_then(serde_json::Value::as_str)
                    .filter(|path| !path.is_empty())
                    .map(str::to_string);
                if let Some(structure_rel) = structure_rel {
                    let structure_text =
                        fs::read_to_string(project_root.join(&structure_rel)).unwrap_or_default();
                    if let Ok(structure) =
                        serde_json::from_str::<serde_json::Value>(&structure_text)
                    {
                        let sections = crate::lookup::pageindex::collect_sections(&structure);
                        for section in sections.iter().take(200) {
                            let section_id = format!("doc_section:{doc_id}:{}", section.path);
                            let span_label = if section.is_md {
                                section
                                    .line_num
                                    .map(|n| format!("line {n}"))
                                    .unwrap_or_else(|| "md".to_string())
                            } else {
                                match (section.page_start, section.page_end) {
                                    (Some(s), Some(e)) => format!("pp. {s}–{e}"),
                                    _ => "pdf".to_string(),
                                }
                            };
                            let section_summary = if !section.summary.is_empty() {
                                section.summary.clone()
                            } else {
                                section.title.clone()
                            };
                            nodes.push(GraphNode {
                                id: section_id.clone(),
                                node_type: "doc_section".to_string(),
                                label: section.title.clone(),
                                summary: format!("{section_summary} ({span_label})"),
                                status: "parsed".to_string(),
                                category: provider.to_string(),
                            });
                            *by_type.entry("doc_section".to_string()).or_default() += 1;
                            // Section is part of the doc_parse root.
                            edges.push(GraphEdge {
                                from: section_id.clone(),
                                to: id.clone(),
                                edge_type: "section_of".to_string(),
                                label: span_label.clone(),

                                basis: "HEURISTIC".to_string(),
                                confidence: 1.0,
                            });
                            // Per-section register/concept extraction — evidence
                            // is now section-scoped, not whole-document.
                            add_text_mentions(
                                &mut nodes,
                                &mut edges,
                                &mut by_type,
                                &section_id,
                                &section.text,
                                &section.title,
                                provider,
                            );
                        }
                    }
                } else if !markdown.is_empty() {
                    let parse_text =
                        fs::read_to_string(project_root.join(&markdown)).unwrap_or_default();
                    for symbol in extract_register_like_symbols(&parse_text)
                        .into_iter()
                        .take(80)
                    {
                        let symbol_id = format!("register:{}", symbol.to_lowercase());
                        if !nodes.iter().any(|node| node.id == symbol_id) {
                            nodes.push(GraphNode {
                                id: symbol_id.clone(),
                                node_type: "register".to_string(),
                                label: symbol.clone(),
                                summary: format!("Register-like symbol extracted from {title}"),
                                status: "extracted".to_string(),
                                category: provider.to_string(),
                            });
                            *by_type.entry("register".to_string()).or_default() += 1;
                        }
                        edges.push(GraphEdge {
                            from: id.clone(),
                            to: symbol_id,
                            edge_type: "mentions".to_string(),
                            label: "register".to_string(),

                            basis: "HEURISTIC".to_string(),
                            confidence: 1.0,
                        });
                    }
                    for formula in extract_formula_like_lines(&parse_text).into_iter().take(30) {
                        let formula_id = format!("formula:{}", stable_hash(&formula));
                        nodes.push(GraphNode {
                            id: formula_id.clone(),
                            node_type: "formula".to_string(),
                            label: formula.chars().take(60).collect::<String>(),
                            summary: formula,
                            status: "extracted".to_string(),
                            category: provider.to_string(),
                        });
                        *by_type.entry("formula".to_string()).or_default() += 1;
                        edges.push(GraphEdge {
                            from: id.clone(),
                            to: formula_id,
                            edge_type: "mentions".to_string(),
                            label: "formula".to_string(),

                            basis: "HEURISTIC".to_string(),
                            confidence: 1.0,
                        });
                    }
                    for keyword in extract_domain_keywords(&parse_text).into_iter().take(40) {
                        let keyword_id = format!("concept:{}", keyword.to_lowercase());
                        if !nodes.iter().any(|node| node.id == keyword_id) {
                            nodes.push(GraphNode {
                                id: keyword_id.clone(),
                                node_type: "concept".to_string(),
                                label: keyword.clone(),
                                summary: format!("Domain concept extracted from {title}"),
                                status: "extracted".to_string(),
                                category: provider.to_string(),
                            });
                            *by_type.entry("concept".to_string()).or_default() += 1;
                        }
                        edges.push(GraphEdge {
                            from: id.clone(),
                            to: keyword_id,
                            edge_type: "mentions".to_string(),
                            label: "concept".to_string(),

                            basis: "HEURISTIC".to_string(),
                            confidence: 1.0,
                        });
                    }
                }
            }
        }
    }

    // Optional deep enrichment. Keep default refresh deterministic and fast;
    // callers opt into LLM-schema extraction + cross-document alignment.
    if enrich {
        enrich_with_llm(project_root, &mut nodes, &mut edges, &mut by_type);
    }

    let ambiguous = edges.iter().filter(|e| e.edge_type.is_empty()).count();

    let stats = GraphStats {
        nodes: nodes.len(),
        edges: edges.len(),
        ambiguous_edges: ambiguous,
        by_type,
    };

    let graph = KnowledgeGraph {
        version: 1,
        generated_at: chrono::Utc::now().to_rfc3339(),
        graph_dir: graph_dir.to_string_lossy().to_string(),
        stats,
        nodes,
        edges,
        manifest: serde_json::json!({
            "scan_date": chrono::Utc::now().to_rfc3339(),
            "auto_refresh": true,
        }),
    };

    // Write graph.json
    let graph_path = graph_dir.join("graph.json");
    let json = serde_json::to_string_pretty(&graph).map_err(|e| format!("json error: {e}"))?;
    fs::write(&graph_path, json).map_err(|e| format!("write error: {e}"))?;

    Ok(graph)
}

fn add_text_mentions(
    nodes: &mut Vec<GraphNode>,
    edges: &mut Vec<GraphEdge>,
    by_type: &mut HashMap<String, usize>,
    from_id: &str,
    text: &str,
    title: &str,
    category: &str,
) {
    for symbol in extract_register_like_symbols(text).into_iter().take(40) {
        let symbol_id = format!("register:{}", symbol.to_lowercase());
        if !nodes.iter().any(|node| node.id == symbol_id) {
            nodes.push(GraphNode {
                id: symbol_id.clone(),
                node_type: "register".to_string(),
                label: symbol.clone(),
                summary: format!("Register-like symbol extracted from {title}"),
                status: "extracted".to_string(),
                category: category.to_string(),
            });
            *by_type.entry("register".to_string()).or_default() += 1;
        }
        edges.push(GraphEdge {
            from: from_id.to_string(),
            to: symbol_id,
            edge_type: "mentions".to_string(),
            label: "register".to_string(),

            basis: "HEURISTIC".to_string(),
            confidence: 1.0,
        });
    }
    for keyword in extract_domain_keywords(text).into_iter().take(20) {
        let keyword_id = format!("concept:{}", keyword.to_lowercase());
        if !nodes.iter().any(|node| node.id == keyword_id) {
            nodes.push(GraphNode {
                id: keyword_id.clone(),
                node_type: "concept".to_string(),
                label: keyword.clone(),
                summary: format!("Domain concept extracted from {title}"),
                status: "extracted".to_string(),
                category: category.to_string(),
            });
            *by_type.entry("concept".to_string()).or_default() += 1;
        }
        edges.push(GraphEdge {
            from: from_id.to_string(),
            to: keyword_id,
            edge_type: "mentions".to_string(),
            label: "concept".to_string(),

            basis: "HEURISTIC".to_string(),
            confidence: 1.0,
        });
    }
}

fn extract_register_like_symbols(text: &str) -> Vec<String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for token in text.split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_') {
        let token = token.trim();
        if token.len() < 2 || token.len() > 24 {
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
    rows.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    rows.into_iter().map(|(token, _)| token).collect()
}

fn extract_formula_like_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| {
            line.len() >= 8
                && line.len() <= 180
                && line.contains('=')
                && line
                    .chars()
                    .any(|ch| matches!(ch, '+' | '-' | '*' | '/' | '×' | '÷'))
        })
        .map(str::to_string)
        .collect()
}

fn extract_domain_keywords(text: &str) -> Vec<String> {
    let keywords = [
        "watchdog",
        "WDT",
        "IWDG",
        "WWDG",
        "看门狗",
        "STOP",
        "IDLE",
        "低功耗",
        "PWM",
        "ADC",
        "UART",
        "I2C",
        "SPI",
        "GPIO",
        "IOCA",
        "RA4",
        "WPUA",
        "消抖",
        "按键",
        "唤醒",
        "EEPROM",
        "复位",
        "中断",
    ];
    keywords
        .into_iter()
        .filter(|keyword| text.contains(keyword))
        .map(str::to_string)
        .collect()
}

fn stable_hash(value: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

// === Memory Management ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub id: String,
    pub memory_type: String,
    pub summary: String,
    pub detail: String,
    pub created_at: String,
    pub tags: Vec<String>,
}

/// List memory entries
pub fn memory_list(project_root: &Path) -> Result<Vec<MemoryEntry>, String> {
    let memory_dir = project_root.join(".emb-agent").join("memory");
    if !memory_dir.exists() {
        return Ok(vec![]);
    }
    let mut entries = Vec::new();
    for entry in walk_files(&memory_dir) {
        let path = memory_dir.join(&entry);
        if let Ok(content) = fs::read_to_string(&path)
            && let Ok(mut mem_entries) = serde_json::from_str::<Vec<MemoryEntry>>(&content)
        {
            entries.append(&mut mem_entries);
        }
    }
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

/// Remember a new memory entry
pub fn memory_remember(
    project_root: &Path,
    memory_type: &str,
    summary: &str,
    detail: &str,
) -> Result<String, String> {
    let memory_dir = project_root.join(".emb-agent").join("memory");
    fs::create_dir_all(&memory_dir).map_err(|e| format!("mkdir error: {e}"))?;

    let id = format!("mem-{}", chrono::Utc::now().timestamp_millis());
    let entry = MemoryEntry {
        id: id.clone(),
        memory_type: memory_type.to_string(),
        summary: summary.to_string(),
        detail: detail.to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        tags: vec![],
    };

    let path = memory_dir.join(format!("{}.json", id));
    let json =
        serde_json::to_string_pretty(&vec![entry]).map_err(|e| format!("json error: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write error: {e}"))?;

    Ok(id)
}

// === Wiki Operations ===

/// List wiki pages
pub fn wiki_list(project_root: &Path) -> Result<Vec<WikiPage>, String> {
    let wiki_dir = project_root.join(".emb-agent").join("wiki");
    if !wiki_dir.exists() {
        return Ok(vec![]);
    }
    let mut pages = Vec::new();
    for entry in walk_files(&wiki_dir) {
        if !entry.ends_with(".md") || entry == "index.md" || entry == "log.md" {
            continue;
        }
        let name = Path::new(&entry)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let path = wiki_dir.join(&entry);
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        pages.push(WikiPage {
            name,
            path: entry,
            size,
        });
    }
    Ok(pages)
}

#[derive(Debug, Clone, Serialize)]
pub struct WikiPage {
    pub name: String,
    pub path: String,
    pub size: u64,
}

// === Helpers ===

fn walk_dirs(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                result.push(path.clone());
                result.extend(walk_dirs(&path));
            }
        }
    }
    result
}

fn walk_files(dir: &Path) -> Vec<String> {
    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let sub = walk_files(&path);
                for s in sub {
                    let rel = path.strip_prefix(dir).unwrap_or(&path);
                    let full = rel.join(&s);
                    result.push(full.to_string_lossy().to_string());
                }
            } else if let Ok(rel) = path.strip_prefix(dir) {
                result.push(rel.to_string_lossy().to_string());
            }
        }
    }
    result
}
