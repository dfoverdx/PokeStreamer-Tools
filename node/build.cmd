@ECHO off
SETLOCAL EnableDelayedExpansion

REM Check if we need to install node modules
IF NOT EXIST "node_modules" (
    ECHO The node_modules directory does not exist.  Installing.
    SET install=true
) ELSE IF "%~1"=="-i" (
    SET install=true
) ELSE IF "%~1"=="--install" (
    SET install=true
) ELSE (
    CALL .\node_modules\.bin\webpack --version > NUL
    IF %errorlevel% NEQ 0 (
        ECHO [33mWebpack is not installed.[0m  Installing.
        SET install=true
    )
)

IF "%install%"=="true" ( 
    CALL npm --version > NUL
    IF %errorlevel% NEQ 0 (
        ECHO [31mNPM is not installed.[0m  Install node from https://nodejs.org/en/download.
        CHOICE /n /m "Open in browser? [Y] or [N]"
        IF errorlevel 2 ( EXIT /B 1 )
        IF errorlevel 1 ( explorer.exe https://nodejs.org/en/download )
        EXIT /B 1
    )

    CALL npm install --save
    IF %errorlevel% NEQ 0 (
        ECHO [31mInstallation failed.[0m  May the force be with you in your troubleshooting!
        EXIT /B 1
    )
)

REM Run webpack to build app
ECHO Building...
CALL npm run build
IF %errorlevel% NEQ 0 (
    ECHO [31mBuild failed.[0m
    ECHO Run [32mnpm install[0m if you have not already.  Otherwise, may the force be with you in your troubleshooting!
    EXIT /B 1
)