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

## Long-lived servers (dev/E2E) — never boot in the foreground

`npm run dev`, `npm run dev:e2e`, `dev:server`, and `dev:web` are long-lived:
they never exit, so awaiting one inside a tool call hangs forever — the call
never returns, the subagent waits forever, and every caller up the chain wedges
with zero output. Precedent: #110 (a wrap-up subagent foregrounded
`npm run dev:e2e` and stalled 1.5h+ with zero CPU, zero errors, zero log
activity).

1. **Reuse first.** Before booting anything, check the scope you need:
   ```bash
   node scripts/check-ports.cjs          # dev scope
   node scripts/check-ports.cjs --e2e    # E2E scope
   ```
   Exit 0 = all free; exit 1 = busy (output names the owning process). If the
   ports you need are already up and healthy (server `/health`, web root),
   reuse them — do not boot.
2. **Never foreground-boot. Launch detached, then poll.** The launch must
   survive the tool call — PowerShell `Start-Job` does NOT (jobs die with
   the shell that created them, so the boot never happens). On Windows
   PowerShell:
   ```powershell
   Start-Process -FilePath 'cmd' -ArgumentList '/c npm run <dev|dev:e2e> > tmp/<dev|e2e>-boot.log 2>&1' -WorkingDirectory $PWD -WindowStyle Hidden
   ```
   (POSIX: `nohup npm run <dev|dev:e2e> > tmp/<dev|e2e>-boot.log 2>&1 &` —
   `disown` is bash-only, omit it under POSIX `sh`.) The command returns
   immediately; never block on / await the server process itself — only on
   a bounded readiness poll. For E2E, prefer no manual boot at all:
   `npx playwright test` manages the E2E stack itself via `webServer`
   (`reuseExistingServer` locally, 120s timeout) — only boot manually when
   bypassing `webServer`.
3. **Bound every boot with a readiness timeout.** Poll port readiness (server
   `/health`, web root; resolve ports via `node scripts/ports.cjs [--e2e]`)
   in a loop that fails after N minutes (3–5 min is typical) if the port never
   opens. A timed-out boot is BLOCKED — report the command plus a log tail
   (`tmp/<dev|e2e>-boot.log`, `tmp/server.log` / `tmp/web.log`) — never a silent hang.
4. **Scope discipline.** `dev` only kills dev ports, `dev:e2e --kill-first`
   only kills E2E ports — E2E boots never disturb manual dev servers and vice
   versa. Never kill ports owned by another checkout; give this checkout its
   own offset in `.ports.local.json` instead.

End-to-end shape: check ports → reuse or detached-boot → poll until ready
(bounded) → run tests → finish and return control. The boot step must never be
the step the run hangs on.

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
