/**
 * Administrace pošty (Modul 13) — vidí jen správce týmu (prototyp šablona
 * ř. 1462–1608 + logika admV, ř. 3167–3313). Karty schránek (health, Gatekeeper
 * toggle, AI úrovně Off/Čte/Triage — granty@ zamčené natrvalo), matice přístupů
 * (osobní schránky v ní NEJSOU — audit L-48), Nepřečtené per schránka (čte a
 * zapisuje SDÍLENÝ m.mbRead/m.setMbRead — stejná data jako řádky seznamu),
 * Pravidla a Šablony. Stav mimo mbRead je demo vrstva držená lokálně
 * (useState z ADM_SEED); „+ Připojit schránku" otevírá MailboxWizard a avatary
 * v matici Přístupů kartu osoby (PersonCard) s offboardingem.
 */
import { useState } from "react";
import { showToast } from "../lib/toast";
import { ADM_SEED, type AdmSeed, MB, P, TPL } from "./data";
import { MailboxWizard } from "./MailboxWizard";
import { PersonCard } from "./PersonCard";
import { useMail } from "./state";

const ROLE = ["bez přístupu", "člen", "správce"];
const PIDS = ["ad", "ps", "tm", "mh", "fk", "js"];
/** Sloupce matice přístupů — pid + osoba ze seedu (prototyp admV.cols, ř. 3172). */
const COLS = PIDS.flatMap((pid) => {
	const p = P[pid];
	return p ? [{ pid, p }] : [];
});

/** Statická serverová pravidla (prototyp admV.rules, ř. 3215–3219). */
const RULES = [
	{ mb: "info", cond: "předmět obsahuje „faktura“", act: "vlajka P3 + přiřadit Petře" },
	{ mb: "studio", cond: "odesílatel *@gopay.cz", act: "skupina Oznámení, bez notifikace" },
	{ mb: "podcast", cond: "hlavička list-unsubscribe", act: "skupina Newslettery" },
];

/** Lokální demo vrstva = už jen gate (hluboká kopie, ať se nepropíše do seedu).
 * `fixed`, `ai` i `acc` žijí v MailProvider (audit S5) — čtou je i banner
 * v seznamu, warn tečky sidebaru a karta osoby (PersonCard); lokální cache by je
 * nechala rozejít se se seedem (audit LOW AdminScreen.tsx:597). */
type AdmLocal = Pick<AdmSeed, "gate">;
const admInit = (): AdmLocal => ({
	gate: { ...ADM_SEED.gate },
});

/** Demo mezipaměť — přepnuté toggly přežijí odchod z obrazovky v rámci session. */
const cache: {
	adm: AdmLocal;
	tplDel: Record<string, true>;
	tplAdd: { mb: string; n: string; b: string }[];
} = { adm: admInit(), tplDel: {}, tplAdd: [] };

const cardStyle = {
	background: "var(--panel)",
	border: "1px solid var(--line)",
	borderRadius: 14,
	marginTop: 16,
	overflow: "hidden",
} as const;

/** Hlavička karty s podtitulem (prototyp ř. 1514–1517). */
function CardHead({ title, sub }: { title: string; sub?: string }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "baseline",
				gap: 9,
				padding: "13px 18px 11px",
				borderBottom: "1px solid var(--line)",
			}}
		>
			<span
				style={{
					fontFamily: "var(--w-font-display)",
					fontWeight: 700,
					fontSize: 13,
					color: "var(--ink)",
				}}
			>
				{title}
			</span>
			{!!sub && (
				<span style={{ fontFamily: "var(--w-font-body)", fontSize: 11, color: "var(--ink-3)" }}>
					{sub}
				</span>
			)}
		</div>
	);
}

