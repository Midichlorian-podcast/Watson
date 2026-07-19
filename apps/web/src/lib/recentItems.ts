import { readPrivateJson, writePrivateJson } from "./powersync/privateState";

const RECENT_ITEMS_KEY = "watson.private.recentEntities.v1";
const MAX_RECENT_ITEMS = 20;

export type RecentEntityKind = "task" | "project" | "meeting";
export interface RecentEntity {
	kind: RecentEntityKind;
	id: string;
	openedAt: string;
}

export function mergeRecentEntities(
	current: RecentEntity[],
	next: RecentEntity,
	limit = MAX_RECENT_ITEMS,
): RecentEntity[] {
	return [next, ...current.filter((item) => item.kind !== next.kind || item.id !== next.id)]
		.sort((a, b) => b.openedAt.localeCompare(a.openedAt))
		.slice(0, limit);
}

let writeChain: Promise<void> = Promise.resolve();

export async function readRecentEntities(): Promise<RecentEntity[]> {
	const rows = await readPrivateJson<RecentEntity[]>(RECENT_ITEMS_KEY, []);
	return rows.filter(
		(item) =>
			(item.kind === "task" || item.kind === "project" || item.kind === "meeting") &&
			typeof item.id === "string" &&
			item.id.length > 0 &&
			typeof item.openedAt === "string",
	);
}

/** Poslední objekty jsou osobní device-state a nikdy neopouštějí šifrovanou DB. */
export function rememberRecentEntity(kind: RecentEntityKind, id: string): Promise<void> {
	const update = async () => {
		const current = await readRecentEntities();
		await writePrivateJson(
			RECENT_ITEMS_KEY,
			mergeRecentEntities(current, { kind, id, openedAt: new Date().toISOString() }),
		);
		if (typeof window !== "undefined") window.dispatchEvent(new Event("watson:recent-items"));
	};
	writeChain = writeChain.then(update, update);
	return writeChain;
}

/** Navigace nesmí selhat jen kvůli pomocné historii; chybu ale nezamlčíme. */
export function trackRecentEntity(kind: RecentEntityKind, id: string): void {
	void rememberRecentEntity(kind, id).catch((error: unknown) => {
		console.warn("[recent-items] uložení poslední položky selhalo", {
			name: error instanceof Error ? error.name : "UnknownError",
		});
	});
}
