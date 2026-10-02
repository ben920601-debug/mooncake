// 共用小工具

// 各縣市中心（用來顯示「在哪個縣市附近」，不需要呼叫地理編碼服務）
export const CITIES = [
  ["基隆市", 121.74, 25.13], ["台北市", 121.56, 25.04], ["新北市", 121.46, 25.01], ["桃園市", 121.30, 24.99],
  ["新竹市", 120.97, 24.80], ["新竹縣", 121.10, 24.75], ["苗栗縣", 120.82, 24.56], ["台中市", 120.68, 24.15],
  ["彰化縣", 120.54, 24.08], ["南投縣", 120.97, 23.91], ["雲林縣", 120.43, 23.70], ["嘉義市", 120.45, 23.48],
  ["嘉義縣", 120.30, 23.45], ["台南市", 120.21, 22.99], ["高雄市", 120.31, 22.63], ["屏東縣", 120.49, 22.67],
  ["宜蘭縣", 121.75, 24.75], ["花蓮縣", 121.60, 23.98], ["台東縣", 121.14, 22.76], ["澎湖縣", 119.58, 23.57],
  ["金門縣", 118.32, 24.44], ["連江縣", 119.95, 26.16],
];

/** 兩點距離（公里） */
export function km(a, b) {
  const R = 6371, t = Math.PI / 180;
  const dLa = (b.lat - a.lat) * t, dLo = (b.lng - a.lng) * t;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const fmtDist = (d) => (d < 0.05 ? "就在附近" : d < 1 ? `${Math.round(d * 1000)} 公尺` : `${d.toFixed(1)} 公里`);

export function nearestCity(lat, lng) {
  let best = CITIES[0], bd = Infinity;
  for (const c of CITIES) { const d = km({ lat, lng }, { lat: c[2], lng: c[1] }); if (d < bd) { bd = d; best = c; } }
  return bd > 80 ? "台灣以外" : best[0];
}

export function ago(t) {
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.round(h / 24)} 天前`;
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * 把照片縮小並轉成 JPEG data URL，控制在約 700KB 內，
 * 才能放進一份 Firestore 文件（上限 1MB）。
 */
export async function compressImage(file, maxSide = 1280, maxChars = 700_000) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let side = maxSide;
    for (let attempt = 0; attempt < 6; attempt++) {
      const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.82, 0.72, 0.62, 0.5]) {
        const data = c.toDataURL("image/jpeg", q);
        if (data.length <= maxChars) return data;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error("照片太大，請換一張。");
  } catch (e) {
    if (e && e.message && e.message.startsWith("照片")) throw e;
    throw new Error("讀不到這張照片，請換成 JPG 或 PNG。");
  } finally {
    URL.revokeObjectURL(url);
  }
}
