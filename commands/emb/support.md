---
name: emb-support
description: Manage chip support sources, discovery, derivation, and reuse status.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-support

## Purpose

- Manage chip support sources, discovery, derivation, and reuse status.
- Prefer surfacing whether support is `reusable`, `reusable-candidate`, or `project-only` before reading trust details.
- Treat shared chip-support sources as a reuse/publish layer, not as the required starting point for normal project work.

## Usage

- Run `$emb-support` when the issue is chip-support maintenance rather than normal project bootstrap.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- Most of this surface is advanced maintenance. The exception is `support bootstrap`, which is part of the known-chip fast path when you want direct control instead of `bootstrap run`.
- Normal users should be able to derive project-local support first and only think about shared sources later.
- `support source add` / `support sync` are primarily for installing or maintaining shared reusable support catalogs.
- When you want an agent / AI to interpret a datasheet and persist the result as a structured draft, initialize a fixed artifact first:
  `support analysis init --chip <name>`
- When a datasheet or schematic needs semantic analysis before support can be derived, let the agent fill a structured analysis artifact first, then run:
  `support derive --from-analysis <path>`
- When you want to snapshot the current draft into a private catalog or private repository worktree, use:
  `support export [<source>] --chip <slug>`
- When a project-local draft reaches `reusable-candidate` and is ready for shared reuse, use:
  `support publish [<source>] --chip <slug>`
- `support analysis init` creates a schema-backed draft file under `.emb-agent/analysis/` so a local agent can keep filling it in safely.
- `--from-analysis` is the right handoff for AI-produced interpretation; final adapter files are still written by the derive/generate engine so the agent does not freely author support files directly.
- If the derived support is only valid for the current project, keep it `project-only`; only move it into a shared adapters repository after review confirms it is reusable across projects.
- `support export` copies the current project's derived family/device/chip files into a private path-based source or explicit output root and rebuilds destination registries without requiring shared-catalog publication evidence.
- `support publish` is the maintainer-side closure step. It copies the current project's derived family/device/chip files into a path-based shared catalog or an explicit output root and rebuilds destination registries.
- By default, `support publish` requires saved entries in `docs/REVIEW-REPORT.md` and `docs/VERIFICATION.md`; use `--force` only when you intentionally override that publication gate.
