// Compound knowledge operations: learn, decide, trap, explore, trick
// Stores documents under .emb-agent/compound/YYYY-MM-DD-{type}-{slug}.md

use crate::json::json_quote;
use std::fs;
use std::path::Path;

/// Create a compound knowledge document
pub fn compound_add(
    ext_dir: &Path,
    doc_type: &str,
    slug: &str,
    title: &str,
    summary: &str,
    chip: &str,
    extra: &[(&str, &str)],
) -> String {
    let compound_dir = ext_dir.join("compound");
    let _ = fs::create_dir_all(&compound_dir);

    let now = chrono_now_simple();
    let filename = format!("{}-{}-{}.md", now, doc_type, slug);
    let path = compound_dir.join(&filename);

    if path.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"already-exists\",\"message\":\"Compound doc already exists: {}\"}}}}",
            json_quote(&filename)
        );
    }

    let mut frontmatter = String::new();
    frontmatter.push_str("---\n");
    frontmatter.push_str(&format!("doc_type: {}\n", doc_type));
    frontmatter.push_str(&format!("slug: {}\n", slug));
    frontmatter.push_str("status: active\n");
    frontmatter.push_str(&format!("summary: {}\n", summary));
    if !chip.is_empty() {
        frontmatter.push_str(&format!("chip: {}\n", chip));
    }
    frontmatter.push_str(&format!("date: {}\n", now));
    for (k, v) in extra {
        if !v.is_empty() {
            frontmatter.push_str(&format!("{}: {}\n", k, v));
        }
    }
    frontmatter.push_str("---\n\n");

    let body = format!("# {}\n\n{}\n", title, summary);
    let content = format!("{}{}", frontmatter, body);

    let _ = fs::write(&path, &content);

    format!(
        "{{\"status\":\"ok\",\"created\":true,\"path\":{},\"type\":{}}}",
        json_quote(&format!("compound/{}", filename)),
        json_quote(doc_type)
    )
}

/// Search compound documents by frontmatter fields
pub fn compound_search(
    ext_dir: &Path,
    doc_type_filter: &str,
    query: &str,
    chip_filter: &str,
) -> String {
    let compound_dir = ext_dir.join("compound");
    if !compound_dir.exists() {
        return r#"{"status":"ok","results":[],"count":0}"#.to_string();
    }

    let mut results: Vec<serde_json::Value> = Vec::new();
    let query_lower = query.to_lowercase();
    let chip_lower = chip_filter.to_lowercase();
    let type_lower = doc_type_filter.to_lowercase();

    if let Ok(entries) = fs::read_dir(&compound_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "md") {
                if let Ok(raw) = fs::read_to_string(&path) {
                    let matches = if !type_lower.is_empty() {
                        raw.contains(&format!("doc_type: {}", type_lower))
                            || raw.contains(&format!("doc_type:{}", type_lower))
                    } else {
                        true
                    };

                    let chip_ok = if !chip_lower.is_empty() {
                        raw.to_lowercase().contains(&format!("chip: {}", chip_lower))
                            || raw.to_lowercase().contains(&format!("chip:{}", chip_lower))
                    } else {
                        true
                    };

                    let query_ok = if !query_lower.is_empty() {
                        raw.to_lowercase().contains(&query_lower)
                    } else {
                        true
                    };

                    if matches && chip_ok && query_ok {
                        // Extract minimal frontmatter
                        let slug = extract_yaml_field(&raw, "slug");
                        let summary = extract_yaml_field(&raw, "summary");
                        let dt = extract_yaml_field(&raw, "doc_type");
                        let ch = extract_yaml_field(&raw, "chip");
                        let st = extract_yaml_field(&raw, "status");
                        let sev = extract_yaml_field(&raw, "severity");

                        let fname = path.file_name().unwrap_or_default().to_string_lossy();
                        results.push(serde_json::json!({
                            "file": fname,
                            "path": format!("compound/{}", fname),
                            "doc_type": dt,
                            "slug": slug,
                            "summary": summary,
                            "chip": ch,
                            "status": st,
                            "severity": sev
                        }));
                    }
                }
            }
        }
    }

    let count = results.len();
    format!(
        "{{\"status\":\"ok\",\"results\":{},\"count\":{}}}",
        serde_json::to_string(&results).unwrap_or_default(),
        count
    )
}

/// List compound documents
pub fn compound_list(ext_dir: &Path) -> String {
    compound_search(ext_dir, "", "", "")
}

/// Show attention.md
pub fn attention_show(ext_dir: &Path) -> String {
    let att_path = ext_dir.join("attention.md");
    if !att_path.exists() {
        return r#"{"status":"error","error":{"code":"not-found","message":"attention.md not found. Run emb-agent init first."}}"#.to_string();
    }
    let content = fs::read_to_string(&att_path).unwrap_or_default();
    let lines: Vec<&str> = content.lines().collect();
    format!(
        "{{\"status\":\"ok\",\"lines\":{},\"path\":\"attention.md\"}}",
        serde_json::to_string(&lines).unwrap_or_default()
    )
}

