/**
 * Mail — sdílené prvky composeru:
 *  • RecipientField — našeptávač příjemce (To/Cc/Bcc) z DEMO kontaktů (P + MB)
 *    s ↑↓/Enter výběrem, chipy a markerem externí domény. Používá NewMessage
 *    i MailThread, aby se chování sjednotilo.
 *  • SigPicker/SigBlock — výběr a náhled podpisu. Model podpisů je uživatelsky
 *    definovaný (Nastavení → Podpisy, persistováno watson-mail.sigs); volba
 *    výchozího podpisu se drží per identita (id schránky / "osobni") a
 *    persistuje (watson-mail.sig). Zvolený podpis kreslí composer jako blok
 *    na konci mailu (SigBlock) — do těla se nevpisuje, při odeslání se přidá.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useContacts } from "../lib/contacts";
import { CONTACTS } from "./data";
import { useMail } from "./state";

/* ══════════════ Našeptávač příjemce ══════════════ */

/** Rozdělení hodnoty (čárkami oddělené adresy) na jednotlivé chipy. */
const toChips = (value: string): string[] =>
	value
		.split(/[,;]+/)
		.map((s) => s.trim())
		.filter(Boolean);

/** Externí = adresa mimo doménu t-group-dance.cz (audit SEC-02). */
const isExternal = (addr: string): boolean =>
	addr.includes("@") && !/@t-group-dance\.cz$/i.test(addr.trim());

/** Zobrazované jméno adresy z kontaktů (fallback = adresa samotná). */
const nameOfAddr = (addr: string): string =>
	CONTACTS.find((c) => c.addr.toLowerCase() === addr.toLowerCase())?.name ?? addr;

/**
 * Pole příjemce s reálným našeptáváním z DEMO kontaktů. Hodnota je čárkami
 * oddělený řetězec adres (drop-in za dřívější `to` input i persistenci), uvnitř
 * se kreslí jako chipy + textový buffer. Výběr: ↑↓ pohyb, Enter/čárka potvrdí,
 * Backspace na prázdném bufferu smaže poslední chip.
 */
