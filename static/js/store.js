// 資料層：同一套介面，兩種實作
//   * FirebaseStore — Firebase Auth（匿名登入 + 用戶名/密碼）+ Cloud Firestore 即時同步
//   * DemoStore     — 沒有 Firebase 設定時使用，資料存在這台電腦的瀏覽器（localStorage），
//                     每個分頁是一個不同的訪客，方便自己測試「申請 / 邀請」
//
// 介面：
//   onUser(cb)                    登入狀態改變時呼叫 cb(user | null)
//                                 user = {uid, name, isAnonymous}
//                                 打開網站會自動以匿名訪客登入
//   register(username, password)  訪客 → 正式帳號（沿用同一個 uid，資料都保留）
//   login(username, password)     用既有帳號登入
//   signOut()                     登出後會自動變成新的訪客
//   watch(name, cb) -> unsub      即時監聽一個集合，cb(陣列)
//   add(name, data) -> id         新增文件
//   set(name, id, data) / update(name, id, data) / remove(name, id)
//   getPhoto(id) -> dataURL       讀取照片（有快取）
//
// 用戶名怎麼變成 Firebase 帳號：Firebase 的密碼登入一定要「email」，
// 所以把用戶名（轉小寫）做 SHA-256，組成 u<40位hex>@users.mooncake-bbq.app 當作帳號，
// 使用者完全不需要有 email。用戶名本身存在 Firestore 的 users/{uid}.name 顯示用，
// 唯一性由 Firebase Auth 保證（同一個 email 不能註冊兩次）。

const FB_VER = "12.19.0";
const FB = (m) => `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${m}.js`;
const GUEST_NAMES = ["嫦娥", "后羿", "吳剛", "玉兔", "柚子", "月餅", "文旦", "烤玉米", "香腸", "蛋黃酥", "仙女棒", "孔明燈"];
const guestName = () => `${GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)]}${Math.floor(1000 + Math.random() * 9000)}`;

export const USERNAME_RE = /^[\p{L}\p{N}_-]{2,20}$/u;
export function checkUsername(u) {
  const name = (u || "").trim();
  if (!USERNAME_RE.test(name)) return "用戶名需 2–20 個字，可以用中英文、數字、底線或減號。";
  return null;
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const normalize = (u) => u.trim().normalize("NFKC").toLowerCase();
async function usernameToEmail(u) { return `u${(await sha256Hex(normalize(u))).slice(0, 40)}@users.mooncake-bbq.app`; }

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
  let lastUser; // 最近一次的登入狀態（onUser 晚註冊時補送）
  const emitUser = (u) => { lastUser = u; userCb(u); };
  let pendingName = null; // 註冊 / 登入流程中要寫入的用戶名

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
    if (!name) {
      const snap = await F.getDoc(ref);
      name = snap.exists() ? snap.data().name : null;
    }
    if (!name) name = guestName();
    const snapData = { name: name.slice(0, 60), photo: "", registered: !u.isAnonymous, updatedAt: Date.now() };
    await F.setDoc(ref, snapData);
    pendingName = null;
    return { uid: u.uid, name: snapData.name, isAnonymous: u.isAnonymous };
  }

  A.onAuthStateChanged(auth, async (u) => {
    if (!u) {
      emitUser(null);
      try { await A.signInAnonymously(auth); } // 自動變成訪客
      catch (e) { console.warn("anonymous sign-in", e); emitUser({ error: e }); }
      return;
    }
    try { emitUser(await profileFor(u)); }
    catch (e) { console.warn("profile", e); emitUser({ uid: u.uid, name: "月下旅人", isAnonymous: u.isAnonymous }); }
  });

  return {
    mode: "firebase",
    onUser(cb) { userCb = cb; if (lastUser !== undefined) cb(lastUser); },
    async register(username, password) {
      const err = checkUsername(username); if (err) throw new Error(err);
      const email = await usernameToEmail(username);
      const cred = A.EmailAuthProvider.credential(email, password);
      pendingName = username.trim();
      try {
        if (auth.currentUser && auth.currentUser.isAnonymous) {
          const r = await A.linkWithCredential(auth.currentUser, cred); // 保留原本訪客的 uid 與資料
          await r.user.getIdToken(true); // 換成「密碼登入」的新權杖，安全規則才認得
          emitUser(await profileFor(r.user));
        } else {
          const r = await A.createUserWithEmailAndPassword(auth, email, password);
          emitUser(await profileFor(r.user));
        }
      } catch (e) { pendingName = null; throw e; }
    },
    async login(username, password) {
      const err = checkUsername(username); if (err) throw new Error("用戶名或密碼不正確。");
      const email = await usernameToEmail(username);
      await A.signInWithEmailAndPassword(auth, email, password);
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
  const fail = (code) => { const e = new Error(code); e.code = code; throw e; };

  let userCb = () => {};
  let user = null;
  const saveSession = () => { try { user ? sessionStorage.setItem(KEY + ":me", JSON.stringify(user)) : sessionStorage.removeItem(KEY + ":me"); } catch {} };
  function newGuest() {
    user = { uid: "demo-" + rid(), name: guestName(), isAnonymous: true };
    mutate("users", (c) => { c[user.uid] = { name: user.name, photo: "", registered: false, updatedAt: Date.now() }; });
    saveSession();
  }
  try { const s = sessionStorage.getItem(KEY + ":me"); if (s) user = JSON.parse(s); } catch {}
  if (!user) newGuest();

  // 示範模式的「帳號表」：用戶名雜湊 → {uid, 密碼雜湊}，只存在這台電腦
  const accounts = () => read()._accounts || {};
  return {
    mode: "demo",
    onUser(cb) { userCb = cb; setTimeout(() => cb(user), 0); },
    async register(username, password) {
      const err = checkUsername(username); if (err) throw new Error(err);
      if ((password || "").length < 6) fail("auth/weak-password");
      const key = await sha256Hex(normalize(username));
      if (accounts()[key]) fail("auth/email-already-in-use");
      const pw = await sha256Hex(key + ":" + password);
      mutate("_accounts", (c) => { c[key] = { uid: user.uid, pw }; });
      user = { ...user, name: username.trim(), isAnonymous: false };
      mutate("users", (c) => { c[user.uid] = { name: user.name, photo: "", registered: true, updatedAt: Date.now() }; });
      saveSession(); userCb(user);
    },
    async login(username, password) {
      if (checkUsername(username)) fail("auth/invalid-credential");
      const key = await sha256Hex(normalize(username));
      const acc = accounts()[key];
      if (!acc || acc.pw !== (await sha256Hex(key + ":" + password))) fail("auth/invalid-credential");
      const name = (read().users || {})[acc.uid]?.name || username.trim();
      user = { uid: acc.uid, name, isAnonymous: false };
      saveSession(); userCb(user);
    },
    async signOut() { newGuest(); userCb(user); },
    watch(name, cb) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); setTimeout(() => emit(name), 0); return () => listeners.get(name).delete(cb); },
    async add(name, data) { const id = rid(); mutate(name, (c) => { c[id] = data; }); return id; },
    async set(name, id, data) { mutate(name, (c) => { c[id] = data; }); },
    async update(name, id, data) { mutate(name, (c) => { if (!c[id]) fail("not-found"); c[id] = { ...c[id], ...data }; }); },
    async remove(name, id) { mutate(name, (c) => { delete c[id]; }); },
    async getPhoto(id) { return (read().photos || {})[id]?.data || null; },
  };
}
