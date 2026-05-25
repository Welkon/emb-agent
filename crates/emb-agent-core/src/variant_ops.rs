use crate::json::json_quote;
use crate::project::HardwareTruth;
use std::fs;
use std::path::{Path, PathBuf};

pub const ACTIVE_VARIANT_FILE: &str = "active-variant";
pub const VARIANTS_DIR: &str = "variants";

#[derive(Debug, Clone, Default)]
pub struct VariantInfo {
    pub name: String,
    pub active: bool,
    pub mcu: String,
    pub package: String,
    pub src: String,
    pub path: String,
    pub tasks: usize,
    pub wiki_pages: usize,
}

pub fn active_variant_name(ext_dir: &Path) -> Option<String> {
    let path = ext_dir.join(ACTIVE_VARIANT_FILE);
    let name = fs::read_to_string(path).ok()?.trim().to_string();
    if name.is_empty() {
        return None;
    }
    let safe = safe_name(&name);
    let dir = ext_dir.join(VARIANTS_DIR).join(&safe);
    if dir.exists() && dir.is_dir() {
        Some(safe)
    } else {
        None
    }
}

pub fn active_variant_dir(ext_dir: &Path) -> Option<PathBuf> {
    active_variant_name(ext_dir).map(|name| ext_dir.join(VARIANTS_DIR).join(name))
}

pub fn active_state_dir(ext_dir: &Path) -> PathBuf {
    active_variant_dir(ext_dir).unwrap_or_else(|| ext_dir.to_path_buf())
}

pub fn variant_list(ext_dir: &Path) -> String {
    let active = active_variant_name(ext_dir).unwrap_or_default();
    let infos = list_variant_infos(ext_dir, &active);
    let variants = infos
        .iter()
        .map(|info| {
            format!(
                "{{\"name\":{},\"active\":{},\"mcu\":{},\"package\":{},\"src\":{},\"tasks\":{},\"wiki_pages\":{},\"path\":{}}}",
                json_quote(&info.name),
                info.active,
                json_quote(&info.mcu),
                json_quote(&info.package),
                json_quote(&info.src),
                info.tasks,
                info.wiki_pages,
                json_quote(&info.path)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "{{\"status\":\"ok\",\"active\":{},\"variants\":[{}],\"count\":{}}}",
        json_quote(&active),
        variants,
        infos.len()
    )
}

pub fn variant_status(ext_dir: &Path) -> String {
    let active = active_variant_name(ext_dir).unwrap_or_default();
    let state_dir = active_state_dir(ext_dir);
    let hw = read_hw(&state_dir);
    let src = read_src(&state_dir);
    let tasks = count_task_dirs(&state_dir);
    let wiki_pages = count_wiki_pages(&state_dir);
    format!(
        "{{\"status\":\"ok\",\"active\":{},\"state_dir\":{},\"mcu\":{},\"package\":{},\"src\":{},\"tasks\":{},\"wiki_pages\":{}}}",
        json_quote(&active),
        json_quote(&state_dir.to_string_lossy()),
        json_quote(&hw.model),
        json_quote(&hw.package),
        json_quote(&src),
        tasks,
        wiki_pages
    )
}

pub fn variant_use(ext_dir: &Path, name: &str) -> String {
    let name = safe_name(name);
    let dir = ext_dir.join(VARIANTS_DIR).join(&name);
    if !dir.exists() || !dir.is_dir() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Variant not found: {}\"}}}}",
            name
        );
    }
    let _ = fs::write(ext_dir.join(ACTIVE_VARIANT_FILE), &name);
    let hw = read_hw(&dir);
    format!(
        "{{\"status\":\"ok\",\"active\":{},\"mcu\":{},\"package\":{},\"next\":\"next\",\"next_instructions\":\"Variant switched. Run `emb-agent-rs next --json` to continue in this variant.\"}}",
        json_quote(&name),
        json_quote(&hw.model),
        json_quote(&hw.package)
    )
}

pub fn variant_adopt(ext_dir: &Path, name: &str, src: &str, clean_root: bool) -> String {
    let name = safe_name(name);
    if name.is_empty() {
        return "{\"status\":\"error\",\"error\":{\"code\":\"bad-name\",\"message\":\"variant name is required\"}}".to_string();
    }
    let dir = ext_dir.join(VARIANTS_DIR).join(&name);
    if dir.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"exists\",\"message\":\"Variant already exists: {}\"}}}}",
            name
        );
    }

    create_variant_dirs(&dir);
    for file in ["project.json", "hw.yaml", "req.yaml", ".current-task"] {
        let from = ext_dir.join(file);
        if from.exists() {
            let _ = fs::copy(&from, dir.join(file));
        }
    }
    for directory in ["tasks", "wiki"] {
        let from = ext_dir.join(directory);
        if from.exists() {
            let _ = copy_dir_filtered(&from, &dir.join(directory));
        }
    }

    let hw = read_hw(&dir);
    let src = if src.is_empty() { format!("firmware/{}", name) } else { src.to_string() };
    seed_variant_files(ext_dir, &dir, &name, &hw.model, &hw.package, &src);
    let _ = fs::write(ext_dir.join(ACTIVE_VARIANT_FILE), &name);

    if clean_root {
        for file in ["hw.yaml", "req.yaml"] {
            let _ = fs::remove_file(ext_dir.join(file));
        }
        for directory in ["tasks", "wiki"] {
            let _ = fs::remove_dir_all(ext_dir.join(directory));
        }
        write_variant_readme(ext_dir);
    }

    format!(
        "{{\"status\":\"ok\",\"adopted\":true,\"active\":{},\"variant\":{{\"name\":{},\"mcu\":{},\"package\":{},\"src\":{}}},\"clean_root\":{},\"next\":\"next\",\"next_instructions\":\"Root state adopted as variant. Run `emb-agent-rs next --json` to continue.\"}}",
        json_quote(&name),
        json_quote(&name),
        json_quote(&hw.model),
        json_quote(&hw.package),
        json_quote(&src),
        clean_root
    )
}

