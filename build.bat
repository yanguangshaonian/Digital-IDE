@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo ERROR: Install Node.js 22 or newer and restart the terminal. & exit /b 1)
node scripts/build.cjs %*
exit /b %errorlevel%