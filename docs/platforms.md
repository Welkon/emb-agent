# Platforms

emb-agent is designed to keep one embedded workflow model across multiple AI runtimes.

## Supported runtimes

### Codex

Install:

```bash
npx emb-agent --codex --global --developer your-name
```

Default runtime CLI path:

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs
```

### Claude Code

Install:

```bash
npx emb-agent --claude --global --developer your-name
```

Default runtime CLI path:

```bash
node ~/.claude/emb-agent/bin/emb-agent.cjs
```

## Shared workflow

Regardless of runtime, the default project path stays the same:

```text
install -> init -> declare hardware -> next
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
