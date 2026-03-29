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

## What It Does

The `pr-creator` subagent handles:
- Analyzing net changes and understanding intent
- Writing comprehensive PR descriptions
- **Auto-detecting issue references from commit messages**
- **Prompting for issue linkage if not detected**
- **Adding issue linking keywords (Closes/Fixes/Resolves/Related to/Part of/Refs)**
- Updating the PR via `gh api`

You don't need to craft descriptions or run gh commands manually.

## Issue Linking

The agent automatically:
1. Scans commit messages for issue references (e.g., "Closes #123")
2. Extracts issue numbers and determines appropriate keywords
3. Adds a "Related Issues" section to the PR description
4. Prompts you for issue linkage if none is detected

**Supported keywords:**
- `Closes` - PR fully resolves the issue
- `Fixes` - Bug fixes
- `Resolves` - Alternative to Closes
- `Part of` - PR is part of a larger issue/epic
- `Related to` - Tangentially related issues
- `Refs` - References without implying resolution

## When to Use

- After completing a feature branch
- When PR description needs improvement
- Before requesting PR review
- When you want to link PRs to GitHub issues

## Example

```
Delegate to @pr-creator:
"Update PR #33 with a comprehensive description based on the net changes"
```
