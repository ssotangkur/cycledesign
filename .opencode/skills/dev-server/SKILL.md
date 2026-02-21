---
name: dev-server
description: Start the CycleDesign dev server in the background on Windows with logs redirected to tmp/dev.log
---

## Starting the Dev Server on Windows

On Windows, running `npm run dev` blocks the terminal. Use this skill to start it properly in the background.

### Step 1: Check if ports are already in use

```bash
netstat -ano | findstr :3000
netstat -ano | findstr :3001
```

If processes are found, kill them:

```bash
taskkill /F /PID <pid1>
taskkill /F /PID <pid2>
```

### Step 2: Start the dev server in the background

Use cmd to properly redirect output:

```bash
cmd /c "start /B npm run dev > tmp\dev.log 2>&1"
```

### Step 3: Verify the server started

Wait a few seconds and check the logs:

```bash
powershell -Command "Start-Sleep -Seconds 3; Get-Content tmp\dev.log"
```

Look for:
- `Local:   http://localhost:3000/` (frontend)
- `Server running on http://localhost:3001` (backend)

### When to use this skill

Use this skill when:
- You need to start the development server
- You want to run other commands after starting the server
- You need to verify the server is running correctly

### Reading logs later

To check server status at any time:

```bash
powershell -Command "Get-Content tmp\dev.log -Tail 50"
```

Or use `type tmp\dev.log` on Windows cmd.
