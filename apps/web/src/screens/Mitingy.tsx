/**
 * Modul Mítingy — vstupní brána „přepis schůzky → úkoly". Uživatel vloží text porady,
 * AI (Claude; bez klíče deterministický mock) navrhne úkoly s řešitelem (dle oblastí),
 * prioritou, termínem a hierarchií. Člověk návrhy zreviduje/doplní a teprve pak z nich
 * vzniknou REÁLNÉ úkoly přes write-path (human-in-the-loop). Feedback 2026-07-12.
 */
import { useQuery as usePsQuery } from "@powersync/react";
import { type CSSProperties, useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { logTaskActivity } from "../lib/activity";
import { useAllMembers } from "../lib/overview";
import type { ProjectRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
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
interface MeetingListItem {
	id: string;
	title: string | null;
	status: string;
	taskCount: number;
	createdAt: string;
}

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

const PRIO = [
	{ v: 1, l: "P1" },
	{ v: 2, l: "P2" },
	{ v: 3, l: "P3" },
	{ v: 4, l: "P4" },
];

export function Mitingy() {
	const { activeWs } = useWorkspace();
	const { data: session } = useSession();
	const members = useAllMembers();
	const memberList = [...members].map(([id, name]) => ({ id, name }));
	const { data: allProjects } = usePsQuery<ProjectRow>(
		"SELECT id, name, workspace_id FROM projects WHERE archived_at IS NULL ORDER BY created_at",
	);
	// Jen projekty AKTIVNÍHO prostoru — úkoly z mítingu patří do týmu porady a
	// přiřazení řešitelů (členů prostoru) jinak selže na R5 (nejsou členy cizího projektu).
	const projects = (allProjects ?? []).filter((p) => p.workspace_id === activeWs);
	// Výchozí = první „skutečný" projekt prostoru; osobní Inbox až jako fallback.
	const inbox =
		projects.find((p) => p.name !== "Doručené" && p.name !== "Inbox") ?? projects[0];

	const [mode, setMode] = useState<"list" | "new" | "review">("list");
	const [list, setList] = useState<MeetingListItem[]>([]);
	const [title, setTitle] = useState("");
	const [transcript, setTranscript] = useState("");
	const [proposals, setProposals] = useState<Editable[]>([]);
	const [meetingId, setMeetingId] = useState<string | null>(null);
	const [projectId, setProjectId] = useState<string>("");
	const [busy, setBusy] = useState(false);
	const [wasMock, setWasMock] = useState(false);

	useEffect(() => {
		if (inbox && !projectId) setProjectId(inbox.id);
	}, [inbox?.id, projectId]);

	const loadList = async () => {
		if (!activeWs) return;
		try {
			const r = await fetch(`${API_URL}/api/meetings?workspaceId=${activeWs}`, {
				credentials: "include",
			});
			if (r.ok) setList((await r.json()).meetings ?? []);
		} catch {
			/* offline */
		}
	};
	useEffect(() => {
		void loadList();
	}, [activeWs]);

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
		const uid = session.user.id;
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
				void logTaskActivity(taskId, projectId, uid, "created", null, "míting");
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
			showToast(`Vytvořeno ${created} úkolů z mítingu.`);
			setMode("list");
			setTitle("");
			setTranscript("");
			setProposals([]);
			setMeetingId(null);
			void loadList();
		} catch {
			showToast("Vytvoření úkolů selhalo.");
		} finally {
			setBusy(false);
		}
	}

	const keepCount = proposals.filter((p) => p.keep).length;

	return (
		<div style={{ maxWidth: 820, margin: "0 auto", padding: "22px 20px 60px" }}>
			<div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
				<h1
					className="font-display"
					style={{ fontWeight: 800, fontSize: 24, color: "var(--w-ink)", margin: 0 }}
				>
					Mítingy
				</h1>
				{mode === "list" && (
					<button
						type="button"
						style={{ ...BTN_PRIMARY, marginLeft: "auto" }}
						onClick={() => setMode("new")}
					>
						+ Nový míting
					</button>
				)}
			</div>
			<p className="font-body" style={{ fontSize: 13, color: "var(--w-ink-3)", margin: "0 0 20px" }}>
				Vlož přepis porady — AI z něj vytáhne úkoly, přiřadí je a navrhne priority i termíny. Ty
				doplníš, co chybí, a potvrdíš.
			</p>

			{/* ── SEZNAM ── */}
			{mode === "list" && (
				<div style={{ ...CARD, overflow: "hidden" }}>
					{list.length === 0 ? (
						<div
							className="font-body"
							style={{ padding: "28px 18px", textAlign: "center", color: "var(--w-ink-3)", fontSize: 13.5 }}
						>
							Zatím žádný míting. Klikni na „+ Nový míting" a vlož přepis schůzky.
						</div>
					) : (
						list.map((m) => (
							<div
								key={m.id}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 12,
									padding: "13px 16px",
									borderBottom: "1px solid var(--w-line)",
								}}
							>
								<div style={{ minWidth: 0, flex: 1 }}>
									<div
										className="font-display"
										style={{ fontWeight: 700, fontSize: 14, color: "var(--w-ink)" }}
									>
										{m.title || "Míting bez názvu"}
									</div>
									<div className="font-body" style={{ fontSize: 11.5, color: "var(--w-ink-3)", marginTop: 2 }}>
										{m.taskCount} úkolů · {m.status === "committed" ? "zpracováno" : "návrh"}
									</div>
								</div>
							</div>
						))
					)}
				</div>
			)}

			{/* ── NOVÝ MÍTING ── */}
			{mode === "new" && (
				<div style={{ ...CARD, padding: "18px 18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
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
								style={{ ...INPUT, width: "auto", padding: "6px 8px" }}
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
							<div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
								<input
									value={p.title}
									onChange={(e) => patchProposal(i, { title: e.target.value })}
									style={{ ...INPUT, fontWeight: 600 }}
								/>
								<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
									<select
										value={p.assigneeUserId ?? ""}
										onChange={(e) => patchProposal(i, { assigneeUserId: e.target.value || null })}
										style={{ ...INPUT, width: "auto", padding: "6px 8px" }}
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
										style={{ ...INPUT, width: "auto", padding: "6px 8px" }}
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
										style={{ ...INPUT, width: "auto", padding: "6px 8px" }}
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
