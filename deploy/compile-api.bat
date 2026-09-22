@echo off
REM ============================================================
REM  z1-api cross-compile only  (Windows host -> linux/arm64 binary)
REM
REM  Why this exists:
REM    The Raspberry Pi is the only arm64 machine in the loop, so the
REM    IMAGE is built there natively (fast, no QEMU emulation). That means
REM    the Windows host / CI runner only needs to produce the BINARY.
REM
REM    Go cross-compiles to arm64 from x86 natively, so this step is
REM    seconds instead of the minutes a QEMU image build would take.
REM
REM  Output:  life-assisitant-api\build\server   (ELF aarch64, static)
REM
REM  Then the Pi packages it (see deploy\remote-deploy.sh "build" mode).
REM  NOTE: comments are English-only on purpose (Chinese in .bat breaks under GBK).
REM ============================================================
setlocal

REM repo root = parent of this script's folder (%~dp0 ends with a backslash)
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "APIDIR=%ROOT%\life-assisitant-api"

if not exist "%APIDIR%\go.mod" (
    echo [ERROR] not a Go module: %APIDIR%
    goto :fail
)

pushd "%APIDIR%"

set "OUT=build\server"

echo [1/1] Cross-compiling Go binary for linux/arm64 ...
set GOOS=linux
set GOARCH=arm64
set CGO_ENABLED=0

REM -trimpath       : strip local build paths (reproducible)
REM -s -w           : strip symbol table + DWARF (smaller binary)
REM -X main.buildVersion : stamp the commit so the container log tells you
REM                    which build is live (falls back to "dev" if unset)
if "%BUILD_VERSION%"=="" set "BUILD_VERSION=dev"
go build -trimpath -ldflags "-s -w -X main.buildVersion=%BUILD_VERSION%" -o "%OUT%" .\cmd\server
if errorlevel 1 (
    echo [ERROR] go build failed
    popd
    goto :fail
)

for %%A in ("%OUT%") do echo       ok: %%~fA  (%%~zA bytes)
popd

echo ============================================================
echo   COMPILE OK  (build=%BUILD_VERSION%)
echo ============================================================
endlocal
exit /b 0

:fail
echo COMPILE FAILED
endlocal
exit /b 1
