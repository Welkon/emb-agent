---
name: emb-help
description: Show the emb-agent command flow, starting from the shortest onboarding path.
allowed-tools:
  - Read
  - Bash
  - SlashCommand
---

# emb-help

Output the emb-agent help summary below and nothing else.

## Fast Path

- Run these as Codex, Claude Code, or Cursor session commands.
- Use `start` first. It is the single repository entrypoint.
- Use `next` for the default continuation once bootstrap and task context are in place.
- Use `help advanced` or `help --all` only when you need the full installed surface.

## Public Commands

The public command surface is intentionally small and grouped by default path.

### Start Here

- `$emb-start`
- `$emb-task`
- `$emb-ingest`
- `$emb-next`

### Execute Current Work

- `$emb-scan`
- `$emb-plan`
- `$emb-do`
- `$emb-debug`

### Close And Handoff

- `$emb-review`
- `$emb-verify`
- `$emb-pause`
- `$emb-resume`

## Notes

- If the chip or pin map is already known, prefer `declare hardware` first.
- If the MCU is not chosen yet, keep `hw.yaml` unknown, record constraints in `req.yaml`, then return to `next`.
- If the truth still lives outside the repo, use `ingest doc` or `ingest schematic` before writing truth directly.

## Advanced Help

- Use `help advanced` or `help --all` to show the full command surface.
- Use `commands list` or `commands list --all` when you explicitly want the installed command inventory.
