import { useQuery as usePsQuery } from "@powersync/react";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import type { FilterRow } from "../lib/powersync/AppSchema";
import {
	makeSavedTaskViewConfig,
	parseSavedTaskViewConfig,
	toolbarStateFromSavedView,
} from "../lib/savedViews";
import { getDensity, setDensity } from "../lib/tweaks";
import { showToast } from "../lib/toast";
import { useViewMode } from "../lib/viewMode";
import { useWorkspace, useWorkspaces } from "../lib/workspace";
import type { ToolbarState } from "./TasksToolbar";
import { chipStyle } from "./filterUi";

export function SavedViewsControl({
	state,
	onChange,
}: {
	state: ToolbarState;
	onChange: (next: ToolbarState) => void;
}) {
	const { t } = useTranslation();
	const { data: session } = useSession();
	const { activeWs } = useWorkspace();
	const { data: workspaces } = useWorkspaces();
	const { view, setView } = useViewMode();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [scope, setScope] = useState<"personal" | "team">("personal");
	const [busy, setBusy] = useState(false);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const activeWorkspace = workspaces?.find((workspace) => workspace.id === activeWs);
	const canManageTeam = activeWorkspace?.capabilities?.manageGoals === true;

	const { data: rows, isLoading } = usePsQuery<FilterRow>(
		`SELECT * FROM filters
		 WHERE workspace_id = ? AND surface = 'tasks' AND query = 'tasks:v1'
		 ORDER BY owner_scope DESC, lower(name)`,
		[activeWs ?? ""],
	);
	const savedViews = rows ?? [];
	const activeSavedView = savedViews.find((row) => row.id === activeId) ?? null;

	useEffect(() => {
		const close = (event: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", close);
		return () => document.removeEventListener("mousedown", close);
	}, []);
	useEffect(() => {
		if (!open) return;
		const close = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				setOpen(false);
			}
		};
		document.addEventListener("keydown", close, true);
		return () => document.removeEventListener("keydown", close, true);
	}, [open]);
	useEffect(() => {
		void activeWs;
		setActiveId(null);
		setConfirmDelete(null);
	}, [activeWs]);

	const currentConfig = () => makeSavedTaskViewConfig(state, view, getDensity());
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
			const response = await fetch(`${API_URL}/api/saved-views`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id,
					workspaceId: activeWs,
					name: name.trim(),
					scope,
					config: currentConfig(),
				}),
			});
			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			if (!response.ok) {
				showToast(errorMessage(payload.error));
				return;
			}
			setName("");
			setActiveId(id);
			showToast(t("savedViews.saved"));
		} catch {
			showToast(t("savedViews.saveError"));
		} finally {
			setBusy(false);
		}
	};

	const apply = (row: FilterRow) => {
		const config = parseSavedTaskViewConfig(row.config);
		if (!config) {
			showToast(t("savedViews.invalid"));
			return;
		}
		onChange(toolbarStateFromSavedView(config));
		setView(config.viewMode);
		setDensity(config.density);
		setActiveId(row.id);
		setOpen(false);
		showToast(t("savedViews.applied", { name: row.name ?? "" }));
	};

	const update = async () => {
		if (!activeSavedView || busy) return;
		setBusy(true);
		try {
			const response = await fetch(`${API_URL}/api/saved-views/${activeSavedView.id}`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: activeSavedView.name,
					config: currentConfig(),
					expectedVersion: activeSavedView.version,
				}),
			});
			const payload = (await response.json().catch(() => ({}))) as { error?: string };
			if (!response.ok) {
				showToast(errorMessage(payload.error));
				return;
			}
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
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="font-display font-semibold hover:border-brass"
				style={chipStyle(!!activeSavedView)}
				aria-expanded={open}
			>
				<Icon name="nastaveni" size={14} />
				{activeSavedView?.name ?? t("savedViews.button")}
				<span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
			</button>
			{open && (
				<div
					data-esc-layer
					data-saved-views
					className="absolute left-0 z-[32] rounded-xl border border-line bg-card"
					style={{
						top: 38,
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
