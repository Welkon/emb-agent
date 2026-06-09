use crate::json::json_quote;
use std::fs;
use std::path::Path;

/// Return PRD status (checks if system.md, req.yaml, and child execution PRDs exist)
pub fn prd_status(ext_dir: &Path) -> String {
    let project_root = ext_dir.parent().unwrap_or(Path::new("."));
    let state_dir = crate::variant_ops::active_state_dir(ext_dir);
    let system_prd = project_root.join("docs").join("prd").join("system.md");
    let req_yaml = state_dir.join("req.yaml");

    let system_prd_source = fs::read_to_string(&system_prd).unwrap_or_default();
    let has_system_prd = system_prd.exists();
    let system_prd_has_content = has_system_prd && substantive_markdown(&system_prd_source);
    let has_req = req_yaml.exists();
    let child_prd_count = child_prd_count(project_root);

    format!(
        "{{\"status\":\"ok\",\"prd\":{{\"system_prd\":{},\"system_prd_has_content\":{},\"req_yaml\":{},\"child_prds\":{},\"task_prds\":{},\"breakdown_needed\":{},\"system_prd_path\":{},\"req_yaml_path\":{}}}}}",
        has_system_prd,
        system_prd_has_content,
        has_req,
        child_prd_count,
        child_prd_count,
        system_prd_has_content && child_prd_count == 0,
        json_quote(&system_prd.to_string_lossy()),
        json_quote(&req_yaml.to_string_lossy())
    )
}

fn child_prd_count(project_root: &Path) -> usize {
    let prd_root = project_root.join("docs").join("prd");
    ["tasks", "features", "modules", "components", "subsystems"]
        .iter()
        .map(|dir| count_markdown_files(&prd_root.join(dir)))
        .sum()
}

fn is_child_prd_markdown(path: &Path) -> bool {
    if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
        return false;
    }
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    !matches!(name, "index.md" | "README.md" | "readme.md" | "log.md")
}

fn count_markdown_files(dir: &Path) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            if path.is_dir() {
                count_markdown_files(&path)
            } else if is_child_prd_markdown(&path) {
                1
            } else {
                0
            }
        })
        .sum()
}

fn substantive_markdown(source: &str) -> bool {
    let mut meaningful_lines = 0usize;
    let mut bullet_lines = 0usize;
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('>') {
            continue;
        }
        meaningful_lines += 1;
        if trimmed.starts_with("- ") || trimmed.starts_with("* ") {
            bullet_lines += 1;
        }
    }
    bullet_lines > 0 || meaningful_lines >= 3
}
