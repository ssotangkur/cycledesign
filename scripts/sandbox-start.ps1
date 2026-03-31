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

# Load custom port configuration if .env.sandbox exists
$envSandboxPath = Join-Path $PSScriptRoot "..\.qwen\.env.sandbox"
if (Test-Path $envSandboxPath) {
    Write-Host "Loading port configuration from .qwen/.env.sandbox..." -ForegroundColor Gray
    Get-Content $envSandboxPath | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $varName = $matches[1].Trim()
            $varValue = $matches[2].Trim()
            Set-Item -Force -Path "ENV:$varName" -Value $varValue
            Write-Host "  $varName = $varValue" -ForegroundColor Gray
        }
    }
    Write-Host ""
}

# Use configured ports with defaults
$novncPort = if ($env:NOVNC_PORT) { $env:NOVNC_PORT } else { 6080 }
$vncPort = if ($env:VNC_PORT) { $env:VNC_PORT } else { 5900 }
$chromePort = if ($env:CHROME_PORT) { $env:CHROME_PORT } else { 9222 }

# Check for port conflicts before starting
Write-Host "Checking for port conflicts..." -ForegroundColor Gray
$portConflict = $false

foreach ($port in @($novncPort, $vncPort, $chromePort)) {
    $inUse = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue -State Listen
    if ($inUse) {
        Write-Host "  Port $port is IN USE" -ForegroundColor Red
        $portConflict = $true
    } else {
        Write-Host "  Port $port is available" -ForegroundColor Green
    }
}

if ($portConflict) {
    Write-Host ""
    Write-Host "ERROR: One or more configured ports are already in use." -ForegroundColor Red
    Write-Host "Please choose different ports or stop the existing sandbox." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To configure alternate ports, edit .qwen/.env.sandbox:" -ForegroundColor Yellow
    Write-Host "  NOVNC_PORT=6081"
    Write-Host "  VNC_PORT=5901"
    Write-Host "  CHROME_PORT=9223"
    Write-Host ""
    exit 1
}

Write-Host ""

# Configure sandbox environment variables
$env:QWEN_SANDBOX = "true"
$env:QWEN_SANDBOX_IMAGE = "cycledesign-sandbox:gui"

# Mount host's ~/.qwen to /root/.qwen in container for auth tokens
# Pass GH_TOKEN into container for GitHub auth
# Also expose ports for VNC/noVNC/Chrome DevTools
$hostQwenDir = "${env:USERPROFILE}\.qwen"
$env:SANDBOX_FLAGS = "-p 0.0.0.0:$vncPort:5900 -p 0.0.0.0:$novncPort:6080 -p 0.0.0.0:$chromePort:9222 -v `"${hostQwenDir}:/root/.qwen`" -e GH_TOKEN"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  CycleDesign Qwen Sandbox" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Image: $env:QWEN_SANDBOX_IMAGE" -ForegroundColor White
Write-Host "Sandbox: enabled" -ForegroundColor White
Write-Host ""
Write-Host "Access URLs:" -ForegroundColor Green
Write-Host "  - noVNC (Browser): http://localhost:$novncPort" -ForegroundColor White
Write-Host "  - VNC Client:      localhost:$vncPort" -ForegroundColor White
Write-Host ""
Write-Host "Note: Chrome DevTools runs inside the container for Qwen Code" -ForegroundColor Gray
Write-Host ""
Write-Host "Starting qwen..." -ForegroundColor Cyan
Write-Host ""

# Execute qwen with all passed arguments
& qwen $QwenArgs

# After qwen exits, validate that the container was using the correct ports
# (This is a post-run check to help catch configuration issues)
Write-Host ""
Write-Host "Shutting down..." -ForegroundColor Cyan

# Try to find the most recent sandbox container
$container = docker ps -a --filter "name=cycledesign-sandbox-gui" --format "{{.ID}}" --latest 2>$null
if ($container) {
    Write-Host "Validating port bindings..." -ForegroundColor Gray
    
    # Verify noVNC port using docker port command
    $actualNovncOutput = docker port $container 6080/tcp 2>$null
    if ($actualNovncOutput) {
        $actualNovnc = $actualNovncOutput | ForEach-Object { ($_ -split ':')[-1] }
        
        if ($actualNovnc -eq $novncPort) {
            Write-Host "  ✓ Port validation passed: noVNC bound to $novncPort" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ Port mismatch: expected $novncPort, got $actualNovnc" -ForegroundColor Yellow
            Write-Host "    This may indicate the container used different port configuration." -ForegroundColor Gray
        }
    }
}

Write-Host ""
Write-Host "Sandbox session ended." -ForegroundColor Cyan
Write-Host ""
