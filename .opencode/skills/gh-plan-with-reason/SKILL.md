---
name: gh-plan-with-reason
description: Create a resilient implementation plan for a GitHub issue via async comments and labels, resuming across invocations without gists.
---

## Purpose

Async variant of `plan-with-reason`. Instead of grilling via TUI, grill via GitHub issue comments. Fire-and-forget like `resolve-issue`.

Labels are state, the issue thread is memory. Each run is stateless and ends in exactly one of two terminal states. No gists, no external store.

## Terminal states (only two valid endings)

1. **Ready:** plan posted, issue labeled `ready to implement`.
2. **Blocked:** questions posted, issue labeled `question`.

There is no silent exit. Never use the `question` tool. Never ask the user directly.

## Label state machine

```
ready to plan <-> question -> ready to implement
```

- Claim (you do this): remove `ready to plan` + `question`.
- Need answers: post Round N comment, add `question`, stop.
- Human answers in comments, removes `question`, adds `ready to plan`, re-invokes.
- Done: post `## Plan with Reason`, add `ready to implement`, remove `question`.

Label moves are idempotent — safe when absent.

## Inputs

Require before starting:
- GitHub issue reference (owner/repo + issue number, or full URL). If missing, stop with a chat-only error (single exception to terminal-state rule). Repo defaults to `ssotangkur/cycledesign`.
- Read the full thread first:
  ```bash
  gh issue view <N> --repo <owner/repo> --json title,body,labels,comments
  ```
  Treat the issue as source of truth for intent. Later comments may contain answers.

## Workflow

### Phase 0 — Claim + resume (you do this)

1. Parse issue number and repo.
2. Read issue + all comments. Find the last visible `## Planning Questions - Round` comment and any human comments after it.
3. If a hidden state block exists in that Round comment, parse it:
   `<!-- gh-plan-state {"round":N,"ads":[...],"settled":{...},"pruned":[...]} -->`
   If missing or corrupt, fall back to parsing prose. Never crash.
4. No-answer guard: if invoked with `ready to plan` but no new human comments since the last Round, stop with a chat-only note. Do not post a duplicate Round.
5. Claim:
   ```bash
   gh issue edit <N> --repo <owner/repo> --remove-label "ready to plan" --remove-label "question"
   ```

### Phase 1 — Anchor to the issue

1. Restate in one paragraph (in your working notes, not the issue): problem, desired outcome, explicit constraints.
2. If too vague to build a design tree from, grill for scope first before any research.

### Phase 2 — Research-first (facts are your job)

For every open question, classify as **fact** (answerable from repo) or **decision** (requires human judgment):

- **Fact:** resolve yourself. Search code (`glob`, `grep`, `read`), check configs, run read-only commands. Use a subagent (`explore` / `general`) for broad questions.
- **Decision:** never guess. Goes into the design tree frontier.

Rules:
- Never ask for anything you could look up yourself.
- Record every auto-answered fact as `AD-n` with evidence `file:line`. AD-IDs are stable, never renumbered once posted. Copy them forward each round.
- On resume, verify each AD cheaply (`read` the cited `file:line`). If the file changed, mark `AD-n STALE` and re-open as a question. Full search only for new frontier.

### Phase 3 — Grill via comments

Map remaining decisions as a **design tree**. The **frontier** is every decision whose prerequisites are settled. Ask the whole frontier in one Round.

Post exactly one comment per run when blocked:

```markdown
## Planning Questions - Round N

### Auto-decided (research, no human needed)
- AD-1: <fact> -> `file:line`
  Why settled: <evidence>

### Settled by human so far
- Q1 <title> -> <answer> (date)

### Asking now
❓ **Q2** - **<title>**: <body>
➡️ <recommendation>
```

