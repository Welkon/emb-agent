use crate::hardware::project::{read_project_state, read_text};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ResourceUsage {
    rom_used: Option<u64>,
    rom_total: Option<u64>,
    ram_used: Option<u64>,
    ram_total: Option<u64>,
    warnings: Vec<String>,
}

pub fn firmware_resource_analyze(project_root: &Path, report_path: &Path) -> String {
    let resolved_report = resolve_project_path(project_root, report_path);
    let source = match fs::read_to_string(&resolved_report) {
        Ok(source) => source,
        Err(error) => {
            return json!({
                "status": "error",
                "error": format!("cannot read resource report {}: {error}", resolved_report.display())
            })
            .to_string();
        }
    };
    let usage = parse_resource_usage(&source);
    let reports_dir = project_root
        .join(".emb-agent")
        .join("reports")
        .join("firmware");
    if let Err(error) = fs::create_dir_all(&reports_dir) {
        return json!({"status": "error", "error": format!("cannot create reports dir: {error}")})
            .to_string();
    }
    let report_rel = relative_path(project_root, &resolved_report);
    let generated_at = timestamp();
    let summary = resource_summary_json(&usage, &report_rel, &generated_at);
    let json_path = reports_dir.join("resource-summary.json");
    let md_path = reports_dir.join("resource-summary.md");
    if let Err(error) = fs::write(
        &json_path,
        serde_json::to_string_pretty(&summary).unwrap_or_else(|_| summary.to_string()),
    ) {
        return json!({"status": "error", "error": format!("cannot write resource summary: {error}")})
            .to_string();
    }
    if let Err(error) = fs::write(&md_path, resource_summary_markdown(&summary)) {
        return json!({"status": "error", "error": format!("cannot write resource markdown: {error}")})
            .to_string();
    }
    json!({
        "status": "ok",
        "resource_summary": summary,
        "artifacts": {
            "json": relative_path(project_root, &json_path),
            "markdown": relative_path(project_root, &md_path)
        }
    })
    .to_string()
}

pub fn firmware_evidence_add(
    project_root: &Path,
    kind: &str,
    result: &str,
    evidence_path: &str,
    expected: &str,
    measured: &str,
    notes: &str,
) -> String {
    let reports_dir = project_root
        .join(".emb-agent")
        .join("reports")
        .join("firmware");
    if let Err(error) = fs::create_dir_all(&reports_dir) {
        return json!({"status": "error", "error": format!("cannot create reports dir: {error}")})
            .to_string();
    }
    let evidence_file = reports_dir.join("board-evidence.jsonl");
    let generated_at = timestamp();
    let entry = json!({
        "time": generated_at,
        "kind": kind.trim(),
        "result": normalize_result(result),
        "expected": expected.trim(),
        "measured": measured.trim(),
        "evidence_path": evidence_path.trim(),
        "notes": notes.trim()
    });
    let mut line = serde_json::to_string(&entry).unwrap_or_else(|_| entry.to_string());
    line.push('\n');
    if let Err(error) = append_text(&evidence_file, &line) {
        return json!({"status": "error", "error": format!("cannot write board evidence: {error}")})
            .to_string();
    }
    let index_path = reports_dir.join("board-evidence.md");
    if let Err(error) = fs::write(
        &index_path,
        board_evidence_markdown(project_root, &evidence_file),
    ) {
        return json!({"status": "error", "error": format!("cannot write board evidence markdown: {error}")})
            .to_string();
    }
    json!({
        "status": "ok",
        "evidence": entry,
        "artifacts": {
            "jsonl": relative_path(project_root, &evidence_file),
            "markdown": relative_path(project_root, &index_path)
        }
    })
    .to_string()
}

pub fn firmware_release_draft(project_root: &Path, version: &str) -> String {
    let reports_dir = project_root
        .join(".emb-agent")
        .join("reports")
        .join("firmware");
    if let Err(error) = fs::create_dir_all(&reports_dir) {
        return json!({"status": "error", "error": format!("cannot create reports dir: {error}")})
            .to_string();
    }
    let state = read_project_state(project_root);
    let resource_path = reports_dir.join("resource-summary.json");
    let resource = fs::read_to_string(&resource_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .unwrap_or_else(|| json!({"available": false}));
    let evidence = read_board_evidence(&reports_dir.join("board-evidence.jsonl"));
    let git_commit = git_commit(project_root);
    let handoff = json!({
        "status": "draft",
        "version": version.trim(),
        "generated_at": timestamp(),
        "source_commit": git_commit,
        "target": {
            "mcu": state.hardware.model,
            "package": state.hardware.package,
            "board": state.hardware.board_name,
            "flash_flow": state.config.flash_flow
        },
        "resource_summary": resource,
        "board_evidence_count": evidence.len(),
        "board_evidence": evidence
    });
    let md_path = reports_dir.join("release-handoff.md");
    if let Err(error) = fs::write(&md_path, release_handoff_markdown(&handoff)) {
        return json!({"status": "error", "error": format!("cannot write release handoff: {error}")})
            .to_string();
    }
    json!({
        "status": "ok",
        "release_handoff": handoff,
        "artifacts": {
            "markdown": relative_path(project_root, &md_path)
        }
    })
    .to_string()
}

fn parse_resource_usage(source: &str) -> ResourceUsage {
    let mut usage = ResourceUsage::default();
    for line in source.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.contains("warning") || lower.contains("warn:") {
            usage.warnings.push(line.trim().to_string());
        }
        if mentions_rom(&lower) {
            apply_usage_pair(line, &mut usage.rom_used, &mut usage.rom_total);
        }
        if mentions_ram(&lower) {
            apply_usage_pair(line, &mut usage.ram_used, &mut usage.ram_total);
        }
    }
    usage
}

