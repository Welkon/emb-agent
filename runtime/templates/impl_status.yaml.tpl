# Implementation Status Tracking
# Schema version 1
#
# Tracks which compound decisions have been implemented in code,
# and whether they've been verified (hardware test, scope measurement, etc).
#
# Auto-updated by:
# - `emb impl mark --decision <slug> --status implemented --file <path>`
# - `emb impl verify --decision <slug>` (manual confirmation or test run)
# - Auto-mark when `compound add` + `do` happen in same task
#
# Used by:
# - `emb next` when active_task is null + user query is state-query
#   → surfaces recent impl status instead of forcing work-routing
# - `emb health` → shows impl vs planned gap

schema_version: 1

decisions: []
# Example entries:
# - slug: decide-wdt-awake-only-key-stop-sleep
#   status: implemented       # planned | implemented | verified
#   files:
#     - src/main.c
#   lines: "45-48, 120-122"   # optional, for precise tracking
#   commit: a3f8c9d           # optional, auto-filled from git
#   verified_at: null         # ISO8601 timestamp when verified
#   verified_by: manual       # manual | test | scope
#   notes: "SWDTEN config + CLRWDT in main loop"
#
# - slug: decide-motor-pwm-frequency-16khz
#   status: verified
#   files:
#     - src/platform.c
#   commit: b7e4f1a
#   verified_at: "2026-06-13T15:30:00Z"
#   verified_by: scope
#   notes: "Scope-verified 16.02 kHz"
