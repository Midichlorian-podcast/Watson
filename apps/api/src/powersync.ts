/**
 * PowerSync backend integrace:
 *  - JWKS endpoint (RS256) — PowerSync service jím ověřuje klientské tokeny,
 *  - token endpoint — vydá krátkodobý JWT (sub = user id) přihlášenému uživateli,
 *  - write endpoint — aplikuje upload frontu klienta (CRUD) do Postgresu s kontrolou práv.
 *
 * Write-path je GENERALIZOVANÝ: registr tabulek (TABLES) s whitelistem sloupců a row-level
 * kontrolou (R5) přes členství v projektu. Přidat tabulku = přidat záznam do registru,
 * žádné natvrdo psané SQL per tabulka.
 */
import { createHash } from "node:crypto";
import { getDb, sql } from "@watson/db";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { z } from "zod";
import { auth } from "./auth";
import { loadSigningKeyRing, SIGNING_ALG } from "./signingKeys";
import { reminderEmailAvailability } from "./serviceIntegrations";
import { preflightAvailabilityForSyncWrite } from "./taskAvailability";

const AUDIENCE = "powersync";
const POWERSYNC_ISSUER = process.env.POWERSYNC_ISSUER ?? "watson-powersync";
/** Bridge-token pro LuckyOS employee API (zaměstnanecký modul). */
const LUCKYOS_AUDIENCE = "luckyos";
const LUCKYOS_ISSUER = process.env.LUCKYOS_ISSUER ?? "watson-luckyos";

// Oddělené compromise domains. JWKS obsahuje aktuální i staré veřejné klíče
// během overlap rotace, ale podpis vždy používá právě currentKid.
const powerSyncKeyRing = await loadSigningKeyRing("powersync");
const luckyOsKeyRing = await loadSigningKeyRing("luckyos");

export const getPowerSyncJwks = () => powerSyncKeyRing.publicJwks;
export const getLuckyOsJwks = () => luckyOsKeyRing.publicJwks;

/** Krátkodobý JWT pro PowerSync (sub = user id). */
export async function issuePowerSyncToken(userId: string) {
	return new SignJWT({})
		.setProtectedHeader({ alg: SIGNING_ALG, kid: powerSyncKeyRing.currentKid })
		.setSubject(userId)
		.setAudience(AUDIENCE)
		.setIssuer(POWERSYNC_ISSUER)
		.setIssuedAt()
		.setExpirationTime("10m")
		.sign(powerSyncKeyRing.privateKey);
}

/**
 * Krátkodobý bridge-token pro LuckyOS employee API (server-to-server). LuckyOS ho ověří
 * proti JWKS na `/api/employee/jwks` (oddělený keyring), zkontroluje `aud`/`iss`/`exp`
 * a z claimu `email` dohledá osobu. Nikdy neopustí server (prohlížeč ho nevidí).
 * Spec pro LuckyOS: files/ZAMESTNANEC_LUCKYOS_pozadavky_2026-07-12.md §1.
 */
export async function issueBridgeToken(claims: { email: string; personId?: string | null }) {
	return new SignJWT({
		email: claims.email,
		role: "employee",
		...(claims.personId ? { person_id: claims.personId } : {}),
	})
		.setProtectedHeader({ alg: SIGNING_ALG, kid: luckyOsKeyRing.currentKid })
		.setSubject(claims.personId ?? claims.email)
		.setAudience(LUCKYOS_AUDIENCE)
		.setIssuer(LUCKYOS_ISSUER)
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(luckyOsKeyRing.privateKey);
}

export const powersyncRoutes = new Hono<{ Variables: { requestId: string } }>();

/** JWKS — PowerSync service sem chodí pro veřejné klíče. */
powersyncRoutes.get("/api/powersync/jwks", (c) =>
	c.json({ keys: getPowerSyncJwks() }),
);
/** LuckyOS nikdy nedostane PowerSync klíče a naopak. Alias odpovídá integračnímu kontraktu. */
powersyncRoutes.get("/api/employee/jwks", (c) =>
	c.json({ keys: getLuckyOsJwks() }),
);
powersyncRoutes.get("/api/integrations/luckyos/jwks", (c) =>
	c.json({ keys: getLuckyOsJwks() }),
);

