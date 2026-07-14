import type { Priority } from "@watson/shared";
import type { CSSProperties } from "react";
import { cn } from "./cn";
import { Icon } from "./Icon";

export type AssignmentMode = "single" | "shared_any" | "shared_all";

export interface TaskCardProps {
	name: string;
	/** Priorita 1–4 — POUZE levý okraj (inset box-shadow), ne odznak. */
	priority: Priority;
	/** Tečka + podřádek projektu. */
	projectName?: string;
	projectColor?: string;
	/** Barva workspace — čtvereček 6×6 před názvem projektu (prototyp data-wsdot). */
	wsColor?: string;
	/** Per-uživatelská barva úkolu (hex) — podbarvení celého řádku (prototyp data-tc). */
	color?: string;
	due?: { label: string; overdue?: boolean };
	/** Deadline vlaječka „do pá 27. 6." (červená pilulka). */
	deadline?: string;
	/** Volitelný status label (Probíhá / Ke kontrole / Hotovo). */
	status?: { label: string; kind: "success" | "muted" };
	/** Krok postupu — chip „→ {název} ·· 2/5" se stavovými barvami; klik otevře postup. */
	flow?: {
		name: string;
		pos: number;
		total: number;
		state: string;
		onClick?: () => void;
	};
	/** Štafeta právě předána mně — chip „→ Přišlo na tebe". */
	handedOff?: boolean;
	handedOffLabel?: string;
	/** Checklist ⚏ N/M v podřádku. */
	checklist?: { done: number; total: number };
	/** Opakovaný úkol — ↻ v podřádku. */
	recurring?: boolean;
	/** Připomínka — zvoneček v podřádku. */
	reminder?: boolean;
	/** Počet komentářů v podřádku. */
	comments?: number;
	/** Režim „každý zvlášť" — pilulka `{label} · N/M` (prototyp ř. 437). */
	assignAll?: { done: number; total: number; label: string };
	/** Avatary přiřazených (max 3; první brass při shared_all). */
	avatars?: { initials: string; brass?: boolean }[];
	/** Spící krok postupu — šrafovaný řádek (prototyp data-dormant). */
	dormant?: boolean;
	/** Kontext vrstveného podúkolu — „↑ {rodič}" v podřádku. */
	parentName?: string;
	/** Meets — řádek je PORADA (kind='meeting'): brass levý okraj + chip místo P-odznaku. */
	meeting?: boolean;
	/** Úkol VZEŠLÝ z porady — chip „⌁ z porady" v podřádku; klik otevře board porady. */
	fromMeeting?: { label: string; onClick?: () => void };
	/** Popisek chipu porady („Porada"). Lokalizuje konzument. */
	meetingLabel?: string;
	done?: boolean;
	/**
	 * Výběr do hromadných akcí (prototyp data-selbox, ř. 550): čtvercový checkbox
	 * vlevo — skrytý, objeví se na hover řádku nebo když je vybráno; shift-klik = rozsah.
	 * Vybraný řádek má podklad brass-soft (data-selrow).
	 */
	sel?: { on: boolean; onToggle: (shiftKey: boolean) => void; title?: string };
	/**
	 * Rychlé přeplánování na hover (prototyp data-qsched/data-qsbtn, CSS ř. 112–115):
	 * chipy „Dnes / Zítra / Př. týden" před termínem. Lokalizuje konzument.
	 */
	sched?: { items: { key: string; label: string }[]; onShift: (key: string) => void };
	/** aria pro zaškrtávátko když je hotovo (klik → odškrtne). Lokalizuje konzument. */
	doneLabel?: string;
	/** aria pro zaškrtávátko když není hotovo (klik → dokončí). Lokalizuje konzument. */
	undoneLabel?: string;
	onToggle?: () => void;
	onOpen?: () => void;
}

const PRI: Record<Priority, string> = {
	1: "var(--w-p1)",
	2: "var(--w-p2)",
	3: "var(--w-p3)",
	4: "var(--w-p4)",
};

