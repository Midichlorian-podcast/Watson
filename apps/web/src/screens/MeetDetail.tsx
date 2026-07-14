/**
 * Detail meetu (Fáze 2+3 plánu Meets) — překryvná karta se záložkami:
 * Přehled (termín/účastníci/akce) · Příprava (podúkoly hubu) · Přepis & akční body
 * (server-only obsah přes API; AI návrhy → PODÚKOLY hubu + lineage entity_links
 * zapisuje SERVER v /commit) · Řetěz (série porad, navazující meet s carryoverem).
 * Termín/příprava/účastníci žijí na hub-úkolu (offline); přepis je on-demand
 * (CC-P0-13: obsah se plošně nesyncuje — participant ACL bucket je follow-up).
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

const TABS = [
	["prehled", "Přehled"],
	["priprava", "Příprava"],
	["prepis", "Přepis & akční body"],
	["retez", "Řetěz"],
] as const;
type Tab = (typeof TABS)[number][0];

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

const dayLbl = (iso: string) => shortDayLabel(iso, i18n.language);

/** Detail meetu — overlay; `meetingId` = sidecar, `hubId` = kotevní úkol. */
export function MeetDetail({
	meetingId,
	hubId,
	onClose,
	onOpenMeet,
}: {
	meetingId: string;
	hubId: string;
	onClose: () => void;
	/** Přepnutí na jiný meet v řetězu (naviguje uvnitř overlaye). */
	onOpenMeet: (meetingId: string, hubId: string) => void;
}) {
	const { data: session } = useSession();
	const uid = session?.user?.id;
	const members = useAllMembers();
	const { open: openTask } = useTaskDetail();
	const [tab, setTab] = useState<Tab>("prehled");
	const [busy, setBusy] = useState(false);

	// ── lokální data (offline) ──
	const { data: hubRows } = usePsQuery<TaskRow>("SELECT * FROM tasks WHERE id = ? LIMIT 1", [
		hubId,
	]);
	const hub = hubRows?.[0];
	const { data: metaRows } = usePsQuery<MeetingMeta>(
		"SELECT id, workspace_id, title, status, hub_task_id, series_id, prev_meeting_id FROM meetings WHERE id = ? LIMIT 1",
		[meetingId],
	);
	const meta = metaRows?.[0];
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
	const actions = (subRows ?? []).filter((s) => derived.has(s.id));
	const { data: whoRows, isLoading: whoLoading } = usePsQuery<{ user_id: string }>(
		"SELECT user_id FROM assignments WHERE task_id = ?",
		[hubId],
	);
	const who = (whoRows ?? []).map((w) => w.user_id);
	// CC-P0-01: obchodní tvrzení („Zatím žádná…/0/0") až po dojezdu lokálních dotazů.
	const contentReady = !subLoading && !linkLoading && !whoLoading;
	// Řešitelé VŠECH podúkolů jedním dotazem (audit F2-4: per-row watchery drhly).
	const { data: subAsgRows } = usePsQuery<{ task_id: string; user_id: string }>(
		"SELECT a.task_id, a.user_id FROM assignments a JOIN tasks t2 ON t2.id = a.task_id WHERE t2.parent_id = ?",
		[hubId],
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
	// Řetěz — všechny porady stejné série (series_id, nebo já jako kořen) + huby kvůli termínům.
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

	// ── přepis & AI (server-only obsah) ──
	const [transcript, setTranscript] = useState("");
	// pozn.: pozdní GET nesmí přepsat rozepsaný text — server plní jen prázdné pole.
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
				if (typeof j.meeting?.transcript === "string" && j.meeting.transcript)
					setTranscript((cur) => (cur.trim() ? cur : j.meeting.transcript));
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
		if (transcript.trim().length < 10) return;
		setBusy(true);
		try {
			const r = await fetch(`${API_URL}/api/meetings/extract`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ meetingId, transcript }),
			});
			if (!r.ok) throw new Error("extract");
			const j = await r.json();
			setProposals((j.proposals ?? []).map((p: Proposal) => ({ ...p, keep: true })));
			setWasMock(!!j.mock);
		} catch {
			showToast("Extrakce se nezdařila — zkus to znovu (vyžaduje připojení).");
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
			// Lineage + status → server (idempotentní; klient entity_links psát nesmí).
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

	// ── řetěz: navazující meet + carryover nedodělků ──
	async function followUp() {
		if (!hub || !uid || !meta?.workspace_id) return;
		setBusy(true);
		try {
			const newMeetId = crypto.randomUUID();
			const newTaskId = crypto.randomUUID();
			const now = new Date().toISOString();
			// +7 dní od termínu porady (fallback dnes) — stejný čas i délka.
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
				// Účastníci se přenášejí (stejný projekt → R5 drží).
				await tx.execute(
					`INSERT INTO assignments (id, task_id, project_id, user_id, created_at)
					 SELECT uuid(), ?, project_id, user_id, ? FROM assignments WHERE task_id = ?`,
					[newTaskId, now, hubId],
				);
				// Carryover = PŘESUN nedodělků pod navazující meet (audit F2-4: kopie by
				// zdvojily práci a shodily řešitele). Řešitel, termín i lineage
				// (entity_links „vzešlo z porady X") zůstávají — bod se jen „táhne dál".
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
			onOpenMeet(newMeetId, newTaskId);
		} finally {
			setBusy(false);
		}
	}

	// Esc zavírá overlay (nad ním případně vlastní vrstvy detailu úkolu).
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	if (!hub) return null;
	const time = (() => {
		const m = startMinOf(hub);
		if (m == null) return "";
		const p = (n: number) => String(n).padStart(2, "0");
		return ` · ${p(Math.floor(m / 60))}:${p(m % 60)}`;
	})();

	return (
		<>
			<button
				type="button"
				aria-label="Zavřít"
				onClick={onClose}
				className="fixed inset-0"
				style={{ background: "rgba(10,14,20,.45)", zIndex: 62 }}
			/>
			<div
				data-esc-layer
				className="pointer-events-none fixed inset-0 flex items-start justify-center"
				style={{ zIndex: 63, paddingTop: "7vh" }}
			>
				<div
					className="pointer-events-auto overflow-hidden rounded-2xl border border-line bg-card"
					style={{
						width: 640,
						maxWidth: "94vw",
						maxHeight: "84vh",
						display: "flex",
						flexDirection: "column",
						boxShadow: "var(--w-shadow)",
					}}
				>
					{/* hlavička */}
					<div style={{ padding: "16px 18px 0" }}>
						<div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
							<div style={{ minWidth: 0, flex: 1 }}>
								<div
									className="font-display"
									style={{ fontWeight: 800, fontSize: 17, color: "var(--w-ink)" }}
								>
									{hub.name}
								</div>
								<div
									className="font-mono"
									style={{ fontSize: 11.5, color: "var(--w-brass-text)", marginTop: 3 }}
								>
									{hub.due_date ? dayLbl(hub.due_date) : "bez termínu"}
									{time}
									{hub.duration_min ? ` · ${hub.duration_min} min` : ""}
								</div>
							</div>
							{who.length > 0 && (
								<AvatarGroup people={who.map((id) => initials(members.get(id) ?? "?"))} />
							)}
							<button type="button" onClick={onClose} style={{ ...BTN_GHOST, padding: "6px 10px" }}>
								✕
							</button>
						</div>
						{/* záložky */}
						<div style={{ display: "flex", gap: 4, marginTop: 12 }}>
							{TABS.map(([k, l]) => (
								<button
									key={k}
									type="button"
									onClick={() => setTab(k)}
									className="font-display"
									style={{
										fontWeight: 600,
										fontSize: 12,
										padding: "7px 12px",
										border: "none",
										cursor: "pointer",
										background: "transparent",
										color: tab === k ? "var(--w-brass-text)" : "var(--w-ink-3)",
										borderBottom: `2px solid ${tab === k ? "var(--w-brass)" : "transparent"}`,
									}}
								>
									{l}
									{k === "priprava" && prep.length > 0 && ` · ${prep.length}`}
									{k === "retez" &&
										(chainRows ?? []).length > 1 &&
										` · ${(chainRows ?? []).length}`}
								</button>
							))}
						</div>
					</div>
					<div
						style={{
							overflow: "auto",
							padding: "14px 18px 18px",
							borderTop: "1px solid var(--w-line)",
						}}
					>
						{/* ── PŘEHLED ── */}
						{tab === "prehled" && (
							<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
								<div>
									<div style={{ ...LABEL, marginBottom: 5 }}>Účastníci</div>
									<div className="font-body" style={{ fontSize: 13, color: "var(--w-ink-2)" }}>
										{!contentReady
											? "…"
											: who.length
												? who.map((id) => members.get(id) ?? "?").join(", ")
												: "Zatím bez účastníků — přidej je v detailu úkolu."}
									</div>
								</div>
								<div>
									<div style={{ ...LABEL, marginBottom: 5 }}>Stav</div>
									<div className="font-body" style={{ fontSize: 13, color: "var(--w-ink-2)" }}>
										{!contentReady
											? "…"
											: `příprava ${prep.filter((p) => p.completed_at).length}/${prep.length} · akční body ${actions.filter((a) => a.completed_at).length}/${actions.length} · ${meta?.status ?? "…"}`}
									</div>
								</div>
								<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
									<button
										type="button"
										style={BTN_GHOST}
										onClick={() => {
											// Zavřít overlay PŘED otevřením detailu úkolu — jinak by se vrstvy
											// překřížily a Esc zavíral spodní (audit F2-4, konvence esc-layer).
											onClose();
											openTask(hubId);
										}}
									>
										Otevřít jako úkol
									</button>
									<button
										type="button"
										style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }}
										disabled={busy}
										onClick={() => void followUp()}
									>
										Naplánovat navazující →
									</button>
								</div>
							</div>
						)}

						{/* ── PŘÍPRAVA ── */}
						{tab === "priprava" && (
							<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
								{contentReady && prep.length === 0 && (
									<div className="font-body" style={{ fontSize: 12.5, color: "var(--w-ink-3)" }}>
										Zatím žádná příprava. Podklady = podúkoly porady — každý s řešitelem a
										checkboxem; uvidíš je i tady v progresu.
									</div>
								)}
								{prep.map((s) => (
									<SubRow
										key={s.id}
										t={s}
										names={subNames.get(s.id) ?? []}
										onToggle={() => void toggleTask(s, uid)}
										onOpen={() => {
											onClose();
											openTask(s.id);
										}}
									/>
								))}
								<div style={{ display: "flex", gap: 8 }}>
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
							</div>
						)}

						{/* ── PŘEPIS & AKČNÍ BODY ── */}
						{tab === "prepis" && (
							<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
								{serverLoaded === "offline" && (
									<div
										className="font-body"
										style={{
											fontSize: 12,
											color: "var(--w-ink-3)",
											background: "var(--w-panel-2)",
											borderRadius: 9,
											padding: "8px 11px",
										}}
									>
										Přepis se načítá ze serveru — offline není dostupný (termín, příprava i akční
										body fungují offline).
									</div>
								)}
								<textarea
									value={transcript}
									onChange={(e) => setTranscript(e.target.value)}
									rows={8}
									placeholder="Vlož přepis / zápis z porady…"
									style={{ ...INPUT, resize: "vertical", lineHeight: 1.5 }}
								/>
								{!proposals && (
									<button
										type="button"
										style={{
											...BTN_PRIMARY,
											alignSelf: "flex-start",
											opacity: busy || transcript.trim().length < 10 ? 0.5 : 1,
										}}
										disabled={busy || transcript.trim().length < 10}
										onClick={() => void extractHere()}
									>
										{busy ? "Zpracovávám…" : "Vytáhnout akční body →"}
									</button>
								)}
								{proposals && (
									<>
										<div style={{ ...LABEL }}>
											Návrhy akčních bodů{wasMock ? " · ukázkový režim (bez AI klíče)" : ""}
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
														width: 110,
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
												Založit {proposals.filter((p) => p.keep && p.title.trim()).length} akčních
												bodů
											</button>
											<button type="button" style={BTN_GHOST} onClick={() => setProposals(null)}>
												Zahodit návrhy
											</button>
										</div>
									</>
								)}
								{pendingLink && (
									<button
										type="button"
										style={{ ...BTN_GHOST, alignSelf: "flex-start", color: "var(--w-brass-text)" }}
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
								{actions.length > 0 && (
									<>
										<div style={{ ...LABEL, marginTop: 6 }}>Akční body porady</div>
										{actions.map((s) => (
											<SubRow
												key={s.id}
												t={s}
												names={subNames.get(s.id) ?? []}
												onToggle={() => void toggleTask(s, uid)}
												onOpen={() => {
													onClose();
													openTask(s.id);
												}}
											/>
										))}
									</>
								)}
							</div>
						)}

						{/* ── ŘETĚZ ── */}
						{tab === "retez" && (
							<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
								{(chainRows ?? []).map((m) => {
									const isMe = m.id === meetingId;
									const day = m.t_due ? dayLbl(m.t_due) : "bez termínu";
									return (
										<button
											key={m.id}
											type="button"
											disabled={isMe || !m.hub_task_id}
											onClick={() => m.hub_task_id && onOpenMeet(m.id, m.hub_task_id)}
											className="font-display"
											style={{
												display: "flex",
												alignItems: "center",
												gap: 10,
												textAlign: "left",
												padding: "9px 12px",
												borderRadius: 9,
												border: `1px solid ${isMe ? "var(--w-brass)" : "var(--w-line)"}`,
												background: isMe ? "var(--w-brass-soft)" : "transparent",
												cursor: isMe ? "default" : "pointer",
											}}
										>
											<span
												className="font-mono"
												style={{ fontSize: 11, color: "var(--w-ink-3)", flex: "none", width: 80 }}
											>
												{day}
											</span>
											<span
												style={{
													fontWeight: 600,
													fontSize: 13,
													color: "var(--w-ink)",
													flex: 1,
													minWidth: 0,
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
												}}
											>
												{m.title ?? "Porada"}
											</span>
											<span
												className="font-mono"
												style={{ fontSize: 10, color: "var(--w-ink-3)", flex: "none" }}
											>
												{m.status}
												{isMe ? " · tahle" : ""}
											</span>
										</button>
									);
								})}
								<button
									type="button"
									style={{ ...BTN_PRIMARY, alignSelf: "flex-start", opacity: busy ? 0.6 : 1 }}
									disabled={busy}
									onClick={() => void followUp()}
								>
									Naplánovat navazující → (přenese nedodělky)
								</button>
							</div>
						)}
					</div>
				</div>
			</div>
		</>
	);
}

/** Řádek podúkolu (příprava/akční bod) — checkbox + řešitelé (batched z rodiče) + proklik. */
function SubRow({
	t,
	names: nameList,
	onToggle,
	onOpen,
}: {
	t: TaskRow;
	names: string[];
	onToggle: () => void;
	onOpen: () => void;
}) {
	const names = nameList.join(", ");
	const done = Boolean(t.completed_at);
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 9 }}>
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
			{names && (
				<span className="font-body" style={{ fontSize: 11, color: "var(--w-ink-3)", flex: "none" }}>
					{names}
				</span>
			)}
		</div>
	);
}
