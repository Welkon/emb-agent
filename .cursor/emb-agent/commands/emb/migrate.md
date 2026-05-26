---
name: emb-migrate
description: Guided chip migration workflow — compare chips, create migration plan, and prepare task.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-migrate

- Use `$emb-migrate` when the user wants to migrate firmware from one MCU chip to another.
- Run without arguments to see usage and required flags.
- Run `emb-agent migrate --from <old-chip> --to <new-chip>` to start the migration workflow.
- The command checks if chip profiles exist in `.emb-agent/extensions/chips/profiles/`.
- If the target chip profile is missing, it suggests `ingest doc` with matching datasheet PDFs found in `docs/`.
- Once both profiles exist, `--confirm` runs `chip diff` + `chip swap` and generates a migration plan.
- After the plan is generated, use `task` and `next` to proceed with implementation.
- Use `migrate --from <old> --to <new> --confirm` to auto-create the full migration plan in one step.
