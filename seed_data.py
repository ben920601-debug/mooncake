"""測試資料：給 admin_tools.py seed / unseed 使用

所有測試資料的文件 ID 都以 "seed-" 開頭，測試帳號則是固定的幾個名字，
所以 unseed 可以精準地只刪掉測試資料，不會動到真正玩家的資料。
"""
from __future__ import annotations

import base64
import hashlib
import math
import os
import re
import unicodedata

SEED_PIN = "0000"
SEED_PREFIX = "seed-"

# 測試帳號：名字（就是登入用的名字）、分享的位置
SEED_USERS = [
    {"key": "ming", "city": "台北市", "name": "測試小明", "lat": 25.072, "lng": 121.534},   # 大佳河濱公園附近
    {"key": "hua", "city": "台北市", "name": "測試阿華", "lat": 25.065, "lng": 121.526},    # 中山區
    {"key": "ling", "city": "台北市", "name": "測試美玲", "lat": 25.079, "lng": 121.545},   # 大直
    {"key": "qiang", "city": "台北市", "name": "測試志強", "lat": 25.060, "lng": 121.543},  # 松山
    {"key": "yu", "city": "新北市", "name": "測試小玉", "lat": 25.013, "lng": 121.465},     # 板橋
    {"key": "kai", "city": "台中市", "name": "測試阿凱", "lat": 24.165, "lng": 120.642},    # 台中
]

# 活動：host 對應上面的 key；minutes_ago 是幾分鐘前發起的
SEED_PARTIES = [
    {"id": "p1", "city": "台北市", "host": "ming", "type": "bbq", "title": "河堤邊烤肉，柚子管夠", "landmark": "大佳河濱公園 3 號門",
     "when": "今晚 6:30 到 10 點", "note": "有兩台烤肉架和木炭，帶飲料或你想烤的東西就好。", "capacity": 10,
     "lat": 25.0727, "lng": 121.5355, "minutes_ago": 95},
    {"id": "p2", "city": "台北市", "host": "ling", "type": "bbq", "title": "大直社區中秋烤肉", "landmark": "美堤河濱公園籃球場旁",
     "when": "今晚 7 點開烤", "note": "社區鄰居一起，歡迎帶小孩來玩仙女棒。", "capacity": 20,
     "lat": 25.0812, "lng": 121.5498, "minutes_ago": 50},
    {"id": "p3", "city": "台北市", "host": "yu", "type": "bbq", "title": "板橋三五好友小烤", "landmark": "華江雁鴨自然公園入口",
     "when": "晚上 8 點後", "note": "人不多，想找兩三個人一起分擔食材。", "capacity": 6,
     "lat": 25.0331, "lng": 121.4895, "minutes_ago": 20},
    {"id": "p4", "city": "台中市", "host": "kai", "type": "bbq", "title": "秋紅谷烤肉賞月", "landmark": "秋紅谷生態公園東側草地",
     "when": "今晚 6 點到 11 點", "note": "準備了 3 公斤肉片，烤不完幫忙吃。", "capacity": 12,
     "lat": 24.1676, "lng": 120.6400, "minutes_ago": 130},
    {"id": "p5", "city": "台北市", "host": "qiang", "type": "fireworks", "title": "仙女棒、沖天炮現場賣", "landmark": "延平河濱公園入口",
     "when": "賣到 11 點", "note": "仙女棒一包 50、小型噴泉 120，附打火機。", "capacity": None,
     "lat": 25.0598, "lng": 121.5085, "minutes_ago": 70},
    {"id": "p6", "city": "新北市", "host": "hua", "type": "fireworks", "title": "三重煙火小攤", "landmark": "三重疏洪道停車場",
     "when": "晚上 7 點到 10 點", "note": "大量仙女棒，買五送一。", "capacity": None,
     "lat": 25.0632, "lng": 121.4851, "minutes_ago": 35},
]

# 申請 / 邀請
SEED_REQUESTS = [
    {"id": "r1", "party": "p1", "kind": "apply", "from": "hua", "status": "pending", "msg": "我帶一盒月餅和兩顆柚子", "minutes_ago": 30},
    {"id": "r2", "party": "p1", "kind": "apply", "from": "ling", "status": "accepted", "msg": "可以帶朋友嗎？", "minutes_ago": 80},
    {"id": "r3", "party": "p1", "kind": "invite", "to": "qiang", "status": "pending", "msg": "", "minutes_ago": 25},
    {"id": "r4", "party": "p2", "kind": "invite", "to": "ming", "status": "pending", "msg": "", "minutes_ago": 15},
    {"id": "r5", "party": "p3", "kind": "apply", "from": "ming", "status": "accepted", "msg": "我住附近，帶烤肉醬", "minutes_ago": 12},
    {"id": "r6", "party": "p2", "kind": "apply", "from": "qiang", "status": "declined", "msg": "還有位子嗎？", "minutes_ago": 40},
]

