# CycleDesign - Development Guide

## Development Workflow

1. **Start servers**: Run `npm run dev`
2. **Make changes** to code (server auto-restarts via nodemon)
3. **Run validations**: Execute `npm run validate` to run ESLint and Knip
4. **Test with @chrome-devtools** or `@ui-tester` to verify UI works
5. **Fix issues** based on feedback
6. **Repeat** until verified

---

## PR Validation Rule

**Always use the `gh` CLI to verify PR check status** - do not rely on local test results or agent reports alone.

```bash
gh pr checks <PR_NUMBER> --repo ssotangkur/cycledesign
```

This ensures you're checking the actual GitHub Actions status, not just local validation.

### Dev Server Commands

- `npm run dev` - Start all servers with logging
- `npm run dev:kill` - Kill this checkout's dev ports only (never touches sibling checkouts or E2E ports)
- `npm run dev:server` - Start server only
- `npm run dev:web` - Start web only
- Logs: `tmp/server.log` and `tmp/web.log`

### Ports (offset-aware)

Effective ports = `3000/3001/3002 + checkout offset (+ 50 for Playwright-owned servers)`.
Never hardcode `:3000`/`:3001`/`:3002` in commands — resolve this checkout's ports first:

```bash
node scripts/ports.cjs          # dev ports for this checkout
node scripts/ports.cjs --e2e    # Playwright-owned ports
```

- Each checkout has its own git-ignored `.ports.local.json` (`{ "offset": N }`, see `.ports.local.json.example`); `PORT_OFFSET` env overrides it.
- `npm run dev:e2e` and Playwright use isolated E2E ports — they never kill or reuse manual dev servers.
- Port conflict? Run `node scripts/check-ports.cjs` to name the owning process instead of killing blindly.

---

## Knip Configuration Rule

**Do not add files to `knip.json` ignore list without explicit user permission**.

When Knip reports unused files/exports:
1. First verify if the file is actually needed (search for imports/usages)
2. If unused, **delete the file** instead of adding it to the ignore list
3. Only add to ignore list if the file is intentionally kept for future use or has special runtime requirements

---

## Testing Workflow

After making UI changes, follow this testing pattern:

### 1. Quick Smoke Test
```
Delegate to @chrome-devtools:
"Navigate to this checkout's web port (run `node scripts/ports.cjs` first) and verify the page loads without errors"
```

### 2. Feature-Specific Testing
Use the appropriate skill for the feature:
- **Session features**: `/test-session-flow`
- **Chat interface**: Delegate to `@ui-tester`
- **Settings/config**: Manual testing with chrome-devtools

### 3. Complete User Flow Test
Always test complete flows, not just individual elements:
```
Example: Session CRUD Flow
1. Create session → Verify ID-based label
2. Send first message → Verify label updates to message content
3. Send follow-up → Verify label unchanged
4. Refresh page → Verify persistence
5. Delete session → Verify removal
```

### 4. Check for Errors
```bash
chrome-devtools_list_console_messages types=["error", "warn"]
```

### 5. Verify State Updates
For React state changes, verify:
- ✅ UI updates immediately (optimistic updates)
- ✅ Loading indicators during async operations
- ✅ Error messages on failure
- ✅ Success feedback on completion
- ✅ State persists after page refresh

---

## Sandbox Environment

If the user mentions they are in a sandbox environment, you MUST invoke the `sandbox` skill.

---

## Screenshot & Snapshot Rule

**All screenshots and snapshots from Chrome DevTools MCP or Playwright must be saved to the `tmp/` directory**.

The `tmp/` directory is already in `.gitignore`, so test artifacts won't be committed.

**Examples**:

**Chrome DevTools MCP**:
```
"Take a screenshot and save it to tmp/homepage-screenshot.png"
"Capture the current page state to tmp/login-flow-snapshot.png"
```

**Playwright** (use this checkout's web port from `node scripts/ports.cjs`):
```bash
npx playwright screenshot http://localhost:<web-port> tmp/page-screenshot.png
```

**Never save screenshots to the project root or tracked directories**.

---

## Project Structure

- `apps/web/` - React frontend (Vite + MUI)
- `apps/server/` - Node.js backend (Express + Vercel AI SDK)
- `.opencode/agents/` - Custom agent definitions
- `.cline/skills/` - Cline skills for project-specific guidance
- `docs/` - Project documentation

## Tech Stack

- **Frontend**: React 18, MUI, Vite, TypeScript
- **Backend**: Express, Vercel AI SDK, Qwen OAuth
- **LLM**: Qwen coder-model via OAuth Device Flow
- **Testing**: Chrome DevTools MCP

---

## Deployment

- Frontend (`apps/web`) and backend (`apps/server`) ship together from this repo; no client versioning or migration shims needed.
