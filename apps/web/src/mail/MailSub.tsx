/**
 * Mail — panel 1: účty a složky (prototyp data-msub, ř. 346–451).
 * Doručené (Vše / Připnuté / Odloženo / Gatekeeper / Dispečink / Dění), Složky,
 * Týmové schránky (barevné tečky, unread per schránka, AI× / warn tečka),
 * Osobní sféra (šifrováno · bez AI), Správa (Administrace / Nastavení).
 * Dění/Administrace/Nastavení jsou vnitřní obrazovky (m.scr) — aktivní složka
 * se zvýrazňuje jen na obrazovce "mail".
 */
import type { CSSProperties, ReactNode } from "react";
import { MB } from "./data";
import { useMail } from "./state";

const rowStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 10,
	padding: "7px 10px",
	borderRadius: "0 9px 9px 0",
	fontFamily: "var(--w-font-display)",
	fontWeight: 600,
	fontSize: 12.5,
	position: "relative",
	cursor: "pointer",
};

function SRow({
	active,
	onClick,
	title,
	children,
	pad,
}: {
	active: boolean;
	onClick: () => void;
	title?: string;
	children: ReactNode;
	pad?: string;
}) {
	return (
		<div
			data-srow
			data-active={active || undefined}
			onClick={onClick}
			title={title}
			style={{ ...rowStyle, padding: pad ?? rowStyle.padding }}
		>
			{children}
		</div>
	);
}

const Head = ({ children }: { children: ReactNode }) => (
	<div
		data-shead
		style={{
			fontFamily: "var(--w-font-display)",
			fontWeight: 700,
			fontSize: 10.5,
			letterSpacing: ".06em",
			textTransform: "uppercase",
			color: "var(--ink-3)",
			padding: "16px 10px 6px",
		}}
	>
		{children}
	</div>
);

const Badge = ({ children }: { children: ReactNode }) => (
	<span
		data-sublbl
		style={{
			fontFamily: "var(--w-font-mono)",
			fontSize: 10.5,
			color: "var(--ink-3)",
			flex: "none",
		}}
	>
		{children}
	</span>
);

