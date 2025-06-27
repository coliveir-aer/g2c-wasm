:: /install_git.bat
@echo off
setlocal

:: --- Configuration ---
set "GIT_VERSION=2.45.1"
set "GIT_URL=https://github.com/git-for-windows/git/releases/download/v%GIT_VERSION%.windows.1/PortableGit-%GIT_VERSION%-64-bit.7z.exe"
set "TOOLS_DIR=%CD%\tools"
set "GIT_DIR=%TOOLS_DIR%\PortableGit"
set "GIT_EXE_FILE=%TOOLS_DIR%\PortableGit.exe"

echo.
echo #######################################################
echo # Local Git for Windows - Installer
echo #######################################################
echo.

:: --- Step 1: Check for and create tools directory ---
if not exist "%TOOLS_DIR%" (
    echo [INFO] Creating tools directory: %TOOLS_DIR%
    mkdir "%TOOLS_DIR%"
)

:: --- Step 2: Download and Extract PortableGit (if not already present) ---
if exist "%GIT_DIR%\bin\git.exe" (
    echo [INFO] Local Git installation found. Skipping installation.
    goto :success
)

echo [SETUP] Local Git not found.
echo [SETUP] Downloading PortableGit v%GIT_VERSION%...
echo [SETUP] From: %GIT_URL%

:: Use PowerShell to download the file.
powershell -Command "(New-Object System.Net.WebClient).DownloadFile('%GIT_URL%', '%GIT_EXE_FILE%')"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to download PortableGit. Please check your internet connection.
    goto :error_exit
)

echo [SETUP] Download complete. Extracting...
echo [INFO] This may take a moment.

:: The downloaded file is a self-extracting archive. We run it silently.
:: -o sets the output directory.
:: -y assumes "yes" to all prompts.
"%GIT_EXE_FILE%" -o"%GIT_DIR%" -y
if %errorlevel% neq 0 (
    echo [ERROR] Failed to extract PortableGit.
    del "%GIT_EXE_FILE%"
    goto :error_exit
)

echo [SETUP] Extraction complete. Cleaning up...
del "%GIT_EXE_FILE%"

:success
echo.
echo #######################################################
echo # Git has been successfully installed locally!
echo #######################################################
echo.
echo You can now use Git commands by running 'cmd_windows.bat'.
echo.
echo Press any key to exit.
pause
goto :eof

:error_exit
echo.
echo [FAILURE] The Git installation encountered an error.
echo Please review the messages above.
pause
goto :eof

endlocal