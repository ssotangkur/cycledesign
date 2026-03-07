---
name: cline
description: Use when creating or modifying Cline skills, rules, workflows, hooks, or any automation files. Always check docs.cline.bot for the latest official format and capabilities.
---

# Cline Skill Development

Always check https://docs.cline.bot for the latest official documentation before making any changes to Cline-related files.

## Best Practices

- **Check documentation first** - Format and capabilities may change; always verify the latest at docs.cline.bot/customization/skills
- **Keep SKILL.md under 5k tokens** - Put important information first; Cline reads sequentially
- **Write actionable descriptions** - Describe when to use the skill and what it does, not vague intentions
- **Use clear section headers** - Helps Cline scan for relevant sections
- **Reference supporting files** - Use docs/ subdirectory for detailed content rather than bloating SKILL.md
- **Include real examples** - Show actual commands and expected output, not abstract instructions
- **Version control project skills** - Store in .cline/skills/ to share with your team