/** Vydá PowerSync token přihlášenému uživateli + endpoint sync služby. */
powersyncRoutes.get("/api/powersync/token", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const token = await issuePowerSyncToken(session.user.id);
	return c.json({
		token,
		powersync_url: process.env.POWERSYNC_URL || "http://localhost:8080",
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Registr zapisovatelných tabulek
// ─────────────────────────────────────────────────────────────────────────────

type ColType = "text" | "int" | "bool" | "ts" | "json";

interface TableDef {
	/** Zapisovatelné sloupce → typ (pro správný cast SQLite→Postgres). `id` se řeší zvlášť. */
	columns: Record<string, ColType>;
	/** Uživatelské texty s produktovým limitem; kontrola před DB dává stabilní 422. */
	maxLengths?: Record<string, number>;
	/** Má sloupec `updated_at` (nastaví se now() při zápisu). */
	hasUpdatedAt: boolean;
	/** Sloupec autora — na PUT se vyplní serverovým userId (atribuce, R10). */
	creatorCol?: string;
	/** Sloupec „vlastníka" (user_id) — server VŽDY přepíše na session userId (PUT i PATCH).
	 *  Brání padělání identity: osobní připomínky / barvy / audit-log nelze zapsat cizím jménem. */
	ownerCol?: string;
	/** Append-only tabulka (audit log): PATCH a DELETE jsou zakázané. */
	appendOnly?: boolean;
	/** Tabulka se přes sync jen EDITUJE — create patří výhradně API commandu
	 *  (CC-P0-07 atomicita: projekt vzniká se statusy a managerem najednou).
	 *  PUT se odmítne deterministicky (400), ne až NOT NULL chybou z DB. */
	patchOnly?: boolean;
	/** Minimální projektová role pro zápis (default „editor"). commenter smí jen komentáře/overlaye. */
	minRole?: "commenter" | "editor" | "manager";
	/** Sloupce, jejichž změna vyžaduje roli „manager" (owner_id/visibility/archivace projektu). */
	managerCols?: string[];
	/** PATCH/DELETE smí jen autor (creatorCol) nebo manager projektu / admin prostoru. */
	authorEditOnly?: boolean;
	/** PUT je jen CREATE: konflikt existujícího id NEpřepíše řádek (ON CONFLICT DO NOTHING).
	 *  Krok směrem k CC-P0-06 — brání přepsání cizího řádku i autora přes „create". */
	createOnly?: boolean;
	/** Jak zjistit project_id pro membership kontrolu (R5). `self` = řádek JE projekt (id). */
	projectVia?: { kind: "column"; col: string } | { kind: "task"; col: string } | { kind: "self" };
	/** Workspace-scoped tabulky (cíle): membership kontrola přes memberships.workspace_id. */
	workspaceVia?: { kind: "column"; col: string };
	/** FK sloupce na řádek (se sloupcem project_id), jehož projekt musí být útočníkův —
	 *  brání cross-project referenci (parent_id/section_id/status_id). */
	refProjectCols?: { col: string; table: string }[];
	/** FK na workspace-scoped tabulku z project-scoped řádku; cíl musí patřit
	 *  do stejného workspace jako projekt řádku (tasks.meeting_id → meetings). */
	refTenantCols?: { col: string; table: string }[];
	/** Sloupce s user_id, které musí být členem projektu řádku (assignments.user_id). */
	memberCols?: string[];
	/** FK sloupce na řádek se sloupcem `workspace_id`, jehož workspace musí být STEJNÝ jako
	 *  workspace zapisovaného řádku — brání cross-tenant referenci u workspace-scoped tabulek
	 *  (list_items.list_id/section_id, lists.project_id/template_id). Audit S7. */
	refWorkspaceCols?: { col: string; table: string }[];
	/** Sloupce s user_id, které musí být členem workspace řádku (list_items.who_id). Audit S7. */
	memberWorkspaceCols?: string[];
	/** Řádek přiřazuje lidi k úkolu, který může být KOTEVNÍM úkolem porady — o účastnících
	 *  (a tím o přístupu k doslovnému přepisu, §15/3) rozhoduje jen účastník nebo zakladatel
	 *  porady. Bez toho si kterýkoli editor projektu přidá assignment sám a přepis si odemkne
	 *  (audit CC-P0-13/F1: „pozvání" musí být akt účastníka, ne samoobsluha). */
	meetingHubGuard?: boolean;
}

/** Pořadí projektových rolí (R5) — vyšší číslo = víc práv. */
const PROJECT_ROLE_RANK: Record<string, number> = {
	commenter: 1,
	editor: 2,
	manager: 3,
};

type WorkspaceRole = "guest" | "member" | "manager" | "admin" | "owner";
const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
	guest: 0,
	member: 1,
	manager: 2,
	admin: 3,
	owner: 4,
};

/**
 * Centrální default-deny policy pro workspace-scoped sync zdroje. Chybějící
 * resource/action není „member může", ale zákaz. Jemné author/project/tenant
 * guardy se vyhodnocují navíc pod touto minimální rolí.
 */
export const WORKSPACE_WRITE_POLICY: Record<
	string,
	Partial<Record<Op, WorkspaceRole>>
> = {
	goals: { PUT: "manager", PATCH: "manager", DELETE: "manager" },
	goal_projects: { PUT: "manager", PATCH: "manager", DELETE: "manager" },
	goal_milestones: { PUT: "manager", PATCH: "manager", DELETE: "manager" },
	contacts: { PUT: "member", PATCH: "member", DELETE: "member" },
	lists: { PUT: "member", PATCH: "member", DELETE: "member" },
	list_sections: { PUT: "member", PATCH: "member", DELETE: "member" },
	list_items: { PUT: "member", PATCH: "member", DELETE: "member" },
	list_templates: { PUT: "manager", PATCH: "manager", DELETE: "manager" },
	// Metadata meetings smí vzniknout pouze /api/meetings/plan nebo /extract.
	// Sync nechává jen autorovu editaci/odstranění starších řádků.
	meetings: { PATCH: "member" },
};

/** Write registry — exportovaný i pro contract test (verify-contract.ts). */
export const TABLES: Record<string, TableDef> = {
	tasks: {
		columns: {
			project_id: "text",
			section_id: "text",
			parent_id: "text",
			name: "text",
			description: "text",
			why_now: "text",
			priority: "int",
			color: "text",
			due_date: "ts",
			start_date: "ts",
			start_timezone: "text",
			deadline: "ts",
			duration_min: "int",
			days: "int",
			sort_order: "int",
			recurrence: "text",
			recurrence_rule: "text",
			recurrence_basis: "text",
			assignment_mode: "text",
			status_id: "text",
			mail_th: "text",
			mail_label: "text",
			kind: "text",
			meeting_id: "text",
			completed_at: "ts",
		},
		maxLengths: { why_now: 1000 },
		hasUpdatedAt: true,
		creatorCol: "created_by",
		projectVia: { kind: "column", col: "project_id" },
		refProjectCols: [
			{ col: "parent_id", table: "tasks" },
			{ col: "section_id", table: "sections" },
			{ col: "status_id", table: "statuses" },
		],
		refTenantCols: [{ col: "meeting_id", table: "meetings" }],
	},
	task_dependencies: {
		columns: {
			project_id: "text",
			blocking_task_id: "text",
			blocked_task_id: "text",
			created_by: "text",
		},
		hasUpdatedAt: false,
		creatorCol: "created_by",
		createOnly: true,
		projectVia: { kind: "column", col: "project_id" },
		refProjectCols: [
			{ col: "blocking_task_id", table: "tasks" },
			{ col: "blocked_task_id", table: "tasks" },
		],
	},
	task_custom_field_values: {
		columns: {
			field_id: "text",
			task_id: "text",
			project_id: "text",
			value: "json",
			updated_by: "text",
		},
		hasUpdatedAt: true,
		ownerCol: "updated_by",
		minRole: "editor",
		projectVia: { kind: "task", col: "task_id" },
		refProjectCols: [{ col: "field_id", table: "project_custom_fields" }],
	},
	sections: {
		columns: { project_id: "text", name: "text", position: "int" },
		hasUpdatedAt: false,
		projectVia: { kind: "column", col: "project_id" },
	},
	// Editace projektu (název/barva/ikona/layout/viditelnost/archivace). `self` = členství
	// se ověřuje vůči SAMOTNÉMU projektu → editovat/archivovat smí jen člen; vytvoření nového
	// projektu přes write-path tím pádem NEjde (člen ještě neexistuje) — to řeší server/API.
	// Záměrně bez `workspace_id` (přesun mezi prostory není klientská operace).
	projects: {
		patchOnly: true,
		columns: {
			name: "text",
			color: "text",
			icon: "text",
			default_layout: "text",
			visibility: "text",
			kind: "text",
			owner_id: "text",
			status: "text",
			delivery_date: "ts",
			definition_of_done: "text",
			milestones_enabled: "bool",
			urgent_acceptance_enabled: "bool",
			urgent_acceptance_priority: "int",
			archived_at: "ts",
		},
		hasUpdatedAt: true,
		// Přejmenování/barvu smí editor; převod vlastnictví, viditelnost a archivaci jen manager.
		managerCols: [
			"owner_id",
			"visibility",
			"status",
			"milestones_enabled",
			"urgent_acceptance_enabled",
			"urgent_acceptance_priority",
			"archived_at",
		],
		projectVia: { kind: "self" },
	},
	statuses: {
		columns: {
			project_id: "text",
			name: "text",
			color: "text",
			position: "int",
			is_done: "bool",
		},
		hasUpdatedAt: false,
		projectVia: { kind: "column", col: "project_id" },
	},
	assignments: {
		columns: {
			task_id: "text",
			project_id: "text",
			user_id: "text",
			completed_at: "ts",
		},
		hasUpdatedAt: false,
		projectVia: { kind: "task", col: "task_id" },
		memberCols: ["user_id"],
		meetingHubGuard: true,
	},
	comments: {
		columns: { task_id: "text", project_id: "text", parent_id: "text", body: "text" },
		maxLengths: { body: 10_000 },
		hasUpdatedAt: true,
		creatorCol: "author_id",
		minRole: "commenter",
		authorEditOnly: true,
		projectVia: { kind: "task", col: "task_id" },
		refProjectCols: [{ col: "parent_id", table: "comments" }],
	},
	comment_decisions: {
		columns: {
			comment_id: "text",
			task_id: "text",
			project_id: "text",
		},
		hasUpdatedAt: false,
		creatorCol: "marked_by",
		createOnly: true,
		minRole: "editor",
		projectVia: { kind: "task", col: "task_id" },
		refProjectCols: [{ col: "comment_id", table: "comments" }],
	},
	mentions: {
		columns: {
			comment_id: "text",
			task_id: "text",
			project_id: "text",
			user_id: "text",
		},
		hasUpdatedAt: false,
		creatorCol: "created_by",
		createOnly: true,
		authorEditOnly: true,
		minRole: "commenter",
		projectVia: { kind: "task", col: "task_id" },
		refProjectCols: [{ col: "comment_id", table: "comments" }],
		memberCols: ["user_id"],
	},
	comment_reactions: {
		columns: {
			comment_id: "text",
			task_id: "text",
			project_id: "text",
			user_id: "text",
			emoji: "text",
		},
		hasUpdatedAt: false,
		creatorCol: "user_id",
		ownerCol: "user_id",
		createOnly: true,
		authorEditOnly: true,
		minRole: "commenter",
		projectVia: { kind: "task", col: "task_id" },
		refProjectCols: [{ col: "comment_id", table: "comments" }],
	},
	task_occurrence_overrides: {
		columns: {
			task_id: "text",
			project_id: "text",
			occ_date: "text",
			done: "bool",
			skipped: "bool",
		},
		// Plánovací override sloupce mění výhradně atomický recurrence command.
		// Offline sync dál bezpečně zapisuje jen done/skipped a obnovuje updated_at.
		hasUpdatedAt: true,
		projectVia: { kind: "task", col: "task_id" },
	},
	// R6 — per-uživatelská barva úkolu (overlay nad tasks; syncuje se jen vlastní barva).
	task_user_colors: {
		columns: {
			task_id: "text",
			project_id: "text",
			user_id: "text",
			color: "text",
		},
		hasUpdatedAt: true,
		minRole: "commenter",
		ownerCol: "user_id", // barvu smí každý nastavit jen SOBĚ
		projectVia: { kind: "task", col: "task_id" },
	},
	reminders: {
		columns: {
			task_id: "text",
			project_id: "text",
			user_id: "text",
			type: "text",
			remind_at: "ts",
			offset_min: "int",
			channel: "text",
		},
		hasUpdatedAt: false,
		minRole: "commenter",
		ownerCol: "user_id", // připomínka je osobní → nelze injektovat push cizímu uživateli
		projectVia: { kind: "task", col: "task_id" },
	},
	// Historie úprav úkolu (audit log). Neměnný append-only záznam; autora dosadí server.
	task_activity: {
		columns: {
			task_id: "text",
			project_id: "text",
			user_id: "text",
			field: "text",
			old_value: "text",
			new_value: "text",
		},
		hasUpdatedAt: false,
		appendOnly: true, // audit log nelze měnit ani mazat
		ownerCol: "user_id", // „kdo změnil" = session uživatel, nepadělatelné
		projectVia: { kind: "task", col: "task_id" },
	},
	// Postupy (štafeta). Pozn.: server-authored advance (překlopení step_state) přijde s #27;
	// zde je generický zápis pro založení/úpravu řetězce členem projektu.
	chains: {
		columns: {
			project_id: "text",
			workspace_id: "text",
			template_id: "text",
			name: "text",
			description: "text",
			anchor_date: "ts",
			state: "text",
			sched_mode: "text",
			skip_weekend: "int",
			completed_at: "ts",
		},
		hasUpdatedAt: true,
		creatorCol: "created_by",
		projectVia: { kind: "column", col: "project_id" },
	},
	chain_steps: {
		columns: {
			chain_id: "text",
			task_id: "text",
			project_id: "text",
			position: "int",
			gate: "text",
			step_state: "text",
			// Plánovací offsety (Kotva/Řetězec) — builder je zapisuje, musí projít do Postgresu.
			anchor_offset: "int",
			gap_days: "int",
			activated_at: "ts",
		},
		hasUpdatedAt: false,
		projectVia: { kind: "column", col: "project_id" },
		refProjectCols: [{ col: "task_id", table: "tasks" }],
	},
	// Cíle — workspace-scoped (membership přes memberships, ne project_members).
	goals: {
		columns: {
			workspace_id: "text",
			name: "text",
			scope: "text",
			metric: "text",
			target: "int",
			due_date: "ts",
			period: "text",
			periodic: "text",
			period_start: "ts",
			filter_person_id: "text",
			filter_keyword: "text",
			owner_id: "text",
		},
		hasUpdatedAt: true,
		creatorCol: "created_by",
		workspaceVia: { kind: "column", col: "workspace_id" },
	},
	goal_projects: {
		columns: { goal_id: "text", project_id: "text", workspace_id: "text" },
		hasUpdatedAt: false,
		workspaceVia: { kind: "column", col: "workspace_id" },
		refWorkspaceCols: [
			{ col: "goal_id", table: "goals" },
			{ col: "project_id", table: "projects" },
		],
	},
	goal_milestones: {
		columns: {
			goal_id: "text",
			workspace_id: "text",
			label: "text",
			done: "bool",
			position: "int",
		},
		hasUpdatedAt: false,
		workspaceVia: { kind: "column", col: "workspace_id" },
		refWorkspaceCols: [{ col: "goal_id", table: "goals" }],
	},
	// Seznamy — checklisty na akce (handoff 2026-07-10): instance + sekce + položky + šablony.
	contacts: {
		columns: {
			workspace_id: "text",
			name: "text",
			email: "text",
			org: "text",
			role: "text",
			areas: "text",
			note: "text",
		},
		hasUpdatedAt: true,
		creatorCol: "created_by",
		authorEditOnly: true,
		workspaceVia: { kind: "column", col: "workspace_id" },
	},
	// Meets — porada (sidecar kotevního úkolu). Klient smí ZALOŽIT metadata (title/status +
	// soft odkazy hub/series/prev); `transcript`/`extraction` přes write-path NEjdou
	// (CC-P0-13: obsah jen účastníkům — řeší server /api/meetings). createOnly = PUT na cizí
	// existující id nic nepřepíše; authorEditOnly = PATCH/DELETE jen autor nebo admin prostoru
	// (audit Fáze 1: jinak mohl kdokoli z prostoru smazat poradu VČETNĚ serverového přepisu).
	meetings: {
		patchOnly: true,
		columns: {
			workspace_id: "text",
			title: "text",
			status: "text",
			hub_task_id: "text",
			series_id: "text",
			prev_meeting_id: "text",
		},
		hasUpdatedAt: true,
		creatorCol: "created_by",
		createOnly: true,
		authorEditOnly: true,
		workspaceVia: { kind: "column", col: "workspace_id" },
	},
	lists: {
		columns: {
			workspace_id: "text",
			project_id: "text",
			template_id: "text",
			name: "text",
			event: "text",
			archived: "bool",
		},
		hasUpdatedAt: true,
		creatorCol: "created_by",
		authorEditOnly: true,
		workspaceVia: { kind: "column", col: "workspace_id" },
		refWorkspaceCols: [
			{ col: "project_id", table: "projects" },
			{ col: "template_id", table: "list_templates" },
		],
	},
	list_sections: {
		columns: {
			list_id: "text",
			workspace_id: "text",
			name: "text",
			position: "int",
		},
		hasUpdatedAt: false,
		workspaceVia: { kind: "column", col: "workspace_id" },
		refWorkspaceCols: [{ col: "list_id", table: "lists" }],
	},
	list_items: {
		columns: {
			list_id: "text",
			section_id: "text",
			workspace_id: "text",
			text: "text",
			qty: "text",
			who_id: "text",
			done: "bool",
			position: "int",
		},
		hasUpdatedAt: false,
		workspaceVia: { kind: "column", col: "workspace_id" },
		refWorkspaceCols: [
			{ col: "list_id", table: "lists" },
			{ col: "section_id", table: "list_sections" },
		],
		memberWorkspaceCols: ["who_id"],
	},
	list_templates: {
		columns: {
			workspace_id: "text",
			name: "text",
			description: "text",
			sections: "text",
		},
		hasUpdatedAt: true,
		creatorCol: "created_by",
		workspaceVia: { kind: "column", col: "workspace_id" },
	},
	// entity_links ZÁMĚRNĚ NEJSOU v klientském write-path (audit Fáze 1): zapisuje je jen
	// server (LuckyOS broker, Meets commit) — klientský zápis by dovolil podvrhnout
	// source_system/external_id dedup klíče a relation bez validace. Klient je jen ČTE (sync).
};

type Op = "PUT" | "PATCH" | "DELETE";
type Db = ReturnType<typeof getDb>;
// biome-ignore lint: drizzle execute vrací driver-specific řádky
type Rows = any;

class SyncWriteConflict extends Error {
	constructor(
		readonly clientCode:
			| "create_conflict"
			| "idempotency_key_reused"
			| "stale_write"
			| "row_missing",
	) {
		super(clientCode);
	}
}

/** JSON se stabilním pořadím klíčů pro kontrolní součet idempotentní operace. */
function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.filter((key) => record[key] !== undefined)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
		.join(",")}}`;
}

function writePayloadHash(value: unknown): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

const syncWriteSchema = z
	.object({
		op: z.enum(["PUT", "PATCH", "DELETE"]),
		table: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[a-z_]+$/),
		id: z.string().uuid(),
		data: z.record(z.unknown()).optional(),
		previous: z.record(z.unknown()).optional(),
		clientId: z.string().min(1).max(128),
		operationId: z.union([z.string().min(1).max(32), z.number().int().nonnegative()]),
	})
	.strict();

/**
 * Deterministická chyba dat/omezení Postgresu (class 22 = data exception, 23 = integrity
 * constraint) → 400, ať klient op zahodí a NEblokuje upload frontu (500 = PowerSync retry forever).
 * POZOR: SQLSTATE není jen 5 číslic — např. `22P02` (invalid_text_representation, neplatné UUID/enum)
 * má písmeno. Dřívější `^(22|23)\d{3}$` ho minul → vracelo 500 → zaseklá fronta a ztráta offline dat.
 */
/**
 * CC-P0-16 — bezpečná chybová odpověď: klient NIKDY nedostane driver/SQL text,
 * stack ani názvy constraintů. SQLSTATE kód (např. 23502) je bezpečný a budoucí
 * Centrum sync problémů podle něj rozliší důvod odmítnutí.
 */
function safeWriteError(err: unknown): { error: string; code: string | null } {
	if (err instanceof SyncWriteConflict) {
		return { error: "write_conflict", code: err.clientCode };
	}
	if (sqlstateOf(err) === "23505") {
		return { error: "write_conflict", code: "create_conflict" };
	}
	return { error: "write_failed", code: sqlstateOf(err) };
}

/**
 * SQLSTATE z chyby NEBO z jejího `cause` řetězu — drizzle-orm od 0.45 balí driver
 * chyby do DrizzleQueryError a kód je až v `cause.code`. Bez průchodu řetězem by
 * constraint chyby padaly jako 500 → PowerSync by je retryoval donekonečna.
 */
export function sqlstateOf(err: unknown): string | null {
	let e = err as { code?: unknown; cause?: unknown } | null | undefined;
	for (let depth = 0; depth < 4 && e; depth++) {
		if (typeof e.code === "string" && /^[0-9A-Za-z]{5}$/.test(e.code)) return e.code;
		e = e.cause as typeof e;
	}
	return null;
}

function isDeterministicDbError(err: unknown): boolean {
	const code = sqlstateOf(err);
	return code != null && /^(22|23)[0-9A-Za-z]{3}$/.test(code);
}

function writeErrorStatus(err: unknown): 409 | 422 | 500 {
	if (err instanceof SyncWriteConflict || sqlstateOf(err) === "23505") return 409;
	return isDeterministicDbError(err) ? 422 : 500;
}

/** Strukturovaný log bez SQL, parametrů, message a stacku. */
function writeErrorLog(err: unknown, requestId: string | null): void {
	const code = err instanceof SyncWriteConflict ? err.clientCode : sqlstateOf(err);
	console.error(
		JSON.stringify({
			level: "error",
			event: "sync_write_failed",
			requestId,
			name: err instanceof Error ? err.name : "UnknownError",
			code,
		}),
	);
}

function coerce(type: ColType, v: unknown): unknown {
	if (v == null) return null;
	if (type === "int") return typeof v === "number" ? v : Number(v);
	if (type === "bool") return v === true || v === 1 || v === "1" || v === "true";
	if (type === "json") return typeof v === "string" ? v : JSON.stringify(v);
	return String(v); // text + ts (ISO string → timestamptz cast Postgresem)
}

/** Sjednotí SQLite snapshot a Postgres hodnotu pro optimistický compare-and-swap. */
function comparable(type: ColType, value: unknown, serializedJson = false): unknown {
	if (value == null) return null;
	if (type === "bool") return value === true || value === 1 || value === "1" || value === "true";
	if (type === "int") return Number(value);
	if (type === "ts") {
		const date = value instanceof Date ? value : new Date(String(value));
		return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
	}
	if (type === "json") {
		if (!serializedJson || typeof value !== "string") return canonicalJson(value);
		try {
			return canonicalJson(JSON.parse(value));
		} catch {
			return canonicalJson(value);
		}
	}
	return String(value);
}

async function projectViaTask(db: Db, taskId: string | null): Promise<string | null> {
	if (!taskId) return null;
	const rows = (await db.execute(
		sql`SELECT project_id AS pid FROM tasks WHERE id = ${taskId} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.pid as string) ?? null;
}