fn mentions_rom(lower: &str) -> bool {
    lower.contains("program memory")
        || has_token(lower, "rom")
        || has_token(lower, "flash")
        || lower.contains("code memory")
}

fn mentions_ram(lower: &str) -> bool {
    lower.contains("data memory")
        || has_token(lower, "ram")
        || has_token(lower, "sram")
        || lower.contains("data space")
}

fn has_token(text: &str, needle: &str) -> bool {
    text.split(|ch: char| !ch.is_ascii_alphanumeric())
        .any(|part| part == needle)
}

fn apply_usage_pair(line: &str, used: &mut Option<u64>, total: &mut Option<u64>) {
    if let Some((a, b)) = first_number_pair(line) {
        if used.is_none() {
            *used = Some(a);
        }
        if total.is_none() {
            *total = Some(b);
        }
    } else if used.is_none() {
        *used = first_number(line);
    }
}

fn first_number_pair(line: &str) -> Option<(u64, u64)> {
    let nums = numbers(line);
    for pair in nums.windows(2) {
        let a = pair[0];
        let b = pair[1];
        if b >= a && b > 0 {
            return Some((a, b));
        }
    }
    None
}

fn first_number(line: &str) -> Option<u64> {
    numbers(line).into_iter().next()
}

fn numbers(line: &str) -> Vec<u64> {
    let mut out = Vec::new();
    let mut current = String::new();
    for ch in line.chars() {
        if ch.is_ascii_digit() {
            current.push(ch);
        } else if !current.is_empty() {
            if let Ok(value) = current.parse::<u64>() {
                out.push(value);
            }
            current.clear();
        }
    }
    if !current.is_empty()
        && let Ok(value) = current.parse::<u64>()
    {
        out.push(value);
    }
    out
}

fn resource_summary_json(usage: &ResourceUsage, source: &str, generated_at: &str) -> Value {
    json!({
        "available": usage.rom_used.is_some() || usage.ram_used.is_some(),
        "generated_at": generated_at,
        "source": source,
        "program_rom": usage_json(usage.rom_used, usage.rom_total),
        "data_ram": usage_json(usage.ram_used, usage.ram_total),
        "warnings": usage.warnings,
        "review_flags": resource_review_flags(usage)
    })
}

fn usage_json(used: Option<u64>, total: Option<u64>) -> Value {
    let percent = match (used, total) {
        (Some(used), Some(total)) if total > 0 => Some((used * 10_000 / total) as f64 / 100.0),
        _ => None,
    };
    json!({
        "used_bytes": used,
        "total_bytes": total,
        "percent": percent
    })
}

fn resource_review_flags(usage: &ResourceUsage) -> Vec<String> {
    let mut flags = Vec::new();
    if usage.rom_used.is_none() {
        flags.push("program_rom_usage_missing".to_string());
    }
    if usage.ram_used.is_none() {
        flags.push("data_ram_usage_missing".to_string());
    }
    if usage_ratio_at_least(usage.rom_used, usage.rom_total, 80) {
        flags.push("program_rom_above_80_percent".to_string());
    }
    if usage_ratio_at_least(usage.ram_used, usage.ram_total, 75) {
        flags.push("data_ram_above_75_percent".to_string());
    }
    if !usage.warnings.is_empty() {
        flags.push("build_warnings_present".to_string());
    }
    flags
}

fn usage_ratio_at_least(used: Option<u64>, total: Option<u64>, threshold_percent: u64) -> bool {
    matches!((used, total), (Some(used), Some(total)) if total > 0 && used * 100 >= total * threshold_percent)
}

