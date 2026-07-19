#!/usr/bin/env node
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const config = read("apps/web/vite.config.ts");
const capture = read("apps/web/src/lib/capture.ts");
const ingress = read("apps/web/src/screens/CaptureIngress.tsx");
const router = read("apps/web/src/router.tsx");
const provider = read("apps/web/src/lib/pwaInstall.tsx");
const card = read("apps/web/src/components/PwaInstallCard.tsx");
const main = read("apps/web/src/main.tsx");
const serviceWorker = read("apps/web/src/sw.ts");
const powerSyncDb = read("apps/web/src/lib/powersync/db.ts");
const cs = read("packages/i18n/src/locales/cs.json");
const en = read("packages/i18n/src/locales/en.json");
const uiVerifier = read("apps/api/verify-pwa-capture-ui.ts");
const runtimeVerifier = read("apps/api/verify-runtime-a11y.ts");

function pngSize(path) {
	const bytes = readFileSync(path);
	const signature = "89504e470d0a1a0a";
	if (bytes.subarray(0, 8).toString("hex") !== signature) return [0, 0];
	return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const checks = [
	[
		"manifest má stabilní identitu, standalone režim a skutečné PNG ikony",
		config.includes('id: "/"') &&
			config.includes('scope: "/"') &&
			config.includes('display: "standalone"') &&
			pngSize("apps/web/public/pwa-192.png").join("x") === "192x192" &&
			pngSize("apps/web/public/pwa-512.png").join("x") === "512x512" &&
			pngSize("apps/web/public/pwa-maskable-512.png").join("x") === "512x512",
	],
	[
		"Share Target a shortcut vedou do jediného existujícího Quick Capture ingressu",
		config.includes('action: "/zachytit"') &&
			config.includes('url: "/zachytit"') &&
			router.includes('path: "/zachytit"') &&
			ingress.includes("openCapture(capturePrefill(search))") &&
			ingress.includes('navigate({ to: "/", search: {}, replace: true })'),
	],
	[
		"neověřený capture vstup je omezený a URL dovoluje pouze HTTP(S) bez credentials",
		capture.includes('parsed.protocol !== "https:" && parsed.protocol !== "http:"') &&
			capture.includes("parsed.username || parsed.password") &&
			capture.includes("isUnsafeCodePoint") &&
			capture.includes('clean(contextParts.join("\\n\\n"), 4_096)'),
	],
	[
		"bookmarklet je jen kopírovaný text a Watson nikdy nevykresluje javascript: odkaz",
		card.includes("copyText(captureBookmarklet(window.location.origin))") &&
			!card.includes("href=") &&
			!ingress.includes("dangerouslySetInnerHTML"),
	],
	[
		"instalační provider pravdivě rozlišuje nabídku, instalaci a nedostupnost",
		provider.includes('addEventListener("beforeinstallprompt"') &&
			provider.includes('addEventListener("appinstalled"') &&
			provider.includes('"available" | "installed" | "unavailable"') &&
			main.includes("<PwaInstallProvider>"),
	],
	[
		"produkce nevystavuje PowerSync debug handle a release readiness používá veřejný trust state",
		powerSyncDb.includes("import.meta.env?.DEV === true ? (globalThis as PowerSyncHmrState) : {}") &&
			powerSyncDb.includes("if (import.meta.env?.DEV === true)") &&
			!runtimeVerifier.includes("__watsonDb") &&
			runtimeVerifier.includes('{ name: "Synchronizováno", exact: true }'),
	],
	[
		"offline jádro zůstává precache a navštívené volitelné moduly mají omezenou runtime cache",
		config.includes("globIgnores") &&
			config.includes('"**/Mail-*.js"') &&
			serviceWorker.includes('const RUNTIME_ASSETS = "watson-runtime-assets-v1"') &&
			serviceWorker.includes("MAX_RUNTIME_ASSET_ENTRIES = 48") &&
			serviceWorker.includes('url.pathname.startsWith("/assets/")'),
	],
	[
		"instalace a capture mají české i anglické copy bez tvrzení o nativní mobilní aplikaci",
		cs.includes('"settingsTitle": "Watson jako aplikace"') &&
			en.includes('"settingsTitle": "Watson as an app"') &&
			cs.includes('"captureContext"') &&
			en.includes('"captureContext"') &&
			!card.includes("native mobile"),
	],
	[
		"browser audit pokrývá oba enginy, manifest, DB round-trip, sanitizaci, mobil a WCAG",
		uiVerifier.includes("chromium,webkit") &&
			uiVerifier.includes("verifyManifest") &&
			uiVerifier.includes("eventuallySaved") &&
		uiVerifier.includes('"javascript:alert(1)"') &&
			uiVerifier.includes("assertAxeClean") &&
			uiVerifier.includes("width: 390") &&
			uiVerifier.includes("context.setOffline(true)") &&
			uiVerifier.includes("navigator.serviceWorker.controller"),
	],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? "✓" : "✗"} ${label}`);
if (failed.length) {
	console.error(`PWA capture contract failed: ${failed.map(([label]) => label).join(", ")}`);
	process.exit(1);
}
console.log("PWA capture contract: installable, bounded, offline-budgeted and reuse-first.");
