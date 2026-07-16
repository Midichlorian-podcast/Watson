import { useQuery as usePsQuery } from "@powersync/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import { USER_COLORS } from "../lib/colors";
import { initials } from "../lib/format";
import type { ProjectRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { useProjectDetail } from "../lib/projectDetail";
import { showToast } from "../lib/toast";
import { CopyLinkButton } from "./CopyLinkButton";

type Member = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	role?: "manager" | "editor" | "commenter";
};
const KINDS = [
	["flow", "kindFlow"],
	["goal", "kindGoal"],
	["cycle", "kindCycle"],
] as const;
const STATUSES = [
	["active", "statusActive"],
	["paused", "statusPaused"],
	["archive", "statusArchived"],
	["done", "statusDone"],
] as const;
const ProjectMilestonesSection = lazy(() => import("./ProjectMilestonesSection"));

/** Patch sloupců projektu (write-path: tabulka `projects`, self-členství). */
export async function patchProject(id: string, data: Record<string, unknown>) {
	const cols = Object.keys(data);
	if (cols.length === 0) return;
	const sets = cols.map((c) => `${c} = ?`).join(", ");
	await powerSync.execute(`UPDATE projects SET ${sets} WHERE id = ?`, [
		...cols.map((c) => data[c]),
		id,
	]);
}

export function ProjectDetailPanel() {
	const { openId, close } = useProjectDetail();
	const navigate = useNavigate();
	if (!openId) return null;
	return (
		<Panel
			id={openId}
			onClose={() => {
				close();
				if (location.pathname === "/projekty")
					void navigate({ to: "/projekty", search: {} });
			}}
		/>
	);
}

