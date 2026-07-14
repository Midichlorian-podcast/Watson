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
import { type CSSProperties, useEffect, useMemo, useState } from "react";
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
	assigneeUserId?: string | null;
	assigneeHint?: string | null;
	priority?: number | null;
	due?: string | null;
}
interface Editable extends Proposal {
	keep: boolean;
}
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
	const prep = (subRows ?? []).filter((s) => !derived.has(s.id));
	// Akční body DLE LINEAGE — bod přesunutý carryoverem zůstává v historii porady.
	const { data: actionRows, isLoading: actLoading } = usePsQuery<TaskRow>(
		`SELECT t.* FROM entity_links el JOIN tasks t ON t.id = el.to_id
		 WHERE el.from_type = 'meeting' AND el.from_id = ? AND el.relation = 'derived_from'
		 ORDER BY t.completed_at IS NOT NULL, t.created_at`,
		[meetingId],
	);
	const actions = actionRows ?? [];
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
	// Členové projektu hubu — validace řešitelů akčních bodů (R5).
	const { data: pmRows } = usePsQuery<{ user_id: string }>(
		"SELECT user_id FROM project_members WHERE project_id = ?",
		[hub?.project_id ?? ""],
	);
	const projMembers = useMemo(() => new Set((pmRows ?? []).map((r) => r.user_id)), [pmRows]);
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
	useEffect(() => {
		let live = true;
		(async () => {
			try {
				const r = await fetch(`${API_URL}/api/meetings/${meetingId}`, { credentials: "include" });
				if (!r.ok) throw new Error("meeting");
				const j = await r.json();
				if (!live) return;
				// server plní jen autoritativní kopii; rozepsaný draft zůstává nedotčený
				if (typeof j.meeting?.transcript === "string" && j.meeting.transcript)
					setSaved(j.meeting.transcript);
				setServerLoaded("ok");
			} catch {
				if (live) setServerLoaded("offline");
			}
		})();
		return () => {
			live = false;
		};
	}, [meetingId]);

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
			setProposals((j.proposals ?? []).map((p: Proposal) => ({ ...p, keep: true })));
			setWasMock(!!j.mock);
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
			setSaved(text);
			setEditing(false);
			showToast("Zápis uložen.");
		} catch {
			showToast("Uložení zápisu selhalo — vyžaduje připojení.");
		} finally {
			setBusy(false);
		}
	}

	// Nepropojené akční body (commit lineage selhal/offline) — retry přes server (idempotentní).
	const [pendingLink, setPendingLink] = useState<string[] | null>(null);
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

	/** Akční body = PODÚKOLY hubu; lineage (entity_links) zapisuje server v /commit. */
	async function commitActions() {
		if (!proposals || !hub || !uid) return;
		const chosen = proposals.filter((p) => p.keep && p.title.trim());
		if (chosen.length === 0) return;
		setBusy(true);
		try {
			const now = new Date().toISOString();
			const taskIds: string[] = [];
			await powerSync.writeTransaction(async (tx) => {
				for (const p of chosen) {
					const tid = crypto.randomUUID();
					taskIds.push(tid);
					await tx.execute(
						`INSERT INTO tasks (id, project_id, parent_id, name, priority, due_date, assignment_mode, created_by, created_at)
						 VALUES (?, ?, ?, ?, ?, ?, 'single', ?, ?)`,
						[tid, hub.project_id, hubId, p.title.trim(), p.priority ?? 3, p.due ?? null, uid, now],
					);
					// R5 — řešitel jen člen projektu hubu; jiného vynech (doplní člověk v detailu).
					if (p.assigneeUserId && projMembers.has(p.assigneeUserId)) {
						await tx.execute(
							"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (uuid(), ?, ?, ?, ?)",
							[tid, hub.project_id, p.assigneeUserId, now],
						);
					}
				}
			});
			for (const tid of taskIds)
				void logTaskActivity(tid, hub.project_id, uid, "created", null, "meet");
			// Poctivě (0.4): úspěch hlásíme jen po OK; jinak nabídneme retry — nic „samo".
			const linked = await linkToServer(taskIds);
			if (linked) {
				showToast(`Založeno ${taskIds.length} akčních bodů porady.`);
				setPendingLink(null);
			} else {
				setPendingLink(taskIds);
				showToast(
					`Akční body (${taskIds.length}) založeny, ale propojení s poradou selhalo — zkus „Propojit znovu" při připojení.`,
				);
			}
			setProposals(null);
		} finally {
			setBusy(false);
		}
	}

	// ── řetěz: navazující meet + carryover = PŘESUN nedodělků ──
	async function followUp() {
		if (!hub || !uid || !meta?.workspace_id) return;
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
						{/* AI revize návrhů — objeví se tady po extrakci (mockup: „návrhy vlevo") */}
						{proposals && (
							<div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 10 }}>
								<div className="font-body" style={{ fontSize: 12, color: "var(--w-ink-3)" }}>
									Návrhy ze zápisu{wasMock ? " · ukázkový režim (bez AI klíče)" : ""} — uprav,
									odškrtni nechtěné a založ:
								</div>
								{proposals.map((p, i) => (
									<div
										// biome-ignore lint/suspicious/noArrayIndexKey: stabilní v rámci revize
										key={i}
										style={{
											display: "flex",
											gap: 8,
											alignItems: "center",
											opacity: p.keep ? 1 : 0.5,
										}}
									>
										<input
											type="checkbox"
											checked={p.keep}
											onChange={(e) =>
												setProposals((ps) =>
													(ps ?? []).map((x, xi) =>
														xi === i ? { ...x, keep: e.target.checked } : x,
													),
												)
											}
											style={{ accentColor: "var(--w-brass)", flex: "none" }}
											aria-label="Založit tento akční bod"
										/>
										<input
											value={p.title}
											onChange={(e) =>
												setProposals((ps) =>
													(ps ?? []).map((x, xi) =>
														xi === i ? { ...x, title: e.target.value } : x,
													),
												)
											}
											style={{ ...INPUT, fontWeight: 600 }}
										/>
										<span
											className="font-body"
											style={{
												fontSize: 11,
												color: "var(--w-ink-3)",
												flex: "none",
												width: 105,
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}
											title={
												p.assigneeUserId
													? (members.get(p.assigneeUserId) ?? "")
													: (p.assigneeHint ?? "")
											}
										>
											{p.assigneeUserId
												? (members.get(p.assigneeUserId) ?? "—")
												: (p.assigneeHint ?? "— nikdo —")}
										</span>
									</div>
								))}
								<div style={{ display: "flex", gap: 8 }}>
									<button
										type="button"
										style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}
										disabled={busy}
										onClick={() => void commitActions()}
									>
										Založit {proposals.filter((p) => p.keep && p.title.trim()).length} akčních bodů
									</button>
									<button type="button" style={BTN_GHOST} onClick={() => setProposals(null)}>
										Zahodit návrhy
									</button>
								</div>
							</div>
						)}
						{pendingLink && (
							<button
								type="button"
								style={{ ...BTN_GHOST, color: "var(--w-brass-text)", marginBottom: 8 }}
								onClick={() =>
									void linkToServer(pendingLink).then((ok) => {
										if (ok) {
											setPendingLink(null);
											showToast("Akční body propojeny s poradou.");
										} else showToast("Propojení zatím selhalo — zkus to při připojení.");
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
								moved={s.parent_id !== hubId}
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
	moved,
	onToggle,
	onOpen,
}: {
	t: TaskRow;
	names: string[];
	/** Bod už žije pod navazující poradou (carryover) — informační chip. */
	moved?: boolean;
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
			{moved && (
				<span
					className="font-mono"
					title="Nedodělek přesunutý do navazující porady"
					style={{
						fontSize: 9.5,
						color: "var(--w-brass-text)",
						background: "var(--w-brass-soft)",
						borderRadius: 999,
						padding: "2px 8px",
						flex: "none",
					}}
				>
					→ přeneseno dál
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
