---
name: dev-server
description: Start the CycleDesign dev server on Windows with proper port killing and logging
---

## Starting the Dev Server

### Quick Start

```bash
npm run dev
```

This will:
1. Kill any processes on ports 3000, 3001, 3002
2. Start the backend server (port 3001)
3. Start the frontend web server (port 3000)
4. Log to `tmp/server.log` and `tmp/web.log`

### Individual Commands

**Kill ports only:**
```bash
npm run dev:kill
```

**Start server only:**
```bash
npm run dev:server
```

**Start web only:**
```bash
npm run dev:web
```

### Log Files

- Server: `tmp/server.log`
- Web: `tmp/web.log`

View logs:
```bash
# Server logs
tail -f tmp/server.log

# Web logs  
tail -f tmp/web.log

# Both
tail -f tmp/*.log
```

### Ports

Ports are offset-aware (see `scripts/ports.cjs`). Effective ports =
`3000/3001/3002 + local offset (+ E2E offset for Playwright)`:

- Frontend: http://localhost:3000 (+ offset)
- Backend: http://localhost:3001 (+ offset)
- Preview: http://localhost:3002 (+ offset)

Check your checkout's ports:

```bash
node scripts/ports.cjs          # dev ports for this checkout
node scripts/ports.cjs --e2e    # Playwright-owned ports
```

**Per-checkout isolation:** each clone keeps its own git-ignored
`.ports.local.json` (`{ "offset": 100 }`, see `.ports.local.json.example`)
so sibling checkouts run side by side. `PORT_OFFSET` env overrides the file.
Playwright stacks `E2E_PORT_OFFSET` (default 50) on top, so E2E servers never
compete with manual dev servers — `npm run dev` only ever kills dev ports,
`npm run dev:e2e` only ever kills E2E ports.

### Troubleshooting

**If ports are in use:**

```bash
node scripts/check-ports.cjs       # names the owning process per port
npm run dev:kill
npm run dev
```

**If servers crash with EADDRINUSE:**
The `npm run dev` command automatically kills its own (offset) ports before
starting. If the owner is another checkout, give this checkout its own offset
in `.ports.local.json` instead of killing the other checkout's servers.

**Check server health (replace ports with `node scripts/ports.cjs` output):**
```bash
curl http://localhost:3101/health
curl http://localhost:3100
```

### File Changes

The server uses `nodemon` to watch for file changes and automatically restart. Check `tmp/server.log` for restart messages.

**If HMR not working:**
- Check component has default export
- Check nodemon is running (look for "nodemon watching" in logs)
- Clear browser cache
