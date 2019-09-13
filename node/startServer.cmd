@ECHO off
SETLOCAL EnableDelayedExpansion

CALL node --version > NUL
IF %errorlevel% NEQ 0 (
    ECHO [31mNPM is not installed.[0m  Install node from https://nodejs.org/en/download.
    CHOICE /n /m "Open in browser? [Y] or [N]"
    IF errorlevel 2 ( EXIT /B 1 )
    IF errorlevel 1 ( explorer.exe https://nodejs.org/en/download )
    EXIT /B 1
)

FOR /F "tokens=1-3 delims=v. USEBACKQ" %%F IN (`node --version`) DO (
    SET /a X=%%F
    SET /a Y=%%G
    SET /a Z=%%H
    IF !X! LSS 8 (
        SET warn=v%%F.%%G.%%H
    ) ELSE IF !X! EQU 8 IF !Y! LSS 9 (
        SET warn=v%%F.%%G.%%H
    ) ELSE IF !X! EQU 8 IF !Y! EQU 9 IF !Z! LSS 4 (
        SET warn=v%%F.%%G.%%H
    )
)

IF "%warn%" NEQ "" (
    ECHO [33mWARNING:[0m  It appears that node version 8.9.4 or higher is not installed.
    ECHO Current version: %warn%
)

npm start