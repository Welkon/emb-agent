use crate::schematic::{
    ParsedSchematic, SchematicAdvice, SchematicAdviceFinding, SchematicAdviceSummary,
};
use std::collections::{HashMap, HashSet};

fn guess_component_role(designator: &str, text: &str) -> &'static str {
    let des = designator.to_uppercase();
    let t = text.to_lowercase();

    if des.starts_with('R') && des[1..].chars().all(|c| c.is_ascii_digit()) {
        return "resistor";
    }
    if t.contains("resistor") || t.contains("ohm") {
        return "resistor";
    }

    if des.starts_with('C') && des[1..].chars().all(|c| c.is_ascii_digit()) {
        return "capacitor";
    }
    if t.contains("capacitor") || t == "cap" || t.contains("cap ") {
        return "capacitor";
    }

    if (des.starts_with('D') && des[1..].chars().all(|c| c.is_ascii_digit()))
        || des.starts_with("LED")
    {
        return "led";
    }
    if t.contains("led") {
        return "led";
    }

    if des.starts_with("SW")
        || (des.starts_with('S') && des[1..].chars().all(|c| c.is_ascii_digit()))
        || des.starts_with("KEY")
    {
        return "switch";
    }
    if t.contains("switch") || t.contains("button") || t.contains("key") || t.contains("tact") {
        return "switch";
    }

    if des.starts_with('Q') && des[1..].chars().all(|c| c.is_ascii_digit()) {
        return "transistor";
    }
    if t.contains("npn") || t.contains("pnp") || t.contains("mosfet") || t.contains("transistor") {
        return "transistor";
    }

    if des.starts_with('J')
        || des.starts_with('P')
        || des.starts_with("CN")
        || des.starts_with("USB")
    {
        return "connector";
    }
    if t.contains("connector")
        || t.contains("usb")
        || t.contains("header")
        || t.contains("testpoint")
        || t.contains("test point")
    {
        return "connector";
    }

    if (des.starts_with('U') && des[1..].chars().all(|c| c.is_ascii_digit()))
        || des.starts_with("IC")
    {
        return "ic";
    }

    ""
}

fn is_likely_mcu_or_ic(designator: &str, text: &str, pin_count: usize) -> bool {
    let role = guess_component_role(designator, text);
    let t = text.to_lowercase();
    role == "ic"
        || pin_count >= 6
        || t.contains("mcu")
        || t.contains("microcontroller")
        || t.contains("soc")
}

fn is_power_net(name: &str) -> bool {
    let n = name.trim().to_lowercase();
    matches!(
        n.as_str(),
        "gnd"
            | "ground"
            | "agnd"
            | "dgnd"
            | "vss"
            | "vdd"
            | "vcc"
            | "vin"
            | "vbat"
            | "bat+"
            | "b+"
            | "b-"
            | "3v3"
            | "3.3v"
            | "5v"
            | "12v"
            | "24v"
    ) || (n.ends_with('v') && n.len() <= 6)
}

fn is_unnamed_net(name: &str) -> bool {
    name.to_uppercase().starts_with("UNNAMED_NET_")
}

fn member_designator(member: &str) -> String {
    member
        .split(['.', '-', ':'])
        .next()
        .unwrap_or(member)
        .to_string()
}

fn normalize_designator(value: &str) -> String {
    value.trim().to_uppercase()
}

fn component_text(c: &crate::schematic::SchematicComponent) -> String {
    format!(
        "{} {} {} {} {} {}",
        c.designator, c.value, c.comment, c.libref, c.footprint, c.package
    )
}

struct SchematicIndexes {
    by_designator: HashMap<String, crate::schematic::SchematicComponent>,
    net_by_name: HashMap<String, crate::schematic::SchematicNet>,
    components: Vec<crate::schematic::SchematicComponent>,
    nets: Vec<crate::schematic::SchematicNet>,
}

fn build_indexes(parsed: &ParsedSchematic) -> SchematicIndexes {
    let mut by_designator = HashMap::new();
    for c in &parsed.components {
        let key = normalize_designator(&c.designator);
        if !key.is_empty() {
            by_designator.insert(key, c.clone());
        }
    }

    let mut net_by_name = HashMap::new();
    for net in &parsed.nets {
        let name = net.name.trim().to_string();
        if !name.is_empty() {
            net_by_name.insert(name, net.clone());
        }
    }

    SchematicIndexes {
        by_designator,
        net_by_name,
        components: parsed.components.clone(),
        nets: parsed.nets.clone(),
    }
}

fn component_for_member<'a>(
    member: &str,
    indexes: &'a SchematicIndexes,
) -> Option<&'a crate::schematic::SchematicComponent> {
    let des = normalize_designator(&member_designator(member));
    indexes.by_designator.get(&des)
}

