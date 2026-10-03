"""中秋烤肉地圖 — 管理工具（用 Firebase Admin SDK，略過安全規則）

需要服務帳戶金鑰：Firebase 主控台 → 專案設定 → 服務帳戶 → 產生新的私密金鑰，
把下載的 JSON 存成 serviceAccount.json（不要上傳到 GitHub），
或在 .env 設定 GOOGLE_APPLICATION_CREDENTIALS=金鑰路徑。

用法：
    python admin_tools.py stats                 # 看目前有幾個活動、照片、玩家
    python admin_tools.py close-expired         # 把已過期但還標成進行中的活動關掉
    python admin_tools.py leaderboard           # 印出月兔榜
    python admin_tools.py purge --days 30 --yes # 刪掉 30 天前的活動、申請、打卡與照片
    python admin_tools.py seed                  # 灌入測試資料（測試帳號密碼都是 0000）
    python admin_tools.py unseed                # 刪掉所有測試資料與測試帳號
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

try:
    import firebase_admin
    from firebase_admin import auth, credentials, firestore
except ImportError:  # pragma: no cover
    sys.exit("請先安裝套件：pip install -r requirements.txt")


def connect():
    path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "serviceAccount.json"
    if not os.path.isabs(path):
        path = str(BASE_DIR / path)
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


def _seed_uid(user: dict, create: bool) -> str | None:
    """取得（或建立）測試帳號的 uid。"""
    import seed_data as sd
    email = sd.name_to_email(user["name"])
    try:
        u = auth.get_user_by_email(email)
        if create:
            auth.update_user(u.uid, password=sd.pin_to_password(sd.SEED_PIN), display_name=user["name"])
        return u.uid
    except auth.UserNotFoundError:
        if not create:
            return None
        return auth.create_user(email=email, password=sd.pin_to_password(sd.SEED_PIN), display_name=user["name"]).uid


def cmd_seed(db, _args):
    import seed_data as sd
    now = now_ms()
    ago = lambda m: now - m * 60_000
    print("建立測試帳號…")
    uid = {u["key"]: _seed_uid(u, create=True) for u in sd.SEED_USERS}

    batch = db.batch()
    for u in sd.SEED_USERS:
        batch.set(db.collection("users").document(uid[u["key"]]), {"name": u["name"], "photo": "", "updatedAt": now})
        batch.set(db.collection("players").document(uid[u["key"]]),
                  {"lat": u["lat"], "lng": u["lng"], "city": u["city"], "updatedAt": ago(10)})
    hours = sd.event_hours()
    parties = {}
    for p in sd.SEED_PARTIES:
        created = ago(p["minutes_ago"])
        parties[p["id"]] = p
        batch.set(db.collection("parties").document(sd.SEED_PREFIX + p["id"]), {
            "type": p["type"], "title": p["title"], "landmark": p["landmark"], "when": p["when"], "note": p["note"],
            "capacity": p["capacity"], "lat": p["lat"], "lng": p["lng"], "city": p["city"],
            "hostId": uid[p["host"]], "active": True, "createdAt": created,
            "expiresAt": max(created, now) + hours * 3600_000,
        })
    for r in sd.SEED_REQUESTS:
        host = uid[parties[r["party"]]["host"]]
        from_id = uid[r["from"]] if r["kind"] == "apply" else host
        to_id = host if r["kind"] == "apply" else uid[r["to"]]
        doc = {"partyId": sd.SEED_PREFIX + r["party"], "kind": r["kind"], "fromId": from_id, "toId": to_id,
               "hostId": host, "msg": r["msg"], "status": r["status"], "createdAt": ago(r["minutes_ago"])}
        if r["status"] != "pending":
            doc["respondedAt"] = ago(max(1, r["minutes_ago"] - 5))
        batch.set(db.collection("requests").document(sd.SEED_PREFIX + r["id"]), doc)
    for c in sd.SEED_CHECKINS:
        t = ago(c["minutes_ago"])
        photo_id = sd.SEED_PREFIX + "ph-" + c["id"]
        batch.set(db.collection("photos").document(photo_id), {"ownerId": uid[c["user"]], "data": sd.art(c["art"]), "createdAt": t})
        batch.set(db.collection("checkins").document(sd.SEED_PREFIX + c["id"]),
                  {"partyId": sd.SEED_PREFIX + c["party"], "userId": uid[c["user"]], "photoId": photo_id,
                   "caption": c["caption"], "createdAt": t})
    batch.commit()

    print(f"已建立 {len(sd.SEED_USERS)} 個測試帳號、{len(sd.SEED_PARTIES)} 個活動、"
          f"{len(sd.SEED_REQUESTS)} 筆申請/邀請、{len(sd.SEED_CHECKINS)} 張打卡照片。")
    print(f"活動會在 {hours} 小時後從地圖消失（EVENT_HOURS），想延長就再執行一次 seed。\n")
    print("可以用這些名字登入測試（密碼都是 0000）：")
    for u in sd.SEED_USERS:
        print(f"  {u['name']}")
    print("\n建議先用「測試小明」登入：他有一個待回覆的申請，也收到一個邀請。")
    print("測試完執行 python admin_tools.py unseed 就會全部刪掉。")


def cmd_unseed(db, _args):
    import seed_data as sd
    removed = 0
    for name in ("parties", "requests", "checkins", "photos"):
        refs = [d.reference for d in db.collection(name).select([]).stream() if d.id.startswith(sd.SEED_PREFIX)]
        for i in range(0, len(refs), 400):
            b = db.batch()
            for ref in refs[i:i + 400]:
                b.delete(ref)
            b.commit()
        removed += len(refs)
    users = 0
    for u in sd.SEED_USERS:
        uid = _seed_uid(u, create=False)
        if not uid:
            continue
        db.collection("users").document(uid).delete()
        db.collection("players").document(uid).delete()
        # 測試帳號自己後來新增的資料也一起清掉
        for name, field in (("parties", "hostId"), ("requests", "fromId"), ("requests", "toId"),
                            ("checkins", "userId"), ("photos", "ownerId")):
            for d in db.collection(name).where(field, "==", uid).stream():
                d.reference.delete()
                removed += 1
        auth.delete_user(uid)
        users += 1
    print(f"已刪除 {removed} 筆測試資料、{users} 個測試帳號。")


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
    sub.add_parser("seed", help="灌入測試資料（測試帳號密碼 0000）")
    sub.add_parser("unseed", help="刪除所有測試資料與測試帳號")
    args = ap.parse_args()

    db = connect()
    {"stats": cmd_stats, "close-expired": cmd_close_expired,
     "leaderboard": cmd_leaderboard, "purge": cmd_purge,
     "seed": cmd_seed, "unseed": cmd_unseed}[args.cmd](db, args)


if __name__ == "__main__":
    main()
