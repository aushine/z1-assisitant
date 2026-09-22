@echo off
REM ============================================================
REM  Z1 single-end release:  MOBILE frontend only  (z1-app -> /z1-app/)
REM
REM  Builds life-assisitant-ui-mobile, uploads dist/z1-app to the Pi,
REM  swaps /var/www/z1-app and reloads nginx. Touches NOTHING else:
REM  the desktop site (z1) and the API container are left exactly as
REM  they are. Use this when only the mobile UI changed.
REM
REM  Siblings:
REM     deploy-z1.bat       desktop frontend only (z1 -> /z1/)
REM     deploy-api.bat      backend container only
REM     deploy.bat          everything (desktop + mobile + api)
REM
REM  Why the swap is inlined here instead of calling remote-deploy.sh:
REM    remote-deploy.sh only knows ui / api / all, and its "ui" mode
REM    swaps BOTH fronts (it aborts if either staging dir is absent).
REM    So a single-front swap is done directly over ssh here. This
REM    keeps remote-deploy.sh untouched, at the cost of duplicating
REM    its swap logic below -- if that logic ever changes, update
REM    this file too.
REM
REM  Usage:  deploy-z1-app.bat
REM  NOTE: comments are English-only on purpose (Chinese in .bat breaks under GBK).
REM ============================================================
setlocal

REM ---------- config (keep in sync with deploy.bat) ----------
set "PI_HOST=192.168.101.75"
set "PI_USER=hewl"
set "PI_DIR=/opt/z1-deploy"
set "WEB_DIR=/var/www/z1-app"
set "BASE=/z1-app"
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

REM Stamp the build with the current git commit (same as deploy.bat).
set "BUILD_VERSION=dev"
for /f "delims=" %%H in ('git -C "%ROOT%" rev-parse --short HEAD 2^>nul') do set "BUILD_VERSION=%%H"

echo ============================================================
echo   Z1 Release  [MOBILE only]   build=%BUILD_VERSION%
echo   Pi: %PI_USER%@%PI_HOST%   web: %WEB_DIR%
echo ============================================================
echo.

REM ---------- 1. mobile UI ----------
echo [1/3] Building mobile UI ...
pushd "%ROOT%\life-assisitant-ui-mobile"
call npm.cmd run build
if errorlevel 1 ( echo [ERROR] mobile build failed & popd & goto :fail )
popd
echo       ok.
echo.

REM ---------- 2. upload ----------
echo [2/3] Uploading mobile static to Pi ...
ssh %PI_USER%@%PI_HOST% "mkdir -p %PI_DIR%/dist"
if errorlevel 1 ( echo [ERROR] ssh mkdir failed & goto :fail )
scp -r "%ROOT%\dist\z1-app" %PI_USER%@%PI_HOST%:%PI_DIR%/dist/
if errorlevel 1 ( echo [ERROR] scp z1-app failed & goto :fail )
echo       ok.
echo.

REM ---------- 3. swap + reload nginx ----------
REM Mirrors remote-deploy.sh: best-effort backup to <dir>.bak, then
REM rm -rf the live dir and re-copy the fresh build, then reload nginx.
echo [3/3] Swapping %WEB_DIR% and reloading nginx ...
ssh %PI_USER%@%PI_HOST% "sudo -n rm -rf %WEB_DIR%.bak; sudo -n cp -r %WEB_DIR% %WEB_DIR%.bak; sudo -n rm -rf %WEB_DIR% && sudo -n cp -r %PI_DIR%/dist/z1-app %WEB_DIR% && sudo -n nginx -t && sudo -n systemctl reload nginx"
if errorlevel 1 ( echo [ERROR] remote swap or nginx reload failed & goto :fail )
echo       ok.
echo.

REM ---------- 4. verify ----------
REM entry reachable through nginx + base path really present in the
REM served index.html (catches the /z1-app/ base-path white-screen class).
echo Verifying ...
ssh %PI_USER%@%PI_HOST% "curl -fsS --max-time 8 -o /dev/null http://127.0.0.1%BASE%/ && grep -q %BASE%/assets/ %WEB_DIR%/index.html && echo VERIFY_OK"
if errorlevel 1 ( echo [ERROR] verification failed - check %WEB_DIR% and nginx & goto :fail )

echo.
echo ============================================================
echo   RELEASE OK  [MOBILE only]   build=%BUILD_VERSION%
echo   mobile : https://voz21.cn/z1-app/
echo   (press Ctrl+Shift+R in browser to bypass cache)
echo ============================================================
endlocal
echo.
pause
exit /b 0

:fail
echo.
echo ============================================================
echo   RELEASE FAILED - see error above
echo ============================================================
endlocal
echo.
pause
exit /b 1
