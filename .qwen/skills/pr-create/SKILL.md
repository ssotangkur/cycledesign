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
- **Auto-parsing branch names** (e.g., `issue/41/*` → links to issue #41)
- **Prompting for issue linkage if not detected**
- **Adding issue linking keywords (Closes/Fixes/Resolves/Related to/Part of/Refs)**
- Updating the PR via GitHub MCP server tools

You don't need to craft descriptions or run gh commands manually.

## Issue Linking

The agent automatically:
1. **Parses branch names** for issue references (e.g., `issue/41/fix-login` → issue #41)
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

## PR Description Format

When linked to an issue, the PR description includes:

```markdown
## Summary
[Brief description of changes]

## Changes
- [List of key changes]

## Related Issues
Closes #41

## Verification
[Verification results if applicable]
```

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
