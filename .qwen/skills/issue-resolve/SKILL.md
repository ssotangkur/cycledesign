---
name: issue-resolve
description: Resolve GitHub issues. Use when user requests an issue to be resolved.
---

# Issue Resolution Skill

Triggers the automated issue resolution framework.

## Usage

```
Delegate to @issue-resolver:
"Resolve issue #123"
```

Or with a URL:

```
Delegate to @issue-resolver:
"Resolve https://github.com/ssotangkur/cycledesign/issues/123"
```

## What It Does

Delegates to `@issue-resolver` which:
- Reads the issue and extracts requirements
- Creates branch and PR
- Delegates implementation to `@issue-coder`
- Delegates verification to `@issue-verifier`
- Commits and pushes on success
