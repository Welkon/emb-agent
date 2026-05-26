use super::util::{current_dir_string, option_value};
use emb_agent_core::{
    build_health_json, build_next_json_with_tasks, build_session_context, build_start_json,
    build_status_json, build_statusline, read_all_tasks, snapshot_from_cwd,
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
                println!("{}", build_next_json_with_tasks(&snapshot, &tasks));
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

pub fn run_actions(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let snapshot = snapshot_from_cwd(&cwd);
    match args.first().map(String::as_str).unwrap_or("") {
        "scan" => {
            println!("{}", emb_agent_core::build_scan_output_json(&snapshot));
            Ok(())
        }
        "plan" => {
            println!("{}", emb_agent_core::build_plan_output_json(&snapshot));
            Ok(())
        }
        "do" => {
            println!("{}", emb_agent_core::build_do_output_json(&snapshot));
            Ok(())
        }
        "review" => {
            println!("{}", emb_agent_core::build_review_output_json(&snapshot));
            Ok(())
        }
        "verify" => {
            println!("{}", emb_agent_core::build_verify_output_json(&snapshot));
            Ok(())
        }
        "debug" => {
            println!("{}", emb_agent_core::build_debug_output_json(&snapshot));
            Ok(())
        }
        _ => Err(format!(
            "unknown action: {}",
            args.first().unwrap_or(&String::new())
        )),
    }
}