pub fn variant_create(ext_dir: &Path, name: &str, mcu: &str, package: &str, src: &str) -> String {
    let name = safe_name(name);
    if name.is_empty() {
        return "{\"status\":\"error\",\"error\":{\"code\":\"bad-name\",\"message\":\"variant name is required\"}}".to_string();
    }
    let dir = ext_dir.join(VARIANTS_DIR).join(&name);
    if dir.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"exists\",\"message\":\"Variant already exists: {}\"}}}}",
            name
        );
    }
    create_variant_dirs(&dir);
    seed_variant_files(ext_dir, &dir, &name, mcu, package, src);
    format!(
        "{{\"status\":\"ok\",\"created\":true,\"variant\":{{\"name\":{},\"mcu\":{},\"package\":{},\"src\":{}}},\"next\":{}}}",
        json_quote(&name),
        json_quote(mcu),
        json_quote(package),
        json_quote(src),
        json_quote(&format!("variant use {}", name))
    )
}

pub fn variant_fork(
    ext_dir: &Path,
    from: &str,
    to: &str,
    mcu: &str,
    package: &str,
    src: &str,
) -> String {
    let from = safe_name(from);
    let to = safe_name(to);
    let from_dir = ext_dir.join(VARIANTS_DIR).join(&from);
    let source_dir = if from_dir.exists() {
        from_dir
    } else if from == "current" || from == "root" || from.is_empty() {
        active_state_dir(ext_dir)
    } else {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"not-found\",\"message\":\"Source variant not found: {}\"}}}}",
            from
        );
    };
    let to_dir = ext_dir.join(VARIANTS_DIR).join(&to);
    if to_dir.exists() {
        return format!(
            "{{\"status\":\"error\",\"error\":{{\"code\":\"exists\",\"message\":\"Target variant already exists: {}\"}}}}",
            to
        );
    }
    let _ = copy_dir_filtered(&source_dir, &to_dir);
    create_variant_dirs(&to_dir);
    let hw = read_hw(&source_dir);
    let final_mcu = if mcu.is_empty() { hw.model } else { mcu.to_string() };
    let final_pkg = if package.is_empty() { hw.package } else { package.to_string() };
    let final_src = if src.is_empty() {
        read_src(&source_dir)
    } else {
        src.to_string()
    };
    seed_variant_files(ext_dir, &to_dir, &to, &final_mcu, &final_pkg, &final_src);
    format!(
        "{{\"status\":\"ok\",\"forked\":true,\"from\":{},\"to\":{},\"mcu\":{},\"package\":{},\"src\":{},\"next\":{}}}",
        json_quote(&from),
        json_quote(&to),
        json_quote(&final_mcu),
        json_quote(&final_pkg),
        json_quote(&final_src),
        json_quote(&format!("variant use {}", to))
    )
}

pub fn variant_diff(ext_dir: &Path, a: &str, b: &str) -> String {
    let a = safe_name(a);
    let b = safe_name(b);
    let a_dir = ext_dir.join(VARIANTS_DIR).join(&a);
    let b_dir = ext_dir.join(VARIANTS_DIR).join(&b);
    if !a_dir.exists() || !b_dir.exists() {
        return "{\"status\":\"error\",\"error\":{\"code\":\"not-found\",\"message\":\"Both variants must exist\"}}".to_string();
    }
    let ah = read_hw(&a_dir);
    let bh = read_hw(&b_dir);
    format!(
        "{{\"status\":\"ok\",\"from\":{{\"name\":{},\"mcu\":{},\"package\":{},\"src\":{}}},\"to\":{{\"name\":{},\"mcu\":{},\"package\":{},\"src\":{}}},\"note\":\"Use `migrate --from-variant {} --to-variant {}` for guided porting.\"}}",
        json_quote(&a),
        json_quote(&ah.model),
        json_quote(&ah.package),
        json_quote(&read_src(&a_dir)),
        json_quote(&b),
        json_quote(&bh.model),
        json_quote(&bh.package),
        json_quote(&read_src(&b_dir)),
        a,
        b
    )
}

