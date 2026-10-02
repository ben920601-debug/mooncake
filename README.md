# 中秋烤肉地圖

中秋夜的小遊戲網站。大家可以在真實地圖上看到附近誰在烤肉、哪裡在賣煙火，可以申請加入、主人可以邀請附近的人，到現場打卡上傳照片賺「月兔積分」。

- **後端**：Python（Flask），負責提供網頁和讀取 Firebase 設定
- **前端**：HTML / CSS / JavaScript，地圖用 Leaflet + OpenStreetMap（用 CSS 調成夜空色調），定位用瀏覽器 GPS
- **資料庫**：Firebase Authentication（Google 登入）+ Cloud Firestore（即時同步）
- **示範模式**：還沒設定 Firebase 時也能直接跑，資料只存在你的瀏覽器

---

## 1. 先在自己電腦上跑起來（示範模式，5 分鐘）

需要 Python 3.10 以上。

```bash
cd mooncake-bbq-map
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

打開 <http://127.0.0.1:5000>。畫面上會顯示「示範模式」。

- 按「示範登入」會隨機給你一個名字（例如「玉兔42」）
- **開第二個分頁會是另一個人**，可以自己測試：A 分頁發起烤肉 → B 分頁申請 → A 分頁接受
- 按地圖右上的準心可以定位（localhost 允許 GPS）

---

## 2. 接上 Firebase（讓大家一起玩）

### 2-1 建立專案
1. 到 <https://console.firebase.google.com> → 新增專案（Google Analytics 可以關掉）
2. 專案首頁按「</>」新增**網頁應用程式**，取個名字，**不用**勾 Firebase Hosting
3. 畫面會出現一段 `firebaseConfig`，先留著

### 2-2 開啟 Google 登入
Authentication → 開始使用 → 登入方式 → **Google** → 啟用 → 儲存

### 2-3 建立 Firestore 資料庫
Firestore Database → 建立資料庫 → 位置選 `asia-east1（台灣）` → 選**正式版模式** → 建立

### 2-4 部署安全規則（很重要，沒做的話什麼都寫不進去）
二選一：
- **直接貼**：Firestore Database → 規則 → 把 `firestore.rules` 的內容整份貼上 → 發布
- **用指令**：
  ```bash
  npm install -g firebase-tools
  firebase login
  firebase use --add            # 選你的專案
  firebase deploy --only firestore:rules
  ```

### 2-5 填設定
```bash
cp .env.example .env
```
把 2-1 的 `firebaseConfig` 對應填進 `.env`：

| firebaseConfig | .env |
|---|---|
| apiKey | FIREBASE_API_KEY |
| authDomain | FIREBASE_AUTH_DOMAIN |
| projectId | FIREBASE_PROJECT_ID |
| storageBucket | FIREBASE_STORAGE_BUCKET |
| messagingSenderId | FIREBASE_MESSAGING_SENDER_ID |
| appId | FIREBASE_APP_ID |

重新執行 `python app.py`，終端機會顯示 `[Firebase]`，網頁上的按鈕會變成「用 Google 登入」。

> 這些設定值會出現在網頁原始碼裡，這是正常的，Firebase 的網頁設定本來就是公開的。真正保護資料的是第 2-4 步的安全規則。

---

## 3. 放到網路上（手機才能用 GPS）

手機瀏覽器**只有在 HTTPS 網站**才允許定位，所以要讓朋友用手機玩，需要部署。以 [Render](https://render.com) 免費方案為例：

1. 把這個資料夾推到 GitHub（`.env` 和 `serviceAccount.json` 已在 `.gitignore`，不會被上傳）
2. Render → New → Web Service → 選你的 repo
3. Build Command：`pip install -r requirements.txt`
4. Start Command：`gunicorn app:app`
5. Environment 裡把 `.env` 的 `FIREBASE_...` 和 `EVENT_HOURS` 一個個加進去
6. 部署完會拿到一個網址，例如 `https://mooncake-bbq.onrender.com`
7. **回到 Firebase** → Authentication → 設定 → 授權網域 → 新增這個網域（不加的話 Google 登入會失敗）

Render 免費方案閒置一陣子會休眠，第一次打開要等幾十秒。也可以用 Google Cloud Run、Railway、Fly.io 等任何能跑 Python 的服務，`Procfile` 已經準備好了。

---

## 4. 遊戲規則與功能

