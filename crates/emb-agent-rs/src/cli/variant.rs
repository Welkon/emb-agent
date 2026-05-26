use super::util::{current_dir_string, option_value};
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = option_value(args, "--cwd").unwrap_or_else(current_dir_string);
    let ext_dir = Path::new(&cwd).join(".emb-agent");
    match args.get(1).map(String::as_str) {
        Some("list") => {
            println!("{}", emb_agent_core::variant_ops::variant_list(&ext_dir));
            Ok(())
        }
        Some("status") => {
            println!("{}", emb_agent_core::variant_ops::variant_status(&ext_dir));
            Ok(())
        }
        Some("use") => {
            let name = args.get(2).ok_or("variant use requires <name>")?;
            println!(
                "{}",
                emb_agent_core::variant_ops::variant_use(&ext_dir, name)
            );
            Ok(())
        }
        Some("adopt") => {
            let name = args.get(2).ok_or("variant adopt requires <name>")?;
            let src = option_value(args, "--src").unwrap_or_else(|| format!("firmware/{name}"));
            println!(
                "{}",
                emb_agent_core::variant_ops::variant_adopt(
                    &ext_dir,
                    name,
                    &src,
                    args.iter().any(|a| a == "--clean-root")
                )
            );
            Ok(())
        }
        Some("create") => {
            let name = args.get(2).ok_or("variant create requires <name>")?;
            let mcu = option_value(args, "--mcu").unwrap_or_default();
            let package = option_value(args, "--package").unwrap_or_default();
            let src = option_value(args, "--src").unwrap_or_else(|| format!("firmware/{name}"));
            println!(
                "{}",
                emb_agent_core::variant_ops::variant_create(&ext_dir, name, &mcu, &package, &src)
            );
            Ok(())
        }
        Some("fork") => {
            let from = args.get(2).ok_or("variant fork requires <from> <to>")?;
            let to = args.get(3).ok_or("variant fork requires <from> <to>")?;
            println!(
                "{}",
                emb_agent_core::variant_ops::variant_fork(
                    &ext_dir,
                    from,
                    to,
                    &option_value(args, "--mcu").unwrap_or_default(),
                    &option_value(args, "--package").unwrap_or_default(),
                    &option_value(args, "--src").unwrap_or_default()
                )
            );
            Ok(())
        }
        Some("diff") => {
            let a = args.get(2).ok_or("variant diff requires <a> <b>")?;
            let b = args.get(3).ok_or("variant diff requires <a> <b>")?;
            println!(
                "{}",
                emb_agent_core::variant_ops::variant_diff(&ext_dir, a, b)
            );
            Ok(())
        }
        _ => Err("variant: expected list, status, adopt, create, use, fork, or diff".to_string()),
    }
}