fn resource_summary_markdown(summary: &Value) -> String {
    let rom = &summary["program_rom"];
    let ram = &summary["data_ram"];
    let flags = summary["review_flags"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|item| format!("- {item}"))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    format!(
        "# Firmware Resource Summary\n\n- Generated: {}\n- Source: {}\n\n## Program ROM\n\n- Used bytes: {}\n- Total bytes: {}\n- Percent: {}\n\n## Data RAM\n\n- Used bytes: {}\n- Total bytes: {}\n- Percent: {}\n\n## Review Flags\n\n{}\n",
        str_value(summary, "generated_at"),
        str_value(summary, "source"),
        value_or_blank(&rom["used_bytes"]),
        value_or_blank(&rom["total_bytes"]),
        value_or_blank(&rom["percent"]),
        value_or_blank(&ram["used_bytes"]),
        value_or_blank(&ram["total_bytes"]),
        value_or_blank(&ram["percent"]),
        if flags.is_empty() { "- none" } else { &flags }
    )
}

fn board_evidence_markdown(project_root: &Path, jsonl: &Path) -> String {
    let entries = read_board_evidence(jsonl);
    let mut lines = vec![
        "# Firmware Board Evidence".to_string(),
        String::new(),
        "| Time | Kind | Result | Expected | Measured | Evidence | Notes |".to_string(),
        "|---|---|---|---|---|---|---|".to_string(),
    ];
    for entry in entries {
        lines.push(format!(
            "| {} | {} | {} | {} | {} | {} | {} |",
            md_cell(entry.get("time")),
            md_cell(entry.get("kind")),
            md_cell(entry.get("result")),
            md_cell(entry.get("expected")),
            md_cell(entry.get("measured")),
            md_cell(entry.get("evidence_path")),
            md_cell(entry.get("notes")),
        ));
    }
    lines.push(String::new());
    lines.push(format!("Source: {}", relative_path(project_root, jsonl)));
    lines.push(String::new());
    lines.join("\n")
}

fn release_handoff_markdown(handoff: &Value) -> String {
    let evidence_count = handoff
        .get("board_evidence_count")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    format!(
        "# Firmware Release Handoff\n\n## Release Meta\n\n- Version: {}\n- Generated: {}\n- Source commit: {}\n- Target chip/package: {} {}\n- Board: {}\n- Flash flow: {}\n\n## Artifacts To Fill\n\n- Firmware image:\n- Firmware image hash:\n- HEX/BIN path:\n- MAP/listing path:\n- Toolchain / IDE version:\n- Config bits / fuses:\n- Programming method:\n- Rollback artifact:\n\n## Evidence\n\n- Resource summary available: {}\n- Board evidence entries: {}\n\n## Remaining Release Checks\n\n- Confirm image hash against burned artifact.\n- Confirm config bits/fuses are included in the programmer flow.\n- Attach board verification report paths for hardware-facing behavior.\n",
        str_value(handoff, "version"),
        str_value(handoff, "generated_at"),
        str_value(handoff, "source_commit"),
        handoff
            .pointer("/target/mcu")
            .and_then(Value::as_str)
            .unwrap_or(""),
        handoff
            .pointer("/target/package")
            .and_then(Value::as_str)
            .unwrap_or(""),
        handoff
            .pointer("/target/board")
            .and_then(Value::as_str)
            .unwrap_or(""),
        handoff
            .pointer("/target/flash_flow")
            .and_then(Value::as_str)
            .unwrap_or(""),
        handoff
            .pointer("/resource_summary/available")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        evidence_count
    )
}

fn read_board_evidence(path: &Path) -> Vec<Value> {
    read_text(path)
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect()
}

fn normalize_result(result: &str) -> String {
    match result.trim().to_ascii_lowercase().as_str() {
        "pass" | "passed" | "ok" => "PASS".to_string(),
        "fail" | "failed" | "ng" => "FAIL".to_string(),
        "warn" | "warning" => "WARN".to_string(),
        "untested" | "" => "UNTESTED".to_string(),
        other => other.to_ascii_uppercase(),
    }
}

fn resolve_project_path(project_root: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        project_root.join(path)
    }
}

fn relative_path(project_root: &Path, path: &Path) -> String {
    path.strip_prefix(project_root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn git_commit(project_root: &Path) -> String {
    Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(project_root)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

fn append_text(path: &Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(text.as_bytes())
}

fn str_value<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn value_or_blank(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn md_cell(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or("")
        .replace('|', "\\|")
        .replace('\n', " ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_resource_report_shapes() {
        let usage = parse_resource_usage(
            "Program Memory Usage : 1630 bytes / 2048 bytes\nData Memory Usage : 100 / 128 bytes\nwarning: stack depth unknown\n",
        );
        assert_eq!(usage.rom_used, Some(1630));
        assert_eq!(usage.rom_total, Some(2048));
        assert_eq!(usage.ram_used, Some(100));
        assert_eq!(usage.ram_total, Some(128));
        assert!(resource_review_flags(&usage).contains(&"data_ram_above_75_percent".to_string()));
        assert!(resource_review_flags(&usage).contains(&"build_warnings_present".to_string()));
    }

    #[test]
    fn normalizes_board_evidence_result() {
        assert_eq!(normalize_result("ok"), "PASS");
        assert_eq!(normalize_result("ng"), "FAIL");
        assert_eq!(normalize_result(""), "UNTESTED");
    }
}
