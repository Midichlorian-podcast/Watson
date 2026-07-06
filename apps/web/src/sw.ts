/// <reference lib="webworker" />
/**
 * Vlastní service worker (vite-plugin-pwa `injectManifest`) — bez workboxu (self-contained):
 * - precache app shellu z `self.__WB_MANIFEST` (offline PWA), navigační fallback na index.html,
 * - runtime cache Google Fonts (parita s dřívějším generateSW),
 * - Web Push: zobrazení notifikace + klik → zaostření/otevření okna na daný odkaz.
 */
declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const PRECACHE = "watson-precache-v1";
const FONTS = "watson-fonts-v1";
const PRECACHE_URLS = self.__WB_MANIFEST.map((e) => e.url);

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(PRECACHE)
			.then((c) => c.addAll(PRECACHE_URLS))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((k) => k !== PRECACHE && k !== FONTS)
						.map((k) => caches.delete(k)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const req = event.request;
	if (req.method !== "GET") return;
	const url = new URL(req.url);

	// Navigace → network-first, offline fallback na cachnutý index.html (SPA).
	if (req.mode === "navigate") {
		event.respondWith(
			fetch(req).catch(
				() =>
					caches
						.match("/index.html")
						.then((r) => r ?? Response.error()) as Promise<Response>,
			),
		);
		return;
	}

	// Google Fonts → cache-first s doplněním na pozadí.
	if (
		url.origin === "https://fonts.googleapis.com" ||
		url.origin === "https://fonts.gstatic.com"
	) {
		event.respondWith(
			caches.open(FONTS).then((c) =>
				c.match(req).then((cached) => {
					const net = fetch(req)
						.then((res) => {
							void c.put(req, res.clone());
							return res;
						})
						.catch(() => cached ?? Response.error());
					return cached ?? net;
				}),
			),
		);
		return;
	}

	// Vlastní origin (precachnuté hashované assety) → cache-first.
	if (url.origin === self.location.origin) {
		event.respondWith(caches.match(req).then((cached) => cached ?? fetch(req)));
	}
});

interface PushPayload {
	title?: string;
	body?: string;
	tag?: string;
	url?: string;
}

self.addEventListener("push", (event) => {
	let data: PushPayload = {};
	try {
		data = event.data ? (event.data.json() as PushPayload) : {};
	} catch {
		data = { body: event.data?.text() };
	}
	event.waitUntil(
		self.registration.showNotification(data.title ?? "Watson", {
			body: data.body ?? "",
			tag: data.tag,
			data: { url: data.url ?? "/" },
			icon: "/icon.svg",
			badge: "/icon.svg",
		}),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = (event.notification.data as { url?: string } | null)?.url ?? "/";
	event.waitUntil(
		self.clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((clientList) => {
				for (const client of clientList) {
					if ("focus" in client) {
						void client.navigate(url);
						return client.focus();
					}
				}
				return self.clients.openWindow(url);
			}),
	);
});
