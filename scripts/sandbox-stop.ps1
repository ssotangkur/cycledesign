# CycleDesign Qwen Sandbox Stopper (PowerShell)
# Usage: .\sandbox-stop.ps1

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Stopping CycleDesign Qwen Sandbox" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Find and stop the sandbox container
$container = docker ps --filter "ancestor=cycledesign-sandbox:gui" --format "{{.ID}}"

if ($container) {
    Write-Host "Stopping sandbox container..." -ForegroundColor Yellow
    docker stop $container | Out-Null
    Write-Host "Container stopped." -ForegroundColor Green
} else {
    Write-Host "No running sandbox container found." -ForegroundColor Gray
}

# Optional: Remove the container (uncomment if you want auto-cleanup)
# if ($container) {
#     Write-Host "Removing container..." -ForegroundColor Yellow
#     docker rm $container | Out-Null
#     Write-Host "Container removed." -ForegroundColor Green
# }

Write-Host ""
Write-Host "Sandbox stopped." -ForegroundColor Cyan
Write-Host ""
