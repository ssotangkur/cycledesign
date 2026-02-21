# CycleDesign - Browser Testing Agent Instructions

## Chrome DevTools Subagent

This project has a specialized subagent `@chrome-devtools` for browser automation and UI testing.

### When to Use @chrome-devtools

Use the `@chrome-devtools` subagent when you need to:

1. **Test UI changes** - After implementing frontend features, verify they work in the browser
2. **Debug visual issues** - Check what's actually rendered vs expected
3. **Validate user flows** - Test complete user interactions (click, type, submit, etc.)
4. **Capture screenshots** - Document UI state for debugging or documentation
5. **Check console errors** - Identify JavaScript errors in the running application
6. **Monitor network requests** - Verify API calls are made correctly
7. **Test responsiveness** - Check UI at different viewport sizes

### How to Invoke

**In your messages, @ mention the agent:**

```
@chrome-devtools Navigate to http://localhost:3000 and verify the chat UI works
```

**Or delegate via task:**

```
@chrome-devtools Please test the full chat flow:
1. Create a new session
2. Send a message
3. Verify the LLM response appears
4. Report any errors
```

### Example Workflows

#### After Frontend Changes
```
@chrome-devtools I just updated the chat component. Please:
1. Navigate to http://localhost:3000
2. Create a session
3. Send "test"
4. Verify response appears
5. Screenshot the conversation
```

#### Debugging Issues
```
@chrome-devtools Users report the send button doesn't work. Please:
1. Navigate to http://localhost:3000
2. Try to send a message
3. Check console for errors
4. Check network tab for failed requests
5. Report findings
```

#### Visual Regression
```
@chrome-devtools Take a screenshot of the main chat page after creating a session named "Test"
```

### Available Tools

The chrome-devtools agent has access to:
- `chrome-devtools_navigate_page` - Load URLs
- `chrome-devtools_take_screenshot` - Capture screenshots
- `chrome-devtools_click` - Click elements
- `chrome-devtools_fill` - Fill form fields
- `chrome-devtools_press_key` - Press keyboard keys
- `chrome-devtools_take_snapshot` - Inspect page structure
- `chrome-devtools_list_console_messages` - Check console errors
- `chrome-devtools_list_network_requests` - Monitor network
- `chrome-devtools_wait_for` - Wait for content

### Model

The agent uses `qwen-code/vision-model` for enhanced visual understanding of web pages.

---

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
