@echo off
rem Compatibility entry: all build rules live in scripts/build.cjs.
call "%~dp0..\build.bat" %*
exit /b %errorlevel%