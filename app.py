"""中秋烤肉地圖 — Flask 伺服器

負責：
  * 提供網頁（templates/index.html）與靜態檔（static/）
  * 從環境變數 / .env 讀取 Firebase 網頁設定，注入到頁面
  * 沒有設定 Firebase 時，自動進入「示範模式」（資料只存在瀏覽器）

啟動：
    python app.py              # 開發用，http://127.0.0.1:5000
    gunicorn app:app           # 正式部署
"""
from __future__ import annotations

import os

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template

load_dotenv()

app = Flask(__name__)

# Firebase「網頁應用程式」設定。這些值會出現在前端，本來就是公開的；
# 真正保護資料的是 firestore.rules 安全規則。
FIREBASE_KEYS = {
    "apiKey": "FIREBASE_API_KEY",
    "authDomain": "FIREBASE_AUTH_DOMAIN",
    "projectId": "FIREBASE_PROJECT_ID",
    "storageBucket": "FIREBASE_STORAGE_BUCKET",
    "messagingSenderId": "FIREBASE_MESSAGING_SENDER_ID",
    "appId": "FIREBASE_APP_ID",
}


def firebase_config() -> dict | None:
    """回傳 Firebase 設定；缺少必要欄位時回傳 None（= 示範模式）。"""
    cfg = {k: os.getenv(env, "").strip() for k, env in FIREBASE_KEYS.items()}
    if not (cfg["apiKey"] and cfg["projectId"] and cfg["appId"]):
        return None
    if not cfg["authDomain"]:
        cfg["authDomain"] = f'{cfg["projectId"]}.firebaseapp.com'
    return {k: v for k, v in cfg.items() if v}


# 地圖底圖。預設用 OpenStreetMap 官方圖磚（免金鑰，適合小型活動），
# 再用 CSS 調暗成夜空色調。想換成其他圖磚服務（例如 MapTiler、Stadia）時，
# 在 .env 設定 TILE_URL / TILE_ATTRIBUTION，並把 TILE_DARKEN 設為 0。
DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
DEFAULT_TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 貢獻者'


def tile_config() -> dict:
    return {
        "url": os.getenv("TILE_URL", "").strip() or DEFAULT_TILE_URL,
        "attribution": os.getenv("TILE_ATTRIBUTION", "").strip() or DEFAULT_TILE_ATTR,
        "maxZoom": int(os.getenv("TILE_MAX_ZOOM", "19")),
        "darken": os.getenv("TILE_DARKEN", "1") != "0",
    }


@app.route("/")
def index():
    cfg = firebase_config()
    return render_template(
        "index.html",
        firebase_config=cfg,
        demo_mode=cfg is None,
        event_hours=int(os.getenv("EVENT_HOURS", "12")),
        tiles=tile_config(),
    )


@app.route("/healthz")
def healthz():
    return jsonify(ok=True, mode="firebase" if firebase_config() else "demo")


@app.after_request
def security_headers(resp):
    # 允許定位（GPS）只給本站使用；其他常見安全標頭
    resp.headers.setdefault("Permissions-Policy", "geolocation=(self), camera=(self)")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return resp


if __name__ == "__main__":
    port = int(os.getenv("PORT", "10002"))
    mode = "Firebase" if firebase_config() else "示範模式（尚未設定 Firebase）"
    print(f"中秋烤肉地圖啟動中：http://127.0.0.1:{port}  [{mode}]")
    app.run(host="0.0.0.0", port=port, debug=os.getenv("FLASK_DEBUG") == "1")
