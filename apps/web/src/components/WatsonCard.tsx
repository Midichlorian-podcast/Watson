/**
 * Watson — vycentrovaná karta (nahrazuje dřívější boční drawer). Režim „Zeptej se
 * Watsona": napíšeš příkaz v přirozené řeči, AI (Claude) vrátí NÁVRHY akcí napříč
 * aplikací (vytvořit úkol/seznam/projekt, posunout termín, draft mailu, přiřadit),
 * ty je zaškrtneš a Watson je provede přes write-path (human-in-the-loop). Bez AI
 * klíče se příkazová vrstva skryje (503) a zůstane jen odkaz na přehled.
 */
import { useQuery as usePsQuery } from "@powersync/react";
import i18n from "@watson/i18n";
import { type CSSProperties, useMemo, useState } from "react";
import { logTaskActivity } from "../lib/activity";
import { API_URL } from "../lib/api";
import { focusOnMount } from "../lib/focusOnMount";
import { useSession } from "../lib/auth-client";
import type { ProjectRow, TaskRow } from "../lib/powersync/AppSchema";
import { powerSync } from "../lib/powersync/db";
import { showToast } from "../lib/toast";
import { useFocusTrap } from "../lib/useFocusTrap";
import { useWorkspace } from "../lib/workspace";

interface Action {
	type: string;
	label: string;
	params: Record<string, unknown>;
}

const EXAMPLES = [
	"Vytvoř úkol připravit rozpočet a přiřaď ho na finance, termín pátek",
	"Posuň všechny úkoly po termínu na dnešek",
	"Založ projekt Letní tábor 2026 a seznam Co zabalit",
];

const OVERLAY: CSSProperties = {
	position: "fixed",
	inset: 0,
	zIndex: 90,
	background: "transparent",
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "center",
	padding: "6vh 16px 16px",
	overflow: "auto",
};
const CARD: CSSProperties = {
	width: "100%",
	maxWidth: 560,
	background: "var(--w-card)",
	border: "1px solid var(--w-line)",
	borderRadius: 18,
	boxShadow: "var(--w-shadow)",
	overflow: "hidden",
	display: "flex",
	flexDirection: "column",
};

