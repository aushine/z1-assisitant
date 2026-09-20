@echo off
REM ============================================================
REM  z1-api build script  (Windows host -> linux/arm64 docker tar)
REM
REM  Steps:
REM    1. Cross-compile Go binary   (GOOS=linux GOARCH=arm64 CGO=0)
REM    2. docker build (arm64)      (uses Dockerfile.arm64, binary-only image)
REM    3. docker save               (-> ..\dist\z1-api.tar)
REM
REM  Output layout (three-end bundle in repo root ./dist):
REM    ..\dist\z1-api.tar   this script
REM    ..\dist\z1\          desktop UI  (npm run build in life-assisitant-ui-desktop)
REM    ..\dist\z1-app\      mobile  UI  (npm run build in life-assisitant-ui-mobile)
REM
REM  Load on arm64 server:  docker load -i z1-api.tar
REM  Run:  docker run -d -p 8090:8090 -e GF_DATABASE_DEFAULT_LINK="..." ^
REM              -v z1-uploads:/app/data/uploads --name z1-api z1-api:latest
REM
REM  NOTE: comments in this file are English-only on purpose.
REM        Chinese text in .bat breaks under the default GBK codepage.
REM ============================================================
setlocal
cd /d "%~dp0"

set "IMAGE_NAME=z1-api"
set "IMAGE_TAG=latest"
set "BIN_DIR=build"
set "OUT_DIR=..\dist"
set "TAR_PATH=%OUT_DIR%\z1-api.tar"

echo [1/3] Cross-compiling Go binary for linux/arm64 ...
set GOOS=linux
set GOARCH=arm64
set CGO_ENABLED=0
go build -trimpath -ldflags "-s -w" -o %BIN_DIR%\server .\cmd\server
if errorlevel 1 (
    echo [ERROR] go build failed
    goto :fail
)
echo       ok: %BIN_DIR%\server

echo [2/3] Building docker image %IMAGE_NAME%:%IMAGE_TAG% (linux/arm64) ...
docker build -f Dockerfile.arm64 --platform linux/arm64 -t %IMAGE_NAME%:%IMAGE_TAG% .
if errorlevel 1 (
    echo [ERROR] docker build failed - is Docker Desktop running
    goto :fail
)
echo       ok: image %IMAGE_NAME%:%IMAGE_TAG%

echo [3/3] Saving image to %TAR_PATH% ...
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
docker save -o "%TAR_PATH%" %IMAGE_NAME%:%IMAGE_TAG%
if errorlevel 1 (
    echo [ERROR] docker save failed
    goto :fail
)

echo.
echo ============================================================
echo   BUILD OK
for %%A in ("%TAR_PATH%") do echo   tar: %%~fA  (%%~zA bytes)
echo   verify arch: docker inspect %IMAGE_NAME%:%IMAGE_TAG% --format "{{.Os}}/{{.Architecture}}"
echo ============================================================
endlocal
exit /b 0

:fail
echo BUILD FAILED
endlocal
exit /b 1
