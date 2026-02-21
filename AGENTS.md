# CycleDesign - Development Guide

## Development Workflow

1. **Start servers**: Use `/dev-server` skill
2. **Make changes** to code
3. **Test with @chrome-devtools** to verify UI works
4. **Fix issues** based on feedback
5. **Repeat** until verified

---

## Project Structure

- `apps/web/` - React frontend (Vite + MUI)
- `apps/server/` - Node.js backend (Express + Vercel AI SDK)
- `.opencode/agents/` - Custom agent definitions
- `docs/` - Project documentation

## Tech Stack

- **Frontend**: React 18, MUI, Vite, TypeScript
- **Backend**: Express, Vercel AI SDK, Qwen OAuth
- **LLM**: Qwen coder-model via OAuth Device Flow
- **Testing**: Chrome DevTools MCP
