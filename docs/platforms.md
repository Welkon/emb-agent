# Platforms

This page only covers platform-specific setup differences. The canonical onboarding path is in [quick-start.md](./quick-start.md).

## Supported runtimes

| Runtime | Install | Runtime dir | Command surface | Extra manual step |
| --- | --- | --- | --- | --- |
| Codex | `npx emb-agent` | `./.codex/` | project skills under `./.codex/skills/` | none |
| Claude Code | `npx emb-agent` | `./.claude/` | slash commands under `./.claude/commands/emb/` | none |
| Cursor | `npx emb-agent` | `./.cursor/` | command wrappers under `./.cursor/commands/` | none |
| Pi | `npx emb-agent --pi` | `./.pi/` | extension commands under `./.pi/extensions/` and skills under `./.pi/skills/` | none |

## Common behavior

- Start with `npx emb-agent`, then choose the runtime in the installer.
- Local install bootstraps `.emb-agent/` in the current repository.
- Host-specific runtime state stays under the selected runtime directory.
- Use `--profile workflow` only when authoring scaffold assets.

## Codex note

emb-agent installs Codex startup automation into `./.codex/hooks.json` automatically.

The installer also maintains `./.codex/config.toml` for project-scoped agent wiring. In normal use, restart Codex once after install and open a new session. emb-agent injects startup context automatically there, and `start` is only needed when you want to re-render entry guidance manually.

## Pi note

emb-agent installs a Pi extension at `./.pi/extensions/emb-agent.ts` (or `~/.pi/agent/extensions/emb-agent.ts` for global installs). The extension registers `/emb ...`, `/emb:<command>`, and `/emb-<command>` wrappers, injects startup context through Pi lifecycle events, and exposes matching Agent Skills under `./.pi/skills/`.
