/// <reference lib="webworker" />
/**
 * Vlastní service worker (vite-plugin-pwa `injectManifest`) — bez workboxu (self-contained):
 * - precache app shellu z `self.__WB_MANIFEST` (offline PWA), navigační fallback na index.html,
 * - runtime cache Google Fonts (parita s dřívějším generateSW),
 * - runtime cache navštívených volitelných hashovaných modulů,
 * - Web Push: zobrazení notifikace + klik → zaostření/otevření okna na daný odkaz.
 */
declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const PRECACHE = "watson-precache-v2";
const FONTS = "watson-fonts-v2";
const RUNTIME_ASSETS = "watson-runtime-assets-v1";
const PRECACHE_URLS = self.__WB_MANIFEST.map((e) => e.url);
const PRECACHE_ABSOLUTE = new Set(PRECACHE_URLS.map((url) => new URL(url, self.location.origin).href));
const MAX_FONT_ENTRIES = 24;
const MAX_RUNTIME_ASSET_ENTRIES = 48;

async function trimCache(cacheName: string, maxEntries: number): Promise<void> {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();
	await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((key) => cache.delete(key)));
}

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
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key !== PRECACHE && key !== FONTS && key !== RUNTIME_ASSETS)
					.map((key) => caches.delete(key)),
			);
			// Název precache zůstává mezi buildy stejný. Bez explicitního úklidu by
			// každý deploy trvale ponechal všechny staré hashované chunky a WASM.
			const precache = await caches.open(PRECACHE);
			const cachedRequests = await precache.keys();
			await Promise.all(
				cachedRequests
					.filter((request) => !PRECACHE_ABSOLUTE.has(request.url))
					.map((request) => precache.delete(request)),
			);
			await self.clients.claim();
		})(),
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

	// Stylesheet Google Fonts necháme přímo prohlížeči. WebKit odmítá opaque CSS,
	// pokud jej vrátí service worker; vlastní binární fonty lze bezpečně cacheovat.
	if (url.origin === "https://fonts.googleapis.com") return;

	// Google Fonts binární assety → cache-first s doplněním na pozadí.
	if (url.origin === "https://fonts.gstatic.com") {
		event.respondWith(
			caches.open(FONTS).then((c) =>
				c.match(req).then((cached) => {
					const net = fetch(req)
						.then((res) => {
							if (res.ok || res.type === "opaque") {
								void c.put(req, res.clone()).then(() => trimCache(FONTS, MAX_FONT_ENTRIES));
							}
							return res;
						})
						.catch(() => cached ?? Response.error());
					return cached ?? net;
				}),
			),
		);
		return;
	}

	// Vlastní origin → precache-first; navštívené volitelné hashované assety
	// uložíme do omezené runtime cache pro další offline použití.
	if (url.origin === self.location.origin) {
		event.respondWith(
			caches.match(req).then(async (cached) => {
				if (cached) return cached;
				const response = await fetch(req);
				if (url.pathname.startsWith("/assets/") && response.ok && response.type === "basic") {
					const runtime = await caches.open(RUNTIME_ASSETS);
					await runtime.put(req, response.clone());
					await trimCache(RUNTIME_ASSETS, MAX_RUNTIME_ASSET_ENTRIES);
				}
				return response;
			}),
		);
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
	const rawUrl = (event.notification.data as { url?: string } | null)?.url ?? "/";
	let url = "/";
	try {
		const candidate = new URL(rawUrl, self.location.origin);
		// Push payload nesmí aplikaci použít jako open-redirect/phishing launcher.
		if (candidate.origin === self.location.origin) url = `${candidate.pathname}${candidate.search}${candidate.hash}`;
	} catch {
		url = "/";
	}
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
