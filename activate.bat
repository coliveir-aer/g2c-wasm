@echo off
REM This script activates the project environment for the current session.
REM It assumes tools have been set up by install-git.bat.

set "TOOLS_DIR=%~dp0tools"
set "GIT_HOME=%TOOLS_DIR%\PortableGit"

if not exist "%GIT_HOME%\bin" (
    echo ERROR: Portable Git not found. Please run install-git.bat first.
    pause
    goto :EOF
)

set "PATH=%GIT_HOME%\bin;%PATH%"

echo GFS Data Explorer environment is now active in this terminal.