Rules:
- Q-IDs stable, never renumber. Copy ADs + Settled forward so the last comment is self-sufficient.
- Number each question, give your recommended answer.
- A question depending on a still-open question belongs to a later round.
- Append hidden state to the same comment:
  `<!-- gh-plan-state {"round":N,"ads":[...],"settled":{...},"pruned":[...]} -->`
- Minimize the previous Round comment as OUTDATED so the issue shows exactly one current Round:
  ```bash
  gh api repos/<owner>/<repo>/issues/comments/<comment-id> --jq .node_id
  gh api graphql -f query='mutation($id:ID!,$classifier:ReportedContentClassifiers!){minimizeComment(input:{subjectId:$id,classifier:$classifier}){minimizedComment{isMinimized}}}' -f id='<node_id>' -f classifier=OUTDATED
  ```
  Only minimize superseded Round comments. Never minimize human replies or plans. Only minimize after verifying Round N carries forward all ADs + Settled from N-1.
- Overflow: split into `Round N (1/2)`, `(2/2)` follow-up comments. Never use gists.
- Swap labels:
  ```bash
  gh issue edit <N> --repo <owner/repo> --add-label "question"
  ```
  Use a tmp file for long bodies (`gh issue comment <N> --body-file tmp/plan-round-N.md`).
- Stop. Reply in chat with comment URL + blocker summary.

### Phase 4 — Synthesize the plan (Key Decisions + Steps)

When the frontier is empty, write the plan with two linked sections. IDs stable (`KD-1`, ...) and never reused once shared.

#### A. Key Decisions

```
- **KD-1 — <short title>**: Decision: <what was decided>.
  Why: <reason, constraint, or trade-off>.
  Alternatives rejected: <what and why, 1 line>.
  Source: <issue requirement | research `file:line` | AD-n | grilling Qn>.
```

Guidelines:
- 3–8 KDs typical. Include scope boundary, architectural choice, data/contract choice, verification criterion where applicable.
- A good KD answers "what would I do differently if this weren't true?"

#### B. Implementation Steps

```
1. [KD-2] Do <concrete change> in `<file>` (~<lines/function>).
   - Detail: <exact behavior, flags, schema, API shape>.
   - Verify: <command or observable outcome>.
2. Do <mechanical step> (no KD needed).
```

Resilience contract (state verbatim in the plan):
> If a step contradicts its cited KD, or a cited file/symbol does not exist as described, follow the KD's intent and adapt the step. KDs outrank steps.

Also include **Out of scope** and **Verification**. A posted plan has no unresolved open questions.

### Phase 5 — Implementer review (adversarial pass)

1. Spawn a review subagent (`general` / `review`) with issue + draft plan + repo access.
2. Triage: ignore gaps closable by trivial search. Flag gaps needing detailed analysis.
3. Resolve each finding: **Address** (fix plan), **Refute** (reject with evidence), **Escalate** (new decision → back to Phase 3 as a question round).
4. Loop cap: max 10 rounds. On cap, escalate to user as questions.

### Phase 6 — Record in the issue

1. Post the full plan with header `## Plan with Reason` via `--body-file`.
2. Post-freeze: never silently edit. Supersede with a new comment (`Supersedes <link> — changed KD-2 because ...`). Append KDs (`KD-9`), mark retired as superseded, never renumber.
3. If superseding a prior plan, minimize the old plan comment(s) as OUTDATED (same mutation as Phase 3).
4. Mark ready:
   ```bash
   gh issue edit <N> --repo <owner/repo> --add-label "ready to implement" --remove-label "question"
   ```
5. Reply in chat with comment URL + 3-line summary. Do not start implementing — planning and implementing are separate tasks.

## Anti-patterns

- Asking for file paths, API shapes, or error text you can read.
- Re-deducing ADs from scratch instead of verifying cited `file:line`.
- Renumbering Q/AD/KD IDs after posting.
- Using gists or external stores for planning state.
- Posting duplicate Rounds when no new answers arrived.
- Minimizing human comments or anyone else's non-plan comments.
