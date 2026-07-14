/**
 * Dění — jedna časová osa celého Watsonu, mail je jen jeden ze zdrojů
 * (prototyp šablona ř. 1381–1447 + logika deniData/nadchBuild/deniBuild/deniM,
 * ř. 2989–3079). Jen ke čtení; klik vede na místo činu (vlákno / Gatekeeper /
 * produktivní část přes bridge.onNav). Sekce Nadcházející = informativní karty
 * (naplánovaná odeslání, návraty ze Snooze, SLA) — NEJSOU úkoly, neodklikávají
 * se. Události mimo statický seed se odvozují DETERMINISTICKY ze stavu modulu
 * (ov = přiřazení/stavy/vlajky, gkDone = verdikty Gatekeeperu) — žádná náhoda.
 */
import { useState } from "react";
import { showToast } from "../lib/toast";
import { GK, P, SLA, STL } from "./data";
import { useMail } from "./state";

/** Jedna událost osy (prototyp deniData, ř. 2990–3003). */
interface DeniEvent {
	d: "dnes" | "driv";
	t: string;
	p?: string; // pid autora; bez p + sys=true → Watson
	sys?: boolean;
	gate?: boolean; // klik vede do fronty Gatekeeperu
	work?: string; // 'úkol' | 'projekt' | 'kalendář' | 'zápis' — mimo poštu
	txt: string;
	th?: string | null;
	subj?: string;
	mb?: string;
}

/** Karta Nadcházející (prototyp nadchBuild items, ř. 3006–3012). */
interface NadchItem {
	t: string;
	txt: string;
	k?: "send"; // naplánované odeslání — jediné, co jde zrušit
	hint?: string;
	th?: string;
	mb?: string;
	work?: string;
	subj?: string;
}

/** Statický seed osy — VERBATIM prototyp deniData (ř. 2991–3003), bez řádku
 * Gatekeeperu (ten se odvozuje živě z gkLeft níže). */
const DENI_SEED: DeniEvent[] = [
	{ d: "dnes", t: "9:20", p: "ps", txt: "tě zmínila v interní diskusi", th: "faktura" },
	{ d: "dnes", t: "9:12", sys: true, txt: "připravil návrh odpovědi — čeká na schválení člověkem", th: "faktura" },
	{ d: "dnes", t: "9:05", p: "tm", work: "úkol", txt: "dokončila úkol „Rozpočet po jednotkových cenách — OP JAK“", subj: "Granty · úkoly" },
	{ d: "dnes", t: "8:52", p: "ad", txt: "převzal vlákno", th: "faktura" },
	{ d: "dnes", t: "8:47", p: "mh", txt: "nastavila vlajku P1 — SLA běží do 17:00", th: "opjak" },
	{ d: "dnes", t: "8:15", p: "ps", work: "kalendář", txt: "přesunula zkoušku velkého sálu na 18:00", subj: "Studio Dornych · kalendář" },
	{ d: "driv", t: "út 16:40", p: "ad", txt: "odeslal odpověď za granty@ a přepnul stav na Odesláno", th: "smlouva" }, // demo-seed

	{ d: "driv", t: "út 11:10", p: "fk", work: "projekt", txt: "posunul projekt „Epizoda #42“ do fáze Natáčení", subj: "Podcast · projekty" },
	{ d: "driv", t: "po 16:30", p: "js", txt: "přepnul na Čeká a nastavil follow-up na čt 10. 7.", th: "reklamace" },
	{ d: "driv", t: "pá 14:05", sys: true, txt: "navrhl předat Filipovi (oblast podcast) — čeká na potvrzení", th: "host42" },
];

