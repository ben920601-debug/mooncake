// 中秋烤肉地圖 — 前端主程式
import { createStore } from "./store.js";
import { CITIES, nearestCity, km, fmtDist, ago, esc, compressImage } from "./util.js";

const CFG = window.APP_CONFIG || { firebase: null, demo: true, eventHours: 12 };
const EVENT_MS = (CFG.eventHours || 12) * 3600e3;
const TYPE = {
  bbq: { label: "烤肉", cls: "bbq" },
  fireworks: { label: "賣煙火", cls: "fw" },
};
const ICON = {
  bbq: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 11h16a8 8 0 0 1-16 0Z"/><path d="M8 18l-2 4M16 18l2 4M9 3c-1 1.5 1 2.5 0 4M13 3c-1 1.5 1 2.5 0 4M17 3c-1 1.5 1 2.5 0 4"/></svg>',
  fireworks: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M5 19l3.5-3.5M15.5 8.5 19 5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>',
};

/* ---------------- state ---------------- */
const S = {
  store: null, user: null, status: "loading",
  parties: [], requests: [], checkins: [], players: [], users: {},
  tab: "events", filter: "all", selected: null, gps: null, placing: null, busy: false,
};
const $ = (id) => document.getElementById(id);
const uid = () => S.user && S.user.uid;

/* ---------------- derived ---------------- */
const now = () => Date.now();
const isLive = (p) => p.active !== false && (!p.expiresAt || p.expiresAt > now()) && typeof p.lat === "number";
const visibleParties = () => S.parties.filter((p) => isLive(p) && (S.filter === "all" || p.type === S.filter));
const partyById = (id) => S.parties.find((p) => p.id === id);
const myPlayer = () => S.players.find((p) => p.id === uid());
const myPos = () => myPlayer() || S.gps;
const members = (p) => S.requests.filter((r) => r.partyId === p.id && r.status === "accepted").map((r) => (r.kind === "apply" ? r.fromId : r.toId));
function myRelation(p) {
  const me = uid(); if (!me) return "none";
  if (p.hostId === me) return "host";
  if (members(p).includes(me)) return "member";
  if (S.requests.some((r) => r.partyId === p.id && r.status === "pending" && r.kind === "apply" && r.fromId === me)) return "applied";
  if (S.requests.some((r) => r.partyId === p.id && r.status === "pending" && r.kind === "invite" && r.toId === me)) return "invited";
  return "none";
}
function scores() {
  const m = {}; const add = (id, n) => { if (id) m[id] = (m[id] || 0) + n; };
  S.parties.forEach((p) => add(p.hostId, 20));
  S.checkins.forEach((c) => add(c.userId, 10));
  S.requests.filter((r) => r.status === "accepted").forEach((r) => add(r.kind === "apply" ? r.fromId : r.toId, 5));
  return m;
}
// 等我回覆的：別人邀請我、或別人申請加入我的活動（兩種情況 toId 都是我）
const inbox = () => (uid() ? S.requests.filter((r) => r.status === "pending" && r.toId === uid() && partyById(r.partyId)) : []);

const nm = (id) => (S.users[id] && S.users[id].name) || (id === uid() ? "你" : "月下旅人");
const DEFAULT_AV = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Ccircle cx='5' cy='5' r='5' fill='%23252f5c'/%3E%3Ccircle cx='5' cy='4' r='2' fill='%23a9a8c8'/%3E%3Cpath d='M1.5 9a3.5 3 0 0 1 7 0' fill='%23a9a8c8'/%3E%3C/svg%3E";
const avatar = (id) => { const p = S.users[id] && S.users[id].photo; return `<img src="${p && /^https:\/\//.test(p) ? esc(p) : DEFAULT_AV}" alt="" referrerpolicy="no-referrer">`; };

function toast(msg) { const r = $("toastRoot"); r.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => (r.innerHTML = ""), 2800); }

/* ---------------- map ---------------- */
const map = L.map("map", { zoomControl: false, attributionControl: true, worldCopyJump: true }).setView([23.75, 120.95], 8);
L.control.zoom({ position: "bottomright" }).addTo(map);
const TILES = CFG.tiles || { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: "&copy; OpenStreetMap", maxZoom: 19, darken: true };
if (TILES.darken) $("map").classList.add("darken");
L.tileLayer(TILES.url, { maxZoom: TILES.maxZoom || 19, attribution: TILES.attribution, crossOrigin: false }).addTo(map);
const partyLayer = L.layerGroup().addTo(map);
const peopleLayer = L.layerGroup().addTo(map);
let placingMarker = null;

