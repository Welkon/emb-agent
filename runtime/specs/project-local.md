# Project Local Rules

This file is auto-injected at session start. Keep it high-signal.

## 🔂 Session Start Gate

- emb-agent startup context is auto-injected. Trust it — do NOT re-query.
- Run `start` ONLY: (a) session beginning, or (b) user explicitly asks.
- **First action in every session: run `emb-agent-rs next --json` and follow its output exactly.**
- The `Recommended next command` in the injected context tells you what to run — execute it as a command, not a general direction.

## 🚫 Minimize CLI Re-Queries

**Use the Rust binary directly for read-only queries (0.1s vs 3s Node):**
- `next` → `.pi/emb-agent/bin/emb-agent-rs next --brief --json`
- `task list` → `.pi/emb-agent/bin/emb-agent-rs task list`
- `task show <name>` → `.pi/emb-agent/bin/emb-agent-rs task show <name>`
- `health` → `.pi/emb-agent/bin/emb-agent-rs health`
- `status` → `.pi/emb-agent/bin/emb-agent-rs status`

**Never re-run these without a state change:**
- `next` — trust the first result until you've completed its recommendation
- `health` — only after making changes that fix a reported gate failure
- `task show` — read once, keep results in working memory

**Only re-query when:**
- You just created/activated/resolved a task
- You just wrote implementation evidence
- You hit a gate and need to verify it's cleared

Each CLI call costs 3-6 seconds. 71 redundant queries in one session = minutes wasted.

## 📖 Read Discipline

**Before reading any file, check:**
1. Did I already read this in the current session? → Reuse previous output
2. Is the info available in `.emb-agent/cache/docs/<doc-id>/parse.md`? → Read parsed MinerU output instead of grepping raw PDFs
3. Is this a datasheet lookup? → Use `grep -r "keyword" .emb-agent/cache/docs/` once, not multiple PDF greps

**For chip migration:** use `emb-agent migrate --confirm` instead of manually reading SDK headers, SFR files, and datasheets.

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
- ✅ Run `emb-agent migrate --from <old> --to <new> --confirm` for guided flow