/** Statický seed Nadcházejících (prototyp ř. 3006–3012). */
const NADCH_SEED: NadchItem[] = [
	{ t: "dnes 17:00", txt: "SLA P1 běží: „Výzva OP JAK — doplnění žádosti“ — odpovědět do konce dne", th: "opjak" },
	{ t: "dnes 18:00", k: "send", txt: "Naplánované odeslání za studio@: „Rozpis záloh na srpen“", mb: "studio", hint: "v 17:02 přišla do vlákna nová zpráva — zkontroluj, jestli odpověď pořád platí" },
	{ t: "zítra 8:00", txt: "Vrátí se ze Snooze: „Stížnost na hluk 28. 6.“", th: "hluk" },
	{ t: "čt 10. 7.", txt: "Follow-up: „Reklamace objednávky #2417“ — zatím bez odpovědi", th: "reklamace" },
	{ t: "pá 11. 7.", work: "úkol", txt: "Termín úkolu: „Zaplatit nájem — červenec“", subj: "Provoz · úkoly" },
];

/** Verdikty Gatekeeperu → text události v ose (odvozeno z gkDecide labelů). */
const GK_VERDIKT: Record<string, string> = {
	accept: "povolil odesílatele",
	acceptDone: "povolil a rovnou vyřídil odesílatele",
	block: "zablokoval odesílatele",
	blockDom: "zablokoval celou doménu odesílatele",
};

/** Filtrační chipy (prototyp deniM.chips, ř. 3058). */
const CHIPS: [string, string][] = [
	["vse", "Vše"],
	["posta", "Pošta"],
	["úkol", "Úkoly"],
	["projekt", "Projekty"],
	["kalendář", "Kalendář"],
];

/** České skloňování počtu odesílatelů ve frontě. */
const gkPlural = (n: number) =>
	n === 1
		? "1 nového odesílatele"
		: n < 5
			? `${n} nové odesílatele`
			: `${n} nových odesílatelů`;

/** Demo mezipaměť — ruční zápisy a zrušená odeslání přežijí odchod z obrazovky
 * (prototyp je drží v globálním state; state API modulu nerozšiřujeme). */
const cache: {
	src: string;
	live: DeniEvent[];
	gone: Record<string, true>;
} = { src: "vse", live: [], gone: {} };

