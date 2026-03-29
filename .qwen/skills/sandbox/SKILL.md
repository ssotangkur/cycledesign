---
name: sandbox
description: Handle git operations and authentication in sandbox environments using GH_TOKEN
---

# Sandbox Git Authentication Guide

## Why GH_TOKEN is Needed in Sandbox

The sandbox environment is **isolated** from your host machine:

1. **No Access to Host Credentials**: SSH keys, credential helpers, and cached tokens from your host machine are not available inside the sandbox container
2. **Fresh Start Each Session**: Every sandbox session starts without inherited authentication state
3. **Security Boundary**: The sandbox is designed to be isolated—it cannot automatically access host credentials

This means git operations like `push`, `pull`, and `fetch` will fail with authentication errors unless you explicitly provide credentials.

## Checking GH_TOKEN Availability

Before running git operations, verify the token is available:

```bash
echo $GH_TOKEN
# or
test -n "$GH_TOKEN" && echo "Token is set" || echo "Token is NOT set"
```

If the token is not set, you need to obtain it from your environment or secrets manager.

## Git Operations with GH_TOKEN

### Method 1: Push/Pull Using Token in URL

**Push changes:**
```bash
git remote set-url origin https://$GH_TOKEN@github.com/ssotangkur/cycledesign.git
git push -u origin branch-name
```

**Pull changes:**
```bash
git remote set-url origin https://$GH_TOKEN@github.com/ssotangkur/cycledesign.git
git pull
```

**Restore original remote URL (optional, after operations):**
```bash
git remote set-url origin git@github.com:ssotangkur/cycledesign.git
```

### Method 2: Using GitHub CLI (Recommended)

The `gh` CLI handles authentication internally when `GH_TOKEN` is set:

```bash
# Create a pull request
gh pr create --title "Your title" --body "Your description" --base main

# Check PR status
gh pr status

# List PRs
gh pr list

# Merge a PR
gh pr merge --merge --admin

# Check CI status
gh pr checks <PR_NUMBER>
```

### Method 3: One-Liner for Quick Push

```bash
git remote set-url origin https://$GH_TOKEN@github.com/ssotangkur/cycledesign.git && git push -u origin branch-name
```

## Common Git Workflows

### Creating a New Branch and Pushing

```bash
# Create and switch to new branch
git checkout -b feature/your-feature

# Make your changes, then:
git add .
git commit -m "Your commit message"

# Push using token
git remote set-url origin https://$GH_TOKEN@github.com/ssotangkur/cycledesign.git
git push -u origin feature/your-feature
```

### Updating PR Branch with Latest Main

```bash
# Fetch latest
git remote set-url origin https://$GH_TOKEN@github.com/ssotangkur/cycledesign.git
git fetch origin main

# Rebase or merge
git rebase origin/main
# or
git merge origin/main

# Push with force (if rebased)
git push -f origin branch-name
```

### Creating a PR via CLI

```bash
gh pr create \
  --title "Add new feature" \
  --body "Description of changes" \
  --base main \
  --label "feature"
```

## Troubleshooting

### "Username for github.com" Prompt

**Problem:** Git prompts for username/password interactively

**Solution:** Use token in URL format:
```bash
git remote set-url origin https://$GH_TOKEN@github.com/ssotangkur/cycledesign.git
```

### "Authentication Failed" Error

**Problem:** Git push/pull fails with authentication error

**Solutions:**
1. Verify token is set: `echo $GH_TOKEN`
2. Check token validity (not expired, has correct scopes)
3. Ensure remote URL uses token: `git remote -v`

### "Command substitution not allowed" Error

**Problem:** Using `$()` or backticks in commands is blocked for security

**Solution:** Use environment variable directly without substitution:
```bash
# Wrong (won't work in sandbox):
git remote set-url origin https://$(echo $GH_TOKEN)@github.com/...

# Correct:
git remote set-url origin https://$GH_TOKEN@github.com/...
```

### Git Works Outside Sandbox But Not Inside

**Problem:** Git operations work on host machine but fail in sandbox

**Explanation:** This is expected behavior. The sandbox is isolated and doesn't inherit your host's git credentials.

**Solution:** Always use `GH_TOKEN` for git operations inside the sandbox.

### SSL/Certificate Verification Errors

**Problem:** SSL certificate verification fails

**Solution:** 
```bash
# Temporary workaround (use with caution)
GIT_SSL_NO_VERIFY=true git push

# Better: Ensure CA certificates are installed in sandbox
```

## Quick Reference Card

| Task | Command |
|------|---------|
| Check token | `echo $GH_TOKEN` |
| Set remote with token | `git remote set-url origin https://$GH_TOKEN@github.com/owner/repo.git` |
| Push branch | `git push -u origin branch-name` |
| Force push | `git push -f origin branch-name` |
| Create PR | `gh pr create --title "..." --body "..."` |
| Check PR status | `gh pr checks <NUMBER>` |
| Merge PR | `gh pr merge --merge --admin` |

## Security Notes

- **Never commit tokens** to your repository
- **Token scope**: Ensure GH_TOKEN has minimal required permissions (typically `repo` scope)
- **Token rotation**: Rotate tokens periodically and if compromised
- **Environment variables**: Tokens in environment variables are safer than hardcoded URLs
