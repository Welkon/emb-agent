use super::util::{current_dir_string, option_value};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cmd = args.first().map(String::as_str).unwrap_or("");
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let ext_dir = Path::new(&cwd).join(".emb-agent");

    match cmd {
        "" | "help" | "--help" | "-h" => {
            print_default_user_flow();
            Ok(())
        }
        "config" => {
            println!("{}", emb_agent_core::meta_ops::config_show(&ext_dir));
            Ok(())
        }
        "prd" => match args.get(1).map(String::as_str) {
            Some("status") => {
                println!("{}", emb_agent_core::prd_ops::prd_status(&ext_dir));
                Ok(())
            }
            _ => Err("prd: expected status".to_string()),
        },
        "session" => {
            println!("{}", emb_agent_core::meta_ops::session_show(&ext_dir));
            Ok(())
        }
        "context" => {
            println!("{}", emb_agent_core::meta_ops::context_show(&ext_dir));
            Ok(())
        }
        "bootstrap" => {
            println!("{}", emb_agent_core::meta_ops::bootstrap_status(&ext_dir));
            Ok(())
        }
        "declare" => {
            let mcu = option_value(args, "--mcu").unwrap_or_default();
            let pkg = option_value(args, "--package").unwrap_or_default();
            println!(
                "{}",
                emb_agent_core::meta_ops::declare_hardware(&ext_dir, &mcu, &pkg)
            );
            Ok(())
        }
        "resolve" => {
            let name = args.get(1).ok_or("resolve requires <task-name>")?;
            let note = args.get(2).map(|s| s.as_str()).unwrap_or("");
            println!(
                "{}",
                emb_agent_core::task::task_ops::task_resolve(&ext_dir, name, note)
            );
            Ok(())
        }
        _ => Err(format!("unknown misc command: {cmd}")),
    }
}

fn print_default_user_flow() {
    println!(
        "{}",
        [
            "emb-agent default user flow:",
            "  1. /emb onboard    create or repair project context",
            "  2. /emb ingest     import datasheets, schematics, SDK notes, and source truth",
            "  3. /emb start      summarize known truth, task/session state, gaps, and workflow",
            "  4. /emb next       choose exactly one most useful next action",
            "  5. /emb task       create or continue focused work after context exists",
            "  6. /emb session    review continuity; use /emb transcript for handoff details",
            "",
            "Recommended next step: /emb onboard",
            "Existing emb-agent project: /emb start",
            "If unsure: /emb help",
        ]
        .join("\n")
    );
}

