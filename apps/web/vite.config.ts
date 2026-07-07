import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
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
				theme_color: "#17283F",
				background_color: "#F5F4F0",
				display: "standalone",
				start_url: "/",
				icons: [
					{
						src: "/icon.svg",
						sizes: "any",
						type: "image/svg+xml",
						purpose: "any maskable",
					},
				],
			},
			injectManifest: {
				// PowerSync WASM (~2.5 MB) chceme v offline cache.
				maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
				globPatterns: ["**/*.{js,css,html,svg,wasm}"],
				// mc-* = SQLite MultipleCiphers (šifrovaný build). Šifrování NEpoužíváme (žádný
				// encryption key), PowerSync načítá standardní `wa-sqlite` → 3,8 MB pryč z precache.
				globIgnores: ["**/mc-wa-sqlite*.wasm"],
			},
			// Dev: SW aktivní i v `vite dev`, aby šly Web Push notifikace ověřit lokálně.
			devOptions: {
				enabled: true,
				type: "module",
				navigateFallback: "index.html",
			},
		}),
	],
	server: {
		port: 5173,
	},
});
