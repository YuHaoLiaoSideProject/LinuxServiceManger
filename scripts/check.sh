#!/usr/bin/env bash
# ============================================================
#  Linux Service Manager — Environment Detection Script
#  檢查目標機器是否能部署 Linux Service Manager
# ============================================================
set -u

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0; WARN=0; FAIL=0

pass() { echo -e "  ${GREEN}✅ PASS${NC}  $*"; ((PASS++)); }
warn() { echo -e "  ${YELLOW}⚠️  WARN${NC}  $*"; ((WARN++)); }
fail() { echo -e "  ${RED}❌ FAIL${NC}  $*"; ((FAIL++)); }
info() { echo -e "  ${CYAN}ℹ️  INFO${NC}  $*"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  Linux Service Manager — Environment Check       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# ═══════════════════════════════════════════════════════
#  1. OS & Kernel
# ═══════════════════════════════════════════════════════
echo -e "${BOLD}[1] 作業系統與核心${NC}"

if [ -f /etc/os-release ]; then
  . /etc/os-release
  info "OS: $PRETTY_NAME"
else
  warn "無法讀取 /etc/os-release"
fi

ARCH=$(uname -m)
KERNEL=$(uname -r)
info "Architecture: $ARCH"
info "Kernel: $KERNEL"

# ═══════════════════════════════════════════════════════
#  2. systemd
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}[2] systemd 檢查${NC}"

PID1=$(ps -p 1 -o comm= 2>/dev/null || true)
if [ "$PID1" = "systemd" ]; then
  pass "PID 1 是 systemd"
else
  fail "PID 1 不是 systemd（目前是: ${PID1:-unknown}）— 本工具強制依賴 systemd"
fi

if command -v systemctl &>/dev/null; then
  pass "systemctl 可用"
  SYSTEMD_VER=$(systemctl --version 2>&1 | head -1 | grep -oP '[0-9]+' | head -1 || echo "?")
  info "systemd 版本: $SYSTEMD_VER"
else
  fail "systemctl 命令不存在"
fi

# ═══════════════════════════════════════════════════════
#  3. D-Bus
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}[3] D-Bus 檢查${NC}"

if [ -S /run/dbus/system_bus_socket ] || [ -S /var/run/dbus/system_bus_socket ]; then
  pass "D-Bus system bus socket 存在"
else
  fail "找不到 D-Bus system bus socket"
fi

if command -v dbus-send &>/dev/null; then
  pass "dbus-send 可用"
  # Test dbus connectivity
  if dbus-send --system --dest=org.freedesktop.DBus --type=method_call --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames &>/dev/null; then
    pass "D-Bus 通訊正常"
  else
    fail "D-Bus 通訊失敗（可能需要 sudo）"
  fi
else
  warn "dbus-send 不可用，無法測試 D-Bus 連線"
fi

# ═══════════════════════════════════════════════════════
#  4. systemd 權限
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}[4] systemd 操作權限${NC}"

if systemctl list-units --type=service --all --no-pager --no-legend &>/dev/null; then
  pass "可列出 systemd service（無需 root）"
else
  warn "無法列出 service（需 root 權限）— 部署時以 sudo 執行即可"
fi

if systemctl show -p FragmentPath systemd-journald.service &>/dev/null; then
  pass "可查詢 service FragmentPath"
else
  warn "FragmentPath 查詢失敗，但可 fallback 到 systemctl"
fi

# ═══════════════════════════════════════════════════════
#  5. 架構與二進位相容性
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}[5] 二進位相容性${NC}"

case "$ARCH" in
  x86_64|amd64)
    info "架構: x86_64 → 可執行 linux-amd64 二進位檔"
    ;;
  aarch64|arm64)
    info "架構: aarch64 → 可執行 aarch64 二進位檔"
    ;;
  armv7l|armv6l)
    info "架構: ARM 32-bit → 需交叉編譯 GOARCH=arm"
    ;;
  *)
    warn "未知架構: $ARCH → 需確認 Go 是否支援"
    ;;
esac

# Check glibc (only matters for dynamic builds)
if command -v ldd &>/dev/null; then
  GLIBC_VER=$(ldd --version 2>/dev/null | head -1 | awk '{print $NF}' || echo "unknown")
  info "glibc 版本: $GLIBC_VER"
  info "靜態編譯（CGO_ENABLED=0）可完全繞過 glibc 版本問題"
