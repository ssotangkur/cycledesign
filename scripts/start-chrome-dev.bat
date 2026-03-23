@echo off
REM Start Chrome with Remote Debugging for Qwen Code MCP
REM Usage: scripts\start-chrome-dev.bat

setlocal

REM Check if Chrome is already running with remote debugging
curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if not errorlevel 1 (
    echo Chrome with remote debugging is already running on port 9222.
    echo You can now use Qwen Code with Chrome DevTools MCP.
    echo.
    echo Example: QWEN_SANDBOX=docker qwen -s
    exit /b 0
)

REM Check if Chrome is installed
if not exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo ERROR: Google Chrome not found at default location.
    echo Please install Chrome or update the path in this script.
    exit /b 1
)

REM Start Chrome with remote debugging
echo Starting Chrome with remote debugging on port 9222...
echo.
echo Profile directory: %TEMP%\chrome-dev-profile
echo.
echo IMPORTANT: Keep this window open while using Qwen Code with Chrome DevTools.
echo To stop Chrome, close all Chrome windows or run: scripts\stop-chrome.bat
echo.

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\chrome-dev-profile"

REM Wait for Chrome to start
timeout /t 3 /nobreak >nul

REM Verify Chrome started
curl -s http://127.0.0.1:9222/json/version >nul 2>&1
if not errorlevel 1 (
    echo.
    echo SUCCESS: Chrome is running with remote debugging.
    echo.
    echo You can now run:
    echo   QWEN_SANDBOX=docker qwen -s
    echo.
    echo To verify, open: http://127.0.0.1:9222/json/version
) else (
    echo.
    echo WARNING: Chrome may not have started correctly.
    echo Check if Chrome is running in Task Manager.
)

endlocal
