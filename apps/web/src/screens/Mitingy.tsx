/**
 * Modul Meets — propojený systém porad (plán files/MEETS_system_plan_2026-07-13.md, Fáze 1).
 * Každý meet JE kotevní úkol (tasks.kind='meeting'): termín = due_date + start_date s časem,
 * účastníci = assignments (R5: jen členové projektu), příprava = podúkoly. Sidecar `meetings`
 * (metadata; přepis/extraction jen přes API — CC-P0-13) se váže přes tasks.meeting_id ↔
 * meetings.hub_task_id. Přehled čte LOKÁLNÍ sync (offline) a řadí dle termínů; díky kind
 * se porada ukáže v Dnes/Nadcházejících/kalendáři, ale nezašumí pracovní seznamy a počty.
 * Zachován tok „přepis → AI návrhy → lidská revize → úkoly" (human-in-the-loop).
 */
import { useQuery as usePsQuery } from "@powersync/react";
import i18n from "@watson/i18n";
import { AvatarGroup } from "@watson/ui";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { pillStyle } from "../components/filterUi";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { logTaskActivity } from "../lib/activity";
import { initials } from "../lib/format";
import { useAllMembers } from "../lib/overview";
import type { ProjectRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useTaskDetail } from "../lib/taskDetail";
import { todayISO } from "../lib/tasks";
import { showToast } from "../lib/toast";
import { useWorkspace } from "../lib/workspace";

interface Proposal {
	title: string;
	note?: string | null;
	assigneeUserId?: string | null;
	assigneeHint?: string | null;
	priority?: number | null;
	due?: string | null;
	projectHint?: string | null;
	parentIndex?: number | null;
}
interface Editable extends Proposal {
	keep: boolean;
}
/** Kotevní úkol porady + status sidecaru (LEFT JOIN meetings). */
type HubMeet = TaskRow & { m_status: string | null };
/** Skupiny přehledu dle termínu. */
const BUCKETS = ["Dnes", "Zítra", "Tento týden", "Později", "Proběhlé"] as const;
type Bucket = (typeof BUCKETS)[number];

