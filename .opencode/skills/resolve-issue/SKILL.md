---
name: resolve-issue
description: Fire-and-forget orchestrator that resolves a GitHub issue via sub-agents only - never codes directly
---

# Resolve Issue Skill

You are an **orchestrator, not an implementer**. Given a GitHub issue, drive it to one of exactly two terminal states — an open PR, or a question comment on the issue — by spawning sub-agents. You never write code, run tests, review diffs, or fix CI yourself.

## Terminal states (only two valid endings)

1. **PR ready:** PR created/updated and ready for human review.
2. **Blocked:** cannot proceed without human input — question posted on the issue.

There is no silent exit, no partial completion, no asking the user directly.

## Rules

- **Never implement directly.** No `edit`/`write` of code files. No `npm run validate`, no `vitest`, no Playwright runs. Delegate all of it.
- **Reference skills in every delegation** instead of re-explaining the workflow. The skill body lives with the sub-agent, saving your context.
- **Never ask the user anything.** Do not use the `question` tool. Do not stop for confirmation. This is fire-and-forget.
- **Every `Task` delegation must demand a structured return** (see contracts below). You decide next steps from those returns, not from reading code yourself.
- **Label moves are yours** — do them directly with `gh`, cheap and without delegation:
  - Start: remove `ready to implement`, add `implementing`
  - Success: remove `implementing`, add `pr ready`
  - Blocked: remove `implementing`, add `question` + post explanatory comment
- **Max 3 fix loops.** If implement → wrap-up cycles 3 times without green CI, escalate to Blocked instead of looping forever.

## Inputs

- GitHub issue reference (number or URL, e.g. `41` or `https://github.com/ssotangkur/cycledesign/issues/41`). Repo defaults to `ssotangkur/cycledesign`.
- If missing or unparseable, you cannot proceed — but you still may not ask the user. End as Blocked is impossible without an issue number, so just stop with an error message in chat (this is the single exception to the terminal-state rule).

## Workflow

### Phase -1 — Preflight (no side effects)

Before touching labels or the issue thread, verify you can actually orchestrate. Abort with a chat-only error (no label moves, no issue comments) if any check fails:

1. You have a `Task` (spawn sub-agent) mechanism available. If running as a nested sub-agent without it, stop and report to the parent — do not fall back to implementing directly, do not post on the issue.
2. The skill files are readable (`resolve-issue`, `git-create-branch`, `wrap-up`, `pr-create`). If loading via the `skill` tool fails (stale `<available_skills>` cache for newly created skills), load via `Read` from `.opencode/skills/<name>/SKILL.md`. If still unreadable, stop and report — do not post on the issue.

Only proceed to Phase 0 when both pass. Infrastructure failures must never produce issue comments or label moves.

### Phase 0 — Claim the issue (you do this, no sub-agent)

1. Parse issue number. Resolve repo (default `ssotangkur/cycledesign`).
2. Read issue + visible comments for context on re-invocations (answers to prior questions live there):
   ```bash
   gh issue view <N> --repo ssotangkur/cycledesign --json title,body,labels,comments
   ```
   Comment hygiene (saves tokens, avoids stale-plan confusion): minimized/hidden comments are superseded by definition — do not read them. `gh issue view` does not flag minimized state, so list it explicitly (substitute the issue number for `<N>`) and skip those IDs:
   ```bash
   gh api graphql -F owner=ssotangkur -F repo=cycledesign -F number=<N> -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){comments(first:100){nodes{databaseId,isMinimized,author{login}}}}}}'
   ```
   (Variable form — no quoted literals, so it survives shells that mangle inner double quotes.)
   When several `## Plan with Reason` comments exist, the newest one (follow its `Supersedes` link) is the only plan that counts — record its comment ID and pass it down so sub-agents don't re-read the older ones.
3. Check for existing work to resume instead of duplicating:
   ```bash
   git branch -a | grep -E "issue/<N>/"
   gh pr list --repo ssotangkur/cycledesign --head "issue/<N>/*" --state open --json number,headRefName,url
   ```
   - If an open PR/branch exists, reuse it (pass `branch:` explicitly to all sub-agents).
4. Claim:
   ```bash
   gh issue edit <N> --repo ssotangkur/cycledesign --remove-label "ready to implement" --add-label "implementing"
   ```
   - Ignore "label not present" errors — continue.

### Phase 1 — Branch (delegate)

Spawn sub-agent, reference the skill:

