use serde::Serialize;

use crate::hardware::project::ProjectSnapshot;

/// Mirror of JS buildScanOutput + dependencies for fast scan payload generation.

#[derive(Debug, Clone, Serialize)]
pub struct ScanOutput {
    pub relevant_files: Vec<String>,
    pub key_facts: Vec<String>,
    pub open_questions: Vec<String>,
    pub next_reads: Vec<String>,
    pub workflow_stage: ScanWorkflowStage,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanWorkflowStage {
    pub name: String,
    pub why: String,
    pub exit_criteria: String,
    pub primary_command: String,
    pub stage: String,
    pub action: String,
}

const READ_HINTS: &[(&str, &str)] = &[
    (
        "hardware_truth",
        "Hardware truth sources: datasheet / schematic / pin map",
    ),
    (
        "registers",
        "Registers and bit definitions: manual register chapter / headers",
    ),
    (
        "entry_points",
        "Code entry points: reset / main loop / ISR entry",
    ),
    (
        "shared_state",
        "Shared state: variables / flags shared by ISR and main loop",
    ),
];

fn read_hint(key: &str) -> String {
    READ_HINTS
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.to_string())
        .unwrap_or_else(|| key.to_string())
}

pub fn build_scan_output(snapshot: &ProjectSnapshot) -> ScanOutput {
    let ext_dir = format!("{}/.emb-agent", snapshot.project_root);
    let _hw_path = format!("{}/hw.yaml", ext_dir);
    let req_path = format!("{}/req.yaml", ext_dir);
    let prd_path = "docs/prd/system.md".to_string();

    // Determine blank selection mode based on hardware identity
    let is_blank = snapshot.mcu_model.is_empty()
        || snapshot.mcu_model == "unknown"
        || snapshot.mcu_package.is_empty();

    // --- truth files ---
    let truth_files: Vec<String> = if is_blank {
        [prd_path.clone(), req_path.clone()]
            .iter()
            .filter(|p| std::path::Path::new(p).exists())
            .cloned()
            .collect()
    } else {
        [prd_path.clone(), _hw_path.clone(), req_path.clone()]
            .iter()
            .filter(|p| std::path::Path::new(p).exists())
            .cloned()
            .collect()
    };

    // --- key facts ---
    let selection_mode = if is_blank {
        "blank-project"
    } else {
        "existing-hardware"
    };
    let key_facts: Vec<String> = vec![
        format!("profile=baremetal-loop"),
        "runtime_model=main_loop_plus_isr".to_string(),
        "concurrency_model=interrupt_shared_state".to_string(),
        "resource_priority=flash -> ram -> stack -> isr_latency".to_string(),
        if truth_files.is_empty() {
            "project_truth=missing".to_string()
        } else {
            format!("project_truth={}", truth_files.join(", "))
        },
        format!("selection_mode={}", selection_mode),
        "focus_areas=hardware_truth, state_ownership, isr_shared_state, time_base, c_interface_boundaries, board_binding, verification".to_string(),
    ];

    // --- open questions ---
    let open_questions: Vec<String> = if is_blank {
        vec![
            "What must this product actually do, and what can stay out of scope for the first board?".to_string(),
            "Which firmware organization shape is justified by the resource, timing, interface, and verification constraints?".to_string(),
            "Which constraints are already known: supply voltage, cost target, package size, IO count, peripherals, timing, low power, certification?".to_string(),
            "Is there any reference module, legacy board, or preferred vendor family that should bias chip selection?".to_string(),
        ]
    } else {
        vec![
            "Have hardware truth sources been confirmed down to pins, registers, and timing?"
                .to_string(),
            "Which ISR and main-loop shared states are most worth re-checking first?".to_string(),
        ]
    };

    // --- preferred read keys ---
    let preferred_read_keys: Vec<&str> = if is_blank {
        vec![]
    } else {
        vec!["hardware_truth", "registers"]
    };

    // --- next reads ---
    let mut next_reads: Vec<String> = truth_files
        .iter()
        .map(|f| format!("truth_layer={}", f))
        .collect();

    if is_blank {
        next_reads.push(format!("selection_input={}", prd_path));
        next_reads.push(format!("structured_selection_input={}", req_path));
        next_reads.push(
            "selection_scope=collect only decision-shaping facts first: power, package, IO, peripherals, timing, cost, environment"
                .to_string(),
        );
    }

    for key in &preferred_read_keys {
        next_reads.push(read_hint(key));
    }

    // Add scan-specific safety suggestions
    if !is_blank {
        next_reads.push("Read truth sources before drawing conclusions".to_string());
        next_reads.push("Separate explicit documentation from engineering inference".to_string());
    }

    let workflow_stage = ScanWorkflowStage {
        name: if is_blank {
            "selection".to_string()
        } else {
            "scan".to_string()
        },
        why: if is_blank {
            "Project constraints are explicit enough to shortlist a real chip candidate or first hardware target"
                .to_string()
        } else {
            "Active task or hardware surface needs a convergence pass first".to_string()
        },
        exit_criteria: if is_blank {
            "A concrete, ranked shortlist of chip candidates, or an explicit hardware target is recorded"
                .to_string()
        } else {
            "Hardware truth, constraints, and change surface are explicit enough to enter plan or do"
                .to_string()
        },
        primary_command: "/emb:scan".to_string(),
        stage: "scan".to_string(),
        action: if is_blank {
            "Continue with plan".to_string()
        } else {
            "Continue with scan".to_string()
        },
    };

    // --- relevant files ---
    let mut relevant_files: Vec<String> = truth_files.clone();
    if is_blank {
        relevant_files.push(req_path);
    }

    ScanOutput {
        relevant_files: dedup(relevant_files),
        key_facts: dedup(key_facts),
        open_questions: dedup(open_questions),
        next_reads: dedup(next_reads),
        workflow_stage,
    }
}

pub fn build_scan_output_json(snapshot: &ProjectSnapshot) -> String {
    let output = build_scan_output(snapshot);
    let (next, next_instructions) = crate::session::render::build_next_routing(snapshot);
    let mut json: serde_json::Value = serde_json::to_value(&output).unwrap_or_default();
    if let Some(obj) = json.as_object_mut() {
        obj.insert("next".to_string(), serde_json::Value::String(next));
        obj.insert(
            "next_instructions".to_string(),
            serde_json::Value::String(next_instructions),
        );
    }
    serde_json::to_string_pretty(&json).unwrap_or_default()
}

fn dedup(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut result = Vec::new();
    for v in values {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.clone()) {
            result.push(trimmed);
        }
    }
    result
}
