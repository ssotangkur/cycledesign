---
name: issue-create
description: Create structured GitHub issues with Purpose/Why section for framework consumption
---

# Issue Creation Skill

Creates GitHub issues in a structured, framework-consumable format that captures both **what** needs to be done and **why** it matters.

## Usage

```
Delegate to @issue-create:
"Create a new issue with the following details..."
```

Or when using the issue resolution framework, issues should already be in this format.

## Template Structure

All issues created by this skill follow this template:

```markdown
## Goal
[Describe what needs to be accomplished. Can be multiple sentences or paragraphs.
Be specific about the desired outcome.]

## Purpose/Why
[Explain WHY this issue matters. What problem does this solve? What user pain
point does this address? What business goal does this support? This helps
implementers understand the intent behind the requirements.]

## Acceptance Criteria
- [ ] Criterion 1 (testable)
- [ ] Criterion 2 (testable)
- [ ] Criterion 3 (testable)

## Scope
**In:** What this issue covers
**Out:** What is explicitly excluded

## Open Questions
- [ ] Question 1 (implementer discretion / needs clarification)
- [ ] Question 2 (implementer discretion / needs clarification)

## Technical Notes
[Expected behavior, files involved, constraints - NO implementation code]
```

## Core Principle: Outcomes Over Implementation

**This skill explicitly focuses on outcomes and input/output criteria, never prescribing implementation details.**

The issue resolution framework works best when issues clearly state **what** needs to be accomplished and **why**, leaving the **how** to ISSUE-RESOLVER and the implementer.

### What to Include

✅ **DO include:**
- Clear outcome statements in the Goal
- Testable acceptance criteria (input → expected output)
- Expected behavior descriptions
- Files that may be affected
- Constraints and requirements
- Open questions for implementer discretion or clarification

❌ **DO NOT include:**
- Code snippets or implementation examples
- Specific function names or class structures
- Step-by-step implementation instructions
- Algorithm prescriptions
- Library recommendations (unless it's a constraint)

### Technical Notes Guidance

The **Technical Notes** section should describe **expected behavior**, not specific code:

**✅ Good Technical Notes:**
```markdown
## Technical Notes

### Expected Behavior

**When `.env.sandbox` exists:**
- Scripts load port configuration from the file
- Sandbox binds to the specified host ports
- Startup output shows the configured ports

**When `.env.sandbox` does not exist:**
- Scripts use default ports (backward compatible)
- Behavior matches current implementation

### Files to Update
- `scripts/sandbox-start.ps1` - Windows launcher
- `scripts/sandbox-start.sh` - Linux/macOS launcher
```

**❌ Bad Technical Notes:**
```markdown
## Technical Notes
Update scripts/sandbox-start.ps1:
```powershell
$envSandboxPath = Join-Path $PSScriptRoot "..\.qwen\.env.sandbox"
if (Test-Path $envSandboxPath) {
    Get-Content $envSandboxPath | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            Set-Item -Force -Path "ENV:$($matches[1])" -Value $matches[2]
        }
    }
}
```
```

## Open Questions Section

The **Open Questions** section provides a structured way to capture unresolved decisions, making it clear to implementers where they have discretion vs where clarification may be needed.

### When to Use

- Multiple valid approaches exist and you want implementer input
- You're unsure about edge cases or requirements
- A decision depends on research or experimentation
- You want to surface assumptions for verification

### How to Format

```markdown
## Open Questions
- [ ] Should we support X use case? (implementer discretion)
- [ ] What happens when Y occurs? (needs clarification)
- [ ] Should this integrate with Z or remain separate? (implementer discretion)
```

### Labels

- `(implementer discretion)` - Implementer can decide based on their analysis
- `(needs clarification)` - Issue author or team needs to provide answer

## Example Comparison

### ❌ Implementation-focused (bad)

```markdown
## Goal
Update sandbox scripts to read port configuration from .env.sandbox file

## Technical Notes
Update scripts/sandbox-start.ps1:
```powershell
$envSandboxPath = Join-Path $PSScriptRoot "..\.qwen\.env.sandbox"
if (Test-Path $envSandboxPath) {
    Get-Content $envSandboxPath | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            Set-Item -Force -Path "ENV:$($matches[1])" -Value $matches[2]
        }
    }
}
```

Then do the same for scripts/sandbox-start.sh using `export $(grep -v '^#' | xargs)`
```

