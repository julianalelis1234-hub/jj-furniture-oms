/* JJ Furniture OMS — minimal offline shell for the Delivery Driver portal.
 * - /driver navigations: network first, fall back to the last cached copy.
 * - /_next/static/* (content-hashed): cache first.
 * Data lives in IndexedDB (see src/lib/offline/driver-db.ts); this only keeps
 * the page itself available when the phone has no signal. */
const CACHE = "jj-oms-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" && url.pathname === "/driver") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put("/driver", res.clone()));
          return res;
        })
        .catch(() => caches.match("/driver").then((r) => r || new Response("Offline and no saved copy yet. Open Deliveries once with signal.", { status: 503, headers: { "content-type": "text/plain" } }))),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});
