@echo off
REM CycleDesign Sandbox Stop Script (Windows)
REM Usage: scripts\sandbox-stop.bat

echo Stopping CycleDesign sandbox...

docker stop cycledesign-sandbox >nul 2>&1
if errorlevel 1 (
    echo No running sandbox container found.
) else (
    echo Container stopped successfully.
)

echo.
echo To start again:
echo   scripts\sandbox-start.bat
echo.
echo To remove the container completely:
echo   docker rm cycledesign-sandbox
echo   docker volume rm cycledesign-npm_cache
