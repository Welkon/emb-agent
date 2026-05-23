use serde::Serialize;

use crate::project::ProjectSnapshot;

#[derive(Debug, Clone, Serialize)]
pub struct PlanOutput {
    pub goal: String,
    pub truth_sources: Vec<String>,
    pub constraints: Vec<String>,
    pub risks: Vec<String>,
    pub steps: Vec<String>,
    pub verification: Vec<String>,
    pub workflow_stage: WorkflowStage,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewOutput {
    pub scope: ReviewScope,
    pub axes: Vec<String>,
    pub findings_template: Vec<String>,
    pub required_checks: Vec<String>,
    pub review_agents: Vec<String>,
    pub workflow_stage: WorkflowStage,
}

#[derive(Debug, Clone, Serialize)]
pub struct VerifyOutput {
    pub scope: VerifyScope,
    pub checklist: Vec<String>,
    pub evidence_targets: Vec<String>,
    pub result_template: Vec<String>,
    pub next_step: String,
    pub verification_focus: Vec<String>,
    pub workflow_stage: WorkflowStage,
}

#[derive(Debug, Clone, Serialize)]
pub struct DebugOutput {
    pub hypotheses: Vec<String>,
    pub checks: Vec<String>,
    pub next_step: String,
    pub chosen_agent: String,
    pub workflow_stage: WorkflowStage,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReviewScope {
    pub profile: String,
    pub specs: Vec<String>,
    pub focus: String,
    pub runtime_model: String,
    pub concurrency_model: String,
    pub focus_areas: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VerifyScope {
    pub profile: String,
    pub specs: Vec<String>,
    pub focus: String,
    pub runtime_model: String,
    pub concurrency_model: String,
    pub last_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowStage {
    pub name: String,
    pub why: String,
    pub exit_criteria: String,
    pub primary_command: String,
    pub stage: String,
    pub action: String,
}

fn is_blank(snapshot: &ProjectSnapshot) -> bool {
    snapshot.mcu_model.is_empty()
        || snapshot.mcu_model == "unknown"
        || snapshot.mcu_package.is_empty()
}

pub fn build_plan_output(snapshot: &ProjectSnapshot) -> PlanOutput {
    let blank = is_blank(snapshot);

    let goal = if blank {
        "Turn the concept-stage system contract into a ranked device shortlist with explicit criteria"
            .to_string()
    } else {
        "Lock the task plan: truth sources, constraints, steps, and verification"
            .to_string()
    };

    let truth_sources = if blank {
        vec![
            "docs/prd/system.md".to_string(),
            ".emb-agent/req.yaml".to_string(),
        ]
    } else {
        vec![
            ".emb-agent/hw.yaml".to_string(),
            ".emb-agent/req.yaml".to_string(),
            "docs/prd/system.md".to_string(),
        ]
    };

    let constraints: Vec<String> = if blank {
        vec![
            "Chip selection criteria: power, package, IO count, peripherals, timing, cost"
                .to_string(),
            "Resource budget: flash, RAM, stack, ISR latency".to_string(),
            "Verify selection criteria before recording the shortlist".to_string(),
        ]
    } else {
        vec![
            "Resource: flash, RAM, stack boundaries".to_string(),
            "Hardware: pins, registers, timing, ISR".to_string(),
            "Only produce a task-level plan; do not expand into phase planning".to_string(),
        ]
    };

    let risks = if blank {
        vec![
            "Selecting a chip based on intuition or category without explicit criteria"
                .to_string(),
            "Filling the shortlist without verifying candidate evidence".to_string(),
        ]
    } else {
        vec![
            "Under-specified truth sources".to_string(),
            "Unverified timing assumptions".to_string(),
        ]
    };

    let steps = if blank {
        vec![
            "1. Confirm system contract in docs/prd/system.md and req.yaml".to_string(),
            "2. Shortlist candidate chips with explicit selection criteria".to_string(),
            "3. Record ranked shortlist and evidence in plan output".to_string(),
        ]
    } else {
        vec![
            "1. Lock truth sources: hw.yaml, req.yaml, datasheet pages".to_string(),
            "2. Define constraints: resource bounds, timing, pins".to_string(),
            "3. Sequence implementation steps with verification checkpoints"
                .to_string(),
        ]
    };

    let verification = if blank {
        vec![
            "Selection criteria are explicit and non-contradictory".to_string(),
            "Candidate evidence is recorded per device".to_string(),
        ]
    } else {
        vec![
            "Every step has a clear verification checkpoint".to_string(),
            "Constraints are traceable to hardware truth".to_string(),
        ]
    };

    PlanOutput {
        goal,
        truth_sources: dedup(truth_sources),
        constraints: dedup(constraints),
        risks: dedup(risks),
        steps: dedup(steps),
        verification: dedup(verification),
        workflow_stage: stage("plan", "Lock task plan before execution"),
    }
}

pub fn build_review_output(snapshot: &ProjectSnapshot) -> ReviewOutput {
    let blank = is_blank(snapshot);

    ReviewOutput {
        scope: ReviewScope {
            profile: "baremetal-loop".to_string(),
            specs: vec![],
            focus: String::new(),
            runtime_model: "main_loop_plus_isr".to_string(),
            concurrency_model: "interrupt_shared_state".to_string(),
            focus_areas: vec![
                "hardware_truth".to_string(),
                "state_ownership".to_string(),
                "isr_shared_state".to_string(),
                "time_base".to_string(),
                "c_interface_boundaries".to_string(),
                "board_binding".to_string(),
                "verification".to_string(),
            ],
        },
        axes: vec![
            "interrupt_safety".to_string(),
            "shared_state".to_string(),
            "timing_path".to_string(),
            "memory_budget".to_string(),
            "pin_mux_conflicts".to_string(),
        ],
        findings_template: if blank {
            vec![
                "Selection criteria adequacy".to_string(),
                "Candidate evidence completeness".to_string(),
                "Architecture alignment".to_string(),
            ]
        } else {
            vec![
                "Confirmed risks".to_string(),
                "Risks to verify".to_string(),
                "Timing / register path".to_string(),
            ]
        },
        required_checks: vec![
            "This is not a code-style review".to_string(),
            "Separate confirmed risks from risks that still need verification"
                .to_string(),
            "Keep conclusions tied to real system boundaries".to_string(),
        ],
        review_agents: vec!["emb-hw-scout".to_string()],
        workflow_stage: stage(
            "review",
            if blank {
                "Review selection criteria and candidate evidence before locking"
            } else {
                "Review structural risks before execution"
            },
        ),
    }
}

pub fn build_verify_output(snapshot: &ProjectSnapshot) -> VerifyOutput {
    let blank = is_blank(snapshot);

    VerifyOutput {
        scope: VerifyScope {
            profile: "baremetal-loop".to_string(),
            specs: vec![],
            focus: String::new(),
            runtime_model: "main_loop_plus_isr".to_string(),
            concurrency_model: "interrupt_shared_state".to_string(),
            last_files: vec![],
        },
        checklist: if blank {
            vec![
                "Selection shortlist is recorded".to_string(),
                "Decision criteria are explicit".to_string(),
                "Evidence is linked per candidate".to_string(),
            ]
        } else {
            vec![
                "Hardware truth sources verified".to_string(),
                "Implementation matches the plan".to_string(),
                "Verification evidence recorded".to_string(),
            ]
        },
        evidence_targets: vec![
            "Output artifact or behavior change".to_string(),
            "Build artifact or measurement trace".to_string(),
            "Regression check recorded if applicable".to_string(),
        ],
        result_template: vec![
            "What was verified".to_string(),
            "How it was verified".to_string(),
            "Evidence path".to_string(),
        ],
        next_step: if blank {
            "Record the shortlist and decision rationale".to_string()
        } else {
            "List this round's verification targets first".to_string()
        },
        verification_focus: if blank {
            vec!["selection-completeness".to_string(), "failure-paths".to_string()]
        } else {
            vec!["board-behavior".to_string(), "failure-paths".to_string()]
        },
        workflow_stage: stage("verify", "Close the iteration with a result record"),
    }
}

pub fn build_debug_output(snapshot: &ProjectSnapshot) -> DebugOutput {
    let blank = is_blank(snapshot);

    DebugOutput {
        hypotheses: if blank {
            vec![
                "System contract is underspecified".to_string(),
                "Chip selection criteria are implicit or missing".to_string(),
            ]
        } else {
            vec![
                "Update order for ISR and main-loop shared state is incorrect"
                    .to_string(),
                "Timing windows or register configuration do not satisfy current behavior"
                    .to_string(),
                "Pin mux or board-connection understanding is incorrect"
                    .to_string(),
            ]
        },
        checks: if blank {
            vec![
                "Check system contract completeness in docs/prd/system.md"
                    .to_string(),
                "Check req.yaml for explicit constraints".to_string(),
            ]
        } else {
            vec![
                "Check ISR set/clear flag handling and main-loop consumption order"
                    .to_string(),
                "Check critical registers, pin muxing, and timing requirements"
                    .to_string(),
            ]
        },
        next_step: "Pin down the current symptom first".to_string(),
        chosen_agent: "emb-hw-scout".to_string(),
        workflow_stage: stage(
            "debug",
            if blank {
                "Narrow underspecified constraints before execution"
            } else {
                "Narrow the root cause around open questions"
            },
        ),
    }
}

fn stage(name: &str, why: &str) -> WorkflowStage {
    WorkflowStage {
        name: name.to_string(),
        why: why.to_string(),
        exit_criteria: format!(
            "{} is complete enough to move to the next stage",
            name
        ),
        primary_command: format!("capability run {}", name),
        stage: name.to_string(),
        action: format!("Continue with {}", name),
    }
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

pub fn build_plan_output_json(snapshot: &ProjectSnapshot) -> String {
    serde_json::to_string_pretty(&build_plan_output(snapshot)).unwrap_or_default()
}

pub fn build_review_output_json(snapshot: &ProjectSnapshot) -> String {
    serde_json::to_string_pretty(&build_review_output(snapshot)).unwrap_or_default()
}

pub fn build_verify_output_json(snapshot: &ProjectSnapshot) -> String {
    serde_json::to_string_pretty(&build_verify_output(snapshot)).unwrap_or_default()
}

pub fn build_debug_output_json(snapshot: &ProjectSnapshot) -> String {
    serde_json::to_string_pretty(&build_debug_output(snapshot)).unwrap_or_default()
}
