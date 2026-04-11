# Smart Pillbox Focus

- Make the medication schedule state machine explicit. Reminder due, acknowledged, lid opened, dose taken, skipped, snoozed, and manually corrected states should not be inferred from a single loose event.
- Separate raw hardware events from medical-facing conclusions. Lid-open, compartment-open, weight change, button confirm, and timeout are evidence; "dose taken" is a higher-level decision with rules and uncertainty.
- Re-check device, app, mini-program, and cloud consistency whenever reminder plans, adherence records, caregiver notifications, or timezone logic changes.
- Verification should mention false-positive and false-negative risk, especially after reconnect, clock correction, factory reset, low-power fallback, or delayed sync replay.
