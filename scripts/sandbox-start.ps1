# CycleDesign Qwen Code Sandbox Launcher (PowerShell)
# Usage: .\sandbox-start.ps1 [qwen args...]
# Example: .\sandbox-start.ps1 -y "fix the bug"

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$QwenArgs
)

# Check if GH_TOKEN is set
if (-not $env:GH_TOKEN) {
    Write-Host "ERROR: GH_TOKEN environment variable is not set." -ForegroundColor Red
    Write-Host ""
    Write-Host "Please set it first:" -ForegroundColor Yellow
    Write-Host '  $env:GH_TOKEN = "ghp_your_token_here"' -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Or add to your PowerShell profile for permanent setup:" -ForegroundColor Yellow
    Write-Host '  Add-Content $PROFILE "`$env:GH_TOKEN = `"ghp_your_token_here`"`"' -ForegroundColor Yellow
    exit 1
}

# Configure sandbox environment variables
$env:QWEN_SANDBOX = "true"
$env:QWEN_SANDBOX_IMAGE = "cycledesign-sandbox:gui"

# Mount host's ~/.qwen to /root/.qwen in container for auth tokens
# Pass GH_TOKEN into container for GitHub auth
# Also expose ports for VNC/noVNC (Chrome DevTools runs inside container only)
# 
# CRITICAL: Container runs as root to avoid permission changes on host files
# The host's ~/.qwen is mounted to /root/.qwen (root's home in container)
# No chown/chmod operations are performed on node_modules
$hostQwenDir = "${env:USERPROFILE}\.qwen"
$env:SANDBOX_FLAGS = "-p 0.0.0.0:5900:5900 -p 0.0.0.0:6080:6080 -v `"${hostQwenDir}:/root/.qwen`" -e GH_TOKEN"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  CycleDesign Qwen Sandbox" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Image: $env:QWEN_SANDBOX_IMAGE" -ForegroundColor White
Write-Host "Sandbox: enabled" -ForegroundColor White
Write-Host "SANDBOX_FLAGS: $env:SANDBOX_FLAGS" -ForegroundColor White
Write-Host ""
Write-Host "Access URLs:" -ForegroundColor Green
Write-Host "  - noVNC (Browser): http://localhost:6080" -ForegroundColor White
Write-Host "  - VNC Client:      localhost:5900" -ForegroundColor White
Write-Host ""
Write-Host "Note: Chrome DevTools runs inside the container for Qwen Code" -ForegroundColor Gray
Write-Host ""
Write-Host "Starting qwen..." -ForegroundColor Cyan
Write-Host ""

# Execute qwen with all passed arguments
& qwen $QwenArgs
