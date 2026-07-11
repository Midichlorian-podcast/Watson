/**
 * Notifikační centrum aplikace (feedback 2026-07-11: „zásadní část aplikace")
 * — jedna ucelená karta pod zvonkem v hlavičce, agreguje VŠECHNY signály:
 *   · štafeta — kroky postupů, které čekají na mě
 *   · po termínu — nejstarší zpožděné úkoly (klik = detail)
 *   · pošta — běžící SLA P1/P2, zmínky v interní diskusi, nedoručené, Gatekeeper
 * Klik položku vyřídí NA MÍSTĚ (detail úkolu / mail peek), „viděno" se drží
 * v localStorage (watson.notifSeen) a sdílí přes malý externí store, takže
 * odznak zvonku i panel jsou vždy ve shodě.
 */
import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { P, SLA } from "../mail/data";
import { useMail } from "../mail/state";
import { useSession } from "../lib/auth-client";
import { useTaskDetail } from "../lib/taskDetail";
import { todayISO } from "../lib/tasks";
import { PeekPanel, type PeekTarget } from "./PeekPanel";

/* ── „viděno" — localStorage + externí store (Header badge ↔ panel ve shodě) ── */

const SEEN_KEY = "watson.notifSeen";
let seenCache: Record<string, number> = (() => {
	try {
		return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
	} catch {
		return {};
	}
})();
const seenSubs = new Set<() => void>();
const seenSnapshot = () => seenCache;
const subscribeSeen = (fn: () => void) => {
	seenSubs.add(fn);
	return () => seenSubs.delete(fn);
};
function writeSeen(next: Record<string, number>) {
	seenCache = next;
	localStorage.setItem(SEEN_KEY, JSON.stringify(next));
	for (const fn of seenSubs) fn();
}
export function markSeen(keys: string[]) {
	const now = Date.now();
	writeSeen({ ...seenCache, ...Object.fromEntries(keys.map((k) => [k, now])) });
}

/* ── odvození položek ze synced dat + mail seedu ── */

export interface NotifItem {
	key: string;
	/** flow = štafeta (brass) · task = po termínu (červená) · mail = pošta. */
	kind: "flow" | "task" | "mail";
	title: string;
	sub?: string;
	time?: string;
	action:
		| { type: "flow"; chainId: string }
		| { type: "task"; taskId: string }
		| { type: "mailThread"; id: string }
		| { type: "mailFolder"; folder: string };
}

