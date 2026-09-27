@echo off
title Kazi Connect API
cd /d "%~dp0"

rem Use Node.js from the computer, or a portable Node.js unzipped inside this folder.
where node >nul 2>nul
if not errorlevel 1 goto havenode
set "NODEDIR="
for /r %%F in (node.exe) do if exist "%%F" if not defined NODEDIR set "NODEDIR=%%~dpF"
if defined NODEDIR set "PATH=%NODEDIR%;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Unzip the Windows .zip of Node.js from nodejs.org into this folder, then run this again.
  pause
  exit /b
)
:havenode

if not exist package.json (
  echo package.json is missing. Put this file inside the api folder and run it from there.
  pause
  exit /b
)

echo Step 1 of 3: installing packages...
call npm install
if errorlevel 1 (
  echo npm install failed. If the message mentions ETIMEDOUT or CERT, connect to your phone hotspot and run this again.
  pause
  exit /b
)

echo.
echo Step 2 of 3: checking every endpoint against openapi.yaml, with good and bad input...
call npm run verify

echo.
echo Step 3 of 3: starting the server. Swagger UI will open in your browser in a few seconds.
echo Keep this window open while you work. Close it, or press Ctrl+C, to stop the server.
start "" /min cmd /c "ping -n 4 127.0.0.1 >nul & start http://localhost:3000/docs"
call npm start
pause
