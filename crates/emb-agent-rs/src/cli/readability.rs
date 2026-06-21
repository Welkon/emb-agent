// Readability lint for embedded firmware code
// Flags: call depth >3, forwarding wrappers, misleading names

use std::fs;
use std::path::Path;

pub fn run(args: &[String]) -> Result<(), String> {
    let cwd = args
        .iter()
        .position(|a| a == "--cwd")
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
        .unwrap_or(".");

    let src_dir = Path::new(cwd).join("src");
    if !src_dir.exists() {
        return Err("No src/ directory found. Run from project root.".to_string());
    }

    println!("Readability lint report:\n");

    let mut issues = Vec::new();

    // Scan C files
    if let Ok(entries) = fs::read_dir(&src_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "c" || e == "h") {
                issues.extend(lint_file(&path));
            }
        }
    }

    if issues.is_empty() {
        println!("✓ No readability issues found.\n");
        return Ok(());
    }

    // Group by type
    let mut forwarding = Vec::new();
    let mut misleading = Vec::new();
    let mut deep_nesting = Vec::new();

    for issue in &issues {
        match issue.issue_type.as_str() {
            "forwarding" => forwarding.push(issue),
            "misleading" => misleading.push(issue),
            "deep_nesting" => deep_nesting.push(issue),
            _ => {}
        }
    }

    if !forwarding.is_empty() {
        println!("⚠ Forwarding wrappers (only call one function, ≤2 lines):");
        for issue in &forwarding {
            println!("  {}:{} — {}", issue.file, issue.line, issue.description);
        }
        println!();
    }

    if !misleading.is_empty() {
        println!("⚠ Potentially misleading names:");
        for issue in &misleading {
            println!("  {}:{} — {}", issue.file, issue.line, issue.description);
        }
        println!();
    }

    if !deep_nesting.is_empty() {
        println!("⚠ Deep nesting (>4 levels):");
        for issue in &deep_nesting {
            println!("  {}:{} — {}", issue.file, issue.line, issue.description);
        }
        println!();
    }

    println!("Total: {} issues", issues.len());
    Ok(())
}

struct ReadabilityIssue {
    file: String,
    line: usize,
    issue_type: String,
    description: String,
}

fn lint_file(path: &Path) -> Vec<ReadabilityIssue> {
    let mut issues = Vec::new();

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return issues,
    };

    let filename = path.file_name().unwrap().to_string_lossy().to_string();
    let lines: Vec<&str> = content.lines().collect();

    // Detect forwarding wrappers: function body ≤2 lines with single call
    let mut in_function = false;
    let mut func_start = 0;
    let mut func_name = String::new();
    let mut brace_depth = 0;
    let mut func_lines: Vec<&str> = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Skip comments and empty lines
        if trimmed.starts_with("//") || trimmed.is_empty() {
            continue;
        }

        // Function start detection (heuristic: type name(params) {)
        if !in_function
            && trimmed.contains('(')
            && trimmed.contains(')')
            && trimmed.contains('{')
            && !trimmed.starts_with("if")
            && !trimmed.starts_with("while")
            && !trimmed.starts_with("for")
        {
            in_function = true;
            func_start = i + 1;
            brace_depth = 1;
            func_lines.clear();
            // Extract function name
            if let Some(paren_pos) = trimmed.find('(') {
                let before_paren = &trimmed[..paren_pos];
                func_name = before_paren.split_whitespace().last().unwrap_or("").to_string();
            }
            continue;
        }

        if in_function {
            if trimmed.contains('{') {
                brace_depth += trimmed.matches('{').count();
            }
            if trimmed.contains('}') {
                brace_depth -= trimmed.matches('}').count();
            }

            if brace_depth == 0 {
                // Function ended
                in_function = false;

                // Check if it's a forwarding wrapper
                let non_empty: Vec<&&str> = func_lines.iter().filter(|l| !l.trim().is_empty() && !l.trim().starts_with("//")).collect();

                if non_empty.len() <= 2 {
                    // Check if it contains a single function call
                    let body: String = non_empty.iter().map(|s| **s).collect::<Vec<&str>>().join(" ");
                    if body.contains('(') && body.contains(')') && body.contains(';') {
                        issues.push(ReadabilityIssue {
                            file: filename.clone(),
                            line: func_start,
                            issue_type: "forwarding".to_string(),
                            description: format!(
                                "Function '{}' is ≤2 lines and only forwards to another call",
                                func_name
                            ),
                        });
                    }
                }
            } else {
                func_lines.push(trimmed);
            }
        }

        // Check for deep nesting (>4 levels of indentation in C code)
        let indent = line.len() - line.trim_start().len();
        if indent > 16 && !trimmed.is_empty() && !trimmed.starts_with("//") {
            // Likely >4 indentation levels (assuming 4-space indent)
            issues.push(ReadabilityIssue {
                file: filename.clone(),
                line: i + 1,
                issue_type: "deep_nesting".to_string(),
                description: "Deep nesting detected (>4 levels)".to_string(),
            });
        }
    }

    // Detect misleading names (heuristic: app_service, service_wrapper, etc.)
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if (trimmed.contains("void app_service") || trimmed.contains("void service_wrapper"))
            && trimmed.contains('(')
        {
            issues.push(ReadabilityIssue {
                file: filename.clone(),
                line: i + 1,
                issue_type: "misleading".to_string(),
                description: "Name suggests abstraction but may only forward (review actual behavior)".to_string(),
            });
        }
    }

    issues
}
