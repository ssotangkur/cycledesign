# Chrome DevTools MCP Setup for CycleDesign

## Overview

This project is configured to use Chrome DevTools MCP server with opencode, enabling AI-assisted debugging and browser automation.

## Prerequisites

1. **Install opencode** (if not already installed):
   ```bash
   npm install -g opencode
   ```

2. **Install Chrome DevTools MCP server**:
   ```bash
   npm install -g @chrome-devtools/mcp-server
   ```

## Setup Instructions

### 1. Start Chrome with Remote Debugging

**Windows:**
```bash
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\chrome-debug-profile"
```

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug-profile"
```

**Linux:**
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="/tmp/chrome-debug-profile"
```

> **Note:** Using a separate `--user-data-dir` prevents conflicts with your main Chrome profile.

### 2. Verify opencode Configuration

The `opencode.jsonc` file in the project root already includes:
- Chrome DevTools MCP server configuration
- Qwen Code OAuth provider (coder-model and vision-model)

### 3. Start opencode

```bash
cd D:\Projects\cycledesign
opencode
```

### 4. Verify MCP Connection

In opencode, run:
```
/mcp
```

You should see `chrome-devtools` listed as a connected MCP server.

## Available Chrome DevTools MCP Tools

Once connected, you can use tools like:

- **`chrome_navigate`** - Navigate to a URL
- **`chrome_screenshot`** - Take a screenshot of the current page
- **`chrome_click`** - Click an element
- **`chrome_fill`** - Fill in a form field
- **`chrome_evaluate`** - Execute JavaScript in the browser context
- **`chrome_get_html`** - Get the current page HTML
- **`chrome_console`** - Get console logs
- **`chrome_network`** - Get network request information

## Example Usage

```
opencode> Navigate to http://localhost:3000 and take a screenshot
opencode> Fill in the email field with "test@example.com" and click the submit button
opencode> What JavaScript errors are in the console?
opencode> Get all network requests that failed
```

## Testing the Setup

1. **Start CycleDesign dev server:**
   ```bash
   npm run dev
   ```

2. **Start Chrome with remote debugging** (see above)

3. **Navigate to the app:**
   ```
   opencode> Navigate to http://localhost:3000
   ```

4. **Take a screenshot:**
   ```
   opencode> Take a screenshot of the current page
   ```

5. **Check for console errors:**
   ```
   opencode> Are there any console errors?
   ```

## Troubleshooting

### Chrome DevTools MCP Not Connecting

**Check Chrome is running with remote debugging:**
```bash
curl http://localhost:9222/json/version
```

Should return Chrome version info. If not, Chrome isn't running with `--remote-debugging-port=9222`.

### Port Already in Use

If port 9222 is in use, either:
1. Kill the process using it
2. Use a different port (update `opencode.jsonc` and Chrome launch command)

### MCP Server Not Found

Install globally:
```bash
npm install -g @chrome-devtools/mcp-server
```

Or use local install in `opencode.jsonc`:
```jsonc
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["@chrome-devtools/mcp-server"]
    }
  }
}
```

## Development Workflow

1. **Start Chrome with remote debugging**
2. **Start CycleDesign dev server** (`npm run dev`)
3. **Start opencode** (`opencode`)
4. **Use natural language to:**
   - Navigate to your app
   - Inspect elements
   - Debug issues
   - Test interactions
   - Capture screenshots for documentation

## Security Notes

- Remote debugging gives full control over Chrome
- Only enable on localhost (never expose to network)
- Close Chrome when done debugging
- Use a dedicated debugging profile (don't use your main Chrome profile)

## Resources

- [Chrome DevTools MCP Server](https://github.com/ChromeDevTools/mcp-server)
- [Chrome Remote Debugging Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [opencode MCP Documentation](https://opencode.ai/docs/mcp/)
