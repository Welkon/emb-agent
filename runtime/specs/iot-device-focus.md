# IoT Device Contract Focus

- Treat device, app, mini-program, and cloud state as an explicit contract. For each mutable field, name the source of truth, version rule, and conflict-resolution path.
- Make provisioning and identity lifecycle observable. BLE pairing, Wi-Fi onboarding, device binding, factory reset, and ownership transfer should have explicit states and recovery rules.
- When commands, reminders, or sync operations can arrive late or be retried, verify idempotency, dedupe keys, timestamps, and offline replay ordering before changing business logic.
- For user-visible alerts, records, or safety-sensitive confirmations, document what still works offline, what degrades on low power, and what must never report a false success.
