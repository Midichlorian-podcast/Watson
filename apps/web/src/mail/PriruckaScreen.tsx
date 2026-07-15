/**
 * Příručka (prototyp ř. 1448–1461) — „Co se stane s mailem, když přistane".
 * Prototyp vkládá samostatný dokument iframem (./Prirucka.dc.html, v handoffu
 * chybí) — tady je nahrazený statickým obsahem toho, co popisuje: osa
 * Gatekeeper → třídění → urgence → per-osoba čtení → přiřazení a stavy →
 * odpověď a odeslání. Texty převzaté věrně ze šablony a seedů (SLA/STL
 * z data.ts, vysvětlivky z modulů 4/11/13 prototypu — čísla řádků u sekcí).
 */
import type { ReactNode } from "react";
import { SLA, STL } from "./data";
import { useMail } from "./state";

/** Jeden krok osy — číslovaná karta. */
function Step({
	n,
	title,
	children,
}: {
	n: number;
	title: string;
	children: ReactNode;
}) {
	return (
		<div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, padding: "14px 16px", marginTop: 12 }}>
			<span style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--brass-soft)", color: "var(--brass-text)", fontFamily: "var(--w-font-display)", fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", marginTop: 1 }}>
				{n}
			</span>
			<div style={{ flex: 1, minWidth: 0 }}>
				<div style={{ fontFamily: "var(--w-font-display)", fontWeight: 700, fontSize: 13.5, color: "var(--ink)" }}>
					{title}
				</div>
				<div style={{ fontFamily: "var(--w-font-body)", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.65, marginTop: 5 }}>
					{children}
				</div>
			</div>
		</div>
	);
}

/** Pořadí stavů vlákna pro osu (labely STL ze seedu). */
const ST_ORDER = ["novy", "otevreny", "ceka", "odeslano", "hotovo"];