function drawPins() {
  partyLayer.clearLayers(); peopleLayer.clearLayers();
  S.players.forEach((p) => {
    if (p.id === uid() || typeof p.lat !== "number") return;
    L.circleMarker([p.lat, p.lng], { radius: 6, color: "#121833", weight: 1.5, fillColor: "#9aa3d8", fillOpacity: 0.85 })
      .bindTooltip(esc(nm(p.id)), { direction: "top" }).addTo(peopleLayer);
  });
  const me = myPos();
  if (me) {
    L.circleMarker([me.lat, me.lng], { radius: 14, color: "#f6d98b", weight: 2, opacity: 0.5, fill: false, interactive: false }).addTo(peopleLayer);
    L.circleMarker([me.lat, me.lng], { radius: 7, color: "#121833", weight: 2, fillColor: "#f6d98b", fillOpacity: 1 }).bindTooltip(myPlayer() ? "我（大家看得到）" : "我（只有你看得到）", { direction: "top" }).addTo(peopleLayer);
  }
  visibleParties().forEach((p) => {
    const sel = S.selected === p.id;
    const icon = L.divIcon({ className: `pin pin-${TYPE[p.type]?.cls || "bbq"}${sel ? " sel" : ""}`, html: "<span></span>", iconSize: sel ? [34, 34] : [26, 26] });
    L.marker([p.lat, p.lng], { icon, title: p.title, riseOnHover: true, zIndexOffset: sel ? 1000 : 0 })
      .bindTooltip(esc(p.title), { direction: "right", offset: [14, 0], permanent: sel, className: "pintip" })
      .on("click", () => select(p.id, false))
      .addTo(partyLayer);
  });
}

