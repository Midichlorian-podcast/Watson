/**
 * Meet board — detail porady na JEDNÉ obrazovce (files/MEETS_board_plan_2026-07-14.md).
 * Nahrazuje overlay se záložkami: hlavička nese termín/účastníky/stav/akce, pod ní
 * PROCESNÍ UKAZATEL (Naplánováno → Proběhla → Zápis → Návrhy AI → Akční body) a dva
 * sloupce — vlevo PRÁCE (Příprava, Akční body vč. AI revize), vpravo OBSAH (Zápis
 * sbalený na pár řádků, mini Řetěz). Layout je stále jeden, jen přesouvá důraz podle
 * stavu porady. Logika je 1:1 port z dřívějšího MeetDetail (dotazy řízené meetings,
 * lineage přes entity_links, carryover = přesun, poctivý commit s retry, CC-P0-01
 * readiness, CC-P0-13: přepis on-demand ze serveru).
 */
import { useQuery as usePsQuery } from "@powersync/react";
import i18n from "@watson/i18n";
import { AvatarGroup } from "@watson/ui";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../lib/api";
import { logTaskActivity } from "../lib/activity";
import { useSession } from "../lib/auth-client";
import { initials, shortDayLabel } from "../lib/format";
import { useAllMembers } from "../lib/overview";
import type { TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useTaskDetail } from "../lib/taskDetail";
import { startMinOf, todayISO, toggleTask } from "../lib/tasks";
import { showToast } from "../lib/toast";

interface Proposal {
	title: string;
	note?: string | null;
	assigneeUserId?: string | null;
	assigneeHint?: string | null;
	priority?: number | null;
	due?: string | null;
	/** Přihrádka extrakce: action = závazek · unclear = k dořešení · decision = rozhodnutí. */
	kind?: "action" | "unclear" | "decision" | null;
	/** Doslovná citace pasáže zápisu — ukotvení návrhu (nic se nedomýšlí). */
	evidence?: string | null;
	/** Revizní stav uložený autosavem (server je jen přenáší, AI je neplní). */
	assigneeUserIds?: string[] | null;
	keep?: boolean | null;
	projectId?: string | null;
}
interface Editable extends Proposal {
	keep: boolean;
	/** Cílový projekt bodu — akční body smí mířit i mimo projekt porady. */
	projectId: string;
	/** Řešitelé — jako všude v aplikaci jich může být víc (assignments). */
	assigneeUserIds: string[];
}
/** Uložený revizní stav → editovatelný řádek (tolerantní ke starým datům). */
const toEditable = (p: Proposal, defaultProject: string): Editable => ({
	...p,
	keep: typeof p.keep === "boolean" ? p.keep : kindOf(p) !== "unclear",
	projectId: p.projectId ?? defaultProject,
	assigneeUserIds: p.assigneeUserIds ?? (p.assigneeUserId ? [p.assigneeUserId] : []),
});
/** Přihrádka s tolerancí ke starým/mock datům bez `kind`. */
const kindOf = (p: Proposal) =>
	p.kind === "unclear" || p.kind === "decision" ? p.kind : ("action" as const);
type MeetingMeta = {
	id: string;
	workspace_id: string | null;
	title: string | null;
	status: string;
	hub_task_id: string | null;
	series_id: string | null;
	prev_meeting_id: string | null;
};

const LABEL: CSSProperties = {
	fontFamily: "var(--w-font-mono)",
	fontSize: 10,
	letterSpacing: ".08em",
	textTransform: "uppercase",
	color: "var(--w-ink-3)",
	fontWeight: 600,
};
const INPUT: CSSProperties = {
	width: "100%",
	fontSize: 13,
	color: "var(--w-ink)",
	background: "var(--w-panel-2)",
	border: "1px solid var(--w-line)",
	borderRadius: 8,
	padding: "7px 10px",
};
const SELECT: CSSProperties = {
	fontSize: 11.5,
	color: "var(--w-ink-2)",
	background: "var(--w-panel-2)",
	border: "1px solid var(--w-line)",
	borderRadius: 7,
	padding: "4px 8px",
	maxWidth: 175,
};
const BTN: CSSProperties = {
	fontFamily: "var(--w-font-display)",
	fontWeight: 600,
	fontSize: 12.5,
	borderRadius: 9,
	padding: "8px 14px",
	cursor: "pointer",
};
const BTN_PRIMARY: CSSProperties = {
	...BTN,
	color: "#fff",
	background: "var(--w-brass)",
	border: "none",
};
const BTN_GHOST: CSSProperties = {
	...BTN,
	color: "var(--w-ink-2)",
	background: "transparent",
	border: "1px solid var(--w-line)",
};
/** Karta sekce boardu; `tone` řídí důraz (hot = brass okraj, dim = ztlumení). */
const secStyle = (tone: "hot" | "dim" | "base"): CSSProperties => ({
	background: "var(--w-card)",
	border: `1px solid ${tone === "hot" ? "var(--w-brass)" : "var(--w-line)"}`,
	borderRadius: 13,
	padding: "13px 15px 14px",
	boxShadow: "var(--w-shadow-sm)",
	opacity: tone === "dim" ? 0.68 : 1,
	transition: "border-color .18s ease, opacity .18s ease",
});

const dayLbl = (iso: string) => shortDayLabel(iso, i18n.language);
/** Český plurál: 1 bod / 2–4 body / 5+ bodů. */
const plural = (n: number, one: string, few: string, many: string) =>
	n === 1 ? one : n >= 2 && n <= 4 ? few : many;