export function RecipientField({
	value,
	onChange,
	placeholder,
	bordered = false,
	autoFocus = false,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder: string;
	/** true = orámované pole (Cc/Bcc v MailThread); false = plynulé (řádek Komu). */
	bordered?: boolean;
	autoFocus?: boolean;
}) {
	const [q, setQ] = useState("");
	const [active, setActive] = useState(0);
	const [focus, setFocus] = useState(false);
	const inRef = useRef<HTMLInputElement>(null);
	const chips = useMemo(() => toChips(value), [value]);
	// REÁLNÉ kontakty (tabulka contacts) mají přednost; demo (P + schránky MB) doplní.
	const realContacts = useContacts();
	const pool = useMemo(() => {
		const seen = new Set<string>();
		const out: { name: string; addr: string }[] = [];
		for (const c of [...realContacts, ...CONTACTS]) {
			const k = c.addr.toLowerCase();
			if (!c.addr || seen.has(k)) continue;
			seen.add(k);
			out.push({ name: c.name, addr: c.addr });
		}
		return out;
	}, [realContacts]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: autofocus jen při mountu
	useEffect(() => {
		if (autoFocus) inRef.current?.focus();
	}, []);

	// návrhy: fulltext přes jméno i adresu, bez už přidaných, max 6
	const sugg = useMemo(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return [];
		const has = new Set(chips.map((c) => c.toLowerCase()));
		return pool
			.filter(
				(c) =>
					!has.has(c.addr.toLowerCase()) &&
					(c.name.toLowerCase().includes(needle) || c.addr.toLowerCase().includes(needle)),
			)
			.slice(0, 6);
	}, [q, chips, pool]);

	const open = focus && sugg.length > 0;

	const commit = (addr: string) => {
		const a = addr.trim();
		if (!a) return;
		if (!chips.some((c) => c.toLowerCase() === a.toLowerCase())) onChange([...chips, a].join(", "));
		setQ("");
		setActive(0);
		inRef.current?.focus();
	};
	const removeChip = (i: number) => {
		onChange(chips.filter((_, idx) => idx !== i).join(", "));
		inRef.current?.focus();
	};

	const onKey = (ev: React.KeyboardEvent<HTMLInputElement>) => {
		if (open && ev.key === "ArrowDown") {
			ev.preventDefault();
			setActive((a) => Math.min(sugg.length - 1, a + 1));
		} else if (open && ev.key === "ArrowUp") {
			ev.preventDefault();
			setActive((a) => Math.max(0, a - 1));
		} else if (ev.key === "Enter" || ev.key === "," || ev.key === ";") {
			if (open || q.trim()) {
				ev.preventDefault();
				commit(open ? (sugg[active]?.addr ?? q) : q);
			}
		} else if (ev.key === "Backspace" && !q && chips.length) {
			ev.preventDefault();
			removeChip(chips.length - 1);
		}
	};

	return (
		<div
			style={{
				position: "relative",
				flex: 1,
				minWidth: bordered ? 150 : 0,
				display: "flex",
				flexWrap: "wrap",
				alignItems: "center",
				gap: 5,
				...(bordered
					? {
							border: "1px solid var(--line)",
							background: "var(--panel-2)",
							borderRadius: 9,
							padding: "5px 8px",
						}
					: null),
			}}
		>
			{chips.map((c, i) => {
				const ext = isExternal(c);
				return (
					<span
						key={c}
						title={nameOfAddr(c) === c ? c : `${nameOfAddr(c)} · ${c}`}
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
							fontFamily: "var(--w-font-mono)",
							fontSize: 10.5,
							color: ext ? "var(--p2-text)" : "var(--ink-2)",
							background: ext ? "var(--p2-soft)" : "var(--panel)",
							border: "1px solid var(--line)",
							borderRadius: 999,
							padding: "2px 7px",
							maxWidth: "100%",
						}}
					>
						<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
							{nameOfAddr(c)}
						</span>
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => removeChip(i)}
							title="Odebrat"
							style={{ cursor: "pointer", color: "var(--ink-3)", lineHeight: 1, flex: "none" }}
						>
							×
						</span>
					</span>
				);
			})}
			<input
				ref={inRef}
				value={q}
				onChange={(ev) => {
					setQ(ev.target.value);
					setActive(0);
				}}
				onKeyDown={onKey}
				onFocus={() => setFocus(true)}
				onBlur={() => {
					setFocus(false);
					// nedokončený buffer s @ ber jako ruční adresu
					if (q.trim().includes("@")) commit(q);
				}}
				placeholder={chips.length ? "" : placeholder}
				style={{
					flex: 1,
					minWidth: 90,
					border: "none",
					background: "transparent",
					outline: "none",
					fontFamily: "var(--w-font-body)",
					fontSize: bordered ? 12 : 13,
					color: "var(--ink)",
				}}
			/>
			{open && (
				<div
					style={{
						position: "absolute",
						top: "calc(100% + 4px)",
						left: 0,
						zIndex: 60,
						minWidth: 240,
						maxWidth: 340,
						background: "var(--panel)",
						border: "1px solid var(--line)",
						borderRadius: 11,
						boxShadow: "var(--shadow)",
						padding: 5,
						animation: "wPop .12s ease",
					}}
				>
					{sugg.map((c, i) => (
						<div role="region"
							key={c.addr}
							// mousedown místo click, ať blur nezavře popover dřív než výběr projde
							onMouseDown={(ev) => {
								ev.preventDefault();
								commit(c.addr);
							}}
							onMouseEnter={() => setActive(i)}
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 1,
								padding: "6px 9px",
								borderRadius: 8,
								cursor: "pointer",
								background: i === active ? "var(--panel-2)" : undefined,
							}}
						>
							<span
								style={{
									fontFamily: "var(--w-font-display)",
									fontWeight: 600,
									fontSize: 12,
									color: "var(--ink)",
								}}
							>
								{c.name}
							</span>
							<span
								style={{ fontFamily: "var(--w-font-mono)", fontSize: 10, color: "var(--ink-3)" }}
							>
								{c.addr}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/* ══════════════ Podpisy ══════════════ */

/** Id výchozího podpisu pro identitu — bez explicitní volby: osobní „krátký", týmové „plný". */
export const sigIdOf = (sigChoice: Record<string, string>, mb: string): string =>
	sigChoice[mb] ?? (mb === "osobni" ? "kratky" : "plny");

const CheckSvg = () => (
	<svg
		width="12"
		height="12"
		viewBox="0 0 14 14"
		fill="none"
		style={{ color: "var(--brass-text)", flex: "none" }}
		aria-hidden
	>
		<path
			d="M2.5 7.4 L5.5 10.4 L11.5 3.6"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

/** Blok zvoleného podpisu na konci mailu — kreslí ho composer pod editorem.
 *  `sigId` je AKTUÁLNÍ volba composeru (per-mail override, default dle schránky). */
export function SigBlock({ sigId }: { sigId: string }) {
	const m = useMail();
	const body = m.sigs.find((s) => s.id === sigId)?.body ?? [];
	if (!body.length) return null;
	return (
		<div
			style={{
				borderTop: "1px dashed var(--line)",
				marginTop: 8,
				paddingTop: 7,
				fontFamily: "var(--w-font-body)",
				fontSize: 12,
				color: "var(--ink-2)",
				lineHeight: 1.55,
			}}
		>
			{body.map((l, i) => (
				<div key={l} style={i === 0 ? { fontWeight: 600 } : undefined}>
					{l}
				</div>
			))}
		</div>
	);
}

/**
 * Tlačítko „Podpis" s popoverem výběru (vzor popoveru Šablony v NewMessage).
 * ŘÍZENÉ: `value` = aktuální volba (per-mail), `onChange` ji mění JEN pro tento
 * rozepsaný mail — výchozí per-schránka se spravuje v Nastavení, tady se
 * nepřepisuje (uživatel: „volit v composeru, default navázán na schránku").
 */
export function SigPicker({
	value,
	onChange,
}: {
	value: string;
	onChange: (id: string) => void;
}) {
	const m = useMail();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const cur = value;

	// klik mimo popover ho zavře (vzor Šablony popover)
	useEffect(() => {
		if (!open) return;
		const h = (e: globalThis.MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, [open]);

	return (
		<div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
			<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
				onClick={() => setOpen((v) => !v)}
				data-ghost
				title="Podpis na konci mailu — vyber z vytvořených podpisů"
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 5,
					fontSize: 11,
					padding: "7px 12px",
				}}
			>
				<svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
					<path
						d="M2 10.6 C3.4 7.2 4.7 4.4 5.7 4.7 C6.9 5.1 4.9 10.3 6.1 10.5 C7.1 10.7 7.4 8.4 8.3 8.5 C9.1 8.6 9 10.2 9.9 10.2 C10.6 10.2 11.2 9.6 12 9.6"
						stroke="currentColor"
						strokeWidth="1.2"
						strokeLinecap="round"
					/>
				</svg>
				Podpis
			</span>
			{open && (
				<div
					style={{
						position: "absolute",
						bottom: "calc(100% + 6px)",
						left: 0,
						zIndex: 52,
						width: 232,
						background: "var(--panel)",
						border: "1px solid var(--line)",
						borderRadius: 12,
						boxShadow: "var(--shadow)",
						padding: 5,
						animation: "wPop .14s ease",
					}}
				>
					<div
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 700,
							fontSize: 10,
							letterSpacing: ".05em",
							textTransform: "uppercase",
							color: "var(--ink-3)",
							padding: "5px 10px 6px",
						}}
					>
						Podpis
					</div>
					{m.sigs.map((s) => (
						<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							key={s.id}
							onClick={() => {
								onChange(s.id);
								setOpen(false);
							}}
							data-menuitem
						>
							<span style={{ flex: 1 }}>{s.n}</span>
							{cur === s.id && <CheckSvg />}
						</div>
					))}
					<div
						style={{
							fontFamily: "var(--w-font-body)",
							fontSize: 10,
							color: "var(--ink-3)",
							padding: "6px 10px 5px",
							borderTop: "1px solid var(--line)",
							marginTop: 4,
						}}
					>
						Podpisy spravuješ v Nastavení → Podpisy. Tady volíš jen pro tento mail
						(výchozí se řídí schránkou).
					</div>
				</div>
			)}
		</div>
	);
}