export function useNotifItems(): { items: NotifItem[]; unseen: number } {
	const { t } = useTranslation();
	const { data: session } = useSession();
	const myId = session?.user?.id ?? "";
	const m = useMail();
	const seen = useSyncExternalStore(subscribeSeen, seenSnapshot);

	// štafeta — aktivní kroky přiřazené mně (dřívější zvonek v hlavičce)
	const { data: handoffs } = usePsQuery<{
		chain_id: string;
		task_name: string | null;
		chain_name: string | null;
	}>(
		`SELECT cs.chain_id, t.name AS task_name, c.name AS chain_name
		 FROM chain_steps cs
		 JOIN tasks t ON t.id = cs.task_id AND t.completed_at IS NULL
		 JOIN chains c ON c.id = cs.chain_id AND c.state = 'active'
		 JOIN assignments a ON a.task_id = cs.task_id AND a.user_id = ?
		 WHERE cs.step_state = 'active'
		 ORDER BY cs.activated_at DESC`,
		[myId],
	);
	// po termínu — nejstarší 3 (bez podúkolů bez termínu)
	const { data: overdue } = usePsQuery<{
		id: string;
		name: string | null;
		due_date: string | null;
	}>(
		`SELECT id, name, due_date FROM tasks
		 WHERE completed_at IS NULL AND due_date IS NOT NULL AND due_date < ?
		 ORDER BY due_date, priority LIMIT 3`,
		[todayISO()],
	);

	const items: NotifItem[] = [];
	for (const h of handoffs ?? []) {
		items.push({
			key: `flow:${h.chain_id}`,
			kind: "flow",
			title: h.task_name ?? "",
			sub: `${t("shell.notifWaiting")} · ${h.chain_name ?? ""}`,
			action: { type: "flow", chainId: h.chain_id },
		});
	}
	for (const tk of overdue ?? []) {
		items.push({
			key: `task:${tk.id}`,
			kind: "task",
			title: tk.name ?? "",
			sub: t("notif.overdueSince", {
				date: (tk.due_date ?? "").slice(5, 10).split("-").reverse().join(". "),
			}),
			action: { type: "task", taskId: tk.id },
		});
	}
	// pošta — stejné odvození jako zvonek mail modulu (SLA / zmínka / bounce / GK)
	for (const th of m.threads) {
		if (th.personal) continue;
		const e = m.eff(th);
		if ((e.flag === "p1" || e.flag === "p2") && !e.closed && !e.sent) {
			const sla = SLA[e.flag];
			items.push({
				key: `sla:${th.id}`,
				kind: "mail",
				title: th.subj,
				sub: `${sla?.chip ?? e.flag.toUpperCase()} · ${t("notif.slaRunning")}${sla ? ` — ${sla.sla}` : ""}`,
				time: m.ovOf(th.id).time ?? th.time,
				action: { type: "mailThread", id: th.id },
			});
		}
		for (const c of th.chat) {
			if (c.m === "@Adam" && c.who !== "ad") {
				items.push({
					key: `mention:${th.id}:${c.t}`,
					kind: "mail",
					title: t("notif.mention", {
						who: P[c.who]?.n.split(" ")[0] ?? c.who,
					}),
					sub: th.subj,
					time: c.t,
					action: { type: "mailThread", id: th.id },
				});
			}
		}
		if (th.bounce && !m.ovOf(th.id).bounceFixed) {
			items.push({
				key: `bounce:${th.id}`,
				kind: "mail",
				title: t("notif.bounce", { subj: th.subj }),
				sub: th.bounce,
				action: { type: "mailThread", id: th.id },
			});
		}
	}
	if (m.gkLeft > 0) {
		items.push({
			key: "gate",
			kind: "mail",
			title: t("notif.gate", { count: m.gkLeft }),
			action: { type: "mailFolder", folder: "gatekeeper" },
		});
	}

	return { items, unseen: items.filter((n) => !seen[n.key]).length };
}

/* ── panel ── */

const DOT: Record<NotifItem["kind"], string> = {
	flow: "var(--w-brass)",
	task: "var(--w-overdue)",
	mail: "var(--w-avatar)",
};