**Problems:**
- Prescribes exact implementation code
- Doesn't explain expected behavior
- Leaves no room for implementer creativity
- May not account for edge cases the author didn't consider

### ✅ Outcome-focused (good)

```markdown
## Goal
Enable sandbox scripts to load port configuration from `.env.sandbox` file

## Purpose/Why
Developers need to configure custom port mappings for sandbox environments to avoid port conflicts with other services.

## Acceptance Criteria
- [ ] When `.env.sandbox` exists, ports are loaded from the file
- [ ] When `.env.sandbox` does not exist, default ports are used (backward compatible)
- [ ] Startup output displays the configured ports
- [ ] Port conflicts are detected and reported

## Open Questions
- [ ] Should we validate all three ports or just one? (implementer discretion)
- [ ] Should port conflicts fail immediately or warn and auto-increment? (needs clarification)

## Technical Notes

### Expected Behavior

**When `.env.sandbox` exists:**
- Scripts load port configuration from the file
- Sandbox binds to the specified host ports
- Startup output shows the configured ports

**When `.env.sandbox` does not exist:**
- Scripts use default ports (backward compatible)
- Behavior matches current implementation

### Files to Update
- `scripts/sandbox-start.ps1` - Windows launcher
- `scripts/sandbox-start.sh` - Linux/macOS launcher
```

**Benefits:**
- Clearly states the desired outcome
- Describes expected behavior for different scenarios
- Provides testable acceptance criteria
- Surfaces open questions for implementer/author resolution
- Leaves implementation approach to the implementer

## Why Purpose/Why Matters

The **Purpose/Why** section is critical for the issue resolution framework:

- **ISSUE-CODER** uses it to understand the intent behind requirements
- **ISSUE-VERIFIER** uses it to validate the solution addresses the actual problem
- Distinguishes between:
  - **Technically correct implementations** (meets all criteria but misses the point)
  - **Intent-aligned implementations** (solves the actual problem)

**Example:**

```markdown
## Goal
Add a disabled state to the login button during form submission.

## Purpose/Why
Users have been reporting multiple accidental form submissions because the
button remains clickable while the request is in progress. This causes:
- Duplicate accounts being created
- Confusion about whether submission worked
- Unnecessary server load

The intent is to provide clear feedback that "your submission is being processed"
and prevent accidental double-submissions.

## Acceptance Criteria
- [ ] Button is disabled immediately after user clicks submit
- [ ] Button shows loading indicator while disabled
- [ ] Button re-enables if submission fails with error message
```

## When to Use

- Creating new issues that will be resolved by the framework
- Converting bug reports into structured issues
- Creating epics with clear sub-issue structure
- When you want clear, testable acceptance criteria

## Integration with Framework

The `issue-create` skill ensures issues are:

1. **Parseable**: ISSUE-RESOLVER can extract tasks programmatically
2. **Intent-aware**: Purpose/Why section guides implementation decisions
3. **Testable**: Acceptance criteria are verifiable by ISSUE-VERIFIER
4. **Scoped**: Clear boundaries prevent scope creep

## Example Usage

```
Delegate to @issue-create:
"Create an issue for adding dark mode toggle to settings

Goal: Add a dark mode toggle in the settings page
Purpose: Users want to reduce eye strain when using the app at night
Acceptance Criteria:
  - Toggle switches between light and dark themes
  - Preference persists across sessions
  - Default to system preference on first load
Scope:
  In: Settings page toggle, theme persistence
  Out: Per-page themes, auto-switching based on time
Open Questions:
  - Should the toggle show a preview of the theme? (implementer discretion)
Technical Notes:
  Expected Behavior:
  - Toggle in settings page switches between light/dark modes
  - Selected theme persists in user preferences
  - First-time users get system preference by default
  Files:
  - apps/web/src/components/Settings/ThemeSettings.tsx
"
```
