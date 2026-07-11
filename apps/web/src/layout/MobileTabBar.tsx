import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon, type IconName } from "@watson/ui";
import { useState } from "react";
import { useWatson } from "../lib/watson";
import { isLeadership, useWorkspaces } from "../lib/workspace";

const TABS: {
	to: "/" | "/ukoly" | "/nadchazejici" | "/projekty";
	icon: IconName;
	labelKey: string;
}[] = [
	{ to: "/", icon: "dnes", labelKey: "nav.today" },
	{ to: "/ukoly", icon: "ukoly", labelKey: "nav.tasks" },
	{ to: "/nadchazejici", icon: "nadchazejici", labelKey: "nav.upcoming" },
	{ to: "/projekty", icon: "projekty", labelKey: "nav.projects" },
];

/** Sekce dostupné přes „Více" (na mobilu není sidebar → jinak nedosažitelné). */
const MORE: { to: string; icon: IconName; labelKey: string }[] = [
	{ to: "/prehled", icon: "prehled", labelKey: "nav.overview" },
	{ to: "/mail", icon: "mail", labelKey: "nav.mail" },
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

/** Mobilní spodní lišta: 4 hlavní navigace + „Více" (list ostatních sekcí) + Watson. */
export function MobileTabBar() {
	const { t } = useTranslation();
	const { toggleWatson } = useWatson();
	const path = useRouterState({ select: (s) => s.location.pathname });
	const [moreOpen, setMoreOpen] = useState(false);
	const { data: workspaces } = useWorkspaces();

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
											color: active
												? "var(--w-brass-text)"
												: "var(--w-ink)",
											background: active ? "var(--w-panel-2)" : undefined,
										}}
									>
										<Icon name={m.icon} size={20} />
										<span
											className="font-display font-semibold"
											style={{ fontSize: 14 }}
										>
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
					const active = tab.to === "/" ? path === "/" : path.startsWith(tab.to);
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
							<Icon name={tab.icon} size={20} />
							<span
								className="font-display font-semibold"
								style={{ fontSize: 10 }}
							>
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
						color:
							moreOpen || moreActive
								? "var(--w-brass-text)"
								: "var(--w-ink-3)",
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
