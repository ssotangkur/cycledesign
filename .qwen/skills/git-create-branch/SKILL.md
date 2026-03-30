---
name: git-create-branch
description: Create a new git branch with standardized naming convention for issue resolution
---

# Git Create Branch Skill

Creates a new git branch following the standardized naming convention for issue resolution workflows.

## Branch Naming Convention

```
issue/{issue-number}/{kebab-case-description}
```

**Examples:**
- `issue/41/issue-processing-framework`
- `issue/37/fix-login-button-disable`
- `issue/42/add-user-authentication`

## Usage

```bash
git-create-branch issueNumber=41 description="issue-processing-framework"
```

Or with the skill syntax:

```
Delegate to @git-create-branch:
"Create branch for issue #41 with description 'issue-processing-framework'"
```

## Parameters

- `issueNumber` (required): The GitHub issue number or URL (e.g., `41` or `https://github.com/ssotangkur/cycledesign/issues/41`)
- `description` (optional): Kebab-case description of the work. If not provided, auto-generated from issue title

## What It Does

1. **Fetches latest main** from origin (without checkout - worktree-safe)
2. **Auto-generates description** from issue title if not provided
3. **Creates branch** from `origin/main` with format: `issue/{issue-number}/{description}`
4. **Pushes branch** to origin and sets upstream tracking
5. **Returns the branch name** for use by other agents

## Implementation

```bash
# Fetch latest origin/main (worktree-safe - no checkout needed)
git fetch origin main

# Create branch directly from origin/main reference (no checkout required)
git branch issue/{issueNumber}/{description} origin/main

# Set upstream and push
git push -u origin issue/{issueNumber}/{description}
```

### Auto-Generating Description from Issue Title

If `description` is not provided:

1. **Fetch issue via GitHub MCP**:
   ```
   mcp__github__issue_read method="get" owner="ssotangkur" repo="cycledesign" issue_number={issueNumber}
   ```

2. **Extract and convert title to kebab-case**:
   ```
   Title: "Fix login button not disabling during submission"
   → kebab-case: "fix-login-button-not-disabling"
   ```

3. **Use generated description** for branch name

## Authentication

In sandbox environments, this skill uses `GH_TOKEN` for authentication:

```bash
git remote set-url origin https://$GH_TOKEN@github.com/ssotangkur/cycledesign.git
```

## Example Flows

### With Explicit Description

```
Input: issueNumber=41, description="issue-processing-framework"

Steps:
1. git fetch origin main
2. git branch issue/41/issue-processing-framework origin/main
3. git push -u origin issue/41/issue-processing-framework

Output: Branch 'issue/41/issue-processing-framework' created and pushed
```

### With Issue URL Only (Auto-Generate Description)

```
Input: "Create branch for https://github.com/ssotangkur/cycledesign/issues/37"

Steps:
1. Extract issue number: 37
2. Read issue #37 via GitHub MCP
3. Get title: "Fix login button not disabling"
4. Convert to kebab-case: "fix-login-button-not-disabling"
5. git fetch origin main
6. git branch issue/37/fix-login-button-not-disabling origin/main
7. git push -u origin issue/37/fix-login-button-not-disabling

Output: Branch 'issue/37/fix-login-button-not-disabling' created and pushed
```

### With Issue Number Only (Auto-Generate Description)

```
Input: "Create branch for issue #41"

Steps:
1. Read issue #41 via GitHub MCP
2. Get title: "Create issue processing framework"
3. Convert to kebab-case: "create-issue-processing-framework"
4. git fetch origin main
5. git branch issue/41/create-issue-processing-framework origin/main
6. git push -u origin issue/41/create-issue-processing-framework

Output: Branch 'issue/41/create-issue-processing-framework' created and pushed
```

## Error Handling

- **Branch already exists**: Returns error with suggestion to use different description
- **Invalid issue number**: Returns error (issue number must be numeric)
- **Issue not found**: Returns error if GitHub MCP can't fetch the issue
- **Authentication failure**: Uses GH_TOKEN fallback
- **Network errors**: Retries once before failing

## Worktree-Safe Branch Creation

**Important:** This skill uses `git branch <name> <ref>` instead of `git checkout -b <name> <ref>` to avoid checking out `main`:

```bash
# Worktree-safe (used by this skill)
git branch issue/41/description origin/main

# NOT used (would conflict with other worktrees)
git checkout -b issue/41/description origin/main
```

This allows branch creation even when `main` is checked out in another worktree.
