# 部署到 Ubuntu 伺服器 + Cloudflare Tunnel

目標：**https://mooncake.ricecook.org**

```
使用者手機 ──https──▶ Cloudflare ──Tunnel（加密）──▶ 你的伺服器 cloudflared ──▶ 127.0.0.1:8000 gunicorn（Flask）
```

- 伺服器**不用開任何對外的 port**，也不用自己申請 SSL 憑證，HTTPS 由 Cloudflare 處理。
- 網站只聽本機 `127.0.0.1:8000`，外面的人只能透過 Cloudflare 連進來。
- 用 systemd 管理，伺服器重開機會自動啟動，當掉會自動重啟。

需要準備：一台 Ubuntu 22.04 / 24.04 或 Debian 12 的伺服器（可以 SSH、有 sudo 權限），`ricecook.org` 已經在你的 Cloudflare 帳號裡。

---

## 第 1 步：上傳程式並安裝

在**你的 Mac** 上，進到專案資料夾執行（換成你的伺服器帳號和 IP）：

```bash
cd mooncake-bbq-map
bash deploy/deploy.sh ubuntu@你的伺服器IP
```

它會把專案上傳到伺服器，然後自動執行 `install.sh`，過程中會要你輸入伺服器的 sudo 密碼。看到下面這行就是成功了：

```
網站正在 http://127.0.0.1:8000 執行：{"mode": "firebase", "ok": true}
```

> **不想用 deploy.sh？** 也可以自己把資料夾傳上去（scp、git clone 都行），然後在伺服器上執行 `sudo bash deploy/install.sh`。

`.env` 會一起上傳，並放在 `/opt/mooncake-bbq-map/.env`（權限 600，只有網站帳號讀得到）。如果顯示 `"mode": "demo"`，代表 `.env` 沒有 Firebase 設定，請在伺服器上編輯：

```bash
sudo nano /opt/mooncake-bbq-map/.env
sudo systemctl restart mooncake
```

`.env` 裡的 `PORT` 和 `FLASK_DEBUG` 在伺服器上不會用到（固定是 8000 埠、正式模式），不用改。

---

## 第 2 步：建立 Tunnel 並取得 Token

> 如果這台伺服器**已經有一個 Tunnel 在跑**（例如你其他網站用的），跳到 **3-B**。

1. 登入 Cloudflare 儀表板 → 左側 **Zero Trust** → **網路（Networks）** → **Tunnels**
   （新版介面可能在 **Networking → Tunnels**）
2. **建立通道（Create a tunnel）** → 類型選 **Cloudflared** → 名稱填 `mooncake`
3. 作業系統選 **Debian**，畫面會出現一段安裝指令，裡面 `--token` 或 `service install` 後面那一長串 `eyJ...` 就是 **Token**，複製起來

## 第 3 步：在伺服器上接上 Tunnel

### 3-A 新的 Tunnel

```bash
sudo bash /opt/mooncake-bbq-map/deploy/setup_tunnel.sh eyJ...你的Token...
```

回到 Cloudflare 儀表板，Tunnel 狀態變成 **HEALTHY（健康）** 後按下一步，新增路由：

| 欄位 | 填什麼 |
|---|---|
| 子網域（Subdomain） | `mooncake` |
| 網域（Domain） | `ricecook.org` |
| 路徑（Path） | 留空 |
| 服務類型（Type） | `HTTP` |
| URL | `localhost:8000` |

儲存。Cloudflare 會自動幫你建立 `mooncake.ricecook.org` 的 DNS 紀錄（CNAME 指向 Tunnel），不用自己去 DNS 頁面加。

### 3-B 伺服器上已經有 Tunnel

不用再裝 cloudflared，在**同一個 Tunnel** 加一條路由就好：

- **儀表板管理的 Tunnel**（Tunnels 列表裡看得到、可以點「設定」的那種）：
  點進那個 Tunnel → **公開主機名稱 / 路由（Public Hostname / Routes）** → **新增** → 填上面同一張表。

