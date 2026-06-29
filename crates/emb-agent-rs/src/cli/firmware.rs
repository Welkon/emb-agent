use super::util::{current_dir_string, option_value};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print_help();
        return Ok(());
    }
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let project_root = Path::new(&cwd);
    match args.get(1).map(String::as_str) {
        Some("resource") => match args.get(2).map(String::as_str) {
            Some("analyze") => {
                let report = option_value(args, "--file")
                    .or_else(|| option_value(args, "--report"))
                    .or_else(|| args.get(3).filter(|arg| !arg.starts_with("--")).cloned())
                    .ok_or("firmware resource analyze requires --file <report>")?;
                println!(
                    "{}",
                    emb_agent_core::firmware_resource_analyze(project_root, Path::new(&report))
                );
                Ok(())
            }
            _ => Err("firmware resource: expected analyze".to_string()),
        },
        Some("evidence") => match args.get(2).map(String::as_str) {
            Some("add") => {
                let kind = option_value(args, "--kind").unwrap_or_else(|| "board".to_string());
                let result =
                    option_value(args, "--result").unwrap_or_else(|| "UNTESTED".to_string());
                let evidence_path = option_value(args, "--path")
                    .or_else(|| option_value(args, "--evidence"))
                    .unwrap_or_default();
                let expected = option_value(args, "--expected").unwrap_or_default();
                let measured = option_value(args, "--measured").unwrap_or_default();
                let notes = option_value(args, "--notes")
                    .or_else(|| option_value(args, "--note"))
                    .unwrap_or_default();
                println!(
                    "{}",
                    emb_agent_core::firmware_evidence_add(
                        project_root,
                        &kind,
                        &result,
                        &evidence_path,
                        &expected,
                        &measured,
                        &notes
                    )
                );
                Ok(())
            }
            _ => Err("firmware evidence: expected add".to_string()),
        },
        Some("release") => match args.get(2).map(String::as_str) {
            Some("draft") => {
                let version =
                    option_value(args, "--version").unwrap_or_else(|| "draft".to_string());
                println!(
                    "{}",
                    emb_agent_core::firmware_release_draft(project_root, &version)
                );
                Ok(())
            }
            _ => Err("firmware release: expected draft".to_string()),
        },
        _ => Err("firmware: expected resource, evidence, or release".to_string()),
    }
}

fn print_help() {
    println!(
        "{}",
        [
            "firmware internal evidence commands:",
            "  firmware resource analyze --file <build-report-or-map>",
            "  firmware evidence add --kind <pwm|adc|sleep|wake|current|board> --result <PASS|FAIL|WARN|UNTESTED> [--expected X] [--measured Y] [--path evidence.csv] [--notes text]",
            "  firmware release draft --version <version>",
        ]
        .join("\n")
    );
}
