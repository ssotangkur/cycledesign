---
name: review
description: Adversarial code review in an isolated subagent - each issue argued with the pp skill and tagged by kind
---

## Goal

Review the given changes (uncommitted diff, commit, branch, or PR - infer scope from context) as an adversary trying to break them.

## Rules

- Run the review in an isolated subagent with fresh context, so findings aren't anchored by the author's reasoning.
- Raise as many issues as merit demands - there is no cap.
- Present each issue using the `pp` skill: verdict first, then MECE supporting reasoning backed by evidence from the code.
- Tag each issue by kind, not severity. Tags combine freely (e.g. `correctness` + `defensive`):
  - `correctness` - logic errors, wrong behavior, broken contracts
  - `security` - injection, auth bypass, secrets or data exposure
  - `defensive` - unhandled edge cases, null/empty inputs, error paths
  - `consistency` - deviates from existing patterns, conventions, abstractions
  - `test-coverage` - changed behavior lacking unit or E2E coverage
  - `performance` - only flag if obviously problematic
  - `clarity` - naming, readability, structure that slows future readers
  - `scope` - out-of-scope changes, YAGNI, scope creep in the diff
- Only review the changes - never pre-existing untouched code.
- Investigate before flagging: if unsure, gather context first; never invent hypothetical problems without a realistic breakage scenario.
