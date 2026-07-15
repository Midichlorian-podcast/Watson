export type DeepLinkEntity =
	| "task"
	| "project"
	| "list"
	| "flow"
	| "meeting"
	| "goal"
	| "mail"
	| "person";

const DEEP_LINKS: Record<
	DeepLinkEntity,
	{ path: string; key: string; fixed?: Record<string, string> }
> = {
	task: { path: "/ukoly", key: "ukol" },
	project: { path: "/projekty", key: "projekt" },
	list: { path: "/seznamy", key: "seznam" },
	flow: { path: "/postupy", key: "postup" },
	meeting: { path: "/meets", key: "meet" },
	goal: { path: "/cile", key: "cil" },
	mail: { path: "/mail", key: "vlakno" },
	person: { path: "/reporty", key: "clen", fixed: { tab: "lide" } },
};

/** Jediná kanonická mapa objekt → URL. Odkaz neobchází přístupová práva cílové stránky. */
export function deepLinkHref(
	entity: DeepLinkEntity,
	id: string,
	origin?: string,
	workspaceId?: string | null,
): string {
	const target = DEEP_LINKS[entity];
	const base = origin ?? (typeof window === "undefined" ? "https://watson.local" : location.origin);
	const url = new URL(target.path, base);
	for (const [key, value] of Object.entries(target.fixed ?? {})) url.searchParams.set(key, value);
	if (workspaceId) url.searchParams.set("prostor", workspaceId);
	url.searchParams.set(target.key, id);
	return url.toString();
}

/** Vrací false i při zamítnutém oprávnění clipboardu, aby UI mohlo ukázat poctivou chybu. */
export async function copyDeepLink(
	entity: DeepLinkEntity,
	id: string,
	workspaceId?: string | null,
): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(deepLinkHref(entity, id, undefined, workspaceId));
		return true;
	} catch {
		return false;
	}
}
