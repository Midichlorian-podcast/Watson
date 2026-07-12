import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon, type IconName } from "@watson/ui";
import { useEffect, useState } from "react";
import { useWatson } from "../lib/watson";
import { isLeadership, useWorkspaces } from "../lib/workspace";
import { useMailUnread } from "../mail/state";

/** Hlavní taby = nejdůležitější moduly Watsonu: Přehled, Úkoly (sloučený modul — otevře
 * záložku Dnes, aktivní i pro /ukoly), Mail, Nadcházející. `activePrefix` = zvýraznit tab
 * napříč celým modulem (Dnes/Vše/Zásobník žijí pod „/" i „/ukoly"). */
const TABS: {
	to: "/prehled" | "/" | "/mail" | "/nadchazejici";
	icon: IconName;
	labelKey: string;
	/** Další prefix cesty, který má tab také zvýraznit (sloučený modul). */
	activePrefix?: string;
}[] = [
	{ to: "/prehled", icon: "prehled", labelKey: "nav.overview" },
	{ to: "/", icon: "ukoly", labelKey: "nav.tasks", activePrefix: "/ukoly" },
	{ to: "/mail", icon: "mail", labelKey: "nav.mail" },
	{ to: "/nadchazejici", icon: "nadchazejici", labelKey: "nav.upcoming" },
];

/** Sekce dostupné přes „Více" (na mobilu není sidebar → jinak nedosažitelné). „Úkoly" už není
 * zde — je hlavní tab; do modulu (Vše/Zásobník) se vstupuje záložkami uvnitř. */
const MORE: { to: string; icon: IconName; labelKey: string }[] = [
	{ to: "/projekty", icon: "projekty", labelKey: "nav.projects" },
	{ to: "/seznamy", icon: "seznamy", labelKey: "nav.lists" },
	{ to: "/hledat", icon: "hledat", labelKey: "nav.search" },
	{ to: "/schranka", icon: "schranka", labelKey: "nav.inbox" },
	{ to: "/cile", icon: "cile", labelKey: "nav.goals" },
	{ to: "/reporty", icon: "reporty", labelKey: "nav.reports" },
	{ to: "/postupy", icon: "postup", labelKey: "nav.flows" },
	{ to: "/oblibene/p1", icon: "priorita", labelKey: "nav.priority1" },
	{ to: "/oblibene/me", icon: "prirazeni", labelKey: "nav.assignedToMe" },
	{ to: "/nastaveni", icon: "nastaveni", labelKey: "nav.settings" },
];