fn role_members(
    net: &crate::schematic::SchematicNet,
    role: &str,
    indexes: &SchematicIndexes,
) -> Vec<String> {
    net.members
        .iter()
        .filter(|m| {
            component_for_member(m, indexes)
                .map(|c| guess_component_role(&c.designator, &component_text(c)) == role)
                .unwrap_or(false)
        })
        .cloned()
        .collect()
}

fn net_has_role(
    net: &crate::schematic::SchematicNet,
    role: &str,
    indexes: &SchematicIndexes,
) -> bool {
    !role_members(net, role, indexes).is_empty()
}

fn collect_component_nets(
    component: &crate::schematic::SchematicComponent,
    indexes: &SchematicIndexes,
) -> Vec<crate::schematic::SchematicNet> {
    let mut result = Vec::new();
    for pin in &component.pins {
        let net_name = pin.net.trim();
        if net_name.is_empty() {
            continue;
        }
        if let Some(net) = indexes.net_by_name.get(net_name) {
            result.push(net.clone());
        }
    }
    result
}

fn make_finding_id(category: &str, parts: &[&str]) -> String {
    let all: Vec<String> = std::iter::once(category.to_string())
        .chain(
            parts
                .iter()
                .map(|s| {
                    s.to_lowercase()
                        .replace(|c: char| !c.is_ascii_alphanumeric(), "-")
                        .trim_matches('-')
                        .to_string()
                })
                .filter(|s| !s.is_empty()),
        )
        .collect();
    all.join("-")
}

struct FindingMeta<'a> {
    category: &'a str,
    severity: &'a str,
    confidence: &'a str,
    summary: &'a str,
}

struct FindingEvidence<'a> {
    net: &'a str,
    component: &'a str,
    pin: &'a str,
    members: &'a [String],
}

macro_rules! finding {
    ($category:expr, $severity:expr, $confidence:expr, $summary:expr, $net:expr, $component:expr, $pin:expr, $members:expr, $checks:expr $(,)?) => {
        build_finding(
            FindingMeta {
                category: $category,
                severity: $severity,
                confidence: $confidence,
                summary: $summary,
            },
            FindingEvidence {
                net: $net,
                component: $component,
                pin: $pin,
                members: $members,
            },
            $checks,
        )
    };
}

fn build_finding(
    meta: FindingMeta<'_>,
    evidence: FindingEvidence<'_>,
    checks: Vec<&str>,
) -> SchematicAdviceFinding {
    let id = make_finding_id(
        meta.category,
        &[evidence.net, evidence.component, evidence.pin],
    );
    let reminder_policy = if meta.severity == "warning" || meta.severity == "error" {
        "repeat-on-next-and-related-debug"
    } else {
        "repeat-on-related-debug"
    };
    SchematicAdviceFinding {
        id,
        severity: meta.severity.to_string(),
        category: meta.category.to_string(),
        confidence: meta.confidence.to_string(),
        summary: meta.summary.to_string(),
        evidence: serde_json::json!({
            "net": evidence.net,
            "component": evidence.component,
            "pin": evidence.pin,
            "members": evidence.members
        }),
        recommended_checks: checks.iter().map(|s| s.to_string()).collect(),
        status: "open".to_string(),
        dismissible: true,
        blocking: false,
        reminder_policy: reminder_policy.to_string(),
        note: "Advisory only; confirm against datasheets, firmware defaults, BOM values, and board requirements before changing hardware truth.".to_string(),
    }
}

fn add_dangling_net_findings(
    findings: &mut Vec<SchematicAdviceFinding>,
    indexes: &SchematicIndexes,
) {
    for net in &indexes.nets {
        if net.members.len() > 1 || is_power_net(&net.name) {
            continue;
        }
        let name = net.name.trim();
        let label = if name.is_empty() { "(unnamed)" } else { name };
        findings.push(finding!(
            "dangling-net",
            "info",
            "medium",
            &format!("Net {label} has one or fewer connected members."),
            name,
            "",
            "",
            &net.members,
            vec![
                "Confirm this is an intentional test point, no-connect, or single-ended label.",
                "If it should connect elsewhere, inspect the schematic preview and source record evidence.",
            ],
        ));
    }
}

fn has_external_bias_candidate(
    net: &crate::schematic::SchematicNet,
    indexes: &SchematicIndexes,
) -> bool {
    net_has_role(net, "resistor", indexes) || is_power_net(&net.name)
}

fn is_switch_to_ground(net: &crate::schematic::SchematicNet, indexes: &SchematicIndexes) -> bool {
    if !net_has_role(net, "switch", indexes) {
        return false;
    }
    net.members.iter().any(|m| {
        if let Some(c) = component_for_member(m, indexes)
            && guess_component_role(&c.designator, &component_text(c)) == "switch"
        {
            return collect_component_nets(c, indexes).iter().any(|cn| {
                let n = cn.name.to_lowercase();
                n.starts_with("gnd") || n == "vss"
            });
        }
        false
    })
}

