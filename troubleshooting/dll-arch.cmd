@ECHO off
SETLOCAL EnableDelayedExpansion

FOR /F %%d IN ('dir /s /b ..\lua\*.dll') DO (
    CALL :getarch %%d
)

GOTO :eof

:getarch
file "%*" | findstr 80386 > NUL
IF %errorlevel%==0 (
    ECHO %*	32-bit
) ELSE (
    ECHO %*	64-bit
)
GOTO :eof