import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

const root = process.cwd();
const dist = join(root, "apps/web/dist");
const assets = join(dist, "assets");
const failures = [];
const js = readdirSync(assets).filter((name) => name.endsWith(".js"));
let largest = { name: "", bytes: 0 };
for (const name of js) {
	const bytes = gzipSync(readFileSync(join(assets, name))).byteLength;
	if (bytes > largest.bytes) largest = { name, bytes };
	if (bytes > 350 * 1024) failures.push(`${name}: gzip ${Math.ceil(bytes / 1024)} KiB > 350 KiB`);
}

const sw = readFileSync(join(dist, "sw.js"), "utf8");
const forbiddenWasm = readdirSync(assets).filter(
	(name) =>
		name.endsWith(".wasm") &&
		name !== sw.match(/mc-wa-sqlite-async-[A-Za-z0-9_-]+\.wasm/)?.[0] &&
		sw.includes(name),
);
if (forbiddenWasm.length > 0) {
	failures.push(`service worker zbytečně precachuje nepoužitý WASM: ${forbiddenWasm.join(", ")}`);
}

const precacheUrls = new Set(
	[...sw.matchAll(/"url":"([^"]+)"/g)].map((match) => match[1]).filter(Boolean),
);
let precacheBytes = 0;
for (const url of precacheUrls) {
	const path = join(dist, url);
	try {
		precacheBytes += statSync(path).size;
	} catch {
		failures.push(`precache odkazuje na chybějící soubor: ${relative(root, path)}`);
	}
}
if (precacheBytes > 5.5 * 1024 * 1024) {
	failures.push(`offline precache ${Math.ceil(precacheBytes / 1024)} KiB > 5632 KiB`);
}

if (failures.length > 0) {
	console.error(`Build budget failed:\n${failures.join("\n")}`);
	process.exit(1);
}
console.log(
	`Build budget: largest JS ${largest.name} ${Math.ceil(largest.bytes / 1024)} KiB gzip; precache ${Math.ceil(precacheBytes / 1024)} KiB.`,
);
