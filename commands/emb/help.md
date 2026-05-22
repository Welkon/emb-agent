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

- Run these as Codex, Claude Code, Cursor, or Pi session commands.
- Open a new session first. emb-agent should inject startup context automatically.
- Use `start` when you need to re-render entry guidance manually.
- If the chip is already known, prefer `declare hardware`, then let `next` or `health` route you into project-local chip support or execution.
- Use `next` for the default continuation once bootstrap and task context are in place.
- Use `help advanced` or `help --all` only when you need the full installed surface.

## PRD Intake

- Before confirming a system PRD, interrogate the user about product behavior, interactions, defaults, failure/power/reset cases, constraints, and acceptance evidence; do not fill PRD from hardware guesses alone.
- Mirror confirmed structured truth into `.emb-agent/req.yaml` and create child execution PRDs under `docs/prd/features|modules|components|subsystems/*.md` before `prd confirm --create-tasks`.
- If `agent_protocol.gate.kind=prd-exploration`, stop before `prd confirm`, `task add`, `task activate`, `scan`, `plan`, or `do`; ask questions, update PRD/req truth, and wait for explicit agreement.

## Task Intake

- If the target files and acceptance check are already explicit, use `task add <summary>` and move into `plan` or `next`.
- If requirements, hardware truth, or the changed surface are still unclear, use `task add <summary>` first and let `scan` converge the task before `plan` or `do`.
- After `task add` or PRD-derived task creation, use the generated PRD/task PRD as the convergence point: ask the user about unclear goal, boundary, constraint, acceptance, and open-question items, update the artifact, and repeat until explicit agreement before `scan`, `plan`, or `do`.
- If the change crosses timing, concurrency, release, or interface boundaries, expect the safer path to be `task add -> scan -> plan -> review -> verify`.
- If the request assumes an unconfirmed technical choice, use `decision review` / `decision record` before implementation.
- Capability shortcuts: `scan`, `plan`, `do`, `debug`, `review`, `verify` — equivalent to `capability run <name>`.

## Public Commands

The public command surface is intentionally small and grouped by default path.

### Start Here

- `$emb-start`
- `$emb-task`
- `$emb-decision`
- `$emb-ingest`
- `$emb-next`

### Execute Current Work

- `$emb-scan`  (`emb-agent scan`)
- `$emb-plan`  (`emb-agent plan`)
- `$emb-do`    (`emb-agent do`)
- `$emb-debug` (`emb-agent debug`)

### Close And Handoff

- `$emb-review`  (`emb-agent review`)
- `$emb-verify`  (`emb-agent verify`)
- `$emb-pause`
- `$emb-resume`

## Notes

- If the chip or pin map is already known, prefer `declare hardware` first.
- Once hardware truth is explicit, prefer `bootstrap run --confirm` for the shortest guided bootstrap path.
- Use `next --brief` when a local wrapper only needs compact JSON with summarized runtime signals.
- Use `external start|next|status|health|dispatch-next` when a host or tool needs the stable external-driver envelope.
- Use `task worktree status|show` before `create` or `cleanup` when you need to inspect isolated task workspace state first.
- Prefer project-local chip support first. Use `support bootstrap` only when you explicitly want source-backed install in one step.
- Shared chip-support sources are optional for ordinary project startup; use them when you need reusable support, not before you can begin.
- If the MCU is not chosen yet, keep `hw.yaml` unknown, record constraints in `req.yaml`, then return to `next`.
- If the truth still lives outside the repo, use `ingest doc` or `ingest schematic` before writing truth directly.
- After `ingest doc`, prefer `adapter analysis init` and then `adapter derive --from-analysis` instead of treating raw documents as final chip support.
- If the chip is known and you only need support for the current project, prefer `adapter derive --from-project` before thinking about shared sources.
- If support is still only valid for the current project, keep it `project-only` first and publish it to a shared adapters catalog only after review.
- When the user confirms real-board behavior (`this build is right`, current draw, wake works/fails), record it with `verify board --result <pass|fail|partial> <summary> --evidence <build/log/measurement> --truth <stable board fact>` instead of leaving it in chat only.

## Advanced Help

- Use `help advanced` or `help --all` to show the full command surface.
- Use `commands list` or `commands list --all` when you explicitly want the installed command inventory.
