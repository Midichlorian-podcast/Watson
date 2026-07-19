import { type WatsonSurface, WINDOW_SURFACES, type WindowShell } from "./windowSurfaces";

const CHANNEL_NAME = "watson.windows.v1";
const STORAGE_EVENT_KEY = "watson.windowEvent.v1";
const LEADER_PREFIX = "watson.windowLeader.v1.";
const WINDOW_ID: string =
	globalThis.crypto?.randomUUID?.() ??
	`window-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type WindowEventType =
	| "session-invalidated"
	| "mail-invalidated"
	| "window-presence"
	| "window-closed";

export interface WindowPresencePayload {
	shell: WindowShell;
	surface: WatsonSurface | null;
	path: string;
}

export type WindowEventPayload =
	| Record<string, never>
	| { accountId?: string }
	| WindowPresencePayload;

export interface WatsonWindowMessage {
	version: 1;
	id: string;
	source: string;
	type: WindowEventType;
	sentAt: number;
	payload: WindowEventPayload;
}

type WindowEventListener = (message: WatsonWindowMessage) => void;

let channel: BroadcastChannel | null | undefined;
let storageListening = false;
const listeners = new Map<WindowEventType, Set<WindowEventListener>>();
const seenIds = new Set<string>();

function isShortString(value: unknown, max = 240): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= max;
}

export function parseWindowMessage(value: unknown): WatsonWindowMessage | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const row = value as Record<string, unknown>;
	if (
		row.version !== 1 ||
		!isShortString(row.id, 160) ||
		!isShortString(row.source, 160) ||
		typeof row.sentAt !== "number" ||
		!Number.isFinite(row.sentAt) ||
		!row.payload ||
		typeof row.payload !== "object" ||
		Array.isArray(row.payload) ||
		!["session-invalidated", "mail-invalidated", "window-presence", "window-closed"].includes(
			String(row.type),
		)
	)
		return null;

	const type = row.type as WindowEventType;
	const payload = row.payload as Record<string, unknown>;
	const payloadKeys = Object.keys(payload);
	if (
		(type === "session-invalidated" || type === "window-closed") &&
		payloadKeys.length !== 0
	)
		return null;
	if (
		type === "mail-invalidated" &&
		(payloadKeys.some((key) => key !== "accountId") ||
			(payload.accountId !== undefined && !isShortString(payload.accountId, 160)))
	)
		return null;
	if (type === "window-presence") {
		if (
			payloadKeys.some((key) => !["path", "shell", "surface"].includes(key)) ||
			!isShortString(payload.path, 500) ||
			!(["app", "focus", "wallboard"] as unknown[]).includes(payload.shell) ||
			(payload.surface !== null &&
				!WINDOW_SURFACES.some((surface) => surface.id === payload.surface))
		)
			return null;
	}
	return row as unknown as WatsonWindowMessage;
}

function dispatchMessage(value: unknown) {
	const message = parseWindowMessage(value);
	if (!message || message.source === WINDOW_ID || seenIds.has(message.id)) return;
	seenIds.add(message.id);
	if (seenIds.size > 200) seenIds.delete(seenIds.values().next().value ?? "");
	for (const listener of listeners.get(message.type) ?? []) listener(message);
}

function ensureTransport() {
	if (typeof window === "undefined") return;
	if (channel === undefined) {
		if (typeof BroadcastChannel !== "undefined") {
			channel = new BroadcastChannel(CHANNEL_NAME);
			channel.addEventListener("message", (event) => dispatchMessage(event.data));
		} else channel = null;
	}
	if (!channel && !storageListening) {
		storageListening = true;
		window.addEventListener("storage", (event) => {
			if (event.key !== STORAGE_EVENT_KEY || !event.newValue) return;
			try {
				dispatchMessage(JSON.parse(event.newValue));
			} catch {
				// Neplatná storage událost se ignoruje fail-closed.
			}
		});
	}
}

export function publishWindowEvent(type: WindowEventType, payload: WindowEventPayload = {}): void {
	if (typeof window === "undefined") return;
	ensureTransport();
	const message: WatsonWindowMessage = {
		version: 1,
		id: crypto.randomUUID(),
		source: WINDOW_ID,
		type,
		sentAt: Date.now(),
		payload,
	};
	if (channel) channel.postMessage(message);
	else {
		try {
			localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(message));
			localStorage.removeItem(STORAGE_EVENT_KEY);
		} catch {
			// Koordinace je podpůrná; blokované úložiště nesmí shodit datovou akci.
		}
	}
}

export function subscribeWindowEvent(
	type: WindowEventType,
	listener: WindowEventListener,
): () => void {
	ensureTransport();
	const typed = listeners.get(type) ?? new Set<WindowEventListener>();
	typed.add(listener);
	listeners.set(type, typed);
	return () => {
		typed.delete(listener);
		if (typed.size === 0) listeners.delete(type);
	};
}

export function registerWindowPresence(payload: WindowPresencePayload): () => void {
	if (typeof window === "undefined") return () => {};
	const announce = () => publishWindowEvent("window-presence", payload);
	announce();
	const interval = window.setInterval(announce, 15_000);
	window.addEventListener("focus", announce);
	const close = () => publishWindowEvent("window-closed", {});
	window.addEventListener("pagehide", close, { once: true });
	return () => {
		window.clearInterval(interval);
		window.removeEventListener("focus", announce);
		window.removeEventListener("pagehide", close);
	};
}

interface LeaderLease {
	owner: string;
	expiresAt: number;
}

export function parseLeaderLease(value: string | null): LeaderLease | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		if (!isShortString(parsed.owner, 160) || typeof parsed.expiresAt !== "number") return null;
		return { owner: parsed.owner, expiresAt: parsed.expiresAt };
	} catch {
		return null;
	}
}

export function canClaimLeaderLease(value: string | null, now: number, owner = WINDOW_ID): boolean {
	const lease = parseLeaderLease(value);
	return !lease || lease.owner === owner || lease.expiresAt <= now;
}

type NavigatorWithLocks = Navigator & {
	locks?: LockManager;
};

export async function withCrossWindowLock<T>(name: string, task: () => Promise<T>): Promise<T> {
	if (typeof navigator === "undefined") return task();
	const locks = (navigator as NavigatorWithLocks).locks;
	if (!locks) return task();
	return locks.request(`watson:${name}`, { mode: "exclusive" }, task);
}

/**
 * Spustí periodickou práci právě v jednom okně. Navigator Locks drží vedení až
 * do zavření okna; fallback používá krátký ověřený localStorage lease.
 */
export function startLeaderTask(
	name: string,
	intervalMs: number,
	task: () => Promise<void>,
): () => void {
	if (typeof window === "undefined" || typeof navigator === "undefined") return () => {};
	let stopped = false;
	let running = false;
	let leader = false;
	let timer: number | undefined;
	let leaseKey: string | undefined;
	const abort = new AbortController();
	const run = async () => {
		if (stopped || !leader || running) return;
		if (leaseKey) {
			try {
				const lease = parseLeaderLease(localStorage.getItem(leaseKey));
				if (lease?.owner !== WINDOW_ID || lease.expiresAt <= Date.now()) {
					leader = false;
					return;
				}
			} catch {
				leader = false;
				return;
			}
		}
		running = true;
		try {
			await task();
		} finally {
			running = false;
		}
	};
	const onOnline = () => void run();
	window.addEventListener("online", onOnline);

	const locks = (navigator as NavigatorWithLocks).locks;
	if (locks) {
		void locks
			.request(`watson:leader:${name}`, { mode: "exclusive", signal: abort.signal }, async () => {
				leader = true;
				void run();
				await new Promise<void>((resolve) => {
					timer = window.setInterval(() => void run(), intervalMs);
					abort.signal.addEventListener("abort", () => resolve(), { once: true });
				});
				leader = false;
			})
			.catch((error: unknown) => {
				if (!(error instanceof DOMException && error.name === "AbortError"))
					console.warn("[windows] leader lock selhal", { name });
			});
	} else {
		const key = `${LEADER_PREFIX}${name}`;
		leaseKey = key;
		let lastRun = 0;
		const tick = () => {
			const now = Date.now();
			try {
				if (canClaimLeaderLease(localStorage.getItem(key), now)) {
					localStorage.setItem(
						key,
						JSON.stringify({ owner: WINDOW_ID, expiresAt: now + Math.max(10_000, intervalMs * 2) }),
					);
					leader = parseLeaderLease(localStorage.getItem(key))?.owner === WINDOW_ID;
				} else leader = false;
			} catch {
				leader = false;
			}
			if (leader && now - lastRun >= intervalMs) {
				lastRun = now;
				void run();
			}
		};
		tick();
		timer = window.setInterval(tick, Math.min(5_000, Math.max(1_000, intervalMs / 2)));
	}

	return () => {
		stopped = true;
		leader = false;
		abort.abort();
		if (timer !== undefined) window.clearInterval(timer);
		window.removeEventListener("online", onOnline);
		if (leaseKey) {
			try {
				if (parseLeaderLease(localStorage.getItem(leaseKey))?.owner === WINDOW_ID) {
					localStorage.removeItem(leaseKey);
				}
			} catch {
				// Blokované úložiště už znamená, že fallback vedení není aktivní.
			}
		}
	};
}
