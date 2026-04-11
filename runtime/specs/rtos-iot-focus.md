# RTOS IoT Focus

- Re-check task boundaries, queue ownership, timer interactions, and lock ordering when behavior spans multiple execution contexts.
- Preserve safe offline behavior and restart recovery paths when touching connectivity, OTA, or cloud-synced state.
- Prefer explicit lifecycle state over hidden background work. If retries, reconnects, or deferred jobs exist, make the state machine observable.
- Verification should mention both the happy path and recovery path when networked behavior changes.

