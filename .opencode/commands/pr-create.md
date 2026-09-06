---
description: Create/update a PR with comprehensive description and automatic issue linking via pr-creator
---

Load the `pr-create` skill and follow it. Delegate the work to the `pr-creator` subagent.

Target: $ARGUMENTS

If no PR number or branch was given, use the current branch's net changes vs `origin/main`. Follow the skill workflow exactly, including issue-linkage detection and `gh` verification.
