# Platforms

emb-agent is designed to keep one embedded workflow model across multiple AI runtimes.

## Supported runtimes

### Codex

Install:

```bash
npx emb-agent --codex --local --developer your-name
```

Recommended layout:

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

Project runtime CLI path:

```bash
node ./.codex/emb-agent/bin/emb-agent.cjs
```

### Claude Code

Install:

```bash
npx emb-agent --claude --local --developer your-name
```

Recommended layout:

- project-scoped Claude assets under `./.claude/`
- project-scoped slash-command wrappers under `./.claude/commands/emb/`
- project-scoped hook config in `./.claude/settings.json`

Project runtime CLI path:

```bash
node ./.claude/emb-agent/bin/emb-agent.cjs
```

### Cursor

Install:

```bash
npx emb-agent --cursor --local --developer your-name
```

Recommended layout:

- project-scoped Cursor assets under `./.cursor/`
- project-scoped command wrappers under `./.cursor/commands/`
- project-scoped hook config in `./.cursor/settings.json`

Project runtime CLI path:

```bash
node ./.cursor/emb-agent/bin/emb-agent.cjs
```

## Shared workflow

Regardless of runtime, the default local-install path stays the same:

```text
install -> declare hardware -> next
```

If MCU choice is still open, the parallel concept-stage path is:

```text
install -> record goals/constraints in req.yaml -> next
```

The runtime changes where host-side state is stored, not how project truth is modeled.

## Shared project-side assets

These stay inside the repository:

- `.emb-agent/hw.yaml`
- `.emb-agent/req.yaml`
- `.emb-agent/project.json`
- `.emb-agent/tasks/`
- generated docs and checklists

## Runtime-side assets

These stay in the host runtime area:

- runtime CLI
- host config integration
- session state
- pause/resume handoffs
- install metadata

This lets teams share project truth while keeping runtime-specific continuity out of the repository.
