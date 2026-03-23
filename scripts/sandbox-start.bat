@echo off
REM CycleDesign Sandbox Start Script (Windows)
REM Usage: scripts\sandbox-start.bat

setlocal

REM Check if SANDBOX_GITHUB_TOKEN is set
if "%SANDBOX_GITHUB_TOKEN%"=="" (
    echo ERROR: SANDBOX_GITHUB_TOKEN environment variable is not set.
    echo.
    echo Please set it first:
    echo   setx SANDBOX_GITHUB_TOKEN your_github_token_here
    echo.
    echo Or run with token directly:
    echo   set SANDBOX_GITHUB_TOKEN=your_token_here ^&^& scripts\sandbox-start.bat
    exit /b 1
)

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running. Please start Docker Desktop.
    exit /b 1
)

REM Check if sandbox image exists
docker images cycledesign-persistent --format "{{.Repository}}" | findstr "cycledesign-persistent" >nul
if errorlevel 1 (
    echo Sandbox image not found. Building...
    docker build -t cycledesign-persistent -f ..\.qwen\sandbox.Dockerfile.persistent ..
    if errorlevel 1 (
        echo ERROR: Failed to build sandbox image.
        exit /b 1
    )
)

REM Stop and remove existing container if it exists
docker ps -a --filter "name=cycledesign-sandbox" --format "{{.Names}}" | findstr "cycledesign-sandbox" >nul
if not errorlevel 1 (
    echo Stopping existing sandbox container...
    docker stop cycledesign-sandbox >nul 2>&1
    docker rm cycledesign-sandbox >nul 2>&1
)

REM Create npm cache volume if it doesn't exist
docker volume inspect cycledesign-npm_cache >nul 2>&1
if errorlevel 1 (
    echo Creating npm cache volume...
    docker volume create cycledesign-npm_cache >nul
)

REM Start the container
echo Starting CycleDesign sandbox...
docker run -d --name cycledesign-sandbox ^
    -p 3000:3000 -p 3001:3001 -p 3002:3002 ^
    -p 5800:5800 -p 5900:5900 ^
    -e SANDBOX_GITHUB_TOKEN=%SANDBOX_GITHUB_TOKEN% ^
    -e VNC_PASSWORD=%VNC_PASSWORD% ^
    -e DISPLAY_WIDTH=1920 ^
    -e DISPLAY_HEIGHT=1080 ^
    -v %CD%:/app ^
    -v cycledesign-npm_cache:/root/.npm ^
    cycledesign-persistent

if errorlevel 1 (
    echo.
    echo ERROR: Failed to start container.
    echo Make sure the Docker image is built:
    echo   docker build -t cycledesign-persistent -f ..\.qwen\sandbox.Dockerfile.persistent ..
    exit /b 1
)

echo.
echo ============================================
echo   CycleDesign Sandbox Started Successfully!
echo ============================================
echo.
echo Access points:
echo   Web server:     http://localhost:3000
echo   API server:     http://localhost:3001
echo   Preview server: http://localhost:3002
echo   VNC web:        http://localhost:5800
echo   VNC client:     localhost:5900
echo.
echo Open http://localhost:3000 in your browser!
echo.
echo To use Qwen Code in the sandbox:
echo   QWEN_SANDBOX=docker qwen
echo.
echo To stop the sandbox:
echo   scripts\sandbox-stop.bat
echo   or: docker stop cycledesign-sandbox
echo.
echo To view logs:
echo   docker logs cycledesign-sandbox
echo ============================================

endlocal
