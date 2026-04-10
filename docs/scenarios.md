# Scenarios

emb-agent works best when the user can quickly identify their current scenario and choose the lightest path that keeps truth aligned.

## 1. Existing repository, hardware identity not fully locked

Use this when the codebase exists, but the MCU/package truth is still unclear or scattered.

Flow:

```text
init -> confirm detected chip/package -> declare hardware -> next
```

Use:

- `init` to scaffold truth files and inspect current inputs
- `declare hardware` to lock MCU and package
- `ingest doc` only if the answer still lives in manuals or PDFs

## 2. Known pin map, no repeated questioning needed

Use this when an experienced engineer already knows the final signal mapping.

Flow:

```text
declare hardware -> next
```

Example:

```bash
<runtime-cli> declare hardware \
  --signal KEY_IN --pin PA4 --dir input \
  --signal PWM_OUT --pin PA3 --dir output \
  --peripheral PWM --usage "LED dimming"
```

This is the shortest path for real embedded work when the board truth is already known.

## 3. Datasheet-first project truth extraction

Use this when the answer is not confidently known and must be derived from evidence.

Flow:

```text
ingest doc -> review/apply -> next
```

Use:

- `ingest doc --file <path> --kind datasheet --to hardware`
- apply-ready diff flows before implementation

Prefer this path when pin mux, timing limits, or register boundaries still need evidence.

## 4. Peripheral bring-up

Use this for timer / PWM / ADC / comparator / register-heavy work.

Flow:

```text
declare hardware -> next -> scan/plan/do/debug
```

Directionally, keep the same staged path:

```text
declare hardware -> next -> scan/plan/do/debug -> review -> verify
```

Typical pattern:

- record the relevant signals and peripheral ownership first
- use `next` for routing
- if the work becomes more structured, move to `scan`, `plan`, `debug`, or `verify`

## 5. Long-running debug session

Use this when a bug investigation spans multiple sessions or context resets.

Flow:

```text
debug -> pause -> resume -> task
```

Useful when:

- bench failures are intermittent
- timing issues need several passes
- work must be handed back to the same engineer later

## 6. Multi-step implementation work

Use this when the work is no longer a one-shot patch.

Flow:

```text
task add -> task activate -> task context add -> task resolve
```

This is where `task.json` and task-local file context become more useful than a purely conversational workflow.