/** Board porady — celostránkový detail uvnitř modulu Meets (`?meet=`). */
export function MeetBoard({
	meetingId,
	focusZapis,
	onBack,
	onOpenMeet,
}: {
	meetingId: string;
	/** ?focus=zapis (tok „Vložit přepis") — otevře editaci zápisu rovnou. */
	focusZapis?: boolean;
	onBack: () => void;
	onOpenMeet: (meetingId: string) => void;
}) {
	const { data: session } = useSession();
	const uid = session?.user?.id;
	const members = useAllMembers();
	const { open: openTask } = useTaskDetail();
	const [busy, setBusy] = useState(false);

	// ── lokální data (offline) — hub se odvozuje ze sidecaru (deep-link nese jen meet id) ──
	const { data: metaRows, isLoading: metaLoading } = usePsQuery<MeetingMeta>(
		"SELECT id, workspace_id, title, status, hub_task_id, series_id, prev_meeting_id FROM meetings WHERE id = ? LIMIT 1",
		[meetingId],
	);
	const meta = metaRows?.[0];
	const hubId = meta?.hub_task_id ?? "";
	const { data: hubRows, isFetching: hubFetching } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE id = ? LIMIT 1",
		[hubId],
	);
	const hub = hubRows?.[0];
	const { data: subRows, isLoading: subLoading } = usePsQuery<TaskRow>(
		"SELECT * FROM tasks WHERE parent_id = ? ORDER BY completed_at IS NOT NULL, created_at",
		[hubId],
	);
	const { data: linkRows, isLoading: linkLoading } = usePsQuery<{ to_id: string }>(
		"SELECT to_id FROM entity_links WHERE from_type = 'meeting' AND from_id = ? AND relation = 'derived_from'",
		[meetingId],
	);
	const derived = useMemo(() => new Set((linkRows ?? []).map((l) => l.to_id)), [linkRows]);
	// Příprava = podúkoly hubu BEZ akčních bodů (lineage NEBO meeting_id — čerstvě
	// založený bod nesmí do dojezdu linku problikávat v Přípravě; audit v2).
	const prep = (subRows ?? []).filter((s) => !derived.has(s.id) && !s.meeting_id);
	// Akční body: lineage ∪ tasks.meeting_id — fallback kryje selhání /commit (offline,
	// spadlé spojení): body jsou vidět hned a `_linked` řídí tlačítko „Propojit znovu"
	// i po reloadu (audit v2 — pendingLink v paměti nestačil, CC-P0-04).
	const { data: actionRows, isLoading: actLoading } = usePsQuery<TaskRow & { _linked: number }>(
		`SELECT t.*, el.id IS NOT NULL AS _linked FROM tasks t
		 LEFT JOIN entity_links el ON el.to_id = t.id AND el.from_type = 'meeting'
		   AND el.from_id = ? AND el.relation = 'derived_from'
		 WHERE el.id IS NOT NULL OR (t.meeting_id = ? AND t.kind IS NOT 'meeting')
		 ORDER BY t.completed_at IS NOT NULL, t.created_at`,
		[meetingId, meetingId],
	);
	const actions = actionRows ?? [];
	const unlinked = actions.filter((a) => !a._linked).map((a) => a.id);
	const { data: whoRows, isLoading: whoLoading } = usePsQuery<{ user_id: string }>(
		"SELECT user_id FROM assignments WHERE task_id = ?",
		[hubId],
	);
	const who = (whoRows ?? []).map((w) => w.user_id);
	// CC-P0-01: obchodní tvrzení („Zatím žádná…/0/0") až po dojezdu lokálních dotazů.
	// isFetching hubu: při přepnutí parametru ""→hubId knihovna NEresetuje isLoading a data
	// drží stale [] — bez této pojistky problikl fallback „nejsi člen" (audit boardu).
	const contentReady =
		!subLoading && !linkLoading && !whoLoading && !actLoading && !metaLoading && !hubFetching;
	// Řešitelé všech bodů JEDNÍM dotazem (podúkoly ∪ lineage — přesunuté body).
	const { data: subAsgRows } = usePsQuery<{ task_id: string; user_id: string }>(
		`SELECT a.task_id, a.user_id FROM assignments a WHERE a.task_id IN (
		   SELECT id FROM tasks WHERE parent_id = ?
		   UNION SELECT to_id FROM entity_links WHERE from_type = 'meeting' AND from_id = ? AND relation = 'derived_from'
		 )`,
		[hubId, meetingId],
	);
	const subNames = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const r of subAsgRows ?? [])
			m.set(r.task_id, [...(m.get(r.task_id) ?? []), members.get(r.user_id) ?? "?"]);
		return m;
	}, [subAsgRows, members]);
	// Projekty prostoru + moje role — akční bod smí mířit do JINÉHO projektu, ale jen
	// tam, kde jsem editor+ (server by commenterovi insert odmítl — poctivost 0.4).
	const { data: wsProjRows } = usePsQuery<{ id: string; name: string; role: string | null }>(
		`SELECT p.id, p.name, pm.role FROM projects p
		 LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
		 WHERE p.workspace_id = ? ORDER BY p.name COLLATE NOCASE`,
		[uid ?? "", meta?.workspace_id ?? ""],
	);
	const editableProjects = useMemo(
		() => (wsProjRows ?? []).filter((p) => p.role === "editor" || p.role === "manager"),
		[wsProjRows],
	);
	const projNames = useMemo(
		() => new Map((wsProjRows ?? []).map((p) => [p.id, p.name])),
		[wsProjRows],
	);
	// Členství VŠECH projektů prostoru — R5 validace řešitele proti cílovému projektu
	// + kandidáti řešitelů. Pozn.: sync doručí jen členy MÝCH projektů, takže „kdokoli
	// z prostoru" ≈ lidé sdílející se mnou aspoň jeden projekt (pilotní aproximace).
	const { data: allPmRows, isLoading: allPmLoading } = usePsQuery<{
		project_id: string;
		user_id: string;
	}>(
		`SELECT pm.project_id, pm.user_id FROM project_members pm
		 JOIN projects p ON p.id = pm.project_id WHERE p.workspace_id = ?`,
		[meta?.workspace_id ?? ""],
	);
	const pmByProject = useMemo(() => {
		const m = new Map<string, Set<string>>();
		for (const r of allPmRows ?? []) {
			const s = m.get(r.project_id) ?? new Set<string>();
			s.add(r.user_id);
			m.set(r.project_id, s);
		}
		return m;
	}, [allPmRows]);
	const wsPeople = useMemo(() => {
		const seen = new Set<string>();
		const out: { id: string; name: string }[] = [];
		for (const r of allPmRows ?? [])
			if (!seen.has(r.user_id)) {
				seen.add(r.user_id);
				out.push({ id: r.user_id, name: members.get(r.user_id) ?? "…" });
			}
		return out.sort((a, b) => a.name.localeCompare(b.name, "cs"));
	}, [allPmRows, members]);
	// Řetěz — porady stejné série + huby kvůli termínům.
	const seriesKey = meta?.series_id ?? meetingId;
	const { data: chainRows } = usePsQuery<
		MeetingMeta & { t_due: string | null; t_start: string | null }
	>(
		`SELECT m.id, m.workspace_id, m.title, m.status, m.hub_task_id, m.series_id, m.prev_meeting_id,
		        t.due_date AS t_due, t.start_date AS t_start
		 FROM meetings m LEFT JOIN tasks t ON t.id = m.hub_task_id
		 WHERE m.series_id = ? OR m.id = ?
		 ORDER BY t.due_date IS NULL, t.due_date, m.created_at`,
		[seriesKey, seriesKey],
	);
	// Huby řetězu — chip „přeneseno dál" jen pro SKUTEČNÝ carryover (rodič = hub jiné
	// porady série), ne pro libovolné ruční přeparentování (audit v2).
	const chainHubs = useMemo(
		() =>
			new Set(
				(chainRows ?? []).map((m) => m.hub_task_id).filter((x): x is string => !!x && x !== hubId),
			),
		[chainRows, hubId],
	);

	// ── příprava ──
	const [prepText, setPrepText] = useState("");
	async function addPrep() {
		const name = prepText.trim();
		if (!name || !hub || !uid) return;
		setPrepText("");
		await powerSync.execute(
			`INSERT INTO tasks (id, project_id, parent_id, name, priority, assignment_mode, created_by, created_at)
			 VALUES (uuid(), ?, ?, ?, 4, 'single', ?, ?)`,
			[hub.project_id, hubId, name, uid, new Date().toISOString()],
		);
	}

	// ── zápis (server-only obsah; CC-P0-13) ──
	// ODDĚLENĚ: `saved` = autoritativní (server), `draft` = rozepsaný koncept v editoru.
	// Stepper/fáze čtou JEN saved — psaní nesmí „splnit" krok Zápis (audit boardu).
	const [saved, setSaved] = useState("");
	const [draft, setDraft] = useState("");
	const [editing, setEditing] = useState(!!focusZapis);
	const [expanded, setExpanded] = useState(false);
	const [serverLoaded, setServerLoaded] = useState<"idle" | "ok" | "offline">("idle");
	const [proposals, setProposals] = useState<Editable[] | null>(null);
	const [wasMock, setWasMock] = useState(false);
	const [showUnclear, setShowUnclear] = useState(false);
	// „Zahodit návrhy" = vědomé rozhodnutí — bez flagu by je rehydratace hned vrátila.
	const [dismissed, setDismissed] = useState(false);
	// Uložená extrakce ze serveru (rehydratace po reloadu — bez ní by krok „Návrhy AI ✓"
	// ukazoval na nic a jediná cesta byla další placený AI call; audit v2).
	const [serverProposals, setServerProposals] = useState<Proposal[] | null>(null);
	// ── AUTOSAVE revize (jako všude v aplikaci): každá úprava se debounced ukládá na
	// server do meetings.extraction — přepnutí porady v řetězu/reload nic neztratí.
	// Verze (updatedAt) dle rozhodnutí 15.6: souběžnou cizí revizi nikdy tiše nepřepsat.
	const lastSavedRef = useRef<string>("");
	const proposalsRef = useRef<Editable[] | null>(null);
	proposalsRef.current = proposals;
	const reviewBaseRef = useRef<string | null>(null);
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "conflict">(
		"idle",
	);
	async function pushReview(body: Editable[], keepaliveWanted: boolean): Promise<Response> {
		const payload = JSON.stringify({ proposals: body, baseUpdatedAt: reviewBaseRef.current });
		// keepalive má tvrdý limit 64 KiB — velká revize jde běžným fetchem (SPA
		// unmount fetch neruší; keepalive je potřeba jen pro zavření/reload stránky).
		return fetch(`${API_URL}/api/meetings/${meetingId}/extraction`, {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: payload,
			keepalive: keepaliveWanted && payload.length < 60_000,
		});
	}
	/** Po 409: načti aktuální revizi ze serveru (cizí úpravy nikdy tiše nepřepsat). */
	async function reloadReview() {
		try {
			const r = await fetch(`${API_URL}/api/meetings/${meetingId}`, { credentials: "include" });
			if (!r.ok) throw new Error("meeting");
			const j = await r.json();
			if (typeof j.meeting?.updatedAt === "string") reviewBaseRef.current = j.meeting.updatedAt;
			const ext = Array.isArray(j.meeting?.extraction) ? (j.meeting.extraction as Proposal[]) : [];
			const mapped = ext.map((x) => toEditable(x, hub?.project_id ?? ""));
			lastSavedRef.current = JSON.stringify(mapped);
			setProposals(mapped.length ? mapped : null);
			setSaveState("idle");
			if (j.meeting?.status === "committed") {
				setProposals(null);
				showToast("Poradu mezitím někdo uzavřel — akční body už jsou založené.");
			}
		} catch {
			showToast("Načtení aktuální revize selhalo — zkus to při připojení.");
		}
	}
	useEffect(() => {
		if (!proposals) return;
		const snapshot = JSON.stringify(proposals);
		if (snapshot === lastSavedRef.current) return;
		setSaveState("saving");
		const t = setTimeout(async () => {
			try {
				const r = await pushReview(proposals, false);
				if (r.status === 409) {
					setSaveState("conflict"); // souběžná revize/commit — nepřepisovat, nabídnout načtení
					return;
				}
				if (!r.ok) throw new Error("save");
				const j = await r.json().catch(() => ({}));
				if (typeof j.updatedAt === "string") reviewBaseRef.current = j.updatedAt;
				lastSavedRef.current = snapshot;
				setSaveState("saved");
			} catch {
				setSaveState("error"); // poctivě: neuloženo (offline) — úpravy drž v okně
			}
		}, 700);
		// Cleanup JEN ruší debounce — flush dělá samostatný unmount effect níž
		// (cleanup tady běží při každém úhozu → posílal by request na každé písmeno).
		return () => clearTimeout(t);
	}, [proposals, meetingId]);
	// Flush při odchodu z boardu (unmount/přepnutí porady) — scénář „překlikl jsem
	// v řetězu a ztratil úpravy". Refs nesou poslední stav bez re-runů na každou změnu.
	useEffect(() => {
		return () => {
			const ps = proposalsRef.current;
			if (ps && JSON.stringify(ps) !== lastSavedRef.current)
				void pushReview(ps, true).catch(() => {});
		};
		// biome-ignore lint/correctness/useExhaustiveDependencies: flush jen při unmountu
	}, [meetingId]);
	const upd = (i: number, patch: Partial<Editable>) =>
		setProposals((ps) => (ps ?? []).map((x, xi) => (xi === i ? { ...x, ...patch } : x)));
	/** Vlastní bod nad rámec návrhů AI — porady neříkají všechno explicitně. */
	const addManual = () =>
		setProposals((ps) => [
			...(ps ?? []),
			{
				title: "",
				keep: true,
				kind: "action",
				evidence: null,
				projectId: hub?.project_id ?? "",
				assigneeUserIds: [],
			},
		]);
	useEffect(() => {
		let live = true;
		(async () => {
			// Retry s backoffem — studený page-load burst umí shodit první request
			// (přechodné síťové/DB chyby); teprve po vyčerpání pokusů hlásíme offline.
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					const r = await fetch(`${API_URL}/api/meetings/${meetingId}`, {
						credentials: "include",
					});
					if (r.status === 401 || r.status === 403 || r.status === 404) break; // ne-přechodné
					if (!r.ok) throw new Error("meeting");
					const j = await r.json();
					if (!live) return;
					// server plní jen autoritativní kopii; rozepsaný draft zůstává nedotčený
					if (typeof j.meeting?.transcript === "string" && j.meeting.transcript)
						setSaved(j.meeting.transcript);
					if (typeof j.meeting?.updatedAt === "string") reviewBaseRef.current = j.meeting.updatedAt;
					if (
						j.meeting?.status === "extracted" &&
						Array.isArray(j.meeting?.extraction) &&
						j.meeting.extraction.length > 0
					)
						setServerProposals(j.meeting.extraction as Proposal[]);
					setServerLoaded("ok");
					return;
				} catch {
					await new Promise((res) => setTimeout(res, 700 * (attempt + 1)));
					if (!live) return;
				}
			}
			if (live) setServerLoaded("offline");
		})();
		return () => {
			live = false;
		};
	}, [meetingId]);

	// Rehydratace uložené extrakce: čeká na hub (výchozí cílový projekt) a respektuje
	// „Zahodit návrhy" i rozběhlou revizi.
	useEffect(() => {
		if (!serverProposals || proposals || dismissed || !hub) return;
		const mapped = serverProposals.map((p) => toEditable(p, hub.project_id ?? ""));
		setProposals(mapped);
		lastSavedRef.current = JSON.stringify(mapped); // rehydratace není „změna" k uložení
	}, [serverProposals, proposals, dismissed, hub]);

	async function extractHere() {
		const text = (editing ? draft : saved).trim();
		if (text.length < 10) return;
		setBusy(true);
		try {
			const r = await fetch(`${API_URL}/api/meetings/extract`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ meetingId, transcript: text }),
			});
			if (!r.ok) throw new Error("extract");
			const j = await r.json();
			// unclear = nezaškrtnuté (rozpočet hluku), ale VIDITELNÉ — nic se neztrácí.
			{
				const mapped = (j.proposals ?? []).map((p: Proposal) =>
					toEditable(p, hub?.project_id ?? ""),
				);
				setProposals(mapped);
				lastSavedRef.current = JSON.stringify(mapped);
			}
			setWasMock(!!j.mock);
			if (typeof j.updatedAt === "string") reviewBaseRef.current = j.updatedAt;
			setSaved(text); // extrakce zápis ukládá na server → povýšit na autoritativní
			setEditing(false);
		} catch {
			showToast("Extrakce se nezdařila — zkus to znovu (vyžaduje připojení).");
		} finally {
			setBusy(false);
		}
	}

	/** Ulož zápis BEZ AI (nový endpoint) — poctivá cesta ven z editace (audit boardu). */
	async function saveTranscript() {
		const text = draft.trim();
		if (!text) return;
		setBusy(true);
		try {
			const r = await fetch(`${API_URL}/api/meetings/${meetingId}/transcript`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ transcript: text }),
			});
			if (!r.ok) throw new Error("save");
			const j = await r.json().catch(() => ({}));
			// uložení zápisu posouvá updatedAt — bez obnovy báze by autosave revize
			// falešně hlásil konflikt
			if (typeof j.updatedAt === "string") reviewBaseRef.current = j.updatedAt;
			setSaved(text);
			setEditing(false);
			showToast("Zápis uložen.");
		} catch {
			showToast("Uložení zápisu selhalo — vyžaduje připojení.");
		} finally {
			setBusy(false);
		}
	}

	// Nepropojené akční body se odvozují z dotazu (`unlinked` — přežije reload; audit v2).
	async function linkToServer(taskIds: string[]): Promise<boolean> {
		try {
			const r = await fetch(`${API_URL}/api/meetings/${meetingId}/commit`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ taskIds }),
			});
			return r.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Založí schválené akční body. Stejný projekt = PODÚKOL hubu; jiný projekt =
	 * samostatný úkol v cílovém projektu (podúkol musí být same-project — DB invariant),
	 * lineage přes entity_links + meeting_id nese oba případy. Rozhodnutí a nepřevzaté
	 * body „k dořešení" se uloží do popisu hubu — žádná informace se neztrácí.
	 */
	async function commitActions() {
		if (!proposals || !uid) return;
		if (!hub) {
			showToast("Porada se ještě načítá — zkus to za chvíli.");
			return;
		}
		// R5 mapa členství se ještě načítá → commit by TIŠE zahodil platné řešitele.
		if (allPmLoading) {
			showToast("Načítám členství projektů — zkus to za chvíli.");
			return;
		}
		const chosen = proposals.filter((p) => kindOf(p) === "action" && p.keep && p.title.trim());
		const decisions = proposals.filter((p) => kindOf(p) === "decision" && p.keep && p.title.trim());
		const leftovers = proposals.filter((p) => kindOf(p) === "unclear" && p.title.trim());
		if (chosen.length === 0 && decisions.length === 0 && leftovers.length === 0) {
			showToast("Není co založit — zaškrtni bod nebo doplň název.");
			return;
		}
		// Poctivost 0.4: bez role editor+ v cílovém projektu by server insert odmítl.
		const badTarget = chosen.filter((p) => !editableProjects.some((e) => e.id === p.projectId));
		if (badTarget.length > 0) {
			showToast("U některých bodů chybí cílový projekt (potřebuješ roli editor+) — vyber ho.");
			return;
		}
		// Popis hubu (rozhodnutí/k dořešení) je PATCH úkolu → server chce editor+ v projektu
		// porady; bez role by lokální zápis prošel, server ho vrátil a toast lhal (audit v2).
		const hubEditable = editableProjects.some((e) => e.id === hub.project_id);
		if ((decisions.length > 0 || leftovers.length > 0) && !hubEditable) {
			showToast(
				"Rozhodnutí a nedořešené body se ukládají k poradě — potřebuješ roli editor+ v jejím projektu.",
			);
			return;
		}
		setBusy(true);
		try {
			const now = new Date().toISOString();
			const taskIds: string[] = [];
			const made: { tid: string; pid: string }[] = [];
			await powerSync.writeTransaction(async (tx) => {
				for (const p of chosen) {
					const tid = crypto.randomUUID();
					const pid = p.projectId;
					taskIds.push(tid);
					made.push({ tid, pid });
					await tx.execute(
						`INSERT INTO tasks (id, project_id, parent_id, name, description, priority, due_date,
						   assignment_mode, meeting_id, created_by, created_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, 'single', ?, ?, ?)`,
						[
							tid,
							pid,
							pid === hub.project_id ? hubId : null,
							p.title.trim(),
							p.note?.trim() || null,
							p.priority ?? 3,
							p.due ?? null,
							meetingId,
							uid,
							now,
						],
					);
					// R5 — řešitelé (klidně víc, jako všude) jen členové CÍLOVÉHO projektu
					// (UI to hlídá varováním předem).
					for (const aid of p.assigneeUserIds) {
						if (!pmByProject.get(pid)?.has(aid)) continue;
						await tx.execute(
							"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (uuid(), ?, ?, ?, ?)",
							[tid, pid, aid, now],
						);
					}
				}
				// Rozhodnutí + nepřevzaté „k dořešení" → popis hubu (trvalá stopa porady).
				const blocks: string[] = [];
				if (decisions.length)
					blocks.push(
						`Rozhodnutí z porady:\n${decisions.map((d) => `• ${d.title.trim()}`).join("\n")}`,
					);
				if (leftovers.length)
					blocks.push(
						`K dořešení (nepřevzato jako úkol):\n${leftovers.map((d) => `• ${d.title.trim()}`).join("\n")}`,
					);
				if (blocks.length) {
					const block = blocks.join("\n\n");
					await tx.execute(
						`UPDATE tasks SET description = CASE WHEN description IS NULL OR description = ''
						   THEN ? ELSE description || char(10) || char(10) || ? END WHERE id = ?`,
						[block, block, hubId],
					);
				}
			});
			for (const m of made) void logTaskActivity(m.tid, m.pid, uid, "created", null, "meet");
			const crossCount = made.filter((m) => m.pid !== hub.project_id).length;
			const savedNote =
				decisions.length || leftovers.length
					? ` Rozhodnutí a nedořešené body uloženy k poradě.`
					: "";
			// Poctivě (0.4): úspěch hlásíme jen po OK; jinak nabídneme retry — nic „samo".
			// I s 0 body se volá server — uzavře poradu (status committed); porada jen
			// s rozhodnutími jinak neměla cestu k dokončení (audit v2).
			const linked = await linkToServer(taskIds);
			const nTxt = `${taskIds.length} ${plural(taskIds.length, "akční bod", "akční body", "akčních bodů")}`;
			if (linked) {
				showToast(
					taskIds.length === 0
						? `Revize uložena — porada uzavřena.${savedNote}`
						: `Založeno ${nTxt}${crossCount ? ` (${crossCount} v jiných projektech)` : ""}.${savedNote}`,
				);
			} else {
				showToast(
					taskIds.length === 0
						? `Revize uložena lokálně, ale uzavření porady selhalo — zkus „Propojit znovu" při připojení.${savedNote}`
						: `Akční body (${taskIds.length}) založeny, ale propojení s poradou selhalo — zkus „Propojit znovu" při připojení.`,
				);
			}
			lastSavedRef.current = JSON.stringify(proposals); // ať cleanup autosave neposílá
			setProposals(null);
			setDismissed(true); // revize proběhla — rehydratace už nemá co vracet
		} catch {
			showToast("Založení akčních bodů selhalo — nic se nezměnilo, zkus to znovu.");
		} finally {
			setBusy(false);
		}
	}

	// ── řetěz: navazující meet + carryover = PŘESUN nedodělků ──
	async function followUp() {
		if (!hub || !uid || !meta?.workspace_id) return;
		// Poctivost 0.4: bez editor+ v projektu porady by server nový hub odmítl.
		if (!editableProjects.some((e) => e.id === hub.project_id)) {
			showToast("Navazující poradu může založit jen editor projektu porady.");
			return;
		}
		setBusy(true);
		try {
			const newMeetId = crypto.randomUUID();
			const newTaskId = crypto.randomUUID();
			const now = new Date().toISOString();
			const baseDay = (hub.due_date ?? todayISO()).slice(0, 10);
			const d = new Date(`${baseDay}T00:00:00`);
			d.setDate(d.getDate() + 7);
			const nextDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
			const startIso = hub.start_date ? `${nextDay}T${hub.start_date.slice(11)}` : null;
			const carry = (subRows ?? []).filter((s) => !s.completed_at);
			await powerSync.writeTransaction(async (tx) => {
				await tx.execute(
					`INSERT INTO tasks (id, project_id, name, priority, due_date, start_date, duration_min,
					   assignment_mode, kind, meeting_id, created_by, created_at)
					 VALUES (?, ?, ?, 4, ?, ?, ?, 'single', 'meeting', ?, ?, ?)`,
					[
						newTaskId,
						hub.project_id,
						hub.name,
						nextDay,
						startIso,
						hub.duration_min ?? 60,
						newMeetId,
						uid,
						now,
					],
				);
				await tx.execute(
					`INSERT INTO meetings (id, workspace_id, title, status, hub_task_id, series_id, prev_meeting_id, created_by, created_at)
					 VALUES (?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)`,
					[newMeetId, meta.workspace_id, hub.name, newTaskId, seriesKey, meetingId, uid, now],
				);
				await tx.execute(
					`INSERT INTO assignments (id, task_id, project_id, user_id, created_at)
					 SELECT uuid(), ?, project_id, user_id, ? FROM assignments WHERE task_id = ?`,
					[newTaskId, now, hubId],
				);
				// Carryover = PŘESUN (řešitel/termín/lineage zůstávají, žádné duplicity).
				if (carry.length) {
					const ph = carry.map(() => "?").join(", ");
					await tx.execute(`UPDATE tasks SET parent_id = ? WHERE id IN (${ph})`, [
						newTaskId,
						...carry.map((c) => c.id),
					]);
				}
			});
			void logTaskActivity(newTaskId, hub.project_id, uid, "created", null, "meet");
			showToast(
				`Navazující meet ${dayLbl(nextDay)} založen${carry.length ? ` — ${carry.length} nedodělků přesunuto do jeho přípravy` : ""}.`,
			);
			onOpenMeet(newMeetId);
		} finally {
			setBusy(false);
		}
	}

	// ── stav → procesní ukazatel + důrazy (jedna obrazovka, tři důrazy) ──
	const today = todayISO();
	const day = (hub?.due_date ?? "").slice(0, 10);
	const status = meta?.status ?? "scheduled";
	const hasTranscript =
		saved.trim().length > 0 || ["transcribed", "extracted", "committed"].includes(status);
	// „Proběhla" = den minul, hub odškrtnutý, NEBO existuje zápis (zápis ⇒ porada byla).
	const passed = (!!hub && ((!!day && day < today) || !!hub.completed_at)) || hasTranscript;
	const phase: "pred" | "po" | "hotovo" =
		status === "committed" ? "hotovo" : passed || hasTranscript ? "po" : "pred";
	/** Kroky procesu „ze zápisu úkoly" — viditelné ukotvení, kde porada právě je. */
	const steps: { label: string; done: boolean }[] = [
		{ label: "Naplánováno", done: true },
		{ label: "Proběhla", done: passed },
		{ label: "Zápis", done: hasTranscript },
		{ label: "Návrhy AI", done: !!proposals || ["extracted", "committed"].includes(status) },
		{
			label: actions.length ? `Akční body · ${actions.length}` : "Akční body",
			done: status === "committed",
		},
	];
	const currentStep = steps.findIndex((s) => !s.done);
	// Revizní přihrádky s PŮVODNÍM indexem (upd/promote pracují nad jedním polem).
	const idxd = (proposals ?? []).map((p, i) => ({ p, i }));
	const nActions = idxd.filter(
		({ p }) => kindOf(p) === "action" && p.keep && p.title.trim(),
	).length;

	const time = (() => {
		if (!hub) return "";
		const m = startMinOf(hub);
		if (m == null) return "";
		const p = (n: number) => String(n).padStart(2, "0");
		return ` · ${p(Math.floor(m / 60))}:${p(m % 60)}`;
	})();
	const whoNames = who.map((id) => members.get(id) ?? "?");

	// Porada bez lokálního hub-úkolu (deep-link mimo moje projekty / legacy zápis).
	if (contentReady && !hub) {
		return (
			<div style={{ maxWidth: 1060, margin: "0 auto", padding: "22px 20px 60px" }}>
				<button type="button" style={BTN_GHOST} onClick={onBack}>
					← Meets
				</button>
				<div style={{ ...secStyle("base"), marginTop: 14 }}>
					<div
						className="font-display"
						style={{ fontWeight: 700, fontSize: 15, color: "var(--w-ink)" }}
					>
						{meta?.title ?? "Porada"}
					</div>
					<div
						className="font-body"
						style={{ fontSize: 12.5, color: "var(--w-ink-3)", marginTop: 4 }}
					>
						{meta
							? meta.hub_task_id
								? "Porada z projektu, kde nejsi člen — vidíš jen základní údaje."
								: "Rychlý zápis bez naplánované porady (jen přepis)."
							: "Porada nenalezena."}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div style={{ maxWidth: 1060, margin: "0 auto", padding: "22px 20px 60px" }}>
			{/* ── hlavička: vše z bývalé záložky Přehled v jednom pruhu ── */}
			<div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
				<button type="button" style={{ ...BTN_GHOST, padding: "6px 11px" }} onClick={onBack}>
					← Meets
				</button>
				<h1
					className="font-display"
					style={{ fontWeight: 800, fontSize: 19, color: "var(--w-ink)", margin: 0, minWidth: 0 }}
				>
					{hub?.name ?? meta?.title ?? "…"}
				</h1>
				<span className="font-mono" style={{ fontSize: 12, color: "var(--w-brass-text)" }}>
					{hub?.due_date ? dayLbl(hub.due_date) : "bez termínu"}
					{time}
					{hub?.duration_min ? ` · ${hub.duration_min} min` : ""}
				</span>
				{who.length > 0 && (
					<span title={whoNames.join(", ")}>
						<AvatarGroup people={whoNames.map((n) => initials(n))} />
					</span>
				)}
				<span
					className="font-display"
					style={{
						fontWeight: 600,
						fontSize: 10.5,
						padding: "3px 10px",
						borderRadius: 999,
						background:
							status === "committed"
								? "var(--w-success-soft)"
								: phase === "po"
									? "var(--w-brass-soft)"
									: "var(--w-panel-2)",
						color:
							status === "committed"
								? "var(--w-success-ink)"
								: phase === "po"
									? "var(--w-brass-text)"
									: "var(--w-ink-2)",
					}}
				>
					{status === "committed"
						? "zpracováno"
						: hasTranscript
							? "zápis vložen"
							: phase === "po"
								? "čeká na zápis"
								: "naplánováno"}
				</span>
				<span style={{ flex: 1 }} />
				<button
					type="button"
					style={{ ...BTN_GHOST, padding: "7px 12px" }}
					onClick={() => hub && openTask(hub.id)}
				>
					Otevřít jako úkol
				</button>
				<button
					type="button"
					style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1, padding: "7px 13px" }}
					disabled={busy}
					onClick={() => void followUp()}
					title="Založí poradu za týden a přesune nedodělky do její přípravy (volitelné — porady nemusí navazovat)"
				>
					Navazující →
				</button>
			</div>

			{/* ── procesní ukazatel: jak se ze zápisu stanou úkoly ── */}
			<div
				style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 13 }}
			>
				{steps.map((s, i) => (
					<span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
						{i > 0 && (
							<span style={{ width: 14, height: 1, background: "var(--w-line)", flex: "none" }} />
						)}
						<span
							className="font-mono"
							style={{
								fontSize: 10,
								letterSpacing: ".04em",
								padding: "3px 10px",
								borderRadius: 999,
								border: `1px solid ${s.done ? "var(--w-brass)" : i === currentStep ? "var(--w-brass)" : "var(--w-line)"}`,
								background: s.done ? "var(--w-brass-soft)" : "transparent",
								color: s.done
									? "var(--w-brass-text)"
									: i === currentStep
										? "var(--w-brass-text)"
										: "var(--w-ink-3)",
								borderStyle: i === currentStep && !s.done ? "dashed" : "solid",
							}}
						>
							{s.done ? "✓ " : ""}
							{s.label}
						</span>
					</span>
				))}
			</div>

			{/* ── dva sloupce ── */}
			<div
				style={{
					display: "flex",
					gap: 14,
					marginTop: 14,
					alignItems: "flex-start",
					flexWrap: "wrap",
				}}
			>
				{/* LEVÝ: práce */}
				<div
					style={{
						flex: "58 1 340px",
						minWidth: 0,
						display: "flex",
						flexDirection: "column",
						gap: 14,
					}}
				>
					<section style={secStyle(phase === "pred" ? "hot" : "dim")}>
						<div style={{ ...LABEL, marginBottom: 9 }}>
							Příprava{" "}
							{prep.length > 0 && (
								<span style={{ color: "var(--w-brass-text)" }}>
									{prep.filter((p) => p.completed_at).length}/{prep.length}
								</span>
							)}
						</div>
						{contentReady && prep.length === 0 && (
							<div
								className="font-body"
								style={{ fontSize: 12.5, color: "var(--w-ink-3)", marginBottom: 8 }}
							>
								Podklady porady = podúkoly s řešiteli — přidej první bod níž.
							</div>
						)}
						{prep.map((s) => (
							<SubRow
								key={s.id}
								t={s}
								names={subNames.get(s.id) ?? []}
								onToggle={() => void toggleTask(s, uid)}
								onOpen={() => openTask(s.id)}
							/>
						))}
						<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
							<input
								value={prepText}
								onChange={(e) => setPrepText(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") void addPrep();
								}}
								placeholder="Přidat bod přípravy… ⏎"
								style={INPUT}
							/>
							<button
								type="button"
								style={{ ...BTN_PRIMARY, opacity: prepText.trim() ? 1 : 0.5 }}
								onClick={() => void addPrep()}
							>
								Přidat
							</button>
						</div>
					</section>

					<section style={secStyle(phase === "hotovo" || proposals ? "hot" : "dim")}>
						<div style={{ ...LABEL, marginBottom: 9 }}>
							Akční body{" "}
							{actions.length > 0 && (
								<span style={{ color: "var(--w-brass-text)" }}>
									{actions.filter((a) => a.completed_at).length}/{actions.length}
								</span>
							)}
						</div>
						{/* AI revize návrhů — tři přihrádky: akční body / k dořešení / rozhodnutí.
						    Plná editace (řešitel kdokoli z prostoru, termín, priorita, CÍLOVÝ projekt)
						    + vlastní body. Nic se neztrácí: nepřevzaté jde do popisu porady. */}
						{proposals && (
							<div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
								<div
									className="font-body"
									style={{
										fontSize: 12,
										color: "var(--w-ink-3)",
										display: "flex",
										gap: 8,
										alignItems: "baseline",
										flexWrap: "wrap",
									}}
								>
									<span style={{ minWidth: 0 }}>
										Návrhy ze zápisu{wasMock ? " · ukázkový režim (bez AI klíče)" : ""} — uprav,
										přiřaď a založ. Každý bod nese citaci zápisu (❞).
									</span>
									<span
										className="font-mono"
										style={{
											fontSize: 10,
											flex: "none",
											marginLeft: "auto",
											display: "inline-flex",
											gap: 8,
											alignItems: "baseline",
											color:
												saveState === "error" || saveState === "conflict"
													? "var(--w-overdue)"
													: "var(--w-ink-3)",
										}}
									>
										{saveState === "saving"
											? "ukládám…"
											: saveState === "saved"
												? "revize uložena"
												: saveState === "error"
													? "neuloženo — bez připojení"
													: saveState === "conflict"
														? "revizi souběžně upravil někdo jiný"
														: ""}
										{saveState === "conflict" && (
											<button
												type="button"
												onClick={() => void reloadReview()}
												className="font-display"
												style={{
													fontWeight: 600,
													fontSize: 10.5,
													color: "var(--w-brass-text)",
													background: "none",
													border: "none",
													padding: 0,
													cursor: "pointer",
												}}
											>
												Načíst aktuální →
											</button>
										)}
									</span>
								</div>
								{idxd
									.filter(({ p }) => kindOf(p) === "action")
									.map(({ p, i }) => {
										const target = pmByProject.get(p.projectId);
										// Během načítání členství nevaruj — falešné ⚠ (audit v2).
										const badAssignees = allPmLoading
											? []
											: p.assigneeUserIds.filter((id) => !!p.projectId && !target?.has(id));
										// Návrh projektu, kde jsou členy VŠICHNI zvolení řešitelé.
										const suggest =
											badAssignees.length > 0
												? editableProjects.find((e) =>
														p.assigneeUserIds.every((id) => pmByProject.get(e.id)?.has(id)),
													)
												: undefined;
										const badTarget = !editableProjects.some((e) => e.id === p.projectId);
										return (
											<div
												// biome-ignore lint/suspicious/noArrayIndexKey: stabilní v rámci revize
												key={i}
												style={{
													border: "1px solid var(--w-line)",
													borderRadius: 10,
													padding: "8px 10px",
													opacity: p.keep ? 1 : 0.55,
													display: "flex",
													flexDirection: "column",
													gap: 6,
												}}
											>
												<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
													<input
														type="checkbox"
														checked={p.keep}
														onChange={(e) => upd(i, { keep: e.target.checked })}
														style={{ accentColor: "var(--w-brass)", flex: "none" }}
														aria-label="Založit tento akční bod"
													/>
													<input
														value={p.title}
														onChange={(e) => upd(i, { title: e.target.value })}
														placeholder="Co se má udělat…"
														style={{ ...INPUT, fontWeight: 600 }}
													/>
													{p.evidence && (
														<span
															title={`Ze zápisu: „${p.evidence}"`}
															className="font-display"
															style={{
																flex: "none",
																fontSize: 14,
																color: "var(--w-brass-text)",
																cursor: "help",
															}}
														>
															❞
														</span>
													)}
												</div>
												{p.keep && (
													<div
														style={{
															display: "flex",
															gap: 6,
															flexWrap: "wrap",
															alignItems: "center",
															paddingLeft: 21,
														}}
													>
														{p.assigneeUserIds.map((id) => (
															<span
																key={id}
																className="font-body"
																style={{
																	display: "inline-flex",
																	alignItems: "center",
																	gap: 5,
																	fontSize: 11,
																	padding: "3px 5px 3px 9px",
																	borderRadius: 999,
																	background: badAssignees.includes(id)
																		? "var(--w-overdue-soft)"
																		: "var(--w-brass-soft)",
																	color: badAssignees.includes(id)
																		? "var(--w-overdue)"
																		: "var(--w-brass-text)",
																}}
															>
																{members.get(id) ?? "?"}
																<button
																	type="button"
																	aria-label={`Odebrat řešitele ${members.get(id) ?? ""}`}
																	onClick={() =>
																		upd(i, {
																			assigneeUserIds: p.assigneeUserIds.filter((x) => x !== id),
																		})
																	}
																	style={{
																		border: "none",
																		background: "none",
																		color: "inherit",
																		cursor: "pointer",
																		padding: 0,
																		fontSize: 12,
																		lineHeight: 1,
																	}}
																>
																	×
																</button>
															</span>
														))}
														<select
															value=""
															onChange={(e) => {
																const id = e.target.value;
																if (id && !p.assigneeUserIds.includes(id))
																	upd(i, { assigneeUserIds: [...p.assigneeUserIds, id] });
															}}
															style={SELECT}
															aria-label="Přidat řešitele"
														>
															<option value="">
																{p.assigneeUserIds.length === 0
																	? p.assigneeHint
																		? `? ${p.assigneeHint} — přiřaď…`
																		: "— bez řešitele · přiřaď… —"
																	: "+ další řešitel…"}
															</option>
															{wsPeople
																.filter((m) => !p.assigneeUserIds.includes(m.id))
																.map((m) => (
																	<option key={m.id} value={m.id}>
																		{m.name}
																	</option>
																))}
														</select>
														<select
															value={p.projectId}
															onChange={(e) => upd(i, { projectId: e.target.value })}
															style={{
																...SELECT,
																borderColor: badTarget ? "var(--w-overdue)" : "var(--w-line)",
															}}
															aria-label="Cílový projekt"
														>
															{badTarget && <option value={p.projectId}>— vyber projekt —</option>}
															{editableProjects.map((e) => (
																<option key={e.id} value={e.id}>
																	{e.id === hub?.project_id ? `${e.name} (porada)` : e.name}
																</option>
															))}
														</select>
														<input
															type="date"
															value={p.due ?? ""}
															onChange={(e) => upd(i, { due: e.target.value || null })}
															style={{ ...SELECT, width: 130 }}
															aria-label="Termín"
														/>
														<select
															value={String(p.priority ?? 3)}
															onChange={(e) => upd(i, { priority: Number(e.target.value) })}
															style={SELECT}
															aria-label="Priorita"
														>
															<option value="1">P1</option>
															<option value="2">P2</option>
															<option value="3">P3</option>
															<option value="4">P4</option>
														</select>
													</div>
												)}
												{p.keep && badAssignees.length > 0 && (
													<div
														className="font-body"
														style={{
															fontSize: 11,
															color: "var(--w-overdue)",
															paddingLeft: 21,
															display: "flex",
															gap: 8,
															alignItems: "center",
															flexWrap: "wrap",
														}}
													>
														⚠ {badAssignees.map((id) => members.get(id) ?? "?").join(", ")}{" "}
														{plural(
															badAssignees.length,
															"není členem",
															"nejsou členy",
															"nejsou členy",
														)}{" "}
														projektu „{projNames.get(p.projectId) ?? "?"}" — bod se založí bez{" "}
														{badAssignees.length === p.assigneeUserIds.length ? "řešitelů" : "nich"}
														.
														{suggest && (
															<button
																type="button"
																onClick={() => upd(i, { projectId: suggest.id })}
																className="font-display"
																style={{
																	fontWeight: 600,
																	fontSize: 11,
																	color: "var(--w-brass-text)",
																	background: "none",
																	border: "none",
																	padding: 0,
																	cursor: "pointer",
																}}
															>
																Přesunout do „{suggest.name}" →
															</button>
														)}
													</div>
												)}
											</div>
										);
									})}
								<button
									type="button"
									style={{ ...BTN_GHOST, alignSelf: "flex-start", padding: "6px 11px" }}
									onClick={() => addManual()}
								>
									+ Přidat vlastní bod
								</button>
								{idxd.some(({ p }) => kindOf(p) === "unclear") && (
									<div
										style={{
											border: "1px dashed var(--w-line)",
											borderRadius: 10,
											padding: "8px 10px",
										}}
									>
										<button
											type="button"
											onClick={() => setShowUnclear((v) => !v)}
											className="font-display"
											style={{
												fontWeight: 700,
												fontSize: 12,
												color: "var(--w-ink-2)",
												background: "none",
												border: "none",
												padding: 0,
												cursor: "pointer",
											}}
										>
											K dořešení · {idxd.filter(({ p }) => kindOf(p) === "unclear").length}{" "}
											{showUnclear ? "▴" : "▾"}
										</button>
										<div
											className="font-body"
											style={{ fontSize: 11, color: "var(--w-ink-3)", marginTop: 2 }}
										>
											Nejasné či implicitní zmínky ze zápisu — AI nic nedomýšlí. Převezmi, co je
											úkol; zbytek se uloží k poradě.
										</div>
										{showUnclear &&
											idxd
												.filter(({ p }) => kindOf(p) === "unclear")
												.map(({ p, i }) => (
													<div
														// biome-ignore lint/suspicious/noArrayIndexKey: stabilní v rámci revize
														key={i}
														style={{
															marginTop: 8,
															paddingTop: 8,
															borderTop: "1px solid var(--w-line)",
														}}
													>
														<div
															className="font-display"
															style={{ fontWeight: 600, fontSize: 12.5, color: "var(--w-ink)" }}
														>
															{p.title}
														</div>
														{p.evidence && (
															<div
																className="font-body"
																style={{
																	fontSize: 11.5,
																	color: "var(--w-ink-3)",
																	fontStyle: "italic",
																	marginTop: 2,
																}}
															>
																„{p.evidence}"
															</div>
														)}
														<button
															type="button"
															onClick={() => upd(i, { kind: "action", keep: true })}
															className="font-display"
															style={{
																fontWeight: 600,
																fontSize: 11.5,
																color: "var(--w-brass-text)",
																background: "none",
																border: "none",
																padding: 0,
																marginTop: 4,
																cursor: "pointer",
															}}
														>
															Převzít jako akční bod ↑
														</button>
													</div>
												))}
									</div>
								)}
								{idxd.some(({ p }) => kindOf(p) === "decision") && (
									<div
										style={{
											border: "1px solid var(--w-line)",
											borderRadius: 10,
											padding: "8px 10px",
										}}
									>
										<div style={{ ...LABEL, marginBottom: 2 }}>Rozhodnutí — uloží se k poradě</div>
										<div
											className="font-body"
											style={{ fontSize: 11, color: "var(--w-ink-3)", marginBottom: 5 }}
										>
											Odškrtnutá rozhodnutí se neuloží (zůstávají jen v zápisu).
										</div>
										{idxd
											.filter(({ p }) => kindOf(p) === "decision")
											.map(({ p, i }) => (
												<label
													// biome-ignore lint/suspicious/noArrayIndexKey: stabilní v rámci revize
													key={i}
													className="font-body"
													style={{
														display: "flex",
														gap: 8,
														alignItems: "center",
														fontSize: 12.5,
														color: "var(--w-ink-2)",
														padding: "2px 0",
														cursor: "pointer",
													}}
												>
													<input
														type="checkbox"
														checked={p.keep}
														onChange={(e) => upd(i, { keep: e.target.checked })}
														style={{ accentColor: "var(--w-brass)", flex: "none" }}
													/>
													<span style={{ minWidth: 0 }}>{p.title}</span>
													{p.evidence && (
														<span
															title={`Ze zápisu: „${p.evidence}"`}
															style={{
																flex: "none",
																color: "var(--w-brass-text)",
																cursor: "help",
															}}
														>
															❞
														</span>
													)}
												</label>
											))}
									</div>
								)}
								<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
									<button
										type="button"
										style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}
										disabled={busy}
										onClick={() => void commitActions()}
									>
										{nActions > 0
											? `Založit ${nActions} ${plural(nActions, "akční bod", "akční body", "akčních bodů")}`
											: "Uložit revizi"}
									</button>
									<button
										type="button"
										style={BTN_GHOST}
										onClick={() => {
											// flush při unmountu porovnává poslední snapshot — srovnat PŘED
											// vynulováním, jinak by zahozené návrhy poslal zpět na server
											lastSavedRef.current = JSON.stringify(proposals);
											setProposals(null);
											setDismissed(true);
											void pushReview([], false)
												.then((r) => {
													if (r.status === 409)
														showToast(
															"Revizi mezitím změnil někdo jiný — zahození se neuložilo, otevři poradu znovu.",
														);
												})
												.catch(() => {});
										}}
									>
										Zahodit návrhy
									</button>
								</div>
							</div>
						)}
						{unlinked.length > 0 && !proposals && (
							<button
								type="button"
								style={{ ...BTN_GHOST, color: "var(--w-brass-text)", marginBottom: 8 }}
								onClick={() =>
									void linkToServer(unlinked).then((ok) => {
										if (ok) showToast("Akční body propojeny s poradou.");
										else showToast("Propojení zatím selhalo — zkus to při připojení.");
									})
								}
							>
								Propojit akční body znovu →
							</button>
						)}
						{contentReady && actions.length === 0 && !proposals && (
							<div className="font-body" style={{ fontSize: 12.5, color: "var(--w-ink-3)" }}>
								Vzniknou ze zápisu (vpravo) — AI je navrhne, ty schválíš. Každý pak nese vazbu
								„vzešlo z této porady".
							</div>
						)}
						{actions.map((s) => (
							<SubRow
								key={s.id}
								t={s}
								chip={
									s.parent_id === hubId
										? undefined
										: s.parent_id && chainHubs.has(s.parent_id)
											? {
													label: "→ přeneseno dál",
													title: "Nedodělek přesunutý do navazující porady",
												}
											: s.project_id !== hub?.project_id
												? {
														label: projNames.get(s.project_id ?? "") ?? "jiný projekt",
														title: "Akční bod založený v jiném projektu",
													}
												: undefined
								}
								names={subNames.get(s.id) ?? []}
								onToggle={() => void toggleTask(s, uid)}
								onOpen={() => openTask(s.id)}
							/>
						))}
					</section>
				</div>

				{/* PRAVÝ: obsah */}
				<div
					style={{
						flex: "42 1 300px",
						minWidth: 0,
						display: "flex",
						flexDirection: "column",
						gap: 14,
					}}
				>
					<section
						style={secStyle(
							phase === "po" && !proposals ? "hot" : phase === "pred" ? "dim" : "base",
						)}
					>
						<div style={{ ...LABEL, marginBottom: 9 }}>Zápis</div>
						{serverLoaded === "offline" && (
							<div
								className="font-body"
								style={{
									fontSize: 12,
									color: "var(--w-ink-3)",
									background: "var(--w-panel-2)",
									borderRadius: 9,
									padding: "8px 11px",
									marginBottom: 8,
								}}
							>
								Zápis se načítá ze serveru — offline není dostupný (termín, příprava i akční body
								fungují offline).
							</div>
						)}
						{!hasTranscript && !editing && (
							<div className="font-body" style={{ fontSize: 12.5, color: "var(--w-ink-3)" }}>
								{phase === "pred"
									? "Po poradě sem vlož zápis nebo přepis — AI z něj vytáhne akční body."
									: "Porada proběhla — vlož zápis a nech AI navrhnout akční body."}
							</div>
						)}
						{(editing || (phase !== "pred" && !hasTranscript)) && (
							<textarea
								value={draft}
								onChange={(e) => {
									if (!editing) setEditing(true);
									setDraft(e.target.value);
								}}
								rows={8}
								placeholder="Vlož přepis / zápis z porady…"
								style={{ ...INPUT, resize: "vertical", lineHeight: 1.55, marginTop: 4 }}
							/>
						)}
						{hasTranscript && !editing && (
							<div
								className="font-body"
								style={{
									fontSize: 12,
									lineHeight: 1.6,
									color: "var(--w-ink-2)",
									whiteSpace: "pre-line",
									maxHeight: expanded ? "none" : "7.5em",
									overflow: "hidden",
								}}
							>
								{saved || "(zápis je uložený na serveru)"}
							</div>
						)}
						<div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
							{hasTranscript && !editing && saved && (
								<button
									type="button"
									className="font-display"
									style={{
										fontWeight: 600,
										fontSize: 11.5,
										color: "var(--w-brass-text)",
										background: "none",
										border: "none",
										padding: 0,
										cursor: "pointer",
									}}
									onClick={() => setExpanded((v) => !v)}
								>
									{expanded ? "Sbalit zápis ↑" : "Rozbalit celý zápis ↓"}
								</button>
							)}
							{!editing && status !== "committed" && (
								<button
									type="button"
									className="font-display"
									style={{
										fontWeight: 600,
										fontSize: 11.5,
										color: "var(--w-ink-3)",
										background: "none",
										border: "none",
										padding: 0,
										cursor: "pointer",
									}}
									onClick={() => {
										setDraft(saved);
										setEditing(true);
									}}
								>
									{hasTranscript ? "Upravit zápis" : "Vložit zápis"}
								</button>
							)}
						</div>
						{(editing || (phase !== "pred" && !hasTranscript)) && status !== "committed" && (
							<div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
								{!proposals && (
									<button
										type="button"
										style={{ ...BTN_PRIMARY, opacity: busy || draft.trim().length < 10 ? 0.5 : 1 }}
										disabled={busy || draft.trim().length < 10}
										onClick={() => void extractHere()}
									>
										{busy ? "Zpracovávám…" : "Vytáhnout akční body →"}
									</button>
								)}
								<button
									type="button"
									style={{ ...BTN_GHOST, opacity: busy || !draft.trim() ? 0.5 : 1 }}
									disabled={busy || !draft.trim()}
									onClick={() => void saveTranscript()}
								>
									Uložit zápis
								</button>
								{editing && (
									<button type="button" style={BTN_GHOST} onClick={() => setEditing(false)}>
										Zrušit
									</button>
								)}
							</div>
						)}
						{status === "committed" && (
							<div
								className="font-body"
								style={{ fontSize: 11.5, color: "var(--w-ink-3)", marginTop: 6 }}
							>
								Porada je zpracovaná — zápis je uzamčený jako podklad akčních bodů.
							</div>
						)}
					</section>

					<section style={secStyle("base")}>
						<div style={{ ...LABEL, marginBottom: 9 }}>Řetěz</div>
						<div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
							{(chainRows ?? []).map((m, i) => {
								const isMe = m.id === meetingId;
								return (
									<span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
										{i > 0 && <span style={{ color: "var(--w-ink-3)", fontSize: 11 }}>→</span>}
										<button
											type="button"
											disabled={isMe}
											onClick={() => onOpenMeet(m.id)}
											className="font-mono"
											title={m.title ?? ""}
											style={{
												fontSize: 10.5,
												padding: "4px 10px",
												borderRadius: 999,
												border: `1px solid ${isMe ? "var(--w-brass)" : "var(--w-line)"}`,
												background: isMe ? "var(--w-brass-soft)" : "var(--w-card)",
												color: isMe ? "var(--w-brass-text)" : "var(--w-ink-2)",
												cursor: isMe ? "default" : "pointer",
											}}
										>
											{m.t_due ? dayLbl(m.t_due) : "bez termínu"}
											{m.status === "committed" ? " ✓" : ""}
											{isMe ? " · tahle" : ""}
										</button>
									</span>
								);
							})}
						</div>
						<div
							className="font-body"
							style={{ fontSize: 11, color: "var(--w-ink-3)", marginTop: 8 }}
						>
							Navazující porada je volitelná — jednorázový meet řetěz nepotřebuje.
						</div>
					</section>
				</div>
			</div>
		</div>
	);
}

