---
description: Create a resilient implementation plan for a GitHub issue via research + grilling, recorded as Key Decisions
---

Load and follow the `plan-with-reason` skill using the skill tool.

Target issue / input: $ARGUMENTS

If no issue reference was given, ask the user for the GitHub issue (owner/repo + number or URL) and do not proceed without it.

Follow the skill workflow exactly: anchor to the issue, research-first (facts via code, never ask the user for lookups), then grill in frontier rounds, then synthesize Key Decisions (KD-1, KD-2, ...) with implementation steps referencing them, then record the `## Plan with Reason` comment on the issue. Do not start implementing.
