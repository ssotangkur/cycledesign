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

## Subagent Delegation Behavior

When `@issue-resolver` spawns subagents via the `agent` tool:

- **Separate conversation threads** are created with unique `prompt_ids`
- **@issue-coder** receives prompt_ids like `#issue-coder-{unique-suffix}`
- **@issue-verifier** receives prompt_ids like `#issue-verifier-{unique-suffix}`
- **Chat logs** show each delegation as a distinct entry, providing an audit trail

This architecture ensures:
1. **Isolation**: Each subagent operates in its own context
2. **Traceability**: Delegation is verifiable through chat log review
3. **Accountability**: Each agent's work is attributed to its unique prompt_id

To verify subagent spawning occurred, check that the chat log contains entries for each delegated task with distinct prompt_ids matching the expected patterns.
