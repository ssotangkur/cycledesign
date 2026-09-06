---
description: Fire-and-forget resolve a GitHub issue to PR or blocking question via sub-agent orchestration
---

Load and follow the `resolve-issue` skill using the skill tool.

Target issue / input: $ARGUMENTS

If no issue reference was given, do not guess — stop with an error message in chat (fire-and-forget has no interactive clarification). Otherwise follow the skill workflow exactly: claim with labels (`ready to implement` → `implementing`), delegate branch (`git-create-branch`), implementation, `wrap-up`, and `pr-create` to sub-agents with structured return contracts, then end in exactly one terminal state — `pr ready` label with PR URL, or `question` label with a blocking question comment on the issue. Never implement, test, or review directly. Never ask the user anything.
