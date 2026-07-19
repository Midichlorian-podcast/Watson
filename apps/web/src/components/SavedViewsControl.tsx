import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { useNavigationPins } from "../lib/navigationPins";
import type { FilterRow } from "../lib/powersync/AppSchema";
import {
	makeSavedTaskViewConfig,
	makeSavedUpcomingViewConfig,
	parseSavedTaskViewConfig,
	parseSavedUpcomingViewConfig,
	type SavedViewSurface,
	toolbarStateFromSavedView,
} from "../lib/savedViews";
import { showToast } from "../lib/toast";
import { getDensity, setDensity } from "../lib/tweaks";
import { usePopoverLayer } from "../lib/usePopoverLayer";
import { useViewMode } from "../lib/viewMode";
import { useWorkspace, useWorkspaces } from "../lib/workspace";
import { chipStyle } from "./filterUi";
import type { ToolbarState } from "./TasksToolbar";

export function SavedViewsControl({
	state,
	onChange,
	surface = "tasks",
	workspaceFilter = null,
	onWorkspaceFilterChange,
}: {
	state: ToolbarState;
	onChange: (next: ToolbarState) => void;
	surface?: SavedViewSurface;
	workspaceFilter?: string | null;
	onWorkspaceFilterChange?: (workspaceId: string | null) => void;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as { pohled?: string };
	const { data: session } = useSession();
	const { activeWs } = useWorkspace();
	const { data: workspaces } = useWorkspaces();
	const { view, setView } = useViewMode(surface);
	const { isPinned, setPinned } = useNavigationPins();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [scope, setScope] = useState<"personal" | "team">("personal");
	const [busy, setBusy] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [optimisticRows, setOptimisticRows] = useState<FilterRow[]>([]);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const appliedDeepLinkRef = useRef<string | null>(null);
	const popoverRef = usePopoverLayer<HTMLDivElement>(open, () => setOpen(false), triggerRef);
	const activeWorkspace = workspaces?.find((workspace) => workspace.id === activeWs);
	const canManageTeam = activeWorkspace?.capabilities?.manageGoals === true;

	const { data: rows, isLoading } = usePsQuery<FilterRow>(
		`SELECT * FROM filters
		 WHERE workspace_id = ? AND surface = ? AND query = ?
		 ORDER BY owner_scope DESC, lower(name)`,
		[activeWs ?? "", surface, `${surface}:v1`],
	);
	const syncedRows = useMemo(() => rows ?? [], [rows]);
	const savedViews = useMemo(
		() => [
			...syncedRows,
			...optimisticRows.filter(
				(optimistic) =>
					optimistic.workspace_id === activeWs &&
					optimistic.surface === surface &&
					!syncedRows.some((synced) => synced.id === optimistic.id),
			),
		],
		[activeWs, optimisticRows, surface, syncedRows],
	);
	const activeSavedView = savedViews.find((row) => row.id === activeId) ?? null;

	useEffect(() => {
		const close = (event: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, []);
	useEffect(() => {
		void activeWs;
		setActiveId(search.pohled ?? null);
		setConfirmDelete(null);
	}, [activeWs, search.pohled]);

	const currentConfig = () =>
		surface === "upcoming"
			? makeSavedUpcomingViewConfig(state, view, getDensity(), workspaceFilter)
			: makeSavedTaskViewConfig(state, view, getDensity());
	const errorMessage = (code: string | undefined) =>
		code === "saved_view_name_conflict"
			? t("savedViews.nameConflict")
			: code === "saved_view_stale"
				? t("savedViews.stale")
				: code === "team_view_manager_only"
					? t("savedViews.teamForbidden")
					: t("savedViews.saveError");

	const create = async () => {
		if (!activeWs || !name.trim() || busy) return;
		setBusy(true);
		try {
			const id = crypto.randomUUID();
			const config = currentConfig();
			const response = await fetch(`${API_URL}/api/saved-views`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id,
					workspaceId: activeWs,
					name: name.trim(),
					scope,
					surface,
					config,
				}),
			});
			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			if (!response.ok) {
				showToast(errorMessage(payload.error));
				return;
			}
			setName("");
			setActiveId(id);
			const now = new Date().toISOString();
			setOptimisticRows((current) => [
				...current.filter((row) => row.id !== id),
				{
					id,
					owner_scope: scope === "team" ? "workspace" : "user",
					user_id: session?.user?.id ?? null,
					workspace_id: activeWs,
					name: name.trim(),
					query: `${surface}:v1`,
					surface,
					config: JSON.stringify(config),
					version: 1,
					created_at: now,
					updated_at: now,
				},
			]);
			void navigate({
				to: surface === "upcoming" ? "/nadchazejici" : "/ukoly",
				search: { pohled: id },
				replace: true,
			});
			showToast(t("savedViews.saved"));
		} catch {
			showToast(t("savedViews.saveError"));
		} finally {
			setBusy(false);
		}
	};

	const apply = useCallback((row: FilterRow, notify = true) => {
		const config =
			surface === "upcoming"
				? parseSavedUpcomingViewConfig(row.config)
				: parseSavedTaskViewConfig(row.config);
		if (!config) {
			showToast(t("savedViews.invalid"));
			return;
		}
		onChange(toolbarStateFromSavedView(config));
		setView(config.viewMode);
		if ("workspaceFilter" in config)
			onWorkspaceFilterChange?.(config.workspaceFilter);
		setDensity(config.density);
		setActiveId(row.id);
		appliedDeepLinkRef.current = `${surface}:${row.id}:${row.version}`;
		setOpen(false);
		void navigate({
			to: surface === "upcoming" ? "/nadchazejici" : "/ukoly",
			search: { pohled: row.id },
			replace: true,
		});
		if (notify) showToast(t("savedViews.applied", { name: row.name ?? "" }));
	}, [navigate, onChange, onWorkspaceFilterChange, setView, surface, t]);

	useEffect(() => {
		if (!search.pohled) return;
		const row = savedViews.find((candidate) => candidate.id === search.pohled);
		if (!row) return;
		const key = `${surface}:${row.id}:${row.version}`;
		if (appliedDeepLinkRef.current === key) return;
		apply(row, false);
	}, [apply, savedViews, search.pohled, surface]);

	const update = async () => {
		if (!activeSavedView || busy) return;
		const target = activeSavedView;
		setBusy(true);
		try {
			const response = await fetch(`${API_URL}/api/saved-views/${target.id}`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: target.name,
					config: currentConfig(),
					expectedVersion: target.version,
				}),
			});
			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			if (!response.ok) {
				showToast(errorMessage(payload.error));
				return;
			}
			setOptimisticRows((current) =>
				current.map((row) =>
					row.id === target.id
						? {
								...row,
								config: JSON.stringify(currentConfig()),
								version: (row.version ?? target.version ?? 1) + 1,
								updated_at: new Date().toISOString(),
							}
						: row,
				),
			);
			showToast(t("savedViews.updated"));
		} catch {
			showToast(t("savedViews.saveError"));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (row: FilterRow) => {
		if (confirmDelete !== row.id) {
			setConfirmDelete(row.id);
			return;
		}
		setBusy(true);
		try {
			const response = await fetch(
				`${API_URL}/api/saved-views/${row.id}?version=${row.version}`,
				{ method: "DELETE", credentials: "include" },
			);
			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			if (!response.ok) {
				showToast(errorMessage(payload.error));
				return;
			}
			if (activeId === row.id) setActiveId(null);
			setOptimisticRows((current) => current.filter((candidate) => candidate.id !== row.id));
			setPinned("saved_view", row.id, false);
			setConfirmDelete(null);
			showToast(t("savedViews.deleted"));
		} catch {
			showToast(t("savedViews.saveError"));
		} finally {
			setBusy(false);
		}
	};

	const canEdit = (row: FilterRow) =>
		row.owner_scope === "user" ? row.user_id === session?.user?.id : canManageTeam;

	return (
		<div ref={rootRef} className="relative">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="font-display font-semibold hover:border-brass"
				style={chipStyle(!!activeSavedView)}
				aria-label={t("savedViews.button")}
				aria-expanded={open}
			>
				<Icon name="nastaveni" size={14} />
				{activeSavedView?.name ?? t("savedViews.button")}
				<span aria-hidden style={{ fontSize: 10, opacity: 0.6 }}>
					▾
				</span>
			</button>
			{open && (
				<div
					ref={popoverRef}
					role="dialog"
					aria-label={t("savedViews.title")}
					data-esc-layer
					data-saved-views
					className="absolute left-0 rounded-xl border border-line bg-card"
					style={{
						top: 38,
						zIndex: "var(--w-layer-popover)",
						width: "min(340px, calc(100vw - 32px))",
						padding: 10,
						boxShadow: "var(--w-shadow)",
					}}
				>
					<div className="font-display font-bold text-ink" style={{ fontSize: 13.5 }}>
						{t("savedViews.title")}
					</div>
					<div className="mt-2 max-h-52 overflow-auto">
						{isLoading ? (
							<div className="px-2 py-3 text-ink-3 text-sm">{t("common.loading")}</div>
						) : savedViews.length === 0 ? (
							<div className="px-2 py-3 text-ink-3 text-sm">{t("savedViews.empty")}</div>
						) : (
							savedViews.map((row) => (
								<div key={row.id} className="flex items-center gap-1 border-line border-b py-1 last:border-0">
									<button
										type="button"
										onClick={() => apply(row)}
										className="min-h-11 min-w-0 flex-1 rounded-lg px-2 text-left hover:bg-panel-2"
									>
										<span className="block truncate font-display font-semibold text-ink" style={{ fontSize: 13 }}>
											{row.name}
										</span>
										<span className="text-ink-3" style={{ fontSize: 10.5 }}>
											{row.owner_scope === "workspace" ? t("savedViews.team") : t("savedViews.personal")}
										</span>
									</button>
									<button
										type="button"
										onClick={() =>
							setPinned("saved_view", row.id, !isPinned("saved_view", row.id), {
								label: row.name ?? undefined,
								surface,
								workspaceId: row.workspace_id ?? undefined,
							})
										}
										aria-pressed={isPinned("saved_view", row.id)}
										aria-label={
											isPinned("saved_view", row.id)
												? t("navigationPins.removeView")
												: t("navigationPins.addView")
										}
										title={
											isPinned("saved_view", row.id)
												? t("navigationPins.removeView")
												: t("navigationPins.addView")
										}
										className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-base text-ink-3 hover:bg-panel-2 hover:text-brass-text"
									>
										<span aria-hidden>{isPinned("saved_view", row.id) ? "★" : "☆"}</span>
									</button>
									{canEdit(row) && (
										<button
											type="button"
											onClick={() => void remove(row)}
											disabled={busy}
											className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-panel-2 hover:text-overdue"
											aria-label={confirmDelete === row.id ? t("savedViews.confirmDelete") : t("savedViews.delete")}
											title={confirmDelete === row.id ? t("savedViews.confirmDelete") : t("savedViews.delete")}
										>
											{confirmDelete === row.id ? "?" : <Icon name="smazat" size={15} />}
										</button>
									)}
								</div>
							))
						)}
					</div>

					<div className="mt-2.5 border-line border-t pt-2.5">
						<input
							value={name}
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => event.key === "Enter" && void create()}
							placeholder={t("savedViews.namePlaceholder")}
							maxLength={160}
							className="min-h-11 w-full rounded-lg border border-line bg-panel-2 px-3 font-body text-ink outline-none focus:border-brass"
							style={{ fontSize: 13 }}
						/>
						<div className="mt-2 flex items-center gap-1.5">
							<button
								type="button"
								onClick={() => setScope("personal")}
								className="min-h-11 rounded-lg px-2.5 font-display font-semibold"
								style={{ fontSize: 12, background: scope === "personal" ? "var(--w-brass-soft)" : "var(--w-panel-2)" }}
							>
								{t("savedViews.personal")}
							</button>
							{canManageTeam && (
								<button
									type="button"
									onClick={() => setScope("team")}
									className="min-h-11 rounded-lg px-2.5 font-display font-semibold"
									style={{ fontSize: 12, background: scope === "team" ? "var(--w-brass-soft)" : "var(--w-panel-2)" }}
								>
									{t("savedViews.team")}
								</button>
							)}
							<span className="flex-1" />
							<button
								type="button"
								onClick={() => void create()}
								disabled={!name.trim() || busy}
								className="min-h-11 rounded-lg bg-brass px-3 font-display font-bold text-white disabled:opacity-50"
								style={{ fontSize: 12.5 }}
							>
								{t("savedViews.save")}
							</button>
						</div>
						{activeSavedView && canEdit(activeSavedView) && (
							<button
								type="button"
								onClick={() => void update()}
								disabled={busy}
								className="mt-1 min-h-11 w-full rounded-lg font-display font-semibold text-brass-text hover:bg-brass-soft disabled:opacity-50"
								style={{ fontSize: 12.5 }}
							>
								{t("savedViews.updateCurrent", { name: activeSavedView.name ?? "" })}
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