fn add_floating_input_findings(
    findings: &mut Vec<SchematicAdviceFinding>,
    indexes: &SchematicIndexes,
) {
    for net in &indexes.nets {
        let name = net.name.trim();
        if name.is_empty() || is_power_net(name) {
            continue;
        }

        let signal_keywords = [
            "key", "button", "sw", "rst", "reset", "boot", "en", "wake", "irq", "int", "rx",
            "input", "pir", "sensor", "sense", "detect",
        ];
        let name_lower = name.to_lowercase();
        let signal_like = signal_keywords.iter().any(|kw| name_lower.contains(kw));

        let has_switch = net_has_role(net, "switch", indexes);
        let has_ic = net.members.iter().any(|m| {
            if let Some(c) = component_for_member(m, indexes) {
                let text = component_text(c);
                is_likely_mcu_or_ic(&c.designator, &text, c.pins.len())
            } else {
                let d = member_designator(m).to_uppercase();
                d.starts_with("MCU")
                    || d.starts_with("CPU")
                    || d.starts_with('U')
                    || d.starts_with("IC")
            }
        });

        if !(signal_like || has_switch) || !has_ic || has_external_bias_candidate(net, indexes) {
            continue;
        }

        let (severity, summary, checks): (&str, String, Vec<&str>) = if is_switch_to_ground(
            net, indexes,
        ) || name_lower
            .contains("key")
            || name_lower.contains("button")
            || name_lower.contains("sw")
        {
            (
                "info",
                format!(
                    "Signal {name} is a switch/input net without an external bias resistor; default to MCU weak pull-up when board cost is prioritized."
                ),
                vec![
                    "Confirm firmware enables the internal weak pull-up before sampling the input.",
                    "Check reset, boot, sleep, and wake-up behavior because internal pull-ups may be disabled during some states.",
                    "Use an external bias resistor only if leakage, EMI/noise margin, long wiring, or deterministic pre-firmware state requires it.",
                ],
            )
        } else {
            (
                "warning",
                format!(
                    "Signal {name} reaches an IC/MCU input-like net but no external pull-up or pull-down candidate was detected."
                ),
                vec![
                    "Confirm whether the MCU pin has an internal pull-up/down and when firmware enables it.",
                    "Check reset, sleep, and boot-time behavior before relying only on firmware bias.",
                    "Add or verify an external bias resistor if the input must be deterministic without firmware.",
                ],
            )
        };

        findings.push(finding!(
            "gpio-bias",
            severity,
            "medium",
            &summary,
            name,
            "",
            "",
            &net.members,
            checks,
        ));
    }
}

fn add_led_current_limit_findings(
    findings: &mut Vec<SchematicAdviceFinding>,
    indexes: &SchematicIndexes,
) {
    for component in &indexes.components {
        if guess_component_role(&component.designator, &component_text(component)) != "led" {
            continue;
        }
        let nets = collect_component_nets(component, indexes);
        let has_resistor = nets
            .iter()
            .any(|net| net_has_role(net, "resistor", indexes));
        if has_resistor {
            continue;
        }
        let net_names: Vec<String> = nets
            .iter()
            .map(|n| n.name.clone())
            .filter(|n| !n.is_empty())
            .collect();
        findings.push(finding!(
            "led-current-limit",
            "warning",
            "medium",
            &format!(
                "LED-like component {} has no resistor candidate on its directly connected nets.",
                component.designator
            ),
            "",
            &component.designator,
            "",
            &net_names,
            vec![
                "Confirm the LED current path includes a resistor or current-regulated driver.",
                "Verify LED current against GPIO or driver current limits.",
            ],
        ));
    }
}

fn add_transistor_drive_findings(
    findings: &mut Vec<SchematicAdviceFinding>,
    indexes: &SchematicIndexes,
) {
    for component in &indexes.components {
        if guess_component_role(&component.designator, &component_text(component)) != "transistor" {
            continue;
        }
        for pin in &component.pins {
            let pin_name = pin.name.trim();
            let pin_num = pin.number.trim();
            if pin_name != "b"
                && pin_name != "base"
                && pin_name != "g"
                && pin_name != "gate"
                && pin_num != "b"
                && pin_num != "base"
                && pin_num != "g"
                && pin_num != "gate"
            {
                continue;
            }
            let net_name = pin.net.trim();
            if net_name.is_empty() {
                continue;
            }
            if let Some(net) = indexes.net_by_name.get(net_name) {
                if net_has_role(net, "resistor", indexes) {
                    continue;
                }
                let has_ic_driver = net.members.iter().any(|m| {
                    if let Some(other) = component_for_member(m, indexes) {
                        other.designator != component.designator
                            && is_likely_mcu_or_ic(
                                &other.designator,
                                &component_text(other),
                                other.pins.len(),
                            )
                    } else {
                        false
                    }
                });
                if !has_ic_driver {
                    continue;
                }
                findings.push(finding!(
                    "transistor-drive",
                    "warning",
                    "medium",
                    &format!(
                        "Transistor {} {} drive net has no resistor candidate.",
                        component.designator, pin.name
                    ),
                    net_name,
                    &component.designator,
                    &pin.name,
                    &net.members,
                    vec![
                        "For BJTs, verify the base resistor value and MCU source/sink current.",
                        "For MOSFETs, verify gate resistor or damping needs and boot/reset default state.",
                    ],
                ));
            }
        }
    }
}

