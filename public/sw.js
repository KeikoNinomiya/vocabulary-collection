// Service worker: offline app shell + push notifications.
const VERSION = "vc-v1";
const SHELL = ["/", "/index.html", "/app.js", "/styles.css", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) {
    // config may be served from cache when offline; everything else goes to the network
    if (url.pathname === "/api/config") e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
  if (url.hostname.endsWith("supabase.co")) return; // data goes straight to Supabase
  const sameOrigin = url.origin === location.origin;
  const cacheable = sameOrigin || /cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname);
  if (!cacheable) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put("/", copy)); return r; }).catch(() => caches.match("/")));
    return;
  }
  // stale-while-revalidate
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil((async () => {
    try { if (typeof d.badge === "number" && self.navigator.setAppBadge) d.badge ? await self.navigator.setAppBadge(d.badge) : await self.navigator.clearAppBadge(); } catch {}
    await self.registration.showNotification(d.title || "Vocabulary Collection", { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: { url: d.url || "/" }, tag: "daily" });
  })());
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = e.notification.data?.url || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const w of list) { if ("focus" in w) { w.navigate?.(target); return w.focus(); } }
    return self.clients.openWindow(target);
  }));
});
