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

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Preview: http://localhost:3002

### Troubleshooting

**If ports are in use:**
```bash
npm run dev:kill
npm run dev
```

**If servers crash with EADDRINUSE:**
The `npm run dev` command automatically kills ports before starting.

**Check server health:**
```bash
curl http://localhost:3001/health
curl http://localhost:3000
```

### File Changes

The server uses `nodemon` to watch for file changes and automatically restart. Check `tmp/server.log` for restart messages.

**If HMR not working:**
- Check component has default export
- Check nodemon is running (look for "nodemon watching" in logs)
- Clear browser cache