# 打卡照片（用程式畫的插圖，不需要真的照片）
SEED_CHECKINS = [
    {"id": "c1", "party": "p1", "user": "ming", "art": "grill", "caption": "火升好了", "minutes_ago": 90},
    {"id": "c2", "party": "p1", "user": "ling", "art": "moon", "caption": "今晚月亮好圓", "minutes_ago": 40},
    {"id": "c3", "party": "p2", "user": "ling", "art": "grill2", "caption": "", "minutes_ago": 45},
    {"id": "c4", "party": "p4", "user": "kai", "art": "grill", "caption": "肉片上架", "minutes_ago": 120},
    {"id": "c5", "party": "p5", "user": "qiang", "art": "fireworks", "caption": "仙女棒到貨", "minutes_ago": 65},
    {"id": "c6", "party": "p6", "user": "hua", "art": "fireworks2", "caption": "", "minutes_ago": 30},
]


# ---------- 名字 → Firebase 帳號（必須和 static/js/store.js 的算法一模一樣） ----------
def normalize(name: str) -> str:
    n = unicodedata.normalize("NFKC", name.strip()).lower()
    return re.sub(r"\s+", " ", n)


def name_to_email(name: str) -> str:
    return f"u{hashlib.sha256(normalize(name).encode()).hexdigest()[:40]}@users.mooncake-bbq.app"


def pin_to_password(pin: str) -> str:
    return f"mooncake-{pin}-bbq"


# ---------- 插圖 ----------
def _svg(body: str, bg1: str, bg2: str) -> str:
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{bg1}"/>'
        f'<stop offset="1" stop-color="{bg2}"/></linearGradient></defs>'
        f'<rect width="400" height="400" fill="url(#g)"/>{body}</svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def _stars() -> str:
    pts = [(40, 50), (90, 120), (150, 40), (300, 70), (350, 140), (220, 30), (60, 200), (370, 30)]
    return "".join(f'<circle cx="{x}" cy="{y}" r="2" fill="#fff" opacity=".7"/>' for x, y in pts)


def art(kind: str) -> str:
    moon = '<circle cx="310" cy="90" r="46" fill="#f6d98b"/><circle cx="296" cy="80" r="9" fill="#e2bd66" opacity=".6"/>'
    grill = (
        '<ellipse cx="200" cy="300" rx="120" ry="18" fill="#000" opacity=".25"/>'
        '<path d="M90 230h220a110 70 0 0 1-220 0Z" fill="#3a3a44"/>'
        '<rect x="85" y="222" width="230" height="10" rx="4" fill="#666a78"/>'
        '<path d="M150 290l-25 60M250 290l25 60" stroke="#3a3a44" stroke-width="10" stroke-linecap="round"/>'
        '<path d="M130 222q15-45 0-80q30 30 20 80ZM190 222q20-60 0-110q40 45 22 110ZM255 222q15-40 0-70q28 28 18 70Z" fill="#ff8a3d"/>'
        '<path d="M140 222q8-25 0-45q16 18 10 45ZM198 222q10-35 0-60q22 25 12 60ZM262 222q8-22 0-40q15 16 9 40Z" fill="#ffd166"/>'
        '<rect x="120" y="205" width="70" height="16" rx="8" fill="#b5523b"/><rect x="210" y="205" width="70" height="16" rx="8" fill="#c96a3f"/>'
    )
    if kind == "grill":
        return _svg(_stars() + moon + grill, "#141a3a", "#2b2350")
    if kind == "grill2":
        corn = '<rect x="160" y="196" width="80" height="22" rx="11" fill="#f2c94c"/>'
        return _svg(_stars() + grill + corn, "#1a1f45", "#3a2a4a")
    if kind == "moon":
        big = ('<circle cx="200" cy="170" r="110" fill="#f6d98b"/><circle cx="165" cy="140" r="18" fill="#e2bd66" opacity=".6"/>'
               '<circle cx="235" cy="205" r="12" fill="#e2bd66" opacity=".5"/>'
               '<path d="M0 330q100-40 200 0t200 0V400H0Z" fill="#0d1230"/>')
        return _svg(_stars() + big, "#101538", "#2a3170")
    if kind in ("fireworks", "fireworks2"):
        bursts = [(130, 140, "#ff6fa8"), (270, 110, "#f6d98b"), (210, 220, "#79d4b0")]
        if kind == "fireworks2":
            bursts = [(200, 130, "#f6d98b"), (110, 210, "#ff8a3d"), (300, 220, "#ff6fa8")]
        body = _stars()
        for cx, cy, c in bursts:
            for i in range(12):
                a = i * math.pi / 6
                x2, y2 = cx + 60 * math.cos(a), cy + 60 * math.sin(a)
                body += f'<line x1="{cx}" y1="{cy}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{c}" stroke-width="4" stroke-linecap="round"/>'
                body += f'<circle cx="{x2:.1f}" cy="{y2:.1f}" r="5" fill="{c}"/>'
        body += '<path d="M0 340q100-30 200 0t200 0V400H0Z" fill="#0d1230"/>'
        return _svg(body, "#0f1433", "#2c2160")
    return _svg(_stars() + moon, "#141a3a", "#2b2350")


def event_hours() -> int:
    try:
        return max(1, min(48, int(os.getenv("EVENT_HOURS", "12"))))
    except ValueError:
        return 12
