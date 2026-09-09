---
description: Fire-and-forget implementation plan for a GitHub issue via async comments and labels
---

Load and follow the `gh-plan-with-reason` skill using the skill tool.

Target issue / input: $ARGUMENTS

If no issue reference was given, do not guess — stop with an error message in chat (fire-and-forget has no interactive clarification). Otherwise follow the skill workflow exactly: claim with labels (`planning` added, `ready to plan` + `question` removed), research-first (facts via code, never ask the user for lookups), then grill via Round N comments ending in `question` when blocked, then post the `## Plan with Reason` comment with Key Decisions and add `ready to implement`. End in exactly one terminal state — `ready to implement` with plan, or `question` with blocking questions. Never implement. Never ask the user anything. Mirror each label move to the Project Status field via `scripts/agent-project.ts` (best-effort).
