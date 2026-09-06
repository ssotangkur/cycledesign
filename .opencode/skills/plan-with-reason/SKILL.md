---
name: plan-with-reason
description: Create a resilient implementation plan for a GitHub issue via code research then grilling interview, recorded as Key Decisions with IDs.
---

## Purpose

Create an implementation plan for a specific GitHub issue where details are not fully fleshed out yet.

The plan must survive imperfect details. It is structured around **Key Decisions (KDs)** — the reasons behind the implementation steps — so an implementing agent can still deliver correct behavior even if it encounters inconsistencies or errors in the step-by-step details.

Based on the `grilling` skill (design tree + frontier + rounds), with two extensions:
1. **Research-first:** answer by reading code before asking the user.
2. **Reason-first plan:** every non-trivial step traces back to a KD id.

## Inputs

Require before starting:
- GitHub issue reference (owner/repo + issue number, or full URL). If missing, ask for it. Do not proceed on an assumed issue.
- Read the issue first via `gh issue view <number> --repo <owner/repo>` (body, labels, linked comments). Treat the issue as the source of truth for intent.

## Workflow

### Phase 1 — Anchor to the issue

1. Read the issue and restate in one paragraph: problem, desired outcome, explicit constraints.
2. If the issue is too vague to build a design tree from (no goal, no scope), say so and grill for scope first before any research.

### Phase 2 — Research-first (facts are your job)

For every open question, classify it as **fact** (answerable from repo/environment) or **decision** (requires user judgment):

- **Fact:** resolve it yourself. Search code (`glob`, `grep`, `read`), check configs, run read-only commands. Use a subagent (`explore` / `general`) for broad questions; do not block the rest of the work on it.
- **Decision:** never guess. It goes into the design tree for grilling.

Rules:
- Never ask the user for anything you could look up yourself.
- A running exploration is an unsettled prerequisite: questions downstream of it wait, independent questions proceed.
- Record research findings as candidate KDs or as context for grilling questions. Cite file paths (`path:line`) where relevant.

### Phase 3 — Grill (decisions are the user's)

Map remaining decisions as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask *now* without guessing at unanswered prerequisites. Ask the whole frontier in one round, then wait.

Format a round exactly like this:

```
❓ **Q1** - **<question title>**: <question body, may include multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, may include multiple choices>

➡️ <your recommended answer>
```

Rules:
- Number each question, give your recommended answer.
- Each round reshapes the tree: settled answers push the frontier outward. Recompute before the next round.
- A question depending on another still-open question belongs to a *later* round, not this one.
- Session is done when the frontier is empty: every branch visited, nothing silently assumed.
- Do not write the final plan until the user confirms shared understanding.

### Phase 4 — Synthesize the plan (Key Decisions + Steps)

Write the plan with two linked sections. IDs are stable (`KD-1`, `KD-2`, ...) and never reused or renumbered once shared.

#### A. Key Decisions

Each KD is the *reason*, not the *how*:

```
- **KD-1 — <short title>**: Decision: <what was decided>.
  Why: <reason, constraint, or trade-off that forces this>.
  Alternatives rejected: <what and why, 1 line>.
  Source: <issue requirement | research `file:line` | grilling Qn>.
```

Guidelines:
- 3–8 KDs for a typical issue. Fewer means you left reasoning implicit; more means you listed steps as decisions.
- A good KD answers "what would I do differently if this weren't true?"
- Include at least: scope boundary, architectural choice, data/contract choice, and verification criterion where applicable.

#### B. Implementation Steps

Ordered, checkable steps. Reference supporting KDs inline as `[KD-n]`. Not every step needs one — pure mechanics (run formatter, open PR) do not.

```
1. [KD-2] Do <concrete change> in `<file>` (~<lines/function>).
   - Detail: <exact behavior, flags, schema, API shape>.
   - Verify: <command or observable outcome>.
2. Do <mechanical step> (no KD needed).
```

Resilience contract (state this verbatim in the issue plan):
> If a step contradicts its cited KD, or a cited file/symbol does not exist as described, follow the KD's intent and adapt the step. KDs outrank steps.

Also include:
- **Out of scope:** explicit non-goals settled during grilling.
- **Verification:** end-to-end checks (commands, tests, manual flow).

Accepted risks and trade-offs belong inside their owning KD (Why / Alternatives rejected), not in a separate section. A posted plan has no unresolved open questions — anything load-bearing is a KD or an escalated grilling question.

### Phase 5 — Implementer review (adversarial pass)

Goal: the posted plan must read consistently and completely on first reading. Prefer spending more time in planning over rework after implementation.

