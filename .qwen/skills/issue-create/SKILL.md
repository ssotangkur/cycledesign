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

### Section-by-Section Guidance

#### Goal

Describe the desired outcome in clear, specific terms. Can be multiple sentences or paragraphs.

**Good:** "Enable sandbox scripts to load port configuration from `.env.sandbox` file"
**Bad:** "Update sandbox-start.ps1 to read .env.sandbox"

#### Purpose/Why

Explain WHY this issue matters. This section is critical for the issue resolution framework:

- **ISSUE-CODER** uses it to understand the intent behind requirements
- **ISSUE-VERIFIER** uses it to validate the solution addresses the actual problem
- Distinguishes between technically correct vs intent-aligned implementations

Include:
- What problem this solves
- What user pain point this addresses
- What business goal this supports

**Example:**
```markdown
## Purpose/Why
Users have been reporting multiple accidental form submissions because the
button remains clickable while the request is in progress. This causes:
- Duplicate accounts being created
- Confusion about whether submission worked
- Unnecessary server load

The intent is to provide clear feedback that "your submission is being processed"
and prevent accidental double-submissions.
```

#### Acceptance Criteria

List testable criteria that define when the issue is complete. Each criterion should be verifiable by ISSUE-VERIFIER.

Format: `- [ ] Criterion (testable)`

#### Scope

Clearly define boundaries to prevent scope creep:

- **In:** What this issue covers
- **Out:** What is explicitly excluded

#### Open Questions

Capture unresolved decisions, making it clear where implementers have discretion vs where clarification is needed.

**When to use:**
- Multiple valid approaches exist and you want implementer input
- You're unsure about edge cases or requirements
- A decision depends on research or experimentation
- You want to surface assumptions for verification

**How to format:**
```markdown
## Open Questions
- [ ] Should we support X use case? (implementer discretion)
- [ ] What happens when Y occurs? (needs clarification)
- [ ] Should this integrate with Z or remain separate? (implementer discretion)
```

**Labels:**
- `(implementer discretion)` - Implementer can decide based on their analysis
- `(needs clarification)` - Issue author or team needs to provide answer

#### Technical Notes

Describe **expected behavior**, not specific code. Include:

- Expected behavior for different scenarios
- Files that may be affected
- Constraints and requirements

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