| 動作 | 說明 | 月兔積分 |
|---|---|---|
| 我在這烤肉 / 我在賣煙火 | 定位或在地圖上選位置，填名稱、地標、時間、人數上限，可附照片 | +20 |
| 申請加入 | 對別人的烤肉點送出申請並留言，主人在「邀請與申請」接受或婉拒 | 被接受 +5 |
| 分享我的位置 | 讓附近的主人看得到你（四捨五入到約 100 公尺） | — |
| 邀請附近的人 | 主人可以看到 15 公里內分享過位置的人，按一下就送出邀請 | 對方接受 +5（給對方） |
| 打卡上傳照片 | 到現場拍照，照片會自動壓縮 | 每張 +10 |
| 結束活動 | 主人手動結束；或在 `EVENT_HOURS` 小時後自動從地圖消失 | — |

---

## 5. 專案結構

```
mooncake-bbq-map/
├── app.py                 Flask 伺服器（讀 .env、注入 Firebase 設定、示範模式判斷）
├── admin_tools.py         管理工具：統計、關閉過期活動、排行榜、清除舊資料
├── templates/index.html   頁面骨架
├── static/
│   ├── css/style.css      中秋夜空主題
│   └── js/
│       ├── app.js         地圖、畫面、所有互動
│       ├── store.js       資料層（Firebase 與示範模式兩種實作）
│       └── util.js        距離計算、縣市判斷、照片壓縮
├── firestore.rules        Firestore 安全規則
├── firebase.json          給 firebase CLI 部署規則用
├── requirements.txt
├── Procfile               部署用啟動指令
└── .env.example           設定範本
```

### Firestore 資料結構

| 集合 | 文件 ID | 內容 | 誰能寫 |
|---|---|---|---|
| `users` | 使用者 uid | name, photo | 本人 |
| `players` | 使用者 uid | lat, lng, city, updatedAt | 本人 |
| `parties` | 自動 | type (`bbq`/`fireworks`), title, landmark, when, note, capacity, lat, lng, city, hostId, active, createdAt, expiresAt | 建立：登入者；修改／刪除：主人 |
| `requests` | 自動 | partyId, kind (`apply`/`invite`), fromId, toId, hostId, msg, status, createdAt | 建立：申請人或主人；回覆：toId 本人 |
| `checkins` | 自動 | partyId, userId, photoId, caption, createdAt | 本人 |
| `photos` | 自動 | ownerId, data（JPEG data URL）, createdAt | 本人 |

---

## 6. 管理工具（選用）

需要服務帳戶金鑰：Firebase 主控台 → 專案設定 → 服務帳戶 → 產生新的私密金鑰，存成 `serviceAccount.json`（**不要上傳到 GitHub**）。

```bash
python admin_tools.py stats                  # 統計
python admin_tools.py close-expired          # 把過期活動標成已結束
python admin_tools.py leaderboard --top 10   # 月兔榜
python admin_tools.py purge --days 30        # 預覽要刪的舊資料
python admin_tools.py purge --days 30 --yes  # 真的刪
```

---

## 7. 為什麼照片存在 Firestore，而不是 Cloud Storage？

2024 年 9 月起，新的 Firebase 專案要用 Cloud Storage **必須升級到 Blaze（付費、需綁信用卡）方案**。為了讓免費的 Spark 方案就能玩，這個專案把照片在手機上先壓縮到 1280px、約 50–700KB，直接存成 Firestore 文件（單一文件上限 1MB）。

免費額度大約是：儲存 1 GiB、每天 5 萬次讀取、2 萬次寫入，一場朋友間的中秋烤肉綽綽有餘。如果之後人很多、照片很多，建議升級 Blaze 並改用 Cloud Storage（`store.js` 的 `getPhoto` 與 `app.js` 的 `savePhoto` 兩個地方要改）。

---

## 8. 已知限制

- **積分是前端計算的**：理論上有人可以狂上傳照片刷分。朋友之間玩沒問題；要公開比賽的話，建議改用 Cloud Functions 在伺服器端計分。
- **申請留言對所有登入者可見**：`requests` 集合目前是登入就能讀（為了顯示誰加入了哪場）。不要在留言裡寫手機號碼等個資。
- **縣市名稱是估算的**：用離哪個縣市中心最近來判斷，邊界附近可能不準；導航請以座標為準。
- **地圖底圖**預設用 OpenStreetMap 官方圖磚（免金鑰），依[使用政策](https://operations.osmfoundation.org/policies/tiles/)只適合小流量。人多時請到 MapTiler 或 Stadia Maps 申請免費金鑰，在 `.env` 設定 `TILE_URL`、`TILE_ATTRIBUTION`，並把 `TILE_DARKEN=0`。
# mooncake
