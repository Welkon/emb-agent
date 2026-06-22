// State query helpers for knowledge resurfacing
// Used by: emb status --query, future: emb next (auto intent classification)

use std::fs;
use std::path::Path;

pub fn load_impl_status(project_root: &Path) -> ImplStatusSummary {
    let impl_status_path = project_root.join(".emb-agent/impl_status.yaml");

    if !impl_status_path.exists() {
        return ImplStatusSummary::default();
    }

    let content = match fs::read_to_string(&impl_status_path) {
        Ok(c) => c,
        Err(_) => return ImplStatusSummary::default(),
    };

    let mut summary = ImplStatusSummary::default();
    let mut current_slug = String::new();
    let mut in_decisions = false;

    for line in content.lines() {
        let trimmed = line.trim();

        // Track when we enter the decisions array
        if trimmed == "decisions:" {
            in_decisions = true;
            continue;
        }

        // Only parse within decisions section
        if !in_decisions {
            continue;
        }

        // Parse slug (YAML list item format: "- slug: value" or just "slug: value")
        if trimmed.starts_with("- slug: ") {
            current_slug = trimmed
                .strip_prefix("- slug: ")
                .unwrap_or("")
                .trim()
                .to_string();
        } else if trimmed.starts_with("slug: ") && current_slug.is_empty() {
            current_slug = trimmed
                .strip_prefix("slug: ")
                .unwrap_or("")
                .trim()
                .to_string();
        } else if trimmed.starts_with("status: ") {
            let current_status = trimmed
                .strip_prefix("status: ")
                .unwrap_or("")
                .trim()
                .to_string();
            if !current_slug.is_empty() {
                summary.entries.push(ImplStatusEntry {
                    slug: current_slug.clone(),
                    status: current_status.clone(),
                });
                match current_status.as_str() {
                    "planned" => summary.planned += 1,
                    "implemented" => summary.implemented += 1,
                    "verified" => summary.verified += 1,
                    _ => {}
                }
                current_slug.clear();
            }
        }
    }

    summary
}

pub fn load_recent_compound_decisions(project_root: &Path, days: u64) -> Vec<CompoundDecision> {
    let compound_dir = project_root.join(".emb-agent/compound");

    if !compound_dir.exists() {
        return vec![];
    }

    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        - (days * 86400);

    let mut decisions = Vec::new();

    if let Ok(entries) = fs::read_dir(&compound_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || path.extension().is_none_or(|e| e != "md") {
                continue;
            }

            if let Ok(metadata) = entry.metadata()
                && let Ok(modified) = metadata.modified()
                && let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH)
                && duration.as_secs() < cutoff
            {
                continue;
            }

            let slug = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            // Quick parse for type (decide/learn/trick/trap)
            let decision_type = if slug.contains("decide-") {
                "decide"
            } else if slug.contains("learn-") {
                "learn"
            } else if slug.contains("trick-") {
                "trick"
            } else if slug.contains("trap-") {
                "trap"
            } else {
                "explore"
            };

            decisions.push(CompoundDecision {
                slug,
                decision_type: decision_type.to_string(),
            });
        }
    }

    decisions.sort_by(|a, b| b.slug.cmp(&a.slug)); // Reverse date order
    decisions.truncate(20); // Max 20
    decisions
}

pub fn build_state_answer(
    _project_root: &Path,
    query: &str,
    impl_status: &ImplStatusSummary,
    recent_decisions: &[CompoundDecision],
) -> String {
    let mut answer = String::new();

    // Try to match query to specific topics
    let query_lower = query.to_lowercase();

    if query_lower.contains("watchdog")
        || query_lower.contains("wdt")
        || query_lower.contains("看门狗")
    {
        answer.push_str("**Watchdog status:**\n");
        let wdt_entries: Vec<_> = impl_status
            .entries
            .iter()
            .filter(|e| e.slug.contains("wdt") || e.slug.contains("watchdog"))
            .collect();

        if wdt_entries.is_empty() {
            let wdt_decisions: Vec<_> = recent_decisions
                .iter()
                .filter(|d| d.slug.contains("wdt") || d.slug.contains("watchdog"))
                .collect();

            if wdt_decisions.is_empty() {
                answer.push_str("- No watchdog decisions recorded yet\n");
            } else {
                answer.push_str("- Decisions recorded, implementation status not tracked\n");
                for d in wdt_decisions {
                    answer.push_str(&format!("  - {} ({})\n", d.slug, d.decision_type));
                }
            }
        } else {
            for e in wdt_entries {
                answer.push_str(&format!("- {} → {}\n", e.slug, e.status));
            }
        }
    }

    if query_lower.contains("sleep")
        || query_lower.contains("休眠")
        || query_lower.contains("wake")
        || query_lower.contains("唤醒")
    {
        answer.push_str("\n**Sleep/wake status:**\n");
        let sleep_entries: Vec<_> = impl_status
            .entries
            .iter()
            .filter(|e| e.slug.contains("sleep") || e.slug.contains("wake"))
            .collect();

        if sleep_entries.is_empty() {
            let sleep_decisions: Vec<_> = recent_decisions
                .iter()
                .filter(|d| d.slug.contains("sleep") || d.slug.contains("wake"))
                .collect();

            if !sleep_decisions.is_empty() {
                answer.push_str("- Decisions recorded, implementation status not tracked\n");
                for d in sleep_decisions {
                    answer.push_str(&format!("  - {} ({})\n", d.slug, d.decision_type));
                }
            }
        } else {
            for e in sleep_entries {
                answer.push_str(&format!("- {} → {}\n", e.slug, e.status));
            }
        }
    }

    // General summary
    if answer.is_empty() {
        answer.push_str(&format!(
            "**Implementation status summary:**\n- Implemented: {}\n- Verified: {}\n- Planned: {}\n\n",
            impl_status.implemented, impl_status.verified, impl_status.planned
        ));

        answer.push_str(&format!(
            "**Recent decisions ({}):**\n",
            recent_decisions.len()
        ));
        for d in recent_decisions.iter().take(10) {
            answer.push_str(&format!("- {} ({})\n", d.slug, d.decision_type));
        }
    }

    answer
}

#[derive(Default)]
pub struct ImplStatusSummary {
    pub entries: Vec<ImplStatusEntry>,
    pub planned: usize,
    pub implemented: usize,
    pub verified: usize,
}

pub struct ImplStatusEntry {
    pub slug: String,
    pub status: String,
}

pub struct CompoundDecision {
    pub slug: String,
    pub decision_type: String,
}