/* GPS */
function locate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("這個瀏覽器不支援定位"));
    navigator.geolocation.getCurrentPosition(
      (pos) => res({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      (err) => rej(new Error(err.code === 1 ? "你拒絕了定位權限，可以改成在地圖上點選位置" : "暫時抓不到定位，請在地圖上點選位置")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
$("locateBtn").onclick = async () => {
  try { S.gps = await locate(); map.flyTo([S.gps.lat, S.gps.lng], 15); drawPins(); renderPanel(); }
  catch (e) { toast(e.message); }
};

/* placing mode：拖曳標記或點地圖選位置 */
async function startPlacing(mode, extra = {}) {
  closeSheet();
  S.placing = { mode, ...extra };
  $("placetext").textContent = mode === "me" ? "拖曳金色標記或點地圖，選你現在的位置（大家只會看到約 100 公尺範圍）" : `拖曳標記或點地圖，選${TYPE[extra.type].label}的位置`;
  $("placebar").hidden = false;
  let start = extra.lat != null ? { lat: extra.lat, lng: extra.lng } : null;
  if (!start) { try { S.gps = S.gps || (await locate()); start = S.gps; } catch (e) { toast(e.message); } }
  if (!start) { const c = map.getCenter(); start = { lat: c.lat, lng: c.lng }; }
  if (!S.placing) return;
  placingMarker = L.marker([start.lat, start.lng], { draggable: true, autoPan: true, icon: L.divIcon({ className: "pin pin-place", html: "<span></span>", iconSize: [30, 30] }), zIndexOffset: 2000 }).addTo(map);
  map.flyTo([start.lat, start.lng], Math.max(map.getZoom(), 15));
}
map.on("click", (e) => { if (S.placing && placingMarker) placingMarker.setLatLng(e.latlng); });
function stopPlacing() { S.placing = null; $("placebar").hidden = true; if (placingMarker) { map.removeLayer(placingMarker); placingMarker = null; } }
$("placeCancel").onclick = () => { const pl = S.placing; stopPlacing(); if (pl && pl.mode === "party") openCreate(pl.type, pl.form || {}); };
$("placeOk").onclick = () => {
  if (!S.placing || !placingMarker) return;
  const { lat, lng } = placingMarker.getLatLng(); const pl = S.placing; stopPlacing();
  if (pl.mode === "me") saveMe(lat, lng);
  else openCreate(pl.type, { ...(pl.form || {}), lat, lng });
};

/* ---------------- panel ---------------- */
function renderPanel() {
  const sc = scores(); const me = uid(); const mine = myPlayer();
  if (me) {
    $("me").innerHTML = `${avatar(me)}<div class="who"><b>${esc(nm(me))}</b><span>${mine ? `我在${esc(mine.city || "")}附近 · ${ago(mine.updatedAt)}更新` : "還沒分享位置"} · <button class="link" data-act="signout">登出</button></span></div><div class="pts">${sc[me] || 0}<small>月兔積分</small></div>`;
  } else {
    $("me").innerHTML = `<div class="who"><b>中秋快樂</b><span>${S.status === "loading" ? "連線中…" : "登入後就能發起、申請和打卡"}</span></div><button class="btn moon" data-act="signin" ${S.status === "loading" ? "disabled" : ""}>${S.store && S.store.mode === "demo" ? "示範登入" : "用 Google 登入"}</button>`;
  }
  const dis = me ? "" : "disabled";
  $("actions").innerHTML = `<button class="btn ember" data-act="new" data-type="bbq" ${dis}>${ICON.bbq}我在這烤肉</button><button class="btn spark" data-act="new" data-type="fireworks" ${dis}>${ICON.fireworks}我在賣煙火</button><button class="btn moon wide" data-act="setme" ${dis}>${mine ? "更新我的位置" : "分享我的位置，讓附近的主人邀請我"}</button>`;
  const nIn = inbox().length;
  $("tabs").innerHTML = [["events", "地點"], ["inbox", "邀請與申請"], ["board", "月兔榜"]].map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" data-act="tab" data-tab="${k}">${l}${k === "inbox" && nIn ? `<span class="badge">${nIn}</span>` : ""}</button>`).join("");
  let h = "";
  if (S.store && S.store.mode === "demo") h += `<div class="notice">示範模式：還沒設定 Firebase，資料只存在這台電腦的瀏覽器。開第二個分頁會是另一個示範身分，可以用來測試申請與邀請。</div>`;
  if (S.status === "error") h += `<div class="notice">連不上資料庫。請確認 Firebase 設定與安全規則已部署，再重新整理。</div>`;
  if (S.tab === "events") h += S.selected && partyById(S.selected) ? detailHTML(partyById(S.selected)) : listHTML();
  if (S.tab === "inbox") h += inboxHTML();
  if (S.tab === "board") h += boardHTML(sc);
  $("scroll").innerHTML = h;
  hydratePhotos();
}
function hydratePhotos() {
  document.querySelectorAll("img[data-photo]:not([data-done])").forEach((img) => {
    img.dataset.done = "1";
    S.store.getPhoto(img.dataset.photo).then((src) => { if (src && src.startsWith("data:image/")) img.src = src; else img.classList.add("missing"); }).catch(() => img.classList.add("missing"));
  });
}
const relPill = (rel) => ({ host: `<span class="pill host">我發起的</span>`, member: `<span class="pill ok">已加入</span>`, applied: `<span class="pill wait">申請中</span>`, invited: `<span class="pill wait">邀請你</span>`, none: "" }[rel]);

function listHTML() {
  const pos = myPos(); const f = S.filter;
  const list = visibleParties().map((p) => ({ p, d: pos ? km(pos, p) : null }));
  list.sort((a, b) => (a.d != null ? a.d - b.d : (b.p.createdAt || 0) - (a.p.createdAt || 0)));
  let h = `<div class="filters"><button aria-pressed="${f === "all"}" data-act="filter" data-f="all">全部</button><button aria-pressed="${f === "bbq"}" data-act="filter" data-f="bbq">烤肉</button><button aria-pressed="${f === "fireworks"}" data-act="filter" data-f="fireworks">賣煙火</button>${pos ? `<span class="hint">由近到遠</span>` : `<span class="hint">按地圖右上的準心，依距離排序</span>`}</div>`;
  if (S.status === "loading") return h + `<div class="empty">正在讀取今晚的烤肉點…</div>`;
  if (!list.length) return h + `<div class="empty">${ICON.bbq.replace('width="22" height="22"', 'width="56" height="56" class="big"')}<h4>今晚還沒有人升火</h4><p>${uid() ? "按上方「我在這烤肉」或「我在賣煙火」，定位後拍張照，你就是第一個亮起來的點。" : "先登入，再按「我在這烤肉」或「我在賣煙火」，你就是第一個亮起來的點。"}</p></div>`;
  return h + list.map(({ p, d }) => {
    const t = TYPE[p.type] || TYPE.bbq; const mem = members(p).length; const ph = S.checkins.filter((c) => c.partyId === p.id).length;
    return `<button class="card ${S.selected === p.id ? "sel" : ""}" data-act="select" data-pid="${esc(p.id)}"><span class="ico ${t.cls}">${ICON[p.type] || ICON.bbq}</span><span class="body"><h3>${esc(p.title)}</h3><span class="meta"><span>${t.label}</span>${p.landmark ? `<span>${esc(p.landmark)}</span>` : ""}${d != null ? `<span>${fmtDist(d)}</span>` : ""}${p.type === "bbq" ? `<span>${mem + 1}${p.capacity ? "/" + p.capacity : ""} 人</span>` : ""}<span>${ph} 張照片</span></span><span class="meta mt">${relPill(myRelation(p))}<span>${esc(nm(p.hostId))} · ${ago(p.createdAt)}</span></span></span></button>`;
  }).join("");
}

function detailHTML(p) {
  const t = TYPE[p.type] || TYPE.bbq; const rel = myRelation(p); const mem = members(p); const me = uid();
  const photos = S.checkins.filter((c) => c.partyId === p.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const full = p.type === "bbq" && p.capacity && mem.length + 1 >= p.capacity;
  const pos = myPos();
  let act = "";
  if (!me) act = `<button class="btn moon" data-act="signin">登入後申請或打卡</button>`;
  else {
    if (rel === "none" && p.type === "bbq") act += `<button class="btn ember" data-act="apply" data-pid="${esc(p.id)}" ${full ? "disabled" : ""}>${full ? "已額滿" : "申請加入"}</button>`;
    if (rel === "applied") { const r = S.requests.find((r) => r.partyId === p.id && r.status === "pending" && r.kind === "apply" && r.fromId === me); act += `<span class="pill wait">已送出申請，等主人回覆</span><button class="btn sm ghost" data-act="cancel" data-rid="${esc(r.id)}">取消申請</button>`; }
    if (rel === "invited") { const r = S.requests.find((r) => r.partyId === p.id && r.status === "pending" && r.kind === "invite" && r.toId === me); act += `<button class="btn ember" data-act="respond" data-rid="${esc(r.id)}" data-s="accepted">接受邀請</button><button class="btn ghost" data-act="respond" data-rid="${esc(r.id)}" data-s="declined">婉拒</button>`; }
    act += `<button class="btn moon" data-act="checkin" data-pid="${esc(p.id)}">打卡上傳照片</button>`;
    if (rel === "host") act += `<button class="btn" data-act="invite" data-pid="${esc(p.id)}">邀請附近的人</button><button class="btn ghost" data-act="end" data-pid="${esc(p.id)}">結束活動</button>`;
  }
  let h = `<div class="detail"><div class="row"><button class="btn sm ghost" data-act="back">← 所有地點</button></div>
  <div class="row"><span class="pill ${t.cls}">${t.label}</span>${relPill(rel)}</div>
  <h2>${esc(p.title)}</h2>
  ${p.note ? `<p class="note">${esc(p.note)}</p>` : ""}
  <dl class="kv"><dt>地標</dt><dd>${esc(p.landmark || "未填")}</dd><dt>區域</dt><dd>${esc(p.city || nearestCity(p.lat, p.lng))}${pos ? `，${fmtDist(km(pos, p)) === "就在附近" ? "就在你附近" : "離你 " + fmtDist(km(pos, p))}` : ""}</dd>${p.when ? `<dt>時間</dt><dd>${esc(p.when)}</dd>` : ""}<dt>發起</dt><dd>${esc(nm(p.hostId))} · ${ago(p.createdAt)}</dd><dt>導航</dt><dd><a href="${nav}" target="_blank" rel="noopener">用 Google 地圖導航過去</a></dd></dl>
  <div class="row">${act}</div>`;
  if (rel === "host") {
    const pend = S.requests.filter((r) => r.partyId === p.id && r.status === "pending" && r.kind === "apply");
    if (pend.length) h += `<p class="sec">等你回覆的申請</p><div class="people">${pend.map((r) => `<div class="person">${avatar(r.fromId)}<span class="n">${esc(nm(r.fromId))}<small>${esc(r.msg || "想來一起烤")}</small></span><button class="btn sm ember" data-act="respond" data-rid="${esc(r.id)}" data-s="accepted">接受</button><button class="btn sm ghost" data-act="respond" data-rid="${esc(r.id)}" data-s="declined">婉拒</button></div>`).join("")}</div>`;
    const inv = S.requests.filter((r) => r.partyId === p.id && r.status === "pending" && r.kind === "invite");
    if (inv.length) h += `<p class="sec">已邀請，等對方回覆</p><div class="people">${inv.map((r) => `<div class="person">${avatar(r.toId)}<span class="n">${esc(nm(r.toId))}</span><span class="pill wait">邀請中</span></div>`).join("")}</div>`;
  }
  if (p.type === "bbq") h += `<p class="sec">一起烤的人 · ${mem.length + 1}${p.capacity ? " / " + p.capacity : ""}</p><div class="people"><div class="person">${avatar(p.hostId)}<span class="n">${esc(nm(p.hostId))}</span><span class="pill host">主人</span></div>${mem.map((id) => `<div class="person">${avatar(id)}<span class="n">${esc(nm(id))}</span></div>`).join("")}</div>`;
  h += `<p class="sec">現場照片 · ${photos.length}</p>` + (photos.length
    ? `<div class="photos">${photos.map((c) => `<figure class="photo"><img data-photo="${esc(c.photoId)}" alt="${esc(c.caption || "現場照片")}" src="${DEFAULT_PHOTO}"><figcaption>${esc(nm(c.userId))}${c.caption ? "：" + esc(c.caption) : ""} · ${ago(c.createdAt)}</figcaption></figure>`).join("")}</div>`
    : `<p class="empty sm">還沒有照片。到現場後按「打卡上傳照片」，每張 +10 月兔積分。</p>`);
  return h + `</div>`;
}
const DEFAULT_PHOTO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23252f5c'/%3E%3C/svg%3E";

function inboxHTML() {
  const me = uid(); if (!me) return `<div class="empty">登入後才能收發邀請。</div>`;
  const ib = inbox();
  const mine = S.requests.filter((r) => (r.kind === "apply" && r.fromId === me) || (r.kind === "invite" && r.toId === me && r.status !== "pending")).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  let h = `<p class="sec">等你回覆</p>`;
  h += ib.length ? ib.map((r) => { const p = partyById(r.partyId);
    return `<div class="card col"><div class="person">${avatar(r.fromId)}<span class="n">${r.kind === "invite" ? `${esc(nm(r.fromId))} 邀請你去「${esc(p.title)}」` : `${esc(nm(r.fromId))} 想加入「${esc(p.title)}」`}<small>${esc(r.msg || "")} ${ago(r.createdAt)}</small></span></div><div class="row"><button class="btn sm ember" data-act="respond" data-rid="${esc(r.id)}" data-s="accepted">${r.kind === "invite" ? "我要去" : "接受"}</button><button class="btn sm ghost" data-act="respond" data-rid="${esc(r.id)}" data-s="declined">婉拒</button><button class="btn sm ghost" data-act="select" data-pid="${esc(p.id)}">看地點</button></div></div>`; }).join("")
    : `<div class="empty sm">目前沒有待回覆的邀請或申請。${myPlayer() ? "" : "分享你的位置後，附近的主人就能邀請你。"}</div>`;
  h += `<p class="sec">我的申請與紀錄</p>`;
  h += mine.length ? mine.map((r) => { const p = partyById(r.partyId); if (!p) return "";
    const st = { pending: `<span class="pill wait">等待中</span>`, accepted: `<span class="pill ok">已加入</span>`, declined: `<span class="pill no">未成行</span>` }[r.status];
    return `<button class="card" data-act="select" data-pid="${esc(p.id)}"><span class="ico ${(TYPE[p.type] || TYPE.bbq).cls}">${ICON[p.type] || ICON.bbq}</span><span class="body"><h3>${esc(p.title)}</h3><span class="meta">${st}<span>${r.kind === "apply" ? "我申請的" : esc(nm(r.fromId)) + " 邀請的"}</span><span>${ago(r.createdAt)}</span></span></span></button>`; }).join("")
    : `<div class="empty sm">在地圖上點一個烤肉點，按「申請加入」。</div>`;
  return h;
}

function boardHTML(sc) {
  const rows = Object.entries(sc).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const h = `<p class="rules">發起一個地點 <b>+20</b>、上傳一張現場照片 <b>+10</b>、成功加入別人的烤肉 <b>+5</b>。中秋夜看誰是今年的玉兔王。</p>`;
  if (!rows.length) return h + `<div class="empty"><h4>榜上還空著</h4><p>第一個發起或打卡的人就是榜首。</p></div>`;
  return h + `<div class="board">${rows.map(([id, s], i) => `<div class="rank"><span class="no">${i + 1}</span>${avatar(id)}<span class="nm">${esc(nm(id))}${id === uid() ? "（你）" : ""}</span><span class="s">${s}</span></div>`).join("")}</div>`;
}

/* ---------------- sheets ---------------- */
function openSheet(html) { $("sheetRoot").innerHTML = `<div class="veil" data-act="veil"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`; const f = $("sheetRoot").querySelector("input:not([type=file]),textarea"); if (f) f.focus(); }
function closeSheet() { $("sheetRoot").innerHTML = ""; }
let pendingFile = null;
function bindPhoto(inputId, prevId) {
  const ph = $(inputId); if (!ph) return;
  ph.onchange = () => { pendingFile = ph.files[0] || null; const pv = $(prevId); if (pendingFile) { pv.src = URL.createObjectURL(pendingFile); pv.hidden = false; } else pv.hidden = true; };
}
function openCreate(type, f = {}) {
  pendingFile = null;
  const loc = f.lat != null ? `${nearestCity(f.lat, f.lng)}附近（${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}）` : "還沒選位置";
  openSheet(`<h3>發起一個中秋點</h3>
  <div class="seg"><button type="button" class="bbq" aria-pressed="${type === "bbq"}" data-act="ctype" data-type="bbq">烤肉</button><button type="button" class="fw" aria-pressed="${type === "fireworks"}" data-act="ctype" data-type="fireworks">賣煙火</button></div>
  <label class="f">名稱<input id="c_title" maxlength="40" placeholder="${type === "bbq" ? "例如：河堤邊烤肉，柚子管夠" : "例如：仙女棒、沖天炮現場賣"}" value="${esc(f.title || "")}"></label>
  <label class="f">打卡地標<input id="c_landmark" maxlength="60" placeholder="例如：大佳河濱公園 3 號門" value="${esc(f.landmark || "")}"></label>
  <label class="f">時間<input id="c_when" maxlength="40" placeholder="例如：今晚 6:30 到 10 點" value="${esc(f.when || "")}"></label>
  ${type === "bbq" ? `<label class="f">最多幾人（含你）<input id="c_cap" type="number" min="2" max="99" inputmode="numeric" placeholder="不限可留空" value="${esc(f.capacity || "")}"></label>` : ""}
  <label class="f">說明<textarea id="c_note" maxlength="300" placeholder="${type === "bbq" ? "要帶什麼、有沒有烤肉架…" : "賣哪些品項、價格、營業到幾點…"}">${esc(f.note || "")}</textarea></label>
  <div class="f">位置<span class="locline">${loc}</span><div class="row"><button type="button" class="btn sm" data-act="pickloc" data-type="${type}">${f.lat != null ? "調整位置" : "定位 / 在地圖上選"}</button></div></div>
  <label class="f">現場照片（選填，算第一次打卡 +10）<input id="c_photo" type="file" accept="image/*" capture="environment"></label><img id="c_prev" class="preview" alt="" hidden>
  <p class="err" id="c_err" hidden></p>
  <div class="row end"><button class="btn ghost" data-act="close">取消</button><button class="btn ${type === "bbq" ? "ember" : "spark"}" id="c_submit" data-act="create" data-type="${type}" data-lat="${f.lat ?? ""}" data-lng="${f.lng ?? ""}">發佈到地圖</button></div>
  <p class="fine">活動會在 ${CFG.eventHours || 12} 小時後自動從地圖上消失，也可以隨時手動結束。</p>`);
  bindPhoto("c_photo", "c_prev");
}
const formVals = () => ({ title: $("c_title")?.value.trim(), landmark: $("c_landmark")?.value.trim(), when: $("c_when")?.value.trim(), capacity: $("c_cap")?.value, note: $("c_note")?.value.trim() });
function openCheckin(p) {
  pendingFile = null;
  openSheet(`<h3>打卡：${esc(p.title)}</h3><p class="sub">拍一張現場照片，證明這裡真的在${(TYPE[p.type] || TYPE.bbq).label}。</p>
  <label class="f">照片<input id="k_photo" type="file" accept="image/*" capture="environment"></label><img id="k_prev" class="preview" alt="" hidden>
  <label class="f">一句話（選填）<input id="k_cap" maxlength="60" placeholder="例如：香腸烤好了，快來"></label>
  <p class="err" id="k_err" hidden></p>
  <div class="row end"><button class="btn ghost" data-act="close">取消</button><button class="btn moon" data-act="docheckin" data-pid="${esc(p.id)}">上傳打卡</button></div>`);
  bindPhoto("k_photo", "k_prev");
}
function openApply(p) {
  openSheet(`<h3>申請加入「${esc(p.title)}」</h3><label class="f">跟主人說一句話<textarea id="a_msg" maxlength="140" placeholder="例如：我帶一盒月餅和兩顆柚子"></textarea></label><div class="row end"><button class="btn ghost" data-act="close">取消</button><button class="btn ember" data-act="doapply" data-pid="${esc(p.id)}">送出申請</button></div>`);
}
function openInvite(p) {
  const skip = new Set(members(p)); skip.add(p.hostId);
  const pend = new Set(S.requests.filter((r) => r.partyId === p.id && r.status === "pending").map((r) => (r.kind === "invite" ? r.toId : r.fromId)));
  const near = S.players.filter((x) => !skip.has(x.id) && typeof x.lat === "number").map((x) => ({ x, d: km(p, x) })).filter((o) => o.d <= 15).sort((a, b) => a.d - b.d).slice(0, 40);
  openSheet(`<h3>邀請附近的人</h3><p class="sub">列出 15 公里內分享過位置的人，由近到遠。</p>
  <div class="people">${near.length ? near.map(({ x, d }) => `<div class="person">${avatar(x.id)}<span class="n">${esc(nm(x.id))}<small>${fmtDist(d)} · ${ago(x.updatedAt)}更新位置</small></span>${pend.has(x.id) ? `<span class="pill wait">已邀請</span>` : `<button class="btn sm ember" data-act="doinvite" data-pid="${esc(p.id)}" data-to="${esc(x.id)}">邀請</button>`}</div>`).join("") : `<div class="empty sm">附近還沒有人分享位置。把網址傳給朋友，請他們按「分享我的位置」。</div>`}</div>
  <div class="row end"><button class="btn ghost" data-act="close">完成</button></div>`);
}

/* ---------------- writes ---------------- */
function errMsg(e) {
  const c = (e && e.code) || "";
  if (c.includes("permission-denied")) return "沒有權限做這件事（請確認已登入，安全規則已部署）。";
  if (c.includes("unauthenticated")) return "請先登入。";
  if (c.includes("quota") || c.includes("resource-exhausted")) return "空間或用量已滿，請稍後再試。";
  if (c.includes("unavailable")) return "網路不穩，請再試一次。";
  if (c.includes("popup-closed")) return "登入視窗被關掉了。";
  if (c.includes("unauthorized-domain")) return "這個網域還沒加入 Firebase 授權網域，請到 Authentication 設定新增。";
  return (e && e.message) || "沒有成功，請再試一次。";
}
async function guard(fn, errEl) {
  if (S.busy) return; S.busy = true;
  try { await fn(); }
  catch (e) { console.warn(e); const msg = errMsg(e); if (errEl && $(errEl)) { $(errEl).textContent = msg; $(errEl).hidden = false; } else toast(msg); }
  finally { S.busy = false; }
}
async function savePhoto(file) {
  const data = await compressImage(file);
  return S.store.add("photos", { ownerId: uid(), data, createdAt: now() });
}
const round3 = (v) => Math.round(v * 1000) / 1000; // 約 100 公尺，保護隱私
function saveMe(lat, lng) {
  guard(async () => {
    await S.store.set("players", uid(), { lat: round3(lat), lng: round3(lng), city: nearestCity(lat, lng), updatedAt: now() });
    toast("位置已分享，附近的主人看得到你了");
  });
}

/* ---------------- events ---------------- */
function select(id, fly = true) {
  S.selected = id; S.tab = "events"; renderPanel(); drawPins();
  const p = partyById(id);
  if (fly && p) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 15));
  if (innerWidth <= 860) document.querySelector(".panel").scrollIntoView({ behavior: "smooth", block: "start" });
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]"); if (!el) return; const a = el.dataset.act;
  if (a === "veil") { if (e.target === el) closeSheet(); return; }
  if (el.disabled) return;
  const p = el.dataset.pid ? partyById(el.dataset.pid) : null;
  switch (a) {
    case "signin": guard(() => S.store.signIn()); break;
    case "signout": guard(() => S.store.signOut()); break;
    case "tab": S.tab = el.dataset.tab; if (S.tab !== "events") S.selected = null; renderPanel(); drawPins(); break;
    case "filter": S.filter = el.dataset.f; renderPanel(); drawPins(); break;
    case "select": closeSheet(); select(el.dataset.pid); break;
    case "back": S.selected = null; renderPanel(); drawPins(); break;
    case "close": closeSheet(); break;
    case "setme": { const m = myPlayer(); startPlacing("me", m ? { lat: m.lat, lng: m.lng } : {}); break; }
    case "new": { const pos = myPos(); openCreate(el.dataset.type, pos ? { lat: pos.lat, lng: pos.lng } : {}); break; }
    case "ctype": { const b = $("c_submit"); openCreate(el.dataset.type, { ...formVals(), lat: b.dataset.lat ? +b.dataset.lat : null, lng: b.dataset.lng ? +b.dataset.lng : null }); break; }
    case "pickloc": { const b = $("c_submit"); startPlacing("party", { type: el.dataset.type, form: formVals(), lat: b.dataset.lat ? +b.dataset.lat : null, lng: b.dataset.lng ? +b.dataset.lng : null }); break; }
    case "create": {
      const f = formVals(); const type = el.dataset.type; const err = $("c_err");
      const lat = el.dataset.lat ? +el.dataset.lat : null, lng = el.dataset.lng ? +el.dataset.lng : null;
      if (!f.title) { err.textContent = "請幫這個點取個名字。"; err.hidden = false; return; }
      if (lat == null) { err.textContent = "請先按「定位 / 在地圖上選」決定位置。"; err.hidden = false; return; }
      el.disabled = true; el.textContent = "發佈中…";
      guard(async () => {
        const cap = parseInt(f.capacity, 10); const t = now();
        const id = await S.store.add("parties", {
          type, title: f.title, landmark: f.landmark || "", when: f.when || "", note: f.note || "",
          capacity: type === "bbq" && cap > 1 ? cap : null, lat, lng, city: nearestCity(lat, lng),
          hostId: uid(), active: true, createdAt: t, expiresAt: t + EVENT_MS,
        });
        if (pendingFile) { const photoId = await savePhoto(pendingFile); await S.store.add("checkins", { partyId: id, userId: uid(), photoId, caption: "", createdAt: now() }); }
        closeSheet(); toast(type === "bbq" ? "烤肉點已亮起" : "煙火攤已上地圖"); setTimeout(() => select(id), 50);
      }, "c_err").finally(() => { if (el.isConnected) { el.disabled = false; el.textContent = "發佈到地圖"; } });
      break;
    }
    case "apply": openApply(p); break;
    case "doapply": guard(async () => {
      await S.store.add("requests", { partyId: p.id, kind: "apply", fromId: uid(), toId: p.hostId, hostId: p.hostId, msg: $("a_msg").value.trim().slice(0, 140), status: "pending", createdAt: now() });
      closeSheet(); toast("申請已送出");
    }); break;
    case "cancel": guard(async () => { await S.store.remove("requests", el.dataset.rid); toast("已取消申請"); }); break;
    case "invite": openInvite(p); break;
    case "doinvite": el.disabled = true; guard(async () => {
      await S.store.add("requests", { partyId: p.id, kind: "invite", fromId: uid(), toId: el.dataset.to, hostId: p.hostId, msg: "", status: "pending", createdAt: now() });
      el.outerHTML = `<span class="pill wait">已邀請</span>`;
    }); break;
    case "respond": guard(async () => {
      await S.store.update("requests", el.dataset.rid, { status: el.dataset.s, respondedAt: now() });
      toast(el.dataset.s === "accepted" ? "成交，月圓人團圓" : "已婉拒");
    }); break;
    case "checkin": openCheckin(p); break;
    case "docheckin": {
      if (!pendingFile) { $("k_err").textContent = "請先選一張照片。"; $("k_err").hidden = false; return; }
      el.disabled = true; el.textContent = "上傳中…";
      guard(async () => {
        const photoId = await savePhoto(pendingFile);
        await S.store.add("checkins", { partyId: p.id, userId: uid(), photoId, caption: $("k_cap").value.trim().slice(0, 60), createdAt: now() });
        closeSheet(); toast("打卡成功 +10");
      }, "k_err").finally(() => { if (el.isConnected) { el.disabled = false; el.textContent = "上傳打卡"; } });
      break;
    }
    case "end":
      if (el.dataset.confirm) guard(async () => { await S.store.update("parties", p.id, { active: false, endedAt: now() }); S.selected = null; toast("活動已結束，謝謝你的烤肉"); });
      else { el.dataset.confirm = "1"; el.textContent = "再按一次確認結束"; }
      break;
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if ($("sheetRoot").innerHTML) closeSheet(); else if (S.placing) $("placeCancel").click(); } });

/* ---------------- boot ---------------- */
let unsubs = [];
function subscribe() {
  unsubs.forEach((u) => u()); unsubs = [];
  const on = (name, fn) => unsubs.push(S.store.watch(name, (arr) => { fn(arr); S.status = "ready"; if (S.selected && !partyById(S.selected)) S.selected = null; renderPanel(); drawPins(); }, () => { S.status = "error"; renderPanel(); }));
  on("parties", (a) => (S.parties = a));
  on("checkins", (a) => (S.checkins = a));
  on("users", (a) => { S.users = Object.fromEntries(a.map((u) => [u.id, u])); });
  if (uid()) { // 這些集合需要登入才能讀
    on("requests", (a) => (S.requests = a));
    on("players", (a) => (S.players = a));
  } else { S.requests = []; S.players = []; }
}
renderPanel();
(async () => {
  try {
    S.store = await createStore(CFG);
    S.store.onUser((u) => { S.user = u; subscribe(); renderPanel(); drawPins(); });
  } catch (e) { console.error(e); S.status = "error"; renderPanel(); }
})();
setInterval(() => { renderPanel(); drawPins(); }, 60000); // 更新「幾分鐘前」與過期活動
window.__S = S; // 方便除錯
