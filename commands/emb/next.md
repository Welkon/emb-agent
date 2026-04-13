---
name: emb-next
description: Recommend the most reasonable next step for the current session.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-next

## Purpose

- Recommend the most reasonable next step for the current session.
- Keep command choice small after the initial truth is recorded.

## Usage

- Run `$emb-next` when this command matches the current problem.
- Prefer the lightest command that keeps facts, evidence, and project truth aligned.
- For lower decision overhead in runtime CLI, use `next run` to enter the recommended stage directly.

## What Next Should Do

- If hardware truth is still incomplete, it should keep you on truth-closing work first.
- If pending document apply is waiting, it should route you to apply that staged truth before implementation.
- If bootstrap prerequisites are already closed, it should move you toward:
  `scan`, `plan`, `do`, `debug`, `review`, or `verify`

## When To Use It

- Right after `init`
- Right after `declare hardware`
- Right after applying document-derived truth
- Any time you want emb-agent to choose the smallest reasonable next move

## When To Use Health Instead

- Use `health` first when automatic startup seems inactive or bootstrap remains stuck before execution stages.
