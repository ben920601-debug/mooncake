// 資料層：同一套介面，兩種實作
//   * FirebaseStore — Firebase Auth（名字 + 4 位數密碼）+ Cloud Firestore 即時同步
//   * DemoStore     — 沒有 Firebase 設定時使用，資料存在這台電腦的瀏覽器（localStorage），
//                     每個分頁可以用不同名字進入，方便自己測試「申請 / 邀請」
//
// 介面：
//   onUser(cb)          登入狀態改變時呼叫 cb(user | null)，user = {uid, name}
//   enter(name, pin)    輸入名字 + 4 位數密碼：名字第一次出現就建立帳號，之後就是登入
//   signOut()
//   watch(name, cb) -> unsub      即時監聽一個集合，cb(陣列)
//   add(name, data) -> id         新增文件
//   set(name, id, data) / update(name, id, data) / remove(name, id)
//   getPhoto(id) -> dataURL       讀取照片（有快取）
//
// 名字怎麼變成 Firebase 帳號：Firebase 的密碼登入需要「email + 至少 6 碼密碼」，
// 所以把名字（轉小寫）做 SHA-256 組成 u<40位hex>@users.mooncake-bbq.app，
// 4 位數密碼則轉成固定格式的長密碼。使用者只會看到「名字 + 4 位數」。
// 名字唯一性由 Firebase Auth 保證（同一個帳號不能建立兩次）。

const FB_VER = "12.19.0";
const FB = (m) => `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${m}.js`;

