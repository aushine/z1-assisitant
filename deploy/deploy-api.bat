@echo off
REM ============================================================
REM  Z1 single-end release:  BACKEND API container only
REM
REM  Cross-compiles the Go binary (linux/arm64), ships it plus the
REM  Dockerfile to the Pi, rebuilds the z1-api image natively there
REM  and recreates the container. Touches NOTHING on the frontend:
REM  /var/www/z1 and /var/www/z1-app are left exactly as they are.
REM
REM  Siblings:
REM     deploy-z1.bat       desktop frontend only (z1 -> /z1/)
REM     deploy-z1-app.bat   mobile frontend only  (z1-app -> /z1-app/)
REM     deploy.bat          everything (desktop + mobile + api)
REM
REM  This is the same two-step path deploy.bat --api takes, and it
REM  reuses remote-deploy.sh (build + api modes) on purpose so the
REM  image build stays identical to the CI path. remote-deploy.sh
REM  itself is not modified.
REM
REM  Usage:  deploy-api.bat
REM  NOTE: comments are English-only on purpose (Chinese in .bat breaks under GBK).
REM ============================================================
setlocal

REM ---------- config (keep in sync with deploy.bat) ----------
set "PI_HOST=192.168.101.75"
set "PI_USER=hewl"
set "PI_DIR=/opt/z1-deploy"
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

REM Stamp the build with the current git commit so the container
REM startup log tells you which revision is live (same as deploy.bat).
set "BUILD_VERSION=dev"
for /f "delims=" %%H in ('git -C "%ROOT%" rev-parse --short HEAD 2^>nul') do set "BUILD_VERSION=%%H"

echo ============================================================
echo   Z1 Release  [API only]   build=%BUILD_VERSION%
echo   Pi: %PI_USER%@%PI_HOST%   image: z1-api:latest
echo ============================================================
echo.

REM ---------- 1. backend binary (arm64) ----------
echo [1/3] Cross-compiling backend arm64 binary (build=%BUILD_VERSION%) ...
REM compile-api.bat inherits BUILD_VERSION from this shell.
call "%~dp0compile-api.bat"
if errorlevel 1 ( echo [ERROR] backend compile failed & goto :fail )
echo       ok.
echo.

REM ---------- 2. upload ----------
echo [2/3] Uploading binary + image build context to Pi ...
ssh %PI_USER%@%PI_HOST% "mkdir -p %PI_DIR%/build"
if errorlevel 1 ( echo [ERROR] ssh mkdir failed & goto :fail )
scp "%ROOT%\life-assisitant-api\build\server" %PI_USER%@%PI_HOST%:%PI_DIR%/build/server
if errorlevel 1 ( echo [ERROR] scp build/server failed & goto :fail )
scp "%ROOT%\life-assisitant-api\Dockerfile.arm64" %PI_USER%@%PI_HOST%:%PI_DIR%/Dockerfile.arm64
if errorlevel 1 ( echo [ERROR] scp Dockerfile.arm64 failed & goto :fail )
scp "%~dp0remote-deploy.sh" %PI_USER%@%PI_HOST%:%PI_DIR%/remote-deploy.sh
if errorlevel 1 ( echo [ERROR] scp remote-deploy.sh failed & goto :fail )
echo       ok.
echo.

REM ---------- 3. remote image build + container recreate ----------
REM "build" must run BEFORE "api": api loads dist/z1-api.tar, and the
REM tar is produced by build. remote-deploy.sh performs its own health
REM checks (direct :8090 and via nginx) at the end.
echo [3/3] Building image on Pi and recreating z1-api ...
ssh %PI_USER%@%PI_HOST% "cd %PI_DIR% && chmod +x remote-deploy.sh && NO_COLOR=1 GITHUB_SHA=%BUILD_VERSION% ./remote-deploy.sh build"
if errorlevel 1 ( echo [ERROR] remote image build failed & goto :fail )
ssh %PI_USER%@%PI_HOST% "cd %PI_DIR% && NO_COLOR=1 GITHUB_SHA=%BUILD_VERSION% ./remote-deploy.sh api"
if errorlevel 1 ( echo [ERROR] remote deploy failed & goto :fail )

echo.
echo ============================================================
echo   RELEASE OK  [API only]   build=%BUILD_VERSION%
echo   api: https://voz21.cn/z1/api/v1/health
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
