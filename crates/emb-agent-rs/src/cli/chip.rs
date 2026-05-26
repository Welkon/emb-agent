use super::util::{current_dir_string, option_value};
use emb_agent_core::{build_chip_diff_json, build_chip_swap_confirm_json, build_chip_swap_json};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let ext_dir = Path::new(&cwd).join(".emb-agent");
    match args.get(1).map(String::as_str) {
        Some("diff") => {
            let from = option_value(args, "--from").ok_or("missing --from")?;
            let to = option_value(args, "--to").ok_or("missing --to")?;
            println!("{}", build_chip_diff_json(&ext_dir, &from, &to));
            Ok(())
        }
        Some("swap") => {
            let from = option_value(args, "--from").ok_or("missing --from")?;
            let to = option_value(args, "--to").ok_or("missing --to")?;
            let hw_path = ext_dir.join("hw.yaml");
            let hw_yaml = std::fs::read_to_string(&hw_path).unwrap_or_default();
            if args.iter().any(|a| a == "--confirm") {
                println!(
                    "{}",
                    build_chip_swap_confirm_json(&ext_dir, &hw_yaml, &from, &to)
                );
            } else {
                println!("{}", build_chip_swap_json(&ext_dir, &hw_yaml, &from, &to));
            }
            Ok(())
        }
        _ => Err("chip: expected diff or swap".to_string()),
    }
}
