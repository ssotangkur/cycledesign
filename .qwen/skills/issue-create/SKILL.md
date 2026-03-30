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

## Technical Notes
[Any implementation hints, file paths, or constraints]
```

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
"
```
