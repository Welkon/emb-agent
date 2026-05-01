---
name: snippet
description: Draft project-local firmware snippet artifacts from tool register write plans.
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# snippet

Create reviewable firmware snippet artifacts from `register_writes.firmware_snippet_request` output.

## Commands

```bash
emb-agent snippet draft --from-tool-output <file> --title <name> --confirm
```

The usual upstream command is:

```bash
emb-agent tool run <name> [options] --save-output
```

Use the returned `saved_output` path as `--from-tool-output`.

Aliases:

```bash
emb-agent snippet draft --from <file> --title <name> --confirm
```

## Behavior

- Reads a saved JSON output from `tool run`.
- Extracts `register_writes.firmware_snippet_request`.
- Inspects local firmware files and git status.
- Writes a draft artifact under `.emb-agent/firmware-snippets/`.
- Does not patch firmware source files.
- Marks source patches blocked when dirty firmware files or behavior couplings exist.

The generated artifact is a review surface. It records direct C statements, HAL-style macro statements when present, source edit policy, behavior couplings, required symbols, constraints, and residual risks. It must not be treated as verified firmware until local compile/static-check or human review evidence exists.

After `--confirm`, the result includes `knowledge graph refresh` and a register-focused `knowledge graph query <register>` in `next_steps`.

## Options

- `--from-tool-output <file>`: JSON file containing `register_writes.firmware_snippet_request`.
- `--from <file>`: Short alias for `--from-tool-output`.
- `--title <name>`: Artifact title and default slug seed.
- `--output <path>`: Override the artifact path.
- `--confirm`: Write the artifact. Without this, the command previews the content.
- `--force`: Overwrite an existing artifact when used with `--confirm`.
