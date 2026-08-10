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
TMP_FILE="${HOME}/.cache/${APP_NAME}-$$"
mkdir -p "${HOME}/.cache"

# Download to home dir first (avoids tmpfs issues), then move
MAX_RETRIES=3
RETRY_DELAY=2
download_ok=false

for i in $(seq 1 $MAX_RETRIES); do
  log "下載 ${APP_NAME} ... (第 ${i}/${MAX_RETRIES} 次嘗試)"
  log "   ${DOWNLOAD_URL}"

  if command -v curl &>/dev/null; then
    curl -fsSL --connect-timeout 15 --max-time 120 \
      -o "${TMP_FILE}" "${DOWNLOAD_URL}" && download_ok=true && break
    rc=$?
    warn "curl 下載失敗 (exit code: ${rc})，稍後重試..."
  elif command -v wget &>/dev/null; then
    wget -q --timeout=120 -O "${TMP_FILE}" "${DOWNLOAD_URL}" && download_ok=true && break
    rc=$?
    warn "wget 下載失敗 (exit code: ${rc})，稍後重試..."
  else
    err "需要 curl 或 wget，請先安裝"
  fi

  rm -f "${TMP_FILE}"
  sleep "${RETRY_DELAY}"
done

if [[ "$download_ok" != true ]]; then
  err "下載失敗（已重試 ${MAX_RETRIES} 次），請確認版本 ${TAG:-latest} 是否存在，或檢查網路連線"
fi

sudo mkdir -p "${INSTALL_DIR}"
sudo mv "${TMP_FILE}" "${INSTALL_DIR}/${APP_NAME}"
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

    # ── 保留舊設定 ──
    if [[ -f "${SERVICE_FILE}" ]]; then
      EXISTING_PORT=$(grep -oP 'Environment="PORT=\K[^"]+' "${SERVICE_FILE}" 2>/dev/null || true)
      EXISTING_USER=$(grep -oP 'Environment="ADMIN_USER=\K[^"]+' "${SERVICE_FILE}" 2>/dev/null || true)
      EXISTING_PASS=$(grep -oP 'Environment="ADMIN_PASS=\K[^"]+' "${SERVICE_FILE}" 2>/dev/null || true)
      EXISTING_SESSION=$(grep -oP 'Environment="SESSION_KEY=\K[^"]+' "${SERVICE_FILE}" 2>/dev/null || true)

      if [[ -n "${EXISTING_PORT}" ]]; then
        info "偵測到現有設定，保留：PORT=${EXISTING_PORT}, ADMIN_USER=${EXISTING_USER:-admin}"
        PORT="${EXISTING_PORT}"
        ADMIN_USER="${EXISTING_USER:-admin}"
        ADMIN_PASS="${EXISTING_PASS:-change_me}"
        SESSION_KEY="${EXISTING_SESSION:-$(openssl rand -hex 32)}"
      else
        PORT="8080"
        ADMIN_USER="admin"
        ADMIN_PASS="change_me"
        SESSION_KEY="$(openssl rand -hex 32)"
      fi
    else
      PORT="8080"
      ADMIN_USER="admin"
      ADMIN_PASS="change_me"
      SESSION_KEY="$(openssl rand -hex 32)"
    fi

    # ── 檢查 PORT 是否可用 ──
    if ss -tlnp | grep -q ":${PORT} "; then
      warn "Port ${PORT} 已被佔用！服務可能無法啟動"
      warn "佔用資訊："
      ss -tlnp | grep ":${PORT} " | head -3
      echo ""
      read -r -p "$(echo -e "${CYAN}[INSTALL]${NC} 是否仍要繼續？[y/N] ")" force
      if [[ ! "$force" =~ ^[Yy]$ ]]; then
        err "安裝取消，請手動修改 PORT 後再試"
      fi
    fi

    sudo tee "${SERVICE_FILE}" > /dev/null <<EOF
[Unit]
Description=Linux Service Manager — Web systemd management panel
After=network.target

[Service]
Type=simple
User=root
Environment="ADMIN_USER=${ADMIN_USER}"
Environment="ADMIN_PASS=${ADMIN_PASS}"
Environment="SESSION_KEY=${SESSION_KEY}"
Environment="PORT=${PORT}"
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
      log "   開啟 http://localhost:${PORT}"
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
