# Platforms

This page only covers platform-specific setup differences. The canonical onboarding path is in [quick-start.md](./quick-start.md).

## Supported runtimes

| Runtime | Install | Runtime dir | Command surface | Extra manual step |
| --- | --- | --- | --- | --- |
| Codex | `npx emb-agent --codex --local --developer your-name` | `./.codex/` | project skills under `./.codex/skills/` | Hooks may still require `multi_agent = true` and `codex_hooks = true` in `~/.codex/config.toml` |
| Claude Code | `npx emb-agent --claude --local --developer your-name` | `./.claude/` | slash commands under `./.claude/commands/emb/` | none |
| Cursor | `npx emb-agent --cursor --local --developer your-name` | `./.cursor/` | command wrappers under `./.cursor/commands/` | none |

## Common behavior

- Local install bootstraps `.emb-agent/` in the current repository.
- Host-specific runtime state stays under the selected runtime directory.
- Use `--profile workflow` only when authoring scaffold assets.

## Codex note

As of Codex CLI `v0.116.0` on `2026-03-24`, hooks may still require manual enablement in `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
codex_hooks = true
```

emb-agent intentionally does not write these flags automatically.
