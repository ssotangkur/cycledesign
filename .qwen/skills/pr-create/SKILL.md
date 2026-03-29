---
name: pr-create
description: Delegate PR creation/updates to the pr-creator subagent for comprehensive descriptions
---

# PR Creation Skill

When creating or updating pull requests, delegate to the `pr-creator` subagent.

## Usage

```
Delegate to @pr-creator:
"Create/update PR #<number> with a comprehensive description"
```

## What It Does

The `pr-creator` subagent will:
1. Analyze net changes (branch vs. main)
2. Understand the overall intent
3. Create structured PR description with:
   - **Summary** (Background & Change Overview)
   - **Change Description** (grouped by related changes)
   - **Impact table** (before/after comparison)
   - **Testing checklist**
   - **Related files** table
4. Use `gh api` to update the PR
5. Verify the update was successful

## When to Use

- After completing a feature branch
- When PR description needs improvement
- Before requesting PR review

## Example

```
Delegate to @pr-creator:
"Update PR #33 with a comprehensive description based on the net changes"
```
