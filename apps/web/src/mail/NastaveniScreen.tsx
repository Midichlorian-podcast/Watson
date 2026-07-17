/**
 * Nastavení — Mail (osobní volby, platí jen pro uživatele; prototyp šablona
 * ř. 1609–1759 + logika nastV, ř. 3339–3403). Vzhled je napojený na reálný
 * app-wide motiv (kontrakt `vzhled` → useTheme), „Nepřečtené ve sdílených
 * schránkách" na SDÍLENÝ m.perOsoba/m.setPerOsoba (globální výchozí, per
 * schránka se ladí v Administraci). Zbytek (notifikace, VIP, soukromí,
 * chování po archivaci, OOO, podpisy) je demo vrstva držená lokálně
 * (useState z NAST_SEED). Swipe gesta vynechána — seznam je zatím nemá.
 */
import { useState } from "react";
import { useTheme } from "../layout/useTheme";
import { showToast } from "../lib/toast";
import { MB, NAST_SEED, type NastSeed } from "./data";
import { MailboxWizard } from "./MailboxWizard";
import { sigIdOf } from "./SigPicker";
import { useMail } from "./state";

/** Kopie osobního seedu — lokální demo stav se nesmí propsat do seedu. */
const nastInit = (): NastSeed => ({
	...NAST_SEED,
	notif: { ...NAST_SEED.notif },
	vip: [...NAST_SEED.vip],
});

/** Demo mezipaměť — volby přežijí odchod z obrazovky v rámci session
 * (prototyp drží nast v globálním state; state API modulu nerozšiřujeme). */
const cache: { nast: NastSeed } = { nast: nastInit() };

const cardStyle = {
	background: "var(--panel)",
	border: "1px solid var(--line)",
	borderRadius: 14,
	marginTop: 16,
	overflow: "hidden",
} as const;

const segTab = {
	fontFamily: "var(--w-font-display)",
	fontWeight: 600,
	fontSize: 10.5,
	padding: "3px 11px",
	borderRadius: 999,
	cursor: "pointer",
} as const;

const pillStyle = {
	fontFamily: "var(--w-font-display)",
	fontWeight: 600,
	fontSize: 10.5,
	padding: "3px 10px",
	borderRadius: 999,
	flex: "none",
} as const;

/** Titulek karty (prototyp „Notifikace“, „Soukromí“, …). */
const headStyle = {
	fontFamily: "var(--w-font-display)",
	fontWeight: 700,
	fontSize: 13,
	color: "var(--ink)",
	padding: "13px 18px 11px",
	borderBottom: "1px solid var(--line)",
} as const;

/** Inline editor jednoho podpisu (název + tělo po řádcích). */
function SigEditor({
	ed,
	setEd,
	onSave,
}: {
	ed: { id: string | null; n: string; b: string };
	setEd: (v: { id: string | null; n: string; b: string } | null) => void;
	onSave: () => void;
}) {
	return (
		<div
			style={{
				padding: "12px 18px",
				borderBottom: "1px solid var(--line)",
				background: "var(--panel-2)",
			}}
		>
			<input
				value={ed.n}
				onChange={(e) => setEd({ ...ed, n: e.target.value })}
				placeholder="Název podpisu (např. Plný, Krátký)"
				style={{
					width: "100%",
					boxSizing: "border-box",
					border: "1px solid var(--line)",
					background: "var(--panel)",
					borderRadius: 9,
					padding: "8px 11px",
					fontFamily: "var(--w-font-display)",
					fontWeight: 600,
					fontSize: 12.5,
					color: "var(--ink)",
					outline: "none",
				}}
			/>
			<textarea
				value={ed.b}
				onChange={(e) => setEd({ ...ed, b: e.target.value })}
				rows={4}
				placeholder="Tělo podpisu — každý řádek zvlášť. Prázdné = bez podpisu."
				style={{
					width: "100%",
					boxSizing: "border-box",
					border: "1px solid var(--line)",
					background: "var(--panel)",
					borderRadius: 10,
					padding: "9px 11px",
					marginTop: 8,
					fontFamily: "var(--w-font-body)",
					fontSize: 12.5,
					color: "var(--ink)",
					lineHeight: 1.55,
					outline: "none",
					resize: "none",
				}}
			/>
			<div style={{ display: "flex", gap: 7, marginTop: 8 }}>
				<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }} onClick={onSave} data-primary style={{ fontSize: 11.5, padding: "6px 14px" }}>
					Uložit
				</span>
				<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
					onClick={() => setEd(null)}
					data-ghost
					style={{ fontSize: 11.5, padding: "6px 12px" }}
				>
					Zrušit
				</span>
			</div>
		</div>
	);
}

