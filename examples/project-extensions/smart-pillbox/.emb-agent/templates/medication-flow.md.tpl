# Medication Flow

## Scope

- Device model:
- Reminder form: buzzer / light / screen / motor / app push
- User roles: patient / caregiver / operator

## Schedule Truth

- Who owns the active medication plan?
- How is plan versioning tracked?
- How are timezone and DST handled?
- What happens when the device is offline during a plan update?

## Evidence Inputs

- Lid / compartment open signals:
- Weight / presence sensing:
- Button confirmations:
- Timeout / snooze events:
- RTC / clock sync events:

## State Machine

- Pending:
- Reminding:
- Acknowledged:
- Taken:
- Missed:
- Skipped:
- Manually corrected:

## Sync And Reconciliation

- Which side is source of truth for adherence records?
- How are duplicate uploads prevented?
- How are delayed events replayed and ordered?
- What happens when app state and device state disagree?

## Safety Rules

- What must still work offline?
- What degrades under low battery?
- What must never report a false success?
- What requires explicit human confirmation?
