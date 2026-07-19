import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	build: {
		// Raw-size warning is noisy for the PowerSync worker/runtime; the repository
		// enforces a stricter gzip + offline precache budget after every root build.
		chunkSizeWarningLimit: 1100,
		rollupOptions: {
			output: {
				// Překlady jsou stabilní statický asset a rostou nezávisle na runtime.
				// Oddělený preloadovaný chunk drží startovní runtime pod hard budgetem
				// a dovolí prohlížeči cacheovat copy mezi aplikačními releasy.
				manualChunks(id) {
					if (id.includes("/packages/i18n/src/locales/")) return "locales";
				},
			},
		},
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	// PowerSync (@powersync/web) si řeší vlastní web workery + WASM — nepředbundlovat.
	optimizeDeps: {
		exclude: ["@powersync/web", "@journeyapps/wa-sqlite"],
	},
	worker: {
		format: "es",
	},
	plugins: [
		react(),
		tailwindcss(),
		VitePWA({
			registerType: "autoUpdate",
			// Vlastní SW (src/sw.ts) — Web Push handlery + precache + font cache. Runtime caching
			// (Google Fonts) je deklarovaný přímo v sw.ts (injectManifest neumí `workbox.runtimeCaching`).
			strategies: "injectManifest",
			srcDir: "src",
			filename: "sw.ts",
			injectRegister: "auto",
			manifest: {
				name: "Watson",
				short_name: "Watson",
				description:
					"Offline-first týmový nástroj — úkoly, projekty, kalendář, AI.",
				lang: "cs",
				id: "/",
				scope: "/",
				orientation: "any",
				categories: ["productivity", "business"],
				theme_color: "#17283F",
				background_color: "#F5F4F0",
				display: "standalone",
				display_override: ["window-controls-overlay", "standalone"],
				start_url: "/",
				icons: [
					{
						src: "/pwa-192.png",
						sizes: "192x192",
						type: "image/png",
						purpose: "any",
					},
					{
						src: "/pwa-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "any",
					},
					{
						src: "/pwa-maskable-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
					{
						src: "/icon.svg",
						sizes: "any",
						type: "image/svg+xml",
						purpose: "any",
					},
				],
				shortcuts: [
					{
						name: "Rychlé zachycení",
						short_name: "Zachytit",
						description: "Přidat úkol nebo zachytit stránku",
						url: "/zachytit",
						icons: [{ src: "/pwa-192.png", sizes: "192x192", type: "image/png" }],
					},
					{
						name: "Můj den",
						short_name: "Můj den",
						description: "Otevřít dnešní práci",
						url: "/",
						icons: [{ src: "/pwa-192.png", sizes: "192x192", type: "image/png" }],
					},
				],
				share_target: {
					action: "/zachytit",
					method: "GET",
					enctype: "application/x-www-form-urlencoded",
					params: { title: "title", text: "text", url: "url" },
				},
			},
			injectManifest: {
				// PowerSync WASM včetně MultipleCiphers buildu chceme v offline cache;
				// lokální databáze je šifrovaná a bez mc-wa-sqlite by offline start selhal.
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
				// Manifest, jeho ikony a registerSW doplní plugin sám; globujeme jen
				// aplikační shell, aby v precache nevznikaly duplicitní URL.
				globPatterns: ["**/*.{js,css,html}", "**/mc-wa-sqlite-async-*.wasm"],
				// Denní jádro zůstává vždy offline. Objemnější volitelné moduly se uloží
				// do runtime cache po první návštěvě, aby instalace nepřekročila rozpočet.
				globIgnores: [
					"**/Mail-*.js",
					"**/Mitingy-*.js",
					"**/EmployeeHub-*.js",
					"**/Nastaveni-*.js",
					"**/Postupy-*.js",
					"**/Znalosti-*.js",
					"**/Velin-*.js",
					"**/Reporty-*.js",
				],
			},
			// Dev SW je záměrně vypnutý: cache v dev serveru jinak maskuje změny a
			// produkuje falešné regrese. Push/offline se ověřují na produkčním preview buildu.
			devOptions: {
				enabled: false,
				type: "module",
				navigateFallback: "index.html",
			},
		}),
	],
	server: {
		port: 5173,
	},
});
