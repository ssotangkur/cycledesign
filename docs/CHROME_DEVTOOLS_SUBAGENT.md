# Chrome DevTools Subagent

## Overview

The `chrome-devtools` subagent is a specialized browser automation agent configured to use Chrome DevTools MCP with the Qwen vision-model.

## Configuration

Defined in `opencode.jsonc`:

```jsonc
{
  "agents": {
    "chrome-devtools": {
      "model": "qwen-code/vision-model",
      "description": "Browser automation and testing agent with Chrome DevTools MCP access",
      "tools": ["chrome-devtools"],
      "instructions": "..."
    }
  }
}
```

## Usage

### From opencode CLI

```bash
opencode run "Navigate to http://localhost:3000 and take a screenshot" --agent chrome-devtools
```

### From Task Tool

When using the `task` tool, specify the subagent:

```
task:
  description: "Test chat UI"
  subagent_type: "chrome-devtools"
  prompt: "Navigate to http://localhost:3000, create a session, send a message, verify response"
```

### From Another Agent

Agents can delegate browser automation tasks:

```
Use the chrome-devtools subagent to:
1. Navigate to the application
2. Test the login flow
3. Report any errors found
```

## Capabilities

| Capability | Tool | Example |
|------------|------|---------|
| Navigation | `chrome-devtools_navigate_page` | Load URLs |
| Screenshots | `chrome-devtools_take_screenshot` | Capture page state |
| Clicking | `chrome-devtools_click` | Interact with buttons |
| Typing | `chrome-devtools_fill` | Fill form fields |
| Keyboard | `chrome-devtools_press_key` | Press Enter, Tab, etc. |
| Inspection | `chrome-devtools_take_snapshot` | Get element UIDs |
| Console | `chrome-devtools_list_console_messages` | Check for errors |
| Network | `chrome-devtools_list_network_requests` | Monitor API calls |
| Waiting | `chrome-devtools_wait_for` | Wait for content |

## Example Tasks

### Test Page Load
```
Navigate to http://localhost:3000 and verify the page loads without errors
```

### Test User Flow
```
1. Navigate to http://localhost:3000
2. Click "New Session"
3. Fill "Test" in session name
4. Click "Create"
5. Type "Hello" in message input
6. Press Enter to send
7. Wait for response
8. Screenshot the conversation
```

### Debug Issues
```
1. Navigate to http://localhost:3000
2. Check console for JavaScript errors
3. Check network tab for failed requests
4. Report all errors with details
```

### Visual Regression
```
1. Navigate to http://localhost:3000
2. Take full page screenshot
3. Compare with baseline
4. Report visual differences
```

## Best Practices

1. **Wait for content**: Use `chrome-devtools_wait_for` before interacting with elements
2. **Take snapshots**: Use `chrome-devtools_take_snapshot` to get current element UIDs
3. **Error handling**: Always check console messages after interactions
4. **Network monitoring**: Check network requests for API failures
5. **Screenshots**: Capture state before/after critical actions

## Model Selection

The subagent uses `qwen-code/vision-model` which provides:
- Enhanced visual understanding of page layouts
- Better element identification from snapshots
- Improved screenshot analysis
- Context-aware interaction suggestions

## Troubleshooting

### Agent Not Found
Ensure `opencode.jsonc` is in the project root and contains the agent definition.

### MCP Not Connected
Run `opencode mcp list` to verify chrome-devtools shows as connected.

### Model Not Available
Verify you have access to `qwen-code/vision-model` in your opencode configuration.

### Browser Not Responding
Ensure Chrome is running with remote debugging:
```bash
chrome.exe --remote-debugging-port=9222
```

## See Also

- [Chrome DevTools MCP Setup](./CHROME_DEVTOOLS_MCP.md)
- [opencode Agent Documentation](https://opencode.ai/docs/agents/)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
