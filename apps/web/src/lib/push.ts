/**
 * Klientská strana Web Push — povolení notifikací, (od)hlášení odběru na serveru.
 * Odběr drží service worker (src/sw.ts); veřejný VAPID klíč se tahá z /api/push/vapid.
 */
import { API_URL } from "./api";

export function pushSupported(): boolean {
	return (
		typeof navigator !== "undefined" &&
		"serviceWorker" in navigator &&
		typeof window !== "undefined" &&
		"PushManager" in window &&
		"Notification" in window
	);
}

export function notificationPermission():
	| NotificationPermission
	| "unsupported" {
	return pushSupported() ? Notification.permission : "unsupported";
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
	const padding = "=".repeat((4 - (base64.length % 4)) % 4);
	const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
	const raw = atob(b64);
	const arr = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
	return arr;
}

export type PushResult = "ok" | "denied" | "unsupported" | "no-vapid" | "error";

/** Požádá o povolení + zaregistruje Web Push odběr na serveru. Idempotentní. */
export async function enablePush(): Promise<PushResult> {
	if (!pushSupported()) return "unsupported";
	let permission = Notification.permission;
	if (permission === "default")
		permission = await Notification.requestPermission();
	if (permission !== "granted") return "denied";
	try {
		const reg = await navigator.serviceWorker.ready;
		const vapidRes = await fetch(`${API_URL}/api/push/vapid`, {
			credentials: "include",
		});
		const { publicKey, enabled } = (await vapidRes.json()) as {
			publicKey: string | null;
			enabled: boolean;
		};
		if (!enabled || !publicKey) return "no-vapid";
		let sub = await reg.pushManager.getSubscription();
		if (!sub) {
			sub = await reg.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
			});
		}
		await fetch(`${API_URL}/api/push/subscribe`, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(sub.toJSON()),
		});
		return "ok";
	} catch (e) {
		console.error("[push] enable selhal", e);
		return "error";
	}
}

/** Zruší odběr lokálně i na serveru. */
export async function disablePush(): Promise<void> {
	if (!pushSupported()) return;
	try {
		const reg = await navigator.serviceWorker.ready;
		const sub = await reg.pushManager.getSubscription();
		if (!sub) return;
		await fetch(`${API_URL}/api/push/unsubscribe`, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ endpoint: sub.endpoint }),
		});
		await sub.unsubscribe();
	} catch (e) {
		console.error("[push] disable selhal", e);
	}
}
