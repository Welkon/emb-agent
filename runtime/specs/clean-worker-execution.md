# Clean Worker Execution

- When a task is decomposed into independent sub-tasks, keep the main thread as planner, dispatcher, reviewer, and integrator. Workers should execute only one assigned contract and then exit.
- Every worker contract must contain five non-empty fields: Goal, Inputs, Outputs, Forbidden Zones, and Acceptance Criteria. Treat the contract as immutable. If it is wrong, fail fast instead of silently rewriting it.
- Prefer fresh context for independent workers. Do not rely on hidden conversation history or implied state. The worker prompt should be self-contained enough that another fresh worker could continue from the synthesized result.
- Workers must not recursively dispatch more workers. Workers must not review their own outputs. The main thread owns Stage A contract/spec compliance review and Stage B quality review before merge.
- If Stage A fails, reject and redispatch with a tighter contract. Do not patch the last 10% inline in the main thread, because that re-pollutes the coordinator context.
- Keep Outputs and Forbidden Zones explicit enough to bound side effects. If a worker is read-only, say so directly. If a worker may write, keep the writable surface narrow and mechanically checkable.
