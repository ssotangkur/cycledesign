---
name: qwen
description: Read the latest Qwen Code documentation before any Qwen-related configuration or customization (skills, agents, MCP, LSP, settings, etc.)
---

# Qwen Code Documentation Reference

**Always read the latest Qwen Code documentation before attempting any Qwen-related configuration or customization.**

## Official Documentation URLs

- **Main Docs:** https://qwenlm.github.io/qwen-code-docs/en/users/overview
- **GitHub Repo:** https://github.com/QwenLM/qwen-code

## Key Documentation Topics

### 1. Skills Creation
**URL:** https://qwenlm.github.io/qwen-code-docs/en/users/features/skills

**Key Points:**
- Skills are **model-invoked** (not user-invoked like slash commands)
- Structure: `SKILL.md` + optional supporting files
- Locations:
  - Personal: `~/.qwen/skills/<skill-name>/`
  - Project: `.qwen/skills/<skill-name>/`
- SKILL.md format:
  ```markdown
  ---
  name: skill-name
  description: What it does and when to use it
  ---

  # Skill Name

  ## Instructions
  Step-by-step guidance.

  ## Examples
  Concrete usage examples.
  ```

### 2. MCP (Model Context Protocol) Configuration
**URL:** https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp

**Key Points:**
- Transport types: `http`, `sse`, `stdio`
- Configuration scopes:
  - Project: `.qwen/settings.json`
  - User: `~/.qwen/settings.json`
- CLI commands:
  ```bash
  qwen mcp add --transport http my-server http://localhost:3000/mcp
  qwen mcp list
  qwen mcp remove <name>
  ```
- Server config example (stdio):
  ```json
  {
    "mcpServers": {
      "pythonTools": {
        "command": "python",
        "args": ["-m", "my_mcp_server"],
        "cwd": "./mcp-servers/python",
        "env": { "API_KEY": "${EXTERNAL_API_KEY}" },
        "timeout": 15000
      }
    }
  }
  ```

### 3. Configuration & Settings
**URL:** https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings

**Key Points:**
- User settings: `~/.qwen/settings.json`
- Project settings: `.qwen/settings.json` (overrides user)
- Model providers configuration (OpenAI, Anthropic, Gemini-compatible)
- Environment variables via `env` field

### 4. Agents / SubAgents
- Built-in agentic workflows
- Terminal-first design with IDE integration
- Multi-protocol support

## Before Any Qwen Customization Task

1. **Fetch latest docs** using web_fetch from the URLs above
2. **Verify current conventions** by checking existing `.qwen/` or `~/.qwen/` directories
3. **Match the documented format** exactly (YAML frontmatter, file structure, etc.)
4. **Test** the configuration/skill after creation

## Common Tasks Checklist

### Creating a Skill
- [ ] Read https://qwenlm.github.io/qwen-code-docs/en/users/features/skills
- [ ] Create directory: `~/.qwen/skills/<name>/` or `.qwen/skills/<name>/`
- [ ] Create SKILL.md with valid YAML frontmatter (name, description required)
- [ ] Add optional supporting files if needed
- [ ] Test by asking relevant questions

### Adding MCP Server
- [ ] Read https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp
- [ ] Choose transport type (http/sse/stdio)
- [ ] Choose scope (user/project)
- [ ] Use CLI: `qwen mcp add [options] <name> <commandOrUrl>`
- [ ] Or edit settings.json directly
- [ ] Restart Qwen Code

### Configuration Changes
- [ ] Read settings documentation
- [ ] Determine scope (user vs project)
- [ ] Validate JSON syntax
- [ ] Restart Qwen Code if needed

## Troubleshooting

| Issue | Check |
|-------|-------|
| Skill not activating | Description too vague; add trigger keywords |
| YAML errors | Verify frontmatter syntax (--- delimiters, no tabs) |
| MCP server disconnected | Verify URL/command, increase timeout |
| Config not loading | Check JSON syntax, restart Qwen Code |