export function AdminScreen({ embedded = false }: { embedded?: boolean } = {}) {
	const m = useMail();
	const [adm, setAdmRaw] = useState<AdmLocal>(cache.adm);
	const [tplDel, setTplDel] = useState<Record<string, true>>(cache.tplDel);
	const [tplAdd, setTplAdd] = useState(cache.tplAdd);
	// overlaye: průvodce připojením schránky + karta osoby z matice Přístupů
	const [wizOn, setWizOn] = useState(false);
	const [person, setPerson] = useState<string | null>(null);

	const setAdm = (patch: Partial<AdmLocal>) => {
		cache.adm = { ...cache.adm, ...patch };
		setAdmRaw(cache.adm);
	};

	const setAi = (id: string, k: "off" | "read" | "triage") => {
		// sdílený stav provideru (S5) — AI badge vláken a AI× v sidebaru reagují hned
		m.setAdmAi(id, k);
		const short = MB[id]?.short ?? id;
		showToast(
			k === "off"
				? `AI pro ${short} vypnutá — žádná shrnutí ani návrhy`
				: k === "read"
					? `AI pro ${short} jen čte — shrnutí a překlady`
					: `AI pro ${short} třídí a navrhuje — odesílá vždy člověk`,
		);
	};

	/** Šablony: seed TPL minus lokálně smazané + lokálně přidané (prototyp tplRows). */
	const tplRows: { key: string; mb: string; n: string; prev: string; del: () => void }[] = [];
	for (const mbid of Object.keys(MB)) {
		(TPL[mbid] ?? []).forEach((tp, i) => {
			const key = `${mbid}:${i}`;
			if (tplDel[key]) return;
			tplRows.push({
				key,
				mb: mbid,
				n: tp.n,
				prev: tp.b.split("\n").filter(Boolean)[1] ?? tp.b,
				del: () => {
					cache.tplDel = { ...cache.tplDel, [key]: true };
					setTplDel(cache.tplDel);
					showToast("Šablona smazána — tým ji přestane nabízet hned");
				},
			});
		});
		tplAdd
			.filter((a) => a.mb === mbid)
			.forEach((a, i) => {
				tplRows.push({
					key: `${mbid}:add:${i}`,
					mb: mbid,
					n: a.n,
					prev: a.b.split("\n").filter(Boolean)[1] ?? a.b,
					del: () => {
						cache.tplAdd = cache.tplAdd.filter((z) => z !== a);
						setTplAdd(cache.tplAdd);
					},
				});
			});
	}

	const segTab = {
		fontFamily: "var(--w-font-display)",
		fontWeight: 600,
		fontSize: 10.5,
		padding: "3px 11px",
		borderRadius: 999,
		cursor: "pointer",
	} as const;

	return (
		<div
			data-screen-label={embedded ? undefined : "Administrace pošty"}
			style={embedded ? undefined : { flex: 1, overflow: "auto", background: "var(--panel-2)" }}
		>
			<div
				style={
					embedded ? undefined : { maxWidth: 960, margin: "0 auto", padding: "20px 26px 46px" }
				}
			>
				{!embedded && (
					<span
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
						Administrace pošty
					</div>
				)}
				<div
					style={{
						fontFamily: "var(--w-font-body)",
						fontSize: 12.5,
						color: "var(--ink-3)",
						marginTop: embedded ? 0 : 4,
						maxWidth: "64ch",
						lineHeight: 1.55,
					}}
				>
					Vidí jen správce týmu. Osobní schránky sem nepatří — připojuje si je každý sám v Nastavení
					a jsou šifrované.
				</div>

				{/* ── Připojené schránky (prototyp ř. 1470–1509) ── */}
				<div style={{ ...cardStyle, marginTop: 18 }}>
					<div
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 700,
							fontSize: 13,
							color: "var(--ink)",
							padding: "13px 18px 11px",
							borderBottom: "1px solid var(--line)",
						}}
					>
						Připojené schránky
					</div>
					{Object.entries(MB).map(([id, mb]) => {
						// fixed/ai z provideru (S5) — stejná data čte syncWarn banner v seznamu
						const warnOn = !!mb.warn && !m.adm.fixed;
						const lock = id === "granty";
						const lvl = m.adm.ai[id];
						return (
							<div
								key={id}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 12,
									padding: "12px 18px",
									borderBottom: "1px solid var(--line)",
									flexWrap: "wrap",
								}}
							>
								<span
									data-mbdot={id}
									style={{ width: 10, height: 10, borderRadius: "50%", flex: "none" }}
								/>
								<div style={{ width: 230, flex: "none" }}>
									<div
										style={{
											fontFamily: "var(--w-font-display)",
											fontWeight: 600,
											fontSize: 13,
											color: "var(--ink)",
										}}
									>
										{mb.addr}
									</div>
									<div
										style={{
											fontFamily: "var(--w-font-body)",
											fontSize: 11,
											color: "var(--ink-3)",
											marginTop: 1,
										}}
									>
										tým {mb.team} · {mb.people.length} lidé
									</div>
								</div>
								{!warnOn && (
									<span
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: 6,
											fontFamily: "var(--w-font-mono)",
											fontSize: 10,
											color: "var(--success-ink)",
											flex: "none",
										}}
									>
										<span
											style={{
												width: 7,
												height: 7,
												borderRadius: "50%",
												background: "var(--success)",
											}}
										/>
										připojeno
									</span>
								)}
								{warnOn && (
									<>
										<span
											style={{
												display: "inline-flex",
												alignItems: "center",
												gap: 6,
												fontFamily: "var(--w-font-mono)",
												fontSize: 10,
												color: "var(--p2-text)",
												flex: "none",
											}}
										>
											<span
												style={{
													width: 7,
													height: 7,
													borderRadius: "50%",
													background: "var(--p2)",
												}}
											/>
											token vyprší za 12 dní
										</span>
										<span
											data-ghost
											onClick={() => {
												// do provideru (S5) — jinak banner v seznamu nezhasne
												m.setAdmFixed(true);
												showToast("Připojení obnoveno — token platí dalších 90 dní");
											}}
											style={{ fontSize: 11, padding: "5px 11px", flex: "none" }}
										>
											Obnovit připojení
										</span>
									</>
								)}
								<span style={{ flex: 1 }} />
								<span
									title="Gatekeeper — nové odesílatele schvaluje člověk"
									style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: "none" }}
								>
									<span
										style={{
											fontFamily: "var(--w-font-body)",
											fontSize: 11,
											color: "var(--ink-3)",
										}}
									>
										Gatekeeper
									</span>
									<span
										data-statepill
										data-on={adm.gate[id] || undefined}
										onClick={() => setAdm({ gate: { ...adm.gate, [id]: !adm.gate[id] } })}
										style={{
											fontFamily: "var(--w-font-display)",
											fontWeight: 600,
											fontSize: 10.5,
											padding: "3px 10px",
											borderRadius: 999,
										}}
									>
										{adm.gate[id] ? "zapnutý" : "vypnutý"}
									</span>
								</span>
								<span
									style={{ display: "inline-flex", alignItems: "center", gap: 7, flex: "none" }}
								>
									<span
										style={{
											fontFamily: "var(--w-font-body)",
											fontSize: 11,
											color: "var(--ink-3)",
										}}
									>
										AI
									</span>
									{lock ? (
										<span
											onClick={() =>
												showToast(
													"granty@ pracuje s osobními údaji žadatelů — AI je vypnutá napevno, rozhodnutí týmu",
												)
											}
											title="Vypnuto kvůli osobním údajům žadatelů — rozhodnutí týmu"
											style={{
												display: "inline-flex",
												alignItems: "center",
												gap: 5,
												fontFamily: "var(--w-font-mono)",
												fontSize: 10,
												color: "var(--ink-3)",
												border: "1px dashed var(--line)",
												borderRadius: 999,
												padding: "4px 11px",
												cursor: "pointer",
											}}
										>
											<svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
												<rect
													x="2.2"
													y="5"
													width="7.6"
													height="5.2"
													rx="1.2"
													stroke="currentColor"
													strokeWidth="1.2"
												/>
												<path
													d="M4 5 V3.8 A2 2 0 0 1 8 3.8 V5"
													stroke="currentColor"
													strokeWidth="1.2"
												/>
											</svg>
											vypnuto natrvalo
										</span>
									) : (
										<span
											style={{
												display: "inline-flex",
												background: "var(--panel-2)",
												border: "1px solid var(--line)",
												borderRadius: 999,
												padding: 2,
											}}
										>
											<span
												onClick={() => setAi(id, "off")}
												data-tab
												data-active={lvl === "off" || undefined}
												style={segTab}
											>
												Off
											</span>
											<span
												onClick={() => setAi(id, "read")}
												data-tab
												data-active={lvl === "read" || undefined}
												style={segTab}
											>
												Čte
											</span>
											<span
												onClick={() => setAi(id, "triage")}
												data-tab
												data-active={lvl === "triage" || undefined}
												style={segTab}
											>
												Triage
											</span>
										</span>
									)}
								</span>
							</div>
						);
					})}
					<div
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
							data-ghost
							onClick={() => setWizOn(true)}
							style={{ fontSize: 11.5, padding: "6px 12px", flex: "none" }}
						>
							+ Připojit schránku
						</span>
						<span
							style={{ fontFamily: "var(--w-font-body)", fontSize: 10.5, color: "var(--ink-3)" }}
						>
							Gmail / M365 přes OAuth, nebo IMAP+SMTP kdekoli — jen super-admin, přihlášení míří do
							šifrovaného vaultu
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
						AI úrovně: Off — nic · Čte — shrnutí a překlady · Triage — třídí, navrhuje směrování a
						drafty. Odesílá vždy člověk — návrhy ke schválení čekají přímo v Inboxu.
					</div>
				</div>

				{/* ── Přístupy — matice (prototyp ř. 1513–1547); jen týmové schránky (L-48) ── */}
				<div style={cardStyle}>
					<CardHead title="Přístupy" sub="kdo kterou schránku vidí — klik mění roli" />
					<div style={{ overflowX: "auto", padding: "8px 14px 4px" }}>
						<div style={{ minWidth: 700 }}>
							<div style={{ display: "flex", alignItems: "flex-end" }}>
								<span style={{ width: 150, flex: "none" }} />
								{COLS.map(({ pid, p }) => (
									<div
										key={pid}
										data-pcol
										onClick={() => setPerson(pid)}
										title="Otevřít kartu osoby"
										style={{
											width: 76,
											flex: "none",
											textAlign: "center",
											padding: "6px 0 7px",
											cursor: "pointer",
											borderRadius: 9,
										}}
									>
										<span
											data-av={p.av || undefined}
											style={{
												width: 26,
												height: 26,
												borderRadius: "50%",
												background: "var(--avatar-navy)",
												color: "#fff",
												fontFamily: "var(--w-font-display)",
												fontWeight: 700,
												fontSize: 9,
												display: "inline-flex",
												alignItems: "center",
												justifyContent: "center",
											}}
										>
											{p.ini}
										</span>
										<div
											style={{
												fontFamily: "var(--w-font-mono)",
												fontSize: 9,
												color: "var(--ink-3)",
												marginTop: 3,
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}
										>
											{p.n.split(" ")[0]}
										</div>
									</div>
								))}
								<div
									data-pcol
									onClick={() => showToast("Host poštu nemá vůbec — nemá ani kartu přístupů")}
									style={{
										width: 76,
										flex: "none",
										textAlign: "center",
										padding: "6px 0 7px",
										cursor: "pointer",
										borderRadius: 9,
									}}
								>
									<span
										data-av="ext"
										style={{
											width: 26,
											height: 26,
											borderRadius: "50%",
											color: "#fff",
											fontFamily: "var(--w-font-display)",
											fontWeight: 700,
											fontSize: 9,
											display: "inline-flex",
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										H
									</span>
									<div
										style={{
											fontFamily: "var(--w-font-mono)",
											fontSize: 9,
											color: "var(--ink-3)",
											marginTop: 3,
										}}
									>
										Host
									</div>
								</div>
							</div>
							{Object.entries(MB).map(([mbid, mb]) => (
								<div
									key={mbid}
									style={{
										display: "flex",
										alignItems: "center",
										borderTop: "1px solid var(--line)",
									}}
								>
									<span
										style={{
											width: 150,
											flex: "none",
											display: "inline-flex",
											alignItems: "center",
											gap: 8,
											fontFamily: "var(--w-font-mono)",
											fontSize: 11,
											color: "var(--ink-2)",
										}}
									>
										<span data-mbdot={mbid} style={{ width: 8, height: 8, borderRadius: "50%" }} />
										{mb.short}
									</span>
									{COLS.map(({ pid, p }) => {
										// acc z provideru (S5) — matice i karta osoby čtou tentýž živý stav
										const v = m.adm.acc[mbid]?.[pid] ?? 0;
										return (
											<span
												key={pid}
												data-accell
												data-v={String(v)}
												data-lock="false"
												onClick={() => {
													const nv = (v + 1) % 3;
													m.setAdmAcc(mbid, pid, nv);
													showToast(
														`${p.n} — ${ROLE[nv]} pro ${mb.short}${nv === 0 ? ". Schránka z jeho UI zmizí („co nevidíš, neexistuje“)" : ""}`,
													);
												}}
											>
												{v === 2 ? "S" : v === 1 ? "✓" : "—"}
											</span>
										);
									})}
									<span
										data-accell
										data-v="0"
										data-lock="true"
										onClick={() => showToast("Host do mailu nemůže — role Host poštu nevidí vůbec")}
									>
										—
									</span>
								</div>
							))}
						</div>
					</div>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 14,
							flexWrap: "wrap",
							fontFamily: "var(--w-font-mono)",
							fontSize: 10,
							color: "var(--ink-3)",
							padding: "9px 18px 11px",
						}}
					>
						<span>
							<span style={{ color: "var(--brass-text)", fontWeight: 700 }}>S</span> správce
						</span>
						<span>
							<span style={{ color: "var(--ink-2)", fontWeight: 700 }}>✓</span> člen
						</span>
						<span>— bez přístupu</span>
						<span style={{ flex: 1 }} />
						<span>Host poštu nevidí vůbec</span>
					</div>
					<div
						style={{
							fontFamily: "var(--w-font-body)",
							fontSize: 10.5,
							color: "var(--ink-3)",
							padding: "0 18px 13px",
						}}
					>
						Co nevidíš, v UI neexistuje — člen bez přístupu schránku nenajde v seznamu, hledání ani
						v Ask. Když někomu grant vyprší, jeho přiřazená vlákna se vrací do Nepřiřazených
						(událost v Dění) — nic neosiří.
					</div>
				</div>

				{/* ── Nepřečtené per schránka (prototyp ř. 1549–1566) — SDÍLENÝ stav m.mbRead ── */}
				<div style={cardStyle}>
					<CardHead
						title="Nepřečtené"
						sub="per schránka — komu se konverzace označí jako přečtená po otevření"
					/>
					{Object.entries(MB).map(([id, mb]) => {
						const mode = m.mbRead[id] ?? (m.perOsoba ? "per" : "shared");
						return (
							<div
								key={id}
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
									data-mbdot={id}
									style={{ width: 8, height: 8, borderRadius: "50%", flex: "none" }}
								/>
								<span
									style={{
										width: 90,
										flex: "none",
										fontFamily: "var(--w-font-mono)",
										fontSize: 11,
										color: "var(--ink-2)",
									}}
								>
									{mb.short}
								</span>
								<span
									style={{
										flex: 1,
										minWidth: 140,
										fontFamily: "var(--w-font-body)",
										fontSize: 11,
										color: "var(--ink-3)",
									}}
								>
									{mode === "per"
										? "každý si hlídá svoje — nic nepropadne"
										: "první otevření odškrtne všem"}
								</span>
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
									<span
										onClick={() => m.setMbRead(id, "per")}
										data-tab
										data-active={mode === "per" || undefined}
										style={segTab}
									>
										Per osoba
									</span>
									<span
										onClick={() => m.setMbRead(id, "shared")}
										data-tab
										data-active={mode === "shared" || undefined}
										style={segTab}
									>
										Sdílené
									</span>
								</span>
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
						Per osoba: konverzace zůstává nepřečtená pro každého člena, dokud ji sám neotevře.
						Sdílené: první otevření kýmkoli ji označí všem — hodí se spíš pro oznámení a
						newslettery. Výchozí režim se řídí osobním nastavením v Nastavení pošty.
					</div>
				</div>

				{/* ── Pravidla (prototyp ř. 1568–1584) ── */}
				<div style={cardStyle}>
					<CardHead
						title="Pravidla"
						sub="automatické třídění — běží na serveru, platí pro celý tým"
					/>
					{RULES.map((r) => (
						<div
							key={r.cond}
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
								data-mbdot={r.mb}
								style={{ width: 9, height: 9, borderRadius: "50%", flex: "none" }}
							/>
							<span
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 12,
									color: "var(--ink-2)",
									flex: 1,
									minWidth: 220,
								}}
							>
								Když <span style={{ fontWeight: 600, color: "var(--ink)" }}>{r.cond}</span> →{" "}
								{r.act}
							</span>
							<span
								data-statepill
								data-on
								style={{
									fontFamily: "var(--w-font-display)",
									fontWeight: 600,
									fontSize: 10,
									padding: "2px 9px",
									borderRadius: 999,
									flex: "none",
								}}
							>
								aktivní
							</span>
						</div>
					))}
					<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px" }}>
						<span
							data-ghost
							onClick={() =>
								showToast(
									"Nové pravidlo: podmínka + akce. Spustí se i zpětně na existující poštu — jako filtry v Gmailu",
								)
							}
							style={{ fontSize: 11.5, padding: "6px 12px" }}
						>
							+ Přidat pravidlo
						</span>
						<span
							style={{ fontFamily: "var(--w-font-body)", fontSize: 10.5, color: "var(--ink-3)" }}
						>
							podmínka (odesílatel, předmět, doména) + akce (skupina, vlajka, přiřazení) — spustí se
							i zpětně
						</span>
					</div>
				</div>

				{/* ── Šablony (prototyp ř. 1586–1604) ── */}
				<div style={cardStyle}>
					<CardHead title="Šablony" sub="sdílené odpovědi per schránka — jednotný hlas firmy" />
					{tplRows.map((r) => (
						<div
							key={r.key}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 10,
								padding: "9px 18px",
								borderBottom: "1px solid var(--line)",
							}}
						>
							<span
								data-mbdot={r.mb}
								style={{ width: 9, height: 9, borderRadius: "50%", flex: "none" }}
							/>
							<span
								title="Týmová šablona — úprava a smazání platí pro celý tým; spravuje správce schránky"
								style={{
									width: 170,
									flex: "none",
									fontFamily: "var(--w-font-display)",
									fontWeight: 600,
									fontSize: 12,
									color: "var(--ink)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{r.n}
							</span>
							<span
								style={{
									flex: 1,
									fontFamily: "var(--w-font-body)",
									fontSize: 11.5,
									color: "var(--ink-3)",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{r.prev}
							</span>
							<span
								data-ghost
								onClick={() =>
									showToast(
										`Úprava šablony „${r.n}“ — sdílená pro ${MB[r.mb]?.short ?? r.mb}, změna platí celému týmu`,
									)
								}
								style={{ fontSize: 10.5, padding: "4px 10px", flex: "none" }}
							>
								Upravit
							</span>
							<span
								data-ghost
								onClick={r.del}
								style={{
									fontSize: 10.5,
									padding: "4px 10px",
									color: "var(--overdue)",
									flex: "none",
								}}
							>
								Smazat
							</span>
						</div>
					))}
					<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px" }}>
						<span
							data-ghost
							onClick={() => {
								cache.tplAdd = [
									...cache.tplAdd,
									{
										mb: "info",
										n: "Poděkování za zprávu",
										b: "Dobrý den,\n\nděkujeme za zprávu i váš zájem — ozveme se co nejdřív.\n\nS pozdravem\nT-Group Studio",
									},
								];
								setTplAdd(cache.tplAdd);
								showToast(
									"Šablona přidána pro info@ — v reálu s editorem názvu, textu a kategorie",
								);
							}}
							style={{ fontSize: 11.5, padding: "6px 12px" }}
						>
							+ Přidat šablonu
						</span>
						<span
							style={{ fontFamily: "var(--w-font-body)", fontSize: 10.5, color: "var(--ink-3)" }}
						>
							při vložení je Watson umí přizpůsobit příjemci (+AI) — jméno, kontext, tón
						</span>
					</div>
				</div>
			</div>

			{/* overlaye: průvodce připojením schránky + karta osoby */}
			<MailboxWizard open={wizOn} onClose={() => setWizOn(false)} />
			<PersonCard pid={person} onClose={() => setPerson(null)} />
		</div>
	);
}
