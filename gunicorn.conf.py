# gunicorn 設定（正式環境）
# 只聽本機，外面的流量一律經過 Cloudflare Tunnel 進來
import multiprocessing
import os

bind = f"127.0.0.1:{os.getenv('PORT', '8000')}"
workers = int(os.getenv("WEB_WORKERS", min(4, multiprocessing.cpu_count() * 2 + 1)))
threads = 2
worker_class = "gthread"
timeout = 30
graceful_timeout = 20
keepalive = 5
accesslog = "-"   # 交給 systemd journal，用 journalctl -u mooncake 查看
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")
# Cloudflare Tunnel 從本機連進來，信任本機送的 X-Forwarded-* 標頭
forwarded_allow_ips = "127.0.0.1,::1"
