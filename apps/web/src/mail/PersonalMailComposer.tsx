import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useOverlayLayer } from "../lib/useOverlayLayer";
import type { PersonalComposeIntent } from "./personalComposeIntent";
import { useMailReplyAssistant } from "./useMailReplyAssistant";
import type { PersonalMailModel, PersonalMessageDetail } from "./usePersonalMail";

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ATTACHMENT_PHRASE = /\b(příloh|přiklád|v příloze|attached|attachment|enclos)/i;
const AI_ERROR_LABELS: Record<string, string> = {
	ai_not_configured: "Poskytovatel AI teď není nakonfigurovaný.",
	ai_policy_disabled: "AI návrhy jsou pro osobní poštu vypnuté.",
	ai_daily_quota_exceeded: "Dnešní limit AI návrhů byl vyčerpán.",
	mail_ai_provider_unavailable: "Návrh se teď nepodařilo vytvořit. Rozepsaná odpověď zůstala beze změny.",
	mail_ai_policy_unavailable: "Nastavení AI návrhů se nepodařilo načíst.",
	mail_message_not_found: "Původní zpráva už není dostupná.",
};

function addresses(value: string) {
	return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function replyAddress(value: string) {
	return (/<([^<>\s]+@[^<>\s]+)>/.exec(value)?.[1] ?? /([^<>\s]+@[^<>\s]+)/.exec(value)?.[1] ?? "")
		.replace(/[>,;]+$/, "")
		.toLowerCase();
}

function replySubject(value: string) {
	const normalized = value.trim();
	return /^re\s*:/i.test(normalized) ? normalized : `Re: ${normalized || "(bez předmětu)"}`;
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
	replyTo = null,
	prefill = null,
}: {
	model: PersonalMailModel;
	onClose: () => void;
	replyTo?: PersonalMessageDetail | null;
	prefill?: PersonalComposeIntent | null;
}) {
	const connected = model.accounts.filter((account) => account.status === "connected");
	const [accountId, setAccountId] = useState(
		replyTo?.accountId ?? (model.accountFilter !== "all" && connected.some((account) => account.id === model.accountFilter)
			? model.accountFilter
			: connected[0]?.id ?? ""),
	);
	const [to, setTo] = useState(() =>
		replyTo ? replyAddress(replyTo.replyTo || replyTo.from) : (prefill?.to ?? ""),
	);
	const [cc, setCc] = useState("");
	const [bcc, setBcc] = useState("");
	const [subject, setSubject] = useState(() =>
		replyTo ? replySubject(replyTo.subject) : (prefill?.subject ?? ""),
	);
	const [textBody, setTextBody] = useState(() => prefill?.body ?? "");
	const [sendLater, setSendLater] = useState(false);
	const [sendAt, setSendAt] = useState("");
	const [showCopies, setShowCopies] = useState(false);
	const [sendWithoutAttachment, setSendWithoutAttachment] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [aiEnableConsent, setAiEnableConsent] = useState(false);
	const [aiTransferConsent, setAiTransferConsent] = useState(false);
	const [aiInstruction, setAiInstruction] = useState("");
	const replyAssistant = useMailReplyAssistant(accountId, replyTo?.id ?? null);
	const toRef = useRef<HTMLInputElement>(null);
	const aiSuggestionRef = useRef<HTMLDivElement>(null);
	const submission = useRef<{ fingerprint: string; id: string; operationId: string } | null>(null);
	const dialogRef = useOverlayLayer<HTMLFormElement>(true, () => {
		if (!model.sendingMail) onClose();
	});

	useEffect(() => {
		toRef.current?.focus();
	}, []);
	useEffect(() => {
		if (!replyAssistant.suggestion) return;
		const frame = window.requestAnimationFrame(() => {
			aiSuggestionRef.current?.scrollIntoView({ block: "nearest" });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [replyAssistant.suggestion]);

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
	const aiError = replyAssistant.error
		? AI_ERROR_LABELS[replyAssistant.error] ?? "AI návrh se teď nepodařilo zpracovat."
		: null;

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
			replyToMessageId: replyTo?.id ?? null,
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
				replyToMessageId: outboundInput.replyToMessageId,
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
							{replyTo ? "Odpověď na zprávu" : "Nová osobní zpráva"}
						</h2>
						<div style={{ marginTop: 3, fontSize: 10.5, color: "var(--ink-3)" }}>
							{replyTo ? "Watson bezpečně zachová mailové vlákno" : "Skutečné odeslání přes připojený účet"} · obsah je ve frontě šifrovaný
						</div>
					</div>
					<button type="button" onClick={onClose} disabled={model.sendingMail} aria-label={replyTo ? "Zavřít odpověď" : "Zavřít novou zprávu"} style={{ width: 44, height: 44, border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--ink-2)", cursor: "pointer", fontSize: 18 }}>×</button>
				</header>

				<div style={{ display: "grid", gap: 12, padding: 16, overflow: "auto", minHeight: 0, flex: 1 }}>
					<label style={{ display: "grid", gap: 5, fontSize: 11, color: "var(--ink-3)" }}>
						Od
						<select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={Boolean(replyTo)} aria-describedby={replyTo ? "personal-reply-account-help" : undefined} style={fieldStyle()}>
							{connected.map((account) => <option key={account.id} value={account.id}>{account.displayName ? `${account.displayName} · ` : ""}{account.emailAddress}</option>)}
						</select>
						{replyTo && <span id="personal-reply-account-help" style={{ fontSize: 9.5, lineHeight: 1.4 }}>Odpověď se odešle ze stejného účtu, do kterého přišla původní zpráva.</span>}
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

					{replyTo && (
						<section data-mail-reply-ai aria-labelledby="mail-reply-ai-title" style={{ display: "grid", gap: 10, border: "1px solid var(--line)", borderRadius: 12, padding: 12, background: "var(--panel-2)" }}>
							<div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
								<div aria-hidden style={{ width: 30, height: 30, flex: "none", display: "grid", placeItems: "center", borderRadius: 9, background: "var(--accent-soft)", color: "var(--brass-text)" }}>✦</div>
								<div style={{ flex: 1, minWidth: 0 }}>
									<strong id="mail-reply-ai-title" style={{ display: "block", color: "var(--ink)", fontSize: 12 }}>AI návrh odpovědi</strong>
									<div style={{ marginTop: 3, color: "var(--ink-3)", fontSize: 10.5, lineHeight: 1.5 }}>Návrh se nikdy neodešle sám a nezapisuje se do historie. Do zprávy se dostane až po tvém kliknutí.</div>
								</div>
								{replyAssistant.policy?.enabled && <button type="button" disabled={replyAssistant.updatingPolicy} onClick={() => void replyAssistant.setEnabled(false).catch(() => undefined)} style={{ minHeight: 40, border: 0, background: "transparent", color: "var(--ink-3)", padding: "0 6px", cursor: "pointer", fontSize: 10.5 }}>Vypnout</button>}
							</div>

							{replyAssistant.loadingPolicy ? (
								<div aria-live="polite" style={{ color: "var(--ink-3)", fontSize: 10.5 }}>Načítám nastavení…</div>
							) : replyAssistant.policy && !replyAssistant.policy.available ? (
								<div role="status" style={{ color: "var(--ink-3)", fontSize: 10.5 }}>Poskytovatel AI není v tomto prostředí nakonfigurovaný. Běžnou odpověď můžeš odeslat bez omezení.</div>
							) : replyAssistant.policy && !replyAssistant.policy.enabled ? (
								<>
									<label style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "var(--ink-2)", fontSize: 10.5, lineHeight: 1.5, cursor: "pointer" }}>
										<input type="checkbox" checked={aiEnableConsent} onChange={(event) => setAiEnableConsent(event.target.checked)} />
										<span>Povolit AI návrhy pro mou osobní poštu s limitem {replyAssistant.policy.dailyLimit} návrhů denně. Samotné povolení nic nikam neodesílá.</span>
									</label>
									<button type="button" disabled={!aiEnableConsent || replyAssistant.updatingPolicy} onClick={() => void replyAssistant.setEnabled(true).then(() => setAiEnableConsent(false)).catch(() => undefined)} style={{ justifySelf: "start", minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "var(--panel)", color: "var(--ink-2)", padding: "0 13px", cursor: "pointer", fontWeight: 700 }}>{replyAssistant.updatingPolicy ? "Ukládám…" : "Povolit AI návrhy"}</button>
								</>
							) : replyAssistant.policy?.enabled ? (
								<>
									<label style={{ display: "grid", gap: 5, color: "var(--ink-3)", fontSize: 10.5 }}>
										Volitelné zadání stylu
										<input value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} maxLength={1_000} placeholder="např. stručně, přátelsky, potvrdit termín" style={fieldStyle()} />
									</label>
									<label style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "var(--ink-2)", fontSize: 10.5, lineHeight: 1.5, cursor: "pointer" }}>
										<input type="checkbox" checked={aiTransferConsent} onChange={(event) => setAiTransferConsent(event.target.checked)} />
										<span>Souhlasím s tím, že se pro tento návrh poskytovateli {replyAssistant.policy.provider ?? "AI"} předá předmět, odesílatel a nejvýše 12&nbsp;000 znaků poslední zprávy. E-mailové adresy a telefony Watson předem redukuje.</span>
									</label>
									{replyAssistant.policy.mock && <div role="status" style={{ color: "var(--success-ink)", fontSize: 10 }}>Vývojový režim: tento návrh vytváří lokální simulátor a data Watson neopustí.</div>}
									<button type="button" disabled={!aiTransferConsent || replyAssistant.generating} onClick={() => void replyAssistant.generate(aiInstruction).then(() => setAiTransferConsent(false)).catch(() => undefined)} style={{ justifySelf: "start", minHeight: 44, border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", padding: "0 14px", cursor: "pointer", fontWeight: 750 }}>{replyAssistant.generating ? "Vytvářím návrh…" : "Navrhnout odpověď"}</button>
								</>
							) : null}

							{replyAssistant.suggestion && (
								<div ref={aiSuggestionRef} data-mail-reply-ai-suggestion aria-live="polite" style={{ display: "grid", gap: 9, border: "1px solid var(--line)", borderRadius: 10, padding: 11, background: "var(--panel)" }}>
									<strong style={{ color: "var(--ink-2)", fontSize: 10.5 }}>Návrh ke kontrole</strong>
									<div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--ink-2)", fontSize: 11.5, lineHeight: 1.55 }}>{replyAssistant.suggestion}</div>
									<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
										<button type="button" onClick={() => { setTextBody(replyAssistant.suggestion ?? ""); setSendWithoutAttachment(false); }} style={{ minHeight: 44, border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", padding: "0 13px", cursor: "pointer", fontWeight: 700 }}>{textBody.trim() ? "Nahradit rozepsaný text návrhem" : "Použít návrh"}</button>
										<button type="button" onClick={replyAssistant.discardSuggestion} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 13px", cursor: "pointer" }}>Zahodit návrh</button>
									</div>
								</div>
							)}
							{aiError && <div role="alert" style={{ borderRadius: 9, padding: "9px 11px", background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 10.5 }}>{aiError}</div>}
						</section>
					)}

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
