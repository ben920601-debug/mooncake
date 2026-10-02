"""中秋烤肉地圖 — 管理工具（用 Firebase Admin SDK，略過安全規則）

需要服務帳戶金鑰：Firebase 主控台 → 專案設定 → 服務帳戶 → 產生新的私密金鑰，
把下載的 JSON 存成 serviceAccount.json（不要上傳到 GitHub），
或在 .env 設定 GOOGLE_APPLICATION_CREDENTIALS=金鑰路徑。

用法：
    python admin_tools.py stats                 # 看目前有幾個活動、照片、玩家
    python admin_tools.py close-expired         # 把已過期但還標成進行中的活動關掉
    python admin_tools.py leaderboard           # 印出月兔榜
    python admin_tools.py purge --days 30 --yes # 刪掉 30 天前的活動、申請、打卡與照片
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from collections import Counter

from dotenv import load_dotenv

load_dotenv()

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError:  # pragma: no cover
    sys.exit("請先安裝套件：pip install -r requirements.txt")


def connect():
    path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "serviceAccount.json"
    if not os.path.exists(path):
        sys.exit(f"找不到服務帳戶金鑰：{path}\n請到 Firebase 主控台 → 專案設定 → 服務帳戶 下載。")
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(path))
    return firestore.client()


def now_ms() -> int:
    return int(time.time() * 1000)


def cmd_stats(db, _args):
    live = expired = ended = 0
    types = Counter()
    for doc in db.collection("parties").stream():
        p = doc.to_dict()
        types[p.get("type")] += 1
        if not p.get("active"):
            ended += 1
        elif p.get("expiresAt", 0) < now_ms():
            expired += 1
        else:
            live += 1
    count = lambda name: sum(1 for _ in db.collection(name).select([]).stream())
    print(f"進行中活動：{live}（已過期未關閉 {expired}、已結束 {ended}）")
    print(f"  烤肉 {types.get('bbq', 0)}、賣煙火 {types.get('fireworks', 0)}")
    print(f"申請 / 邀請：{count('requests')}")
    print(f"打卡：{count('checkins')}，照片：{count('photos')}")
    print(f"分享位置的玩家：{count('players')}，登入過的使用者：{count('users')}")


def cmd_close_expired(db, _args):
    n = 0
    batch = db.batch()
    for doc in db.collection("parties").where("active", "==", True).stream():
        if doc.to_dict().get("expiresAt", 0) < now_ms():
            batch.update(doc.reference, {"active": False, "endedAt": now_ms()})
            n += 1
            if n % 400 == 0:
                batch.commit()
                batch = db.batch()
    batch.commit()
    print(f"已關閉 {n} 個過期活動")


def cmd_leaderboard(db, args):
    score = Counter()
    for d in db.collection("parties").stream():
        score[d.to_dict().get("hostId")] += 20
    for d in db.collection("checkins").stream():
        score[d.to_dict().get("userId")] += 10
    for d in db.collection("requests").where("status", "==", "accepted").stream():
        r = d.to_dict()
        score[r.get("fromId") if r.get("kind") == "apply" else r.get("toId")] += 5
    score.pop(None, None)
    names = {d.id: d.to_dict().get("name", "") for d in db.collection("users").stream()}
    for i, (uid, s) in enumerate(score.most_common(args.top), 1):
        print(f"{i:>2}. {names.get(uid) or uid:<20} {s:>5}")


def cmd_purge(db, args):
    cutoff = now_ms() - args.days * 86400 * 1000
    targets = {
        "parties": "createdAt",
        "requests": "createdAt",
        "checkins": "createdAt",
        "photos": "createdAt",
    }
    plan = {}
    for name, field in targets.items():
        plan[name] = [d.reference for d in db.collection(name).where(field, "<", cutoff).stream()]
    for name, refs in plan.items():
        print(f"{name}: {len(refs)} 筆早於 {args.days} 天")
    if not args.yes:
        print("這是預覽。確認要刪除請加上 --yes")
        return
    total = 0
    for refs in plan.values():
        for i in range(0, len(refs), 400):
            batch = db.batch()
            for ref in refs[i:i + 400]:
                batch.delete(ref)
            batch.commit()
            total += len(refs[i:i + 400])
    print(f"已刪除 {total} 筆")


def main():
    ap = argparse.ArgumentParser(description="中秋烤肉地圖管理工具")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("stats", help="統計資料")
    sub.add_parser("close-expired", help="關閉過期活動")
    lb = sub.add_parser("leaderboard", help="月兔榜")
    lb.add_argument("--top", type=int, default=20)
    pg = sub.add_parser("purge", help="刪除舊資料")
    pg.add_argument("--days", type=int, default=30)
    pg.add_argument("--yes", action="store_true", help="真的刪除（沒加只預覽）")
    args = ap.parse_args()

    db = connect()
    {"stats": cmd_stats, "close-expired": cmd_close_expired,
     "leaderboard": cmd_leaderboard, "purge": cmd_purge}[args.cmd](db, args)


if __name__ == "__main__":
    main()
