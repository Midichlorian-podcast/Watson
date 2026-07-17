import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useOverlayLayer } from "../lib/useOverlayLayer";
import type { PersonalMailModel } from "./usePersonalMail";

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ATTACHMENT_PHRASE = /\b(příloh|přiklád|v příloze|attached|attachment|enclos)/i;

function addresses(value: string) {
	return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function fieldStyle(): CSSProperties {
	return {
		width: "100%",
		minHeight: 44,
		boxSizing: "border-box",
		border: "1px solid var(--line)",
		borderRadius: 9,
		background: "var(--panel)",
		color: "var(--ink)",
		padding: "9px 11px",
		font: "inherit",
	};
}

export function PersonalMailComposer({
	model,
	onClose,
}: {
	model: PersonalMailModel;
	onClose: () => void;
}) {
	const connected = model.accounts.filter((account) => account.status === "connected");
	const [accountId, setAccountId] = useState(
		model.accountFilter !== "all" && connected.some((account) => account.id === model.accountFilter)
			? model.accountFilter
			: connected[0]?.id ?? "",
	);
	const [to, setTo] = useState("");
	const [cc, setCc] = useState("");
	const [bcc, setBcc] = useState("");
	const [subject, setSubject] = useState("");
	const [textBody, setTextBody] = useState("");
	const [sendLater, setSendLater] = useState(false);
	const [sendAt, setSendAt] = useState("");
	const [showCopies, setShowCopies] = useState(false);
	const [sendWithoutAttachment, setSendWithoutAttachment] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const toRef = useRef<HTMLInputElement>(null);
	const submission = useRef<{ fingerprint: string; id: string; operationId: string } | null>(null);
	const dialogRef = useOverlayLayer<HTMLFormElement>(true, () => {
		if (!model.sendingMail) onClose();
	});

	useEffect(() => {
		toRef.current?.focus();
	}, []);

	const mentionsAttachment = useMemo(
		() => ATTACHMENT_PHRASE.test(`${subject} ${textBody}`),
		[subject, textBody],
	);
	const minSchedule = useMemo(() => {
		const date = new Date(Date.now() + 60_000);
		date.setSeconds(0, 0);
		const offset = date.getTimezoneOffset() * 60_000;
		return new Date(date.getTime() - offset).toISOString().slice(0, 16);
	}, []);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const parsedTo = addresses(to);
		const parsedCc = addresses(cc);
		const parsedBcc = addresses(bcc);
		const invalid = [...parsedTo, ...parsedCc, ...parsedBcc].find((value) => !ADDRESS.test(value));
		if (!accountId) return setError("Vyber aktivní odesílací účet.");
		if (parsedTo.length === 0) return setError("Doplň alespoň jednoho příjemce.");
		if (invalid) return setError(`Adresa „${invalid}“ není platná.`);
		if (!subject.trim() && !textBody.trim()) return setError("Napiš předmět nebo text zprávy.");
		if (mentionsAttachment && !sendWithoutAttachment) {
			return setError("Text zmiňuje přílohu. Potvrď, že chceš zprávu odeslat bez ní.");
		}
		if (sendLater && (!sendAt || Date.parse(sendAt) <= Date.now())) {
			return setError("Pro plánované odeslání vyber budoucí datum a čas.");
		}
		setError(null);
		const outboundInput = {
			accountId,
			to: parsedTo,
			cc: parsedCc,
			bcc: parsedBcc,
			subject: subject.trim(),
			textBody,
			sendAt: sendLater ? new Date(sendAt).toISOString() : null,
		};
		const fingerprint = JSON.stringify(outboundInput);
		if (submission.current?.fingerprint !== fingerprint) {
			submission.current = {
				fingerprint,
				id: crypto.randomUUID(),
				operationId: crypto.randomUUID(),
			};
		}
		try {
			await model.enqueueOutbound({
				id: submission.current.id,
				operationId: submission.current.operationId,
				accountId,
				to: parsedTo,
				cc: parsedCc,
				bcc: parsedBcc,
				subject: subject.trim(),
				textBody,
				sendAt: outboundInput.sendAt,
			});
			onClose();
		} catch {
			setError("Zprávu se nepodařilo bezpečně zařadit. Obsah zůstává v tomto okně.");
		}
	};

	return (
		<div
			data-personal-composer
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 120,
				background: "color-mix(in srgb, var(--ink) 35%, transparent)",
				display: "grid",
				placeItems: "center",
				padding: 12,
			}}
		>
			<form
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="personal-composer-title"
				onSubmit={(event) => void submit(event)}
				style={{
					width: "min(720px, 100%)",
					maxHeight: "min(760px, calc(100vh - 24px))",
					overflow: "hidden",
					display: "flex",
					flexDirection: "column",
					background: "var(--panel)",
					border: "1px solid var(--line)",
					borderRadius: 16,
					boxShadow: "0 24px 70px color-mix(in srgb, var(--ink) 28%, transparent)",
				}}
			>
				<header style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
					<div style={{ flex: 1, minWidth: 0 }}>
						<h2 id="personal-composer-title" style={{ margin: 0, fontSize: 16, color: "var(--ink)" }}>
							Nová osobní zpráva
						</h2>
						<div style={{ marginTop: 3, fontSize: 10.5, color: "var(--ink-3)" }}>
							Skutečné odeslání přes připojený Gmail · obsah je ve frontě šifrovaný
						</div>
					</div>
					<button type="button" onClick={onClose} disabled={model.sendingMail} aria-label="Zavřít novou zprávu" style={{ width: 44, height: 44, border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--ink-2)", cursor: "pointer", fontSize: 18 }}>×</button>
				</header>

				<div style={{ display: "grid", gap: 12, padding: 16, overflow: "auto", minHeight: 0, flex: 1 }}>
					<label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--ink-3)" }}>
						Od
						<select value={accountId} onChange={(event) => setAccountId(event.target.value)} style={fieldStyle()}>
							{connected.map((account) => <option key={account.id} value={account.id}>{account.displayName ? `${account.displayName} · ` : ""}{account.emailAddress}</option>)}
						</select>
					</label>
					<label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--ink-3)" }}>
						Komu
						<input ref={toRef} value={to} onChange={(event) => setTo(event.target.value)} placeholder="jana@firma.cz, petr@firma.cz" autoComplete="off" inputMode="email" style={fieldStyle()} />
					</label>
					{!showCopies ? (
						<button type="button" onClick={() => setShowCopies(true)} style={{ justifySelf: "start", minHeight: 40, border: 0, background: "transparent", color: "var(--brass-text)", padding: 0, cursor: "pointer", fontWeight: 700, fontSize: 11.5 }}>Přidat kopii nebo skrytou kopii</button>
					) : (
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
							<label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--ink-3)" }}>Kopie<input value={cc} onChange={(event) => setCc(event.target.value)} inputMode="email" style={fieldStyle()} /></label>
							<label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--ink-3)" }}>Skrytá kopie<input value={bcc} onChange={(event) => setBcc(event.target.value)} inputMode="email" style={fieldStyle()} /></label>
						</div>
					)}
					<label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--ink-3)" }}>
						Předmět
						<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={998} style={fieldStyle()} />
					</label>
					<label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--ink-3)" }}>
						Zpráva
						<textarea value={textBody} onChange={(event) => { setTextBody(event.target.value); setSendWithoutAttachment(false); }} rows={10} maxLength={512 * 1024} style={{ ...fieldStyle(), resize: "vertical", lineHeight: 1.55 }} />
					</label>

					{mentionsAttachment && (
						<div role="alert" style={{ borderRadius: 10, padding: "10px 12px", background: "var(--w-brass-soft)", color: "var(--ink)", fontSize: 11, lineHeight: 1.5 }}>
							<strong>Nezapomněl/a jsi přílohu?</strong> Osobní odesílání zatím bezpečně podporuje jen text.
							<label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, cursor: "pointer" }}>
								<input type="checkbox" checked={sendWithoutAttachment} onChange={(event) => setSendWithoutAttachment(event.target.checked)} />
								<span>Rozumím, odeslat tuto zprávu bez přílohy</span>
							</label>
						</div>
					)}

					<label style={{ display: "flex", gap: 9, alignItems: "center", minHeight: 44, fontSize: 11.5, color: "var(--ink-2)", cursor: "pointer" }}>
						<input type="checkbox" checked={sendLater} onChange={(event) => setSendLater(event.target.checked)} />
						Naplánovat odeslání
					</label>
					{sendLater && (
						<label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--ink-3)" }}>
							Datum a čas odeslání
							<input type="datetime-local" min={minSchedule} value={sendAt} onChange={(event) => setSendAt(event.target.value)} style={fieldStyle()} />
						</label>
					)}

					{error && <div role="alert" style={{ borderRadius: 9, padding: "9px 11px", background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 11 }}>{error}</div>}
				</div>

				<footer style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
					<span style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
						{sendLater ? "Do zvoleného termínu můžeš zprávu zrušit." : "Po kliknutí máš 10 sekund na vrácení odeslání."}
					</span>
					<div style={{ display: "flex", gap: 8 }}>
						<button type="button" onClick={onClose} disabled={model.sendingMail} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 14px", cursor: "pointer" }}>Zrušit</button>
						<button type="submit" disabled={model.sendingMail || connected.length === 0} style={{ minHeight: 44, border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", padding: "0 16px", cursor: "pointer", fontWeight: 750 }}>
							{model.sendingMail ? "Zařazuji…" : sendLater ? "Naplánovat" : "Odeslat"}
						</button>
					</div>
				</footer>
			</form>
		</div>
	);
}
