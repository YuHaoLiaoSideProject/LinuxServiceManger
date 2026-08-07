#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Linux Service Manager — Deploy Script
#  部署至 bk.ms.mdevs.uk (本機)
# ============================================================

APP_NAME="linux-service-manager"
INSTALL_DIR="/opt/linux-service-manager"
SERVICE_NAME="linux-service-manager"
SRC_DIR="$(cd "$(dirname "$0")/../src" && pwd)"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Check root / sudo ──
if [[ $EUID -ne 0 ]]; then
  err "請用 sudo 執行：sudo ./deploy.sh"
fi

# ── Build ──
log "編譯 Go 二進位檔 (aarch64, static)..."
cd "$SRC_DIR"
CGO_ENABLED=0 go build -ldflags="-s -w" -o "/tmp/${APP_NAME}" main.go
log "編譯完成 → /tmp/${APP_NAME}"

# ── Stop service ──
log "停止 ${SERVICE_NAME} 服務..."
systemctl stop "${SERVICE_NAME}" || warn "服務可能未在執行中"

# ── Install binary ──
log "複製二進位檔至 ${INSTALL_DIR}/"
mkdir -p "${INSTALL_DIR}"
cp "/tmp/${APP_NAME}" "${INSTALL_DIR}/${APP_NAME}"
chmod +x "${INSTALL_DIR}/${APP_NAME}"

# ── Start service ──
log "啟動 ${SERVICE_NAME} 服務..."
systemctl start "${SERVICE_NAME}"

# ── Health check ──
sleep 1
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  log "✅ 部署成功！${SERVICE_NAME} 已啟動"
  log "   https://bk.ms.mdevs.uk"
else
  err "❌ 服務啟動失敗，請檢查：journalctl -u ${SERVICE_NAME} -n 30"
fi

# ── Show status ──
systemctl status "${SERVICE_NAME}" --no-pager -l || true
