pub fn json_quote(value: &str) -> String {
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for ch in value.chars() {
        match ch {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            ch if ch.is_control() => output.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => output.push(ch),
        }
    }
    output.push('"');
    output
}

pub fn json_string_field(source: &str, key: &str) -> String {
    let pattern = format!("\"{key}\"");
    let Some(start) = source.find(&pattern) else {
        return String::new();
    };
    let rest = &source[start + pattern.len()..];
    let Some(colon) = rest.find(':') else {
        return String::new();
    };
    let mut chars = rest[colon + 1..].chars().skip_while(|c| c.is_whitespace());
    if chars.next() != Some('"') {
        return String::new();
    }

    let mut output = String::new();
    let mut escape = false;
    for ch in chars {
        if escape {
            output.push(match ch {
                'n' => '\n',
                'r' => '\r',
                't' => '\t',
                '"' => '"',
                '\\' => '\\',
                other => other,
            });
            escape = false;
            continue;
        }
        if ch == '\\' {
            escape = true;
            continue;
        }
        if ch == '"' {
            break;
        }
        output.push(ch);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_quote_escapes_control_chars() {
        assert_eq!(json_quote("a\"b\\c\n"), "\"a\\\"b\\\\c\\n\"");
    }

    #[test]
    fn json_string_field_reads_simple_values() {
        assert_eq!(json_string_field(r#"{"name":"Felix"}"#, "name"), "Felix");
        assert_eq!(json_string_field(r#"{"name":"a\nb"}"#, "name"), "a\nb");
    }
}
