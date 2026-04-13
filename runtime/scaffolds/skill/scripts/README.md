# Scripts

- `scripts/smoke-test.sh` is the structural forgetting check. Run it after migration, after editing `SKILL.md` or shell files, after template upgrades, and before declaring the skill complete.
- `scripts/test-trigger.sh` is a static trigger preflight. It checks whether the skill description and trigger phrases plausibly cover the task shapes declared in `Common Tasks`.
- Both scripts treat `SKILL.md` as the source of truth and infer related files from it. Do not maintain a second checklist by hand.
- Reuse repository-native scripts first. Add more wrappers here only when they carry real workflow value.
- These scripts exist because humans are bad at self-auditing repetitive structure. Let the script catch omissions instead of trusting memory.

<!-- FILL: add project-specific helper scripts only when this skill has repeatable extraction, validation, migration, or report-generation work -->
