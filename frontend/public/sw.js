// Service worker tối giản: lưu vỏ ứng dụng (HTML/JS/CSS) để mở được khi ngoại tuyến.
// Không bao giờ chặn /api (ghi chú đã có IndexedDB lo phần dữ liệu).
const CACHE = "pkm-shell-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api") || url.pathname === "/health") return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "/" : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req.mode === "navigate" ? "/" : req).then((r) => r || Response.error())),
  );
});