/** Řádek bodu (příprava/akční) — checkbox + řešitelé (batched) + proklik do detailu. */
function SubRow({
	t,
	names: nameList,
	chip,
	onToggle,
	onOpen,
}: {
	t: TaskRow;
	names: string[];
	/** Informační chip — carryover („přeneseno dál") nebo cizí projekt (název). */
	chip?: { label: string; title: string };
	onToggle: () => void;
	onOpen: () => void;
}) {
	const names = nameList.join(", ");
	const done = Boolean(t.completed_at);
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 9, padding: "3px 0" }}>
			<button
				type="button"
				onClick={onToggle}
				aria-label={done ? "Vrátit" : "Dokončit"}
				className="grid shrink-0 place-items-center rounded-full"
				style={{
					width: 17,
					height: 17,
					background: done ? "var(--w-brass)" : "transparent",
					border: done ? "none" : "2px solid var(--w-line)",
					cursor: "pointer",
				}}
			>
				{done && (
					<svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden>
						<path d="M2 5.7 L4.3 8 L9 2.7" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
					</svg>
				)}
			</button>
			<button
				type="button"
				onClick={onOpen}
				className="font-display"
				style={{
					flex: 1,
					minWidth: 0,
					textAlign: "left",
					border: "none",
					background: "transparent",
					cursor: "pointer",
					fontWeight: 600,
					fontSize: 13,
					color: done ? "var(--w-ink-3)" : "var(--w-ink)",
					textDecoration: done ? "line-through" : "none",
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{t.name}
			</button>
			{t.due_date && !done && (
				<span
					className="font-mono"
					style={{ fontSize: 10.5, color: "var(--w-ink-3)", flex: "none" }}
				>
					{dayLbl(t.due_date)}
				</span>
			)}
			{chip && (
				<span
					className="font-mono"
					title={chip.title}
					style={{
						fontSize: 9.5,
						color: "var(--w-brass-text)",
						background: "var(--w-brass-soft)",
						borderRadius: 999,
						padding: "2px 8px",
						flex: "none",
						maxWidth: 120,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{chip.label}
				</span>
			)}
			{names && (
				<span className="font-body" style={{ fontSize: 11, color: "var(--w-ink-3)", flex: "none" }}>
					{names}
				</span>
			)}
		</div>
	);
}