function Panel({ id, onClose }: { id: string; onClose: () => void }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	// Esc zavře panel (prototyp: Esc zavírá selectedProject) — ale ne když je nad
	// panelem otevřená vyšší vrstva (modal/paleta/tahák s data-esc-layer).
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (document.querySelector("[data-esc-layer]")) return;
			onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);
	const { data: rows } = usePsQuery<ProjectRow>("SELECT * FROM projects WHERE id = ? LIMIT 1", [
		id,
	]);
	const project = rows?.[0];
	const { data: stats } = usePsQuery<{ total: number; done: number }>(
		"SELECT count(*) AS total, count(completed_at) AS done FROM tasks WHERE project_id = ?",
		[id],
	);
	const { data: team } = useQuery({
		queryKey: ["projectDetailMembers", id],
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/projects/${id}/members`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("members");
			return (await r.json()) as { members: Member[]; canEdit: boolean; canManage: boolean };
		},
	});
	// roster prostoru — Vlastník i Členové nabízejí VŠECHNY lidi prostoru (prototyp ř. 3134/3138)
	const wsId = project?.workspace_id ?? null;
	const { data: roster } = useQuery({
		queryKey: ["wsMembersFull", wsId],
		enabled: !!wsId,
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/workspaces/${wsId}/members`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("members");
			return (await r.json()).members as Member[];
		},
	});
	const qc = useQueryClient();
	// toggle člena projektu (prototyp toggleProjMember, ř. 2380) — POST/DELETE na server
	const memberMut = useMutation({
		mutationFn: async ({ userId, isMember }: { userId: string; isMember: boolean }) => {
			const r = await fetch(
				isMember
					? `${API_URL}/api/projects/${id}/members/${userId}`
					: `${API_URL}/api/projects/${id}/members`,
				isMember
					? { method: "DELETE", credentials: "include" }
					: {
							method: "POST",
							credentials: "include",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ userId }),
						},
			);
			if (!r.ok) throw new Error("member");
		},
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["projectDetailMembers", id] }),
		onError: () => showToast(t("projects.memberChangeError")),
	});

	const [name, setName] = useState("");
	const [dod, setDod] = useState("");
	// P1 (audit 9) — explicitní edit mode: VŠECHNY změny jdou do draftu a zapíšou
	// se až tlačítkem Uložit; Zrušit je zahodí. Konec auto-ukládání barvy/typu/
	// vlastníka/stavu/členů, po kterém „Zrušit" nemělo co vracet.
	const [color, setColor] = useState<string | null>(null);
	const [kindDraft, setKindDraft] = useState<string>("flow");
	const [ownerId, setOwnerId] = useState<string | null>(null);
	const [statusDraft, setStatusDraft] = useState<string>("active");
	const [delivery, setDelivery] = useState<string>("");
	const [milestonesEnabled, setMilestonesEnabled] = useState(false);
	const [urgentAcceptanceEnabled, setUrgentAcceptanceEnabled] = useState(false);
	const [urgentAcceptancePriority, setUrgentAcceptancePriority] = useState<1 | 2>(1);
	const [saving, setSaving] = useState(false);
	// členové: null = nedotčeno (platí serverový stav)
	const [memberDraft, setMemberDraft] = useState<Set<string> | null>(null);
	const resetDraft = useCallback(() => {
		if (!project) return;
		setName(project.name ?? "");
		setDod(project.definition_of_done ?? "");
		setColor(project.color ?? null);
		setKindDraft(project.kind ?? "flow");
		setOwnerId(project.owner_id ?? null);
		setStatusDraft(project.status ?? "active");
		setDelivery(project.delivery_date ? project.delivery_date.slice(0, 10) : "");
		setMilestonesEnabled(Boolean(project.milestones_enabled));
		setUrgentAcceptanceEnabled(Boolean(project.urgent_acceptance_enabled));
		setUrgentAcceptancePriority(project.urgent_acceptance_priority === 2 ? 2 : 1);
		setMemberDraft(null);
	}, [project]);
	// re-seed jen při přepnutí projektu — příchozí sync nesmí přepsat rozepsaný draft
	// biome-ignore lint/correctness/useExhaustiveDependencies: seed jen při změně id / načtení
	useEffect(() => {
		resetDraft();
	}, [id, project == null]);

	if (!project) return null;
	const total = stats?.[0]?.total ?? 0;
	const done = stats?.[0]?.done ?? 0;
	const openCount = total - done;
	const members = team?.members ?? [];
	const canEdit = team?.canEdit ?? false;
	const canManage = team?.canManage ?? false;
	const people = roster ?? [];
	const serverMemberIds = new Set(members.map((m) => m.id));
	const memberIds = memberDraft ?? serverMemberIds;
	const dot = color ?? "var(--w-ink-3)";
	const kind = kindDraft;
	const status = statusDraft;
	const showGoal = kind === "goal" || kind === "cycle";
	const owner = people.find((m) => m.id === ownerId);
	const dirty =
		name.trim() !== (project.name ?? "") ||
		dod !== (project.definition_of_done ?? "") ||
		color !== (project.color ?? null) ||
		kind !== (project.kind ?? "flow") ||
		ownerId !== (project.owner_id ?? null) ||
		status !== (project.status ?? "active") ||
		delivery !== (project.delivery_date ? project.delivery_date.slice(0, 10) : "") ||
		milestonesEnabled !== Boolean(project.milestones_enabled) ||
		urgentAcceptanceEnabled !== Boolean(project.urgent_acceptance_enabled) ||
		urgentAcceptancePriority !== (project.urgent_acceptance_priority === 2 ? 2 : 1) ||
		(memberDraft != null &&
			(memberDraft.size !== serverMemberIds.size ||
				[...memberDraft].some((x) => !serverMemberIds.has(x))));
	const save = async () => {
		if (!name.trim()) {
			setName(project.name ?? "");
			return;
		}
		const patch: Record<string, unknown> = {};
		if (name.trim() !== (project.name ?? "")) patch.name = name.trim();
		if (dod !== (project.definition_of_done ?? "")) patch.definition_of_done = dod || null;
		if (color !== (project.color ?? null)) patch.color = color;
		if (kind !== (project.kind ?? "flow")) patch.kind = kind;
		if (ownerId !== (project.owner_id ?? null)) patch.owner_id = ownerId;
		if (status !== (project.status ?? "active")) {
			patch.status = status;
			patch.archived_at = status === "archive" ? new Date().toISOString() : null;
		}
		if (delivery !== (project.delivery_date ? project.delivery_date.slice(0, 10) : ""))
			patch.delivery_date = delivery || null;
		if (milestonesEnabled !== Boolean(project.milestones_enabled))
			patch.milestonesEnabled = milestonesEnabled;
		if (urgentAcceptanceEnabled !== Boolean(project.urgent_acceptance_enabled))
			patch.urgentAcceptanceEnabled = urgentAcceptanceEnabled;
		if (urgentAcceptancePriority !== (project.urgent_acceptance_priority === 2 ? 2 : 1))
			patch.urgentAcceptancePriority = urgentAcceptancePriority;
		setSaving(true);
		try {
			if (Object.keys(patch).length > 0) {
				if (!project.updated_at) {
					showToast(t("projects.settingsStale"));
					return;
				}
				const settings: Record<string, unknown> = { expectedUpdatedAt: project.updated_at };
				if ("name" in patch) settings.name = patch.name;
				if ("definition_of_done" in patch)
					settings.definitionOfDone = patch.definition_of_done;
				if ("color" in patch) settings.color = patch.color;
				if ("kind" in patch) settings.kind = patch.kind;
				if ("owner_id" in patch) settings.ownerId = patch.owner_id;
				if ("status" in patch) settings.status = patch.status;
				if ("delivery_date" in patch) settings.deliveryDate = patch.delivery_date;
				if ("milestonesEnabled" in patch) settings.milestonesEnabled = patch.milestonesEnabled;
				if ("urgentAcceptanceEnabled" in patch)
					settings.urgentAcceptanceEnabled = patch.urgentAcceptanceEnabled;
				if ("urgentAcceptancePriority" in patch)
					settings.urgentAcceptancePriority = patch.urgentAcceptancePriority;
				const response = await fetch(`${API_URL}/api/projects/${id}/settings`, {
					method: "PATCH",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(settings),
				});
				if (!response.ok) {
					const data = (await response.json().catch(() => null)) as { error?: string } | null;
					if (data?.error === "project_milestones_incomplete")
						showToast(t("projects.milestonesIncomplete"));
					else if (data?.error === "stale_project_settings")
						showToast(t("projects.settingsStale"));
					else showToast(t("projects.settingsSaveError"));
					return;
				}
			}
			if (memberDraft) {
				for (const m of people) {
					const want = memberDraft.has(m.id);
					const has = serverMemberIds.has(m.id);
					if (want !== has) await memberMut.mutateAsync({ userId: m.id, isMember: has });
				}
				setMemberDraft(null);
			}
			showToast(t("detail.saved"));
		} catch {
			showToast(t("projects.settingsSaveError"));
		} finally {
			setSaving(false);
		}
	};

	return (
		<>
			<button
				type="button"
				aria-label={t("common.cancel")}
				onClick={onClose}
				className="fixed inset-0 z-30 bg-navy/20"
			/>
			{/* panel 420px, jen 1px levá linka (prototyp ř. 1223 — bez barevného okraje) */}
			<aside
				className="fixed top-0 right-0 z-40 flex h-full flex-col border-line border-l bg-card"
				style={{ width: 420, maxWidth: "94vw", boxShadow: "var(--w-shadow)" }}
			>
				<div className="flex items-center gap-2 border-line border-b px-4 py-3">
					<span className="h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
					<span className="font-display font-semibold text-ink-3 text-sm">
						{t("projects.detailTitle")}
					</span>
					<CopyLinkButton
						entity="project"
						id={id}
						workspaceId={project.workspace_id}
						className="ml-auto"
					/>
					<button
						type="button"
						onClick={onClose}
						aria-label={t("common.cancel")}
						className="grid h-11 w-11 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
					>
						<Icon name="zavrit" size={16} />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto px-4 py-3">
					{/* Název — bordered input (prototyp ř. 1230–1231) */}
					<div
						className="font-display font-bold text-ink-3 uppercase"
						style={{ fontSize: 10.5, letterSpacing: ".06em", marginBottom: 7 }}
					>
						{t("projects.nameLabel")}
					</div>
					<input
						disabled={!canEdit}
						value={name}
						onChange={(e) => setName(e.target.value)}
						className="w-full rounded-[9px] border border-line bg-panel-2 font-display font-bold text-ink outline-none focus:border-brass"
						style={{ padding: "9px 11px", fontSize: 16 }}
					/>

					{/* BARVA */}
					<Section label={t("projects.color")}>
						<div className="flex flex-wrap gap-1.5">
							<button
								type="button"
								disabled={!canEdit}
								onClick={() => setColor(null)}
								className="grid h-11 w-11 place-items-center rounded-lg border border-line text-ink-3 disabled:cursor-not-allowed"
								style={{ background: "var(--w-card)" }}
								aria-label={t("projects.colorDefault")}
							>
								{!color && "✓"}
							</button>
							{USER_COLORS.map((c) => (
								<button
									key={c}
									type="button"
									disabled={!canEdit}
									onClick={() => setColor(c)}
									className="h-11 w-11 rounded-lg disabled:cursor-not-allowed"
									style={{
										background: c,
										outline: color === c ? "2px solid var(--w-avatar)" : "none",
										outlineOffset: "1px",
									}}
									aria-label={c}
								/>
							))}
						</div>
					</Section>

					{/* TYP PROJEKTU */}
					<Section label={t("projects.type")}>
						<div className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-panel-2 p-[3px]">
							{KINDS.map(([k, lbl]) => (
								<Seg key={k} active={kind === k} disabled={!canEdit} onClick={() => setKindDraft(k)}>
									{t(`projects.${lbl}`)}
								</Seg>
							))}
						</div>
					</Section>

					{/* VLASTNÍK — celý roster prostoru (prototyp ř. 1241–1244, owners=PEOPLE) */}
					<Section label={`${t("projects.owner")} · ${owner?.name ?? "—"}`}>
						<div className="flex flex-wrap gap-2">
							{people.map((m) => (
								<PersonAvatar
									key={m.id}
									name={m.name}
									on={m.id === ownerId}
									disabled={!canManage}
									onClick={() => setOwnerId(m.id)}
								/>
							))}
						</div>
					</Section>

					{/* STAV */}
					<Section label={t("projects.status")}>
						<div className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-panel-2 p-[3px]">
							{STATUSES.map(([s, lbl]) => (
								<Seg key={s} active={status === s} disabled={!canManage} onClick={() => setStatusDraft(s)}>
									{t(`projects.${lbl}`)}
								</Seg>
							))}
						</div>
					</Section>

					{/* TERMÍN DODÁNÍ + DEFINICE HOTOVÉHO (goal/cycle) */}
					{showGoal && (
						<>
							<Section label={t("projects.delivery")}>
								<input
									type="date"
									disabled={!canEdit}
									value={delivery}
									onChange={(e) => setDelivery(e.target.value)}
									className="min-h-11 rounded-lg border border-line bg-panel-2 px-2.5 py-2 font-mono text-ink text-xs outline-none focus:border-brass"
								/>
							</Section>
							<Section label={t("projects.dod")}>
								<input
									disabled={!canEdit}
									value={dod}
									onChange={(e) => setDod(e.target.value)}
									placeholder={t("projects.dodPlaceholder")}
									className="min-h-11 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-ink text-sm outline-none focus:border-brass"
								/>
							</Section>
						</>
					)}

					<Suspense fallback={<div className="mt-4 h-16 animate-pulse rounded-xl bg-panel-2" />}>
						<ProjectMilestonesSection
							projectId={id}
							enabled={milestonesEnabled}
							onEnabledChange={setMilestonesEnabled}
							canEdit={canEdit}
							canManage={canManage}
						/>
					</Suspense>

					<Section label={t("projects.urgentAcceptance")}>
						<button
							type="button"
							role="switch"
							aria-checked={urgentAcceptanceEnabled}
							disabled={!canManage}
							onClick={() => setUrgentAcceptanceEnabled((enabled) => !enabled)}
							className="flex min-h-11 w-full items-center rounded-xl border border-line bg-panel-2 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-55"
						>
							<span className="min-w-0 flex-1">
								<span className="block font-display font-semibold text-ink text-sm">
									{t("projects.urgentAcceptanceToggle")}
								</span>
								<span className="mt-0.5 block font-body text-ink-3 text-xs leading-relaxed">
									{t("projects.urgentAcceptanceHelp")}
								</span>
							</span>
							<span
								aria-hidden
								className="ml-3 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5"
								style={{ background: urgentAcceptanceEnabled ? "var(--w-brass)" : "var(--w-line)" }}
							>
								<span
									className="h-5 w-5 rounded-full bg-card shadow-sm transition-transform"
									style={{ transform: urgentAcceptanceEnabled ? "translateX(20px)" : "none" }}
								/>
							</span>
						</button>
						{urgentAcceptanceEnabled && (
							<div className="mt-2 inline-flex flex-wrap gap-1 rounded-lg border border-line bg-panel-2 p-[3px]">
								<Seg
									active={urgentAcceptancePriority === 1}
									disabled={!canManage}
									onClick={() => setUrgentAcceptancePriority(1)}
								>
									{t("projects.urgentAcceptanceP1")}
								</Seg>
								<Seg
									active={urgentAcceptancePriority === 2}
									disabled={!canManage}
									onClick={() => setUrgentAcceptancePriority(2)}
								>
									{t("projects.urgentAcceptanceP2")}
								</Seg>
							</div>
						)}
					</Section>

					{/* ČLENOVÉ — toggle avatarů celého rosteru (prototyp ř. 1255–1257 + toggleProjMember ř. 2380) */}
					<Section label={`${t("projects.membersLabel")} · ${members.length}`}>
						<div className="flex flex-wrap gap-2">
							{people.map((m) => {
								const isMember = memberIds.has(m.id);
								return (
									<PersonAvatar
										key={m.id}
										name={m.name}
										on={isMember}
										disabled={!canManage}
										onClick={() =>
											setMemberDraft((prev) => {
												const next = new Set(prev ?? serverMemberIds);
												if (next.has(m.id)) next.delete(m.id);
												else next.add(m.id);
												return next;
											})
										}
									/>
								);
							})}
						</div>
					</Section>

					{/* STATISTIKY — holá čísla nad popiskem, jen horní linka (prototyp ř. 1259–1262) */}
					<div
						className="flex border-line border-t"
						style={{ gap: 22, marginTop: 22, paddingTop: 16 }}
					>
						<Stat value={openCount} label={t("projects.statOpen")} color="var(--w-ink)" />
						<Stat value={done} label={t("projects.statDone")} color="var(--w-success-ink)" />
						<Stat value={total} label={t("projects.statTotal")} color="var(--w-ink-2)" />
					</div>
				</div>

				{/* patička — explicitní Uložit/Zrušit (P1 audit 9); úkoly projektu nad ní */}
				<div className="border-line border-t bg-card px-4 py-3">
					<button
						type="button"
						onClick={() => {
							onClose();
							void navigate({ to: "/ukoly", search: { projekt: id } });
						}}
						className="mb-2 min-h-11 w-full rounded-lg border border-line px-4 py-2 font-display font-semibold text-ink text-sm hover:border-brass"
					>
						{t("projects.viewTasks")}
					</button>
					<div className="flex gap-2">
						<button
							type="button"
							disabled={!dirty || saving}
							onClick={() => void save()}
							className="min-h-11 flex-1 rounded-lg px-4 py-2 font-display font-semibold text-sm text-white hover:brightness-105 disabled:opacity-45"
							style={{ background: "var(--w-brass)" }}
						>
							{saving ? t("common.saving") : t("projects.saveChanges")}
						</button>
						<button
							type="button"
							onClick={() => {
								resetDraft();
								onClose();
							}}
							className="min-h-11 rounded-lg border border-line px-4 py-2 font-display font-semibold text-ink text-sm hover:border-brass"
						>
							{t("common.cancel")}
						</button>
					</div>
				</div>
			</aside>
		</>
	);
}

