// CLI for implementation status tracking
// Commands: emb impl mark/list/verify

use std::fs;
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let subcommand = args.get(1).map(String::as_str).unwrap_or("list");

    match subcommand {
        "mark" => run_mark(args),
        "list" => run_list(args),
        "verify" => run_verify(args),
        _ => Err(format!(
            "Unknown impl subcommand: {subcommand}. Use: mark, list, verify"
        )),
    }
}

fn run_mark(args: &[String]) -> Result<(), String> {
    let mut decision = None;
    let mut status = None;
    let mut file = None;
    let mut i = 2;

    while i < args.len() {
        match args[i].as_str() {
            "--decision" => {
                decision = args.get(i + 1).map(String::as_str);
                i += 2;
            }
            "--status" => {
                status = args.get(i + 1).map(String::as_str);
                i += 2;
            }
            "--file" => {
                file = args.get(i + 1).map(String::as_str);
                i += 2;
            }
            _ => i += 1,
        }
    }

    let decision = decision.ok_or("--decision required")?;
    let status = status.ok_or("--status required (planned|implemented|verified)")?;

    if !matches!(status, "planned" | "implemented" | "verified") {
        return Err(format!(
            "Invalid status: {status}. Use: planned, implemented, verified"
        ));
    }

    let impl_status_path = Path::new(".emb-agent/impl_status.yaml");

    // Load or create
    let mut content = if impl_status_path.exists() {
        fs::read_to_string(impl_status_path)
            .map_err(|e| format!("Failed to read impl_status.yaml: {e}"))?
    } else {
        "schema_version: 1\ndecisions: []\n".to_string()
    };

    // Simple append (not proper YAML editing, but works for MVP)
    // TODO: use proper YAML parsing/editing
    if content.contains(&format!("slug: {decision}")) {
        // Update existing
        return Err(format!(
            "Decision {decision} already tracked. Manual edit .emb-agent/impl_status.yaml to update."
        ));
    } else {
        // Append new
        if !content.contains("decisions: []") {
            content.push_str(&format!(
                "\n  - slug: {}\n    status: {}\n",
                decision, status
            ));
            if let Some(f) = file {
                content.push_str(&format!("    files: [{}]\n", f));
            }
            content.push_str("    verified_at: null\n");
        } else {
            // First entry, replace []
            content = content.replace(
                "decisions: []",
                &format!(
                    "decisions:\n  - slug: {}\n    status: {}\n    files: [{}]\n    verified_at: null",
                    decision, status, file.unwrap_or("")
                ),
            );
        }
    }

    fs::write(impl_status_path, content)
        .map_err(|e| format!("Failed to write impl_status.yaml: {e}"))?;

    println!("✓ Marked {} as {}", decision, status);
    Ok(())
}

fn run_list(args: &[String]) -> Result<(), String> {
    let impl_status_path = Path::new(".emb-agent/impl_status.yaml");

    if !impl_status_path.exists() {
        println!("No impl_status.yaml found. Use `emb impl mark` to track implementation status.");
        return Ok(());
    }

    let content = fs::read_to_string(impl_status_path)
        .map_err(|e| format!("Failed to read impl_status.yaml: {e}"))?;

    let brief = args.iter().any(|a| a == "--brief");

    // Parse simple YAML (just scan for "slug:" lines)
    let mut count_by_status = std::collections::HashMap::new();
    let mut entries = Vec::new();

    for line in content.lines() {
        if line.trim().starts_with("slug: ") {
            let slug = line.trim().strip_prefix("slug: ").unwrap_or("").trim();
            entries.push(slug.to_string());
        } else if line.trim().starts_with("status: ") {
            let status = line.trim().strip_prefix("status: ").unwrap_or("").trim();
            *count_by_status.entry(status.to_string()).or_insert(0) += 1;
        }
    }

    if brief {
        println!("Implementation status summary:");
        for (status, count) in count_by_status {
            println!("  {}: {}", status, count);
        }
    } else {
        println!("{}", content);
    }

    Ok(())
}

fn run_verify(args: &[String]) -> Result<(), String> {
    let decision = args
        .iter()
        .position(|a| a == "--decision")
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
        .ok_or("--decision required")?;

    let impl_status_path = Path::new(".emb-agent/impl_status.yaml");

    if !impl_status_path.exists() {
        return Err(format!(
            "No impl_status.yaml found. Mark {} first with `emb impl mark`.",
            decision
        ));
    }

    let mut content = fs::read_to_string(impl_status_path)
        .map_err(|e| format!("Failed to read impl_status.yaml: {e}"))?;

    if !content.contains(&format!("slug: {decision}")) {
        return Err(format!(
            "Decision {} not tracked. Mark it first with `emb impl mark`.",
            decision
        ));
    }

    // Update status to verified and set timestamp
    // Simple string replacement (MVP)
    let slug_line = format!("slug: {}", decision);
    if let Some(slug_pos) = content.find(&slug_line) {
        // Find the status line after this slug
        let status_offset = content[slug_pos..].find("status: ");
        let verified_offset = content[slug_pos..].find("verified_at: ");

        if let Some(offset) = status_offset {
            let status_start = slug_pos + offset + "status: ".len();
            let status_end = content[status_start..]
                .find('\n')
                .map(|i| status_start + i)
                .unwrap_or(content.len());
            content.replace_range(status_start..status_end, "verified");
        }

        // Set verified_at
        if let Some(offset) = verified_offset {
            let verified_start = slug_pos + offset + "verified_at: ".len();
            let verified_end = content[verified_start..]
                .find('\n')
                .map(|i| verified_start + i)
                .unwrap_or(content.len());
            let now = chrono::Utc::now().to_rfc3339();
            content.replace_range(verified_start..verified_end, &now);
        }
    }

    fs::write(impl_status_path, content)
        .map_err(|e| format!("Failed to update impl_status.yaml: {e}"))?;

    println!("✓ Verified {}", decision);
    Ok(())
}
