use serde::Serialize;

use crate::hardware::project::ProjectSnapshot;

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
    pub feedback_loop: Vec<String>,
    pub diagnosis_phases: Vec<String>,
    pub hypotheses: Vec<String>,
    pub checks: Vec<String>,
    pub instrumentation_rules: Vec<String>,
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
        "Lock the task plan: truth sources, constraints, steps, and verification".to_string()
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
            "Selecting a chip based on intuition or category without explicit criteria".to_string(),
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
            "3. Sequence implementation steps with verification checkpoints".to_string(),
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
            "Separate confirmed risks from risks that still need verification".to_string(),
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
            vec![
                "selection-completeness".to_string(),
                "failure-paths".to_string(),
            ]
        } else {
            vec!["board-behavior".to_string(), "failure-paths".to_string()]
        },
        workflow_stage: stage("verify", "Close the iteration with a result record"),
    }
}

pub fn build_debug_output(snapshot: &ProjectSnapshot) -> DebugOutput {
    let blank = is_blank(snapshot);

    DebugOutput {
        feedback_loop: if blank {
            vec![
                "Validate docs/prd/system.md and .emb-agent/req.yaml completeness before treating behavior as a bug".to_string(),
                "Build a minimal host-side fixture or state-machine replay for the unknown behavior".to_string(),
                "Capture the missing hardware/requirement artifact instead of guessing".to_string(),
            ]
        } else {
            vec![
                "Create the tightest deterministic pass/fail loop before mutation: failing test, CLI/parser fixture, simulator run, captured trace replay, serial log script, GPIO pulse + logic analyzer, scope/current-meter measurement, or explicit HITL bench step".to_string(),
                "Run the loop more than once; for flaky faults, raise reproduction rate with repeated runs, stress, or narrowed timing windows before hypothesizing".to_string(),
                "Record the exact symptom and acceptance signal that proves the original fault is gone".to_string(),
            ]
        },
        diagnosis_phases: vec![
            "1. Build feedback loop".to_string(),
            "2. Reproduce and capture the user-visible failure".to_string(),
            "3. Minimise trigger and rank 3-5 falsifiable hypotheses".to_string(),
            "4. Instrument one variable at a time".to_string(),
            "5. Fix with a regression check at the correct seam".to_string(),
            "6. Remove probes and record reusable traps/tricks/decisions".to_string(),
        ],
        hypotheses: if blank {
            vec![
                "If the system contract is underspecified, then PRD/req truth validation will expose missing behavior or acceptance fields".to_string(),
                "If chip selection criteria are implicit, then hardware unknowns or conflicting constraints will block reproducible diagnosis".to_string(),
            ]
        } else {
            vec![
                "If ISR/main-loop shared state ordering is wrong, then instrumenting flag set/clear boundaries will show a missed or duplicated transition".to_string(),
                "If timing windows or register configuration violate the behavior contract, then a trace around clock, timer, interrupt, or PWM registers will diverge at the symptom boundary".to_string(),
                "If pin mux or board-connection understanding is wrong, then a direct pin/peripheral probe will contradict hw.yaml or schematic truth".to_string(),
            ]
        },
        checks: if blank {
            vec![
                "Check system contract completeness in docs/prd/system.md".to_string(),
                "Check req.yaml for explicit constraints and acceptance evidence".to_string(),
                "Run emb-agent validate or health after truth edits".to_string(),
            ]
        } else {
            vec![
                "Check ISR set/clear flag handling and main-loop consumption order".to_string(),
                "Check critical registers, pin muxing, and timing requirements".to_string(),
                "Turn the reproduced fault into a regression check or documented bench validation step before closing".to_string(),
            ]
        },
        instrumentation_rules: vec![
            "Each probe must test one hypothesis prediction; change one variable per pass".to_string(),
            "Tag temporary logs, GPIO toggles, and debug macros with DEBUG_PROBE_HUNTER so cleanup is mechanical".to_string(),
            "Separate [VERIFIED_FACT] evidence from [PROBABILISTIC_HYPOTHESIS] interpretation".to_string(),
        ],
        next_step: "Build or identify the feedback loop before changing operational logic".to_string(),
        chosen_agent: "emb-bug-hunter".to_string(),
        workflow_stage: stage(
            "debug",
            if blank {
                "Narrow underspecified constraints before execution"
            } else {
                "Reproduce first, then test ranked hypotheses"
            },
        ),
    }
}

fn stage(name: &str, why: &str) -> WorkflowStage {
    WorkflowStage {
        name: name.to_string(),
        why: why.to_string(),
        exit_criteria: format!("{} is complete enough to move to the next stage", name),
        primary_command: format!("/emb:{}", name),
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
    let output = build_plan_output(snapshot);
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

pub fn build_review_output_json(snapshot: &ProjectSnapshot) -> String {
    let output = build_review_output(snapshot);
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

pub fn build_verify_output_json(snapshot: &ProjectSnapshot) -> String {
    let output = build_verify_output(snapshot);
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

pub fn build_debug_output_json(snapshot: &ProjectSnapshot) -> String {
    let output = build_debug_output(snapshot);
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct DoOutput {
    pub status: String,
    pub action: String,
    pub active_task: Option<TaskInfo>,
    pub recommendation: String,
    pub instructions: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TaskInfo {
    pub name: String,
    pub title: String,
    pub phase: String,
    pub priority: String,
}

pub fn build_do_output(snapshot: &ProjectSnapshot) -> DoOutput {
    let active_task = snapshot.current_task.as_ref().map(|t| TaskInfo {
        name: t.name.clone(),
        title: t.title.clone(),
        phase: "implement".to_string(),
        priority: t.priority.clone(),
    });

    let (recommendation, instructions) = if snapshot.current_task.is_some() {
        (
            "Implement the active task",
            "Active task exists. Proceed with implementation:\n\
1. Read the task PRD (.emb-agent/tasks/<task>/task.json)\n\
2. Write firmware code in src/\n\
3. Compile and verify through the normal project checks\n\
4. After implementation evidence exists, trigger `/emb:review`"
                .to_string(),
        )
    } else {
        (
            "No active task",
            "No active task. Trigger `/emb-next` to get routing recommendation.".to_string(),
        )
    };

    DoOutput {
        status: "ok".to_string(),
        action: "do".to_string(),
        active_task,
        recommendation: recommendation.to_string(),
        instructions,
    }
}

pub fn build_do_output_json(snapshot: &ProjectSnapshot) -> String {
    let output = build_do_output(snapshot);
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