export function PriruckaScreen() {
	const m = useMail();

	return (
		<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
			{/* horní lišta (prototyp ř. 1451–1455) */}
			<div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: "1px solid var(--line)", background: "var(--panel)" }}>
				<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
					data-ghost
					onClick={() => m.setScr("mail")}
					style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 11px" }}
				>
					← Mail
				</span>
				<span style={{ flex: 1 }} />
				<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10, color: "var(--ink-3)" }}>
					Příručka · Watson Mail
				</span>
			</div>

			{/* obsah — statická náhrada iframe Prirucka.dc.html (prototyp ř. 1457) */}
			<div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
				<div style={{ maxWidth: 760, margin: "0 auto", padding: "22px 22px 48px" }}>
					<div style={{ fontFamily: "var(--w-font-display)", fontWeight: 800, fontSize: 20, color: "var(--ink)" }}>
						Co se stane s mailem, když přistane
					</div>
					<div style={{ fontFamily: "var(--w-font-body)", fontSize: 12.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.55, maxWidth: "64ch" }}>
						Každá příchozí zpráva projde stejnou osou. Nic nepropadne a nikdo
						nemusí hlídat schránku ručně — pošta sama říká, co je potřeba udělat.
					</div>

					{/* 1 — Gatekeeper (texty: prototyp ř. 594 + labely gkDecide) */}
					<Step n={1} title="Gatekeeper — noví odesílatelé čekají před branou">
						Čekající zprávy nemají SLA ani nepočítají do nepřečtených — pokud něco
						vypadá urgentně, fronta zvedne upozornění. Noví odesílatelé zůstávají
						před branou, dokud je nepustíš dál. Rozhodnutí platí i pro všechny
						jejich další zprávy: <strong>Povolit</strong> (příště rovnou do Inboxu),{" "}
						<strong>Povolit a vyřídit</strong>, <strong>Blokovat</strong>, nebo{" "}
						<strong>Blokovat celou doménu</strong>. Zapíná se per schránka v
						Administraci.
					</Step>

					{/* 2 — třídění (texty: prototyp ř. 1582 pravidla, ř. 2292 no-reply, AI úrovně ř. 1605) */}
					<Step n={2} title="Třídění do skupin — Inbox · Oznámení · Newslettery">
						Do Inboxu patří jen pošta, která čeká na lidskou odpověď. Automaty
						(no-reply hlavička — nečekají na odpověď) jdou do Oznámení, hromadné
						zpravodaje do Newsletterů. Třídí serverová pravidla — podmínka
						(odesílatel, předmět, doména) + akce (skupina, vlajka, přiřazení),
						spustí se i zpětně — a AI podle úrovně per schránka: Off — nic · Čte —
						shrnutí a překlady · Triage — třídí, navrhuje směrování a drafty.
						Odesílá vždy člověk.
					</Step>

					{/* 3 — urgence (popisy SLA ze seedu + pravidlo běhu ř. 840) */}
					<Step n={3} title="Urgence P1–P4 — vlajka se SLA">
						{["p1", "p2", "p3", "p4"].map((k) => {
							const s = SLA[k];
							if (!s) return null;
							return (
								<span key={k} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 }}>
									<span data-pflag={k} style={{ cursor: "default" }}>{s.chip}</span>
									<span style={{ flex: 1 }}>
										<strong>{s.name.split("·")[1]?.trim() ?? s.name}</strong> — {s.desc}
									</span>
								</span>
							);
						})}
						<span style={{ display: "block", marginTop: 6, color: "var(--ink-3)" }}>
							SLA běží, jen když je poslední zpráva příchozí. Odpovědí se uspí,
							novou příchozí se obnoví. Hotovo = konec, urgence se už neobnoví.
						</span>
					</Step>

					{/* 4 — per-osoba čtení (text: AdminScreen „Nepřečtené", prototyp ř. 1564) */}
					<Step n={4} title="Per-osoba čtení — každý si hlídá svoje">
						Per osoba: konverzace zůstává nepřečtená pro každého člena, dokud ji
						sám neotevře — nic nepropadne jen proto, že ji kolega otevřel dřív.
						Sdílené: první otevření kýmkoli ji označí všem — hodí se spíš pro
						oznámení a newslettery. Režim se přepíná per schránka v Administraci;
						osobní schránka je vždy per-osoba a mimo týmové počty.
					</Step>

					{/* 5 — přiřazení a stavy (STL ze seedu + texty ř. 3944/3950) */}
					<Step n={5} title="Přiřazení a stavy — kdo vlastní odpověď">
						Vlákno má jednoho vlastníka odpovědi — urgence a SLA jedou za ním.
						Bez přiřazení míří P1/P2 urgence na celý dispečink. Stav vlákna:{" "}
						{ST_ORDER.map((k) => STL[k] ?? k).join(" → ")}. Hotovo je terminální —
						urgence se už neobnoví, i kdyby přišla další zpráva.
					</Step>

					{/* 6 — odpověď a odeslání (pojistky checkSend, prototyp ř. 3406–3429) */}
					<Step n={6} title="Odpověď a odeslání — pojistky před kliknutím">
						Koncepty se průběžně ukládají a přežijí i reload. Před odesláním hlídá
						Watson kolize (kolega právě dopisuje odpověď — druhé kliknutí odešle i
						tak) a sliby příloh (text slibuje přílohu, ale žádná není). Po odeslání
						běží 10 s okno „Zpět“ — vrátí koncept i stav vlákna. Odpověď odchází za
						schránku s jejím podpisem, ale s podpisem konkrétního člověka v historii.
					</Step>

					<div style={{ fontFamily: "var(--w-font-body)", fontSize: 10.5, color: "var(--ink-3)", marginTop: 16, lineHeight: 1.6 }}>
						Osu událostí kolem pošty (přiřazení, stavy, AI návrhy, Gatekeeper)
						najdeš předfiltrovanou v levém panelu → Dění. Vidíš jen schránky, kam
						máš přístup.
					</div>
				</div>
			</div>
		</div>
	);
}