else
  warn "無 ldd，可能使用 musl libc — 靜態編譯可解決"
fi

# ═══════════════════════════════════════════════════════
#  6. Go 編譯環境
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}[6] Go 編譯環境${NC}"

if command -v go &>/dev/null; then
  GO_VER=$(go version | awk '{print $3}')
  pass "Go 可用: $GO_VER"
  
  GO_MAJOR=$(echo "$GO_VER" | sed 's/go//' | cut -d. -f1)
  GO_MINOR=$(echo "$GO_VER" | sed 's/go//' | cut -d. -f2)
  if [ "$GO_MAJOR" -ge 1 ] && [ "$GO_MINOR" -ge 21 ]; then
    pass "Go 版本 >= 1.21，符合最低需求"
  else
    warn "Go 版本偏低，建議 1.21+"
  fi
else
  warn "Go 未安裝 — 需在其他機器編譯後上傳 binary"
  info "  預編譯 binary 亦可直接使用，無需 Go"
fi

# ═══════════════════════════════════════════════════════
#  7. Port 可用性
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}[7] Port 檢查（預設 8091）${NC}"

PORT="${1:-8091}"
if ss -tlnp 2>/dev/null | grep -q ":${PORT}\b" || netstat -tlnp 2>/dev/null | grep -q ":${PORT}\b"; then
  warn "Port ${PORT} 已被佔用"
  info "  設定 PORT 環境變數可改用其他 port"
else
  pass "Port ${PORT} 可用"
fi

# ═══════════════════════════════════════════════════════
#  8. 必備命令
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}[8] 必要命令${NC}"

REQUIRED_CMDS=("systemctl" "ps")
for cmd in "${REQUIRED_CMDS[@]}"; do
  if command -v "$cmd" &>/dev/null; then
    pass "$cmd 可用"
  else
    fail "$cmd 不存在"
  fi
done

# ═══════════════════════════════════════════════════════
#  9. systemd 路徑相容性
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}[9] systemd unit 路徑${NC}"

for path in /etc/systemd/system /usr/lib/systemd/system /lib/systemd/system; do
  if [ -d "$path" ]; then
    pass "$path 存在"
  else
    warn "$path 不存在"
  fi
done

# ═══════════════════════════════════════════════════════
#  10. 服務數量概覽
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}[10] 目前系統服務概況${NC}"

TOTAL=$(systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null | wc -l || echo "?")
ACTIVE=$(systemctl list-units --type=service --state=active --no-pager --no-legend 2>/dev/null | wc -l || echo "?")
IN_ETC=$(find /etc/systemd/system/ -maxdepth 1 -name '*.service' 2>/dev/null | wc -l || echo "?")

info "總 service 數: $TOTAL"
info "執行中: $ACTIVE"
info "/etc/systemd/system/ 中自訂 service: $IN_ETC"

# ═══════════════════════════════════════════════════════
#  Summary
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  檢測結果摘要                                     ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo -e "  ${GREEN}PASS:${NC} ${PASS}  ${YELLOW}WARN:${NC} ${WARN}  ${RED}FAIL:${NC} ${FAIL}"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "  ${RED}⚠️  有 ${FAIL} 項致命問題，無法部署。${NC}"
  echo "  請先解決 FAIL 項目後再執行部署。"
  echo ""
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "  ${YELLOW}⚠️  有 ${WARN} 項警告，可部署但需注意。${NC}"
  echo ""
  echo "  部署步驟："
  echo "    1. make static          # 靜態編譯（本機架構）"
  echo "    2. sudo ./deploy.sh     # 部署並啟動"
  echo ""
  echo "  或跨架構部署："
  echo "    1. make linux-static    # 編譯 x86_64 靜態 binary"
  echo "    2. scp linux-service-manager-linux-amd64 target:/opt/linux-service-manager/"
  echo "    3. scp linux-service-manager.service target:/etc/systemd/system/"
  echo "    4. ssh target 'systemctl daemon-reload && systemctl enable --now linux-service-manager'"
  echo ""
else
  echo -e "  ${GREEN}✅ 環境完全相容，可直接部署！${NC}"
  echo ""
  echo "  部署步驟："
  echo "    1. make static          # 靜態編譯"
  echo "    2. sudo ./deploy.sh     # 部署並啟動"
  echo ""
fi

exit 0
