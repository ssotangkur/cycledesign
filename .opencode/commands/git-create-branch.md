---
description: Create a new git branch with standardized naming (issue/number/description) for issue resolution
---

Load and follow the `git-create-branch` skill using the skill tool.

Input: $ARGUMENTS

Parse the input as `<issue-number-or-url> [kebab-case-description]`. If no issue reference was given, ask the user for the GitHub issue number or URL and do not proceed without it. If no description was given, auto-generate it from the issue title per the skill. Follow the skill workflow exactly, including worktree-safe branch creation (`git branch`, never `git checkout -b`).
