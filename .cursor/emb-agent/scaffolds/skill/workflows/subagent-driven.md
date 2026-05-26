# Workflow: Subagent Driven

## Dispatch Rule

- Use fresh workers only when sub-tasks are independent, long-running, or mixed exploration plus implementation plus review.
- Do not recursively dispatch from a worker.

## Phases

1. Plan
2. Dispatch
3. Stage A Review
4. Stage B Review
5. Merge Or Reject

## Stage A Checks

- <!-- FILL: outputs files must be exactly listed where -->
- <!-- FILL: forbidden zones definition -->
- <!-- FILL: acceptance command -->

## Stage B Checks

- <!-- FILL: code quality axis -->
- <!-- FILL: gotcha or AAR threshold -->
- <!-- FILL: recording threshold -->
- Reject any lesson write-up that fails the 2/3 recording threshold or stays project-specific instead of being generalized.
- For any accepted high-cost lesson, verify both storage and activation before merge.
