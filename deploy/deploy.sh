#!/usr/bin/env bash
# 從你的 Mac 一鍵上傳並更新伺服器
#
#   bash deploy/deploy.sh 使用者@伺服器IP
#   例：bash deploy/deploy.sh ubuntu@203.0.113.10
#
# 會把專案上傳到伺服器的 ~/mooncake-bbq-map（不含 .venv），再執行 install.sh。
# 第一次會連 .env 一起上傳；之後伺服器上的 /opt/mooncake-bbq-map/.env 不會被覆蓋。
set -euo pipefail
TARGET="${1:-}"
[[ -n "$TARGET" ]] || { echo "用法：bash deploy/deploy.sh 使用者@伺服器IP"; exit 1; }
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> 上傳到 $TARGET:~/mooncake-bbq-map"
rsync -az --delete \
  --exclude ".venv" --exclude "venv" --exclude "__pycache__" --exclude ".git" --exclude ".DS_Store" \
  "$SRC_DIR"/ "$TARGET":~/mooncake-bbq-map/

echo "==> 在伺服器上安裝 / 更新（會要求輸入 sudo 密碼）"
ssh -t "$TARGET" "sudo bash ~/mooncake-bbq-map/deploy/install.sh"