/// Append a note to attention.md under the correct section
pub fn attention_note(ext_dir: &Path, text: &str, section: &str) -> String {
    let att_path = ext_dir.join("attention.md");
    if !att_path.exists() {
        return r#"{"status":"error","error":{"code":"not-found","message":"attention.md not found. Run emb-agent init first."}}"#.to_string();
    }

    let content = fs::read_to_string(&att_path).unwrap_or_default();
    let note_line = format!("- {}\n", text.trim());

    // Find the target section and append
    let section_heading = format!("## {}", section);
    let mut in_section = false;
    let mut new_content = String::new();
    let mut inserted = false;

    for line in content.lines() {
        new_content.push_str(line);
        new_content.push('\n');

        if line.trim_start().starts_with("## ") {
            if in_section && !inserted {
                // We were in the target section but reached next section — insert before it
                // Actually, append at end of section (before next heading)
                new_content.pop(); // remove the newline we just added for the next heading
                new_content.push_str(&note_line);
                new_content.push('\n');
                new_content.push_str(line);
                new_content.push('\n');
                inserted = true;
                in_section = false;
                continue;
            }
            in_section = line.trim_start() == section_heading;
        }
    }

    // If still in section at end of file, append at end
    if in_section && !inserted {
        new_content.push_str(&note_line);
        inserted = true;
    }

    // If section not found, append under "Other" or create a generic section
    if !inserted {
        // Try "Other" section
        let other_heading = "## Other";
        let mut found_other = false;
        let mut final_content = String::new();

        for line in content.lines() {
            final_content.push_str(line);
            final_content.push('\n');
            if line.trim_start() == other_heading {
                found_other = true;
                final_content.push_str(&note_line);
            }
        }

        if found_other {
            new_content = final_content;
        } else {
            // Append at end with a "## Notes" section
            new_content = format!("{}\n## Notes\n{}\n", content.trim_end(), note_line);
        }
    }

    let _ = fs::write(&att_path, &new_content);

    format!(
        "{{\"status\":\"ok\",\"appended\":true,\"section\":{},\"text\":{}}}",
        json_quote(if inserted { section } else { "Notes" }),
        json_quote(text.trim())
    )
}

// ── Helpers ──────────────────────────────────────────────────────

fn extract_yaml_field(raw: &str, field: &str) -> String {
    let prefix = format!("{}:", field);
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(&prefix) {
            return trimmed[prefix.len()..].trim().to_string();
        }
    }
    String::new()
}

fn chrono_now_simple() -> String {
    // Returns YYYY-MM-DD
    if let Ok(duration) = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
    {
        let secs = duration.as_secs();
        // Simple gregorian approximation
        let days = secs / 86400;
        // Days since 1970-01-01
        let mut y = 1970i64;
        let mut d = days as i64;
        loop {
            let days_in_year = if is_leap(y) { 366 } else { 365 };
            if d < days_in_year { break; }
            d -= days_in_year;
            y += 1;
        }
        let months = if is_leap(y) {
            [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        } else {
            [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        };
        let mut m = 0usize;
        for (i, days_in_month) in months.iter().enumerate() {
            if d < *days_in_month { m = i; break; }
            d -= *days_in_month;
            if i == 11 { m = 11; }
        }
        format!("{:04}-{:02}-{:02}", y, m + 1, d + 1)
    } else {
        "unknown-date".to_string()
    }
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}
/// Show architecture status: check if ARCHITECTURE.md exists and which sections are filled
pub fn arch_status(ext_dir: &Path) -> String {
    let arch_dir = ext_dir.join("architecture");
    let arch_md = arch_dir.join("ARCHITECTURE.md");
    if !arch_md.exists() {
        return r#"{"status":"ok","architecture":{"exists":false,"note":"ARCHITECTURE.md not found. Run emb-agent init first."}}"#.to_string();
    }
    let content = fs::read_to_string(&arch_md).unwrap_or_default();
    let has_module_map = content.contains("## Module Map");
    let has_data_flow = content.contains("## Data Flow");
    let has_interrupt = content.contains("## Interrupt Routing");
    let has_peripheral = content.contains("## Peripheral Ownership");
    let has_decisions = content.contains("## Key Architecture Decisions");
    let sections_filled = [has_module_map, has_data_flow, has_interrupt, has_peripheral, has_decisions]
        .iter().filter(|&&x| x).count();
    format!(
        "{{\"status\":\"ok\",\"architecture\":{{\"exists\":true,\"sections_filled\":{},\"sections_total\":5}}}}",
        sections_filled
    )
}

/// Architecture check: compare ARCHITECTURE.md against current code (stub)
pub fn arch_check(ext_dir: &Path) -> String {
    let arch_md = ext_dir.join("architecture").join("ARCHITECTURE.md");
    if !arch_md.exists() {
        return r#"{"status":"ok","check":{"arch_exists":false,"findings":[],"recommendation":"Run emb-agent init to create architecture skeleton."}}"#.to_string();
    }
    // Stub: real implementation would compare docs vs actual code structure
    format!(
        "{{\"status\":\"ok\",\"check\":{{\"arch_exists\":true,\"findings\":[],\"recommendation\":\"Architecture check not yet implemented in Rust. Review ARCHITECTURE.md manually.\"}}}}"
    )
}