- **用設定檔管理的 Tunnel**（伺服器上有 `/etc/cloudflared/config.yml` 或 `~/.cloudflared/config.yml`）：
  在 `ingress:` 的**最後一條 `http_status:404` 之前**加兩行：
  ```yaml
  ingress:
    - hostname: mooncake.ricecook.org
      service: http://localhost:8000
    # …你原本的其他規則…
    - service: http_status:404
  ```
  然後建立 DNS 紀錄並重啟：
  ```bash
  cloudflared tunnel route dns <你的Tunnel名稱> mooncake.ricecook.org
  sudo systemctl restart cloudflared
  ```

---

## 第 4 步：Firebase 加入授權網域（一定要做）

Firebase 主控台 → **Authentication** → **設定** → **授權網域** → **新增網域** → 輸入 `mooncake.ricecook.org`

沒加的話，輸入名字進入時會顯示「這個網域還沒加入 Firebase 授權網域」。

## 第 5 步：Cloudflare 小設定（建議）

在 Cloudflare 儀表板選 `ricecook.org`：

- **SSL/TLS → 邊緣憑證 → 一律使用 HTTPS（Always Use HTTPS）**：開啟。手機要在 https 下才能用 GPS 定位。
- **速度 → 最佳化 → Rocket Loader**：關閉。它會改寫網頁裡的 JavaScript，可能讓地圖或登入出問題。

## 第 6 步：測試

用手機打開 **https://mooncake.ricecook.org**：

1. 跳出「你是誰？」，輸入名字和 4 位數密碼後右上角出現你的名字 → Firebase 登入正常
2. 按地圖右上的準心，瀏覽器詢問定位權限 → 允許後地圖飛到你的位置
3. 發起一個烤肉點、上傳一張照片 → 用另一支手機打開，應該馬上看得到

---

## 之後更新程式

在 Mac 上改完程式，同一個指令再跑一次：

```bash
bash deploy/deploy.sh ubuntu@你的伺服器IP
```

伺服器上的 `.env` 不會被覆蓋。網頁和程式檔都帶有版本號，更新後使用者重新整理就會拿到新版（最多 5 分鐘內全部生效）。

## 常用指令（在伺服器上）

| 想做的事 | 指令 |
|---|---|
| 看網站狀態 | `systemctl status mooncake` |
| 看即時記錄 | `journalctl -u mooncake -f` |
| 看最近的錯誤 | `journalctl -u mooncake -n 100 --no-pager` |
| 重新啟動網站 | `sudo systemctl restart mooncake` |
| 看 Tunnel 狀態 | `systemctl status cloudflared` |
| 看 Tunnel 記錄 | `journalctl -u cloudflared -n 50 --no-pager` |
| 本機測試網站 | `curl http://127.0.0.1:8000/healthz` |
| 用管理工具 | `cd /opt/mooncake-bbq-map && sudo -u mooncake .venv/bin/python admin_tools.py stats` |

（管理工具需要 `serviceAccount.json`，放在 Mac 的專案資料夾裡，第一次部署時會一起上傳到伺服器並設為只有網站帳號能讀。）

## 疑難排解

| 狀況 | 可能原因與處理 |
|---|---|
| 打開網址出現 **Cloudflare 502 / 1033** | Tunnel 連不到網站。在伺服器跑 `curl http://127.0.0.1:8000/healthz`：沒回應就看 `journalctl -u mooncake`；有回應就檢查路由的 URL 是不是 `localhost:8000`、`systemctl status cloudflared` 是否正常。 |
| 網址打不開、找不到網域 | 路由沒建立 DNS。到 DNS 頁面確認有 `mooncake` 的 CNAME（目標是 `xxxx.cfargotunnel.com`）。 |
| 「網域還沒加入 Firebase 授權網域」 | 做第 4 步。 |
| `auth/configuration-not-found` | Firebase → Authentication 還沒按「開始使用」，或「電子郵件/密碼」沒啟用。也可能 `.env` 填到別的專案。 |
| 「Firebase 還沒開啟電子郵件/密碼登入」 | Firebase → Authentication → 登入方式，啟用「電子郵件/密碼」。 |
| 「沒有權限做這件事」 | `firestore.rules` 沒有發布最新版，重新貼上並發布。 |
| 定位按了沒反應 | 確認網址是 `https://`，並且手機瀏覽器有允許這個網站使用位置。 |
| 更新後畫面還是舊的 | 等 5 分鐘或在 Cloudflare → 快取 → 清除快取（Purge Everything）。 |
