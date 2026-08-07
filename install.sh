#!/usr/bin/env bash
set -euo pipefail

# ============================================================
#  Linux Service Manager — One-liner Install Script
#  Usage: curl -fsSL https://raw.githubusercontent.com/YuHaoLiaoSideProject/LinuxServiceManger/main/install.sh | bash
# ============================================================

REPO="YuHaoLiaoSideProject/LinuxServiceManger"
APP_NAME="linux-service-manager"
INSTALL_DIR="${INSTALL_DIR:-/opt/linux-service-manager}"
BIN_NAME="linux-service-manager-linux-amd64"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()    { echo -e "${GREEN}[INSTALL]${NC} $*"; }
warn()   { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()    { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
info()   { echo -e "${CYAN}[INFO]${NC}  $*"; }

# ── Check system ──
if [[ "$(uname -s)" != "Linux" ]]; then
  err "此腳本僅支援 Linux 系統"
fi

ARCH=$(uname -m)
if [[ "$ARCH" == "x86_64" ]]; then
  BIN_NAME="linux-service-manager-linux-amd64"
elif [[ "$ARCH" == "aarch64" ]]; then
  BIN_NAME="linux-service-manager-linux-arm64"
else
  err "不支援的架構：$ARCH（僅支援 x86_64 / aarch64）"
fi

# ── Parse args ──
NO_SERVICE=false
TAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-service) NO_SERVICE=true; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: bash install.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --no-service   不安裝 systemd service，僅下載 binary"
      echo "  --tag v1.0.0   指定版本（預設下載最新 release）"
      echo "  -h, --help     顯示說明"
      exit 0
      ;;
    *) err "未知參數: $1" ;;
  esac
done

# ── Download URL ──
if [[ -n "$TAG" ]]; then
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${BIN_NAME}"
else
  DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${BIN_NAME}"
fi

# ── Install ──
log "下載 ${APP_NAME} ..."
log "   ${DOWNLOAD_URL}"

sudo mkdir -p "${INSTALL_DIR}"

# Download with fallback
if command -v curl &>/dev/null; then
  sudo curl -fsSL -o "${INSTALL_DIR}/${APP_NAME}" "${DOWNLOAD_URL}" || err "下載失敗，請確認版本是否存在"
elif command -v wget &>/dev/null; then
  sudo wget -q -O "${INSTALL_DIR}/${APP_NAME}" "${DOWNLOAD_URL}" || err "下載失敗，請確認版本是否存在"
else
  err "需要 curl 或 wget，請先安裝"
fi

sudo chmod +x "${INSTALL_DIR}/${APP_NAME}"

log "安裝完成 → ${INSTALL_DIR}/${APP_NAME}"

# ── Config ──
info "環境變數提示："
echo ""
echo "  export ADMIN_USER=admin"
echo "  export ADMIN_PASS=your_password"
echo "  export SESSION_KEY=\$(openssl rand -hex 32)"
echo "  export PORT=8080"
echo ""

# ── systemd service (optional) ──
if [[ "$NO_SERVICE" == false ]]; then
  echo ""
  read -r -p "$(echo -e "${CYAN}[INSTALL]${NC} 是否安裝 systemd service？[Y/n] ")" answer
  answer="${answer:-Y}"

  if [[ "$answer" =~ ^[Yy]$ ]]; then
    SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"

    sudo tee "${SERVICE_FILE}" > /dev/null <<EOF
[Unit]
Description=Linux Service Manager — Web systemd management panel
After=network.target

[Service]
Type=simple
User=root
Environment="ADMIN_USER=admin"
Environment="ADMIN_PASS=change_me"
Environment="SESSION_KEY=$(openssl rand -hex 32)"
Environment="PORT=8080"
ExecStart=${INSTALL_DIR}/${APP_NAME}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable --now "${APP_NAME}"

    sleep 1
    if systemctl is-active --quiet "${APP_NAME}"; then
      log "✅ ${APP_NAME} 已啟動"
      log "   開啟 http://localhost:8080"
    else
      warn "服務啟動失敗，請檢查：journalctl -u ${APP_NAME} -n 30"
    fi
  else
    info "跳過 systemd service 安裝"
    echo ""
    log "手動執行："
    echo ""
    echo "  ${INSTALL_DIR}/${APP_NAME}"
  fi
else
  echo ""
  log "手動執行："
  echo ""
  echo "  ${INSTALL_DIR}/${APP_NAME}"
fi

echo ""
log "完成！"
