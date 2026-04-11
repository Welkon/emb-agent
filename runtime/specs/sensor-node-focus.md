# Sensor Node Focus

- Re-check sampling windows, settle time, filtering, calibration, and unit conversion whenever sensor readout code changes.
- Confirm measurement-update timing from source to published state, not just the local driver routine.
- Note any assumptions about ADC references, gain, scaling, or warm-up behavior in the working notes.
- If a change shifts power modes, confirm it does not silently degrade measurement cadence or accuracy.

