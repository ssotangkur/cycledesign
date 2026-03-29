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

The `pr-creator` subagent handles:
- Analyzing net changes and understanding intent
- Writing comprehensive PR descriptions
- Updating the PR via `gh api`

You don't need to craft descriptions or run gh commands manually.

## When to Use

- After completing a feature branch
- When PR description needs improvement
- Before requesting PR review

## Example

```
Delegate to @pr-creator:
"Update PR #33 with a comprehensive description based on the net changes"
```