```
Delegate to sub-agent with `git-create-branch` skill:
"Create branch for issue #<N> (repo ssotangkur/cycledesign). If branch issue/<N>/* already exists, return it instead of creating a duplicate. Follow the skill workflow exactly including worktree-safe creation.

Return contract:
status: DONE|BLOCKED
branch: <full branch name>
blocked_reason: <only if BLOCKED>"
```

- BLOCKED → go to Phase 5 (Blocked).
- DONE → continue with `branch` for all later phases.

### Phase 2 — Implement (delegate)

```
Delegate to coding sub-agent:
"Implement issue #<N> on branch <branch>. First read the issue plus visible (non-minimized) comments via `gh issue view <N> --repo ssotangkur/cycledesign --json title,body,comments` — skip minimized/hidden comments; if several `## Plan with Reason` comments exist, read only the newest (comment ID <plan-comment-id>, following its `Supersedes` link). Later comments may contain answers to prior blocking questions and extra context tagged for re-invocation. Follow AGENTS.md and existing patterns. Commit as you go (conventional commits). Do NOT run full validation, E2E, review, or PR creation — wrap-up handles that.

Return contract:
status: DONE|BLOCKED
branch: <branch>
commits: <list of SHAs/messages>
blocked_reason: <only if BLOCKED — what is unclear, what you tried, what you need>"
```

- BLOCKED → Phase 5.
- DONE → Phase 3.

### Phase 3 — Wrap-up (delegate)

Reference the `wrap-up` skill — it owns coverage, `npm run validate`, unit/E2E, adversarial `review`, commit/push, green CI:

```
Delegate to sub-agent with `wrap-up` skill:
"Run wrap-up on branch <branch> for issue #<N>. Follow the skill exactly including the Structured Return Contract section. Fix what you agree with; report the rest.

Return contract (per wrap-up skill):
status: DONE|BLOCKED
branch: <branch>
commit: <final SHA, all checks green on this SHA>
validation: <npm run validate result>
tests: <unit + E2E summary>
unresolved_findings: <each with kind tags, file:line, why not fixed — empty if none>
blocked_reason: <only if BLOCKED>"
```

- Retry policy: if BLOCKED but the reason looks fixable by re-implementation (failing test, lint, review `correctness` issue), you may loop Phase 2 → Phase 3 up to 3 total attempts. Pass the `blocked_reason`/`unresolved_findings` as context to the next implementer.
- If attempts exhausted or reason needs human judgment → Phase 5.
- DONE → Phase 4. Preserve `unresolved_findings` verbatim for the PR.

### Phase 4 — PR (delegate, then label)

Reference the `pr-create` skill:

```
Delegate to `pr-creator` sub-agent with `pr-create` skill:
"Create or update the PR for branch <branch> (issue #<N>). Verify with `gh pr view`. Include the standard Related Issues footer (Closes #<N> unless the change is partial — then Refs/Part of). Append this section verbatim at the end of the body, even if empty-notify:

## Open Review Notes (for human reviewer)
<unresolved_findings from wrap-up, or 'None — all review findings addressed.'>

Wrap-up evidence to include under Testing:
<validation + tests summary from wrap-up>

Return contract:
status: DONE|BLOCKED
pr_url: <full PR URL>
pr_number: <number>
blocked_reason: <only if BLOCKED>"
```

On DONE (you do this, no sub-agent):

```bash
gh issue edit <N> --repo ssotangkur/cycledesign --remove-label "implementing" --add-label "pr ready"
```

Then stop. Reply in chat with branch + PR URL + unresolved-findings count.

### Phase 5 — Blocked (you do this, no sub-agent)

Triggered by any BLOCKED return, or an unrecoverable error in a sub-agent.

1. Compose a comment containing: what was attempted (branch, phases completed), the exact blocker, the specific question for the human, and any extra context the next `resolve-issue` invocation will need (it will re-read this comment):
   ```bash
   gh issue comment <N> --repo ssotangkur/cycledesign --body-file tmp/resolve-blocked.md
   ```
   Use a tmp file for long bodies.
2. Swap labels:
   ```bash
   gh issue edit <N> --repo ssotangkur/cycledesign --remove-label "implementing" --add-label "question"
   ```
3. Stop. Reply in chat with the issue comment URL and blocker summary. Do not retry.

## Anti-patterns

- Reading diffs, running tests, or editing code yourself "to save a delegation" — that defeats the context-saving purpose.
- Re-explaining `git-create-branch` / `wrap-up` / `pr-create` workflows inline instead of referencing the skill.
- Ending without a PR URL or an issue question comment.
- Posting progress comments mid-run — only label moves are silent; the issue thread is for plans (Phase 0 resume context) and the final state.
- Looping implement → wrap-up more than 3 times.
