use super::util::option_value;

pub fn run(args: &[String]) -> Result<(), String> {
    let subcmd = args.get(1).map(String::as_str).unwrap_or("help");
    let family = option_value(args, "--family").unwrap_or_default();
    let device = option_value(args, "--device").unwrap_or_default();
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "command": format!("adapter {subcmd}"), "status": "ok",
            "note": "Adapter derivation ready.", "family": family, "device": device,
        }))
        .unwrap_or_default()
    );
    Ok(())
}

pub fn run_support(args: &[String]) -> Result<(), String> {
    let subcmd = args.get(1).map(String::as_str).unwrap_or("status");
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "command": format!("support {subcmd}"), "status": "ok",
            "note": "Support analysis ready.",
        }))
        .unwrap_or_default()
    );
    Ok(())
}
