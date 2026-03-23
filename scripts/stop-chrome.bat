@echo off
REM Stop Chrome (Remote Debugging Mode)
REM Usage: scripts\stop-chrome.bat

echo Stopping Chrome...

taskkill /F /IM chrome.exe 2>nul
if errorlevel 1 (
    echo No Chrome processes found.
) else (
    echo Chrome stopped.
)

REM Optional: Clean up profile directory
echo.
echo To clean up the Chrome dev profile, run:
echo   rmdir /s /q "%TEMP%\chrome-dev-profile"
