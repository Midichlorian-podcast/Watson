import { parseWindowShell, resolveWindowShell, windowSurfaceForPath } from "./windowSurfaces";

function parseSameOriginUrl(href: string, origin: string): URL | null {
	try {
		const url = new URL(href, origin);
		return url.origin === origin ? url : null;
	} catch {
		return null;
	}
}

/**
 * Nižší číslo = vhodnější okno pro notifikaci. Cizí focus/wallboard dostane
 * Infinity a service worker ho nikdy nepřenaviguje na nesouvisející modul.
 */
export function notificationWindowPriority(
	targetHref: string,
	clientHref: string,
	origin: string,
): number {
	const target = parseSameOriginUrl(targetHref, origin);
	const client = parseSameOriginUrl(clientHref, origin);
	if (!target || !client) return Number.POSITIVE_INFINITY;
	const clientShell = parseWindowShell(client.searchParams.get("shell"));
	const targetSurface = windowSurfaceForPath(target.pathname)?.id ?? null;
	const clientSurface = windowSurfaceForPath(client.pathname)?.id ?? null;
	if (
		target.pathname === client.pathname &&
		target.searchParams.toString() === client.searchParams.toString()
	)
		return 0;
	if (targetSurface && targetSurface === clientSurface) {
		if (clientShell === "focus") return 10;
		if (clientShell === "app") return 12;
		return 18;
	}
	if (clientShell === "app") return 30;
	return Number.POSITIVE_INFINITY;
}

/** Zachová focus/wallboard chrome kompatibilního cílového klienta. */
export function notificationNavigationUrl(
	targetHref: string,
	clientHref: string,
	origin: string,
): string | null {
	const target = parseSameOriginUrl(targetHref, origin);
	const client = parseSameOriginUrl(clientHref, origin);
	if (!target || !client) return null;
	if (!target.searchParams.has("shell")) {
		const clientShell = parseWindowShell(client.searchParams.get("shell"));
		if (
			clientShell !== "app" &&
			resolveWindowShell(target.pathname, clientShell) === clientShell
		) {
			target.searchParams.set("shell", clientShell);
		}
	}
	return `${target.pathname}${target.search}${target.hash}`;
}
