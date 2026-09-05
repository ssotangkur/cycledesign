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
