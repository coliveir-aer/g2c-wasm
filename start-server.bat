@echo off
setlocal

:: --- This script handles both SETUP and RUN for the Node.js web server ---

:: --- Configuration ---
set "NODE_VERSION=v20.14.0"
set "NODE_DIST_URL=https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip"
set "TOOLS_DIR=%CD%\tools"
set "NODE_DIR=%TOOLS_DIR%\node-%NODE_VERSION%-win-x64"
set "NODE_ZIP_FILE=%TOOLS_DIR%\node.zip"
set "HTTP_SERVER_PORT=8080"
set "SERVE_DIR=.\work"


:: --- Main Logic ---

:: Check if http-server is already installed locally
if exist "%CD%\node_modules\.bin\http-server.cmd" (
    goto :run_application
)


:: --- If not ready, prompt user to begin the full setup ---
echo.
echo [INFO] Local web server not found or incomplete.
:prompt
set /p "userInput=Would you like to run the installation process now? (y/n): "
if /i "%userInput%"=="y" ( goto :run_setup )
if /i "%userInput%"=="n" (
    echo [INFO] Setup canceled by user.
    goto :error_exit
)
echo [ERROR] Invalid input. Please enter 'y' or 'n'.
goto :prompt


:run_setup
:: This section runs only if the user agrees to the setup prompt
echo.
echo [INFO] Starting one-time setup...
echo [INFO] This may take several minutes.
echo.
:: 1. Create tools directory
if not exist "%TOOLS_DIR%" (
    echo [SETUP] Creating tools directory...
    mkdir "%TOOLS_DIR%"
)

:: 2. Download and Extract Node.js if it's not already there
if exist "%NODE_DIR%\node.exe" (
    echo [SETUP] Local Node.js found. Skipping download.
) else (
    echo [SETUP] Downloading Node.js from %NODE_DIST_URL%...
    powershell -Command "(New-Object System.Net.WebClient).DownloadFile('%NODE_DIST_URL%', '%NODE_ZIP_FILE%')" || goto :error_exit
    echo [SETUP] Extracting Node.js to %TOOLS_DIR%...
    powershell -Command "Expand-Archive -Path '%NODE_ZIP_FILE%' -DestinationPath '%TOOLS_DIR%'" || goto :error_exit
    del "%NODE_ZIP_FILE%"
)

:: 3. Set the PATH for the rest of THIS script's execution
echo [SETUP] Activating local Node.js environment...
set "PATH=%NODE_DIR%;%PATH%"

:: 4. Verify Node.js and npm
echo [SETUP] Verifying Node.js and npm versions...
call node -v
call npm -v
echo.
:: 5. Install http-server locally
echo [SETUP] Installing http-server locally with 'npm install http-server'...
call npm install http-server
if %errorlevel% neq 0 (
    echo [FATAL ERROR] 'npm install http-server' failed. Please check errors above.
    goto :error_exit
)
echo [SETUP] http-server installed successfully.
echo.

echo #######################################################
echo # One-Time Setup Complete!
echo #######################################################
echo.
goto :run_application


:run_application
:: This section runs EITHER after a successful setup OR immediately if setup was already done.
:: The PATH needs to be set here as well for subsequent runs.
set "PATH=%NODE_DIR%;%PATH%"

echo [INFO] Starting local web server for the project root directory...
echo [INFO] Access your application at: http://localhost:%HTTP_SERVER_PORT%/
echo [INFO] Press CTRL+C in this window to stop the server.
echo.
:: Use npx to run the locally installed http-server
call npx http-server %SERVE_DIR% -p %HTTP_SERVER_PORT% --cors

if %errorlevel% neq 0 (
    echo [ERROR] The local web server failed to start.
    goto :error_exit
)

goto :eof


:error_exit
echo.
echo [FAILURE] The script encountered an error or was canceled.
echo Please review the messages above to diagnose the issue.
echo The window will not close until you press a key.
pause
exit /b 1