export const NAME_RE = /^[\p{L}\p{N}_\- ]{1,20}$/u;
export const PIN_RE = /^\d{4}$/;
export function checkEntry(name, pin) {
  const n = (name || "").trim();
  if (!n) return "請輸入名字。";
  if (!NAME_RE.test(n)) return "名字最多 20 個字，可以用中英文、數字、空格、底線或減號。";
  if (!PIN_RE.test(pin || "")) return "密碼請輸入 4 位數字。";
  return null;
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const normalize = (n) => n.trim().normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
const nameToEmail = async (n) => `u${(await sha256Hex(normalize(n))).slice(0, 40)}@users.mooncake-bbq.app`;
const pinToPassword = (pin) => `mooncake-${pin}-bbq`;

// 統一的錯誤：名字被別人用了（或密碼打錯）
const nameTaken = () => { const e = new Error("name-taken"); e.code = "app/name-taken"; return e; };

export async function createStore(cfg) {
  if (cfg.firebase) return createFirebaseStore(cfg.firebase);
  return createDemoStore();
}

/* ------------------------------------------------------------------ */
async function createFirebaseStore(firebaseConfig) {
  const [{ initializeApp }, A, F] = await Promise.all([import(FB("app")), import(FB("auth")), import(FB("firestore"))]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  auth.languageCode = "zh-TW";
  const db = F.getFirestore(app);
  const photoCache = new Map();
  let userCb = () => {};
  let lastUser;
  const emitUser = (u) => { lastUser = u; userCb(u); };
  let pendingName = null;

  const queries = {
    parties: () => F.query(F.collection(db, "parties"), F.where("active", "==", true), F.limit(500)),
    requests: () => F.query(F.collection(db, "requests"), F.orderBy("createdAt", "desc"), F.limit(1000)),
    checkins: () => F.query(F.collection(db, "checkins"), F.orderBy("createdAt", "desc"), F.limit(800)),
    players: () => F.query(F.collection(db, "players"), F.limit(1000)),
    users: () => F.query(F.collection(db, "users"), F.limit(1000)),
  };

  async function profileFor(u) {
    const ref = F.doc(db, "users", u.uid);
    let name = pendingName;
    if (!name) { const snap = await F.getDoc(ref); name = snap.exists() ? snap.data().name : null; }
    name = (name || "月下旅人").slice(0, 60);
    if (pendingName) await F.setDoc(ref, { name, photo: "", updatedAt: Date.now() });
    pendingName = null;
    return { uid: u.uid, name };
  }

  A.onAuthStateChanged(auth, async (u) => {
    if (!u) return emitUser(null);
    if (u.isAnonymous) { await A.signOut(auth); return; } // 舊版留下的匿名身分，清掉
    try { emitUser(await profileFor(u)); }
    catch (e) { console.warn("profile", e); emitUser({ uid: u.uid, name: "月下旅人" }); }
  });

  return {
    mode: "firebase",
    onUser(cb) { userCb = cb; if (lastUser !== undefined) cb(lastUser); },
    async enter(name, pin) {
      const bad = checkEntry(name, pin); if (bad) throw new Error(bad);
      const email = await nameToEmail(name), password = pinToPassword(pin);
      pendingName = name.trim();
      try {
        try {
          await A.signInWithEmailAndPassword(auth, email, password); // 老朋友：直接登入
        } catch (e) {
          if (!["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password", "auth/invalid-login-credentials"].includes(e.code)) throw e;
          try {
            await A.createUserWithEmailAndPassword(auth, email, password); // 新名字：建立帳號
          } catch (e2) {
            if (e2.code === "auth/email-already-in-use") throw nameTaken(); // 名字已存在 → 密碼不對
            throw e2;
          }
        }
      } catch (e) { pendingName = null; throw e; }
    },
    signOut: () => A.signOut(auth),
    watch(name, cb, onErr) {
      return F.onSnapshot(queries[name](), (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.warn(name, e); onErr && onErr(e); });
    },
    async add(name, data) { const r = await F.addDoc(F.collection(db, name), data); return r.id; },
    set: (name, id, data) => F.setDoc(F.doc(db, name, id), data),
    update: (name, id, data) => F.updateDoc(F.doc(db, name, id), data),
    remove: (name, id) => F.deleteDoc(F.doc(db, name, id)),
    async getPhoto(id) {
      if (photoCache.has(id)) return photoCache.get(id);
      const p = F.getDoc(F.doc(db, "photos", id)).then((s) => (s.exists() ? s.data().data : null));
      photoCache.set(id, p); return p;
    },
  };
}

/* ------------------------------------------------------------------ */
function createDemoStore() {
  const KEY = "mooncake-demo-v1";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const write = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { console.warn(e); throw { code: "quota-exceeded" }; } };
  const listeners = new Map();
  const emit = (name) => { const arr = Object.entries(read()[name] || {}).map(([id, d]) => ({ id, ...d })); (listeners.get(name) || new Set()).forEach((cb) => cb(arr)); };
  window.addEventListener("storage", (e) => { if (e.key === KEY) listeners.forEach((_, n) => emit(n)); });
  const rid = () => Math.random().toString(36).slice(2, 12);
  const mutate = (name, fn) => { const all = read(); all[name] = all[name] || {}; fn(all[name]); write(all); emit(name); };

  let userCb = () => {};
  let user = null;
  try { const s = sessionStorage.getItem(KEY + ":me"); if (s) user = JSON.parse(s); } catch {}
  const saveSession = () => { try { user ? sessionStorage.setItem(KEY + ":me", JSON.stringify(user)) : sessionStorage.removeItem(KEY + ":me"); } catch {} };

  return {
    mode: "demo",
    onUser(cb) { userCb = cb; setTimeout(() => cb(user), 0); },
    async enter(name, pin) {
      const bad = checkEntry(name, pin); if (bad) throw new Error(bad);
      const key = await sha256Hex(normalize(name));
      const pw = await sha256Hex(key + ":" + pin);
      const acc = (read()._accounts || {})[key];
      if (acc && acc.pw !== pw) throw nameTaken();
      if (acc) {
        user = { uid: acc.uid, name: (read().users || {})[acc.uid]?.name || name.trim() };
      } else {
        user = { uid: "demo-" + rid(), name: name.trim() };
        mutate("_accounts", (c) => { c[key] = { uid: user.uid, pw }; });
        mutate("users", (c) => { c[user.uid] = { name: user.name, photo: "", updatedAt: Date.now() }; });
      }
      saveSession(); userCb(user);
    },
    async signOut() { user = null; saveSession(); userCb(null); },
    watch(name, cb) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); setTimeout(() => emit(name), 0); return () => listeners.get(name).delete(cb); },
    async add(name, data) { const id = rid(); mutate(name, (c) => { c[id] = data; }); return id; },
    async set(name, id, data) { mutate(name, (c) => { c[id] = data; }); },
    async update(name, id, data) { mutate(name, (c) => { if (!c[id]) { const e = new Error("not-found"); e.code = "not-found"; throw e; } c[id] = { ...c[id], ...data }; }); },
    async remove(name, id) { mutate(name, (c) => { delete c[id]; }); },
    async getPhoto(id) { return (read().photos || {})[id]?.data || null; },
  };
}
