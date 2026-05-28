---
name: emb-update
description: Check installed runtime version and update status.
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-update

## Purpose

- Check installed runtime version and update status.
- Surface manual update instructions; emb-agent never auto-updates host files from inside a session.

## Usage

- Run `$emb-update` when this command matches the current problem.
- Use `node .<host>/emb-agent/bin/emb-agent.cjs update` to check npm for the latest published package when running through an installed host wrapper.
- If `update_available=true`, run the manual update from the project root:

```bash
npx emb-agent@latest update --target all --local
```

- Restart the host session after updating OMP/Pi extensions or command files.
- Prefer update over repair when the source package changed; use repair when files are damaged but the installed version is already correct.
