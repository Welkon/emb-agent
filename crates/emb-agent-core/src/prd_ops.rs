use crate::json::json_quote;
use std::fs;
use std::path::Path;

/// Return PRD status (checks if system.md and req.yaml exist)
pub fn prd_status(ext_dir: &Path) -> String {
    let project_root = ext_dir.parent().unwrap_or(Path::new("."));
    let system_prd = project_root.join("docs").join("prd").join("system.md");
    let req_yaml = ext_dir.join("req.yaml");

    let has_system_prd = system_prd.exists();
    let has_req = req_yaml.exists();

    // Count task PRDs
    let mut task_prd_count = 0;
    let tasks_dir = project_root.join("docs").join("prd").join("tasks");
    if tasks_dir.exists()
        && let Ok(entries) = fs::read_dir(&tasks_dir)
    {
        task_prd_count = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|ext| ext == "md").unwrap_or(false))
            .count();
    }

    format!(
        "{{\"status\":\"ok\",\"prd\":{{\"system_prd\":{},\"req_yaml\":{},\"task_prds\":{},\"system_prd_path\":{},\"req_yaml_path\":{}}}}}",
        has_system_prd,
        has_req,
        task_prd_count,
        json_quote(&system_prd.to_string_lossy()),
        json_quote(&req_yaml.to_string_lossy())
    )
}
