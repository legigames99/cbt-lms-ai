@echo off
set "PATH=C:\Windows\System32;C:\Windows;C:\Program Files\nodejs;%PATH%"

title CBT and LMS AI Server
color 0A

echo ============================================================================
echo   SISTEM CBT DAN LMS TERINTEGRASI AI - HIGH-CONCURRENCY EDITION
echo   Target: 1.700 Siswa Serentak - Server 4 Core CPU dan 4GB RAM
echo ============================================================================
echo.

cd /d "%~dp0"

if exist "C:\Program Files\Go\bin\go.exe" goto RUN_GO
if exist "C:\Program Files\nodejs\node.exe" goto RUN_NODE_DIRECT

goto RUN_NODE_PATH

:RUN_GO
echo [INFO] Terdeteksi Golang. Menjalankan backend Go natif...
"C:\Program Files\Go\bin\go.exe" run ./cmd/server/main.go
goto END

:RUN_NODE_DIRECT
echo [INFO] Menjalankan Server CBT menggunakan Node.js...
"C:\Program Files\nodejs\node.exe" server.js
goto END

:RUN_NODE_PATH
echo [INFO] Mencoba menjalankan dengan node di PATH...
node server.js
goto END

:END
echo.
pause
