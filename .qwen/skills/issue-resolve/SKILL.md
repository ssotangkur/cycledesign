---
name: issue-resolve
description: Resolve GitHub issues. Use when user requests an issue to be resolved using phrases like "resolve issue #X", "fix issue #X", "close issue #X with resolution", or provides an issue URL. Triggers the automated issue resolution framework.
---

# Issue Resolution Skill

Triggers the automated issue resolution framework when users request issue resolution.

## Trigger Patterns

This skill is activated when users make requests such as:

- "resolve issue #123"
- "fix issue #123"
- "close issue #123 with resolution"
- "resolve https://github.com/ssotangkur/cycledesign/issues/123"
- "fix https://github.com/ssotangkur/cycledesign/issues/123"
- "work on issue #123"
- "implement issue #123"

## Usage

When triggered, delegate to @issue-resolver:

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

Delegates to `@issue-resolver` which orchestrates the full resolution workflow:
- Reads the issue and extracts requirements (Goal, Purpose/Why, Acceptance Criteria)
- Creates branch following naming convention: `issue/{number}/{description}`
- Creates pull request linked to the issue
- Delegates implementation tasks to `@issue-coder`
- Delegates verification tasks to `@issue-verifier`
- Manages iterative fix cycles if verification fails
- Commits and pushes changes on successful verification
- Updates PR description with verification results

## When to Use

Use this skill when:
- User explicitly requests issue resolution (e.g., "resolve issue #X")
- User wants to fix a bug tracked in an issue
- User wants to implement a feature tracked in an issue
- User provides an issue URL and asks for it to be resolved

## Integration with Framework

This skill is the entry point to the issue resolution framework:

```
User Request → issue-resolve skill → @issue-resolver → @issue-coder + @issue-verifier → PR Created
```

## Example

```
User: "resolve issue #46"

Action: Delegate to @issue-resolver with the issue number
Result: Full automated resolution workflow begins
```