pub fn safe_name(name: &str) -> String {
    name.trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

fn list_variant_infos(ext_dir: &Path, active: &str) -> Vec<VariantInfo> {
    let mut infos = Vec::new();
    let variants_dir = ext_dir.join(VARIANTS_DIR);
    if let Ok(entries) = fs::read_dir(&variants_dir) {
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let hw = read_hw(&dir);
            infos.push(VariantInfo {
                active: name == active,
                src: read_src(&dir),
                tasks: count_task_dirs(&dir),
                wiki_pages: count_wiki_pages(&dir),
                path: dir.to_string_lossy().to_string(),
                mcu: hw.model,
                package: hw.package,
                name,
            });
        }
    }
    infos.sort_by(|a, b| a.name.cmp(&b.name));
    infos
}

fn create_variant_dirs(dir: &Path) {
    let _ = fs::create_dir_all(dir.join("tasks"));
    let _ = fs::create_dir_all(dir.join("wiki"));
}

fn write_variant_readme(ext_dir: &Path) {
    let content = r#"# emb-agent state

This project uses product variants.

Active variant is recorded in `.emb-agent/active-variant`.
Variant-specific truth lives under `.emb-agent/variants/<variant>/`:

- project.json
- hw.yaml
- req.yaml
- tasks/
- wiki/

Shared product-level state remains at root: project.json, bugs/, cache/, specs/, migrations/.

Do not treat root `.emb-agent/` as a chip hardware context when `active-variant` exists.
"#;
    let _ = fs::write(ext_dir.join("README.md"), content);
}

fn seed_variant_files(ext_dir: &Path, dir: &Path, name: &str, mcu: &str, package: &str, src: &str) {
    if !dir.join("project.json").exists() {
        if ext_dir.join("project.json").exists() {
            let _ = fs::copy(ext_dir.join("project.json"), dir.join("project.json"));
        } else {
            let project = serde_json::json!({
                "project_profile": "baremetal-loop",
                "active_specs": ["embedded-space"],
                "variant": name,
                "source_root": src,
            });
            let _ = fs::write(dir.join("project.json"), serde_json::to_string_pretty(&project).unwrap_or_default());
        }
    }
    // Always add/update a variant sidecar to avoid lossy JSON mutation.
    let variant_json = serde_json::json!({
        "name": name,
        "source_root": src,
        "mcu": mcu,
        "package": package,
    });
    let _ = fs::write(dir.join("variant.json"), serde_json::to_string_pretty(&variant_json).unwrap_or_default());

    if !dir.join("req.yaml").exists() && ext_dir.join("req.yaml").exists() {
        let _ = fs::copy(ext_dir.join("req.yaml"), dir.join("req.yaml"));
    }
    let hw_yaml = format!(
        "mcu:\n  model: {}\n  package: {}\nvariant:\n  name: {}\nfirmware:\n  src: {}\n",
        mcu, package, name, src
    );
    let _ = fs::write(dir.join("hw.yaml"), hw_yaml);
}

fn read_hw(dir: &Path) -> HardwareTruth {
    HardwareTruth::from_yaml(&fs::read_to_string(dir.join("hw.yaml")).unwrap_or_default())
}

fn read_src(dir: &Path) -> String {
    if let Ok(content) = fs::read_to_string(dir.join("variant.json"))
        && let Ok(value) = serde_json::from_str::<serde_json::Value>(&content)
            && let Some(src) = value.get("source_root").and_then(|v| v.as_str()) {
                return src.to_string();
            }
    let hw = fs::read_to_string(dir.join("hw.yaml")).unwrap_or_default();
    yaml_nested_string(&hw, "firmware", "src")
}

fn yaml_nested_string(source: &str, parent: &str, key: &str) -> String {
    let mut in_parent = false;
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        if !line.starts_with(' ') && trimmed == format!("{}:", parent) {
            in_parent = true;
            continue;
        }
        if !line.starts_with(' ') && in_parent {
            break;
        }
        if in_parent
            && let Some(rest) = trimmed.strip_prefix(&format!("{}:", key)) {
                return rest.trim().trim_matches('"').trim_matches('\'').to_string();
            }
    }
    String::new()
}

fn count_task_dirs(dir: &Path) -> usize {
    fs::read_dir(dir.join("tasks"))
        .map(|entries| entries.flatten().filter(|entry| entry.path().is_dir()).count())
        .unwrap_or(0)
}

fn count_wiki_pages(dir: &Path) -> usize {
    fs::read_dir(dir.join("wiki"))
        .map(|entries| entries.flatten().filter(|entry| entry.path().is_file()).count())
        .unwrap_or(0)
}

fn copy_dir_filtered(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        let name = entry.file_name().to_string_lossy().to_string();
        if matches!(name.as_str(), "variants" | "bugs" | "cache" | "docs" | "migrations") {
            continue;
        }
        if src.is_dir() {
            copy_dir_filtered(&src, &dst)?;
        } else {
            let _ = fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}