const CARD: CSSProperties = {
	background: "var(--w-card)",
	border: "1px solid var(--w-line)",
	borderRadius: 13,
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
const BTN_PRIMARY: CSSProperties = {
	fontFamily: "var(--w-font-display)",
	fontWeight: 600,
	fontSize: 13,
	color: "#fff",
	background: "var(--w-brass)",
	border: "none",
	borderRadius: 9,
	padding: "9px 18px",
	cursor: "pointer",
};
const BTN_GHOST: CSSProperties = {
	fontFamily: "var(--w-font-display)",
	fontWeight: 600,
	fontSize: 13,
	color: "var(--w-ink-2)",
	background: "transparent",
	border: "1px solid var(--w-line)",
	borderRadius: 9,
	padding: "9px 16px",
	cursor: "pointer",
};
/** Pilulka volby (účastník, délka) — SDÍLENÝ primitiv (filterUi), ne lokální kopie. */
const pill = (on: boolean): CSSProperties => pillStyle(on, 11.5);
/** Kompaktní varianta vstupu (selecty/datum/čas ve formulářích). */
const INPUT_SM: CSSProperties = { width: "auto", padding: "6px 8px" };

const PRIO = [
	{ v: 1, l: "P1" },
	{ v: 2, l: "P2" },
	{ v: 3, l: "P3" },
	{ v: 4, l: "P4" },
];
const DURATIONS = [30, 45, 60, 90, 120];

/** Stav porady pro badge v přehledu (sidecar status × termín × dokončení hubu). */
function meetState(m: HubMeet, today: string): { label: string; kind: "brass" | "muted" | "ok" } {
	const day = (m.due_date ?? m.start_date ?? "").slice(0, 10);
	if (m.m_status === "committed") return { label: "zpracováno", kind: "ok" };
	if (m.m_status === "extracted") return { label: "návrhy čekají", kind: "brass" };
	if (m.m_status === "transcribed") return { label: "přepis vložen", kind: "brass" };
	if (m.completed_at) return { label: "proběhlo", kind: "muted" };
	if (day && day < today) return { label: "čeká na zápis", kind: "brass" };
	return { label: "naplánováno", kind: "muted" };
}

/** Lidský nadpis dne pro řádek meetu („po 14. 7.") — jazyk dle i18n, ne natvrdo cs. */
function dayLabel(iso: string): string {
	const [y, mo, d] = iso.split("-").map(Number);
	if (!y || !mo || !d) return iso;
	return new Intl.DateTimeFormat(i18n.language, {
		weekday: "short",
		day: "numeric",
		month: "numeric",
	}).format(new Date(y, mo - 1, d));
}

export function Mitingy() {
	const { activeWs } = useWorkspace();
	const { data: session } = useSession();
	const uid = session?.user?.id;
	const members = useAllMembers();
	const memberList = [...members].map(([id, name]) => ({ id, name }));
	const { open: openTask } = useTaskDetail();
	const { data: allProjects } = usePsQuery<ProjectRow>(
		"SELECT id, name, workspace_id FROM projects WHERE archived_at IS NULL ORDER BY created_at",
	);
	// Jen projekty AKTIVNÍHO prostoru — úkoly z mítingu patří do týmu porady a
	// přiřazení řešitelů (členů prostoru) jinak selže na R5 (nejsou členy cizího projektu).
	const projects = (allProjects ?? []).filter((p) => p.workspace_id === activeWs);
	// Výchozí = první „skutečný" projekt prostoru; osobní Inbox až jako fallback.
	const inbox = projects.find((p) => p.name !== "Doručené" && p.name !== "Inbox") ?? projects[0];

	const [mode, setMode] = useState<"list" | "plan" | "new" | "review">("list");
	const [title, setTitle] = useState("");
	const [transcript, setTranscript] = useState("");
	const [proposals, setProposals] = useState<Editable[]>([]);
	const [meetingId, setMeetingId] = useState<string | null>(null);
	const [projectId, setProjectId] = useState<string>("");
	const [busy, setBusy] = useState(false);
	const [wasMock, setWasMock] = useState(false);

	// ── Naplánovat meet (Fáze 1) — formulář kotevního úkolu ──
	const [pTitle, setPTitle] = useState("");
	const [pProject, setPProject] = useState("");
	const [pDate, setPDate] = useState(todayISO);
	const [pTime, setPTime] = useState("10:00");
	const [pDur, setPDur] = useState(60);
	const [pWho, setPWho] = useState<Record<string, boolean>>({});

	useEffect(() => {
		if (inbox && !projectId) setProjectId(inbox.id);
		// pProject se nastavuje v openPlan (reset per prostor — audit Fáze 1)
	}, [inbox?.id, projectId, pProject]);

	// ── Přehled dle termínů — LOKÁLNÍ read model (offline; P1-04 pryč) ──
	// Dotazy ŘÍDÍ malá tabulka meetings (index by_workspace) → žádný full-scan tasks
	// dle kind na každou změnu (audit Fáze 1: kind nemá index; tasks je hot tabulka).
	const { data: hubMeets, isLoading: hubLoading } = usePsQuery<HubMeet>(
		`SELECT t.*, m.status AS m_status
		 FROM meetings m
		 JOIN tasks t ON t.id = m.hub_task_id
		 WHERE m.workspace_id = ?
		 ORDER BY t.due_date IS NULL, t.due_date, t.start_date`,
		[activeWs ?? ""],
	);
	// Porady bez lokálního hub-úkolu: starý tok „Vložit přepis" (hub_task_id NULL) i porady
	// z projektů, kde nejsem člen (hub se mi nesyncuje) — ať nezmizí beze stopy (audit Fáze 1).
	const { data: detachedMeets, isLoading: detachedLoading } = usePsQuery<{
		id: string;
		title: string | null;
		status: string;
		created_at: string | null;
		hub_task_id: string | null;
	}>(
		`SELECT m.id, m.title, m.status, m.created_at, m.hub_task_id
		 FROM meetings m LEFT JOIN tasks t ON t.id = m.hub_task_id
		 WHERE m.workspace_id = ? AND t.id IS NULL
		 ORDER BY m.created_at DESC`,
		[activeWs ?? ""],
	);
	// Progres přípravy (podúkoly hubů) + účastníci — scoped přes meetings, ne celá DB.
	const { data: subRows } = usePsQuery<{ parent_id: string; n: number; d: number }>(
		`SELECT parent_id, COUNT(*) AS n, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS d
		 FROM tasks
		 WHERE parent_id IN (SELECT hub_task_id FROM meetings WHERE workspace_id = ? AND hub_task_id IS NOT NULL)
		 GROUP BY parent_id`,
		[activeWs ?? ""],
	);
	const { data: asgRows } = usePsQuery<{ task_id: string; user_id: string }>(
		`SELECT a.task_id, a.user_id
		 FROM meetings m JOIN assignments a ON a.task_id = m.hub_task_id
		 WHERE m.workspace_id = ?`,
		[activeWs ?? ""],
	);
	// CC-P0-01 — „Zatím žádný meet" je obchodní tvrzení: renderovat až po dojezdu dotazů.
	const listReady = !hubLoading && !detachedLoading;
	const subMap = useMemo(() => {
		const m = new Map<string, { n: number; d: number }>();
		for (const r of subRows ?? []) m.set(r.parent_id, { n: r.n, d: r.d });
		return m;
	}, [subRows]);
	const asgMap = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const r of asgRows ?? []) m.set(r.task_id, [...(m.get(r.task_id) ?? []), r.user_id]);
		return m;
	}, [asgRows]);

	// Účastníci formuláře = ČLENOVÉ zvoleného projektu (R5 — jiné přiřadit nejde).
	const { data: pmRows } = usePsQuery<{ user_id: string }>(
		"SELECT user_id FROM project_members WHERE project_id = ?",
		[pProject || ""],
	);
	const planMembers = (pmRows ?? [])
		.map((r) => ({ id: r.user_id, name: members.get(r.user_id) ?? "…" }))
		.sort((a, b) => a.name.localeCompare(b.name, "cs"));
	// Moje role per projekt — meet smím založit jen tam, kde jsem editor+ (server by
	// commenterovi tasks/assignments odmítl a nechal osiřelý sidecar — audit Fáze 1).
	const { data: myRoleRows } = usePsQuery<{ project_id: string; role: string | null }>(
		"SELECT project_id, role FROM project_members WHERE user_id = ?",
		[uid ?? ""],
	);
	const editableProjects = useMemo(() => {
		const rank: Record<string, number> = { commenter: 1, editor: 2, manager: 3 };
		const mine = new Map((myRoleRows ?? []).map((r) => [r.project_id, r.role ?? ""]));
		return projects.filter((p) => (rank[mine.get(p.id) ?? ""] ?? 0) >= 2);
	}, [projects, myRoleRows]);

	const today = todayISO();
	/** Skupiny přehledu: Dnes / Zítra / Tento týden / Později / Proběhlé. */
	const groups = useMemo(() => {
		const g: Record<Bucket, HubMeet[]> = {
			Dnes: [],
			Zítra: [],
			"Tento týden": [],
			Později: [],
			Proběhlé: [],
		};
		// LOKÁLNÍ půlnoc (`T00:00:00`), ne bare `new Date(iso)` = UTC — jinak se den kolem
		// půlnoci/DST zařadí jinak než v Nadcházejících (audit Fáze 1).
		const t0 = new Date(`${today}T00:00:00`).getTime();
		for (const m of hubMeets ?? []) {
			const day = (m.due_date ?? m.start_date ?? "").slice(0, 10);
			if (!day) {
				g.Později.push(m);
				continue;
			}
			const diff = Math.round((new Date(`${day}T00:00:00`).getTime() - t0) / 86_400_000);
			if (m.completed_at || diff < 0) g.Proběhlé.push(m);
			else if (diff === 0) g.Dnes.push(m);
			else if (diff === 1) g.Zítra.push(m);
			else if (diff <= 7) g["Tento týden"].push(m);
			else g.Později.push(m);
		}
		g.Proběhlé.reverse(); // nejčerstvější proběhlé nahoru
		return g;
	}, [hubMeets, today]);

	const openPlan = () => {
		setPTitle("");
		setPDate(todayISO());
		setPTime("10:00");
		setPDur(60);
		setPWho(uid ? { [uid]: true } : {});
		// Projekt vždy z AKTUÁLNÍHO prostoru — stale pProject po přepnutí workspace by
		// rozpůlil zápis mezi dva prostory (audit Fáze 1). Jen projekty s rolí editor+.
		const def =
			editableProjects.find((p) => p.id === pProject) ??
			editableProjects.find((p) => p.id === inbox?.id) ??
			editableProjects[0];
		setPProject(def?.id ?? "");
		setMode("plan");
	};

	/** Založí meet = kotevní úkol + sidecar + účastníci v JEDNÉ lokální transakci (CC-P0-07). */
	async function planCreate() {
		const name = pTitle.trim();
		if (!name || !pProject || !pDate || !pTime || !uid || !activeWs) {
			showToast("Doplň název, projekt, datum a čas.");
			return;
		}
		// Guard proti stale projektu z jiného prostoru (audit Fáze 1 — split write).
		if (!editableProjects.some((p) => p.id === pProject)) {
			showToast("Vyber projekt aktuálního prostoru.");
			return;
		}
		// R5 — přiřadit jde jen členy projektu; výběr mimo aktuální projekt zahoď.
		const who = planMembers.filter((m) => pWho[m.id]).map((m) => m.id);
		// Meet bez jediného účastníka by nikomu nesurfacoval (a pmRows mohl ještě načítat).
		if (who.length === 0) {
			showToast("Vyber aspoň jednoho účastníka.");
			return;
		}
		setBusy(true);
		try {
			const meetId = crypto.randomUUID();
			const taskId = crypto.randomUUID();
			const now = new Date().toISOString();
			const startIso = `${pDate}T${pTime}:00`;
			await powerSync.writeTransaction(async (tx) => {
				await tx.execute(
					`INSERT INTO tasks (id, project_id, name, priority, due_date, start_date, duration_min,
					   assignment_mode, kind, meeting_id, created_by, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[taskId, pProject, name, 4, pDate, startIso, pDur, "single", "meeting", meetId, uid, now],
				);
				await tx.execute(
					`INSERT INTO meetings (id, workspace_id, title, status, hub_task_id, created_by, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[meetId, activeWs, name, "scheduled", taskId, uid, now],
				);
				for (const w of who) {
					await tx.execute(
						"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)",
						[crypto.randomUUID(), taskId, pProject, w, now],
					);
				}
			});
			void logTaskActivity(taskId, pProject, uid, "created", null, "meet");
			// Bez slibů o viditelnosti ostatním — zápis je zatím jen lokální (0.4: úspěch
			// až po potvrzení autoritativním systémem; sync běží na pozadí).
			showToast(`Meet naplánován na ${dayLabel(pDate)} ${pTime}.`);
			setMode("list");
		} catch {
			showToast("Naplánování meetu selhalo.");
		} finally {
			setBusy(false);
		}
	}

	async function extract() {
		if (transcript.trim().length < 10 || !activeWs) return;
		setBusy(true);
		try {
			const r = await fetch(`${API_URL}/api/meetings/extract`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workspaceId: activeWs, title, transcript }),
			});
			if (!r.ok) throw new Error("extract");
			const j = await r.json();
			setProposals((j.proposals ?? []).map((p: Proposal) => ({ ...p, keep: true })));
			setMeetingId(j.meetingId ?? null);
			setWasMock(!!j.mock);
			setMode("review");
		} catch {
			showToast("Extrakce se nezdařila — zkus to znovu.");
		} finally {
			setBusy(false);
		}
	}

	function patchProposal(i: number, patch: Partial<Editable>) {
		setProposals((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
	}

	async function commit() {
		if (!projectId || !session?.user?.id) {
			showToast("Vyber projekt.");
			return;
		}
		setBusy(true);
		try {
			const idByIndex: Record<number, string> = {};
			let created = 0;
			for (let i = 0; i < proposals.length; i++) {
				const p = proposals[i];
				if (!p || !p.keep || !p.title.trim()) continue;
				const taskId = crypto.randomUUID();
				idByIndex[i] = taskId;
				const parentId =
					p.parentIndex != null && idByIndex[p.parentIndex] ? idByIndex[p.parentIndex] : null;
				await powerSync.execute(
					`INSERT INTO tasks (id, project_id, parent_id, name, priority, due_date, assignment_mode, created_by, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						taskId,
						projectId,
						parentId,
						p.title.trim(),
						p.priority ?? 3,
						p.due ?? null,
						"single",
						uid,
						new Date().toISOString(),
					],
				);
				void logTaskActivity(taskId, projectId, uid, "created", null, "porada");
				if (p.assigneeUserId) {
					await powerSync.execute(
						"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)",
						[crypto.randomUUID(), taskId, projectId, p.assigneeUserId, new Date().toISOString()],
					);
				}
				created++;
			}
			if (meetingId) {
				await fetch(`${API_URL}/api/meetings/${meetingId}/commit`, {
					method: "POST",
					credentials: "include",
				}).catch(() => {});
			}
			showToast(`Vytvořeno ${created} úkolů z porady.`);
			setMode("list");
			setTitle("");
			setTranscript("");
			setProposals([]);
			setMeetingId(null);
		} catch {
			showToast("Vytvoření úkolů selhalo.");
		} finally {
			setBusy(false);
		}
	}

	const keepCount = proposals.filter((p) => p.keep).length;
	const hasAny = (hubMeets ?? []).length > 0 || (detachedMeets ?? []).length > 0;

	return (
		<div style={{ maxWidth: 820, margin: "0 auto", padding: "22px 20px 60px" }}>
			<div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
				<h1
					className="font-display"
					style={{ fontWeight: 800, fontSize: 24, color: "var(--w-ink)", margin: 0 }}
				>
					Meets
				</h1>
				{mode === "list" && (
					<div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
						<button type="button" style={BTN_GHOST} onClick={() => setMode("new")}>
							Vložit přepis
						</button>
						<button type="button" style={BTN_PRIMARY} onClick={openPlan}>
							+ Naplánovat meet
						</button>
					</div>
				)}
			</div>
			<p
				className="font-body"
				style={{ fontSize: 13, color: "var(--w-ink-3)", margin: "0 0 20px" }}
			>
				Každý meet je zároveň úkol s termínem — účastníci ho uvidí v Dnes, Nadcházejících i
				kalendáři. Příprava = podúkoly meetu; po poradě vlož přepis a AI vytáhne akční body.
			</p>

			{/* ── PŘEHLED DLE TERMÍNŮ ── */}
			{mode === "list" && (
				<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
					{listReady && !hasAny && (
						<div style={{ ...CARD, padding: "28px 18px", textAlign: "center" }}>
							<div className="font-body" style={{ color: "var(--w-ink-3)", fontSize: 13.5 }}>
								Zatím žádný meet. „+ Naplánovat meet" založí poradu jako úkol s termínem — nebo
								rovnou vlož přepis proběhlé schůzky.
							</div>
						</div>
					)}
					{BUCKETS.map((bucket) => {
						const rows = groups[bucket];
						if (rows.length === 0) return null;
						return (
							<div key={bucket}>
								<div className="font-display" style={{ ...LABEL, fontSize: 11, marginBottom: 7 }}>
									{bucket}{" "}
									<span style={{ color: "var(--w-ink-3)", fontWeight: 400 }}>· {rows.length}</span>
								</div>
								<div style={{ ...CARD, overflow: "hidden" }}>
									{rows.map((m) => {
										const st = meetState(m, today);
										const day = (m.due_date ?? m.start_date ?? "").slice(0, 10);
										const time = m.start_date?.slice(11, 16) ?? "";
										const sub = subMap.get(m.id);
										const who = asgMap.get(m.id) ?? [];
										const proj = projects.find((p) => p.id === m.project_id);
										return (
											<button
												key={m.id}
												type="button"
												onClick={() => openTask(m.id)}
												className="hover:bg-panel-2"
												style={{
													display: "flex",
													alignItems: "center",
													gap: 12,
													width: "100%",
													textAlign: "left",
													background: "transparent",
													border: "none",
													borderBottom: "1px solid var(--w-line)",
													padding: "12px 14px",
													cursor: "pointer",
												}}
											>
												{/* termín (mono) — den + čas */}
												<span
													className="font-mono"
													style={{
														flex: "none",
														width: 96,
														fontSize: 11.5,
														color: st.kind === "brass" ? "var(--w-brass-text)" : "var(--w-ink-2)",
													}}
												>
													{day ? dayLabel(day) : "—"}
													{time && time !== "00:00" ? ` ${time}` : ""}
												</span>
												<div style={{ minWidth: 0, flex: 1 }}>
													<div
														className="font-display"
														style={{
															fontWeight: 700,
															fontSize: 14,
															color: "var(--w-ink)",
															overflow: "hidden",
															textOverflow: "ellipsis",
															whiteSpace: "nowrap",
														}}
													>
														{m.name}
													</div>
													<div
														className="font-body"
														style={{ fontSize: 11.5, color: "var(--w-ink-3)", marginTop: 2 }}
													>
														{proj?.name ?? ""}
														{m.duration_min ? ` · ${m.duration_min} min` : ""}
														{sub ? ` · příprava ${sub.d}/${sub.n}` : " · bez přípravy"}
													</div>
												</div>
												{/* stav */}
												<span
													className="font-display"
													style={{
														flex: "none",
														fontWeight: 600,
														fontSize: 10.5,
														padding: "3px 9px",
														borderRadius: 999,
														background:
															st.kind === "ok"
																? "var(--w-success-soft)"
																: st.kind === "brass"
																	? "var(--w-brass-soft)"
																	: "var(--w-panel-2)",
														color:
															st.kind === "ok"
																? "var(--w-success-ink)"
																: st.kind === "brass"
																	? "var(--w-brass-text)"
																	: "var(--w-ink-2)",
													}}
												>
													{st.label}
												</span>
												{/* účastníci — sdílený AvatarGroup (packages/ui), ne lokální kopie stacku */}
												{who.length > 0 && (
													<span style={{ flex: "none" }}>
														<AvatarGroup
															people={who.map((id) => initials(members.get(id) ?? "?"))}
														/>
													</span>
												)}
											</button>
										);
									})}
								</div>
							</div>
						);
					})}

					{/* Přepisy bez kotvy — starý tok; propojí je Fáze 3 */}
					{(detachedMeets ?? []).length > 0 && (
						<div>
							<div className="font-display" style={{ ...LABEL, fontSize: 11, marginBottom: 7 }}>
								Přepisy bez termínu
							</div>
							<div style={{ ...CARD, overflow: "hidden" }}>
								{(detachedMeets ?? []).map((m) => (
									<div
										key={m.id}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 12,
											padding: "12px 14px",
											borderBottom: "1px solid var(--w-line)",
										}}
									>
										<div style={{ minWidth: 0, flex: 1 }}>
											<div
												className="font-display"
												style={{ fontWeight: 700, fontSize: 14, color: "var(--w-ink)" }}
											>
												{m.title || "Porada bez názvu"}
											</div>
											<div
												className="font-body"
												style={{ fontSize: 11.5, color: "var(--w-ink-3)", marginTop: 2 }}
											>
												{m.status === "committed" ? "zpracováno" : "návrh"} ·{" "}
												{m.hub_task_id
													? "porada z projektu, kde nejsi člen"
													: "jen přepis (bez termínu)"}
											</div>
										</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{/* ── NAPLÁNOVAT MEET (Fáze 1 — kotevní úkol s termínem) ── */}
			{mode === "plan" && (
				<div
					style={{
						...CARD,
						padding: "18px 18px 20px",
						display: "flex",
						flexDirection: "column",
						gap: 14,
					}}
				>
					<div>
						<div style={{ ...LABEL, marginBottom: 6 }}>Název porady</div>
						<input
							value={pTitle}
							onChange={(e) => setPTitle(e.target.value)}
							placeholder="např. Provozní porada"
							style={INPUT}
						/>
					</div>
					<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
						<div>
							<div style={{ ...LABEL, marginBottom: 6 }}>Projekt</div>
							<select
								value={pProject}
								onChange={(e) => setPProject(e.target.value)}
								style={{ ...INPUT, ...INPUT_SM }}
							>
								{editableProjects.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</select>
						</div>
						<div>
							<div style={{ ...LABEL, marginBottom: 6 }}>Datum</div>
							<input
								type="date"
								value={pDate}
								onChange={(e) => setPDate(e.target.value)}
								style={{ ...INPUT, ...INPUT_SM }}
							/>
						</div>
						<div>
							<div style={{ ...LABEL, marginBottom: 6 }}>Čas</div>
							<input
								type="time"
								value={pTime}
								onChange={(e) => setPTime(e.target.value)}
								style={{ ...INPUT, ...INPUT_SM }}
							/>
						</div>
						<div>
							<div style={{ ...LABEL, marginBottom: 6 }}>Délka</div>
							<div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
								{DURATIONS.map((d) => (
									<button key={d} type="button" onClick={() => setPDur(d)} style={pill(pDur === d)}>
										{d} min
									</button>
								))}
							</div>
						</div>
					</div>
					<div>
						<div style={{ ...LABEL, marginBottom: 6 }}>
							Účastníci{" "}
							<span style={{ textTransform: "none", letterSpacing: 0 }}>
								— členové projektu; uvidí termín v Dnes/Nadcházejících
							</span>
						</div>
						<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
							{planMembers.length === 0 && (
								<span className="font-body" style={{ fontSize: 12, color: "var(--w-ink-3)" }}>
									Projekt nemá žádné členy.
								</span>
							)}
							{planMembers.map((m) => (
								<button
									key={m.id}
									type="button"
									onClick={() => setPWho((w) => ({ ...w, [m.id]: !w[m.id] }))}
									style={pill(!!pWho[m.id])}
								>
									{m.name}
									{m.id === uid ? " (ty)" : ""}
								</button>
							))}
						</div>
					</div>
					<div style={{ display: "flex", gap: 10 }}>
						<button
							type="button"
							style={{ ...BTN_PRIMARY, opacity: busy || !pTitle.trim() ? 0.5 : 1 }}
							disabled={busy || !pTitle.trim()}
							onClick={() => void planCreate()}
						>
							{busy ? "Zakládám…" : "Naplánovat meet"}
						</button>
						<button type="button" style={BTN_GHOST} onClick={() => setMode("list")}>
							Zpět
						</button>
					</div>
					<div className="font-body" style={{ fontSize: 11.5, color: "var(--w-ink-3)" }}>
						Meet vznikne jako úkol porady — přípravu přidáš jako jeho podúkoly v detailu; přepis a
						akční body doplníš po schůzce.
					</div>
				</div>
			)}

			{/* ── NOVÝ PŘEPIS ── */}
			{mode === "new" && (
				<div
					style={{
						...CARD,
						padding: "18px 18px 20px",
						display: "flex",
						flexDirection: "column",
						gap: 14,
					}}
				>
					<div>
						<div style={{ ...LABEL, marginBottom: 6 }}>Název (volitelně)</div>
						<input
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="např. Provozní porada 12. 7."
							style={INPUT}
						/>
					</div>
					<div>
						<div style={{ ...LABEL, marginBottom: 6 }}>Přepis schůzky</div>
						<textarea
							value={transcript}
							onChange={(e) => setTranscript(e.target.value)}
							placeholder="Vlož text z porady — kdo co má udělat, termíny, priority…"
							rows={12}
							style={{ ...INPUT, resize: "vertical", lineHeight: 1.5 }}
						/>
					</div>
					<div style={{ display: "flex", gap: 10 }}>
						<button
							type="button"
							style={{ ...BTN_PRIMARY, opacity: busy || transcript.trim().length < 10 ? 0.5 : 1 }}
							disabled={busy || transcript.trim().length < 10}
							onClick={() => void extract()}
						>
							{busy ? "Zpracovávám…" : "Vytáhnout úkoly →"}
						</button>
						<button type="button" style={BTN_GHOST} onClick={() => setMode("list")}>
							Zpět
						</button>
					</div>
				</div>
			)}

			{/* ── REVIZE NÁVRHŮ ── */}
			{mode === "review" && (
				<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
						<span className="font-body" style={{ fontSize: 13, color: "var(--w-ink-2)" }}>
							Návrh <b>{keepCount}</b> úkolů{" "}
							{wasMock && (
								<span style={{ color: "var(--w-ink-3)" }}>· ukázkový režim (bez AI klíče)</span>
							)}
						</span>
						<div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
							<span style={LABEL}>Projekt</span>
							<select
								value={projectId}
								onChange={(e) => setProjectId(e.target.value)}
								style={{ ...INPUT, ...INPUT_SM }}
							>
								{(projects ?? []).map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</select>
						</div>
					</div>

					{proposals.map((p, i) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: pořadí návrhů je stabilní v rámci revize
							key={i}
							style={{
								...CARD,
								padding: "12px 14px",
								marginLeft: p.parentIndex != null ? 24 : 0,
								opacity: p.keep ? 1 : 0.5,
								display: "flex",
								gap: 11,
							}}
						>
							<input
								type="checkbox"
								checked={p.keep}
								onChange={(e) => patchProposal(i, { keep: e.target.checked })}
								style={{ marginTop: 9, flex: "none", accentColor: "var(--w-brass)" }}
								aria-label="Vytvořit tento úkol"
							/>
							<div
								style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 8 }}
							>
								<input
									value={p.title}
									onChange={(e) => patchProposal(i, { title: e.target.value })}
									style={{ ...INPUT, fontWeight: 600 }}
								/>
								<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
									<select
										value={p.assigneeUserId ?? ""}
										onChange={(e) => patchProposal(i, { assigneeUserId: e.target.value || null })}
										style={{ ...INPUT, ...INPUT_SM }}
									>
										<option value="">— nikdo —</option>
										{memberList.map((m) => (
											<option key={m.id} value={m.id}>
												{m.name}
											</option>
										))}
									</select>
									<select
										value={p.priority ?? ""}
										onChange={(e) =>
											patchProposal(i, { priority: e.target.value ? Number(e.target.value) : null })
										}
										style={{ ...INPUT, ...INPUT_SM }}
									>
										<option value="">— priorita —</option>
										{PRIO.map((pr) => (
											<option key={pr.v} value={pr.v}>
												{pr.l}
											</option>
										))}
									</select>
									<input
										type="date"
										value={p.due ?? ""}
										onChange={(e) => patchProposal(i, { due: e.target.value || null })}
										style={{ ...INPUT, ...INPUT_SM }}
									/>
								</div>
								{p.assigneeHint && !p.assigneeUserId && (
									<div className="font-body" style={{ fontSize: 11, color: "var(--w-ink-3)" }}>
										AI navrhla: {p.assigneeHint} (nenalezen v týmu — vyber ručně)
									</div>
								)}
							</div>
						</div>
					))}

					<div style={{ display: "flex", gap: 10, marginTop: 4 }}>
						<button
							type="button"
							style={{ ...BTN_PRIMARY, opacity: busy || keepCount === 0 ? 0.5 : 1 }}
							disabled={busy || keepCount === 0}
							onClick={() => void commit()}
						>
							{busy ? "Vytvářím…" : `Vytvořit ${keepCount} úkolů`}
						</button>
						<button type="button" style={BTN_GHOST} onClick={() => setMode("new")}>
							Zpět k přepisu
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