/** Světlý tint řádku z hex barvy (prototyp má fixní pastely; hex → 12% mix s kartou). */
const tint = (hex: string) => `color-mix(in srgb, ${hex} 12%, var(--w-card))`;

/**
 * Řádek úkolu — 1:1 dle prototypu ř. 415–443: checkbox (hover brass), tečka projektu
 * (grayscale u done), název + podřádek (ws tečka·projekt, chip postupu, „Přišlo na tebe",
 * checklist, ↻, zvoneček, komentáře), vpravo termín (mono) → deadline vlaječka → P-odznak
 * → status pilulka → „Každý zvlášť · N/M"/avatary. Levý okraj = priorita (inset 3px).
 */
export function TaskCard({
	name,
	priority,
	projectName,
	projectColor,
	wsColor,
	color,
	due,
	deadline,
	status,
	flow,
	handedOff,
	handedOffLabel,
	checklist,
	recurring,
	reminder,
	comments,
	assignAll,
	avatars,
	dormant,
	parentName,
	meeting,
	meetingLabel = "Meeting",
	fromMeeting,
	done,
	sel,
	sched,
	// packages/ui nemá i18n → EN neutrální fallback; konzument (TaskItem) předává lokalizované.
	doneLabel = "Mark as not done",
	undoneLabel = "Complete",
	onToggle,
	onOpen,
}: TaskCardProps) {
	// Vybraný řádek (hromadné akce) přebíjí tint barvy — prototyp data-selrow (CSS ř. 111).
	const rowBg: CSSProperties["background"] = sel?.on
		? "var(--w-brass-soft)"
		: dormant
			? "repeating-linear-gradient(135deg, transparent, transparent 7px, var(--w-panel-2) 7px, var(--w-panel-2) 8px)"
			: !done && color
				? tint(color)
				: undefined;
	const hasSub =
		!!projectName ||
		!!parentName ||
		!!flow ||
		!!fromMeeting ||
		handedOff ||
		!!checklist ||
		recurring ||
		reminder ||
		!!comments;

	return (
		<div
			onClick={onOpen}
			className={cn(
				// w-taskcard: na ≤480 px se metadata zalomí pod název (CC-P0-17, index.css)
				"group w-taskcard flex cursor-pointer items-center rounded-[10px] border border-line transition-shadow",
				!rowBg && "hover:bg-panel-2",
				"hover:shadow-md",
			)}
			style={{
				gap: 11,
				padding: "var(--w-row-py, 8px) 10px var(--w-row-py, 8px) 12px",
				marginBottom: 5,
				boxShadow:
					done || dormant
						? "var(--w-shadow-sm)"
						: `inset 3px 0 0 ${meeting ? "var(--w-brass)" : PRI[priority]}, var(--w-shadow-sm)`,
				opacity: done ? 0.5 : dormant ? 0.6 : 1,
				background: rowBg,
			}}
		>
			{/* výběr do hromadných akcí (prototyp data-selbox, ř. 550–551) */}
			{sel && (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						sel.onToggle(e.shiftKey);
					}}
					title={sel.title}
					aria-pressed={sel.on}
					className={cn(
						"w-taskselbox grid shrink-0 place-items-center border-[1.6px] border-line transition-opacity hover:border-brass",
						// skrytý checkbox nesmí být klikatelný (opacity-0 na dotyku =
						// neviditelný cíl) → pointer-events-none; hover/focus/vybraný vrací auto
						sel.on
							? "opacity-100"
							: "pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100",
					)}
					style={{ width: 16, height: 16, borderRadius: 5, marginRight: -4 }}
				>
					{sel.on && (
						<span
							style={{
								width: 9,
								height: 9,
								borderRadius: 2.5,
								background: "var(--w-brass)",
							}}
						/>
					)}
				</button>
			)}

			{/* zaškrtávátko */}
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onToggle?.();
				}}
				aria-label={done ? doneLabel : undoneLabel}
				className={cn(
					// w-taskcheck: na dotyku dostává 44px hit-area přes ::after (index.css)
					"w-taskcheck relative grid shrink-0 place-items-center rounded-full",
					!done && "hover:border-brass",
				)}
				style={{
					width: 18,
					height: 18,
					background: done ? "var(--w-brass)" : "transparent",
					border: done ? "none" : "2px solid var(--w-line)",
				}}
			>
				{done && (
					<svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
						<path
							d="M2 5.7 L4.3 8 L9 2.7"
							stroke="#fff"
							strokeWidth="1.7"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				)}
			</button>

			{/* tečka projektu */}
			<span
				className="w-projdot shrink-0 rounded-full"
				style={{
					width: 8,
					height: 8,
					background: projectColor ?? "var(--w-ink-3)",
					filter: done ? "grayscale(1)" : undefined,
					opacity: done ? 0.4 : 1,
				}}
			/>

			{/* název + podřádek */}
			<div className="min-w-0 flex-1">
				<div
					className={cn(
						"truncate font-display font-semibold",
						done ? "text-ink-3 line-through" : "text-ink",
					)}
					style={{ fontSize: "var(--w-row-font, 13.5px)", lineHeight: 1.3 }}
				>
					{name}
				</div>
				{hasSub && (
					<div
						className="w-tasksub flex items-center"
						style={{ gap: 10, marginTop: 1, lineHeight: 1.2 }}
					>
						{parentName && (
							<span
								className="min-w-0 truncate font-body text-ink-3"
								style={{ fontSize: 11.5, maxWidth: 180 }}
							>
								↑ {parentName}
							</span>
						)}
						{projectName && (
							<span className="inline-flex items-center" style={{ gap: 6 }}>
								{wsColor && (
									<span
										className="shrink-0"
										style={{
											width: 6,
											height: 6,
											borderRadius: 2,
											background: wsColor,
										}}
									/>
								)}
								<span className="font-body text-ink-3" style={{ fontSize: 11.5 }}>
									{projectName}
								</span>
							</span>
						)}
						{flow && <FlowChip flow={flow} />}
						{fromMeeting && (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									fromMeeting.onClick?.();
								}}
								className="inline-flex shrink-0 cursor-pointer items-center border-none font-display font-semibold"
								style={{
									gap: 4,
									fontSize: 10.5,
									padding: "2px 8px",
									borderRadius: 999,
									background: "var(--w-brass-soft)",
									color: "var(--w-brass-text)",
								}}
							>
								⌁ {fromMeeting.label}
							</button>
						)}
						{handedOff && (
							<span
								className="inline-flex shrink-0 items-center font-display font-semibold"
								style={{
									gap: 4,
									fontSize: 10.5,
									padding: "2px 8px",
									borderRadius: 999,
									background: "var(--w-brass-soft)",
									color: "var(--w-brass-text)",
								}}
							>
								{handedOffLabel}
							</span>
						)}
						{checklist && (
							<span
								className="inline-flex items-center font-mono text-ink-3"
								style={{ gap: 3, fontSize: 11 }}
							>
								<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
									<path
										d="M2.5 3 H9.5 M2.5 6 H9.5 M2.5 9 H6.5"
										stroke="currentColor"
										strokeWidth="1.2"
										strokeLinecap="round"
									/>
								</svg>
								{checklist.done}/{checklist.total}
							</span>
						)}
						{recurring && (
							<span className="font-mono text-ink-3" style={{ fontSize: 12 }}>
								↻
							</span>
						)}
						{reminder && (
							<svg
								width="11"
								height="11"
								viewBox="0 0 12 12"
								fill="none"
								aria-hidden
								style={{ color: "var(--w-ink-3)", flexShrink: 0 }}
							>
								<path d="M3 9 V5.6 a3 3 0 0 1 6 0 V9" stroke="currentColor" strokeWidth="1.2" />
								<line
									x1="2.2"
									y1="9"
									x2="9.8"
									y2="9"
									stroke="currentColor"
									strokeWidth="1.2"
									strokeLinecap="round"
								/>
							</svg>
						)}
						{!!comments && (
							<span
								className="inline-flex items-center font-mono text-ink-3"
								style={{ gap: 3, fontSize: 11 }}
							>
								<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
									<rect
										x="1.3"
										y="2"
										width="9.4"
										height="6.4"
										rx="2"
										stroke="currentColor"
										strokeWidth="1.2"
									/>
									<path
										d="M4 8.4 L4 10 L6 8.4"
										stroke="currentColor"
										strokeWidth="1.2"
										fill="none"
										strokeLinejoin="round"
									/>
								</svg>
								{comments}
							</span>
						)}
					</div>
				)}
			</div>

			{/* Pravostranná metadata: na desktopu display:contents (layout 1:1 beze změny),
			    na ≤480 px vlastní zalomený řádek pod názvem (CC-P0-17). */}
			<span className="w-taskmeta">
				{/* rychlé přeplánování — jen na hover (prototyp data-qsched) */}
				{sched && !done && (
					<span
						data-qsched
						className="hidden shrink-0 items-center group-hover:inline-flex"
						style={{ gap: 3 }}
					>
						{sched.items.map((it) => (
							<button
								key={it.key}
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									sched.onShift(it.key);
								}}
								className="cursor-pointer whitespace-nowrap rounded-md border border-line bg-card font-mono text-ink-3 hover:border-brass hover:text-brass-text"
								style={{ fontSize: 9.5, padding: "2px 6px" }}
							>
								{it.label}
							</button>
						))}
					</span>
				)}

				{/* termín (mono) */}
				{due && (
					<span
						className="shrink-0 font-mono"
						style={{
							fontSize: 12,
							color: due.overdue ? "var(--w-overdue)" : "var(--w-ink-2)",
						}}
					>
						{due.label}
					</span>
				)}

				{/* deadline vlaječka */}
				{deadline && (
					<span
						className="inline-flex shrink-0 items-center font-mono"
						style={{
							gap: 3,
							fontSize: 11,
							color: "var(--w-overdue)",
							background: "var(--w-overdue-soft)",
							padding: "2px 7px",
							borderRadius: 999,
						}}
					>
						<svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
							<path
								d="M3 1.5 V10.5 M3 2 H9 L7.4 4 L9 6 H3"
								stroke="currentColor"
								strokeWidth="1.2"
								fill="none"
								strokeLinejoin="round"
							/>
						</svg>
						{deadline}
					</span>
				)}

				{/* prioritní odznak — NEUTRÁLNÍ pill (barva priority je jen levý okraj);
			    u PORADY místo něj brass chip „Porada" (priorita je u schůzky šum) */}
				{meeting ? (
					<span
						className="inline-flex shrink-0 items-center font-display font-semibold"
						style={{
							gap: 4,
							fontSize: 10.5,
							padding: "2px 9px",
							borderRadius: 999,
							background: "var(--w-brass-soft)",
							border: "1px solid var(--w-brass)",
							color: "var(--w-brass-text)",
						}}
					>
						{/* sdílená ikona lidí z registru ICONS (žádný druhý bespoke glyf) */}
						<Icon name="tym" size={11} />
						{meetingLabel}
					</span>
				) : (
					<span
						className="shrink-0 font-display font-semibold"
						style={{
							fontSize: 11,
							padding: "2px 8px",
							borderRadius: 999,
							background: "var(--w-card)",
							border: `1px solid ${priority === 1 ? "var(--w-ink-3)" : "var(--w-line)"}`,
							color:
								priority === 1
									? "var(--w-ink)"
									: priority === 4
										? "var(--w-ink-3)"
										: "var(--w-ink-2)",
						}}
					>
						P{priority}
					</span>
				)}

				{/* status (volitelný) */}
				{status && (
					<span
						className="shrink-0 font-display font-semibold"
						style={{
							fontSize: 11,
							padding: "3px 9px",
							borderRadius: 999,
							background: status.kind === "success" ? "var(--w-success-soft)" : "var(--w-panel-2)",
							color: status.kind === "success" ? "var(--w-success-ink)" : "var(--w-ink-2)",
						}}
					>
						{status.label}
					</span>
				)}

				{/* „Každý zvlášť · N/M" + avatary / jen avatary */}
				{assignAll && (
					<span
						className="shrink-0 font-display font-semibold"
						style={{
							fontSize: 11,
							padding: "3px 9px",
							borderRadius: 999,
							background: "var(--w-panel-2)",
							color: "var(--w-ink-2)",
						}}
					>
						{assignAll.label} ·{" "}
						<span className="font-mono">
							{assignAll.done}/{assignAll.total}
						</span>
					</span>
				)}
				{avatars && avatars.length > 0 && (
					<span className="inline-flex shrink-0 items-center">
						{avatars.map((a, i) => (
							<span
								key={`${a.initials}-${i}`}
								className="flex items-center justify-center rounded-full font-display font-semibold"
								style={{
									width: 22,
									height: 22,
									color: "#fff",
									fontSize: 10,
									background: a.brass ? "var(--w-brass)" : "var(--w-avatar)",
									boxShadow: "0 0 0 2px var(--w-card)",
									marginLeft: i > 0 ? -6 : 0,
								}}
							>
								{a.initials}
							</span>
						))}
					</span>
				)}
			</span>
		</div>
	);
}

