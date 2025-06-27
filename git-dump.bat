@echo off
setlocal enabledelayedexpansion

REM This script finds and dumps all non-binary, Git-tracked files.

set "outputFile=project_context_git.txt"
echo Creating Git-based context dump: %outputFile%...
echo.

REM Verify the script is running inside a Git repository.
git rev-parse --is-inside-work-tree >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] This is not a Git repository. Script aborted.
    pause
    goto :eof
)

REM If a previous dump file exists, create a timestamped backup.
if exist "%outputFile%" (
    REM Use PowerShell to generate a clean, sortable timestamp (e.g., 20250621_013700)
    FOR /F "tokens=*" %%t IN ('powershell -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"') DO (
        set "timestamp=%%t"
    )
    set "backupFile=%outputFile%.!timestamp!.bak"
    echo [INFO] Found existing output file. Backing it up to !backupFile!
    ren "%outputFile%" "!backupFile!"
)

REM Create the new output file with a header.
> "%outputFile%" echo REM --- Git-Tracked Files Dump ^| %date% %time% ---

REM Define known text file types to include in the dump.
set "knownTextExtensions=.bat .sh .c .h .hh .html .css .js .json .txt .md .gitignore .gitattributes .gitmodules"

FOR /F "delims=" %%f IN ('git ls-files') DO (
    set "isText=0"
    for %%e in (%knownTextExtensions%) do (
        if /i "%%~xf" == "%%e" (
            set "isText=1"
        )
    )
    if /i "%%~nxf" == "Dockerfile" set "isText=1"
    if /i "%%~nxf" == "CMakeLists.txt" set "isText=1"

    if "!isText!" == "1" (
        set "filepath=%%f"
        set "filepath=!filepath:/=\!"
        call :type_file "%%f" "!filepath!"
    ) else (
        echo   [Skipping Binary] %%f
    )
)

goto :end_script

:type_file
    echo   [Dumping Text]  %~1
    echo. >> "%outputFile%"
    echo ====================================================================== >> "%outputFile%"
    echo == FILE: %~1 >> "%outputFile%"
    echo ====================================================================== >> "%outputFile%"
    echo. >> "%outputFile%"
    type "%~2" >> "%outputFile%"
    echo. >> "%outputFile%"
goto :eof

:end_script
echo.
echo =========================================================
echo  All done! Context has been written to: %outputFile%
echo =========================================================
echo.
pause