export function WatsonCard({ onClose }: { onClose: () => void }) {
	const { activeWs } = useWorkspace();
	const { data: session } = useSession();
	const trapRef = useFocusTrap<HTMLDivElement>(true);

	const { data: allProjects } = usePsQuery<ProjectRow>(
		"SELECT id, name, workspace_id FROM projects WHERE archived_at IS NULL ORDER BY created_at",
	);
	const projects = useMemo(
		() => (allProjects ?? []).filter((p) => p.workspace_id === activeWs),
		[allProjects, activeWs],
	);
	const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
	const { data: openTasks } = usePsQuery<TaskRow>(
		"SELECT id, name, due_date, project_id FROM tasks WHERE completed_at IS NULL AND parent_id IS NULL ORDER BY due_date LIMIT 300",
	);

	const [command, setCommand] = useState("");
	const [busy, setBusy] = useState(false);
	const [actions, setActions] = useState<Action[] | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [keep, setKeep] = useState<boolean[]>([]);
	const [aiOff, setAiOff] = useState(false);

	async function run() {
		if (command.trim().length < 2 || !activeWs) return;
		const vendorConsent = window.confirm(i18n.t("common.aiVendorConsentConfirm"));
		if (!vendorConsent) return;
		setBusy(true);
		setActions(null);
		setNote(null);
		setAiOff(false);
		try {
			const projName = new Map(projects.map((p) => [p.id, p.name ?? ""]));
			const tasks = (openTasks ?? [])
				.filter((t) => t.project_id && projectIds.has(t.project_id))
				.slice(0, 120)
				.map((t) => ({
					id: t.id,
					name: t.name ?? "",
					due: t.due_date ? String(t.due_date).slice(0, 10) : null,
					project: t.project_id ? projName.get(t.project_id) : null,
				}));
			const r = await fetch(`${API_URL}/api/watson/command`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					workspaceId: activeWs,
					command,
					vendorConsent,
					context: { projects: projects.map((p) => ({ id: p.id, name: p.name ?? "" })), tasks },
				}),
			});
			if (r.status === 503) {
				setAiOff(true);
				return;
			}
			if (!r.ok) throw new Error("command");
			const j = await r.json();
			setActions(j.actions ?? []);
			setNote(j.note ?? null);
			setKeep((j.actions ?? []).map(() => true));
		} catch {
			showToast("Watson teď nemůže odpovědět — zkus to znovu.");
		} finally {
			setBusy(false);
		}
	}

	const defaultProject = useMemo(
		() => projects.find((p) => p.name !== "Doručené" && p.name !== "Inbox") ?? projects[0],
		[projects],
	);

	async function apply() {
		if (!actions || !session?.user?.id) return;
		const uid = session.user.id;
		setBusy(true);
		let done = 0;
		try {
			for (let i = 0; i < actions.length; i++) {
				if (!keep[i]) continue;
				const a = actions[i];
				if (!a) continue;
				const p = a.params;
				if (a.type === "create_task") {
					const projectId = (p.projectId as string) || defaultProject?.id;
					if (!projectId) continue;
					const taskId = crypto.randomUUID();
					await powerSync.execute(
						`INSERT INTO tasks (id, project_id, name, priority, due_date, assignment_mode, created_by, created_at)
						 VALUES (?, ?, ?, ?, ?, 'single', ?, ?)`,
						[
							taskId,
							projectId,
							String(p.title ?? "").slice(0, 200),
							(p.priority as number) ?? 3,
							(p.due as string) ?? null,
							uid,
							new Date().toISOString(),
						],
					);
					void logTaskActivity(taskId, projectId, uid, "created", null, "watson");
					if (p.assigneeUserId) {
						await powerSync.execute(
							"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)",
							[crypto.randomUUID(), taskId, projectId, p.assigneeUserId as string, new Date().toISOString()],
						);
					}
					done++;
				} else if (a.type === "reschedule_task") {
					const t = (openTasks ?? []).find((x) => x.id === p.taskId);
					await powerSync.execute("UPDATE tasks SET due_date = ? WHERE id = ?", [
						(p.due as string) ?? null,
						p.taskId as string,
					]);
					if (t?.project_id)
						void logTaskActivity(
							t.id,
							t.project_id,
							uid,
							"due_date",
							t.due_date ?? null,
							(p.due as string) ?? null,
						);
					done++;
				} else if (a.type === "create_list") {
					if (!activeWs) continue;
					await powerSync.execute(
						`INSERT INTO lists (id, workspace_id, name, event, archived, created_by, created_at)
						 VALUES (?, ?, ?, ?, 0, ?, ?)`,
						[
							crypto.randomUUID(),
							activeWs,
							String(p.name ?? "").slice(0, 200),
							(p.event as string) ?? null,
							uid,
							new Date().toISOString(),
						],
					);
					done++;
				} else if (a.type === "create_project") {
					const r = await fetch(`${API_URL}/api/projects`, {
						method: "POST",
						credentials: "include",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ name: String(p.name ?? "").slice(0, 200), workspaceId: activeWs }),
					});
					if (r.ok) done++;
				} else if (a.type === "draft_email" || a.type === "assign_email") {
					// Mail je zatím z velké části demo — akci nabídneme, ale reálně neprovádíme.
					showToast("Mailové akce přijdou s reálným mailem (M1).");
				}
			}
			showToast(`Watson provedl ${done} ${done === 1 ? "akci" : "akcí"}.`);
			onClose();
		} catch {
			showToast("Provedení akcí se nezdařilo.");
		} finally {
			setBusy(false);
		}
	}

	const keepCount = keep.filter(Boolean).length;

	return (
		<div
			style={OVERLAY}
			data-esc-layer
			data-watson-layer
		>
			<button
				type="button"
				aria-label="Zavřít Watsona"
				onClick={onClose}
				style={{ position: "absolute", inset: 0, border: 0, background: "rgba(20,16,10,.34)" }}
			/>
			<div ref={trapRef} style={{ ...CARD, position: "relative", zIndex: 1 }} role="dialog" aria-label="Watson">
				{/* hlavička */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						padding: "16px 18px",
						borderBottom: "1px solid var(--w-line)",
					}}
				>
					<span
						style={{
							width: 24,
							height: 24,
							borderRadius: "50%",
							background: "var(--w-brass)",
							color: "#fff",
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							fontFamily: "var(--w-font-display)",
							fontWeight: 800,
							fontSize: 13,
							flex: "none",
						}}
					>
						W
					</span>
					<span className="font-display" style={{ fontWeight: 800, fontSize: 16, color: "var(--w-ink)" }}>
						Zeptej se Watsona
					</span>
					<button
						type="button"
						onClick={onClose}
						aria-label="Zavřít"
						style={{
							marginLeft: "auto",
							background: "transparent",
							border: "none",
							cursor: "pointer",
							color: "var(--w-ink-3)",
							fontSize: 20,
							lineHeight: 1,
						}}
					>
						×
					</button>
				</div>

				<div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
					{/* příkazový vstup */}
					<textarea
						value={command}
						onChange={(e) => setCommand(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run();
						}}
						placeholder="Řekni Watsonovi, co udělat… (⌘/Ctrl + Enter odešle)"
						rows={3}
						ref={focusOnMount}
						style={{
							width: "100%",
							fontSize: 14,
							color: "var(--w-ink)",
							background: "var(--w-panel-2)",
							border: "1px solid var(--w-line)",
							borderRadius: 10,
							padding: "10px 12px",
							resize: "vertical",
							lineHeight: 1.5,
						}}
					/>
					{!actions && !aiOff && (
						<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
							{EXAMPLES.map((ex) => (
								<button
									key={ex}
									type="button"
									onClick={() => setCommand(ex)}
									className="font-body"
									style={{
										fontSize: 11.5,
										color: "var(--w-ink-3)",
										background: "var(--w-panel-2)",
										border: "1px solid var(--w-line)",
										borderRadius: 999,
										padding: "5px 11px",
										cursor: "pointer",
										textAlign: "left",
									}}
								>
									{ex}
								</button>
							))}
						</div>
					)}

					{aiOff && (
						<div
							className="font-body"
							style={{ fontSize: 12.5, color: "var(--w-ink-3)", lineHeight: 1.5 }}
						>
							AI vrstva zatím není zapnutá (chybí Claude klíč v backendu). Modul Meets a ostatní
							funkce fungují i bez ní.
						</div>
					)}

					{note && (
						<div
							className="font-body"
							style={{
								fontSize: 13,
								color: "var(--w-ink-2)",
								background: "var(--w-panel-2)",
								borderRadius: 10,
								padding: "10px 12px",
							}}
						>
							{note}
						</div>
					)}

					{/* návrhy akcí */}
					{actions && actions.length > 0 && (
						<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
							<div className="font-body" style={{ fontSize: 12, color: "var(--w-ink-3)" }}>
								Watson navrhuje ({actions.length}). Zaškrtni, co provést:
							</div>
							{actions.map((a, i) => (
								<label
									// biome-ignore lint/suspicious/noArrayIndexKey: stabilní pořadí návrhů
									key={i}
									style={{
										display: "flex",
										gap: 10,
										alignItems: "flex-start",
										padding: "10px 12px",
										background: "var(--w-panel-2)",
										border: "1px solid var(--w-line)",
										borderRadius: 10,
										cursor: "pointer",
									}}
								>
									<input
										type="checkbox"
										checked={keep[i] ?? true}
										onChange={(e) =>
											setKeep((k) => k.map((v, idx) => (idx === i ? e.target.checked : v)))
										}
										style={{ marginTop: 2, accentColor: "var(--w-brass)" }}
									/>
									<span className="font-body" style={{ fontSize: 13, color: "var(--w-ink)" }}>
										{a.label}
									</span>
								</label>
							))}
						</div>
					)}

					{actions && actions.length === 0 && !note && (
						<div className="font-body" style={{ fontSize: 12.5, color: "var(--w-ink-3)" }}>
							Watson nenašel žádnou akci. Zkus příkaz upřesnit.
						</div>
					)}

					{/* akce */}
					<div style={{ display: "flex", gap: 10 }}>
						{!actions ? (
							<button
								type="button"
								onClick={() => void run()}
								disabled={busy || command.trim().length < 2}
								className="font-display"
								style={{
									fontWeight: 600,
									fontSize: 13,
									color: "#fff",
									background: "var(--w-brass)",
									border: "none",
									borderRadius: 9,
									padding: "9px 18px",
									cursor: "pointer",
									opacity: busy || command.trim().length < 2 ? 0.5 : 1,
								}}
							>
								{busy ? "Přemýšlím…" : "Zeptat se"}
							</button>
						) : (
							<button
								type="button"
								onClick={() => void apply()}
								disabled={busy || keepCount === 0}
								className="font-display"
								style={{
									fontWeight: 600,
									fontSize: 13,
									color: "#fff",
									background: "var(--w-brass)",
									border: "none",
									borderRadius: 9,
									padding: "9px 18px",
									cursor: "pointer",
									opacity: busy || keepCount === 0 ? 0.5 : 1,
								}}
							>
								{busy ? "Provádím…" : `Provést ${keepCount}`}
							</button>
						)}
						{actions && (
							<button
								type="button"
								onClick={() => {
									setActions(null);
									setNote(null);
								}}
								className="font-display"
								style={{
									fontWeight: 600,
									fontSize: 13,
									color: "var(--w-ink-2)",
									background: "transparent",
									border: "1px solid var(--w-line)",
									borderRadius: 9,
									padding: "9px 16px",
									cursor: "pointer",
								}}
							>
								Zpět
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