1. Spawn a review subagent (`general` / `review`) with the issue + draft plan + repo access. Prompt as implementer viewpoint: does the plan have gaps? Is there contradictory information, plan-vs-plan or plan-vs-code (cite `file:line`)? Do the KDs let you fill remaining gaps, or are there load-bearing ambiguities that must be clarified before implementation?
2. Triage rule: ignore gaps closable by trivial code search (implementer can look those up). Flag gaps requiring detailed code analysis — those belong in the plan/steps, not left to perfect code reading.
3. Resolve each finding one of three ways:
   - **Address** — fix the plan/KD directly (fact or clear oversight).
   - **Refute** — reject with evidence (issue quote or `file:line`); reviewer drops it.
   - **Escalate** — new decision the grilling phase missed, or author/reviewer disagree. Bring it to the user as a frontier question; the answer becomes a KD with `Source: grilling Qn`. Escalate when the choice affects scope, cost, UX, or security and cannot be resolved from repo/issue alone.
4. Rewrite the draft freely until both agree it is good enough to implement. Draft KDs may be renumbered/rewritten — stability applies only after posting.
5. Loop cap: max 10 rounds to guard against ping-pong. On hitting the cap, escalate unresolved items to the user instead of looping.

### Phase 6 — Record in the issue

1. Post the full plan (sections A + B + contract above) to the GitHub issue via `gh issue comment <number> --repo <owner/repo> --body-file <tmpfile>` or `github_add_issue_comment`. Use a tmp file for long bodies.
2. Header the comment `## Plan with Reason` and include the KD list so future edits can reference stable IDs.
3. Post-freeze semantics: after posting, history is immutable. If a plan comment already exists, post a new comment noting what changed (`Supersedes <link> — changed KD-2 because ...`), never silently edit history. Append new KDs (`KD-9`), mark retired ones as superseded, never renumber shared IDs.
4. If your new comment supersedes a prior `## Plan with Reason` comment, minimize the old one(s) as outdated so the issue shows exactly one current plan. Match the old plan by its header in the `comments` payload (`gh issue view --json comments` gives an `id` per comment), then:
   ```bash
   gh api repos/<owner>/<repo>/issues/comments/<comment-id> --jq .node_id
   gh api graphql -f query='mutation($id:ID!,$classifier:ReportedContentClassifiers!){minimizeComment(input:{subjectId:$id,classifier:$classifier}){minimizedComment{isMinimized}}}' -f id='<node_id>' -f classifier=OUTDATED
   ```
   Only minimize superseded plan comments — never minimize human comments or other agents' non-plan comments. Minimized comments stay expandable; history is preserved.
5. Mark the issue ready: add the `ready to implement` label and remove `question` if present (removal is idempotent — safe when absent):
   ```bash
   gh issue edit <number> --repo <owner/repo> --add-label "ready to implement" --remove-label "question"
   ```
   Only when planning is done (frontier empty, plan posted).
6. Reply to the user with the comment URL and a 3-line summary. Do not start implementing until explicitly asked — planning and implementing are separate tasks.

## Example (abbreviated)

```
## Plan with Reason (for #42 — add session search)

**Key Decisions**
- **KD-1 — Server-side filtering**: Decision: filter in `GET /api/sessions`.
  Why: client holds only the active page; full list can exceed memory.
  Alternatives rejected: client-side filter (breaks on large histories).
  Source: research `apps/server/src/routes.ts:88`, grilling Q2.
- **KD-2 — Substring on label only**: Decision: match `label` substring, case-insensitive.
  Why: issue asks for quick recall, not full-text search.
  Alternatives rejected: FTS on messages (scope creep, Q3).
  Source: issue body + Q3.

**Steps**
1. [KD-1] Add `?q=` param to `GET /api/sessions` in `apps/server/src/routes.ts`.
   - Detail: `WHERE label ILIKE %q%`, empty `q` returns all.
   - Verify: `curl 'http://localhost:3001/api/sessions?q=demo'`.
2. Add search input to session dropdown (no KD — pure UI).

> If a step contradicts its cited KD, or a cited file/symbol does not exist as described, follow the KD's intent and adapt the step. KDs outrank steps.

**Out of scope:** message-body search, saved filters.
**Verification:** type query → list narrows; empty query → full list; refresh persists.
```

## Anti-patterns

- Asking the user for file paths, API shapes, or error text you can read.
- Writing steps without KDs when the *why* is non-obvious.
- Renumbering KDs after posting — append new ones (`KD-9`), mark retired ones as superseded.
- Recording the plan only in chat. The issue is the record.
