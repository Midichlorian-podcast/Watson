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
      manifest: {
        name: "Watson",
        short_name: "Watson",
        description: "Offline-first týmový nástroj — úkoly, projekty, kalendář, AI.",
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
      workbox: {
        navigateFallback: "/index.html",
        // PowerSync WASM (~2.5 MB) chceme v offline cache.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,svg,wasm}"],
        // Offline-first PWA: Google Fonts (Montserrat/Inter) cachovat runtime — po instalaci
        // a startu bez sítě se aplikace nerozpadne na systémové fonty (README Typografie).
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
  },
});
