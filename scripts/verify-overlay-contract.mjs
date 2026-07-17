import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("../apps/web/src/", import.meta.url);
const failures = [];

async function visit(directory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			await visit(path);
			continue;
		}
		if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
		const source = await readFile(path, "utf8");
		const label = relative(root.pathname, path);
		if (source.includes('aria-modal="true"') && !source.includes("useOverlayLayer"))
			failures.push(`${label}: modální dialog musí používat useOverlayLayer`);
		if (source.includes('role="menu"') && !source.includes("usePopoverLayer"))
			failures.push(`${label}: kontextové menu musí používat usePopoverLayer`);
		if (source.includes("data-saved-views") && !source.includes("usePopoverLayer"))
			failures.push(`${label}: nemodální popover musí používat usePopoverLayer`);
		if (label !== "lib/focusTrap.ts" && source.includes("document.body.style.overflow"))
			failures.push(`${label}: scroll lock smí spravovat jen focusTrap`);
		if (source.includes("lib/useFocusTrap"))
			failures.push(`${label}: zastaralý useFocusTrap nahraď useOverlayLayer`);
	}
}

await visit(root.pathname);
const tokens = await readFile(new URL("../packages/ui/src/tokens.css", import.meta.url), "utf8");
for (const token of [
	"--w-layer-popover",
	"--w-layer-drawer",
	"--w-layer-floating",
	"--w-layer-modal",
	"--w-layer-nested",
	"--w-layer-critical",
	"--w-layer-feedback",
]) {
	if (!tokens.includes(token)) failures.push(`tokens.css: chybí ${token}`);
}

if (failures.length) {
	console.error(`Overlay contract selhal (${failures.length}):\n${failures.join("\n")}`);
	process.exit(1);
}
console.log(
	"Overlay contract: modal/popover focus, topmost Escape, scroll lock a vrstvové tokeny jsou sjednocené.",
);
