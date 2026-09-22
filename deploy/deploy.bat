@echo off
REM ============================================================
REM  Z1 one-click release script  (Windows host -> Raspberry Pi)
REM
REM  Flow:
REM    1. Build desktop UI  (vite build, base baked into vite.config)
REM    2. Build mobile  UI  (vite build, base baked into vite.config)
REM    3. Cross-compile backend arm64 BINARY (compile-api.bat)
REM    4. scp artifacts to Pi (/opt/z1-deploy/)
REM    5. ssh run remote-deploy.sh on Pi:
REM         - "build" mode: package z1-api:latest from the shipped binary
REM           natively on arm64 (no QEMU, seconds)
REM         - "all"   mode: load image + swap static + restart + verify
REM
REM  Why the image is built on the Pi:
REM    The Pi is the only arm64 machine here. Building the image there is
REM    native and fast, whereas building it on this x86 host would need
REM    QEMU emulation inside Docker. Go cross-compiles to arm64 natively,
REM    so this host only has to produce the binary.
REM    This mirrors .github/workflows/ci-cd.yml exactly, so the manual path
REM    and the CI path stay behaviourally identical.
REM
REM  Usage:  deploy.bat            full release (all three ends)
REM          deploy.bat --ui       frontend only (skip backend build & image load)
REM          deploy.bat --api      backend only  (skip frontend build)
REM
REM  NOTE: comments are English-only on purpose (Chinese in .bat breaks under GBK).
REM ============================================================
setlocal enabledelayedexpansion

REM ---------- config (edit if your env changes) ----------
set "PI_HOST=192.168.101.75"
set "PI_USER=hewl"
set "PI_DIR=/opt/z1-deploy"
REM %~dp0 ends with a backslash (e.g. D:\repo\deploy\). Strip the trailing
REM backslash, then take its parent -> repo root. Do NOT use :\..= substitution
REM (it leaves the deploy folder in the path).
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "MODE=%~1"

if "%MODE%"=="" set "MODE=all"

REM Stamp the build with the current git commit so the container startup log
REM tells you which revision is live. Falls back to "dev" outside a repo.
set "BUILD_VERSION=dev"
for /f "delims=" %%H in ('git -C "%ROOT%" rev-parse --short HEAD 2^>nul') do set "BUILD_VERSION=%%H"

echo ============================================================
echo   Z1 Release  (mode=%MODE%, build=%BUILD_VERSION%)
echo   Pi: %PI_USER%@%PI_HOST%:%PI_DIR%
echo ============================================================
echo.

REM ---------- 1. desktop UI ----------
if "%MODE%"=="--api" goto :skip_desktop
echo [1/5] Building desktop UI ...
pushd "%ROOT%\life-assisitant-ui-desktop"
call npm.cmd run build
if errorlevel 1 ( echo [ERROR] desktop build failed & popd & goto :fail )
popd
echo       ok.
echo.

REM ---------- 2. mobile UI ----------
echo [2/5] Building mobile UI ...
pushd "%ROOT%\life-assisitant-ui-mobile"
call npm.cmd run build
if errorlevel 1 ( echo [ERROR] mobile build failed & popd & goto :fail )
popd
echo       ok.
echo.
goto :build_backend

:skip_desktop
echo [1-2/5] UI build skipped (--api mode).
echo.

:build_backend
REM ---------- 3. backend binary ----------
if "%MODE%"=="--ui" goto :skip_backend
echo [3/5] Cross-compiling backend arm64 binary (build=%BUILD_VERSION%) ...
REM compile-api.bat inherits BUILD_VERSION from this shell (setlocal inherits
REM the parent environment), so the version stamp carries through.
call "%~dp0compile-api.bat"
if errorlevel 1 ( echo [ERROR] backend compile failed & goto :fail )
echo       ok.
echo.
goto :upload

:skip_backend
echo [3/5] Backend compile skipped (--ui mode).
echo.

:upload
REM ---------- 4. scp to Pi ----------
echo [4/5] Uploading to Pi ...
if "%MODE%"=="--api" goto :upload_api_only

REM frontend static
scp -r "%ROOT%\dist\z1"     %PI_USER%@%PI_HOST%:%PI_DIR%/dist/
if errorlevel 1 ( echo [ERROR] scp z1 failed & goto :fail )
scp -r "%ROOT%\dist\z1-app" %PI_USER%@%PI_HOST%:%PI_DIR%/dist/
if errorlevel 1 ( echo [ERROR] scp z1-app failed & goto :fail )

:upload_api_only
REM backend binary + image build context (needed unless --ui)
if "%MODE%"=="--ui" goto :upload_scripts

REM ssh mkdir first: scp cannot create missing intermediate directories
ssh %PI_USER%@%PI_HOST% "mkdir -p %PI_DIR%/build"
if errorlevel 1 ( echo [ERROR] ssh mkdir failed & goto :fail )

scp "%ROOT%\life-assisitant-api\build\server" %PI_USER%@%PI_HOST%:%PI_DIR%/build/server
if errorlevel 1 ( echo [ERROR] scp build/server failed & goto :fail )

scp "%ROOT%\life-assisitant-api\Dockerfile.arm64" %PI_USER%@%PI_HOST%:%PI_DIR%/Dockerfile.arm64
if errorlevel 1 ( echo [ERROR] scp Dockerfile.arm64 failed & goto :fail )

:upload_scripts
REM deploy scripts
scp "%~dp0remote-deploy.sh" %PI_USER%@%PI_HOST%:%PI_DIR%/remote-deploy.sh
if errorlevel 1 ( echo [ERROR] scp remote-deploy.sh failed & goto :fail )
echo       ok.
echo.

REM ---------- 5. remote build + deploy ----------
echo [5/5] Running remote deploy on Pi ...

REM Backend: build the image natively on the Pi from the shipped binary first.
if "%MODE%"=="--ui" goto :remote_deploy
ssh %PI_USER%@%PI_HOST% "cd %PI_DIR% && GITHUB_SHA=%BUILD_VERSION% ./remote-deploy.sh build"
if errorlevel 1 ( echo [ERROR] remote image build failed & goto :fail )

:remote_deploy
set "REMOTE_MODE=all"
if "%MODE%"=="--ui"  set "REMOTE_MODE=ui"
if "%MODE%"=="--api" set "REMOTE_MODE=api"
ssh %PI_USER%@%PI_HOST% "cd %PI_DIR% && chmod +x remote-deploy.sh && GITHUB_SHA=%BUILD_VERSION% ./remote-deploy.sh %REMOTE_MODE%"
if errorlevel 1 ( echo [ERROR] remote deploy failed & goto :fail )

echo.
echo ============================================================
echo   RELEASE OK  (build=%BUILD_VERSION%)
echo   desktop: https://voz21.cn/z1/
echo   mobile : https://voz21.cn/z1-app/
echo   (press Ctrl+Shift+R in browser to bypass cache)
echo ============================================================
endlocal
REM Keep the window open so a double-click run does not flash-and-close.
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

