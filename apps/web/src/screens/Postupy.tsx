import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataLoading } from "../components/Loading";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import {
	activateStepManually,
	type ChainStepLite,
	repairChain,
	rewindToStep,
} from "../lib/chainAdvance";
import { shiftChain, toggleChainWeekend } from "../lib/chainReflow";
import { initials } from "../lib/format";
import { focusOnMount } from "../lib/focusOnMount";
import type { ChainRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjectsWithState } from "../lib/projects";
import { useTaskDetail } from "../lib/taskDetail";
import { NOT_MEETING, toggleTask } from "../lib/tasks";
import { showToast } from "../lib/toast";
import { storageGet } from "../lib/storage";
import { useWorkspace, useWorkspaces } from "../lib/workspace";

type Member = { id: string; name: string; email: string };

// Lokální dnešek (ne UTC) — konzistentní s lib/tasks, jinak po půlnoci posun o den.
const todayISO = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const addDays = (iso: string, n: number) => {
	const d = new Date(`${iso}T00:00:00`);
	d.setDate(d.getDate() + n);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDay = (iso: string | null) => {
	if (!iso) return "";
	const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
	return `${d.getDate()}. ${d.getMonth() + 1}.`;
};
/** Platné datum kotvy — prázdný/rozbitý input jinak vyrobí „NaN-NaN-NaN" termíny všech kroků. */
const isValidISO = (s: string) =>
	/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());

/** Šablony postupů (VERBATIM FLOW_TEMPLATES z prototypu ř. 2509–2529, bez mock osob; mode = režim R2). */
const TEMPLATES: {
	id: string;
	label: string;
	desc: string;
	steps: {
		name: string;
		offset: number;
		priority: number;
		gate: string;
		mode?: "any" | "all";
	}[];
}[] = [
	{
		id: "plakat",
		label: "Plakát na akci",
		desc: "Návrh → tisk → faktura",
		steps: [
			{
				name: "Udělat návrh plakátu",
				offset: 0,
				priority: 2,
				gate: "after_previous",
				mode: "any",
			},
			{
				name: "Poptávka do tisku",
				offset: 2,
				priority: 2,
				gate: "after_previous",
				mode: "any",
			},
			{
				name: "Zadat do tisku",
				offset: 4,
				priority: 3,
				gate: "manual",
				mode: "any",
			},
			{
				name: "Vyzvednout tisk",
				offset: 5,
				priority: 3,
				gate: "after_previous",
				mode: "any",
			},
			{
				name: "Pohlídat platbu faktury",
				offset: 7,
				priority: 3,
				gate: "after_previous",
				mode: "any",
			},
		],
	},
	{
		id: "podcast",
		label: "Nová epizoda podcastu",
		desc: "Scénář → střih → publikace",
		steps: [
			{
				name: "Napsat scénář epizody",
				offset: 0,
				priority: 2,
				gate: "after_previous",
				mode: "any",
			},
			{
				name: "Nahrát epizodu",
				offset: 2,
				priority: 2,
				gate: "after_previous",
				mode: "all",
			},
			{
				name: "Střih a postprodukce",
				offset: 4,
				priority: 3,
				gate: "after_previous",
				mode: "any",
			},
			{
				name: "Schválit finální verzi",
				offset: 5,
				priority: 2,
				gate: "manual",
				mode: "any",
			},
			{
				name: "Publikovat a propagovat",
				offset: 6,
				priority: 3,
				gate: "after_previous",
				mode: "any",
			},
		],
	},
	{
		id: "ples",
		label: "Příprava plesu",
		desc: "Sál → catering → vyúčtování",
		steps: [
			{
				name: "Rezervovat sál",
				offset: 0,
				priority: 1,
				gate: "after_previous",
				mode: "any",
			},
			{
				name: "Objednat catering",
				offset: 3,
				priority: 2,
				gate: "after_previous",
				mode: "any",
			},
			{
				name: "Spustit prodej vstupenek",
				offset: 5,
				priority: 2,
				gate: "after_previous",
				mode: "any",
			},
			{
				name: "Sestavit program večera",
				offset: 6,
				priority: 3,
				gate: "manual",
				mode: "all",
			},
			{
				name: "Vyúčtování akce",
				offset: 9,
				priority: 3,
				gate: "after_previous",
				mode: "any",
			},
		],
	},
	{
		id: "grant",
		label: "Žádost o grant",
		desc: "Žádost → revize → odeslání",
		steps: [
			{
				name: "Sepsat žádost",
				offset: 0,
				priority: 1,
				gate: "after_previous",
				mode: "any",
			},
			// gate:'auto' v prototypu (ř. 2525) → after_previous; mode 'all' = každý zvlášť
			{
				name: "Interní revize žádosti",
				offset: 3,
				priority: 2,
				gate: "after_previous",
				mode: "all",
			},
			{
				name: "Doložit povinné přílohy",
				offset: 5,
				priority: 2,
				gate: "after_previous",
				mode: "any",
			},
			{
				name: "Odeslat žádost",
				offset: 6,
				priority: 1,
				gate: "manual",
				mode: "any",
			},
			{
				name: "Sledovat výsledek",
				offset: 9,
				priority: 3,
				gate: "after_previous",
				mode: "any",
			},
		],
	},
];

/** Šablony uložené z běžících postupů (localStorage, prototyp saveFlowAsTemplate). */
function savedTemplates(): typeof TEMPLATES {
	try {
		return JSON.parse(storageGet("watson.flowTemplates") ?? "[]") as typeof TEMPLATES;
	} catch {
		return [];
	}
}

interface StepFull extends ChainStepLite {
	activated_at: string | null;
}

