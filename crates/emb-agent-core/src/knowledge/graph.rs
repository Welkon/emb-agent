use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use crate::compound::extract_yaml_field;

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
    hot.sort_by(|a, b| b.1.cmp(&a.1));

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
pub fn refresh_graph(project_root: &Path) -> Result<KnowledgeGraph, String> {
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

            // Edge: task → related files
            if let Some(refs) = task["references"].as_array() {
                for r in refs {
                    if let Some(path_str) = r.as_str() {
                        edges.push(GraphEdge {
                            from: id.clone(),
                            to: format!("file:{path_str}"),
                            edge_type: "references".to_string(),
                            label: String::new(),
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

    // Count ambiguous edges (edges without explicit types)
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
