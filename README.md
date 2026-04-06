# CycleDesign

**Prompt-to-UI Design Tool** - Generate React/TypeScript code from natural language prompts with real-time preview.

## Overview

CycleDesign is a full-stack application that provides a chat-based interface for interacting with Qwen's code-focused LLM. The LLM generates React/TypeScript code using Material-UI components, which is then validated and rendered in a live preview.

## Architecture

As of March 2026, the server uses a unified ToolLoopAgent-based architecture with:
- Clear separation between transport (`transport/ws/`) and application layers (`features/status/`)
- WebSocketBridge for session-aware status message routing
- MockProvider for deterministic E2E testing
- Shared ValidationService for deduplicated validation logic

### Features

- **Qwen LLM Integration** via OAuth Device Flow (RFC 8628)
- **Real-time Chat** with WebSocket-based messaging
- **Code Generation** - LLM generates React/TypeScript code from prompts
- **Live Preview** - Backend-managed Vite server renders generated code
- **Validation Pipeline** - TypeScript compilation, ESLint, and Knip checks
- **Session Management** - Create, switch, delete, rename conversations
- **Multi-Service Development** - Backend and frontend run independently with nodemon/vite HMR

## Prerequisites

- **Node.js 20.19.x** (managed via fnm)
- npm
- Chrome browser (for OAuth authorization)

### Node.js Version Management

