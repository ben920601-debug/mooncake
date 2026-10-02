# 中秋烤肉地圖

中秋夜的小遊戲網站。大家可以在真實地圖上看到附近誰在烤肉、哪裡在賣煙火，可以申請加入、主人可以邀請附近的人，到現場打卡上傳照片賺「月兔積分」。

- **後端**：Python（Flask），負責提供網頁和讀取 Firebase 設定
- **前端**：HTML / CSS / JavaScript，地圖用 Leaflet + OpenStreetMap（用 CSS 調成夜空色調），定位用瀏覽器 GPS
- **資料庫**：Firebase Authentication（匿名訪客 + 用戶名/密碼註冊）+ Cloud Firestore（即時同步）
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

- 打開就自動是訪客，會隨機給你一個名字（例如「玉兔4821」），可以按「註冊保留資料」測試註冊
- **開第二個分頁會是另一個訪客**，可以自己測試：A 分頁發起烤肉 → B 分頁申請 → A 分頁接受
- 按地圖右上的準心可以定位（localhost 允許 GPS）

---

## 2. 接上 Firebase（讓大家一起玩）

### 2-1 建立專案
1. 到 <https://console.firebase.google.com> → 新增專案（Google Analytics 可以關掉）
2. 專案首頁按「</>」新增**網頁應用程式**，取個名字，**不用**勾 Firebase Hosting
3. 畫面會出現一段 `firebaseConfig`，先留著

### 2-2 開啟登入方式（兩個都要開）
Authentication → 開始使用 → 登入方式：
1. **匿名** → 啟用 → 儲存（打開網站就自動以訪客身分登入）
2. **電子郵件/密碼** → 啟用 → 儲存（「電子郵件連結」不用開）

> 使用者註冊時只需要輸入用戶名和密碼，不需要 email。程式會把用戶名轉成一個內部帳號（`u<雜湊>@users.mooncake-bbq.app`），所以 Firebase 這邊仍然要開「電子郵件/密碼」。

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

重新執行 `python app.py`，終端機會顯示 `[Firebase]`，網頁右上角會顯示你的訪客名字（例如「玉兔4821」），旁邊有「註冊保留資料」。

> 這些設定值會出現在網頁原始碼裡，這是正常的，Firebase 的網頁設定本來就是公開的。真正保護資料的是第 2-4 步的安全規則。

---

## 3. 放到網路上（手機才能用 GPS）

手機瀏覽器**只有在 HTTPS 網站**才允許定位，所以要讓朋友用手機玩，需要部署。

**自己的 Linux 伺服器 + Cloudflare Tunnel**（目前設定的網址：`https://mooncake.ricecook.org`）：照 [`deploy/DEPLOY.md`](deploy/DEPLOY.md) 做，大約 15 分鐘。重點是：

```bash
bash deploy/deploy.sh ubuntu@你的伺服器IP                          # Mac 上：上傳 + 安裝 + 啟動
sudo bash /opt/mooncake-bbq-map/deploy/setup_tunnel.sh <Token>     # 伺服器上：接上 Cloudflare Tunnel
```

部署好之後，記得到 Firebase → Authentication → 設定 → 授權網域，加入你的網域。

也可以用 Render、Google Cloud Run 等平台，`Procfile` 已經準備好了（啟動指令 `gunicorn -c gunicorn.conf.py app:app`，平台通常會自己設 `PORT`）。

## 4. 帳號怎麼運作

| 身分 | 怎麼來的 | 能做什麼 | 注意 |
|---|---|---|---|
| 訪客 | 打開網站自動建立（Firebase 匿名登入） | 全部功能都能用 | 只綁在這個瀏覽器；清除瀏覽資料或換手機就找不回來 |
| 已註冊 | 訪客按「註冊保留資料」，輸入用戶名 + 密碼 | 同上，換裝置可用用戶名登入 | 註冊會沿用訪客的帳號，之前的活動、打卡、積分全部保留 |

- 用戶名 2–20 字，可用中英文、數字、底線、減號，不分大小寫，不能重複。
- 密碼至少 6 個字元（Firebase 的規定）。
- 因為沒有 email，**忘記密碼無法自行重設**。管理員可以到 Firebase 主控台 → Authentication 刪除該帳號讓他重新註冊。
- 登出後會自動變成一個新的訪客。

## 5. 遊戲規則與功能

