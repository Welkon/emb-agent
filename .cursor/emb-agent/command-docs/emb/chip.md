# chip

Compare and swap MCU chips with pin-level compatibility analysis.

## Usage

```bash
emb-agent chip diff --from <old-chip> --to <new-chip>
emb-agent chip swap --from <old-chip> --to <new-chip> [--confirm]
```

## Subcommands

### diff

Compare two chip profiles pin-by-pin, including capability and tool differences.

```
emb-agent chip diff --from PMS150G --to PMS150C
```

Output:
- Pin compatibility matrix (identical/compatible/partial/incompatible/new/removed)
- Added/removed/shared capabilities
- Added/removed/shared tools
- Migration risk assessment
- Recommendations

### swap

Generate a full migration plan including signal remapping and code change checklist.

```
emb-agent chip swap --from PMS150G --to PMS150C
```

Output:
- Full chip diff
- Signal migration table (direct/remapped/lost/new)
- Required code changes
- Verification checklist
- Decision record path

With `--confirm`: writes the migration plan to `.emb-agent/wiki/decisions/chip-swap-<from>-to-<to>.md` and creates a migration task.

## Prerequisites

- Both chip profiles must exist in `.emb-agent/extensions/chips/profiles/<name>.json`
- Hardware identity must be declared in `.emb-agent/hw.yaml` (for swap)
- `emb-agent-rs` binary must be available (built from source or installed)