export function NastaveniScreen({ embedded = false }: { embedded?: boolean } = {}) {
	const m = useMail();
	const { theme, toggle } = useTheme();
	const [nast, setNastRaw] = useState<NastSeed>(cache.nast);
	const [mailboxManagerOpen, setMailboxManagerOpen] = useState(false);
	// editor podpisu: {id:null} = nový, jinak úprava existujícího (název + tělo po řádcích)
	const [sigEd, setSigEd] = useState<{ id: string | null; n: string; b: string } | null>(null);

	const setNast = (patch: Partial<NastSeed>) => {
		cache.nast = { ...cache.nast, ...patch };
		setNastRaw(cache.nast);
	};

	const addVip = () => {
		const v = nast.vipIn.trim().toLowerCase();
		if (!v) return;
		// duplicitní adresa → kolizní React key + mazání by smazalo obě (audit LOW
		// NastaveniScreen.tsx:176); normalizace na lowercase drží e-maily jednoznačné
		if (nast.vip.some((z) => z.toLowerCase() === v)) {
			setNast({ vipIn: "" });
			showToast(`${v} už je mezi VIP`);
			return;
		}
		setNast({ vip: [...nast.vip, v], vipIn: "" });
		showToast(`Přidáno mezi VIP — ${v} upozorní vždy, i při úrovni VIP`);
	};

	/** Řádky notifikací: 4 týmové schránky + osobní (prototyp notifRows, ř. 3348). */
	const notifRows = ["info", "granty", "podcast", "studio", "osobni"].map((id) => ({
		id,
		addr: id === "osobni" ? "kosir.adam@gmail.com" : (MB[id]?.addr ?? id),
	}));

	/** Identity pro výběr výchozího podpisu: 4 schránky + osobní. */
	const sigIdents = ["info", "granty", "podcast", "studio", "osobni"].map((id) => ({
		id,
		label: id === "osobni" ? "osobní" : (MB[id]?.short ?? id),
	}));

	/** Ulož editor: prázdné tělo (jen bílé řádky) = podpis „bez podpisu" ([]). */
	const saveSig = () => {
		if (!sigEd) return;
		const lines = sigEd.b.split("\n");
		const body = lines.every((l) => !l.trim()) ? [] : lines;
		const name = sigEd.n.trim() || "Podpis";
		if (sigEd.id) m.updateSig(sigEd.id, { n: name, body });
		else m.addSig(name, body);
		setSigEd(null);
		showToast(sigEd.id ? "Podpis upraven" : "Podpis přidán");
	};

	return (
		<div
			data-screen-label={embedded ? undefined : "Nastavení — Mail"}
			style={embedded ? undefined : { flex: 1, overflow: "auto", background: "var(--panel-2)" }}
		>
			<div
				style={
					embedded ? undefined : { maxWidth: 760, margin: "0 auto", padding: "20px 26px 46px" }
				}
			>
				{!embedded && (
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-ghost
						onClick={() => m.setScr("mail")}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							fontSize: 12,
							padding: "6px 12px",
						}}
					>
						← Mail
					</span>
				)}
				{!embedded && (
					<div
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 800,
							fontSize: 20,
							color: "var(--ink)",
							marginTop: 14,
						}}
					>
						Nastavení — Mail
					</div>
				)}
				<div
					style={{
						fontFamily: "var(--w-font-body)",
						fontSize: 12.5,
						color: "var(--ink-3)",
						marginTop: embedded ? 0 : 4,
					}}
				>
					Osobní volby — platí jen pro tebe, na všech zařízeních.
				</div>

				{/* ── Vzhled — jen samostatně; v globálním Nastavení už motiv sekci má ── */}
				{!embedded && (
					<div style={{ ...cardStyle, marginTop: 18 }}>
						<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px" }}>
							<span
								style={{
									flex: 1,
									fontFamily: "var(--w-font-display)",
									fontWeight: 700,
									fontSize: 13,
									color: "var(--ink)",
								}}
							>
								Vzhled
							</span>
							<span
								style={{
									display: "inline-flex",
									background: "var(--panel-2)",
									border: "1px solid var(--line)",
									borderRadius: 999,
									padding: 2,
								}}
							>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => theme === "dark" && toggle()}
									data-tab
									data-active={theme === "light" || undefined}
									style={{ ...segTab, fontSize: 11, padding: "4px 13px" }}
								>
									Světlý
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => theme === "light" && toggle()}
									data-tab
									data-active={theme === "dark" || undefined}
									style={{ ...segTab, fontSize: 11, padding: "4px 13px" }}
								>
									Tmavý
								</span>
							</span>
						</div>
					</div>
				)}

				{/* ── Notifikace (prototyp ř. 1627–1651) ── */}
				<div style={cardStyle}>
					<div style={headStyle}>Notifikace</div>
					{notifRows.map((r) => (
						<div
							key={r.id}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 10,
								padding: "10px 18px",
								borderBottom: "1px solid var(--line)",
								flexWrap: "wrap",
							}}
						>
							<span
								data-mbdot={r.id}
								style={{ width: 9, height: 9, borderRadius: "50%", flex: "none" }}
							/>
							<span
								style={{
									flex: 1,
									minWidth: 150,
									fontFamily: "var(--w-font-mono)",
									fontSize: 11,
									color: "var(--ink-2)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{r.addr}
							</span>
							<span
								style={{
									display: "inline-flex",
									background: "var(--panel-2)",
									border: "1px solid var(--line)",
									borderRadius: 999,
									padding: 2,
								}}
							>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => setNast({ notif: { ...nast.notif, [r.id]: "vse" } })}
									data-tab
									data-active={nast.notif[r.id] === "vse" || undefined}
									style={segTab}
								>
									Všechny
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => setNast({ notif: { ...nast.notif, [r.id]: "vip" } })}
									data-tab
									data-active={nast.notif[r.id] === "vip" || undefined}
									title="Jen P1–P2, přiřazení a @zmínky"
									style={segTab}
								>
									VIP
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => setNast({ notif: { ...nast.notif, [r.id]: "zadne" } })}
									data-tab
									data-active={nast.notif[r.id] === "zadne" || undefined}
									style={segTab}
								>
									Žádné
								</span>
							</span>
						</div>
					))}
					<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 18px" }}>
						<span
							title="Přerušit smí jen P1 — override zapíná eskalující manažer/admin, ne odesílatel"
							style={{
								flex: 1,
								fontFamily: "var(--w-font-body)",
								fontSize: 12,
								color: "var(--ink-2)",
							}}
						>
							Tiché hodiny{" "}
							<span
								style={{ fontFamily: "var(--w-font-mono)", fontSize: 10.5, color: "var(--ink-3)" }}
							>
								21:00–7:00
							</span>{" "}
							<span
								style={{ fontFamily: "var(--w-font-body)", fontSize: 10.5, color: "var(--ink-3)" }}
							>
								— přerušit smí jen P1
							</span>
						</span>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							data-statepill
							data-on={nast.quiet || undefined}
							onClick={() => setNast({ quiet: !nast.quiet })}
							style={pillStyle}
						>
							{nast.quiet ? "zapnuté" : "vypnuté"}
						</span>
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 7,
							padding: "0 18px 12px",
							flexWrap: "wrap",
						}}
					>
						<span
							style={{
								fontFamily: "var(--w-font-body)",
								fontSize: 11,
								color: "var(--ink-3)",
								flex: "none",
							}}
						>
							VIP odesílatelé <span>— upozorní vždy:</span>
						</span>
						{nast.vip.map((addr) => (
							<span
								key={addr}
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 6,
									fontFamily: "var(--w-font-mono)",
									fontSize: 10,
									color: "var(--ink-2)",
									border: "1px solid var(--line)",
									borderRadius: 999,
									padding: "2px 6px 2px 9px",
								}}
							>
								{addr}
								<button
									type="button"
									aria-label={`Odebrat VIP adresu ${addr}`}
									onClick={() => setNast({ vip: nast.vip.filter((z) => z !== addr) })}
									style={{
										width: 44,
										height: 44,
										border: 0,
										background: "transparent",
										cursor: "pointer",
										color: "var(--ink-2)",
										fontSize: 16,
										lineHeight: 1,
									}}
								>
									×
								</button>
							</span>
						))}
						<input
							value={nast.vipIn}
							onChange={(e) => setNast({ vipIn: e.target.value })}
							onKeyDown={(e) => {
								if (e.key === "Enter") addVip();
							}}
							placeholder="přidat adresu ⏎"
							aria-label="Přidat VIP e-mailovou adresu"
							style={{
								width: 150,
								minHeight: 44,
								border: "1px dashed var(--line)",
								background: "transparent",
								borderRadius: 999,
								padding: "3px 10px",
								fontFamily: "var(--w-font-mono)",
								fontSize: 10,
								color: "var(--ink)",
								outline: "none",
							}}
						/>
					</div>
				</div>

				{/* ── Soukromí (prototyp ř. 1671–1687) ── */}
				<div style={cardStyle}>
					<div style={headStyle}>Soukromí</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 10,
							padding: "11px 18px",
							borderBottom: "1px solid var(--line)",
						}}
					>
						<div style={{ flex: 1 }}>
							<div
								style={{ fontFamily: "var(--w-font-body)", fontSize: 12, color: "var(--ink-2)" }}
							>
								Vzdálené obrázky v mailech
							</div>
							<div
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 10.5,
									color: "var(--ink-3)",
									marginTop: 1,
								}}
							>
								blokování skryje sledovací pixely — načteš je pak jedním klikem
							</div>
						</div>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							data-statepill
							data-on={nast.privImg || undefined}
							onClick={() => setNast({ privImg: !nast.privImg })}
							style={pillStyle}
						>
							{nast.privImg ? "načítat" : "blokovat"}
						</span>
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 18px" }}>
						<div style={{ flex: 1 }}>
							<div
								style={{ fontFamily: "var(--w-font-body)", fontSize: 12, color: "var(--ink-2)" }}
							>
								Automatické stahování příloh
							</div>
							<div
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 10.5,
									color: "var(--ink-3)",
									marginTop: 1,
								}}
							>
								pro rychlé náhledy; vypni na pomalém připojení
							</div>
						</div>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							data-statepill
							data-on={nast.privAtt || undefined}
							onClick={() => setNast({ privAtt: !nast.privAtt })}
							style={pillStyle}
						>
							{nast.privAtt ? "zapnuto" : "vypnuto"}
						</span>
					</div>
				</div>

				{/* ── Po archivaci / smazání (prototyp ř. 1689–1700) ── */}
				<div style={cardStyle}>
					<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px" }}>
						<div style={{ flex: 1 }}>
							<div
								style={{
									fontFamily: "var(--w-font-display)",
									fontWeight: 700,
									fontSize: 13,
									color: "var(--ink)",
								}}
							>
								Po archivaci / smazání
							</div>
							<div
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 10.5,
									color: "var(--ink-3)",
									marginTop: 1,
								}}
							>
								kam tě pošle vyřízení konverzace
							</div>
						</div>
						<span
							style={{
								display: "inline-flex",
								background: "var(--panel-2)",
								border: "1px solid var(--line)",
								borderRadius: 999,
								padding: 2,
								flex: "none",
							}}
						>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => setNast({ beh: "dalsi" })}
								data-tab
								data-active={nast.beh !== "seznam" || undefined}
								style={segTab}
							>
								Další konverzace
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => setNast({ beh: "seznam" })}
								data-tab
								data-active={nast.beh === "seznam" || undefined}
								style={segTab}
							>
								Zpět na seznam
							</span>
						</span>
					</div>
				</div>

				{/* ── Nepřečtené ve sdílených schránkách (prototyp ř. 1702–1714) — SDÍLENÝ m.perOsoba ── */}
				<div style={cardStyle}>
					<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px" }}>
						<div style={{ flex: 1 }}>
							<div
								style={{
									fontFamily: "var(--w-font-display)",
									fontWeight: 700,
									fontSize: 13,
									color: "var(--ink)",
								}}
							>
								Nepřečtené ve sdílených schránkách
							</div>
							<div
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 10.5,
									color: "var(--ink-3)",
									marginTop: 1,
								}}
							>
								komu se konverzace označí jako přečtená po otevření
							</div>
						</div>
						<span
							style={{
								display: "inline-flex",
								background: "var(--panel-2)",
								border: "1px solid var(--line)",
								borderRadius: 999,
								padding: 2,
								flex: "none",
							}}
						>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => {
									m.setPerOsoba(true);
									showToast(
										"Per osoba: mail se ti odškrtne, až ho otevřeš ty — kolegovo čtení tvoje nepřečtené nemění",
									);
								}}
								data-tab
								data-active={m.perOsoba || undefined}
								style={segTab}
							>
								Per osoba
							</span>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => {
									m.setPerOsoba(false);
									showToast(
										"Sdílené čtení: první otevření kýmkoli označí přečteno všem — pozor, snadno něco propadne",
									);
								}}
								data-tab
								data-active={!m.perOsoba || undefined}
								style={segTab}
							>
								Sdílené
							</span>
						</span>
					</div>
					<div
						style={{
							fontFamily: "var(--w-font-body)",
							fontSize: 10.5,
							color: "var(--ink-3)",
							padding: "10px 18px",
							background: "var(--panel-2)",
						}}
					>
						Per osoba: mail zůstává nepřečtený pro každého člena schránky, dokud ho sám neotevře —
						nic nepropadne jen proto, že to viděl kolega (u řádku se ukáže „Petra už četla“).
						Sdílené: první otevření kýmkoli označí přečteno všem. Interní stavy Nový / Otevřený /
						Čeká tím nejsou dotčené. Jednotlivé schránky jdou přepnout zvlášť v Administraci →
						Nepřečtené.
					</div>
				</div>

				{/* ── Podpisy — uživatelsky definované, výchozí per schránka (persistováno) ── */}
				<div style={cardStyle}>
					<div style={headStyle}>Podpisy</div>

					{/* seznam vytvořených podpisů + inline editor */}
					{m.sigs.map((s) =>
						sigEd && sigEd.id === s.id ? (
							<SigEditor key={s.id} ed={sigEd} setEd={setSigEd} onSave={saveSig} />
						) : (
							<div
								key={s.id}
								style={{
									display: "flex",
									alignItems: "flex-start",
									gap: 10,
									padding: "10px 18px",
									borderBottom: "1px solid var(--line)",
								}}
							>
								<div style={{ flex: 1, minWidth: 0 }}>
									<div
										style={{
											fontFamily: "var(--w-font-display)",
											fontWeight: 600,
											fontSize: 12.5,
											color: "var(--ink)",
										}}
									>
										{s.n}
									</div>
									<div
										style={{
											fontFamily: "var(--w-font-body)",
											fontSize: 11,
											color: "var(--ink-3)",
											marginTop: 2,
											whiteSpace: "pre-line",
											lineHeight: 1.5,
										}}
									>
										{s.body.length ? s.body.join("\n") : "— bez textu —"}
									</div>
								</div>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									data-ghost
									onClick={() => setSigEd({ id: s.id, n: s.n, b: s.body.join("\n") })}
									style={{ fontSize: 11, padding: "4px 10px", flex: "none" }}
								>
									Upravit
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									data-ghost
									onClick={() => {
										m.deleteSig(s.id);
										showToast(`Podpis „${s.n}" smazán`);
									}}
									title="Smazat podpis"
									style={{
										fontSize: 11,
										padding: "4px 10px",
										flex: "none",
										color: "var(--overdue)",
									}}
								>
									Smazat
								</span>
							</div>
						),
					)}

					{/* nový podpis (editor mimo seznam) */}
					{sigEd && sigEd.id === null ? (
						<SigEditor ed={sigEd} setEd={setSigEd} onSave={saveSig} />
					) : (
						<div style={{ padding: "10px 18px", borderBottom: "1px solid var(--line)" }}>
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								data-ghost
								onClick={() => setSigEd({ id: null, n: "", b: "" })}
								style={{ fontSize: 11.5, padding: "5px 12px" }}
							>
								+ Nový podpis
							</span>
						</div>
					)}

					{/* výchozí podpis per schránka (= sigChoice, čte composer i odeslání) */}
					<div
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 700,
							fontSize: 11,
							letterSpacing: ".04em",
							textTransform: "uppercase",
							color: "var(--ink-3)",
							padding: "12px 18px 4px",
						}}
					>
						Výchozí podle schránky
					</div>
					{sigIdents.map((idn) => {
						const cur = sigIdOf(m.sigChoice, idn.id);
						return (
							<div
								key={idn.id}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									padding: "9px 18px",
									borderBottom: "1px solid var(--line)",
									flexWrap: "wrap",
								}}
							>
								<span
									data-mbdot={idn.id}
									style={{ width: 9, height: 9, borderRadius: "50%", flex: "none" }}
								/>
								<span
									style={{
										width: 78,
										flex: "none",
										fontFamily: "var(--w-font-mono)",
										fontSize: 11,
										color: "var(--ink-2)",
									}}
								>
									{idn.label}
								</span>
								<div style={{ display: "flex", gap: 5, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
									{m.sigs.map((s) => (
										<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
											key={s.id}
											onClick={() => m.setSigChoice(idn.id, s.id)}
											data-statepill
											data-on={cur === s.id || undefined}
											style={{
												fontFamily: "var(--w-font-display)",
												fontWeight: 600,
												fontSize: 10.5,
												padding: "3px 10px",
												borderRadius: 999,
												cursor: "pointer",
												whiteSpace: "nowrap",
											}}
										>
											{s.n}
										</span>
									))}
								</div>
							</div>
						);
					})}

					<div
						style={{
							fontFamily: "var(--w-font-body)",
							fontSize: 10.5,
							color: "var(--ink-3)",
							padding: "10px 18px",
							background: "var(--panel-2)",
						}}
					>
						Podpis se doplňuje podle schránky, za kterou odpovídáš — ne podle toho, kdo píše. V okně
						psaní ho ještě přepneš tlačítkem Podpis. Volba i podpisy se ukládají do prohlížeče.
					</div>
				</div>

				{/* ── Automatická odpověď / OOO (prototyp ř. 1729–1743) ── */}
				<div style={cardStyle}>
					<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px" }}>
						<div style={{ flex: 1 }}>
							<div
								style={{
									fontFamily: "var(--w-font-display)",
									fontWeight: 700,
									fontSize: 13,
									color: "var(--ink)",
								}}
							>
								Automatická odpověď
							</div>
							<div
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 10.5,
									color: "var(--ink-3)",
									marginTop: 1,
								}}
							>
								mimo kancelář — každému odesílateli max 1× za 4 dny, newslettery se přeskakují
							</div>
						</div>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							data-statepill
							data-on={nast.ooo || undefined}
							onClick={() => setNast({ ooo: !nast.ooo })}
							style={pillStyle}
						>
							{nast.ooo ? "zapnutá" : "vypnutá"}
						</span>
					</div>
					{nast.ooo && (
						<div style={{ padding: "0 18px 13px" }}>
							<textarea
								value={nast.oooTxt}
								onChange={(e) => setNast({ oooTxt: e.target.value })}
								rows={3}
								style={{
									width: "100%",
									border: "1px solid var(--line)",
									background: "var(--panel-2)",
									borderRadius: 10,
									padding: "9px 11px",
									fontFamily: "var(--w-font-body)",
									fontSize: 12.5,
									color: "var(--ink)",
									lineHeight: 1.55,
									outline: "none",
									resize: "none",
									boxSizing: "border-box",
								}}
							/>
							<div
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 10.5,
									color: "var(--ink-3)",
									marginTop: 6,
								}}
							>
								Platí pro tvoje osobní odpovědi — týmové schránky mají vlastní automatiku v
								Administraci.
							</div>
						</div>
					)}
				</div>

				{/* ── Osobní schránky: skutečný serverový account manager M1 ── */}
				<div style={cardStyle}>
					<div style={headStyle}>Osobní e-mailové účty</div>
					<div
						style={{
							display: "flex",
							alignItems: "flex-start",
							gap: 10,
							padding: "12px 18px",
							flexWrap: "wrap",
						}}
					>
						<div style={{ flex: "1 1 260px", fontFamily: "var(--w-font-body)", fontSize: 11, lineHeight: 1.5, color: "var(--ink-3)" }}>
							Google účet připojíš přes OAuth; heslo Watson nikdy nevidí a credential ukládá šifrovaně.
							Obsah zpráv a akce v Mailu zůstávají do další etapy zřetelně demo.
						</div>
						<button
							type="button"
							onClick={() => setMailboxManagerOpen(true)}
							style={{ minHeight: 44, padding: "0 14px", border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", cursor: "pointer", flex: "none", fontWeight: 700 }}
						>
							Spravovat účty
						</button>
					</div>
				</div>
			</div>
			<MailboxWizard open={mailboxManagerOpen} onClose={() => setMailboxManagerOpen(false)} />
		</div>
	);
}