export function DeniScreen() {
	const m = useMail();
	const [src, setSrcRaw] = useState(cache.src);
	const [live, setLive] = useState<DeniEvent[]>(cache.live);
	const [gone, setGone] = useState<Record<string, true>>(cache.gone);
	const [inVal, setInVal] = useState("");

	const setSrc = (v: string) => {
		cache.src = v;
		setSrcRaw(v);
	};

	/* ── živé události odvozené ze stavu (deterministicky) ── */
	const derived: DeniEvent[] = [];
	// verdikty Gatekeeperu (gkDone) — v pořadí seedu GK
	for (const g of GK) {
		const v = m.gkDone[g.id];
		if (!v) continue;
		derived.push({
			d: "dnes",
			t: "teď",
			p: "ad",
			txt: `${GK_VERDIKT[v]} ${g.name} (${g.addr})`,
			gate: true,
			th: null,
			mb: g.mb,
		});
	}
	// overrides ov — přiřazení / stavy / vlajky (v pořadí seedu TH)
	for (const t of m.threads) {
		if (t.personal) continue; // osobní sféra do týmové osy nepatří
		const o = m.ovOf(t.id);
		if (o.owner !== undefined && o.owner !== (t.owner ?? null)) {
			derived.push({
				d: "dnes",
				t: "teď",
				p: "ad",
				txt: o.owner
					? o.owner === "ad"
						? "převzal vlákno"
						: `předal vlákno — vyřizuje ${P[o.owner]?.n ?? o.owner}`
					: "zrušil přiřazení vlákna",
				th: t.id,
			});
		}
		if (o.st && o.st !== t.st) {
			derived.push({
				d: "dnes",
				t: "teď",
				p: "ad",
				txt:
					o.st === "hotovo"
						? "uzavřel vlákno jako Hotovo"
						: `přepnul stav na ${STL[o.st] ?? o.st}`,
				th: t.id,
			});
		}
		const seedFlag = t.flag === "prop" ? "p2" : (t.flag ?? "none");
		const sl = o.flag ? SLA[o.flag] : undefined;
		if (o.flag && o.flag !== seedFlag && sl) {
			derived.push({
				d: "dnes",
				t: "teď",
				p: "ad",
				txt: `nastavil vlajku ${sl.chip} — ${sl.sla}`,
				th: t.id,
			});
		}
	}
	// fronta Gatekeeperu — počet živě z gkLeft (prototyp měl staticky 3)
	if (m.gkLeft > 0) {
		derived.push({
			d: "dnes",
			t: "7:30",
			sys: true,
			gate: true,
			txt: `hlásí ${gkPlural(m.gkLeft)} ve frontě Gatekeeperu`,
			th: null,
		});
	}

	const match = (ev: { work?: string }) =>
		src === "vse" ? true : src === "posta" ? !ev.work : ev.work === src;

	/* ── Nadcházející (prototyp nadchBuild, ř. 3005–3026) ── */
	const nadch = NADCH_SEED.filter(match)
		.filter((it) => !gone[it.txt])
		.filter((it) => {
			// deterministický úklid: uzavřené vlákno už nemá SLA/follow-up,
			// návrat ze Snooze jen dokud vlákno odložené je
			if (!it.th) return true;
			const t = m.threads.find((x) => x.id === it.th);
			if (!t) return true;
			const e = m.eff(t);
			if (e.closed) return false;
			if (it.txt.startsWith("Vrátí se ze Snooze")) return !!e.snoozed;
			return true;
		});

	/* ── Stalo se (prototyp deniBuild, ř. 3027–3054) ── */
	const events = [...live, ...derived, ...DENI_SEED].filter(match);

	const openEvent = (ev: DeniEvent) => {
		if (ev.work) {
			// událost z produktivní části Watsonu — kontrakt on-nav (bridge)
			if (m.bridge.onNav) m.bridge.onNav("dnes");
			else
				showToast(
					"Událost z produktivní části Watsonu — úkoly a projekty žijí mimo mailový modul",
				);
			return;
		}
		if (ev.gate) {
			m.setFolder("gatekeeper"); // setFolder vrací scr na "mail"
			return;
		}
		if (ev.th) {
			m.setScr("mail");
			m.openThread(ev.th);
		}
	};

	const addMan = () => {
		const v = inVal.trim();
		if (!v) return;
		const ev: DeniEvent = {
			d: "dnes",
			t: "teď",
			p: "ad",
			work: "zápis",
			txt: v,
			subj: "ruční zápis",
		};
		cache.live = [ev, ...cache.live];
		setLive(cache.live);
		setInVal("");
		showToast("Zapsáno do Dění — ruční příspěvky vidí tým jako ostatní události");
	};

	/** Jeden řádek osy / karty Nadcházející — meta řádek pod textem.
	 * Gatekeeper fallback předmětu má jen časová osa (prototyp deniBuild vs nadchBuild). */
	const metaRow = (
		ev: { work?: string; th?: string | null; mb?: string; subj?: string },
		gateFallback = false,
	) => {
		const t = ev.th ? m.threads.find((x) => x.id === ev.th) : null;
		const mb = t ? (t.personal ? "osobni" : t.mb) : (ev.mb ?? "info");
		const subj = ev.work
			? (ev.subj ?? "")
			: (t?.subj ?? (gateFallback ? "Gatekeeper — fronta nových odesílatelů" : ""));
		return (
			<div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3 }}>
				{!ev.work && (
					<span
						data-mbdot={mb}
						style={{ width: 7, height: 7, borderRadius: "50%", flex: "none" }}
					/>
				)}
				{!!ev.work && (
					<span
						style={{
							fontFamily: "var(--w-font-mono)",
							fontSize: 9,
							color: "var(--ink-3)",
							border: "1px solid var(--line)",
							borderRadius: 4,
							padding: "0 5px",
							flex: "none",
						}}
					>
						{ev.work}
					</span>
				)}
				<span
					style={{
						fontFamily: "var(--w-font-mono)",
						fontSize: 10,
						color: "var(--ink-3)",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{subj}
				</span>
			</div>
		);
	};

	let lastDay: string | null = null;

	return (
		<div
			data-screen-label="Dění — celý Watson"
			style={{ flex: 1, overflow: "auto", background: "var(--panel-2)" }}
		>
			<div style={{ maxWidth: 780, margin: "0 auto", padding: "22px 26px 46px" }}>
				<div style={{ fontFamily: "var(--w-font-display)", fontWeight: 800, fontSize: 20, color: "var(--ink)" }}>
					Dění
				</div>
				<div
					style={{
						fontFamily: "var(--w-font-body)",
						fontSize: 12.5,
						color: "var(--ink-3)",
						marginTop: 4,
						lineHeight: 1.55,
						maxWidth: "62ch",
					}}
				>
					Jedna časová osa celého Watsonu — úkoly, projekty, kalendář i pošta do ní
					přispívají. Jen ke čtení; klik tě vezme na místo činu. Vidíš jen to, kam máš
					přístup.
				</div>

				{/* filtrační chipy (prototyp ř. 1387–1391) */}
				<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
					{CHIPS.map(([id, label]) => (
						<span
							key={id}
							data-statepill
							data-on={src === id || undefined}
							onClick={() => setSrc(id)}
							style={{
								fontFamily: "var(--w-font-display)",
								fontWeight: 600,
								fontSize: 11,
								padding: "4px 13px",
								borderRadius: 999,
							}}
						>
							{label}
						</span>
					))}
				</div>

				{/* Nadcházející (prototyp ř. 1393–1416) — informativní, nejsou to úkoly */}
				{nadch.length > 0 && (
					<div
						style={{
							background: "var(--panel)",
							border: "1px dashed var(--line)",
							borderRadius: 14,
							marginTop: 14,
							overflow: "hidden",
						}}
					>
						<div style={{ display: "flex", alignItems: "baseline", gap: 9, padding: "12px 18px 9px" }}>
							<span style={{ fontFamily: "var(--w-font-display)", fontWeight: 700, fontSize: 12.5, color: "var(--ink)" }}>
								Nadcházející
							</span>
							<span style={{ fontFamily: "var(--w-font-body)", fontSize: 11, color: "var(--ink-3)" }}>
								co se stane — informativní, po události zmizí samo
							</span>
						</div>
						{nadch.map((u) => (
							<div
								key={u.txt}
								onClick={() => {
									if (u.th) {
										const id = u.th;
										m.setScr("mail");
										m.openThread(id);
									} else {
										showToast(
											"Informativní karta — po události sama zmizí. Není to úkol, nejde odkliknout",
										);
									}
								}}
								data-drow
								style={{
									display: "flex",
									gap: 10,
									padding: "9px 18px",
									borderTop: "1px solid var(--line)",
									cursor: "pointer",
									alignItems: "flex-start",
								}}
							>
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" style={{ color: "var(--ink-3)", flex: "none", marginTop: 2 }} aria-hidden>
									<circle cx="12" cy="12" r="8" />
									<path d="M12 7.5 V12 L15.2 14.4" />
								</svg>
								<div style={{ flex: 1, minWidth: 0 }}>
									<div style={{ fontFamily: "var(--w-font-body)", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
										{u.txt}
									</div>
									{!!u.hint && (
										<div style={{ fontFamily: "var(--w-font-body)", fontSize: 10.5, color: "var(--brass-text)", marginTop: 2 }}>
											⚠ {u.hint}
										</div>
									)}
									{metaRow(u)}
								</div>
								{u.k === "send" && (
									<span
										data-ghost
										onClick={(e) => {
											e.stopPropagation();
											cache.gone = { ...cache.gone, [u.txt]: true };
											setGone(cache.gone);
											showToast("Naplánované odeslání zrušeno (simulace) — koncept zůstává u vlákna");
										}}
										style={{ fontSize: 10, padding: "3px 9px", flex: "none" }}
									>
										Zrušit
									</span>
								)}
								<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10, color: "var(--brass-text)", flex: "none" }}>
									{u.t}
								</span>
							</div>
						))}
					</div>
				)}

				{/* ruční zápis (prototyp ř. 1418–1421) */}
				<div style={{ display: "flex", gap: 8, marginTop: 14 }}>
					<input
						value={inVal}
						onChange={(e) => setInVal(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") addMan();
						}}
						placeholder="Přidat vlastní zápis… („objednal jsem servis kávovaru — hotovo“)"
						style={{
							flex: 1,
							minWidth: 0,
							border: "1px solid var(--line)",
							background: "var(--panel)",
							borderRadius: 10,
							padding: "8px 12px",
							fontFamily: "var(--w-font-body)",
							fontSize: 12.5,
							color: "var(--ink)",
							outline: "none",
						}}
					/>
					<span data-primary onClick={addMan} style={{ fontSize: 11.5, padding: "8px 15px", flex: "none" }}>
						Zapsat
					</span>
				</div>

				{/* časová osa (prototyp ř. 1423–1443) */}
				<div
					style={{
						background: "var(--panel)",
						border: "1px solid var(--line)",
						borderRadius: 14,
						marginTop: 14,
						overflow: "hidden",
					}}
				>
					{events.map((ev, i) => {
						const head =
							ev.d !== lastDay ? (
								<div
									style={{
										padding: "12px 18px 4px",
										fontFamily: "var(--w-font-display)",
										fontWeight: 700,
										fontSize: 9.5,
										letterSpacing: ".07em",
										textTransform: "uppercase",
										color: "var(--ink-3)",
									}}
								>
									{ev.d === "dnes" ? "Dnes" : "Dříve"}
								</div>
							) : null;
						lastDay = ev.d;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: statická osa, pořadí je deterministické
							<div key={i}>
								{head}
								<div
									onClick={() => openEvent(ev)}
									data-drow
									style={{
										display: "flex",
										gap: 10,
										padding: "11px 18px",
										borderBottom: "1px solid var(--line)",
										cursor: "pointer",
										alignItems: "flex-start",
									}}
								>
									{ev.p ? (
										<span
											data-av={P[ev.p]?.av || undefined}
											style={{
												width: 24,
												height: 24,
												borderRadius: "50%",
												background: "var(--avatar-navy)",
												color: "#fff",
												fontFamily: "var(--w-font-display)",
												fontWeight: 700,
												fontSize: 9,
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												flex: "none",
												marginTop: 1,
											}}
										>
											{P[ev.p]?.ini ?? "?"}
										</span>
									) : (
										<span
											style={{
												width: 24,
												height: 24,
												borderRadius: "50%",
												border: "1.7px solid var(--brass-text)",
												color: "var(--brass-text)",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												fontSize: 9.5,
												fontWeight: 800,
												fontFamily: "var(--w-font-display)",
												flex: "none",
												marginTop: 1,
											}}
										>
											W
										</span>
									)}
									<div style={{ flex: 1, minWidth: 0 }}>
										<div style={{ fontFamily: "var(--w-font-body)", fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5 }}>
											<span style={{ fontWeight: 600, color: "var(--ink)" }}>
												{ev.p ? (P[ev.p]?.n ?? ev.p) : "Watson"}
											</span>{" "}
											{ev.txt}
										</div>
										{metaRow(ev, true)}
									</div>
									<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 9.5, color: "var(--ink-3)", flex: "none" }}>
										{ev.t}
									</span>
								</div>
							</div>
						);
					})}
					<div style={{ padding: "10px 18px", fontFamily: "var(--w-font-body)", fontSize: 10.5, color: "var(--ink-3)" }}>
						V Mailu najdeš tuhle osu předfiltrovanou na poštu (levý panel → Dění).
					</div>
				</div>
			</div>
		</div>
	);
}
