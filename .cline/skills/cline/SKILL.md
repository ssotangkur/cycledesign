---
name: cline
description: Use when working with CycleDesign codebase, building features, fixing bugs, or any development tasks. This skill provides context about the project structure, development workflow, and testing patterns specific to this codebase.
---

# CycleDesign Development

This skill provides guidance for working with the CycleDesign project.

## Project Structure

- `apps/web/` - React frontend (Vite + MUI)
- `apps/server/` - Node.js backend (Express + Vercel AI SDK)
- `.cline/skills/` - Custom Cline skills
- `docs/` - Project documentation

## Development Commands

- `npm run dev` - Start all development servers
- `npm run dev:server` - Start server only
- `npm run dev:web` - Start web only
- `npm run dev:kill` - Kill processes on ports 3000/3001/3002
- `npm run validate` - Run ESLint and Knip validation

## Testing Workflow

After making UI changes:

1. Quick Smoke Test - Navigate to http://localhost:3000 and verify the page loads
2. Feature-specific testing using Chrome DevTools MCP
3. Check for console errors
4. Verify state updates for React changes

## Key Patterns

- Sessions use tRPC for API communication (not REST)
- SessionContext manages all session state
- WebSocket handles real-time messaging
- Sessions auto-name based on first message content
