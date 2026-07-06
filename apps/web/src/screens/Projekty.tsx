import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { USER_COLORS } from "../lib/colors";
import { initials } from "../lib/format";
import type { ProjectRow } from "../lib/powersync/AppSchema";
import { useProjectDetail } from "../lib/projectDetail";
import { useProjects } from "../lib/projects";
import { useWorkspace, useWorkspaces } from "../lib/workspace";

type Member = { id: string; name: string; email: string };

type Counts = { open: number; done: number; total: number };
const ZERO: Counts = { open: 0, done: 0, total: 0 };

/**
 * Projekty — plochý grid karet (design handoff: auto-fill minmax 290px).
 * Detail = pravý slide-in panel (ProjectDetailPanel). Sekce v prototypu nejsou —
 * úkoly visí přímo na projektu; karta ukazuje REÁLNÉ počty z `tasks`.
 */
export function Projekty() {
	const { t } = useTranslation();
	const projects = useProjects();
	const { open } = useProjectDetail();

	const { data: workspaces } = useWorkspaces();
	const { activeWs } = useWorkspace();
	const activeWsRow = workspaces?.find((w) => w.id === activeWs);
	const wsName = activeWsRow?.name ?? "";
	const shown = useMemo(
		() => projects.filter((p) => !activeWs || p.workspace_id === activeWs),
		[projects, activeWs],
	);

	const { data: taskRows } = usePsQuery<{
		project_id: string | null;
		completed_at: string | null;
		created_at: string | null;
		due_date: string | null;
	}>("SELECT project_id, completed_at, created_at, due_date FROM tasks");
	const { data: memberRows } = usePsQuery<{
		project_id: string | null;
		user_id: string | null;
	}>("SELECT project_id, user_id FROM project_members");
	// jména členů aktivního prostoru (avataři karet, #18)
	const { data: team } = useQuery({
		queryKey: ["wsMembersFull", activeWs],
		enabled: !!activeWs,
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/workspaces/${activeWs}/members`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("members");
			return (await r.json()).members as Member[];
		},
	});
	const nameById = useMemo(
		() => new Map((team ?? []).map((m) => [m.id, m.name])),
		[team],
	);
	const membersByProject = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const r of memberRows ?? []) {
			if (!r.project_id || !r.user_id) continue;
			m.set(r.project_id, [...(m.get(r.project_id) ?? []), r.user_id]);
		}
		return m;
	}, [memberRows]);
	const [modalOpen, setModalOpen] = useState(false);

	const counts = useMemo(() => {
		const m = new Map<string, Counts>();
		for (const tk of taskRows ?? []) {
			const k = tk.project_id ?? "";
			const c = m.get(k) ?? { open: 0, done: 0, total: 0 };
			c.total++;
			if (tk.completed_at) c.done++;
			else c.open++;
			m.set(k, c);
		}
		return m;
	}, [taskRows]);

	const memberCounts = useMemo(() => {
		const m = new Map<string, number>();
		for (const r of memberRows ?? []) {
			const k = r.project_id ?? "";
			m.set(k, (m.get(k) ?? 0) + 1);
		}
		return m;
	}, [memberRows]);

	/** Týdenní aktivita per projekt (prototyp tepNode + weekDone/added/overdue, ř. 3181). */
	const weekStats = useMemo(() => {
		const now = Date.now();
		const DAY = 86_400_000;
		const tdy = new Date().toISOString().slice(0, 10);
		const m = new Map<
			string,
			{ weekDone: number; added: number; overdue: number; bars: number[] }
		>();
		for (const tk of taskRows ?? []) {
			const k = tk.project_id ?? "";
			const s = m.get(k) ?? {
				weekDone: 0,
				added: 0,
				overdue: 0,
				bars: Array(8).fill(0),
			};
			const doneT = tk.completed_at
				? new Date(tk.completed_at).getTime()
				: null;
			const createdT = tk.created_at ? new Date(tk.created_at).getTime() : null;
			if (doneT && now - doneT < 7 * DAY) s.weekDone++;
			if (createdT && now - createdT < 7 * DAY) s.added++;
			if (!tk.completed_at && tk.due_date && tk.due_date.slice(0, 10) < tdy)
				s.overdue++;
			for (const ts of [doneT, createdT]) {
				if (ts == null) continue;
				const idx = 7 - Math.floor((now - ts) / DAY);
				if (idx >= 0 && idx <= 7)
					s.bars[idx] = Math.min(10, (s.bars[idx] ?? 0) + 2);
			}
			m.set(k, s);
		}
		return m;
	}, [taskRows]);

	return (
		<div className="mx-auto max-w-[1080px] px-[22px] pt-6 pb-24">
			<header className="flex items-center gap-2.5">
				<h1
					className="font-display font-extrabold text-ink"
					style={{ fontSize: 17 }}
				>
					{t("projects.heading")}
				</h1>
				{wsName && (
					<>
						<span
							style={{
								width: 8,
								height: 8,
								borderRadius: 2,
								background: activeWsRow?.color ?? "var(--w-brass)",
							}}
						/>
						<span
							className="font-display font-semibold text-ink-3"
							style={{ fontSize: 13 }}
						>
							{wsName}
						</span>
					</>
				)}
				<button
					type="button"
					onClick={() => setModalOpen(true)}
					className="ml-auto flex items-center gap-1.5 rounded-[9px] font-display font-bold text-white hover:brightness-105"
					style={{
						background: "var(--w-brass)",
						padding: "7px 13px",
						fontSize: 12.5,
					}}
				>
					<Icon name="pridat" size={14} />
					{t("projects.new")}
				</button>
			</header>

			{shown.length === 0 ? (
				<p className="mt-6 rounded-xl border border-line border-dashed px-4 py-12 text-center text-ink-3 text-sm">
					{t("projects.empty")}
				</p>
			) : (
				<div
					className="mt-6 grid gap-4"
					style={{
						gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
					}}
				>
					{shown.map((p) => (
						<ProjectCard
							key={p.id}
							project={p}
							counts={counts.get(p.id) ?? ZERO}
							week={weekStats.get(p.id)}
							members={memberCounts.get(p.id) ?? 0}
							avatars={(membersByProject.get(p.id) ?? []).map((uid) => ({
								name: nameById.get(uid) ?? "?",
								isOwner: uid === p.owner_id,
							}))}
							onOpen={() => open(p.id)}
						/>
					))}
				</div>
			)}

			{modalOpen && activeWs && (
				<NewProjectModal
					workspaceId={activeWs}
					onClose={() => setModalOpen(false)}
				/>
			)}
		</div>
	);
}

/** Modal „Nový projekt" — název + barva + typ → POST /api/projects (projekt se přisyncuje). */
function NewProjectModal({
	workspaceId,
	onClose,
}: {
	workspaceId: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	const [color, setColor] = useState<string | null>(null);
	const [kind, setKind] = useState("flow");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	const create = async () => {
		if (!name.trim() || busy) return;
		setBusy(true);
		try {
			const r = await fetch(`${API_URL}/api/projects`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: name.trim(), workspaceId, color, kind }),
			});
			if (r.ok) {
				onClose();
				return;
			}
			// HTTP chyba (403 host, 400, 500) — modal zůstane otevřený s hláškou.
			setErr(
				r.status === 403 ? t("projects.newForbidden") : t("projects.newError"),
			);
		} catch {
			// Síť/offline výjimka — nezaseknout busy, ukázat hlášku.
			setErr(t("projects.newError"));
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<button
				type="button"
				aria-label={t("projects.newCancel")}
				onClick={onClose}
				className="fixed inset-0"
				style={{ background: "rgba(10,14,20,.42)", zIndex: 50 }}
			/>
			<div
				className="pointer-events-none fixed inset-0 flex items-start justify-center"
				style={{ zIndex: 51, paddingTop: "14vh" }}
			>
				<div
					className="pointer-events-auto rounded-2xl border border-line bg-card"
					style={{
						width: 440,
						maxWidth: "94vw",
						boxShadow: "var(--w-shadow)",
						padding: "18px 20px",
					}}
				>
					<div className="mb-3 flex items-center gap-2.5">
						<span
							className="flex-1 font-display font-bold text-ink"
							style={{ fontSize: 16 }}
						>
							{t("projects.new")}
						</span>
						<button
							type="button"
							onClick={onClose}
							aria-label={t("projects.newCancel")}
							className="grid h-7 w-7 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
						>
							<Icon name="zavrit" size={15} />
						</button>
					</div>
					<input
						// biome-ignore lint/a11y/noAutofocus: create modal
						autoFocus
						value={name}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void create()}
						placeholder={t("projects.newName")}
						className="w-full rounded-[10px] border border-line bg-panel-2 font-display font-semibold text-ink outline-none focus:border-brass"
						style={{ padding: "11px 13px", fontSize: 15 }}
					/>
					<div
						className="mt-3.5 mb-1.5 font-display font-bold text-ink-3 uppercase"
						style={{ fontSize: 10.5, letterSpacing: ".05em" }}
					>
						{t("projects.newColor")}
					</div>
					<div className="flex flex-wrap gap-1.5">
						<button
							type="button"
							onClick={() => setColor(null)}
							aria-label="—"
							className="h-6 w-6 rounded-full border border-line"
							style={{
								outline: color === null ? "2px solid var(--w-avatar)" : "none",
								outlineOffset: 1,
							}}
						/>
						{USER_COLORS.map((c) => (
							<button
								key={c}
								type="button"
								onClick={() => setColor(c)}
								aria-label={c}
								className="h-6 w-6 rounded-full"
								style={{
									background: c,
									outline: color === c ? "2px solid var(--w-avatar)" : "none",
									outlineOffset: 1,
								}}
							/>
						))}
					</div>
					<div
						className="mt-3.5 mb-1.5 font-display font-bold text-ink-3 uppercase"
						style={{ fontSize: 10.5, letterSpacing: ".05em" }}
					>
						{t("projects.newKind")}
					</div>
					<div
						className="inline-flex rounded-[10px] border border-line bg-panel-2"
						style={{ padding: 3 }}
					>
						{(
							[
								["flow", t("projects.kindFlow")],
								["goal", t("projects.kindGoal")],
								["cycle", t("projects.kindCycle")],
							] as const
						).map(([k, l]) => (
							<button
								key={k}
								type="button"
								onClick={() => setKind(k)}
								className="rounded-lg font-display font-semibold"
								style={{
									fontSize: 12.5,
									padding: "6px 13px",
									background: kind === k ? "var(--w-card)" : "transparent",
									color: kind === k ? "var(--w-ink)" : "var(--w-ink-3)",
								}}
							>
								{l}
							</button>
						))}
					</div>
					{err && (
						<p
							className="mt-3 rounded-[9px] font-body"
							style={{
								fontSize: 12.5,
								padding: "8px 12px",
								background: "var(--w-overdue-soft, rgba(194,71,60,.12))",
								color: "var(--w-overdue)",
							}}
						>
							{err}
						</p>
					)}
					<div className="mt-4 flex justify-end gap-2.5 border-line border-t pt-3.5">
						<button
							type="button"
							onClick={onClose}
							className="rounded-[9px] border border-line font-display font-semibold text-ink-2 hover:border-ink-3"
							style={{ padding: "9px 15px", fontSize: 13 }}
						>
							{t("projects.newCancel")}
						</button>
						<button
							type="button"
							onClick={() => void create()}
							disabled={!name.trim() || busy}
							className="rounded-[9px] font-display font-bold text-white hover:brightness-105 disabled:opacity-50"
							style={{
								background: "var(--w-brass)",
								padding: "9px 17px",
								fontSize: 13,
							}}
						>
							{t("projects.newCreate")}
						</button>
					</div>
				</div>
			</div>
		</>
	);
}

function ProjectCard({
	project,
	counts,
	week,
	members,
	avatars,
	onOpen,
}: {
	project: ProjectRow;
	counts: Counts;
	/** Týdenní aktivita (jen průběžné projekty — sparkline, prototyp ř. 717–723). */
	week?: { weekDone: number; added: number; overdue: number; bars: number[] };
	members: number;
	avatars: { name: string; isOwner: boolean }[];
	onOpen: () => void;
}) {
	const { t } = useTranslation();
	const pct =
		counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
	const kind = project.kind ?? "flow";
	const kindLabel = t(
		`projects.kind${kind === "goal" ? "Goal" : kind === "cycle" ? "Cycle" : "Flow"}`,
	);
	const status = project.status ?? "active";
	const dd = project.delivery_date;
	const dueDate =
		(kind === "goal" || kind === "cycle") && dd
			? new Date(`${dd.slice(0, 10)}T00:00:00`)
			: null;
	const dueDays = dueDate
		? Math.round((dueDate.getTime() - Date.now()) / 86_400_000)
		: 0;
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex flex-col rounded-2xl border border-line bg-card p-4 text-left shadow-[var(--w-shadow-sm)] transition hover:-translate-y-0.5 hover:shadow-[var(--w-shadow)]"
		>
			<div className="flex items-center gap-2">
				<span
					className="h-2.5 w-2.5 shrink-0 rounded-full"
					style={{ background: project.color ?? "var(--w-ink-3)" }}
				/>
				<span className="min-w-0 flex-1 truncate font-display font-bold text-[15px] text-ink">
					{project.name}
				</span>
				<StatusBadge status={status} t={t} />
			</div>

			<div className="mt-1.5 flex items-center gap-2">
				<span className="font-display font-bold text-[10px] text-ink-3 uppercase tracking-[0.07em]">
					{kindLabel}
				</span>
				{dueDate && (
					<span
						className="font-mono text-[11.5px]"
						style={{
							color: dueDays < 0 ? "var(--w-overdue)" : "var(--w-ink-3)",
						}}
					>
						do {dueDate.getDate()}. {dueDate.getMonth() + 1}. · zbývá {dueDays}{" "}
						dní
					</span>
				)}
			</div>

			<div className="mt-3 flex items-end gap-1.5">
				<span className="font-mono text-2xl text-navy leading-none">
					{counts.open}
				</span>
				<span className="mb-0.5 text-ink-3 text-xs">
					{t("projects.openOfTotal", { total: counts.total })}
				</span>
			</div>

			{kind === "flow" && week ? (
				<>
					{/* aktivita-sparkline 8 dní (prototyp tepNode, ř. 3181) */}
					<div
						className="flex items-end"
						style={{ gap: 3, height: 30, marginTop: 12 }}
					>
						{week.bars.map((v, i) => (
							<span
								key={`b-${i}`}
								style={{
									flex: 1,
									borderRadius: 2,
									height: Math.max(3, Math.round((v / 10) * 30)),
									background: i === 7 ? "var(--w-brass)" : "var(--w-panel-2)",
									border: "1px solid var(--w-line)",
								}}
							/>
						))}
					</div>
					<div
						className="flex items-center font-mono"
						style={{
							gap: 13,
							marginTop: 9,
							fontSize: 11.5,
							color: "var(--w-ink-3)",
						}}
					>
						<span style={{ color: "var(--w-success-ink)" }}>
							✓ {week.weekDone} {t("projects.weekUnit")}
						</span>
						<span>
							↑ {week.added} {t("projects.newUnit")}
						</span>
						{week.overdue > 0 && (
							<span style={{ color: "var(--w-overdue)" }}>
								⚠ {week.overdue}
							</span>
						)}
					</div>
				</>
			) : (
				counts.total > 0 && (
					<div className="mt-3">
						<div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
							<div
								className="h-full rounded-full"
								style={{ width: `${pct}%`, background: "var(--w-brass)" }}
							/>
						</div>
						<div className="mt-1 flex items-center justify-between text-[11px] text-ink-3">
							<span>{t("projects.pctDone", { pct })}</span>
							{members > 0 && (
								<span>{t("projects.members", { count: members })}</span>
							)}
						</div>
					</div>
				)
			)}

			{/* avataři členů (#18) — vlastník s brass ringem (prototyp ř. 727) */}
			{avatars.length > 0 && (
				<div className="mt-3 flex items-center">
					{avatars.slice(0, 4).map((a, i) => (
						<span
							key={`${a.name}-${i}`}
							title={a.name}
							className="flex items-center justify-center rounded-full font-display font-semibold text-white"
							style={{
								width: 24,
								height: 24,
								background: "var(--w-avatar)",
								fontSize: 10,
								marginLeft: i > 0 ? -6 : 0,
								boxShadow: a.isOwner
									? "0 0 0 2px var(--w-brass)"
									: "0 0 0 2px var(--w-card)",
								zIndex: a.isOwner ? 2 : 1,
							}}
						>
							{initials(a.name)}
						</span>
					))}
					{avatars.length > 4 && (
						<span
							className="ml-1.5 font-mono text-ink-3"
							style={{ fontSize: 10.5 }}
						>
							+{avatars.length - 4}
						</span>
					)}
				</div>
			)}
		</button>
	);
}

function StatusBadge({
	status,
	t,
}: {
	status: string;
	t: (k: string) => string;
}) {
	const map: Record<string, [string, string, string]> = {
		paused: [t("projects.statusPaused"), "var(--w-panel-2)", "var(--w-ink-2)"],
		archive: [
			t("projects.statusArchived"),
			"var(--w-panel-2)",
			"var(--w-ink-3)",
		],
		done: [
			t("projects.statusDone"),
			"var(--w-success-soft)",
			"var(--w-success-ink)",
		],
	};
	const s = map[status];
	if (!s) return null;
	return (
		<span
			className="shrink-0 font-display font-semibold text-[10.5px]"
			style={{
				padding: "2px 8px",
				borderRadius: 999,
				background: s[1],
				color: s[2],
			}}
		>
			{s[0]}
		</span>
	);
}