/** Mobilní spodní lišta: 4 hlavní moduly + „Více" (list ostatních sekcí) + Watson. */
export function MobileTabBar() {
	const { t } = useTranslation();
	const { toggleWatson } = useWatson();
	const path = useRouterState({ select: (s) => s.location.pathname });
	const [moreOpen, setMoreOpen] = useState(false);
	const { data: workspaces } = useWorkspaces();
	const mailUnread = useMailUnread();

	// Esc zavírá sheet „Více" (nese data-esc-layer → ostatní vrstvy mu ustupují)
	useEffect(() => {
		if (!moreOpen) return;
		const h = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape") setMoreOpen(false);
		};
		document.addEventListener("keydown", h);
		return () => document.removeEventListener("keydown", h);
	}, [moreOpen]);

	// Velín jen pro vedení (Vlastník/Admin) — stejný gating jako sidebar.
	const more = isLeadership(workspaces)
		? [
				...MORE.slice(0, 2),
				{ to: "/velin", icon: "velin" as IconName, labelKey: "nav.velin" },
				...MORE.slice(2),
			]
		: MORE;
	const moreActive = more.some((m) => path.startsWith(m.to));

	return (
		<>
			{moreOpen && (
				// Spodní sheet „Více" — sekce, které na mobilu nejsou v hlavních tabech.
				<div
					className="fixed inset-0"
					style={{ zIndex: 40, background: "rgba(10,14,20,.42)" }}
					onClick={() => setMoreOpen(false)}
					data-esc-layer
				>
					<div
						className="fixed right-0 bottom-0 left-0 rounded-t-2xl border-line border-t bg-card"
						style={{ paddingBottom: "calc(58px + env(safe-area-inset-bottom))" }}
						onClick={(e) => e.stopPropagation()}
					>
						<div
							className="mx-auto my-2 rounded-full"
							style={{ width: 40, height: 4, background: "var(--w-line)" }}
						/>
						<nav className="grid grid-cols-2 gap-1 p-3">
							{more.map((m) => {
								const active = path.startsWith(m.to);
								return (
									<Link
										key={m.to}
										to={m.to}
										onClick={() => setMoreOpen(false)}
										className="flex items-center rounded-xl"
										style={{
											gap: 12,
											padding: "12px 14px",
											color: active ? "var(--w-brass-text)" : "var(--w-ink)",
											background: active ? "var(--w-panel-2)" : undefined,
										}}
									>
										<Icon name={m.icon} size={20} />
										<span className="font-display font-semibold" style={{ fontSize: 14 }}>
											{t(m.labelKey)}
										</span>
									</Link>
								);
							})}
						</nav>
					</div>
				</div>
			)}
			<div
				className="fixed right-0 bottom-0 left-0 flex border-line border-t bg-card"
				style={{ zIndex: 41, paddingBottom: "env(safe-area-inset-bottom)" }}
			>
				{TABS.map((tab) => {
					const active =
						(tab.to === "/" ? path === "/" : path.startsWith(tab.to)) ||
						(tab.activePrefix ? path.startsWith(tab.activePrefix) : false);
					const badge = tab.to === "/mail" ? mailUnread : 0;
					return (
						<Link
							key={tab.to}
							to={tab.to}
							onClick={() => setMoreOpen(false)}
							className="flex flex-1 flex-col items-center"
							style={{
								gap: 3,
								padding: "9px 0",
								color: active ? "var(--w-brass-text)" : "var(--w-ink-3)",
							}}
						>
							<span style={{ position: "relative", display: "inline-flex" }}>
								<Icon name={tab.icon} size={20} />
								{badge > 0 && (
									<span
										className="font-mono"
										style={{
											position: "absolute",
											top: -4,
											right: -9,
											minWidth: 14,
											height: 14,
											padding: "0 3px",
											borderRadius: 999,
											background: "var(--w-brass)",
											color: "#fff",
											fontSize: 8.5,
											lineHeight: "14px",
											textAlign: "center",
										}}
									>
										{badge > 99 ? "99+" : badge}
									</span>
								)}
							</span>
							<span className="font-display font-semibold" style={{ fontSize: 10 }}>
								{t(tab.labelKey)}
							</span>
						</Link>
					);
				})}
				<button
					type="button"
					onClick={() => setMoreOpen((o) => !o)}
					className="flex flex-1 flex-col items-center"
					style={{
						gap: 3,
						padding: "9px 0",
						color: moreOpen || moreActive ? "var(--w-brass-text)" : "var(--w-ink-3)",
					}}
				>
					<Icon name="vice" size={20} />
					<span className="font-display font-semibold" style={{ fontSize: 10 }}>
						{t("nav.more")}
					</span>
				</button>
				<button
					type="button"
					onClick={toggleWatson}
					className="flex flex-1 flex-col items-center text-brass-text"
					style={{ gap: 3, padding: "9px 0" }}
				>
					<span
						className="flex items-center justify-center rounded-full font-display font-extrabold"
						style={{
							width: 18,
							height: 18,
							border: "1.6px solid currentColor",
							fontSize: 9,
						}}
					>
						W
					</span>
					<span className="font-display font-semibold" style={{ fontSize: 10 }}>
						Watson
					</span>
				</button>
			</div>
		</>
	);
}
