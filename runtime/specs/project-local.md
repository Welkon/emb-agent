# Project Local Rules

This file is auto-injected at session start. Keep it high-signal.

## 🔂 Session Start Gate

- emb-agent startup context is auto-injected. Trust it — do NOT re-query.
- Use `start` ONLY: (a) session beginning, or (b) user explicitly asks.
- **First action in every session: trigger `/emb:next` through the host slash-command channel and follow its output exactly.**
- The `Recommended next command` in the injected context tells you which `/emb:*` slash command to trigger. Do not execute emb-agent through bash, Node, or `emb-agent-rs` directly in the main conversation.

## 🚫 Minimize Re-Queries

**Use slash commands, not shell commands:**
- `next` → `/emb:next --brief`
- `task activation` → `/emb:task activate <name>` after the user chooses a task
- `health` → `/emb:health`
- `status` → `/emb:status`

**Never re-run these without a state change:**
- `next` — trust the first result until you've completed its recommendation
- `health` — only after making changes that fix a reported gate failure
- task detail lookups — read once, keep results in working memory

**Only re-query when:**
- You just created/activated/resolved a task
- You just wrote implementation evidence
- You hit a gate and need to verify it's cleared

Each redundant tool call wastes context and time. Trust the latest emb-agent payload until state changes.

## 📖 Read Discipline

**Before reading any file, check:**
1. Did I already read this in the current session? → Reuse previous output
2. Is the info available in `.emb-agent/cache/docs/<doc-id>/parse.md`? → Read parsed MinerU output instead of grepping raw PDFs
3. Is this a datasheet lookup? → Use `grep -r "keyword" .emb-agent/cache/docs/` once, not multiple PDF greps

**For chip migration:** use the emb-agent migration flow instead of manually reading SDK headers, SFR files, and datasheets.

## 🛡️ Confirm Behavior Before Coding

1. **Describe expected behavior first** — 1-2 sentences, get user confirmation
2. Do NOT guess from bug text alone — ask if ambiguous
3. After coding, verify with: `grep` for key flags/logic, static check
4. Record changes in task PRD and migration log

## 📦 Migration Checklist

- ✅ Backup source files BEFORE any code changes
- ✅ Verify pin mapping against hw.yaml and schematic
- ✅ Confirm touch key, PWM, and peripheral pin assignments with user
- ✅ Update .emb-agent/hw.yaml, req.yaml, system PRD
- ✅ Use the emb-agent migration flow for guided chip migration
