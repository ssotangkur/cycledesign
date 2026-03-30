---
name: issue-resolve
description: Resolve GitHub issues automatically using the issue resolution framework
---

# Issue Resolution Skill

Triggers the automated issue resolution framework to resolve GitHub issues with minimal user intervention.

## Usage

```
Delegate to @issue-resolver:
"Resolve issue #123"
```

Or with a full URL:

```
Delegate to @issue-resolver:
"Resolve issue https://github.com/ssotangkur/cycledesign/issues/123"
```

## What It Does

The `@issue-resolver` agent handles:
1. **Reading the issue** - Extracts goal, purpose/why, acceptance criteria
2. **Creating branch** - Uses `issue/{number}/{description}` naming convention
3. **Creating PR** - Auto-linked to the issue
4. **Breaking into tasks** - Decomposes work into verifiable tasks
5. **Delegating implementation** - Spawns `@issue-coder` for each task
6. **Delegating verification** - Spawns `@issue-verifier` to validate work
7. **Handling fixes** - Re-delegates if verification fails
8. **Finalizing PR** - Updates description, commits, and pushes

## Workflow

```
User: "Resolve issue #123"
     ↓
@issue-resolver reads issue #123
     ↓
Creates branch: issue/123/{auto-generated-description}
     ↓
Creates PR (auto-linked to issue #123)
     ↓
Breaks work into tasks
     ↓
For each task:
  → @issue-coder implements
  → @issue-verifier validates
  → Fix if needed
     ↓
Final verification
     ↓
Update PR, commit, push
     ↓
Report completion to user
```

## When to Use

- You want to resolve a GitHub issue automatically
- The issue has clear acceptance criteria
- The issue includes a "Purpose/Why" section (or you can provide context)
- You're okay with AI-generated code that will need human review

## When NOT to Use

- Issue is vague or lacks clear requirements
- Issue requires significant architectural decisions
- Issue involves sensitive operations (database migrations, security changes)
- You want full control over the implementation approach

## Example Session

```
User: "Resolve issue #37"

@issue-resolver:
1. Reads issue #37
   - Goal: "Fix login button not disabling during submission"
   - Purpose: "Users report accidental double-submissions"
   - Acceptance Criteria: Button disables, shows loading, re-enables on error

2. Creates branch: issue/37/fix-login-button-not-disabling

3. Creates PR #38 linked to issue #37

4. Breaks into tasks:
   - Task 1: Add isLoading state to LoginForm
   - Task 2: Disable button when isLoading
   - Task 3: Add loading indicator

5. For each task:
   - Delegates to @issue-coder
   - Delegates to @issue-verifier
   - Handles any fix requests

6. Final verification passes

7. Updates PR description, commits, pushes

8. Reports: "✅ Issue #37 resolved. PR #38: [url]"
```

## Related Agents

- `@issue-coder`: Implementation specialist (spawned by issue-resolver)
- `@issue-verifier`: Verification specialist (spawned by issue-resolver)

## Related Skills

- `git-create-branch`: Creates branches (used internally by issue-resolver)
- `pr-create`: Creates PRs (used internally by issue-resolver)
- `issue-create`: Creates structured issues (for creating issues the framework can resolve)
