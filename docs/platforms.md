# Platforms

emb-agent is designed to keep one embedded workflow model across multiple AI runtimes.

This page only covers platform-specific setup differences. The canonical onboarding path is in [quick-start.md](./quick-start.md).

## Supported runtimes

### Codex

Install:

```bash
npx emb-agent --codex --local --developer your-name
```

Host-specific notes:

- project-scoped Codex assets under `./.codex/`
- global host feature flags in `~/.codex/config.toml`

Manual feature gate:

As of Codex CLI `v0.116.0` on `2026-03-24`, hooks remain experimental and require manual enablement in `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
codex_hooks = true
```

emb-agent intentionally does not add these flags for the user. If your team or runtime config already enables them, you can skip this step. If Codex later ships hooks as a default stable feature, this step may become unnecessary.

### Claude Code

Install:

```bash
npx emb-agent --claude --local --developer your-name
```

Host-specific notes:

- project-scoped Claude assets under `./.claude/`
- project-scoped slash-command wrappers under `./.claude/commands/emb/`
- project-scoped hook config in `./.claude/settings.json`

### Cursor

Install:

```bash
npx emb-agent --cursor --local --developer your-name
```

Host-specific notes:

- project-scoped Cursor assets under `./.cursor/`
- project-scoped command wrappers under `./.cursor/commands/`
- project-scoped hook config in `./.cursor/settings.json`

## Common behavior

Across all supported runtimes, local install bootstraps `.emb-agent/` inside the repository and keeps host-specific state under the selected runtime directory.
