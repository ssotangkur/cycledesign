---
name: wrap-up
description: Wrap up a branch for PR - verify test coverage and validations, adversarial review, commit/push, sync PR, green CI
---

## Goal

Take the current branch from "code done" to "PR ready with green CI".

## Exit criteria

- [ ] Change is covered by unit tests, E2E tests, or both
- [ ] `npm run validate` passes (lint, typecheck, knip)
- [ ] Unit suites pass (`vitest run` per workspace)
- [ ] Relevant E2E tests pass locally (Playwright)
- [ ] An adversarial review agent has reviewed the diff; every issue it raised is either fixed or reported back with reasons
- [ ] Changes committed and pushed; PR created, or existing PR title/body updated to match the actual changes
- [ ] All PR checks green (`gh pr checks <PR>`)

## Rules

- Every check must pass against the final code state being merged. If the code changes after a check passed, that check is stale and must be re-run. Finalize only when all checks are green on the same commit.
- Fix only review issues you agree with. Report the rest with reasons when done.
- Out-of-scope issues count as "don't fix now" but must still be reported.
- Never add files to the `knip.json` ignore list without explicit user permission - delete unused files instead.
- Verify PR status with the `gh` CLI, never local results alone.
- If no PR exists yet, create a draft PR so CI runs and `gh pr checks` has a target; `pr-create` will finalize the description later. Never leave a branch with green local checks but no PR behind.

## Structured Return Contract

Always end with this block so an orchestrator (e.g. `resolve-issue`) can bubble results into the PR without reading your diff:

```
status: DONE|BLOCKED
branch: <full branch name>
commit: <final SHA — all checks green on this SHA; empty if BLOCKED>
validation: <`npm run validate` result on final SHA>
tests: <unit suites + E2E summary on final SHA>
unresolved_findings: <each review issue not fixed, with kind tags from the `review` skill, file:line, and 1-line reason — or `None`>
blocked_reason: <only if BLOCKED — what failed, what you tried, what is needed>
```

Rules for the contract:

- `unresolved_findings` uses the exact wording the human reviewer needs. One line per finding minimum: `- [<kinds>] <file:line> — <issue> (not fixed because: <reason>)`.
- `DONE` still requires every exit criterion checked. Unfixed review items do NOT block DONE — they go in `unresolved_findings` for the human reviewer.
- `BLOCKED` means red CI, failing validation/tests you cannot fix, or a review `correctness`/`security` issue you cannot resolve. Include evidence (failing command + output excerpt).
