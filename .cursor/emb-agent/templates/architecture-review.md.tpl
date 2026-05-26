# Architecture Review

- Date: {{DATE}}
- Project: {{PROJECT_NAME}}
- Board: {{BOARD_NAME}}
- MCU / SoC: {{MCU_NAME}}
- Target: {{TARGET_NAME}}
- Profile: {{PROFILE}}
- Packs: {{PACKS}}

## 1. Deep Requirement Interrogation

### Confirmed Inputs

- Physical environment:
- Temperature / EMC / certification:
- Expected volume:
- Cost sensitivity:
- Team skill profile:
- Maintenance horizon:

### Missing Constraints

- Unknown 1:
- Unknown 2:
- Unknown 3:

## 2. Trinity Diagram Protocol

### Context Diagram Check

- Power path:
- Programming / debug path:
- Production test path:
- User interface path:

### Block Diagram Check

- Voltage domains:
- Buses and arbitration:
- Pin mux conflicts:
- Clock / timing domains:
- Analog integrity:

### Organigram Check

- Runtime model: {{RUNTIME_MODEL}}
- Concurrency model: {{CONCURRENCY_MODEL}}
- ISR / task split:
- State machine complexity:
- Memory model:
- Heavy algorithms:

## 3. Scenario Simulation

### Option A: Prototype-First

- Candidate:
- Why it fits:
- Hidden cost:

### Option B: Cost-Down Production

- Candidate:
- Why it fits:
- Hidden cost:

### Option C: Modern Balanced

- Candidate:
- Why it fits:
- Hidden cost:

## 4. Evaluation Matrix

| Dimension | Check | Analysis |
| --- | --- | --- |
| Theory | Diagram Check | |
| Theory | Speeds & Feeds | |
| Theory | Supply Chain | |
| Reality | Driver Nightmare Index | |
| Reality | Physical / Assembly Difficulty | |
| Reality | Debug Friendliness | |

## 5. Pre-Mortem

- Most likely cause of failure:
- Trigger path:
- Earliest warning sign:
- What should be validated first:

## Conclusion

- Recommended path:
- What to validate in PoC first:
- What not to over-engineer yet:
