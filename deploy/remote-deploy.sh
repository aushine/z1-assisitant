#!/usr/bin/env bash
# ============================================================
#  Z1 remote deploy (runs ON the Raspberry Pi)
#  Called by deploy.bat over ssh, by CI (GitHub Actions
#  self-hosted runner), or run manually:
#     cd /opt/z1-deploy && ./remote-deploy.sh [all|ui|api|build]
#
#  Modes:
#     all    (default) load image + swap static + reload nginx + verify
#     ui               swap static only (frontend release)
#     api              load image only (backend release)
#     build            IMAGE BUILD ONLY, no deploy: build z1-api:latest
#                      from ./build/server (pre-compiled arm64 binary)
#                      + Dockerfile.arm64, then docker save -> dist/z1-api.tar
#                      (used by CI: GitHub compiles the binary on x86,
#                       the Pi only packages+deploys it here, natively)
#
#  Steps: load image (api) -> swap static (ui) -> reload nginx -> verify
#  Data lives in /opt/mysql/data + /opt/z1-deploy/uploads : never touched.
#
#  Notes for non-interactive ssh / CI:
#   - Everything runs as user hewl (owns /opt/z1-deploy and /var/www/*).
#   - docker: hewl is in the `docker` group, so no sudo needed.
#   - nginx -t / systemctl need root -> use `sudo -n` (passwordless).
#     A bare `sudo` would block waiting for a password over a non-tty ssh.
#   - Set NO_COLOR=1 (CI does) to strip ANSI escapes from the log.
#   - Honors GITHUB_SHA to print which commit is being deployed.
# ============================================================
set -uo pipefail

MODE="${1:-all}"
DIR="/opt/z1-deploy"
COMPOSE="docker compose -f ${DIR}/docker-compose.prod.yml"
WEB_DESKTOP="/var/www/z1"
WEB_MOBILE="/var/www/z1-app"
STAMP="$(date +%F_%H%M%S)"

# ANSI colors only when attached to a terminal and NO_COLOR is unset.
# CI logs are plain text, so escapes would show up as literal garbage.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_CYAN='\033[36m'; C_GREEN='\033[32m'; C_RED='\033[31m'; C_OFF='\033[0m'
else
  C_CYAN=''; C_GREEN=''; C_RED=''; C_OFF=''
fi

log()  { echo -e "${C_CYAN}[deploy]${C_OFF} $*"; }
ok()   { echo -e "${C_GREEN}  ok${C_OFF} $*"; }
err()  { echo -e "${C_RED}[ERROR]${C_OFF} $*" >&2; }
die()  { err "$*"; exit 1; }

# GitHub Actions annotation: surfaces the error on the run summary page.
# No-op outside CI (the ::error:: prefix is meaningless but harmless).
ann() { [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::$*" || true; }
notice() { [ -n "${GITHUB_ACTIONS:-}" ] && echo "::notice::$*" || true; }

# sudo that never prompts (fail fast instead of hanging the ssh session)
sudo_n() { sudo -n "$@" || die "sudo -n failed for: $*  (needs passwordless sudo)"; }

cd "$DIR" || die "cannot cd $DIR"

log "mode=${MODE}  dir=${DIR}  stamp=${STAMP}"
[ -n "${GITHUB_SHA:-}" ] && log "commit=${GITHUB_SHA}  ref=${GITHUB_REF_NAME:-?}"

# ---------- 0. CI image build (Pi-native, no QEMU) ----------
# GitHub Actions cross-compiles build/server for linux/arm64 on an x86
# runner, ships it here, and we only wrap it into an image. Building on
# arm64 natively means Dockerfile.arm64's `RUN apk add` needs no emulation.
if [ "$MODE" = "build" ]; then
  log "[build] Packaging z1-api image from pre-compiled binary ..."
  [ -f "${DIR}/build/server" ] || die "build/server not found (ship the arm64 binary first)"
  [ -f "${DIR}/Dockerfile.arm64" ] || die "Dockerfile.arm64 not found"
  # Manifest/config files are OPTIONAL build context here: the image bakes
  # a default config.yaml, but production overrides it via the bind mount
  # in docker-compose.prod.yml. Missing files must not break the build.
  for f in manifest/config/config.yaml manifest/config/config-smp.yaml; do
    if [ ! -f "${DIR}/${f}" ]; then
      mkdir -p "$(dirname "${DIR}/${f}")"
      echo "# placeholder (prod config is bind-mounted)" > "${DIR}/${f}"
      log "  synthesized placeholder: ${f}"
    fi
  done

  arch=$(docker version --format '{{.Server.Arch}}' 2>/dev/null || echo "?")
  log "docker server arch: ${arch} (expect arm64/aarch64)"

  # ⚠️ The binary arrives via scp from Windows, where there is no executable
  # bit — so it lands as 0644 and `docker build`'s COPY would faithfully carry
  # 0644 into the image, making the entrypoint fail with
  # `exec: "./server": permission denied`.
  # Dockerfile.arm64 also has a `chmod +x` as a second line of defence; doing it
  # here as well keeps the build context itself correct and self-documenting.
  chmod +x "${DIR}/build/server" || die "chmod +x build/server failed"
  log "  build/server mode: $(stat -c '%a' "${DIR}/build/server" 2>/dev/null || echo '?')"

  docker build -f Dockerfile.arm64 -t z1-api:latest . || { ann "docker build failed"; die "docker build failed"; }
  ok "image built: z1-api:latest"

  # Verify the entrypoint really is executable inside the image. Catches the
  # permission-denied class of bug here instead of at container start.
  imgmode=$(docker run --rm --entrypoint stat z1-api:latest -c '%a' ./server 2>/dev/null || echo "")
  if [ -n "$imgmode" ]; then
    log "  /app/server mode in image: ${imgmode}"
    case "$imgmode" in
      *[1357]) ok "entrypoint is executable" ;;
      *) ann "entrypoint ./server is NOT executable (mode=${imgmode})"; die "image entrypoint ./server not executable (mode=${imgmode})" ;;
    esac
  fi

  mkdir -p "${DIR}/dist"
  docker save -o "${DIR}/dist/z1-api.tar" z1-api:latest || { ann "docker save failed"; die "docker save failed"; }
  ok "image saved: ${DIR}/dist/z1-api.tar ($(du -h "${DIR}/dist/z1-api.tar" | cut -f1))"

  notice "image build OK (arch=${arch})"
  exit 0
fi

# ---------- 1. backend image ----------
if [ "$MODE" = "all" ] || [ "$MODE" = "api" ]; then
  log "[1/4] Loading backend image ..."
  [ -f "${DIR}/dist/z1-api.tar" ] || { ann "dist/z1-api.tar not found"; die "dist/z1-api.tar not found"; }
  docker load -i "${DIR}/dist/z1-api.tar" || { ann "docker load failed"; die "docker load failed"; }
  ok "image loaded"

  log "[2/4] Recreating z1-api ..."
  $COMPOSE up -d --force-recreate z1-api || { ann "compose up failed"; die "compose up failed"; }
  ok "z1-api recreated"
else
  log "[1-2/4] backend image skipped (mode=${MODE})"
fi

# ---------- 2. frontend static ----------
if [ "$MODE" = "all" ] || [ "$MODE" = "ui" ]; then
  log "[3/4] Swapping frontend static ..."
  for pair in "z1:${WEB_DESKTOP}" "z1-app:${WEB_MOBILE}"; do
    src="${DIR}/dist/${pair%%:*}"
    dst="${pair##*:}"
    [ -d "$src" ] || { ann "missing ${src}"; die "missing ${src}"; }

    # /var/www is root-owned on this host; deploy as hewl -> use sudo -n.
    # Backups land in /var/www too, so they also go through sudo.
    if [ -d "$dst" ]; then
      sudo_n rm -rf "${dst}.bak.${STAMP}" 2>/dev/null || true
      sudo_n cp -r "$dst" "${dst}.bak.${STAMP}" || true
    fi
    sudo_n rm -rf "$dst"
    sudo_n cp -r "$src" "$dst"
    ok "static -> ${dst}"
  done
else
  log "[3/4] frontend static skipped (mode=${MODE})"
fi

# ---------- 3. nginx reload (only if static changed) ----------
if [ "$MODE" = "all" ] || [ "$MODE" = "ui" ]; then
  log "[4/4] Reloading nginx ..."
  sudo_n nginx -t
  sudo_n systemctl reload nginx
  ok "nginx reloaded"
fi

# ---------- 4. verify ----------
log "Verifying ..."
sleep 3
FAIL=0

# backend health (direct + via nginx)
if curl -fsS --max-time 8 "http://127.0.0.1:8090/z1/api/v1/health" >/dev/null 2>&1; then
  ok "api health (direct :8090) OK"
else
  err "api health (direct :8090) FAILED"; FAIL=1
fi
if curl -fsS --max-time 8 "http://127.0.0.1/z1/api/v1/health" 2>/dev/null | grep -q '"status":"up"'; then
  ok "api health (via nginx :80) OK"
else
  err "api health (via nginx :80) FAILED (no up-status in body)"; FAIL=1
fi

# frontend entries
check_web() {
  local url="$1" name="$2" base="$3"
  if curl -fsS --max-time 8 "$url" 2>/dev/null | grep -q "$base/assets/"; then
    ok "${name} entry OK"
  else
    err "${name} entry FAILED (${url})"; FAIL=1
    return
  fi
  # referenced js asset reachable? (catch base-path 404 white screen)
  # ⚠️ 必须以 $base/ 开头才算自家产物 —— 127.0.0.1 可能被同端口其他服务的
  # default server 接走（newapi 的 SPA 对任意路径回 200，曾造成假阳性）
  local asset full
  asset=$(curl -fsS --max-time 8 "$url" 2>/dev/null | grep -oE "src=\"${base}/assets/[^\"]+\.js\"" | head -1 | sed 's/src="//;s/"//') || true
  if [ -n "$asset" ]; then
    case "$asset" in
      http*) full="$asset" ;;
      /*)    full="http://127.0.0.1${asset}" ;;
      *)     full="${url%/}/${asset}" ;;
    esac
    if curl -fsS --max-time 8 "$full" >/dev/null 2>&1; then
      ok "${name} main JS OK (${asset})"
    else
      err "${name} main JS 404 -> BASE-PATH PROBLEM (${asset})"; FAIL=1
    fi
  fi
}

check_web "http://127.0.0.1/z1/"     "desktop" "/z1"
check_web "http://127.0.0.1/z1-app/" "mobile"  "/z1-app"

echo
if [ "$FAIL" -eq 0 ]; then
  echo "  === REMOTE DEPLOY OK ==="
  echo "  desktop: https://voz21.cn/z1/"
  echo "  mobile : https://voz21.cn/z1-app/"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    {
      echo "### Z1 部署成功"
      echo ""
      echo "| 项 | 结果 |"
      echo "| --- | --- |"
      echo "| commit | \`${GITHUB_SHA:-local}\` |"
      echo "| mode | ${MODE} |"
      echo "| 桌面端 | https://voz21.cn/z1/ |"
      echo "| 移动端 | https://voz21.cn/z1-app/ |"
      echo ""
      echo "> 浏览器请用 Ctrl+Shift+R 绕过缓存。"
    } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  fi
  notice "REMOTE DEPLOY OK"
  exit 0
else
  echo "  === REMOTE DEPLOY HAD FAILURES ==="
  echo "  check: $COMPOSE logs z1-api"
  ann "REMOTE DEPLOY HAD FAILURES (self-check failed) — see log above"
  exit 1
fi
