#!/usr/bin/env bash
# 在 Ubuntu / Debian 伺服器上安裝或更新「中秋烤肉地圖」
#
#   sudo bash deploy/install.sh
#
# 第一次執行會：安裝 Python、建立系統帳號、複製程式到 /opt、建立虛擬環境、
#               安裝 systemd 服務並啟動（只聽 127.0.0.1:8000）
# 之後每次更新程式碼，再執行一次同一個指令即可（.env 會保留）
set -euo pipefail

APP_NAME="mooncake"
APP_DIR="${APP_DIR:-/opt/mooncake-bbq-map}"
APP_USER="${APP_USER:-mooncake}"
PORT="${PORT:-8000}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }

[[ $EUID -eq 0 ]] || { red "請用 sudo 執行：sudo bash deploy/install.sh"; exit 1; }
[[ -f "$SRC_DIR/app.py" ]] || { red "找不到 app.py，請在專案資料夾裡執行"; exit 1; }

green "==> 1/6 安裝系統套件"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip rsync curl >/dev/null

green "==> 2/6 建立系統帳號 $APP_USER"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

green "==> 3/6 複製程式到 $APP_DIR"
mkdir -p "$APP_DIR"
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete \
    --exclude ".venv" --exclude "venv" --exclude "__pycache__" --exclude ".git" \
    --exclude ".env" --exclude "serviceAccount.json" \
    "$SRC_DIR"/ "$APP_DIR"/
fi
if [[ ! -f "$APP_DIR/.env" ]]; then
  if [[ -f "$SRC_DIR/.env" ]]; then
    cp "$SRC_DIR/.env" "$APP_DIR/.env"
    green "    已複製你的 .env"
  else
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    yellow "    還沒有 .env，先用範本建立。網站會以「示範模式」執行，"
    yellow "    請編輯 $APP_DIR/.env 填入 Firebase 設定後再執行一次本腳本。"
  fi
fi
if [[ -f "$SRC_DIR/serviceAccount.json" && ! -f "$APP_DIR/serviceAccount.json" ]]; then
  cp "$SRC_DIR/serviceAccount.json" "$APP_DIR/serviceAccount.json"
fi

green "==> 4/6 建立 Python 虛擬環境並安裝套件"
[[ -d "$APP_DIR/.venv" ]] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip
"$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"
[[ -f "$APP_DIR/serviceAccount.json" ]] && chmod 600 "$APP_DIR/serviceAccount.json"

green "==> 5/6 安裝 systemd 服務 $APP_NAME"
sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__APP_USER__|$APP_USER|g" -e "s|__PORT__|$PORT|g" \
  "$APP_DIR/deploy/mooncake.service" > "/etc/systemd/system/$APP_NAME.service"
systemctl daemon-reload
systemctl enable "$APP_NAME" >/dev/null 2>&1
systemctl restart "$APP_NAME"

green "==> 6/6 檢查網站"
for i in $(seq 1 15); do
  if out=$(curl -fsS "http://127.0.0.1:$PORT/healthz" 2>/dev/null); then
    green "    網站正在 http://127.0.0.1:$PORT 執行：$out"
    break
  fi
  sleep 1
  if [[ $i -eq 15 ]]; then
    red "    網站沒有回應，請看錯誤訊息：journalctl -u $APP_NAME -n 50 --no-pager"
    exit 1
  fi
done
if echo "$out" | grep -q '"demo"'; then
  yellow "    目前是示範模式（還沒填 Firebase 設定）。"
fi

echo
green "完成。接下來：如果還沒設定 Cloudflare Tunnel，執行"
echo "    sudo bash $APP_DIR/deploy/setup_tunnel.sh <你的 Tunnel Token>"
echo "常用指令："
echo "    systemctl status $APP_NAME        # 狀態"
echo "    journalctl -u $APP_NAME -f        # 即時記錄"
echo "    sudo systemctl restart $APP_NAME  # 重新啟動"