pub fn run_ext_ops(args: &[String]) -> Result<(), String> {
    let cmd = args.first().map(String::as_str).unwrap_or("");
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let ext_dir = Path::new(&cwd).join(".emb-agent");
    let project_root = Path::new(&cwd);

    match cmd {
        "init" | "init-project" => {
            println!("{}", emb_agent_core::ext_ops::init_project(Path::new(&cwd)));
            Ok(())
        }
        "onboard" => {
            println!(
                "{}",
                emb_agent_core::ext_ops::onboard_status(Path::new(&cwd))
            );
            Ok(())
        }
        "doctor" => {
            let host = option_value(args, "--host").unwrap_or_else(|| "all".to_string());
            println!(
                "{}",
                emb_agent_core::ext_ops::install_doctor(Path::new(&cwd), &host)
            );
            Ok(())
        }
        "validate" => {
            let errors = emb_agent_core::validate_truth_files(project_root);
            let ok = errors.is_empty();
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "status": if ok { "ok" } else { "error" },
                    "truth_validation_errors": errors
                }))
                .unwrap_or_else(|_| "{\"status\":\"error\"}".to_string())
            );
            Ok(())
        }
        "migrate" => {
            println!("{}", emb_agent_core::ext_ops::migrate_status(&ext_dir));
            Ok(())
        }
        "skills" => {
            println!("{}", emb_agent_core::ext_ops::skills_status(&ext_dir));
            Ok(())
        }
        "update" => {
            println!("{}", emb_agent_core::ext_ops::update_check(&ext_dir));
            Ok(())
        }
        "settings" => match args.get(1).map(String::as_str) {
            Some("show") => {
                println!("{}", emb_agent_core::ext_ops::settings_show(&ext_dir));
                Ok(())
            }
            Some("set") => {
                let key = option_value(args, "--key").unwrap_or_default();
                let value = option_value(args, "--value").unwrap_or_default();
                println!(
                    "{}",
                    emb_agent_core::ext_ops::settings_set(&ext_dir, &key, &value)
                );
                Ok(())
            }
            _ => Err("settings: expected show or set".to_string()),
        },
        "decision" => {
            println!("{}", emb_agent_core::ext_ops::decision_status(&ext_dir));
            Ok(())
        }
        "commands" => {
            let show_all = args.iter().any(|arg| arg == "--all");
            println!("{}", emb_agent_core::ext_ops::commands_list(show_all));
            Ok(())
        }
        "note" => match args.get(1).map(String::as_str) {
            Some("add") => {
                let t = args.get(2).map(|s| s.as_str()).unwrap_or("");
                println!("{}", emb_agent_core::ext_ops::note_add(&ext_dir, t));
                Ok(())
            }
            Some("show") => {
                println!("{}", emb_agent_core::ext_ops::note_show(&ext_dir));
                Ok(())
            }
            _ => Err("note: expected add or show".to_string()),
        },
        "capability" => {
            let name = args.get(2).map(|s| s.as_str()).unwrap_or("");
            if args.get(1).map(String::as_str) == Some("run") {
                let snapshot = emb_agent_core::snapshot_from_cwd(&cwd);
                let output = match name {
                    "scan" => emb_agent_core::build_scan_output_json(&snapshot),
                    "plan" => emb_agent_core::build_plan_output_json(&snapshot),
                    "do" => emb_agent_core::build_do_output_json(&snapshot),
                    "review" => emb_agent_core::build_review_output_json(&snapshot),
                    "verify" => emb_agent_core::build_verify_output_json(&snapshot),
                    "debug" => emb_agent_core::build_debug_output_json(&snapshot),
                    _ => emb_agent_core::ext_ops::capability_run(&ext_dir, name),
                };
                println!("{output}");
            } else {
                println!(
                    "{}",
                    emb_agent_core::ext_ops::capability_run(&ext_dir, name)
                );
            }
            Ok(())
        }
        "executor" => {
            let name = args.get(2).map(|s| s.as_str()).unwrap_or("");
            println!("{}", emb_agent_core::ext_ops::executor_run(&ext_dir, name));
            Ok(())
        }
        "dispatch" => {
            let job = args.get(1).map(|s| s.as_str()).unwrap_or("");
            println!(
                "{}",
                emb_agent_core::ext_ops::dispatch_orchestrate(&ext_dir, job)
            );
            Ok(())
        }
        "scaffold" => {
            let name = args.get(1).map(|s| s.as_str()).unwrap_or("");
            println!(
                "{}",
                emb_agent_core::ext_ops::scaffold_generate(&ext_dir, name)
            );
            Ok(())
        }
        "transcript" => {
            println!("{}", emb_agent_core::ext_ops::transcript_show(&ext_dir));
            Ok(())
        }
        "prefs" => {
            println!("{}", emb_agent_core::ext_ops::prefs_show(&ext_dir));
            Ok(())
        }
        "tool" => {
            let name = args.get(1).map(|s| s.as_str()).unwrap_or("");
            println!("{}", emb_agent_core::ext_ops::tool_run(&ext_dir, name));
            Ok(())
        }
        "snippet" => {
            let title = args.get(1).map(|s| s.as_str()).unwrap_or("");
            println!(
                "{}",
                emb_agent_core::ext_ops::snippet_draft(&ext_dir, title)
            );
            Ok(())
        }
        "workflow" | "orchestrate" => {
            println!("{}", emb_agent_core::ext_ops::workflow_status(&ext_dir));
            Ok(())
        }
        "insight" => {
            println!("{}", emb_agent_core::ext_ops::insight_show(&ext_dir));
            Ok(())
        }
        "trace" => {
            println!("{}", emb_agent_core::ext_ops::trace_show(&ext_dir));
            Ok(())
        }
        "support" | "adapter" => {
            println!("{}", emb_agent_core::ext_ops::support_status(&ext_dir));
            Ok(())
        }
        "ingest" => match args.get(1).map(String::as_str) {
            Some("doc") => {
                let file = option_value(args, "--file").unwrap_or_default();
                let kind = option_value(args, "--kind").unwrap_or_else(|| "datasheet".to_string());
                println!(
                    "{}",
                    emb_agent_core::ext_ops::ingest_doc(&ext_dir, &file, &kind)
                );
                Ok(())
            }
            _ => Err("ingest: expected doc --file <path>".to_string()),
        },
        _ => Err(format!("unknown ext_ops command: {cmd}")),
    }
}