| 動作 | 說明 | 月兔積分 |
|---|---|---|
| 我在這烤肉 / 我在賣煙火 | 定位或在地圖上選位置，填名稱、地標、時間、人數上限，可附照片 | +20 |
| 申請加入 | 對別人的烤肉點送出申請並留言，主人在「邀請與申請」接受或婉拒 | 被接受 +5 |
| 分享我的位置 | 讓附近的主人看得到你（四捨五入到約 100 公尺） | — |
| 邀請附近的人 | 主人可以看到 15 公里內分享過位置的人，按一下就送出邀請 | 對方接受 +5（給對方） |
| 打卡上傳照片 | 到現場拍照，照片會自動壓縮 | 每張 +10 |
| 結束活動 | 主人手動結束；或在 `EVENT_HOURS` 小時後自動從地圖消失 | — |

---

## 6. 專案結構

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
├── gunicorn.conf.py       正式環境的 gunicorn 設定（只聽 127.0.0.1）
├── deploy/
│   ├── DEPLOY.md          Ubuntu + Cloudflare Tunnel 部署步驟
│   ├── deploy.sh          從 Mac 上傳並更新伺服器
│   ├── install.sh         在伺服器上安裝 / 更新（systemd 服務）
│   ├── setup_tunnel.sh    安裝 cloudflared 並接上 Tunnel
│   └── mooncake.service   systemd 服務範本
├── Procfile               給 Render 等平台用的啟動指令
└── .env.example           設定範本
```

### Firestore 資料結構

| 集合 | 文件 ID | 內容 | 誰能寫 |
|---|---|---|---|
| `users` | 使用者 uid | name（訪客名或用戶名）, photo, registered | 本人 |
| `players` | 使用者 uid | lat, lng, city, updatedAt | 本人 |
| `parties` | 自動 | type (`bbq`/`fireworks`), title, landmark, when, note, capacity, lat, lng, city, hostId, active, createdAt, expiresAt | 建立：登入者；修改／刪除：主人 |
| `requests` | 自動 | partyId, kind (`apply`/`invite`), fromId, toId, hostId, msg, status, createdAt | 建立：申請人或主人；回覆：toId 本人 |
| `checkins` | 自動 | partyId, userId, photoId, caption, createdAt | 本人 |
| `photos` | 自動 | ownerId, data（JPEG data URL）, createdAt | 本人 |

---

## 7. 管理工具（選用）

需要服務帳戶金鑰：Firebase 主控台 → 專案設定 → 服務帳戶 → 產生新的私密金鑰，存成 `serviceAccount.json`（**不要上傳到 GitHub**）。

```bash
python admin_tools.py stats                  # 統計
python admin_tools.py close-expired          # 把過期活動標成已結束
python admin_tools.py leaderboard --top 10   # 月兔榜
python admin_tools.py purge --days 30        # 預覽要刪的舊資料
python admin_tools.py purge --days 30 --yes  # 真的刪
```

---

## 8. 為什麼照片存在 Firestore，而不是 Cloud Storage？

2024 年 9 月起，新的 Firebase 專案要用 Cloud Storage **必須升級到 Blaze（付費、需綁信用卡）方案**。為了讓免費的 Spark 方案就能玩，這個專案把照片在手機上先壓縮到 1280px、約 50–700KB，直接存成 Firestore 文件（單一文件上限 1MB）。

免費額度大約是：儲存 1 GiB、每天 5 萬次讀取、2 萬次寫入，一場朋友間的中秋烤肉綽綽有餘。如果之後人很多、照片很多，建議升級 Blaze 並改用 Cloud Storage（`store.js` 的 `getPhoto` 與 `app.js` 的 `savePhoto` 兩個地方要改）。

---

## 9. 已知限制

- **訪客帳號會累積**：每個沒註冊的訪客都會在 Firebase Authentication 留下一個匿名帳號。人很多時，可以把專案升級到 Identity Platform，開啟「自動清除匿名帳號」。
- **積分是前端計算的**：理論上有人可以狂上傳照片刷分。朋友之間玩沒問題；要公開比賽的話，建議改用 Cloud Functions 在伺服器端計分。
- **申請留言對所有登入者可見**：`requests` 集合目前是登入就能讀（為了顯示誰加入了哪場）。不要在留言裡寫手機號碼等個資。
- **縣市名稱是估算的**：用離哪個縣市中心最近來判斷，邊界附近可能不準；導航請以座標為準。
- **地圖底圖**預設用 OpenStreetMap 官方圖磚（免金鑰），依[使用政策](https://operations.osmfoundation.org/policies/tiles/)只適合小流量。人多時請到 MapTiler 或 Stadia Maps 申請免費金鑰，在 `.env` 設定 `TILE_URL`、`TILE_ATTRIBUTION`，並把 `TILE_DARKEN=0`。
