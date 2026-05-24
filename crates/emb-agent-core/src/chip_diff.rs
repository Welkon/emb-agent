use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;


/// Chip profile as stored in extensions/chips/profiles/<name>.json
#[derive(Debug, Clone, Default, Serialize)]
pub struct ChipProfile {
    pub name: String,
    pub vendor: String,
    pub family: String,
    pub series: String,
    pub package: String,
    pub architecture: String,
    pub capabilities: Vec<String>,
    pub packages: Vec<String>,
    pub pins: BTreeMap<String, ChipPin>,
    pub related_tools: Vec<String>,
    pub compatible_with: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ChipPin {
    pub functions: Vec<String>,
    pub peripherals: Vec<String>,
}

/// Single pin comparison result
#[derive(Debug, Clone, Serialize)]
pub struct PinDiff {
    pub pin_number: String,
    pub old_functions: Vec<String>,
    pub new_functions: Vec<String>,
    pub old_peripherals: Vec<String>,
    pub new_peripherals: Vec<String>,
    pub compatibility: PinCompatibility,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum PinCompatibility {
    #[serde(rename = "identical")]
    Identical,
    #[serde(rename = "compatible")]
    Compatible,
    #[serde(rename = "partial")]
    Partial,
    #[serde(rename = "incompatible")]
    Incompatible,
    #[serde(rename = "new_pin")]
    NewPin,
    #[serde(rename = "removed_pin")]
    RemovedPin,
}

/// Full chip comparison report
#[derive(Debug, Clone, Serialize)]
pub struct ChipDiffReport {
    pub from_chip: String,
    pub to_chip: String,
    pub from_vendor: String,
    pub to_vendor: String,
    pub from_package: String,
    pub to_package: String,
    pub from_family: String,
    pub to_family: String,
    pub package_compatible: bool,
    pub footprint_match: String,
    pub added_capabilities: Vec<String>,
    pub removed_capabilities: Vec<String>,
    pub shared_capabilities: Vec<String>,
    pub added_tools: Vec<String>,
    pub removed_tools: Vec<String>,
    pub shared_tools: Vec<String>,
    pub pin_diffs: Vec<PinDiff>,
    pub compatible_signals: Vec<String>,
    pub incompatible_signals: Vec<String>,
    pub missing_signals: Vec<String>,
    pub migration_risk: String,
    pub migration_recommendations: Vec<String>,
}

/// Migration plan for chip swap
#[derive(Debug, Clone, Serialize)]
pub struct ChipSwapPlan {
    pub from_chip: String,
    pub to_chip: String,
    pub diff: ChipDiffReport,
    pub affected_signals: Vec<MigratedSignal>,
    pub required_code_changes: Vec<String>,
    pub verification_checklist: Vec<String>,
    pub decision_record_path: String,
    pub recommended_next: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MigratedSignal {
    pub name: String,
    pub old_pin: String,
    pub new_pin: String,
    pub status: SignalMigrationStatus,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
pub enum SignalMigrationStatus {
    #[serde(rename = "direct")]
    Direct,
    #[serde(rename = "remapped")]
    Remapped,
    #[serde(rename = "lost")]
    Lost,
    #[serde(rename = "new")]
    New,
}

fn load_chip_profile(ext_dir: &Path, chip_name: &str) -> Option<ChipProfile> {
    let profile_path = ext_dir
        .join("extensions")
        .join("chips")
        .join("profiles")
        .join(format!("{}.json", chip_name));

    if !profile_path.exists() {
        // Try the registry to resolve aliases
        let registry_path = ext_dir
            .join("extensions")
            .join("chips")
            .join("registry.json");
        if let Ok(registry_raw) = fs::read_to_string(&registry_path)
            && let Ok(registry) = serde_json::from_str::<serde_json::Value>(&registry_raw) {
                let devices = registry
                    .get("devices")
                    .and_then(|v| v.as_array())
                    .map(|a| a.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
                    .unwrap_or_default();
                // Try to find a matching device
                if devices.contains(&chip_name) {
                    return load_chip_profile_file(&profile_path);
                }
                // Try partial match
                for device in devices {
                    if device.contains(chip_name) || chip_name.contains(device) {
                        let alt_path = ext_dir
                            .join("extensions")
                            .join("chips")
                            .join("profiles")
                            .join(format!("{}.json", device));
                        if alt_path.exists() {
                            return load_chip_profile_file(&alt_path);
                        }
                    }
                }
            }
    }

    load_chip_profile_file(&profile_path)
}

fn load_chip_profile_file(path: &Path) -> Option<ChipProfile> {
    let raw = fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;

    let pins: BTreeMap<String, ChipPin> = value
        .get("pins")
        .and_then(|v| v.as_object())
        .map(|obj| {
            obj.iter()
                .map(|(pin, details)| {
                    let functions = details
                        .get("functions")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    let peripherals = details
                        .get("peripherals")
                        .and_then(|v| v.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|v| v.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    (pin.clone(), ChipPin { functions, peripherals })
                })
                .collect()
        })
        .unwrap_or_default();

    Some(ChipProfile {
        name: value.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        vendor: value.get("vendor").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        family: value.get("family").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        series: value.get("series").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        package: value.get("package").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        architecture: value.get("architecture").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        capabilities: value
            .get("capabilities")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        packages: value
            .get("packages")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        pins,
        related_tools: value
            .get("related_tools")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        compatible_with: value
            .get("compatible_with")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        notes: value
            .get("notes")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
    })
}

fn diff_pin(
    pin_num: &str,
    old_pin: Option<&ChipPin>,
    new_pin: Option<&ChipPin>,
) -> PinDiff {
    let old_funcs = old_pin.map(|p| p.functions.clone()).unwrap_or_default();
    let new_funcs = new_pin.map(|p| p.functions.clone()).unwrap_or_default();
    let old_periphs = old_pin.map(|p| p.peripherals.clone()).unwrap_or_default();
    let new_periphs = new_pin.map(|p| p.peripherals.clone()).unwrap_or_default();

    let compatibility = match (old_pin, new_pin) {
        (None, Some(_)) => PinCompatibility::NewPin,
        (Some(_), None) => PinCompatibility::RemovedPin,
        (Some(_), Some(_)) => {
            if old_funcs == new_funcs && old_periphs == new_periphs {
                PinCompatibility::Identical
            } else if has_overlap(&old_funcs, &new_funcs) || has_overlap(&old_periphs, &new_periphs)
            {
                PinCompatibility::Compatible
            } else if !old_funcs.is_empty() && !new_funcs.is_empty() {
                PinCompatibility::Partial
            } else {
                PinCompatibility::Incompatible
            }
        }
        (None, None) => PinCompatibility::Incompatible,
    };

    PinDiff {
        pin_number: pin_num.to_string(),
        old_functions: old_funcs,
        new_functions: new_funcs,
        old_peripherals: old_periphs,
        new_peripherals: new_periphs,
        compatibility,
    }
}

fn has_overlap(a: &[String], b: &[String]) -> bool {
    a.iter().any(|x| b.contains(x))
}

/// Check if same package pinout is drop-in compatible
fn check_footprint_compat(old: &ChipProfile, new: &ChipProfile) -> String {
    if old.package == new.package && !old.package.is_empty() {
        let identical_pins = old
            .pins
            .keys()
            .filter(|k| {
                let old_p = old.pins.get(*k);
                let new_p = new.pins.get(*k);
                old_p.map(|p| p.functions.clone()).unwrap_or_default()
                    == new_p.map(|p| p.functions.clone()).unwrap_or_default()
                    && old_p.map(|p| p.peripherals.clone()).unwrap_or_default()
                        == new_p.map(|p| p.peripherals.clone()).unwrap_or_default()
            })
            .count();
        let total = old.pins.len().max(new.pins.len());
        if total == 0 {
            return "unknown".to_string();
        }
        let pct = identical_pins as f64 / total as f64 * 100.0;
        if pct >= 95.0 {
            "pin-compatible".to_string()
        } else if pct >= 70.0 {
            "mostly-compatible".to_string()
        } else {
            "needs-remapping".to_string()
        }
    } else {
        "different-package".to_string()
    }
}

pub fn diff_chips(ext_dir: &Path, from: &str, to: &str) -> ChipDiffReport {
    let old = load_chip_profile(ext_dir, from);
    let new = load_chip_profile(ext_dir, to);

    let old = old.unwrap_or_default();
    let new = new.unwrap_or_default();

    let package_compatible = old.package == new.package && !old.package.is_empty();
    let footprint_match = check_footprint_compat(&old, &new);

    // Capability diffs
    let added_capabilities: Vec<String> = new
        .capabilities
        .iter()
        .filter(|c| !old.capabilities.contains(c))
        .cloned()
        .collect();
    let removed_capabilities: Vec<String> = old
        .capabilities
        .iter()
        .filter(|c| !new.capabilities.contains(c))
        .cloned()
        .collect();
    let shared_capabilities: Vec<String> = old
        .capabilities
        .iter()
        .filter(|c| new.capabilities.contains(c))
        .cloned()
        .collect();

    // Tool diffs
    let added_tools: Vec<String> = new
        .related_tools
        .iter()
        .filter(|t| !old.related_tools.contains(t))
        .cloned()
        .collect();
    let removed_tools: Vec<String> = old
        .related_tools
        .iter()
        .filter(|t| !new.related_tools.contains(t))
        .cloned()
        .collect();
    let shared_tools: Vec<String> = old
        .related_tools
        .iter()
        .filter(|t| new.related_tools.contains(t))
        .cloned()
        .collect();

    // Pin diffs
    let all_pins: Vec<String> = {
        let mut pins: Vec<String> = old.pins.keys().cloned().collect();
        for k in new.pins.keys() {
            if !pins.contains(k) {
                pins.push(k.clone());
            }
        }
        pins.sort_by_key(|k| k.parse::<u32>().unwrap_or(u32::MAX));
        pins
    };

    let pin_diffs: Vec<PinDiff> = all_pins
        .iter()
        .map(|pin| diff_pin(pin, old.pins.get(pin), new.pins.get(pin)))
        .collect();

    // Migration risk assessment
    let migration_risk = if footprint_match == "pin-compatible" {
        "low".to_string()
    } else if footprint_match == "mostly-compatible" {
        "medium".to_string()
    } else if !removed_capabilities.is_empty() {
        "high".to_string()
    } else {
        "medium-high".to_string()
    };

    let mut recommendations: Vec<String> = Vec::new();

    if !removed_capabilities.is_empty() {
        recommendations.push(format!(
            "Lost capabilities: {}. Verify firmware can work without them.",
            removed_capabilities.join(", ")
        ));
    }
    if !added_capabilities.is_empty() {
        recommendations.push(format!(
            "New capabilities available: {}",
            added_capabilities.join(", ")
        ));
    }

    let incompatible_pins: Vec<&PinDiff> = pin_diffs
        .iter()
        .filter(|d| d.compatibility == PinCompatibility::Incompatible)
        .collect();
    if !incompatible_pins.is_empty() {
        recommendations.push(format!(
            "{} pins have incompatible function changes: {}",
            incompatible_pins.len(),
            incompatible_pins
                .iter()
                .map(|d| d.pin_number.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    let removed_pins: Vec<&PinDiff> = pin_diffs
        .iter()
        .filter(|d| d.compatibility == PinCompatibility::RemovedPin)
        .collect();
    if !removed_pins.is_empty() {
        recommendations.push(format!(
            "{} pins removed in target chip: {}",
            removed_pins.len(),
            removed_pins
                .iter()
                .map(|d| d.pin_number.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }

    recommendations.push(format!(
        "Package compatibility: {} ({}). Footprint match: {}.",
        if package_compatible { "yes" } else { "no" },
        if old.package == new.package {
            format!("both {}", old.package)
        } else {
            format!("{} vs {}", old.package, new.package)
        },
        footprint_match
    ));

    // Signal compatibility against current hw.yaml signals
    let compatible_signals: Vec<String> = Vec::new();
    let incompatible_signals: Vec<String> = Vec::new();
    let missing_signals: Vec<String> = Vec::new();

    ChipDiffReport {
        from_chip: from.to_string(),
        to_chip: to.to_string(),
        from_vendor: old.vendor,
        to_vendor: new.vendor,
        from_package: old.package,
        to_package: new.package,
        from_family: old.family,
        to_family: new.family,
        package_compatible,
        footprint_match,
        added_capabilities,
        removed_capabilities,
        shared_capabilities,
        added_tools,
        removed_tools,
        shared_tools,
        pin_diffs,
        compatible_signals,
        incompatible_signals,
        missing_signals,
        migration_risk,
        migration_recommendations: recommendations,
    }
}

/// Build a full chip swap plan combining diff with current hardware state
pub fn build_chip_swap_plan(
    ext_dir: &Path,
    hw_yaml: &str,
    from: &str,
    to: &str,
) -> ChipSwapPlan {
    use crate::project::HardwareTruth;

    let diff = diff_chips(ext_dir, from, to);
    let hw = HardwareTruth::from_yaml(hw_yaml);

    let old_profile = load_chip_profile(ext_dir, from).unwrap_or_default();
    let new_profile = load_chip_profile(ext_dir, to).unwrap_or_default();

    // Map each current hardware signal to the new chip
    let affected_signals: Vec<MigratedSignal> = hw
        .signals
        .iter()
        .map(|sig| {
            // Try to find matching pin in new chip
            let old_pin_num = &sig.pin;
            let new_pin = find_compatible_pin(&old_profile, &new_profile, old_pin_num, &sig.name);

            match new_pin {
                Some(ref pin) if *pin == *old_pin_num => MigratedSignal {
                    name: sig.name.clone(),
                    old_pin: old_pin_num.clone(),
                    new_pin: pin.clone(),
                    status: SignalMigrationStatus::Direct,
                    note: String::new(),
                },
                Some(pin) => MigratedSignal {
                    name: sig.name.clone(),
                    old_pin: old_pin_num.clone(),
                    new_pin: pin.clone(),
                    status: SignalMigrationStatus::Remapped,
                    note: format!("Pin changed: {} → {}", old_pin_num, pin),
                },
                None => MigratedSignal {
                    name: sig.name.clone(),
                    old_pin: old_pin_num.clone(),
                    new_pin: String::new(),
                    status: SignalMigrationStatus::Lost,
                    note: format!(
                        "No compatible pin found for {} on {}. Function {} may be lost.",
                        sig.name, to, old_pin_num
                    ),
                },
            }
        })
        .collect();

    let mut required_code_changes: Vec<String> = Vec::new();

    // Check for remapped signals that need code changes
    for sig in &affected_signals {
        match sig.status {
            SignalMigrationStatus::Remapped => {
                required_code_changes.push(format!(
                    "Update pin definition for {}: {} → {}",
                    sig.name, sig.old_pin, sig.new_pin
                ));
            }
            SignalMigrationStatus::Lost => {
                required_code_changes.push(format!(
                    "Signal {} lost: remove code references or re-route to available pin",
                    sig.name
                ));
            }
            _ => {}
        }
    }

    // Check for capability loss
    for cap in &diff.removed_capabilities {
        required_code_changes.push(format!(
            "Capability '{}' removed: replace with alternative or remove dependent code",
            cap
        ));
    }

    if required_code_changes.is_empty() {
        required_code_changes
            .push("No code changes required for pin-compatible swap.".to_string());
    }

    let verification_checklist: Vec<String> = vec![
        "Verify all power pins (VDD, VSS, AVDD) are correctly connected".to_string(),
        "Verify oscillator/clock pins if different".to_string(),
        "Verify programming/debug interface pins (SWD, ICP, etc.)".to_string(),
        "Test each remapped peripheral individually".to_string(),
        "Run full firmware build with new chip target".to_string(),
        "Verify electrical characteristics (voltage range, current limits)".to_string(),
        "Check that new chip fuse/configuration bits are set correctly".to_string(),
    ];

    let decision_record_path = format!(".emb-agent/wiki/decisions/chip-swap-{}-to-{}.md", from, to);

    ChipSwapPlan {
        from_chip: from.to_string(),
        to_chip: to.to_string(),
        diff,
        affected_signals,
        required_code_changes,
        verification_checklist,
        decision_record_path,
        recommended_next: "task add 'Migrate firmware for chip swap {{from}} → {{to}}'".to_string(),
    }
}

fn find_compatible_pin(
    old: &ChipProfile,
    new: &ChipProfile,
    old_pin: &str,
    signal_name: &str,
) -> Option<String> {
    // Direct match: same pin number with same function
    if let (Some(old_p), Some(new_p)) = (old.pins.get(old_pin), new.pins.get(old_pin))
        && has_overlap(&old_p.functions, &new_p.functions) {
            return Some(old_pin.to_string());
        }

    // Search for pin with matching function name
    let old_functions = old
        .pins
        .get(old_pin)
        .map(|p| p.functions.clone())
        .unwrap_or_default();

    for (pin_num, pin_data) in &new.pins {
        if has_overlap(&old_functions, &pin_data.functions) {
            return Some(pin_num.clone());
        }
    }

    // Search by signal name
    for (pin_num, pin_data) in &new.pins {
        for func in &pin_data.functions {
            if func.to_lowercase().contains(&signal_name.to_lowercase())
                || signal_name.to_lowercase().contains(&func.to_lowercase())
            {
                return Some(pin_num.clone());
            }
        }
    }

    // Search by peripheral
    let old_periphs = old
        .pins
        .get(old_pin)
        .map(|p| p.peripherals.clone())
        .unwrap_or_default();

    for (pin_num, pin_data) in &new.pins {
        if has_overlap(&old_periphs, &pin_data.peripherals) {
            return Some(pin_num.clone());
        }
    }

    None
}

pub fn build_chip_diff_json(ext_dir: &Path, from: &str, to: &str) -> String {
    let report = diff_chips(ext_dir, from, to);
    serde_json::to_string_pretty(&report).unwrap_or_default()
}

pub fn build_chip_swap_json(ext_dir: &Path, hw_yaml: &str, from: &str, to: &str) -> String {
    let plan = build_chip_swap_plan(ext_dir, hw_yaml, from, to);
    serde_json::to_string_pretty(&plan).unwrap_or_default()
}

pub fn build_chip_swap_confirm_json(
    ext_dir: &Path,
    hw_yaml: &str,
    from: &str,
    to: &str,
) -> String {
    let plan = build_chip_swap_plan(ext_dir, hw_yaml, from, to);

    // Write the migration plan to wiki/decisions/
    let wiki_dir = ext_dir.join("wiki").join("decisions");
    let _ = fs::create_dir_all(&wiki_dir);

    let filename = format!(
        "chip-swap-{}-to-{}-{}.md",
        from,
        to,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    );
    let decision_path = wiki_dir.join(&filename);

    let mut md = vec![
        format!("# Chip Swap: {} → {}", from, to),
        String::new(),
        "## Summary".to_string(),
        format!("- Risk: {}", plan.diff.migration_risk),
        format!("- Footprint: {}", plan.diff.footprint_match),
        String::new(),
        "## Signal Migration".to_string(),
    ];
    for s in &plan.affected_signals {
        md.push(format!(
            "- **{}**: pin {} → {} [{}]",
            s.name, s.old_pin, s.new_pin, format!("{:?}", s.status).to_lowercase()
        ));
    }
    md.push(String::new());
    md.push("## Required Code Changes".to_string());
    for c in &plan.required_code_changes {
        md.push(format!("- {}", c));
    }
    md.push(String::new());
    md.push("## Verification Checklist".to_string());
    for c in &plan.verification_checklist {
        md.push(format!("- [ ] {}", c));
    }

    let _ = fs::write(&decision_path, md.join("\n"));

    let next_step = format!("task add \"Migrate firmware for {} → {}\"", from, to);
    let rel_path = decision_path
        .strip_prefix(ext_dir.parent().unwrap_or(Path::new(".")))
        .unwrap_or(&decision_path)
        .to_string_lossy()
        .to_string();

    let mut result: serde_json::Value = serde_json::to_value(&plan).unwrap_or_default();
    if let Some(obj) = result.as_object_mut() {
        obj.insert(
            "_decision_written".to_string(),
            serde_json::Value::String(rel_path),
        );
        obj.insert(
            "_next_step".to_string(),
            serde_json::Value::String(next_step),
        );
    }
    serde_json::to_string_pretty(&result).unwrap_or_default()
}
