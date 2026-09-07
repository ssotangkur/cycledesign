---
name: pr-create
description: Delegate PR creation/updates to the pr-creator subagent for comprehensive descriptions with automatic issue linking
---

# PR Creation Skill

When creating or updating pull requests, delegate to the `pr-creator` subagent.

## Usage

```
Delegate to @pr-creator:
"Create/update PR #<number> with a comprehensive description"
```

Or via command:

```
/pr-create [#<number> | <branch-name>]
```

## What It Does

The `pr-creator` subagent handles:
- Analyzing net changes and understanding intent
- Writing comprehensive PR descriptions (Summary structured via the `pp` skill)
- **Auto-detecting issue references from branch names and commit messages**
- **Prompting for issue linkage if not detected**
- **Adding issue linking keywords (Closes/Fixes/Resolves/Related to/Part of/Refs)**
- Creating/updating the PR via `gh` CLI and verifying the result

You don't need to craft descriptions or run gh commands manually.

## Issue Linking

The agent automatically:
1. **Parses branch names** for issue references (e.g., `issue/41/fix-login` → issue #41, default keyword `Closes`)
2. Scans commit messages for issue references (e.g., "Closes #123")
3. Extracts issue numbers and determines appropriate keywords
4. Adds a "Related Issues" section to the PR description
5. Prompts you for issue linkage if none is detected

**Branch Name Parsing:**
```
issue/{number}/* → Links to issue #{number}
Examples:
  issue/41/issue-processing-framework → Issue #41
  issue/37/fix-login-button → Issue #37
```

**Supported keywords:**
- `Closes` - PR fully resolves the issue (default for branch-parsed issues)
- `Fixes` - Bug fixes
- `Resolves` - Alternative to Closes
- `Part of` - PR is part of a larger issue/epic
- `Related to` - Tangentially related issues
- `Refs` - References without implying resolution

**Closes vs partial decision rule:**
- Use `Closes`/`Fixes`/`Resolves` only when the PR completes every acceptance item on the linked issue.
- Use `Part of #<orig>` + `Refs #<followup>` when the PR lands only part of the issue and the remainder moves to a followup issue. The followup number must exist before merge (create it first if missing).
- Partial footer form:
  ```markdown
  ## Related Issues
  Part of #<orig>
  Refs #<followup> (<what stays open there>)
  ```
- Partial case requires the orchestrator (`resolve-issue` Phase 4, canonical owner) to post a status comment on the original issue at PR-ready time — see the forward template below. Canonical template lives in `resolve-issue` Phase 4 — keep this mirror in sync.

**Partial status comment template (mirror of canonical):**
```markdown
Partial completion pending merge of #<PR> (head <SHA> at PR-ready; merge SHA will differ).
Landed: <1-3 bullets>.
Remaining: <acceptance items> → tracked in #<followup>.
```

**`pr-creator` return contract (for `resolve-issue` Phase 4 keyword test):**
```text
status: DONE|BLOCKED
pr_url: <full PR URL>
pr_number: <number>
footer_keywords: <list of Related-Issues keywords used, e.g. [Part of, Refs]>
partial: <true if the footer uses Part of|Refs|Related to instead of Closes|Fixes|Resolves, else false>
followup: <#N of the followup issue when partial, else none>
blocked_reason: <only if BLOCKED>
```

## PR Description Format

When linked to an issue, the PR description includes:

```markdown
## Summary

### Background
[1-2 sentences on problem/context]

### Change Overview
[Answer first per the `pp` skill, then MECE supporting bullets]

## Change Description
[Grouped changes with file paths and rationale]

## Impact
[Before/after table]

## Testing
[Specific verifications]

## Related Files
[File table + net line counts]

## Related Issues
Closes #41

## Open Review Notes (for human reviewer)
[ findings passed in by the caller (e.g. wrap-up `unresolved_findings`), verbatim — or `None — all review findings addressed.` Never drop this section when asked to include it. ]
```

The Summary section follows the `pp` skill (Pyramid Principle): conclusion first, supporting bullets grouped MECE. The sections below it serve as evidence.

## When to Use

- After completing a feature branch
- When PR description needs improvement
- Before requesting PR review
- When you want to link PRs to GitHub issues
- **After using `git-create-branch` skill** (automatic linkage)

## Example

```
Delegate to @pr-creator:
"Update PR #33 with a comprehensive description based on the net changes"
```

## Integration with Issue Resolution Framework

When used as part of the automated issue resolution framework:
- Branch name is parsed to extract issue number
- PR description is updated as tasks complete
- Final verification results are posted to the PR
- Issue is automatically linked with "Closes" keyword