fn add_decoupling_findings(findings: &mut Vec<SchematicAdviceFinding>, indexes: &SchematicIndexes) {
    for component in &indexes.components {
        let text = component_text(component);
        if !is_likely_mcu_or_ic(&component.designator, &text, component.pins.len()) {
            continue;
        }
        let nets = collect_component_nets(component, indexes);
        let has_power = nets.iter().any(|net| {
            let n = net.name.to_lowercase();
            is_power_net(&net.name) && n != "gnd" && n != "ground" && n != "vss"
        });
        let has_ground = nets.iter().any(|net| {
            let n = net.name.to_lowercase();
            n == "gnd" || n == "ground" || n == "agnd" || n == "dgnd" || n == "vss"
        });
        if !has_power || !has_ground {
            continue;
        }
        let has_cap = nets
            .iter()
            .any(|net| net_has_role(net, "capacitor", indexes));
        if has_cap {
            continue;
        }
        let net_names: Vec<String> = nets
            .iter()
            .map(|n| n.name.clone())
            .filter(|n| !n.is_empty())
            .collect();
        findings.push(finding!(
            "power-decoupling",
            "info",
            "low",
            &format!(
                "IC-like component {} has power and ground nets but no local decoupling capacitor candidate was detected on those nets.",
                component.designator
            ),
            "",
            &component.designator,
            "",
            &net_names,
            vec![
                "Confirm the schematic has local decoupling near each IC power pin.",
                "Verify capacitor value, voltage rating, placement, and datasheet recommendations.",
            ],
        ));
    }
}

fn add_unnamed_critical_net_findings(
    findings: &mut Vec<SchematicAdviceFinding>,
    indexes: &SchematicIndexes,
) {
    for net in &indexes.nets {
        if !is_unnamed_net(&net.name) {
            continue;
        }
        let has_ic = net.members.iter().any(|m| {
            if let Some(c) = component_for_member(m, indexes) {
                let text = component_text(c);
                is_likely_mcu_or_ic(&c.designator, &text, c.pins.len())
            } else {
                false
            }
        });
        if !has_ic {
            continue;
        }
        findings.push(finding!(
            "unnamed-critical-net",
            "info",
            "medium",
            &format!(
                "Unnamed net {} touches an IC-like component.",
                net.name
            ),
            &net.name,
            "",
            "",
            &net.members,
            vec![
                "Name this net if it carries a meaningful signal, boot strap, reset, power control, or debug function.",
                "Keep the unnamed net only if it is genuinely local and unambiguous.",
            ],
        ));
    }
}

fn summarize_findings(findings: &[SchematicAdviceFinding]) -> SchematicAdviceSummary {
    let mut errors = 0usize;
    let mut warnings = 0usize;
    let mut info = 0usize;
    let mut categories: HashMap<String, usize> = HashMap::new();

    for f in findings {
        match f.severity.as_str() {
            "error" => errors += 1,
            "warning" => warnings += 1,
            _ => info += 1,
        }
        *categories.entry(f.category.clone()).or_default() += 1;
    }

    SchematicAdviceSummary {
        findings: findings.len(),
        errors,
        warnings,
        info,
        categories: serde_json::to_value(categories).unwrap_or_default(),
    }
}

/// Port of schematic-advisor.cjs: analyze_schematic_advice
pub fn analyze_schematic_advice(parsed: &ParsedSchematic) -> SchematicAdvice {
    let indexes = build_indexes(parsed);
    let mut findings = Vec::new();

    add_dangling_net_findings(&mut findings, &indexes);
    add_floating_input_findings(&mut findings, &indexes);
    add_led_current_limit_findings(&mut findings, &indexes);
    add_transistor_drive_findings(&mut findings, &indexes);
    add_decoupling_findings(&mut findings, &indexes);
    add_unnamed_critical_net_findings(&mut findings, &indexes);

    // Deduplicate by id
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for f in findings {
        let id = f.id.clone();
        if seen.insert(id) {
            deduped.push(f);
        }
    }

    let summary = summarize_findings(&deduped);

    SchematicAdvice {
        summary: Some(summary),
        findings: deduped,
    }
}
