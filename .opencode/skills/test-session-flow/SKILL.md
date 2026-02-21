---
name: test-session-flow
description: Test the complete session management workflow in CycleDesign
---

## Session Flow Testing Checklist

Use this skill to verify the session management features are working correctly.

### Prerequisites
- Dev servers must be running (frontend on :3000, backend on :3001)
- Use `/dev-server` skill if not running

### 1. Create Session
- [ ] Navigate to http://localhost:3000
- [ ] Click "New Session" button
- [ ] **Verify:** Session created immediately (no dialog)
- [ ] **Verify:** Session label shows ID (last 8 chars, e.g., "a1b2c3d4")
- [ ] **Verify:** Session appears in dropdown

### 2. Send First Message
- [ ] Type message in input field
- [ ] Click send button
- [ ] **Critical:** Verify session label updates to first message content
- [ ] **Verify:** User message appears in chat
- [ ] **Verify:** LLM response streams in real-time
- [ ] **Verify:** Token usage chips appear after completion

### 3. Session Persistence
- [ ] Refresh page (F5)
- [ ] **Verify:** Session still in dropdown
- [ ] **Verify:** Messages persist in chat
- [ ] **Verify:** Can continue conversation coherently

### 4. Multiple Sessions
- [ ] Create second session
- [ ] **Verify:** Both sessions in dropdown
- [ ] Switch between sessions
- [ ] **Verify:** Correct messages display for each
- [ ] **Verify:** No message leakage between sessions

### 5. Delete Session
- [ ] Click delete button
- [ ] **Verify:** Confirmation dialog appears
- [ ] Confirm deletion
- [ ] **Verify:** Session removed from dropdown
- [ ] **Verify:** No errors in console

### 6. Edge Cases
- [ ] Empty session list state
- [ ] Very long first message (truncation with ellipsis)
- [ ] Special characters in message
- [ ] Delete current session (should clear chat)

## Testing Commands

### Using Chrome DevTools Agent
```
Delegate to @chrome-devtools:
"Test the complete session flow using the test-session-flow checklist"
```

### Manual Testing with Browser
```bash
# Open browser
Start-Process "http://localhost:3000"

# Check console for errors
# In Chrome DevTools: Console tab
```

### Automated Verification

**Git Bash:**
```bash
# Check backend health
curl http://localhost:3001/health

# List sessions via API
curl http://localhost:3001/api/sessions

# Check logs
tail -20 tmp/dev.log
```

**PowerShell:**
```bash
# Check backend health
Invoke-RestMethod -Uri "http://localhost:3001/health"

# List sessions via API
Invoke-RestMethod -Uri "http://localhost:3001/api/sessions"

# Check logs
Get-Content tmp\dev.log -Tail 20
```

## Expected Behavior

### Session Label Flow
1. **Initial:** Label = session ID (e.g., "624156a0")
2. **After first message:** Label = first message content (truncated to 50 chars)
3. **Subsequent messages:** Label remains unchanged
4. **After page refresh:** Label persists from backend firstMessage field

### State Updates
- Session creation: Immediate (optimistic)
- Label update: Immediate after first message (no API reload)
- Message display: Real-time streaming
- Delete: Immediate with confirmation

## Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Label doesn't update | firstMessage not in state | Check sessionLabelsMap in SessionContext |
| "prev is not defined" | Wrong setState scope | Use functional update pattern |
| Session not deleted | API call failed | Check backend logs |
| Dropdown empty | Sessions not loaded | Check GET /api/sessions response |

## Report Format

After testing, report:
```
✅ Passed: [list of checks]
❌ Failed: [list of failures]
🐛 Bugs: [any issues found]
📸 Screenshots: [tmp/ filenames if applicable]
```