/** Postupy — přehled štafet (karty), builder, detail s časovou osou + advance (R-postupy). */
export function Postupy() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const search = useSearch({ from: "/postupy" });
	const { projects, isLoading: projectsLoading } = useProjectsWithState();
	const { activeWs } = useWorkspace();
	const { data: workspaces } = useWorkspaces();
	const activeWsInfo = (workspaces ?? []).find((w) => w.id === activeWs);
	const { data: session } = useSession();
	const meId = session?.user?.id;

	const [mineOnly, setMineOnly] = useState(false);
	const [modalOpen, setModalOpen] = useState(false);

	const wsProjects = useMemo(
		() => projects.filter((p) => p.workspace_id === activeWs),
		[projects, activeWs],
	);
	const wsProjectIds = useMemo(() => new Set(wsProjects.map((p) => p.id)), [wsProjects]);

	const { data: chains, isLoading: chainsLoading } = usePsQuery<ChainRow>("SELECT * FROM chains ORDER BY created_at DESC");
	const { data: steps, isLoading: stepsLoading } = usePsQuery<StepFull>(
		"SELECT id, chain_id, task_id, project_id, position, gate, step_state, activated_at FROM chain_steps ORDER BY position",
	);
	const { data: tasks, isLoading: tasksLoading } = usePsQuery<TaskRow>(
		// NOT_MEETING — porada nesmí být krokem štafety (audit Fáze 1: chybějící filtr)
		`SELECT id, name, project_id, priority, due_date, completed_at, description, assignment_mode FROM tasks WHERE ${NOT_MEETING}`,
	);
	const { data: assignments, isLoading: assignmentsLoading } = usePsQuery<{
		task_id: string | null;
		user_id: string | null;
	}>("SELECT task_id, user_id FROM assignments");

	const taskById = useMemo(() => new Map((tasks ?? []).map((tk) => [tk.id, tk] as const)), [tasks]);
	const assigneesByTask = useMemo(() => {
		const m = new Map<string, string[]>();
		for (const a of assignments ?? []) {
			if (!a.task_id || !a.user_id) continue;
			m.set(a.task_id, [...(m.get(a.task_id) ?? []), a.user_id]);
		}
		return m;
	}, [assignments]);

	// Jména členů všech ws projektů (avatar/kdo je na řadě) — members API per projekt by bylo N dotazů;
	// stačí členové aktivního prostoru (kroky žijí v jeho projektech).
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
	const memberName = useCallback(
		(id: string | null | undefined) => (team ?? []).find((m) => m.id === id)?.name ?? "",
		[team],
	);

	/** Role kroku — builder ji ukládá do popisu úkolu jako „Role: X" (prototyp flowView, ř. 2554). */
	const stepRole = (st: ChainStepLite) => {
		const desc = st.task_id ? taskById.get(st.task_id)?.description : null;
		return desc?.startsWith("Role: ") ? desc.slice("Role: ".length) : null;
	};
	/** Kdo je na kroku (první přiřazený) — jméno, jinak „Role: X", jinak „kdokoli z týmu". */
	const stepWho = (st: ChainStepLite) => {
		const uid = st.task_id ? assigneesByTask.get(st.task_id)?.[0] : undefined;
		if (uid) return memberName(uid) || t("flows.anyone");
		const role = stepRole(st);
		return role ? `Role: ${role}` : t("flows.anyone");
	};
	/** Avatar kroku — iniciály přiřazeného, ◇ pro roli, ? pro nepřiřazený (prototyp whoInitials/nextWho). */
	const stepAvatar = (st: ChainStepLite) => {
		const uid = st.task_id ? assigneesByTask.get(st.task_id)?.[0] : undefined;
		if (uid) return initials(memberName(uid));
		return stepRole(st) ? "◇" : "?";
	};

	const view = useMemo(() => {
		const tdy = todayISO();
		return (
			(chains ?? [])
				.filter((ch) => ch.project_id && wsProjectIds.has(ch.project_id))
				.map((ch) => {
					const chSteps = (steps ?? []).filter((s) => s.chain_id === ch.id);
					const total = chSteps.length;
					// Progress = jen done (skipped se do X/Y nepočítá — prototyp flowView).
					const done = chSteps.filter((s) => s.step_state === "done").length;
					const now = chSteps.find((s) => s.step_state === "active") ?? null;
					const nowTask = now?.task_id ? taskById.get(now.task_id) : undefined;
					const stuck = !!nowTask?.due_date && nowTask.due_date.slice(0, 10) < tdy;
					const proj = wsProjects.find((p) => p.id === ch.project_id);
					const mine = !!(now?.task_id && meId && assigneesByTask.get(now.task_id)?.includes(meId));
					// „Teď: … · X, Y" — všechna jména čárkou (prototyp ř. 3154).
					const nowWho = now?.task_id
						? (assigneesByTask.get(now.task_id) ?? [])
								.map((uid) => memberName(uid))
								.filter(Boolean)
								.join(", ") || t("flows.anyoneTeam")
						: "";
					return {
						ch,
						chSteps,
						total,
						done,
						now,
						nowTask,
						nowWho,
						stuck,
						proj,
						mine,
					};
				})
				// Vázne první, pak dle % postupu (prototyp ř. 3155).
				.sort(
					(a, b) =>
						Number(b.stuck) - Number(a.stuck) ||
						(b.total ? b.done / b.total : 0) - (a.total ? a.done / a.total : 0),
				)
		);
	}, [chains, steps, taskById, wsProjectIds, wsProjects, assigneesByTask, meId, memberName, t]);

	const shown = mineOnly ? view.filter((v) => v.mine) : view;
	const selected = search.postup ? (view.find((v) => v.ch.id === search.postup) ?? null) : null;

	return (
		<div className="mx-auto max-w-[920px]" style={{ padding: "20px 22px 90px" }}>
			{/* header */}
			<div className="mb-0.5 flex items-center gap-2">
				<h1 className="font-display font-extrabold text-ink" style={{ fontSize: 17 }}>
					{t("flows.heading")}
				</h1>
				{/* aktivní prostor (prototyp ř. 775–777) */}
				<span
					className="shrink-0"
					style={{
						width: 8,
						height: 8,
						borderRadius: 3,
						marginLeft: 4,
						background: activeWsInfo?.color ?? "var(--w-ink-3)",
					}}
				/>
				<span className="font-display font-semibold text-ink-3" style={{ fontSize: 13 }}>
					{activeWsInfo?.name ?? ""}
				</span>
				<button
					type="button"
					onClick={() => setMineOnly((o) => !o)}
					className="ml-auto inline-flex items-center gap-1.5 rounded-lg border font-display font-semibold"
					style={{
						fontSize: 12,
						padding: "7px 11px",
						borderColor: mineOnly ? "var(--w-brass)" : "var(--w-line)",
						color: mineOnly ? "var(--w-brass-text)" : "var(--w-ink-2)",
						background: mineOnly ? "var(--w-brass-soft)" : "transparent",
					}}
				>
					<span
						className="rounded-full"
						style={{ width: 6, height: 6, background: "var(--w-brass)" }}
					/>
					{t("flows.mineOnly")}
				</button>
				<button
					type="button"
					onClick={() => setModalOpen(true)}
					className="inline-flex items-center gap-1.5 rounded-[10px] font-display font-bold text-white hover:brightness-105"
					style={{
						background: "var(--w-brass)",
						padding: "8px 14px",
						fontSize: 13,
					}}
				>
					+ {t("flows.newFlow")}
				</button>
			</div>
			<p className="mb-4 max-w-[60ch] font-body text-ink-3" style={{ fontSize: 13 }}>
				{t("flows.subtitle")}
			</p>

			{projectsLoading || chainsLoading || stepsLoading || tasksLoading || assignmentsLoading ? (
				<DataLoading />
			) : view.length === 0 ? (
				<div className="text-center" style={{ padding: "60px 20px" }}>
					<div className="font-body text-ink-3" style={{ fontSize: 14 }}>
						{t("flows.empty")}
					</div>
					<button
						type="button"
						onClick={() => setModalOpen(true)}
						className="mt-3.5 rounded-[10px] font-display font-bold text-white hover:brightness-105"
						style={{
							background: "var(--w-brass)",
							padding: "9px 16px",
							fontSize: 13,
						}}
					>
						+ {t("flows.newFlow")}
					</button>
				</div>
			) : (
				<div
					className="grid gap-3"
					style={{
						gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
					}}
				>
					{shown.map(({ ch, total, done, now, nowTask, nowWho, stuck, proj }) => (
						<button
							key={ch.id}
							type="button"
							onClick={() => void navigate({ to: "/postupy", search: { postup: ch.id } })}
							className="hover:-translate-y-0.5 rounded-[14px] border border-line bg-card text-left transition-all hover:shadow-md"
							style={{
								padding: "15px 16px",
								boxShadow: "var(--w-shadow-sm)",
							}}
						>
							<div className="flex items-center gap-2">
								<span
									className="shrink-0 rounded-full"
									style={{
										width: 9,
										height: 9,
										background: proj?.color ?? "var(--w-line)",
									}}
								/>
								<span
									className="min-w-0 flex-1 truncate font-display font-bold text-ink"
									style={{ fontSize: 14.5 }}
								>
									{ch.name}
								</span>
								<span className="shrink-0 font-mono text-ink-3" style={{ fontSize: 12 }}>
									{done}/{total}
								</span>
							</div>
							<div
								className="overflow-hidden rounded-[3px] bg-panel-2"
								style={{ height: 6, margin: "12px 0 10px" }}
							>
								<div
									style={{
										height: "100%",
										width: `${total ? Math.round((done / total) * 100) : 0}%`,
										background: stuck ? "var(--w-overdue)" : "var(--w-brass)",
									}}
								/>
							</div>
							{now && (
								<div className="flex items-center gap-1.5">
									<span
										className="shrink-0 rounded-full"
										style={{
											width: 7,
											height: 7,
											background: "var(--w-brass)",
										}}
									/>
									<span
										className="min-w-0 truncate font-body text-ink-2"
										style={{ fontSize: 12.5 }}
									>
										{t("flows.now")} {nowTask?.name ?? ""} · {nowWho}
									</span>
								</div>
							)}
							{stuck && (
								<div
									className="mt-2 inline-flex items-center gap-1.5 rounded-full font-display font-semibold"
									style={{
										fontSize: 11,
										padding: "3px 9px",
										background: "rgba(194,71,60,.13)",
										color: "var(--w-overdue)",
									}}
								>
									⚠ {t("flows.stuck")}
								</div>
							)}
						</button>
					))}
				</div>
			)}

			{modalOpen && (
				<FlowModal
					projects={wsProjects}
					onClose={() => setModalOpen(false)}
					onCreated={(chainId) => void navigate({ to: "/postupy", search: { postup: chainId } })}
				/>
			)}

			{selected && (
				<FlowDetail
					data={selected}
					taskById={taskById}
					stepWho={stepWho}
					stepAvatar={stepAvatar}
					meId={meId}
					onClose={() => void navigate({ to: "/postupy", search: {} })}
				/>
			)}
		</div>
	);
}

