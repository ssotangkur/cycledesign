# CycleDesign - Development Guide

## Development Workflow

1. **Start servers**: Use `/dev-server` skill
2. **Make changes** to code
3. **Test with @chrome-devtools** or `@ui-tester` to verify UI works
4. **Fix issues** based on feedback
5. **Repeat** until verified

---

## Testing Workflow

After making UI changes, follow this testing pattern:

### 1. Quick Smoke Test
```
Delegate to @chrome-devtools:
"Navigate to http://localhost:3000 and verify the page loads without errors"
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