/** Cílový projekt řádku z PŘÍCHOZÍCH DAT (kam se řádek umístí). */
async function projectFromData(
	db: Db,
	def: TableDef,
	data: Record<string, unknown>,
	id: string,
): Promise<string | null> {
	const via = def.projectVia;
	if (!via) return null;
	if (via.kind === "self") return id;
	const v = (data[via.col] as string) ?? null;
	return via.kind === "column" ? v : projectViaTask(db, v);
}

/** Současný projekt EXISTUJÍCÍHO řádku z DB. */
async function projectFromDb(
	db: Db,
	table: string,
	def: TableDef,
	id: string,
): Promise<string | null> {
	const via = def.projectVia;
	if (!via) return null;
	if (via.kind === "self") {
		const rows = (await db.execute(
			sql`SELECT id AS v FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
		)) as Rows;
		return (rows[0]?.v as string) ?? null;
	}
	const rows = (await db.execute(
		sql`SELECT ${sql.raw(via.col)} AS v FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
	)) as Rows;
	const v = (rows[0]?.v as string) ?? null;
	return via.kind === "column" ? v : projectViaTask(db, v);
}

/** Projekt řádku libovolné tabulky se sloupcem project_id (tasks/sections/statuses). */
async function projectOfRow(db: Db, table: string, id: string): Promise<string | null> {
	const rows = (await db.execute(
		sql`SELECT project_id AS pid FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.pid as string) ?? null;
}

async function isProjectMember(db: Db, projectId: string, userId: string): Promise<boolean> {
	const rows = (await db.execute(
		sql`SELECT 1 AS ok FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId} LIMIT 1`,
	)) as Rows;
	return rows.length > 0;
}

/** Projektová role uživatele (project_members) — null = není člen projektu. */
async function projectRole(db: Db, projectId: string, userId: string): Promise<string | null> {
	const rows = (await db.execute(
		sql`SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.role as string) ?? null;
}

/** Hodnota creatorCol existujícího řádku (autor komentáře apod.) — pro authorEditOnly. */
async function creatorOfRow(
	db: Db,
	table: string,
	col: string,
	id: string,
): Promise<string | null> {
	const rows = (await db.execute(
		sql`SELECT ${sql.raw(col)} AS v FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.v as string) ?? null;
}

/** Role uživatele v prostoru (memberships) — null = není člen. */
async function workspaceRole(db: Db, workspaceId: string, userId: string): Promise<string | null> {
	const rows = (await db.execute(
		sql`SELECT CASE WHEN w.owner_id = ${userId} THEN 'owner'::text ELSE m.role::text END AS role
		    FROM workspaces w
		    LEFT JOIN memberships m ON m.workspace_id = w.id AND m.user_id = ${userId}
		    WHERE w.id = ${workspaceId}
		      AND (w.owner_id = ${userId} OR m.user_id IS NOT NULL)
		    LIMIT 1`,
	)) as Rows;
	return (rows[0]?.role as string) ?? null;
}

/** Workspace_id existujícího řádku workspace-scoped tabulky (dle workspaceVia sloupce). */
async function workspaceFromDb(
	db: Db,
	table: string,
	def: TableDef,
	id: string,
): Promise<string | null> {
	if (!def.workspaceVia) return null;
	const rows = (await db.execute(
		sql`SELECT ${sql.raw(def.workspaceVia.col)} AS v FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.v as string) ?? null;
}

/**
 * Workspace_id libovolného řádku tabulky se sloupcem `workspace_id` (pro validaci
 * cross-tenant FK referencí — audit S7). `table` je z pevného registru, ne z uživatele.
 * Vrací null, pokud řádek zatím neexistuje (offline: reference se ještě nenahrála) —
 * v tom případě se kontrola přeskočí (stejně shovívavě jako refProjectCols).
 */
/**
 * §15/3 — o účastnících porady (a tím o přístupu k přepisu) rozhoduje jen účastník
 * nebo zakladatel. Vrací poradu, jejímž kotevním úkolem `taskId` je (nebo null).
 */
async function meetingOfHubTask(
	db: Db,
	taskId: string,
): Promise<{ id: string; created_by: string | null } | null> {
	const rows = (await db.execute(
		sql`SELECT id, created_by FROM meetings WHERE hub_task_id = ${taskId} LIMIT 1`,
	)) as Rows;
	return (rows[0] as { id: string; created_by: string | null } | undefined) ?? null;
}

/** Je `userId` mezi účastníky porady (assignments kotevního úkolu)? */
async function isHubParticipant(db: Db, hubTaskId: string, userId: string): Promise<boolean> {
	const rows = (await db.execute(
		sql`SELECT 1 AS v FROM assignments WHERE task_id = ${hubTaskId} AND user_id = ${userId} LIMIT 1`,
	)) as Rows;
	return rows.length > 0;
}

/** task_id assignmentu podle jeho id (DELETE/PATCH nenesou data). */
async function taskOfAssignment(db: Db, id: string): Promise<string | null> {
	const rows = (await db.execute(
		sql`SELECT task_id AS v FROM assignments WHERE id = ${id} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.v as string) ?? null;
}

async function workspaceOfRow(db: Db, table: string, id: string): Promise<string | null> {
	const rows = (await db.execute(
		sql`SELECT workspace_id AS v FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.v as string) ?? null;
}

/**
 * R-oprávnění (#14): „Host" (workspace_role = guest) je jen pro čtení. True, pokud je uživatel
 * v prostoru daného projektu členem s rolí guest → jakýkoli zápis se odmítne.
 */
async function isWorkspaceGuest(db: Db, projectId: string, userId: string): Promise<boolean> {
	const rows = (await db.execute(
		sql`SELECT m.role AS role FROM projects p
        JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_id = ${userId}
        WHERE p.id = ${projectId} LIMIT 1`,
	)) as Rows;
	return (rows[0]?.role as string) === "guest";
}

/** Generický zápis dle registru (INSERT … ON CONFLICT / UPDATE / DELETE). */
async function applyWrite(
	db: Db | DbTx,
	table: string,
	def: TableDef,
	op: Op,
	id: string,
	data: Record<string, unknown>,
	userId: string,
): Promise<void> {
	if (op === "DELETE") {
		await db.execute(sql`DELETE FROM ${sql.raw(table)} WHERE id = ${id}`);
		return;
	}

	const set: { col: string; val: unknown; type: ColType }[] = Object.keys(def.columns)
		// U CREATE autoritu identity drží server. Klientský lokální řádek může
		// `created_by` obsahovat kvůli optimistickému UI, nesmí ale vytvořit druhý
		// stejnojmenný INSERT sloupec ani podvrhnout jiného autora.
		.filter((c) => c in data && !(op === "PUT" && c === def.creatorCol))
		.flatMap((c) => {
			const type = def.columns[c];
			return type ? [{ col: c, val: coerce(type, data[c]), type }] : [];
		});
	if (op === "PUT" && def.creatorCol)
		set.push({ col: def.creatorCol, val: userId, type: "text" });

	if (op === "PUT") {
		const cols = ["id", ...set.map((s) => s.col)];
		const vals = [
			sql`${id}`,
			...set.map((s) => (s.type === "json" ? sql`${s.val}::jsonb` : sql`${s.val}`)),
		];
		// PowerSync PUT je CREATE, nikoli upsert. Nová operace se stejným business id
		// skončí 409; legitimní retry pozná auditedWrite podle idempotency receipt.
		await db.execute(sql`
      INSERT INTO ${sql.raw(table)} (${sql.join(
				cols.map((c) => sql.raw(c)),
				sql`, `,
			)})
      VALUES (${sql.join(vals, sql`, `)})
    `);
		return;
	}

	// PATCH — jen sloupce přítomné v datech
	const updates = set.map((s) =>
		s.type === "json"
			? sql`${sql.raw(s.col)} = ${s.val}::jsonb`
			: sql`${sql.raw(s.col)} = ${s.val}`,
	);
	if (def.hasUpdatedAt) updates.push(sql`updated_at = now()`);
	if (updates.length === 0) return;
	await db.execute(
		sql`UPDATE ${sql.raw(table)} SET ${sql.join(updates, sql`, `)} WHERE id = ${id}`,
	);
}

/** Transakční kontext (drizzle) — applyWrite/audit běží nad db i tx. */
type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * CC-P0-10 — mutace + audit v JEDNÉ transakci: selhání audit insertu vrátí
 * i hlavní zápis (audit je záruka, ne best-effort log). Zapisuje se:
 * workspace odvozený SERVEREM (ne z klientských dat), actor, before snapshot
 * pro PATCH/DELETE (jinak není delete vysvětlitelný ani obnovitelný), diff
 * a request ID pro korelaci s API logem i klientským Centrem problémů.
 */
async function auditedWrite(
	db: Db,
	table: string,
	def: TableDef,
	op: Op,
	id: string,
	data: Record<string, unknown>,
	userId: string,
	ctx: {
		workspaceId: string | null;
		requestId: string | null;
		clientId: string;
		operationId: string;
		payloadHash: string;
		previous: Record<string, unknown> | null;
	},
): Promise<"applied" | "replayed"> {
	return db.transaction(async (tx) => {
		// Receipt je v téže transakci jako business zápis i audit. Concurrent retry
		// se po commitu první operace změní na replay; při rollbacku nezůstane falešný receipt.
		const inserted = (await tx.execute(sql`
			INSERT INTO sync_write_receipts
				(id, user_id, client_id, operation_id, payload_hash, created_at)
			VALUES
				(${crypto.randomUUID()}, ${userId}, ${ctx.clientId}, ${ctx.operationId}, ${ctx.payloadHash}, now())
			ON CONFLICT (user_id, client_id, operation_id) DO NOTHING
			RETURNING payload_hash
		`)) as Rows;
		if (inserted.length === 0) {
			const existing = (await tx.execute(sql`
				SELECT payload_hash
				FROM sync_write_receipts
				WHERE user_id = ${userId}
				  AND client_id = ${ctx.clientId}
				  AND operation_id = ${ctx.operationId}
				LIMIT 1
			`)) as Rows;
			if (existing[0]?.payload_hash !== ctx.payloadHash) {
				throw new SyncWriteConflict("idempotency_key_reused");
			}
			return "replayed" as const;
		}

		const before =
			op === "PUT"
				? null
				: ((
						(await tx.execute(
							sql`SELECT * FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
						)) as Rows
					)[0] ?? null);
		if (op !== "PUT") {
			if (!before) throw new SyncWriteConflict("row_missing");
			for (const [columnName, type] of Object.entries(def.columns)) {
				const expected = ctx.previous?.[columnName];
				if (!Object.is(comparable(type, before[columnName]), comparable(type, expected, true))) {
					throw new SyncWriteConflict("stale_write");
				}
			}
		}
		await applyWrite(tx, table, def, op, id, data, userId);
		// task_activity JE už audit (per-úkol historie) — neaudituj audit, jen šum.
		if (table === "task_activity") return "applied" as const;
		const action = op === "PUT" ? "put" : op === "PATCH" ? "patch" : "delete";
		let auditData: Record<string, unknown> = data;
		let auditBefore: Record<string, unknown> | null = before;
		if (table === "task_custom_field_values") {
			const fieldId = String(data.field_id ?? before?.field_id ?? "");
			const fieldRows = (await tx.execute(sql`
				SELECT name, field_type FROM project_custom_fields WHERE id = ${fieldId} LIMIT 1
			`)) as Rows;
			const field = fieldRows[0];
			auditData = {
				...data,
				field_name: field?.name ?? null,
				field_type: field?.field_type ?? null,
			};
			if (before)
				auditBefore = {
					...before,
					field_name: field?.name ?? null,
					field_type: field?.field_type ?? null,
				};
		}
		const diff = op === "DELETE" ? null : sql`${JSON.stringify(auditData)}::jsonb`;
		const beforeJson = auditBefore ? sql`${JSON.stringify(auditBefore)}::jsonb` : null;
		await tx.execute(sql`
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_user_id, entity, entity_id, action, diff, before, request_id, created_at)
      VALUES (${crypto.randomUUID()}, ${ctx.workspaceId}, 'user', ${userId}, ${table}, ${id}, ${action}, ${diff}, ${beforeJson}, ${ctx.requestId}, now())
    `);
		return "applied" as const;
	});
}

/**
 * Upload write z klienta. Tělo: { op: 'PUT'|'PATCH'|'DELETE', table, id, data }.
 * Row-level kontrola (R5): uživatel musí být členem projektu, kam řádek patří.
 */
powersyncRoutes.post("/api/sync/write", async (c) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) return c.json({ error: "unauthorized" }, 401);
	const userId = session.user.id;

	const parsed = syncWriteSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "invalid_write_envelope" }, 422);
	const body = {
		...parsed.data,
		operationId: String(parsed.data.operationId),
	};

	const def = TABLES[body.table];
	if (!def) return c.json({ error: `tabulka '${body.table}' není zapisovatelná` }, 400);

	const data = { ...(body.data ?? {}) };
	const previous = body.previous ?? null;
	for (const [columnName, maxLength] of Object.entries(def.maxLengths ?? {})) {
		const value = data[columnName];
		if (value != null && String(value).length > maxLength) {
			return c.json({ error: "field_too_long", field: columnName, maxLength }, 422);
		}
	}
	// E-mailový reminder lze přijmout jen při nakonfigurovaném a osobně povoleném
	// provideru. Offline zápis tak neskončí ve falešně doručitelném stavu.
	if (body.table === "reminders" && data.channel === "email") {
		const availability = await reminderEmailAvailability(userId);
		if (!availability.enabled) return c.json({ error: availability.reason }, 422);
	}
	if (body.table === "tasks" && data.start_timezone != null) {
		try {
			new Intl.DateTimeFormat("en-GB", { timeZone: String(data.start_timezone) }).format(0);
		} catch {
			return c.json({ error: "invalid_start_timezone" }, 422);
		}
	}
	if (body.op !== "PUT") {
		const missing = Object.keys(def.columns).filter(
			(columnName) => !previous || !Object.hasOwn(previous, columnName),
		);
		if (missing.length > 0) {
			return c.json({ error: "missing_write_precondition" }, 422);
		}
	}
	const payloadHash = writePayloadHash({
		op: body.op,
		table: body.table,
		id: body.id,
		data,
		previous,
	});
	const db = getDb();

	// Append-only tabulky (audit log): měnit ani mazat nelze.
	if (def.appendOnly && body.op !== "PUT") return c.json({ error: "append-only" }, 403);
	if (def.patchOnly && body.op === "PUT") return c.json({ error: "create_via_api_only" }, 400);

	// Vlastníkův sloupec (osobní připomínky/barvy/audit) — server VŽDY dosadí session userId.
	// Klient nemůže padělat cizí identitu ani injektovat řádek do overlaye/pushe jiného uživatele.
	if (def.ownerCol && (body.op === "PUT" || body.op === "PATCH")) data[def.ownerCol] = userId;

	// Workspace-scoped tabulky (cíle): membership + role kontrola přes memberships.
	if (def.workspaceVia) {
		const minimumRole = WORKSPACE_WRITE_POLICY[body.table]?.[body.op];
		if (!minimumRole) return c.json({ error: "workspace_action_not_allowed" }, 403);
		const wsNeed = new Set<string>();
		let rowWs: string | null = null;
		if (body.op === "PUT" || body.op === "PATCH") {
			const w = (data[def.workspaceVia.col] as string) ?? null;
			if (w) {
				wsNeed.add(w);
				rowWs = w;
			}
		}
		const cur = await workspaceFromDb(db, body.table, def, body.id);
		if (cur) {
			wsNeed.add(cur);
			if (!rowWs) rowWs = cur;
		}
		if (!(body.op === "DELETE" && wsNeed.size === 0)) {
			if (wsNeed.size === 0) return c.json({ error: "forbidden" }, 403);
			for (const w of wsNeed) {
				const role = await workspaceRole(db, w, userId);
				if (!role) return c.json({ error: "forbidden" }, 403);
				if (role === "guest") return c.json({ error: "read-only-host" }, 403);
				if (
					(WORKSPACE_ROLE_RANK[role as WorkspaceRole] ?? -1) <
					WORKSPACE_ROLE_RANK[minimumRole]
				) {
					return c.json({ error: "insufficient-workspace-role" }, 403);
				}
			}
		}
		try {
			// Audit S7 — cross-tenant integrita workspace-scoped FK referencí: list_id/section_id/
			// project_id/template_id MUSÍ patřit do stejného workspace jako řádek. Bez toho by šlo
			// zapsat položku s workspace_id vlastního prostoru, ale list_id/who_id mířícím jinam.
			if ((body.op === "PUT" || body.op === "PATCH") && rowWs) {
				for (const ref of def.refWorkspaceCols ?? []) {
					const refId = data[ref.col] as string | undefined;
					if (!refId) continue;
					const refWs = await workspaceOfRow(db, ref.table, refId);
					if (!refWs) return c.json({ error: "reference_not_found", field: ref.col }, 422);
					if (refWs !== rowWs) return c.json({ error: "cross-workspace-reference" }, 403);
				}
				// who_id apod. musí být člen workspace řádku (ne cizí/neexistující uživatel).
				for (const col of def.memberWorkspaceCols ?? []) {
					const uid = data[col] as string | undefined;
					if (!uid) continue;
					if (!(await workspaceRole(db, rowWs, uid)))
						return c.json({ error: "assignee not a workspace member" }, 403);
				}
			}
			// PATCH/DELETE author-scoped workspace řádku (porady) smí jen autor, nebo
			// admin/manager prostoru — dřív tu check chyběl (byl jen v projektové větvi)
			// a kdokoli z prostoru mohl smazat cizí poradu vč. serverového přepisu.
			if (def.authorEditOnly && def.creatorCol && (body.op === "PATCH" || body.op === "DELETE")) {
				const author = await creatorOfRow(db, body.table, def.creatorCol, body.id);
				if (author && author !== userId) {
					let ok = false;
					for (const w of wsNeed) {
						const role = await workspaceRole(db, w, userId);
						if (role === "admin" || role === "manager" || role === "owner") ok = true;
					}
					if (!ok) return c.json({ error: "author-only" }, 403);
				}
			}
			await auditedWrite(db, body.table, def, body.op, body.id, data, userId, {
				workspaceId: rowWs,
				requestId: c.get("requestId") ?? null,
				clientId: body.clientId,
				operationId: body.operationId,
				payloadHash,
				previous,
			});
		} catch (err) {
			writeErrorLog(err, c.get("requestId") ?? null);
			return c.json(
				{ ...safeWriteError(err), requestId: c.get("requestId") ?? null },
				writeErrorStatus(err),
			);
		}
		return c.json({ ok: true });
	}

	// Autorizace i zápis v JEDNOM try/catch — i chyba membership dotazu (např. neplatné UUID
	// v project_id → 22P02) tak skončí jako 400, ne jako 500 zaseklé donekonečna.
	try {
		// R5 — uživatel musí být členem KAŽDÉHO projektu, kterého se řádek dotkne:
		// cílový (z dat), současný (z DB — i u PUT kvůli upsert ON CONFLICT) a projekty FK referencí.
		const need = new Set<string>();
		// Projekt samotného řádku (nikoli projekt FK reference) určuje tenant pro audit
		// a cross-tenant reference.
		let rowProject: string | null = null;
		if (body.op === "PUT" || body.op === "PATCH") {
			const t = await projectFromData(db, def, data, body.id);
			if (t) {
				need.add(t);
				rowProject = t;
			}
			// Anti-spoof: denormalizovaný project_id (řídí sync bucket) MUSÍ odpovídat projektu
			// odvozenému z task_id — jinak by šel řádek podstrčit do cizího bucketu (#3).
			if (t && def.projectVia?.kind === "task") data.project_id = t;
		}
		if (body.op === "PUT" || body.op === "PATCH" || body.op === "DELETE") {
			const cur = await projectFromDb(db, body.table, def, body.id);
			if (cur) {
				need.add(cur);
				rowProject ??= cur;
			}
		}
		// FK reference (parent_id/section_id/status_id) musí ukazovat do projektu, kde je útočník člen.
		for (const ref of def.refProjectCols ?? []) {
			const refId = data[ref.col] as string | undefined;
			if (refId) {
				const p = await projectOfRow(db, ref.table, refId);
				if (!p) return c.json({ error: "reference_not_found", field: ref.col }, 422);
				// Být členem obou projektů nestačí: parent/section/status/task/comment
				// musí patřit přímo do projektu zapisovaného řádku.
				if (rowProject && p !== rowProject)
					return c.json({ error: "cross-project-reference", field: ref.col }, 403);
				need.add(p);
			}
		}
		// DELETE neexistujícího řádku = no-op (idempotentní upload).
		if (!(body.op === "DELETE" && need.size === 0)) {
			if (need.size === 0) return c.json({ error: "forbidden" }, 403);
			const minRank = PROJECT_ROLE_RANK[def.minRole ?? "editor"] ?? 2;
			for (const p of need) {
				const role = await projectRole(db, p, userId);
				if (!role) return c.json({ error: "forbidden" }, 403);
				// Host (workspace guest) = read-only → odmítni jakýkoli zápis.
				if (await isWorkspaceGuest(db, p, userId)) return c.json({ error: "read-only-host" }, 403);
				// Projektová role musí stačit na daný typ zápisu (#1: commenter ≠ editor ≠ manager).
				if ((PROJECT_ROLE_RANK[role] ?? 0) < minRank)
					return c.json({ error: "insufficient-role" }, 403);
				// Destruktivní operace na projektu (smazání, převod vlastnictví, viditelnost,
				// archivace) smí jen manager — commenter/editor je nesmí (#1).
				const touchesManagerCol =
					body.op === "PATCH" && (def.managerCols ?? []).some((mc) => mc in data);
				if ((body.op === "DELETE" && def.projectVia?.kind === "self") || touchesManagerCol) {
					if (role !== "manager") return c.json({ error: "manager-only" }, 403);
				}
			}
		}
		// PATCH/DELETE komentáře smí jen autor (nebo manager projektu) — #10.
		if (def.authorEditOnly && def.creatorCol && (body.op === "PATCH" || body.op === "DELETE")) {
			const author = await creatorOfRow(db, body.table, def.creatorCol, body.id);
			if (author && author !== userId) {
				let ok = false;
				for (const p of need) {
					if ((await projectRole(db, p, userId)) === "manager") ok = true;
				}
				if (!ok) return c.json({ error: "author-only" }, 403);
			}
		}
		// §15/3 / audit CC-P0-13/F1 — účastníky porady mění jen účastník nebo zakladatel.
		// Bez toho by si editor projektu přidal assignment na kotevní úkol a odemkl si tím
		// doslovný přepis (a stejně tak by mohl účastníky svévolně odebírat).
		if (def.meetingHubGuard) {
			const taskId = (data.task_id as string | undefined) ?? (await taskOfAssignment(db, body.id));
			const meet = taskId ? await meetingOfHubTask(db, taskId) : null;
			if (meet && taskId) {
				const allowed = meet.created_by === userId || (await isHubParticipant(db, taskId, userId));
				if (!allowed) return c.json({ error: "not-a-participant" }, 403);
			}
		}
		// member sloupce (assignments.user_id) musí být člen projektu řádku.
		for (const col of def.memberCols ?? []) {
			const uid = data[col] as string | undefined;
			if (!uid) continue;
			for (const p of need) {
				if (!(await isProjectMember(db, p, uid))) {
					return c.json({ error: "assignee not a project member" }, 403);
				}
			}
		}

		const auditWs = rowProject
			? await workspaceOfRow(db, "projects", rowProject)
			: need.size > 0
				? await workspaceOfRow(db, "projects", [...need][0] as string)
				: null;
		// CC-P0-15: meeting_id úkolu nesmí ukazovat do jiného workspace.
		if ((body.op === "PUT" || body.op === "PATCH") && auditWs) {
			for (const ref of def.refTenantCols ?? []) {
				const refId = data[ref.col] as string | undefined;
				if (!refId) continue;
				const refWs = await workspaceOfRow(db, ref.table, refId);
				if (!refWs) return c.json({ error: "reference_not_found", field: ref.col }, 422);
				if (refWs !== auditWs) return c.json({ error: "cross-workspace-reference" }, 403);
			}
		}
		if (auditWs) {
			const availability = await preflightAvailabilityForSyncWrite(db, {
				workspaceId: auditWs,
				actorUserId: userId,
				table: body.table,
				op: body.op,
				id: body.id,
				data,
			});
			if (availability && !availability.canSchedule) {
				return c.json({ error: "availability_conflict", availability }, 409);
			}
		}
		await auditedWrite(db, body.table, def, body.op, body.id, data, userId, {
			workspaceId: auditWs,
			requestId: c.get("requestId") ?? null,
			clientId: body.clientId,
			operationId: body.operationId,
			payloadHash,
			previous,
		});
	} catch (err) {
		writeErrorLog(err, c.get("requestId") ?? null);
		return c.json(
			{ ...safeWriteError(err), requestId: c.get("requestId") ?? null },
			writeErrorStatus(err),
		);
	}

	return c.json({ ok: true });
});