/** Detail postupu — časová osa kroků + relay avataři + advance akce. */
function FlowDetail({
	data,
	taskById,
	stepWho,
	stepAvatar,
	meId,
	onClose,
}: {
	data: {
		ch: ChainRow;
		chSteps: StepFull[];
		total: number;
		done: number;
		now: StepFull | null;
		stuck: boolean;
	};
	taskById: Map<string, TaskRow>;
	stepWho: (st: ChainStepLite) => string;
	/** Avatar kroku — iniciály / ◇ (role) / ? (nepřiřazený) — prototyp flowView. */
	stepAvatar: (st: ChainStepLite) => string;
	meId: string | undefined;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const { open: openTask, openId } = useTaskDetail();
	const { ch, chSteps, total, done, now } = data;
	const [pendingRewind, setPendingRewind] = useState<string | null>(null);
	const [activatingManual, setActivatingManual] = useState<string | null>(null);
	const skipWk = !!ch.skip_weekend;
	// data-esc-layer signalizuje otevřenou vrstvu (kbNav/BulkBar), ale JEN dokud nad ní
	// nestojí detail úkolu (openId) — jinak by blunt Esc-guard detailu (querySelector) našel
	// naši vrstvu a zablokoval si vlastní zavření. Vzor NotifCenter.
	const escLayer = openId ? undefined : "";
	const completeStep = useCallback(
		async (st: StepFull) => {
			const tk = st.task_id ? taskById.get(st.task_id) : undefined;
			if (!tk) return;
			// Přes toggleTask (ne přímý UPDATE): dopočítá R9 status_id, u shared_all srovná
			// per-osoba assignments (R2), zapíše undo a sám posune postup.
			await toggleTask(tk, meId);
		},
		[taskById, meId],
	);

	// Otevření detailu = idempotentní oprava stavu kroků z tasks.completed_at (napraví drift ze
	// souběžných offline změn; zapisuje jen když se stav liší → obvykle no-op).
	useEffect(() => {
		void repairChain(ch.id);
	}, [ch.id]);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			// Nad detailem stojí vyšší vrstva (detail úkolu = openId, ⌘K/modal = data-esc-layer):
			// Esc ani Enter nesmí propadnout sem, jinak Enter dokončí krok / Esc zavře postup
			// pod otevřeným detailem úkolu (vzor sourozeneckých overlayů).
			if (openId || document.querySelector("[data-esc-layer]:not([data-flow-layer])")) return;
			if (e.key === "Escape") {
				onClose();
				return;
			}
			// Enter dokončí aktivní krok (prototyp ř. 2227).
			const el = document.activeElement as HTMLElement | null;
			const typing =
				!!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
			if (e.key === "Enter" && !typing && now?.task_id) {
				e.preventDefault();
				void completeStep(now);
			}
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose, now, openId, completeStep]);

	/** Uložit jako šablonu (prototyp saveFlowAsTemplate, ř. 2495) — per-user do localStorage. */
	const STATE_LABEL: Record<string, string> = {
		dormant: t("flows.stepWaiting"),
		active: t("flows.stepNow"),
		done: t("flows.stepDone"),
		skipped: t("flows.stepSkipped"),
	};
	const dues = chSteps
		.map((s) => (s.task_id ? taskById.get(s.task_id)?.due_date : null))
		.filter(Boolean) as string[];
	const eta = dues.length
		? `${t("flows.etaCca")} ${fmtDay(dues.sort()[dues.length - 1] ?? null)}`
		: "";

	const activateManual = async (st: StepFull) => {
		if (activatingManual) return;
		setActivatingManual(st.id);
		try {
			await activateStepManually(st);
		} catch (error) {
			showToast(
				t("flows.manualActivationError", {
					code: error instanceof Error ? error.message : "manual_activation_failed",
				}),
			);
		} finally {
			setActivatingManual(null);
		}
	};

	return (
		<>
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={onClose}
				className="fixed inset-0"
				style={{ background: "rgba(10,14,20,.34)", zIndex: 42 }}
			/>
			<div
				data-esc-layer={escLayer}
				data-flow-layer={escLayer}
				className="fixed top-0 right-0 bottom-0 flex flex-col border-line border-l bg-card"
				style={{
					width: 470,
					maxWidth: "94vw",
					boxShadow: "var(--w-shadow)",
					zIndex: 43,
				}}
			>
				{/* hlavička */}
				<div className="shrink-0 border-line border-b" style={{ padding: "18px 20px 16px" }}>
					<div className="flex items-center gap-2.5">
						<span
							className="flex shrink-0 items-center justify-center rounded-lg"
							style={{
								width: 26,
								height: 26,
								background: "var(--w-brass-soft)",
								color: "var(--w-brass-text)",
							}}
						>
							<Icon name="postup" size={14} />
						</span>
						<div className="min-w-0 flex-1">
							<div
								className="font-display font-bold text-ink-3 uppercase"
								style={{ fontSize: 10, letterSpacing: ".06em" }}
							>
								{t("flows.panelKind")}
							</div>
							<div
								className="truncate font-display font-extrabold text-ink"
								style={{ fontSize: 18, lineHeight: 1.15 }}
							>
								{ch.name}
							</div>
						</div>
						<span className="shrink-0 font-mono text-ink" style={{ fontSize: 15 }}>
							{done}/{total}
						</span>
						<button
							type="button"
							onClick={onClose}
							aria-label={t("common.cancel")}
							className="flex shrink-0 text-ink-3 hover:text-ink"
						>
							<Icon name="zavrit" size={16} />
						</button>
					</div>
					<div
						className="overflow-hidden rounded-full bg-panel-2"
						style={{ height: 6, marginTop: 12 }}
					>
						<div
							style={{
								height: "100%",
								width: `${total ? Math.round((done / total) * 100) : 0}%`,
								background: "var(--w-brass)",
							}}
						/>
					</div>
					{now && (
						<div className="font-body text-brass-text" style={{ fontSize: 12.5, marginTop: 9 }}>
							{t("flows.nowTurn")} <strong>{stepWho(now)}</strong>
						</div>
					)}
					{eta && (
						<div className="font-body text-ink-3" style={{ fontSize: 12, marginTop: 4 }}>
							{t("flows.eta")} <strong style={{ color: "var(--w-ink-2)" }}>{eta}</strong>
						</div>
					)}

					{/* PLÁNOVÁNÍ — jen posun celé štafety ±1d + Bez víkendů (jeden model: kaskáda) */}
					<div className="mt-3 flex flex-wrap items-center" style={{ gap: 7 }}>
						<span
							className="font-display font-bold text-ink-3 uppercase"
							style={{ fontSize: 10, letterSpacing: ".05em" }}
						>
							{t("flows.planning")}
						</span>
						{/* ±1d — posun celé štafety */}
						<button
							type="button"
							title={t("flows.shiftEarlier")}
							onClick={() => void shiftChain(ch.id, -1)}
							className="cursor-pointer rounded-[8px] border border-line font-bold font-display text-ink-2 hover:border-brass"
							style={{ fontSize: 12, padding: "5px 9px" }}
						>
							−1 d
						</button>
						<button
							type="button"
							title={t("flows.shiftLater")}
							onClick={() => void shiftChain(ch.id, 1)}
							className="cursor-pointer rounded-[8px] border border-line font-bold font-display text-ink-2 hover:border-brass"
							style={{ fontSize: 12, padding: "5px 9px" }}
						>
							+1 d
						</button>
						<button
							type="button"
							onClick={() => void toggleChainWeekend(ch.id)}
							className="cursor-pointer rounded-[8px] font-display font-semibold hover:border-brass"
							style={{
								fontSize: 11.5,
								padding: "5px 10px",
								border: `1px solid ${skipWk ? "var(--w-brass)" : "var(--w-line)"}`,
								background: skipWk ? "var(--w-brass-soft)" : "transparent",
								color: skipWk ? "var(--w-brass-text)" : "var(--w-ink-2)",
							}}
						>
							{t("flows.noWeekends")}
						</button>
					</div>
					<div
						className="font-body text-ink-3"
						style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}
					>
						{t("flows.chainHint")}
					</div>
				</div>

				{/* osa kroků */}
				<div className="flex-1 overflow-auto" style={{ padding: "16px 20px 30px" }}>
					{chSteps.map((st, i) => {
						const tk = st.task_id ? taskById.get(st.task_id) : undefined;
						const sk = st.step_state ?? "dormant";
						const dotBg =
							sk === "done"
								? "var(--w-success-ink)"
								: sk === "active"
									? "var(--w-brass)"
									: "var(--w-panel-2)";
						const dotFg = sk === "dormant" || sk === "skipped" ? "var(--w-ink-3)" : "#fff";
						const next = chSteps[i + 1];
						return (
							<div key={st.id} className="flex" style={{ gap: 13 }}>
								{/* osa */}
								<div className="flex shrink-0 flex-col items-center" style={{ width: 26 }}>
									<span
										className="flex shrink-0 items-center justify-center rounded-full font-bold font-mono"
										style={{
											width: 26,
											height: 26,
											fontSize: 12,
											background: dotBg,
											color: dotFg,
											// waiting tečka s rámečkem (prototyp CSS ř. 126) — skipped bez něj
											border: sk === "dormant" ? "1px solid var(--w-line)" : undefined,
										}}
									>
										{(st.position ?? i) + 1}
									</span>
									{i < chSteps.length - 1 && (
										<>
											<span
												className="shrink-0 bg-line"
												style={{ width: 2, height: 12, marginTop: 3 }}
											/>
											<span
												title={`${t("flows.handsTo")} ${next ? stepWho(next) : ""}`}
												className="flex shrink-0 items-center justify-center rounded-full font-bold font-mono text-white"
												style={{
													width: 19,
													height: 19,
													background: "var(--w-avatar)",
													fontSize: 8.5,
													margin: "2px 0",
												}}
											>
												{next ? stepAvatar(next) : "?"}
											</span>
											<span
												className="flex-1 bg-line"
												style={{ width: 2, minHeight: 12, marginBottom: 3 }}
											/>
										</>
									)}
								</div>
								{/* karta kroku — active: brass-soft bg; dormant: ztlumení (CSS ř. 121–129) */}
								<div
									className="min-w-0 flex-1 rounded-xl border"
									style={{
										padding: "12px 13px",
										marginBottom: 12,
										borderColor: sk === "active" ? "var(--w-brass)" : "var(--w-line)",
										background: sk === "active" ? "var(--w-brass-soft)" : undefined,
										opacity: sk === "dormant" ? 0.66 : 1,
									}}
								>
									<div className="flex items-start gap-2">
										<div className="min-w-0 flex-1">
											{/* název kroku = odkaz do plného detailu úkolu (všechny atributy: priorita/termín/přiřazení/štítky/podúkoly) */}
											<button
												type="button"
												onClick={() => tk && openTask(tk.id)}
												disabled={!tk}
												title={t("flows.openTaskDetail")}
												className="block max-w-full truncate text-left font-display font-bold text-ink hover:text-brass-text"
												style={{ fontSize: 14.5 }}
											>
												{tk?.name ?? ""}
											</button>
											<div className="mt-1 flex flex-wrap items-center gap-2">
												<span
													className="inline-flex items-center gap-1.5 font-body text-ink-3"
													style={{ fontSize: 12 }}
												>
													<span
														className="flex items-center justify-center rounded-full font-display font-semibold text-white"
														style={{
															width: 18,
															height: 18,
															background: "var(--w-avatar)",
															fontSize: 9,
														}}
													>
														{stepAvatar(st)}
													</span>
													{stepWho(st)}
												</span>
												<span
													className="rounded-full border border-line font-display font-semibold text-ink-2"
													style={{ fontSize: 10.5, padding: "1px 7px" }}
												>
													P{tk?.priority ?? 4}
												</span>
												{tk?.due_date && (
													<span className="font-mono text-ink-3" style={{ fontSize: 11 }}>
														{fmtDay(tk.due_date)}
													</span>
												)}
											</div>
										</div>
										<span
											className="shrink-0 whitespace-nowrap rounded-full font-display font-semibold"
											style={{
												fontSize: 10.5,
												padding: "2px 9px",
												border: `1px solid ${sk === "active" ? "var(--w-brass)" : sk === "done" ? "transparent" : "var(--w-line)"}`,
												background:
													sk === "active"
														? "var(--w-brass-soft)"
														: sk === "done"
															? "var(--w-success-soft)"
															: "var(--w-panel-2)",
												color:
													sk === "active"
														? "var(--w-brass-text)"
														: sk === "done"
															? "var(--w-success-ink)"
															: "var(--w-ink-3)",
												opacity: sk === "dormant" ? 0.85 : 1,
											}}
										>
											{STATE_LABEL[sk]}
										</span>
									</div>
									<div className="mt-2.5 flex items-center justify-end gap-2">
										{sk === "dormant" && st.gate === "manual" && (
											<button
												type="button"
												onClick={() => void activateManual(st)}
												disabled={!!activatingManual}
												className="rounded-lg border border-brass font-display font-bold text-brass-text"
												style={{
													padding: "6px 13px",
													fontSize: 12,
													opacity: activatingManual ? 0.55 : 1,
												}}
											>
												{activatingManual === st.id
													? t("flows.activatingManual")
													: t("flows.activateManual")}
											</button>
										)}
										{sk === "active" && (
											<button
												type="button"
												onClick={() => void completeStep(st)}
												className="rounded-lg font-display font-bold text-white hover:brightness-105"
												style={{
													background: "var(--w-brass)",
													padding: "6px 13px",
													fontSize: 12,
												}}
											>
												{t("flows.completeStep")}
											</button>
										)}
										{sk === "done" &&
											(pendingRewind === st.id ? (
												<>
													<button
														type="button"
														onClick={() => {
															void rewindToStep(st);
															setPendingRewind(null);
														}}
														className="rounded-lg font-display font-bold text-white"
														style={{
															background: "var(--w-overdue)",
															padding: "5px 11px",
															fontSize: 12,
														}}
													>
														{t("flows.rewindConfirm")}
													</button>
													<button
														type="button"
														onClick={() => setPendingRewind(null)}
														className="font-display font-semibold text-ink-3"
														style={{ padding: "5px 9px", fontSize: 12 }}
													>
														{t("flows.rewindCancel")}
													</button>
												</>
											) : (
												<button
													type="button"
													onClick={() => setPendingRewind(st.id)}
													className="rounded-lg border border-line font-display font-semibold text-ink-2 hover:border-brass"
													style={{ padding: "5px 11px", fontSize: 12 }}
												>
													{t("flows.rewind")}
												</button>
											))}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</>
	);
}

/** Builder „Nový postup" — název/projekt/kotva/plánování/šablony/kroky → chain+steps+tasky. */
function FlowModal({
	projects,
	onClose,
	onCreated,
}: {
	projects: { id: string; name: string | null; workspace_id: string | null }[];
	onClose: () => void;
	/** Po založení → otevřít detail nového postupu (prototyp createFlow, ř. 2553). */
	onCreated: (chainId: string) => void;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
	const [anchor, setAnchor] = useState(addDays(todayISO(), 7));
	const [tpl, setTpl] = useState<string | null>(null);
	const [rows, setRows] = useState<
		{
			id: string;
			name: string;
			offset: number;
			priority: number;
			gate: string;
			who: string[];
			role: string;
			mode: "any" | "all";
			project: string;
		}[]
	>([]);
	const [members, setMembers] = useState<Member[]>([]);
	const allTemplates = useMemo(() => [...savedTemplates(), ...TEMPLATES], []);

	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);

	// R5 — po změně projektu vyčistit přiřazení kroků: staré who[] míří na členy předchozího
	// projektu, kteří v novém nejsou (a v UI zmizí, takže je nelze odškrtnout) → insert by
	// jinak založil assignments pro ne-členy cílového projektu.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset jen na změnu projektu
	useEffect(() => {
		setRows((rs) => rs.map((r) => (r.who.length ? { ...r, who: [] } : r)));
	}, [projectId]);

	// Členové zvoleného projektu (přiřazení kroků).
	useEffect(() => {
		if (!projectId) return;
		let dead = false;
		void (async () => {
			const r = await fetch(`${API_URL}/api/projects/${projectId}/members`, {
				credentials: "include",
			});
			if (r.ok && !dead) setMembers((await r.json()).members as Member[]);
		})();
		return () => {
			dead = true;
		};
	}, [projectId]);

	const pick = (id: string) => {
		const tp = allTemplates.find((x) => x.id === id);
		if (!tp) return;
		setTpl(id);
		setName((n) => n.trim() || tp.label);
		// mode se přenáší ze šablony (prototyp pickFlowTemplate kopíruje kroky vč. mode)
		setRows(
			tp.steps.map((s) => ({
				...s,
				id: crypto.randomUUID(),
				who: [],
				role: "",
				mode: s.mode ?? "any",
				project: "",
			})),
		);
	};

	// jeden model = od data startu (deadline-mode zrušen)
	const effAnchor = anchor;

	const create = async () => {
		const nm = name.trim();
		if (!nm || rows.length === 0 || !projectId || !isValidISO(anchor)) return;
		const proj = projects.find((p) => p.id === projectId);
		const chainId = crypto.randomUUID();
		// Lokální atomicita: chain + úkoly kroků + chain_steps + přiřazení v JEDNÉ transakci.
		// Pád uprostřed jinak nechá prázdný „aktivní" postup nebo úkoly-sirotky bez kroků (V6).
		await powerSync.writeTransaction(async (tx) => {
			await tx.execute(
				`INSERT INTO chains (id, project_id, workspace_id, name, anchor_date, state, sched_mode, skip_weekend, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', 'chain', 0, ?)`,
				[chainId, projectId, proj?.workspace_id ?? null, nm, effAnchor, new Date().toISOString()],
			);
			for (let i = 0; i < rows.length; i++) {
				const r = rows[i];
				if (!r) continue;
				const taskId = crypto.randomUUID();
				const due = addDays(effAnchor, r.offset);
				// per-krok projekt (předání mezi projekty) — default projekt řetězce
				const stepProject = r.project || projectId;
				// první krok active; souvislé with_previous za ním taky
				let state = "dormant";
				if (i === 0) state = "active";
				else if (rows.slice(1, i + 1).every((x, j) => j + 1 <= i && x.gate === "with_previous"))
					state = "active";
				// 1 osoba = single; víc osob = Kdokoli (shared_any) / Všichni (shared_all)
				const assignMode =
					r.who.length <= 1 ? "single" : r.mode === "all" ? "shared_all" : "shared_any";
				await tx.execute(
					`INSERT INTO tasks (id, project_id, name, description, priority, due_date, assignment_mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						taskId,
						stepProject,
						r.name.trim() || t("flows.stepFallback", { n: i + 1 }),
						r.role ? `Role: ${r.role}` : null,
						r.priority,
						due,
						assignMode,
						new Date().toISOString(),
					],
				);
				const prevOffset = i > 0 ? (rows[i - 1]?.offset ?? 0) : 0;
				await tx.execute(
					`INSERT INTO chain_steps (id, chain_id, task_id, project_id, position, gate, step_state,
          anchor_offset, gap_days, activated_at, created_at)
         VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						chainId,
						taskId,
						stepProject,
						i,
						r.gate,
						state,
						r.offset,
						i === 0 ? 0 : r.offset - prevOffset,
						state === "active" ? new Date().toISOString() : null,
						new Date().toISOString(),
					],
				);
				for (const uid of r.who) {
					await tx.execute(
						"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (uuid(), ?, ?, ?, ?)",
						[taskId, stepProject, uid, new Date().toISOString()],
					);
				}
			}
		});
		onCreated(chainId);
		onClose();
	};

	const setRow = (i: number, patch: Partial<(typeof rows)[number]>) =>
		setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

	return (
		<>
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={onClose}
				className="fixed inset-0"
				style={{ background: "rgba(10,14,20,.42)", zIndex: 50 }}
			/>
			<div
				className="pointer-events-none fixed inset-0 flex items-start justify-center"
				style={{ zIndex: 51, paddingTop: "7vh" }}
			>
				<div
					className="pointer-events-auto max-h-[86vh] overflow-auto rounded-2xl border border-line bg-card"
					style={{ width: 680, maxWidth: "95vw", boxShadow: "var(--w-shadow)" }}
				>
					<div
						className="sticky top-0 z-10 flex items-center gap-2.5 border-line border-b bg-card"
						style={{ padding: "16px 20px" }}
					>
						<span
							className="flex shrink-0 items-center justify-center rounded-lg"
							style={{
								width: 26,
								height: 26,
								background: "var(--w-brass-soft)",
								color: "var(--w-brass-text)",
							}}
						>
							<Icon name="postup" size={15} />
						</span>
						<span className="font-display font-extrabold text-ink" style={{ fontSize: 16 }}>
							{t("flows.modalTitle")}
						</span>
						<button
							type="button"
							onClick={onClose}
							aria-label={t("common.cancel")}
							className="ml-auto grid h-7 w-7 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
						>
							<Icon name="zavrit" size={15} />
						</button>
					</div>

					<div style={{ padding: "18px 20px" }}>
						<input
							ref={focusOnMount}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("flows.namePlaceholder")}
							className="w-full rounded-[10px] border border-line bg-panel-2 font-display font-semibold text-ink outline-none focus:border-brass"
							style={{ padding: "11px 13px", fontSize: 15 }}
						/>

						<div className="mt-3 flex flex-wrap gap-3">
							<div style={{ flex: 1, minWidth: 180 }}>
								<ModalLabel>{t("flows.project")}</ModalLabel>
								<select
									value={projectId}
									onChange={(e) => setProjectId(e.target.value)}
									className="w-full rounded-[9px] border border-line bg-panel-2 font-body text-ink outline-none"
									style={{ padding: "9px 11px", fontSize: 13 }}
								>
									{projects.map((p) => (
										<option key={p.id} value={p.id}>
											{p.name}
										</option>
									))}
								</select>
							</div>
							<div style={{ width: 190 }}>
								<ModalLabel>{t("flows.anchorStart")}</ModalLabel>
								<input
									type="date"
									value={anchor}
									onChange={(e) => setAnchor(e.target.value)}
									className="w-full rounded-[9px] border bg-panel-2 font-mono text-ink outline-none"
									style={{
										padding: "9px 11px",
										fontSize: 13,
										borderColor: isValidISO(anchor) ? "var(--w-line)" : "var(--w-overdue)",
									}}
								/>
							</div>
						</div>

						{/* šablony */}
						<ModalLabel style={{ margin: "18px 0 8px" }}>{t("flows.templates")}</ModalLabel>
						<div className="grid grid-cols-2 gap-2">
							{allTemplates.map((tp) => (
								<button
									key={tp.id}
									type="button"
									onClick={() => pick(tp.id)}
									className="rounded-[11px] border text-left hover:border-brass"
									style={{
										padding: "11px 13px",
										borderColor: tpl === tp.id ? "var(--w-brass)" : "var(--w-line)",
										background: tpl === tp.id ? "var(--w-brass-soft)" : "var(--w-panel-2)",
									}}
								>
									<div className="font-display font-bold text-ink" style={{ fontSize: 13 }}>
										{tp.label}
									</div>
									<div className="font-body text-ink-3" style={{ fontSize: 11.5, marginTop: 2 }}>
										{tp.desc} · {tp.steps.length} {t("flows.steps")}
									</div>
								</button>
							))}
							<button
								type="button"
								onClick={() => {
									setTpl(null);
									setRows([
										{
											id: crypto.randomUUID(),
											name: "",
											offset: 0,
											priority: 3,
											gate: "after_previous",
											who: [],
											role: "",
											mode: "any",
											project: "",
										},
									]);
								}}
								className="flex items-center justify-center rounded-[11px] border border-line border-dashed font-display font-semibold text-ink-2 hover:border-brass hover:text-ink"
								style={{ padding: "11px 13px", fontSize: 12.5 }}
							>
								{t("flows.blank")}
							</button>
						</div>

						{/* kroky */}
						{rows.length > 0 && (
							<>
								<div className="flex items-center" style={{ margin: "20px 0 8px" }}>
									<span
										className="font-display font-bold text-ink-3 uppercase"
										style={{ fontSize: 10.5, letterSpacing: ".05em" }}
									>
										{t("flows.stepsLabel")}
									</span>
									<span className="ml-2 font-mono text-ink-3" style={{ fontSize: 11 }}>
										{rows.length}
									</span>
								</div>
								{rows.map((r, i) => (
									<div
										key={r.id}
										className="mb-2 rounded-xl border border-line bg-card"
										style={{ padding: "12px 13px" }}
									>
										<div className="flex items-center gap-2">
											<span
												className="flex shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 font-mono text-ink-2"
												style={{ width: 22, height: 22, fontSize: 11 }}
											>
												{i + 1}
											</span>
											<input
												value={r.name}
												onChange={(e) => setRow(i, { name: e.target.value })}
												placeholder={t("flows.stepName")}
												className="min-w-0 flex-1 border-none bg-transparent font-display font-semibold text-ink outline-none"
												style={{ fontSize: 14 }}
											/>
											{/* přesun ↑/↓ (prototyp moveFlowStep) */}
											<button
												type="button"
												onClick={() =>
													setRows((rs) => {
														if (i === 0) return rs;
														const c = [...rs];
														const a = c[i - 1];
														const b = c[i];
														if (a && b) {
															c[i - 1] = b;
															c[i] = a;
														}
														return c;
													})
												}
												className="px-1 text-ink-3 hover:text-ink"
												style={{
													opacity: i === 0 ? 0.4 : 1,
													pointerEvents: i === 0 ? "none" : undefined,
												}}
											>
												↑
											</button>
											<button
												type="button"
												onClick={() =>
													setRows((rs) => {
														if (i >= rs.length - 1) return rs;
														const c = [...rs];
														const a = c[i];
														const b = c[i + 1];
														if (a && b) {
															c[i] = b;
															c[i + 1] = a;
														}
														return c;
													})
												}
												className="px-1 text-ink-3 hover:text-ink"
												style={{
													opacity: i >= rows.length - 1 ? 0.4 : 1,
													pointerEvents: i >= rows.length - 1 ? "none" : undefined,
												}}
											>
												↓
											</button>
											<button
												type="button"
												onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
												aria-label={t("common.cancel")}
												className="px-1 text-ink-3 hover:text-overdue"
											>
												×
											</button>
										</div>
										<div className="mt-2.5 flex flex-wrap items-center gap-2">
											{/* avatarová řada členů (prototyp ř. 1573) */}
											<span className="inline-flex items-center" style={{ gap: 5 }}>
												{members.map((m) => {
													const on = r.who.includes(m.id);
													return (
														<button
															key={m.id}
															type="button"
															title={m.name}
															onClick={() =>
																setRow(i, {
																	who: on ? r.who.filter((x) => x !== m.id) : [...r.who, m.id],
																})
															}
															className="flex items-center justify-center rounded-full font-display font-semibold"
															style={{
																width: 25,
																height: 25,
																fontSize: 9.5,
																color: "#fff",
																background: "var(--w-avatar)",
																opacity: on ? 1 : 0.5,
																boxShadow: on
																	? "0 0 0 2px var(--w-card), 0 0 0 4px var(--w-brass)"
																	: undefined,
																transition: "opacity .12s, box-shadow .12s",
															}}
														>
															{initials(m.name)}
														</button>
													);
												})}
											</span>
											{/* Kdokoli/Všichni — jen když je vybráno víc osob (R2 režim) */}
											{r.who.length > 1 && (
												<button
													type="button"
													title={t("flows.modeR2Title")}
													onClick={() =>
														setRow(i, {
															mode: r.mode === "all" ? "any" : "all",
														})
													}
													className="rounded-full border border-line font-display font-semibold text-ink-2 hover:border-brass"
													style={{ padding: "5px 10px", fontSize: 11 }}
												>
													{r.mode === "all" ? t("addmodal.modeAll") : t("addmodal.modeAny")}
												</button>
											)}
											<span className="ml-auto inline-flex items-center gap-1.5">
												<span className="font-body text-ink-3" style={{ fontSize: 11 }}>
													{t("flows.anchorPlus")}
												</span>
												<input
													type="number"
													min={0}
													max={60}
													value={r.offset}
													onChange={(e) =>
														setRow(i, {
															offset: Number.parseInt(e.target.value, 10) || 0,
														})
													}
													className="rounded-[7px] border border-line bg-panel-2 font-mono text-ink outline-none"
													style={{
														width: 48,
														padding: "5px 6px",
														fontSize: 12,
													}}
												/>
												<span
													className="whitespace-nowrap font-mono text-brass-text"
													style={{ fontSize: 11 }}
												>
													{fmtDay(addDays(effAnchor, r.offset))}
												</span>
												<select
													value={r.priority}
													onChange={(e) =>
														setRow(i, {
															priority: Number.parseInt(e.target.value, 10),
														})
													}
													className="rounded-[7px] border border-line bg-panel-2 font-display font-semibold text-ink outline-none"
													style={{ padding: "5px 4px", fontSize: 11 }}
												>
													{[1, 2, 3, 4].map((p) => (
														<option key={p} value={p}>
															P{p}
														</option>
													))}
												</select>
											</span>
										</div>
									</div>
								))}
								<button
									type="button"
									onClick={() =>
										setRows((rs) => [
											...rs,
											{
												id: crypto.randomUUID(),
												name: "",
												offset: (rs[rs.length - 1]?.offset ?? 0) + 1,
												priority: 3,
												gate: "after_previous",
												who: [],
												role: "",
												mode: "any",
												project: "",
											},
										])
									}
									className="inline-flex items-center gap-1.5 font-display font-semibold text-brass-text hover:underline"
									style={{ fontSize: 13, padding: "4px 2px" }}
								>
									{t("flows.addStep")}
								</button>
							</>
						)}
					</div>

					<div
						className="sticky bottom-0 flex items-center gap-2.5 border-line border-t bg-card"
						style={{ padding: "14px 20px" }}
					>
						<span className="font-body text-ink-3" style={{ fontSize: 12 }}>
							{t("flows.footer", { count: rows.length })}
						</span>
						<button
							type="button"
							onClick={onClose}
							className="ml-auto rounded-[10px] border border-line font-display font-semibold text-ink-2 hover:border-ink-3"
							style={{ padding: "9px 15px", fontSize: 13 }}
						>
							{t("flows.cancel")}
						</button>
						<button
							type="button"
							onClick={() => void create()}
							disabled={!name.trim() || rows.length === 0 || !isValidISO(anchor)}
							className="rounded-[10px] font-display font-bold text-white hover:brightness-105 disabled:opacity-50"
							style={{
								background: "var(--w-brass)",
								padding: "9px 17px",
								fontSize: 13,
							}}
						>
							{t("flows.create")}
						</button>
					</div>
				</div>
			</div>
		</>
	);
}

function ModalLabel({ children, style }: { children: string; style?: React.CSSProperties }) {
	return (
		<div
			className="mb-1.5 font-display font-bold text-ink-3 uppercase"
			style={{ fontSize: 10.5, letterSpacing: ".05em", ...style }}
		>
			{children}
		</div>
	);
}