function Section({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="mt-4">
			<span className="font-display font-semibold text-ink-3 text-xs uppercase tracking-[0.06em]">
				{label}
			</span>
			<div className="mt-2">{children}</div>
		</div>
	);
}

function Seg({
	active,
	disabled = false,
	onClick,
	children,
}: {
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className="min-h-11 rounded-md px-3 py-1.5 font-display font-semibold text-xs disabled:cursor-not-allowed disabled:opacity-55"
			style={{
				border: active ? "1px solid var(--w-brass)" : "1px solid transparent",
				background: active ? "var(--w-brass-soft)" : "transparent",
				color: active ? "var(--w-brass-text)" : "var(--w-ink-3)",
			}}
		>
			{children}
		</button>
	);
}

/** Klikací avatar osoby — data-person vzor prototypu (CSS ř. 97–98: off opacity .5, on brass ring). */
function PersonAvatar({
	name,
	on,
	disabled = false,
	onClick,
}: {
	name: string;
	on: boolean;
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			title={name}
			onClick={onClick}
			className="grid h-11 w-11 place-items-center rounded-full font-display font-semibold text-[11px] text-white disabled:cursor-not-allowed"
			style={{
				background: "var(--w-avatar)",
				opacity: on ? 1 : 0.5,
				boxShadow: on ? "0 0 0 2px var(--w-card), 0 0 0 4px var(--w-brass)" : "none",
				transition: "opacity .12s, box-shadow .12s",
			}}
		>
			{initials(name)}
		</button>
	);
}

/** Stat detailu projektu — holé číslo (mono 22px) nad popiskem (prototyp ř. 1260–1262). */
function Stat({ value, label, color }: { value: number; label: string; color: string }) {
	return (
		<div>
			<div className="font-mono" style={{ fontSize: 22, color }}>
				{value}
			</div>
			<div className="font-body text-ink-3" style={{ fontSize: 11.5 }}>
				{label}
			</div>
		</div>
	);
}