/** Chip postupu — „→ {název} ·· 2/5" se stavovými barvami (prototyp ř. 423 + CSS 121–123). */
function FlowChip({ flow }: { flow: NonNullable<TaskCardProps["flow"]> }) {
	const stateStyle: CSSProperties =
		flow.state === "active"
			? {
					background: "var(--w-brass-soft)",
					border: "1px solid var(--w-brass)",
					color: "var(--w-brass-text)",
				}
			: flow.state === "done"
				? {
						background: "var(--w-success-soft)",
						border: "1px solid transparent",
						color: "var(--w-success-ink)",
					}
				: {
						background: "var(--w-panel-2)",
						border: "1px solid var(--w-line)",
						color: "var(--w-ink-3)",
						opacity: 0.85,
					};
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				flow.onClick?.();
			}}
			title={`${flow.name} · krok ${flow.pos}/${flow.total}`}
			className="inline-flex max-w-56 shrink-0 items-center font-display font-semibold"
			style={{
				gap: 5,
				fontSize: 10.5,
				padding: "2px 8px",
				borderRadius: 999,
				cursor: "pointer",
				...stateStyle,
			}}
		>
			<svg
				width="11"
				height="11"
				viewBox="0 0 12 12"
				fill="none"
				aria-hidden
				style={{ flexShrink: 0 }}
			>
				<path
					d="M1.5 6 H8 M5.5 3 L8.5 6 L5.5 9"
					stroke="currentColor"
					strokeWidth="1.3"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
			<span className="truncate">{flow.name}</span>
			<span className="inline-flex items-center" style={{ gap: 3 }}>
				{Array.from({ length: Math.min(flow.total, 8) }, (_, i) => {
					const idx = i + 1;
					const fill =
						idx < flow.pos
							? "var(--w-ink-3)"
							: idx === flow.pos
								? flow.state === "done"
									? "var(--w-ink-3)"
									: "var(--w-brass)"
								: "transparent";
					return (
						<span
							key={idx}
							className="shrink-0 rounded-full"
							style={{
								width: 5,
								height: 5,
								background: fill,
								boxShadow: idx > flow.pos ? "inset 0 0 0 1px var(--w-line)" : "none",
							}}
						/>
					);
				})}
			</span>
			{flow.pos}/{flow.total}
		</button>
	);
}
