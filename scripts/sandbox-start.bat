@echo off
REM CycleDesign Qwen Code Sandbox Launcher
REM Usage: scripts\sandbox-start.bat [--yolo] [additional qwen args...]

REM This script launches PowerShell with the correct environment variables

REM Check if GH_TOKEN is set (gh CLI native env var)
if "%GH_TOKEN%"=="" (
    echo ERROR: GH_TOKEN environment variable is not set.
    echo.
    echo Please set it first:
    echo   setx GH_TOKEN your_github_token_here
    echo.
    echo Or run with PowerShell directly:
    echo   powershell -Command "$env:GH_TOKEN='ghp_your_token'; scripts\sandbox-start.ps1"
    exit /b 1
)

REM Launch PowerShell script with same arguments
powershell -ExecutionPolicy Bypass -File "%~dp0sandbox-start.ps1" %*
