@echo off
title CTL Dashboard - Local Server
echo.
echo  CTL Dashboard - Local network server
echo  ====================================
echo.
cd /d "%~dp0"

REM Show this PC's IP for other computers (non-loopback IPv4)
for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress" 2^>nul`) do set LOCAL_IP=%%a
if defined LOCAL_IP (
  echo  Use this URL on the OTHER computer:  http://%LOCAL_IP%:8080
  echo     or with Node port:                http://%LOCAL_IP%:3000
  echo.
)

REM Try Python 3 first (most common on Windows 10/11)
where python >nul 2>nul
if %errorlevel% equ 0 (
  echo  Starting server on port 8080 (listening on all network interfaces)...
  echo.
  echo  On this computer:     http://localhost:8080
  if defined LOCAL_IP echo  On other computers:  http://%LOCAL_IP%:8080
  echo.
  echo  If the other PC cannot connect, allow Python in Windows Firewall when prompted.
  echo  Press Ctrl+C to stop the server.
  echo.
  python -m http.server 8080 --bind 0.0.0.0
  goto :eof
)

REM Fallback: try Node (npx serve) - listen on all interfaces
where npx >nul 2>nul
if %errorlevel% equ 0 (
  echo  Starting server on port 3000 (listening on all network interfaces)...
  echo.
  echo  On this computer:     http://localhost:3000
  if defined LOCAL_IP echo  On other computers:  http://%LOCAL_IP%:3000
  echo.
  echo  If the other PC cannot connect, allow Node in Windows Firewall when prompted.
  echo  Press Ctrl+C to stop the server.
  echo.
  npx -y serve -l 3000 --no-clipboard
  goto :eof
)

echo  No server found. Install one of:
echo    - Python 3:  https://www.python.org/downloads/
echo    - Node.js:   https://nodejs.org/
echo.
pause
