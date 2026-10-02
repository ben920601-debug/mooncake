// 資料層：同一套介面，兩種實作
//   * FirebaseStore — Firebase Auth（Google 登入）+ Cloud Firestore 即時同步
//   * DemoStore     — 沒有 Firebase 設定時使用，資料存在這台電腦的瀏覽器（localStorage），
//                     每個分頁是一個不同的示範身分，方便自己測試「申請 / 邀請」
//
// 介面：
//   onUser(cb)                 登入狀態改變時呼叫 cb(user | null)，user = {uid, name, photo}
//   signIn() / signOut()
//   watch(name, cb) -> unsub   即時監聽一個集合，cb(陣列)
//   add(name, data) -> id      新增文件
//   set(name, id, data) / update(name, id, data) / remove(name, id)
//   getPhoto(id) -> dataURL    讀取照片（有快取）

const FB_VER = "12.19.0";
const FB = (m) => `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${m}.js`;

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

  // 集合 → 查詢。parties 只抓進行中的，其餘依時間取最新一批
  const queries = {
    parties: () => F.query(F.collection(db, "parties"), F.where("active", "==", true), F.limit(500)),
    requests: () => F.query(F.collection(db, "requests"), F.orderBy("createdAt", "desc"), F.limit(1000)),
    checkins: () => F.query(F.collection(db, "checkins"), F.orderBy("createdAt", "desc"), F.limit(800)),
    players: () => F.query(F.collection(db, "players"), F.limit(1000)),
    users: () => F.query(F.collection(db, "users"), F.limit(1000)),
  };

  return {
    mode: "firebase",
    onUser(cb) {
      return A.onAuthStateChanged(auth, async (u) => {
        if (!u) return cb(null);
        const user = { uid: u.uid, name: u.displayName || "月下旅人", photo: u.photoURL || "" };
        // 存一份公開的顯示名稱，讓其他人看得到你是誰
        try { await F.setDoc(F.doc(db, "users", u.uid), { name: user.name.slice(0, 60), photo: (user.photo || "").slice(0, 500), updatedAt: Date.now() }); } catch (e) { console.warn("users", e); }
        cb(user);
      });
    },
    async signIn() {
      const provider = new A.GoogleAuthProvider();
      try { await A.signInWithPopup(auth, provider); }
      catch (e) {
        // 手機或擋彈出視窗的瀏覽器改用整頁跳轉
        if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") return A.signInWithRedirect(auth, provider);
        throw e;
      }
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
  const listeners = new Map(); // name -> Set(cb)
  const emit = (name) => { const arr = Object.entries(read()[name] || {}).map(([id, d]) => ({ id, ...d })); (listeners.get(name) || new Set()).forEach((cb) => cb(arr)); };
  const emitAll = () => listeners.forEach((_, n) => emit(n));
  window.addEventListener("storage", (e) => { if (e.key === KEY) emitAll(); }); // 其他分頁的變更
  const rid = () => Math.random().toString(36).slice(2, 12);
  const NAMES = ["嫦娥", "后羿", "吳剛", "玉兔", "柚子", "月餅", "文旦", "烤玉米", "香腸", "蛋黃酥"];

  let userCb = () => {};
  let user = null;
  try { const s = sessionStorage.getItem(KEY + ":me"); if (s) user = JSON.parse(s); } catch {}

  const mutate = (name, fn) => { const all = read(); all[name] = all[name] || {}; fn(all[name]); write(all); emit(name); };
  return {
    mode: "demo",
    onUser(cb) { userCb = cb; setTimeout(() => cb(user), 0); return () => {}; },
    async signIn() {
      const n = NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(10 + Math.random() * 89);
      user = { uid: "demo-" + rid(), name: n, photo: "" };
      try { sessionStorage.setItem(KEY + ":me", JSON.stringify(user)); } catch {}
      mutate("users", (c) => { c[user.uid] = { name: user.name, photo: "", updatedAt: Date.now() }; });
      userCb(user);
    },
    async signOut() { user = null; try { sessionStorage.removeItem(KEY + ":me"); } catch {} userCb(null); },
    watch(name, cb) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); setTimeout(() => emit(name), 0); return () => listeners.get(name).delete(cb); },
    async add(name, data) { const id = rid(); mutate(name, (c) => { c[id] = data; }); return id; },
    async set(name, id, data) { mutate(name, (c) => { c[id] = data; }); },
    async update(name, id, data) { mutate(name, (c) => { if (!c[id]) throw { code: "not-found" }; c[id] = { ...c[id], ...data }; }); },
    async remove(name, id) { mutate(name, (c) => { delete c[id]; }); },
    async getPhoto(id) { return (read().photos || {})[id]?.data || null; },
  };
}