This project uses [fnm (Fast Node Manager)](https://github.com/Schniz/fnm) to ensure all developers use the same Node.js version.

**Install fnm:**

```bash
# macOS/Linux
curl -fsSL https://fnm.vercel.app/install | bash

# Windows (using winget)
winget install Schniz.fnm

# Or via Homebrew (macOS)
brew install fnm
```

**Setup Node.js for this project:**

```bash
# In the project directory
fnm use --install-if-missing

# Verify version
node --version  # Should show v20.19.0
```

The project includes a `.nvmrc` file specifying Node.js 20.19.0. fnm will automatically use this version when you run `fnm use`.

**Note:** If you don't have fnm installed, the `npm install` command will show a warning about the wrong Node.js version.

## Installation

### 1. Clone and Install Dependencies

```bash
cd cycledesign
npm install
```

This installs dependencies for both the frontend (`apps/web`) and backend (`apps/server`).

### 2. Environment Setup

Create `.env` files for both applications:

**Backend (`apps/server/.env`):**
```bash
# LLM Provider
LLM_PROVIDER=qwen

# Qwen OAuth (no API key needed - uses OAuth Device Flow)
QWEN_OAUTH_DEVICE_ENDPOINT=https://auth.qwen.ai/oauth/device/code
QWEN_OAUTH_TOKEN_ENDPOINT=https://auth.qwen.ai/oauth/token
QWEN_OAUTH_CLIENT_ID=qwen-code-cli

# Qwen API Base URL
QWEN_BASE_URL=https://portal.qwen.ai/v1

# Server
PORT=3001
NODE_ENV=development
```

**Frontend (`apps/web/.env`):**
```bash
# API
VITE_API_URL=http://localhost:3001

# App
VITE_APP_NAME=CycleDesign
```

Copy `.env.example` files if they exist, or create new ones from scratch.

## Running the Development Server

### Start All Services

```bash
npm run dev
```

This will:
1. Kill any processes on ports 3000, 3001, 3002
2. Start the backend server (port 3001) with nodemon
3. Start the frontend (port 3000) with Vite HMR
4. Log to `tmp/server.log` and `tmp/web.log`

### Individual Commands

```bash
npm run dev:kill      # Kill processes on ports 3000/3001/3002
npm run dev:server     # Start backend only
npm run dev:web       # Start frontend only
```

### Log Files

- Server: `tmp/server.log`
- Web: `tmp/web.log`

View live logs:
```bash
tail -f tmp/server.log
tail -f tmp/web.log
```

### Services

- **Server** (port 3001) - Backend API + WebSocket
- **Web** (port 3000) - Frontend UI with HMR
- **Preview** (port 3002) - Vite preview server (backend-managed)

## First-Time OAuth Authorization

When you first send a prompt to the LLM:

1. The backend will detect no OAuth credentials exist
2. A browser window will automatically open to `qwen.ai`
3. Authorize the application using your Qwen account
4. The backend receives and stores credentials in `~/.qwen/oauth_creds.json`
5. Subsequent requests use the stored token automatically

**Note:** Credentials are shared with the `qwen-code` CLI if you use it.

### Rate Limits (Qwen OAuth Free Tier)

- 60 requests/minute
- 1000 requests/day (resets at 0:00 Beijing Time)

The application automatically handles rate limiting with exponential backoff.

### OAuth Flow Details

CycleDesign uses **OAuth 2.0 Device Authorization Flow** (RFC 8628):

1. Backend requests a device code from Qwen OAuth server
2. Browser opens with authorization URL
3. User logs in and authorizes the application
4. Backend polls for token completion
5. Access token + refresh token stored securely
6. Token auto-refreshes 5 minutes before expiry

**Rate Limits (Qwen OAuth Free Tier):**
- 60 requests/minute
- 1000 requests/day (resets at 0:00 Beijing Time)

The application automatically handles rate limiting with exponential backoff and jitter.

## Basic Usage

### Creating a Session

1. Open http://localhost:3000 in your browser
2. Click the "New Session" button
3. Enter a session name (optional, auto-generated if not provided)
4. Click "Create"

### Sending Prompts

1. Select a session from the sidebar
2. Type your design prompt (e.g., "Create a landing page with hero section")
3. Press Enter to send
4. Watch as the LLM generates code and the preview updates in real-time

### UI Layout

- **Left Pane** - Session list, chat messages, prompt input (resizable)
- **Right Pane** - Live preview of generated code (iframe)
- **Divider** - Drag to resize left/right panes

### Managing Sessions

- **Switch Sessions:** Click session in sidebar
- **Rename Session:** Click rename icon next to session name
- **Delete Session:** Click delete icon, confirm in dialog
- **View History:** All messages persist within a session

### Example Prompts

```
Create a landing page with a hero section and features
```

```
Build a dashboard with charts and metrics
```

```
Design a pricing page with three tiers
```

## Project Structure

```
cycledesign/
├── apps/
│   ├── web/                    # React frontend (Vite + MUI)
│   │   ├── src/
│   │   │   ├── components/     # UI components (Chat, Sessions, Preview)
│   │   │   ├── hooks/          # Custom hooks (WebSocket, state management)
│   │   │   └── theme/          # MUI theme configuration
│   │   └── tmp/                # Log files
│   │
│   ├── server/                 # Node.js backend (Express + Vercel AI SDK)
│   │   ├── src/
│   │   │   ├── llm/            # LLM integration + tool calling
│   │   │   │   ├── tools/      # Tool definitions (create_file, edit_file, etc.)
│   │   │   │   └── system-prompt.ts
│   │   │   ├── routes/         # REST API endpoints
│   │   │   ├── ws/             # WebSocket handler
│   │   │   ├── preview/        # Preview server lifecycle management
│   │   │   └── validation/     # TypeScript, ESLint, Knip validators
│   │   ├── resources/          # Templates and prompts (externalized)
│   │   │   ├── prompts/        # system-prompt.md
│   │   │   └── templates/      # app.tsx bootstrap template
│   │   └── tmp/                # Log files
│   │
│   └── preview/                # Preview Vite instance (LLM-managed dependencies)
│       ├── src/
│       │   └── main.tsx        # Dynamic design loader
│       └── tmp/                # Log files
│
├── workspace/                  # LLM-generated design code (gitignored)
│   └── designs/
│       ├── app.tsx             # Root component (modified by LLM)
│       └── *.tsx               # Additional components
│
├── .cycledesign/               # App data (sessions, provider config)
│   └── sessions/
│       └── {session-id}/
│           ├── meta.json
│           └── messages.jsonl
│
├── docs/                       # Documentation
├── tests/e2e/                  # End-to-end tests (Playwright)
│   ├── tests/                  # Test specifications
│   ├── fixtures/               # Test fixtures and helpers
│   ├── playwright.config.ts    # Playwright configuration
│   └── README.md               # E2E testing documentation
├── package.json                # Root workspace config (npm run dev)
├── tmp/                       # Log files (server.log, web.log)
└── README.md
```

## Session Storage Format

Sessions are stored in `.cycledesign/sessions/` as JSONL (JSON Lines):

**Session Structure:**
```
.cycledesign/sessions/
├── session-abc123/
│   ├── meta.json           # Session metadata
│   └── messages.jsonl      # Conversation messages (one JSON per line)
└── session-def456/
    ├── meta.json
    └── messages.jsonl
```

**meta.json:**
```json
{
  "id": "session-abc123",
  "name": "Landing Page Design",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T14:22:00Z",
  "provider": "qwen",
  "model": "coder-model",
  "messageCount": 12,
  "totalTokens": 5420
}
```

**messages.jsonl:**
```jsonl
{"id":"msg_001","role":"system","content":"You are a helpful design assistant.","timestamp":1705312200000}
{"id":"msg_002","role":"user","content":"Create a landing page","timestamp":1705312210000}
{"id":"msg_003","role":"assistant","content":"Here's a landing page...","timestamp":1705312215000,"tokenCount":150}
```

## API Endpoints

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create new session |
| `GET` | `/api/sessions/:id` | Get session details |
| `GET` | `/api/sessions/:id/messages` | Get session messages |
| `POST` | `/api/sessions/:id/messages` | Add message to session |
| `DELETE` | `/api/sessions/:id` | Delete session |

### Preview Server

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/preview/start` | Start preview server |
| `POST` | `/api/preview/stop` | Stop preview server |
| `GET` | `/api/preview/status` | Get server status and port |
| `GET` | `/api/preview/logs/stream` | Stream logs (SSE) |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check endpoint |
| `POST` | `/api/complete/stream` | Stream LLM response (SSE) |

## Available Scripts

**Root:**
```bash
npm run build        # Build all apps
npm run lint         # Lint all apps
npm run validate     # Run ESLint + Knip validation
npm run test         # Run all tests (unit + E2E)
npm run test:e2e     # Run E2E tests with Playwright
npm run test:e2e:ui  # Run E2E tests with Playwright UI
npm run test:e2e:debug  # Run E2E tests in debug mode
```

**Backend (`apps/server`):**
```bash
npm run dev          # Development with tsx watch
npm run build        # Compile TypeScript
npm run start        # Start production server
npm run lint         # Run ESLint
```

**Frontend (`apps/web`):**
```bash
npm run dev          # Development server (Vite)
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # Run ESLint
```

**Preview (`apps/preview`):**
```bash
npm run dev          # Preview dev server (managed by backend)
npm run build        # Production build
```

## Troubleshooting

### OAuth Authorization Fails

- Ensure you have a Qwen account at https://qwen.ai
- Check that your browser opened the authorization URL
- If credentials expire, delete `~/.qwen/oauth_creds.json` and re-authorize

### Port Already in Use

If port 3000 or 3001 is already in use:

**Backend:** Change `PORT` in `apps/server/.env`
**Frontend:** Change `VITE_API_URL` in `apps/web/.env` to match

### LLM Responses Not Appearing

1. Check browser console for errors
2. Verify backend is running on port 3001
3. Check backend logs for OAuth or API errors
4. Ensure you've completed OAuth authorization

### Session Data Lost

Sessions are stored in `.cycledesign/sessions/`. If data seems lost:
- Check that the directory exists and is writable
- Verify session ID in URL matches folder name
- Check `messages.jsonl` for corruption

## Tech Stack

**Frontend:**
- React 18
- MUI (Material-UI) v5
- Vite
- TypeScript
- WebSocket (real-time messaging)

**Backend:**
- Node.js + Express
- Vercel AI SDK (LLM integration)
- TypeScript
- nodemon (auto-restart on file changes)
- WebSocket server
- OAuth Device Flow (RFC 8628)

**Preview:**
- Vite (backend-managed instance)
- Isolated iframe rendering
- Dynamic dependency management

**LLM:**
- Qwen via OAuth (coder-model)

**Development:**
- npm scripts (npm run dev)
- tsx for TypeScript execution
- nodemon for server auto-restart
- Playwright for E2E testing
- Chrome DevTools MCP for testing

## E2E Testing

CycleDesign uses Playwright for end-to-end browser testing. Tests verify UI functionality without relying on LLM responses.

### Setup

```bash
# Install Playwright browsers
npm run install:e2e:browsers
```

### Running Tests

```bash
# Run all tests (headless)
npm run test:e2e

# Run with UI for interactive exploration
npm run test:e2e:ui

# Run in debug mode with visible browser
npm run test:e2e:debug
```

### Test Coverage

- **Session Management** - Create, rename, delete sessions
- **Layout & Navigation** - Responsive panes, resizing, navigation
- **Chat Panel** - Message sending, loading states, connection status

### Writing Tests

See [apps/e2e/README.md](apps/e2e/README.md) for detailed documentation on writing and running E2E tests.

### CI/CD

E2E tests run automatically on pull requests to `main` via GitHub Actions. Test reports and screenshots are uploaded as artifacts on failure.



## License

MIT
""  
