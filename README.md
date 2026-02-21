# CycleDesign

Phase 1: LLM Provider Integration - A chat interface for interacting with Qwen LLM for design assistance.

## Overview

CycleDesign is a full-stack application that provides a chat-based interface for interacting with Qwen's code-focused LLM. Phase 1 establishes the foundation with:

- Qwen provider integration via Vercel AI SDK
- OAuth Device Flow authentication (RFC 8628)
- Basic chat UI with streaming responses
- Session persistence in JSONL format
- Full session management (create, switch, delete, rename)

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Chrome browser (for OAuth authorization)

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

### Start Both Servers (Recommended)

From the root directory:

```bash
npm run dev
```

This concurrently runs:
- Backend server on http://localhost:3001
- Frontend server on http://localhost:3000

### Start Servers Individually

**Backend only:**
```bash
npm run dev:server
# or
cd apps/server && npm run dev
```

**Frontend only:**
```bash
npm run dev:web
# or
cd apps/web && npm run dev
```

## First-Time OAuth Authorization

When you first send a prompt to the LLM:

1. The backend will detect no OAuth credentials exist
2. A browser window will automatically open to `qwen.ai`
3. Authorize the application using your Qwen account
4. The backend receives and stores credentials in `~/.qwen/oauth_creds.json`
5. Subsequent requests use the stored token automatically

**Note:** Credentials are shared with the `qwen-code` CLI if you use it.

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
2. Click the "New Session" button (or dropdown arrow next to it)
3. Enter a session name (optional, auto-generated if not provided)
4. Click "Create"

### Sending Messages

1. Select a session from the dropdown (or create a new one)
2. Type your prompt in the text input at the bottom
3. Press Enter or click the Send button
4. Watch the streaming response appear in real-time

### Managing Sessions

- **Switch Sessions:** Use the dropdown in the top bar
- **Rename Session:** Click the rename icon next to session name
- **Delete Session:** Click the delete icon, confirm in dialog
- **View History:** All messages persist within a session

### Example Prompts

Try these to get started:

```
Create a landing page for a SaaS product
```

```
What's the best way to structure a React component library?
```

```
Generate a color palette for a fintech app
```

## Project Structure

```
cycledesign/
├── apps/
│   ├── web/                    # React frontend (Vite + MUI)
│   │   ├── src/
│   │   │   ├── components/     # UI components
│   │   │   ├── pages/          # Route pages
│   │   │   ├── context/        # React Context providers
│   │   │   ├── hooks/          # Custom hooks
│   │   │   ├── api/            # API client
│   │   │   └── theme/          # MUI theme
│   │   └── package.json
│   │
│   └── server/                 # Node.js backend (Express)
│       ├── src/
│       │   ├── llm/            # LLM integration
│       │   │   ├── providers/  # Provider implementations
│       │   │   ├── qwen-auth.ts
│       │   │   └── request-queue.ts
│       │   ├── routes/         # API endpoints
│       │   └── sessions/       # Session storage
│       └── package.json
│
├── .cycledesign/               # App data (sessions stored here)
│   └── sessions/
│       └── {session-id}/
│           ├── meta.json
│           └── messages.jsonl
│
├── docs/                       # Documentation
├── package.json                # Root workspace config
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

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | List all sessions |
| `POST` | `/api/sessions` | Create new session |
| `GET` | `/api/sessions/:id` | Get session details |
| `GET` | `/api/sessions/:id/messages` | Get session messages |
| `POST` | `/api/sessions/:id/messages` | Add message to session |
| `DELETE` | `/api/sessions/:id` | Delete session |
| `POST` | `/api/complete/stream` | Stream LLM response (SSE) |

## Available Scripts

**Root:**
```bash
npm run dev          # Run both frontend and backend
npm run dev:server   # Run backend only
npm run dev:web      # Run frontend only
npm run build        # Build both apps
npm run lint         # Lint both apps
npm run test         # Run tests
```

**Backend (`apps/server`):**
```bash
npm run dev          # Development with hot reload
npm run build        # Compile TypeScript
npm run start        # Start production server
npm run test         # Run vitest tests
npm run lint         # Run ESLint
```

**Frontend (`apps/web`):**
```bash
npm run dev          # Development server (Vite)
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm run format       # Format with Prettier
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
- React Router v6

**Backend:**
- Node.js + Express
- Vercel AI SDK
- TypeScript
- OAuth Device Flow (RFC 8628)

**LLM:**
- Qwen via OAuth (coder-model, vision-model)

## Next Steps (Phase 2)

Phase 2 will add:
- Design system integration
- Code generation with validation
- Component ID injection
- Visual preview of generated code
- Tool calling for design system operations

## License

MIT
