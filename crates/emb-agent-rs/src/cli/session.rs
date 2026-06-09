use super::util::{current_dir_string, option_value};
use emb_agent_core::{
    build_external_dispatch_next_json, build_external_health_json, build_external_next_json,
    build_external_start_json, build_external_status_json, build_health_json,
    build_next_json_with_tasks_and_policy, build_session_context, build_start_json,
    build_status_json, build_statusline, evaluate_worktree_policy, read_all_tasks,
    snapshot_from_cwd,
};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let snapshot = snapshot_from_cwd(&cwd);
    match args.first().map(String::as_str).unwrap_or("") {
        "statusline" => {
            println!("{}", build_statusline(&snapshot));
            Ok(())
        }
        "start" => {
            if args.iter().any(|a| a == "--json" || a == "--brief") {
                println!("{}", build_start_json(&snapshot));
            } else {
                println!("{}", build_session_context(&snapshot));
            }
            Ok(())
        }
        "next" => {
            if args.iter().any(|a| a == "--json" || a == "--brief") {
                let ext_dir = Path::new(&cwd).join(".emb-agent");
                let tasks = read_all_tasks(&ext_dir);
                let target_task = snapshot
                    .current_task
                    .as_ref()
                    .map(|task| task.name.as_str());
                let policy = evaluate_worktree_policy(&ext_dir, Path::new(&cwd), target_task);
                println!(
                    "{}",
                    build_next_json_with_tasks_and_policy(&snapshot, &tasks, Some(&policy))
                );
            } else {
                println!("{}", build_session_context(&snapshot));
            }
            Ok(())
        }
        "status" => {
            println!("{}", build_status_json(&snapshot));
            Ok(())
        }
        "health" => {
            println!("{}", build_health_json(&snapshot));
            Ok(())
        }
        "pause" => {
            let ext_dir = Path::new(&cwd).join(".emb-agent");
            let note = args.get(1).map(|s| s.as_str()).unwrap_or("");
            println!(
                "{}",
                emb_agent_core::meta_ops::pause_session(&ext_dir, note)
            );
            Ok(())
        }
        "resume" => {
            let ext_dir = Path::new(&cwd).join(".emb-agent");
            println!("{}", emb_agent_core::meta_ops::resume_session(&ext_dir));
            Ok(())
        }
        _ => Err(format!(
            "unknown session command: {}",
            args.first().unwrap_or(&String::new())
        )),
    }
}

pub fn run_external(args: &[String]) -> Result<(), String> {
    let entrypoint = args.get(1).map(String::as_str).unwrap_or("next");
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let snapshot = snapshot_from_cwd(&cwd);
    let ext_dir = Path::new(&cwd).join(".emb-agent");
    let tasks = read_all_tasks(&ext_dir);

    match entrypoint {
        "start" => {
            println!("{}", build_external_start_json(&snapshot));
            Ok(())
        }
        "next" => {
            println!("{}", build_external_next_json(&snapshot, &tasks));
            Ok(())
        }
        "status" => {
            println!("{}", build_external_status_json(&snapshot));
            Ok(())
        }
        "health" => {
            println!("{}", build_external_health_json(&snapshot));
            Ok(())
        }
        "dispatch-next" => {
            println!("{}", build_external_dispatch_next_json(&snapshot, &tasks));
            Ok(())
        }
        _ => Err(format!(
            "unknown external entrypoint: {entrypoint}. Valid: start, next, status, health, dispatch-next"
        )),
    }
}

pub fn run_actions(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let snapshot = snapshot_from_cwd(&cwd);
    match args.first().map(String::as_str).unwrap_or("") {
        "scan" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_scan_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        "plan" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_plan_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        "do" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_do_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        "review" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_review_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        "verify" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_verify_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        "debug" => {
            println!(
                "{}",
                with_worktree_policy(
                    emb_agent_core::build_debug_output_json(&snapshot),
                    &snapshot,
                    &cwd
                )
            );
            Ok(())
        }
        _ => Err(format!(
            "unknown action: {}",
            args.first().unwrap_or(&String::new())
        )),
    }
}

fn with_worktree_policy(
    json_text: String,
    snapshot: &emb_agent_core::ProjectSnapshot,
    cwd: &str,
) -> String {
    let Some(task) = &snapshot.current_task else {
        return json_text;
    };
    let ext_dir = Path::new(cwd).join(".emb-agent");
    let policy = evaluate_worktree_policy(&ext_dir, Path::new(cwd), Some(&task.name));
    if policy.decision == "not-needed" {
        return json_text;
    }
    let mut value: serde_json::Value = serde_json::from_str(&json_text).unwrap_or_default();
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "worktree_policy".to_string(),
            emb_agent_core::worktree_policy_json(&policy),
        );
        if policy.decision == "required" {
            obj.insert(
                "agent_protocol".to_string(),
                serde_json::json!({
                    "gate": {
                        "kind": "worktree-required",
                        "blocking": true,
                        "reason": policy.reason,
                        "allowed_actions": ["present_worktree_reason", "trigger_task_activate_with_worktree"],
                        "forbidden_actions": ["continue_in_main_workspace", "ask_user_to_run_task_activate", "run_shell_command_for_emb_slash_command"],
                        "recommended_command": policy.recommended_command
                    }
                }),
            );
            obj.insert(
                "next_instructions".to_string(),
                serde_json::Value::String(format!(
                    "Worktree isolation is required before execution. Trigger `/emb:task activate {} --worktree`; do not ask the user to run the command.",
                    task.name
                )),
            );
        }
    }
    serde_json::to_string_pretty(&value).unwrap_or(json_text)
}
