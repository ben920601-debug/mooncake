#!/usr/bin/env bash
# 安裝 cloudflared 並用 Cloudflare 儀表板給的 Token 把這台伺服器接上 Tunnel
#
#   sudo bash deploy/setup_tunnel.sh <TUNNEL_TOKEN>
#
# Token 取得方式見 deploy/DEPLOY.md 第 3 步。
# 網址（mooncake.ricecook.org → http://localhost:8000）是在 Cloudflare 儀表板設定的，
# 這支腳本只負責讓伺服器上的 cloudflared 連上去。
set -euo pipefail

green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }

[[ $EUID -eq 0 ]] || { red "請用 sudo 執行"; exit 1; }
TOKEN="${1:-}"

green "==> 1/3 安裝 cloudflared"
if command -v cloudflared >/dev/null 2>&1; then
  green "    已安裝：$(cloudflared --version 2>&1 | head -1)"
else
  mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq && apt-get install -y -qq cloudflared >/dev/null
  green "    安裝完成：$(cloudflared --version 2>&1 | head -1)"
fi

green "==> 2/3 啟動 Tunnel 服務"
if systemctl list-unit-files | grep -q '^cloudflared.service'; then
  if [[ -n "$TOKEN" ]]; then
    yellow "    這台伺服器已經有 cloudflared 服務在跑（你現有的 Tunnel）。"
    yellow "    不需要再裝一次，直接在 Cloudflare 儀表板的「同一個 Tunnel」新增路由即可（見 DEPLOY.md 3-B）。"
  fi
  systemctl restart cloudflared
else
  [[ -n "$TOKEN" ]] || { red "請提供 Tunnel Token：sudo bash deploy/setup_tunnel.sh <TOKEN>"; exit 1; }
  cloudflared service install "$TOKEN"
fi

green "==> 3/3 檢查"
sleep 3
if systemctl is-active --quiet cloudflared; then
  green "    cloudflared 正在執行。回到 Cloudflare 儀表板，Tunnel 狀態應該顯示 HEALTHY。"
else
  red "    cloudflared 沒有啟動，請看：journalctl -u cloudflared -n 50 --no-pager"
  exit 1
fi
echo
echo "確認路由設定好之後，打開 https://mooncake.ricecook.org 測試。"