/** Iniciály schránky pro sbalený panel (prototyp mbRows.ini). */
const mbIni = (short: string) =>
	short
		.replace("@", "")
		.split(/[^a-zA-Zžšřá-ž]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((w) => (w[0] ?? "").toUpperCase())
		.join("");

export function MailSub({
	drawer,
	onCloseDrawer,
	sube,
	onToggleSube,
}: {
	drawer: boolean;
	onCloseDrawer: () => void;
	/** Rozbalený panel složek; false = režim ikon 58 px (prototyp sube, CSS ≥1100 px). */
	sube: boolean;
	onToggleSube: () => void;
}) {
	const m = useMail();
	const un = m.unreadStats();

	const team = m.threads.filter((t) => !t.personal);
	const isDor = (t: (typeof team)[number]) => {
		const e = m.eff(t);
		return !t.sentF && !t.draftF && !e.arch && !e.snoozed && !e.spam && !e.trash;
	};
	const pinCount = team.filter((t) => m.eff(t).pin && isDor(t)).length;
	const snoozeCount = team.filter((t) => {
		const e = m.eff(t);
		return !!e.snoozed && !e.arch;
	}).length;
	const draftCount = team.filter(
		(t) => t.draftF || !!m.drafts[t.id]?.text?.trim(),
	).length;
	const dNeprCount = team.filter((t) => {
		const e = m.eff(t);
		return isDor(t) && t.grp === "inbox" && !e.owner && !e.closed;
	}).length;
	/** Aktivní složka platí jen na obrazovce seznamu (scr === "mail"). */
	const isF = (f: string) => m.scr === "mail" && m.folder === f;
	const dispOn = m.scr === "mail" && m.folder.startsWith("d_");

	return (
		<>
			<div
				data-msub
				data-open={drawer || undefined}
				style={{
					width: 238,
					flex: "none",
					background: "var(--panel-2)",
					borderRight: "1px solid var(--line)",
					display: "flex",
					flexDirection: "column",
					padding: "12px 10px 14px",
					overflow: "auto",
				}}
			>
				<div data-subhead style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 2px 5px" }}>
					<span
						data-sublbl
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 700,
							fontSize: 10.5,
							letterSpacing: ".06em",
							textTransform: "uppercase",
							color: "var(--ink-3)",
							padding: "2px 8px",
							flex: 1,
						}}
					>
						Doručené
					</span>
					{/* přepínač sbalení panelu na ikony (prototyp subToggle, ř. 349) */}
					<span
						data-rowbtn
						onClick={onToggleSube}
						title={sube ? "Sbalit složky na ikony" : "Rozbalit panel složek"}
						style={{
							border: "1px solid var(--line)",
							background: "var(--panel)",
							fontFamily: "var(--w-font-mono)",
							fontSize: 11,
						}}
					>
						{sube ? "«" : "»"}
					</span>
				</div>

				<SRow
					active={isF("vse")}
					onClick={() => m.setFolder("vse")}
					title="Vše — všechny týmové schránky dohromady; osobní pošta je zvlášť, nemíchá se"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" style={{ flex: "none" }} aria-hidden>
						<path d="M4 13.2 L6.6 5.4 A1 1 0 0 1 7.5 4.8 H16.5 A1 1 0 0 1 17.4 5.4 L20 13.2 V18.6 A1.2 1.2 0 0 1 18.8 19.8 H5.2 A1.2 1.2 0 0 1 4 18.6 Z" />
						<path d="M4 13.2 H8.2 L9.6 16 H14.4 L15.8 13.2 H20" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Vše</span>
					<Badge>{un.total || ""}</Badge>
				</SRow>

				<SRow active={isF("pinned")} onClick={() => m.setFolder("pinned")} title="Připnuté">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" style={{ flex: "none" }} aria-hidden>
						<path d="M9 4 H15 L14.2 10 C16 10.8 17 12.2 17.2 14 H6.8 C7 12.2 8 10.8 9.8 10 Z" />
						<line x1="12" y1="14" x2="12" y2="20" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Připnuté</span>
					<Badge>{pinCount || ""}</Badge>
				</SRow>

				<SRow active={isF("odlozene")} onClick={() => m.setFolder("odlozene")} title="Odloženo">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" style={{ flex: "none" }} aria-hidden>
						<circle cx="12" cy="12" r="8" />
						<path d="M12 7.5 V12 L15.2 14.4" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Odloženo</span>
					<Badge>{snoozeCount || ""}</Badge>
				</SRow>

				<SRow active={isF("gatekeeper")} onClick={() => m.setFolder("gatekeeper")} title="Gatekeeper — noví odesílatelé">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" style={{ flex: "none" }} aria-hidden>
						<path d="M12 3.6 L18.4 6 V11 C18.4 15.4 15.9 18.5 12 20.4 C8.1 18.5 5.6 15.4 5.6 11 V6 Z" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Gatekeeper</span>
					{m.gkLeft > 0 && (
						<span
							data-sublbl
							style={{
								fontFamily: "var(--w-font-mono)",
								fontSize: 10,
								background: "var(--brass-soft)",
								color: "var(--brass-text)",
								borderRadius: 999,
								padding: "1px 7px",
							}}
						>
							{m.gkLeft}
						</span>
					)}
				</SRow>

				<SRow
					active={dispOn}
					onClick={() => m.setFolder("d_nepr")}
					title="Dispečink — nepřiřazené · moje · ostatních · hotové"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" style={{ flex: "none" }} aria-hidden>
						<circle cx="9" cy="9" r="3" />
						<path d="M3.4 19 A5.9 5.9 0 0 1 14.6 19" />
						<path d="M15.5 6.4 A3 3 0 0 1 15.5 12.2" />
						<path d="M17.2 15.4 A5.9 5.9 0 0 1 20.6 19" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Dispečink</span>
					<span
						data-sublbl
						title="nepřiřazené čekají"
						style={{ fontFamily: "var(--w-font-mono)", fontSize: 10.5, color: "var(--brass-text)" }}
					>
						{dNeprCount || ""}
					</span>
				</SRow>

				{/* Dění — vnitřní obrazovka s celou osou (prototyp ř. 377–380) */}
				<SRow
					active={m.scr === "deni"}
					onClick={() => m.setScr("deni")}
					title="Dění — co se v týmové poště stalo"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden>
						<path d="M3 12 H7 L9.6 5.4 L14.4 18.6 L17 12 H21" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Dění</span>
				</SRow>

				<Head>Složky</Head>
				<SRow active={isF("f_sent")} onClick={() => m.setFolder("f_sent")} title="Odeslané" pad="6px 10px">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden>
						<path d="M4 11.5 L20 4 L14.5 20 L11.5 13 Z" />
						<path d="M11.5 13 L20 4" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Odeslané</span>
				</SRow>
				<SRow active={isF("f_drafts")} onClick={() => m.setFolder("f_drafts")} title="Koncepty" pad="6px 10px">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden>
						<path d="M4 20 L5.4 15.6 L16.4 4.6 A2.05 2.05 0 0 1 19.3 7.5 L8.3 18.5 Z" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Koncepty</span>
					<Badge>{draftCount || ""}</Badge>
				</SRow>
				<SRow active={isF("f_arch")} onClick={() => m.setFolder("f_arch")} title="Archiv" pad="6px 10px">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" style={{ flex: "none" }} aria-hidden>
						<rect x="4" y="8" width="16" height="11" rx="1.4" />
						<path d="M3.4 5 H20.6 V8 H3.4 Z" />
						<line x1="10" y1="12" x2="14" y2="12" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Archiv</span>
				</SRow>
				<SRow active={isF("f_trash")} onClick={() => m.setFolder("f_trash")} title="Koš" pad="6px 10px">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden>
						<path d="M4.5 7 H19.5" />
						<path d="M9.5 7 V4.8 H14.5 V7" />
						<path d="M6.5 7 L7.4 19.4 A1.2 1.2 0 0 0 8.6 20.5 H15.4 A1.2 1.2 0 0 0 16.6 19.4 L17.5 7" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Koš</span>
				</SRow>
				<SRow active={isF("f_block")} onClick={() => m.setFolder("f_block")} title="Blokované a spam" pad="6px 10px">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" style={{ flex: "none" }} aria-hidden>
						<circle cx="12" cy="12" r="8" />
						<line x1="6.5" y1="6.5" x2="17.5" y2="17.5" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Blokované</span>
				</SRow>

				<Head>Týmové schránky</Head>
				{Object.entries(MB).map(([id, mb]) => (
					<SRow key={id} active={m.scr === "mail" && m.folder === id} onClick={() => m.setFolder(id)} title={mb.short} pad="6px 10px">
						<span data-mbdot={id} style={{ width: 9, height: 9, borderRadius: "50%", flex: "none" }} />
						<span data-mbini={id}>{mbIni(mb.short)}</span>
						<div data-sublbl style={{ flex: 1, minWidth: 0 }}>
							<div
								style={{
									fontFamily: "var(--w-font-mono)",
									fontSize: 11.5,
									color: "var(--ink)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{mb.short}
							</div>
							<div style={{ fontFamily: "var(--w-font-body)", fontSize: 10, color: "var(--ink-3)", marginTop: 1 }}>
								{mb.team}
							</div>
						</div>
						{m.adm.ai[id] === "off" && (
							<span
								data-sublbl
								title="AI je pro tuto schránku vypnutá (osobní údaje žadatelů)"
								style={{
									fontFamily: "var(--w-font-mono)",
									fontSize: 9,
									color: "var(--ink-3)",
									border: "1px solid var(--line)",
									borderRadius: 4,
									padding: "0 4px",
									flex: "none",
								}}
							>
								AI×
							</span>
						)}
						{mb.warn && !m.adm.fixed && (
							<span
								data-sublbl
								data-health="warn"
								title="Token vyprší za 12 dní — klikem otevřeš Administraci"
								onClick={(e) => {
									e.stopPropagation();
									m.setScr("admin");
								}}
								style={{ cursor: "pointer", width: 7, height: 7, borderRadius: "50%", flex: "none" }}
							/>
						)}
						<Badge>{un.per[id] ?? ""}</Badge>
					</SRow>
				))}

				<Head>
					<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
						Osobní
						<svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ color: "var(--mb-osobni)" }} aria-hidden>
							<rect x="2.2" y="5" width="7.6" height="5.2" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
							<path d="M4 5 V3.8 A2 2 0 0 1 8 3.8 V5" stroke="currentColor" strokeWidth="1.3" />
						</svg>
					</span>
				</Head>
				<SRow
					active={isF("osobni")}
					onClick={() => m.setFolder("osobni")}
					title="kosir.adam@gmail.com — šifrováno, bez AI"
					pad="6px 10px"
				>
					<span data-mbdot="osobni" style={{ width: 9, height: 9, borderRadius: "50%", flex: "none" }} />
					<span data-mbini="osobni">KA</span>
					<div data-sublbl style={{ flex: 1, minWidth: 0 }}>
						<div
							style={{
								fontFamily: "var(--w-font-mono)",
								fontSize: 11.5,
								color: "var(--ink)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							kosir.adam@gmail.com
						</div>
						<div style={{ fontFamily: "var(--w-font-body)", fontSize: 10, color: "var(--mb-osobni)", marginTop: 1 }}>
							šifrováno · bez AI
						</div>
					</div>
					<Badge>{un.pers || ""}</Badge>
				</SRow>

				{/* Správa — vnitřní obrazovky Administrace + Nastavení (prototyp ř. 431–440) */}
				<Head>Správa</Head>
				<SRow
					active={m.scr === "admin"}
					onClick={() => m.setScr("admin")}
					title="Administrace pošty — schránky, přístupy, AI"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" style={{ flex: "none" }} aria-hidden>
						<path d="M5.5 4 V20 M12 4 V20 M18.5 4 V20" />
						<circle cx="5.5" cy="10" r="2.1" fill="var(--panel)" />
						<circle cx="12" cy="15.5" r="2.1" fill="var(--panel)" />
						<circle cx="18.5" cy="8" r="2.1" fill="var(--panel)" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Administrace</span>
					{MB.podcast?.warn && !m.adm.fixed && (
						<span
							data-sublbl
							data-health="warn"
							style={{ width: 7, height: 7, borderRadius: "50%", flex: "none" }}
						/>
					)}
				</SRow>
				<SRow
					active={m.scr === "nastaveni"}
					onClick={() => m.setScr("nastaveni")}
					title="Nastavení — notifikace, soukromí, podpisy"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" style={{ flex: "none" }} aria-hidden>
						<circle cx="12" cy="12" r="3.1" />
						<path d="M12 4.2 V6.6 M12 17.4 V19.8 M4.2 12 H6.6 M17.4 12 H19.8 M6.5 6.5 L8.2 8.2 M15.8 15.8 L17.5 17.5 M17.5 6.5 L15.8 8.2 M8.2 15.8 L6.5 17.5" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Nastavení</span>
				</SRow>
				{/* Příručka — co se stane s mailem, když přistane (prototyp ř. 441–444) */}
				<SRow
					active={m.scr === "prirucka"}
					onClick={() => m.setScr("prirucka")}
					title="Příručka — co se stane s mailem, když přistane"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden>
						<path d="M5 4.5 A1.8 1.8 0 0 1 6.8 3 H19 V19 H6.8 A1.8 1.8 0 0 0 5 20.8 Z" />
						<path d="M5 19 A1.8 1.8 0 0 1 6.8 17.2 H19" />
						<line x1="9" y1="7.5" x2="15" y2="7.5" />
					</svg>
					<span data-sublbl style={{ flex: 1 }}>Příručka</span>
				</SRow>
			</div>
			{drawer && (
				<div
					data-mscrim
					onClick={onCloseDrawer}
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 55,
						background: "rgba(23,40,63,.32)",
						animation: "wFade .15s ease",
					}}
				/>
			)}
		</>
	);
}