export function NotifCenter({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { open: openTask, openId } = useTaskDetail();
	const m = useMail();
	const { items, unseen } = useNotifItems();
	// mail položky se odbavují NA MÍSTĚ přes mail peek (plný workspace)
	const [peek, setPeek] = useState<PeekTarget | null>(null);

	useEffect(() => {
		if (!open || peek || openId) return;
		const h = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [open, peek, openId, onClose]);

	/** Klik na TITULEK = rychlá karta na místě (detail úkolu / mail peek). */
	const quickAct = useCallback(
		(n: NotifItem) => {
			markSeen([n.key]);
			switch (n.action.type) {
				case "flow":
					// postup nemá rychlou kartu s odbavením → rovnou modul
					onClose();
					void navigate({
						to: "/postupy",
						search: { postup: n.action.chainId },
					});
					break;
				case "task":
					// detail modal (z-70) se otevře NAD panelem — panel nechat pod ním
					openTask(n.action.taskId);
					break;
				case "mailThread": {
					const id = n.action.id;
					setPeek({
						kind: "mail",
						id,
						openFull: () => {
							m.openThread(id);
							void navigate({ to: "/mail" });
						},
					});
					break;
				}
				case "mailFolder": {
					const folder = n.action.folder;
					onClose();
					m.setFolder(folder);
					void navigate({ to: "/mail" });
					break;
				}
			}
		},
		[navigate, onClose, openTask, m],
	);

	/** Šipka vpravo = přechod DO MODULU na danou věc (feedback: dva typy akcí). */
	const moduleAct = useCallback(
		(n: NotifItem) => {
			markSeen([n.key]);
			onClose();
			switch (n.action.type) {
				case "flow":
					void navigate({
						to: "/postupy",
						search: { postup: n.action.chainId },
					});
					break;
				case "task":
					void navigate({ to: "/ukoly", search: { ukol: n.action.taskId } });
					break;
				case "mailThread":
					m.openThread(n.action.id);
					void navigate({ to: "/mail" });
					break;
				case "mailFolder":
					m.setFolder(n.action.folder);
					void navigate({ to: "/mail" });
					break;
			}
		},
		[navigate, onClose, m],
	);

	if (!open) return null;

	return createPortal(
		<>
			{/* průhledný scrim — klik mimo zavírá; panel je ucelená karta pod zvonkem */}
			<div
				onClick={onClose}
				style={{ position: "fixed", inset: 0, zIndex: 64 }}
			/>
			<div
				role="dialog"
				aria-label={t("shell.notifTitle")}
				className="border border-line bg-card"
				style={{
					position: "fixed",
					top: 54,
					right: 12,
					zIndex: 65,
					width: "min(380px, 94vw)",
					maxHeight: "min(560px, 78vh)",
					display: "flex",
					flexDirection: "column",
					borderRadius: 14,
					boxShadow: "var(--w-shadow)",
					animation: "wNotifPop .14s ease",
					overflow: "hidden",
				}}
			>
				<div
					className="flex items-center border-line border-b"
					style={{ gap: 8, padding: "12px 15px 10px", flex: "none" }}
				>
					<span
						className="flex-1 font-display font-bold text-ink"
						style={{ fontSize: 13 }}
					>
						{t("shell.notifTitle")}
					</span>
					{unseen > 0 && (
						<button
							type="button"
							onClick={() => markSeen(items.map((n) => n.key))}
							className="font-mono text-ink-3 hover:text-ink"
							style={{ fontSize: 10 }}
						>
							{t("notif.markAll")}
						</button>
					)}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 6 }}>
					{items.length === 0 && (
						<div
							className="font-body text-ink-3"
							style={{ fontSize: 12.5, padding: "10px 11px 14px" }}
						>
							{t("shell.notifEmpty")}
						</div>
					)}
					{items.map((n) => {
						const isSeen = !!seenSnapshot()[n.key];
						return (
							<div
								key={n.key}
								className="group flex w-full items-center rounded-lg hover:bg-panel-2"
								style={{ gap: 4, opacity: isSeen ? 0.55 : 1 }}
							>
								{/* titulek = rychlá karta NA MÍSTĚ */}
								<button
									type="button"
									onClick={() => quickAct(n)}
									title={t("notif.quickTitle")}
									className="flex min-w-0 flex-1 items-start text-left"
									style={{ gap: 9, padding: "8px 4px 8px 9px" }}
								>
									<span
										className="mt-1 shrink-0 rounded-full"
										style={{ width: 7, height: 7, background: DOT[n.kind] }}
									/>
									<span className="min-w-0 flex-1">
										<span
											className="block truncate font-display font-semibold text-ink"
											style={{ fontSize: 12.5 }}
										>
											{n.title}
										</span>
										{n.sub && (
											<span
												className="block truncate font-body text-ink-3"
												style={{ fontSize: 11, marginTop: 1 }}
											>
												{n.sub}
											</span>
										)}
									</span>
									{n.time && (
										<span
											className="shrink-0 font-mono text-ink-3"
											style={{ fontSize: 9.5, marginTop: 2 }}
										>
											{n.time}
										</span>
									)}
								</button>
								{/* šipka = přechod do modulu na danou věc */}
								<button
									type="button"
									onClick={() => moduleAct(n)}
									title={t("notif.moduleTitle")}
									aria-label={t("notif.moduleTitle")}
									className="grid shrink-0 place-items-center rounded-md border border-line text-ink-3 opacity-0 focus-visible:opacity-100 hover:border-brass hover:text-brass-text group-hover:opacity-100"
									style={{ width: 24, height: 24, marginRight: 6 }}
								>
									<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
										<path
											d="M4 2 H10 V8 M10 2 L2 10"
											stroke="currentColor"
											strokeWidth="1.4"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</button>
							</div>
						);
					})}
				</div>

				<div
					className="border-line border-t font-body text-ink-3"
					style={{ fontSize: 10.5, padding: "8px 15px", flex: "none" }}
				>
					{t("notif.foot")}
				</div>
			</div>
			<style>{`@keyframes wNotifPop{from{transform:translateY(-6px);opacity:0}to{transform:none;opacity:1}}`}</style>

			{/* mail peek NAD panelem notifikací (vlastní portál s vyšší vrstvou) */}
			<PeekPanel target={peek} onClose={() => setPeek(null)} layer={66} />
		</>,
		document.body,
	);
}
