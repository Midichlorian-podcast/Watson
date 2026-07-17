import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PersonalMailComposer } from "./PersonalMailComposer";
import { PersonalMailTaskDialog } from "./PersonalMailTaskDialog";
import { useMail } from "./state";
import type {
	PersonalMailExecution,
	PersonalMailModel,
	PersonalMessageSummary,
} from "./usePersonalMail";

const syncLabels: Record<string, string> = {
	pending: "Čeká na synchronizaci",
	running: "Synchronizuji…",
	idle: "Aktuální",
	retry: "Zkusím znovu",
	dead: "Vyžaduje kontrolu",
	reauth_required: "Obnovit Google souhlas",
};

const errorLabels: Record<string, string> = {
	unauthorized: "Přihlášení vypršelo. Obnov stránku.",
	mail_accounts_unavailable: "Účty se nepodařilo bezpečně načíst.",
	mail_messages_unavailable: "Zprávy se nepodařilo načíst.",
	mail_messages_partial: "Jeden z účtů teď neodpověděl. Ostatní zprávy zůstávají dostupné.",
	mail_message_unavailable: "Detail zprávy se nepodařilo načíst.",
	mail_execution_unavailable: "Úkol se nepodařilo bezpečně navázat.",
	mail_execution_conflict: "Vazba se mezitím změnila. Stav jsme obnovili.",
	mail_outbound_unavailable: "Zprávu se nepodařilo bezpečně zařadit k odeslání.",
	mail_outbound_not_cancellable: "Zprávu už nelze vrátit. Stav jsme obnovili.",
	mail_outbound_conflict: "Odeslání se mezitím změnilo. Stav jsme obnovili.",
	stale_version: "Odeslání se mezitím změnilo. Stav jsme obnovili.",
	mail_account_inactive: "Účet není aktivní. Obnov Google souhlas v Nastavení.",
	mail_account_not_found: "Účet už není dostupný.",
};

const outboundLabels: Record<string, string> = {
	queued: "Čeká na odeslání",
	sending: "Odesílá se…",
	retry: "Google dočasně omezuje provoz · Watson zkusí znovu",
	accepted: "Google přijal zprávu",
	cancelled: "Odeslání vráceno",
	uncertain: "Výsledek je nejistý · Watson zprávu automaticky neopakuje",
	failed: "Zprávu se nepodařilo odeslat",
};

function formatDate(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const today = new Date();
	const sameDay = date.toDateString() === today.toDateString();
	return new Intl.DateTimeFormat("cs-CZ", sameDay
		? { hour: "2-digit", minute: "2-digit" }
		: { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function initials(value: string) {
	const display = value.replace(/<.*?>/g, " ").trim();
	const parts = display.split(/\s+/).filter(Boolean);
	return (parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : display.slice(0, 2))
		.toUpperCase() || "E";
}

function MessageRow({
	message,
	accountLabel,
	selected,
	execution,
	onOpen,
}: {
	message: PersonalMessageSummary;
	accountLabel: string;
	selected: boolean;
	execution: PersonalMailExecution | null;
	onOpen: () => void;
}) {
	const unread = message.labelIds.includes("UNREAD");
	return (
		<button
			type="button"
			data-personal-message-row
			data-selected={selected || undefined}
			data-unread={unread || undefined}
			aria-label={`${unread ? "Nepřečtené, " : ""}${message.from || "Neznámý odesílatel"}, ${message.subject || "bez předmětu"}`}
			onClick={onOpen}
			style={{
				width: "100%",
				border: 0,
				borderBottom: "1px solid var(--line)",
				background: selected ? "var(--accent-soft)" : "transparent",
				color: "inherit",
				padding: "12px 14px",
				textAlign: "left",
				cursor: "pointer",
				display: "grid",
				gridTemplateColumns: "34px minmax(0, 1fr)",
				gap: 10,
			}}
		>
			<span
				aria-hidden
				style={{
					width: 34,
					height: 34,
					borderRadius: "50%",
					display: "grid",
					placeItems: "center",
					background: "var(--avatar-navy)",
					color: "white",
					fontSize: 10,
					fontWeight: 800,
				}}
			>
				{initials(message.from)}
			</span>
			<span style={{ minWidth: 0 }}>
				<span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
					{unread && <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--brass)", flex: "none" }} />}
					<span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontWeight: unread ? 750 : 600, color: "var(--ink)" }}>
						{message.from || "Neznámý odesílatel"}
					</span>
					<time dateTime={message.internalDate} style={{ flex: "none", fontSize: 10, color: "var(--ink-3)" }}>
						{formatDate(message.internalDate)}
					</time>
				</span>
				<span style={{ display: "block", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: unread ? 700 : 550, color: "var(--ink-2)" }}>
					{message.subject || "(bez předmětu)"}
				</span>
				<span style={{ display: "block", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "var(--ink-3)" }}>
					{message.snippet || (message.hasText ? "Textová zpráva" : "Zpráva bez textového náhledu")}
				</span>
				<span style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
					<span style={{ fontSize: 9.5, color: "var(--ink-3)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 6px" }}>{accountLabel}</span>
					{execution && (
						<span style={{ fontSize: 9.5, color: execution.taskExists ? "var(--success-ink)" : "var(--danger-ink)", border: "1px solid currentColor", borderRadius: 999, padding: "2px 6px" }}>
							{execution.taskExists ? (execution.completedAt ? "✓ Úkol hotový" : `Úkol P${execution.priority ?? "?"}`) : "Úkol smazán"}
						</span>
					)}
					{message.attachmentCount > 0 && <span style={{ fontSize: 9.5, color: "var(--ink-3)" }}>📎 {message.attachmentCount}</span>}
					{message.contentTruncated && <span style={{ fontSize: 9.5, color: "var(--danger-ink)" }}>zkráceno bezpečnostním limitem</span>}
				</span>
			</span>
		</button>
	);
}

export function PersonalMailWorkspace({
	model,
	onOpenDrawer,
}: {
	model: PersonalMailModel;
	onOpenDrawer: () => void;
}) {
	const navigate = useNavigate();
	const mail = useMail();
	const [taskDialogMessage, setTaskDialogMessage] = useState<PersonalMessageSummary | null>(null);
	const [composerOpen, setComposerOpen] = useState(false);
	const accountById = new Map(model.accounts.map((account) => [account.id, account]));
	const selectedKey = model.selected ? `${model.selected.accountId}:${model.selected.messageId}` : null;
	const selectedAccount = model.detail ? accountById.get(model.detail.accountId) : null;
	const selectedMessage = model.selected
		? model.messages.find(
				(message) =>
					message.accountId === model.selected?.accountId &&
					message.id === model.selected.messageId,
			) ?? (model.detail as PersonalMessageSummary | null)
		: null;
	const selectedExecution = selectedMessage ? model.executionFor(selectedMessage) : null;
	const openTask = (taskId: string) => mail.bridge.onNav?.(`task:${taskId}`);
	const aggregateStatus = model.accounts.some((account) =>
		account.status === "reauth_required" || model.runtime[account.id]?.sync?.status === "reauth_required",
	) ? "reauth_required" : model.accounts.some((account) => {
		const status = model.runtime[account.id]?.sync?.status;
		return status === "pending" || status === "running";
	}) ? "running" : model.accounts.some((account) =>
		account.status === "degraded" || model.runtime[account.id]?.sync?.status === "dead",
	) ? "dead" : model.accounts.some((account) => model.runtime[account.id]?.sync?.status === "retry") ? "retry" : "idle";
	const needsAttention = aggregateStatus === "dead" || aggregateStatus === "reauth_required";

	if (!model.loadingAccounts && model.accounts.length === 0) {
		return (
			<section data-personal-mail data-detail-open="false" style={{ flex: 1, minWidth: 0, minHeight: 0, display: "grid", placeItems: "center", padding: 24 }}>
				<div style={{ maxWidth: 480, textAlign: "center", border: "1px solid var(--line)", borderRadius: 16, padding: 24, background: "var(--panel)" }}>
					<div aria-hidden style={{ width: 48, height: 48, borderRadius: 14, margin: "0 auto 12px", display: "grid", placeItems: "center", background: "var(--accent-soft)", fontSize: 22 }}>✉</div>
					<h2 style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>Připoj osobní Gmail</h2>
					<p style={{ margin: "8px 0 16px", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-3)" }}>
						Watson zprávy synchronizuje šifrovaně. Heslo nevidí a obsah zpřístupní jen vlastníkovi účtu.
					</p>
					<button type="button" onClick={() => void navigate({ to: "/nastaveni", search: { sekce: "integrace" } })} style={{ minHeight: 44, border: 0, borderRadius: 10, padding: "0 16px", background: "var(--ink)", color: "var(--panel)", fontWeight: 700, cursor: "pointer" }}>
						Přejít k připojení účtu
					</button>
				</div>
			</section>
		);
	}

	return (
		<section data-personal-mail data-detail-open={Boolean(model.selected)} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", background: "var(--panel)" }}>
			<div data-personal-list style={{ width: 390, minWidth: 300, maxWidth: "46vw", display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--line)" }}>
				<header style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "grid", gap: 10 }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<button type="button" onClick={onOpenDrawer} aria-label="Otevřít schránky" data-personal-mobile-menu style={{ width: 44, height: 44, border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}>☰</button>
						<div style={{ minWidth: 0, flex: 1 }}>
							<h2 style={{ margin: 0, fontSize: 15, color: "var(--ink)" }}>Osobní pošta</h2>
							<div style={{ marginTop: 2, fontSize: 10.5, color: needsAttention ? "var(--danger-ink)" : "var(--ink-3)" }}>
								{syncLabels[aggregateStatus]} · {model.totalCount} zpráv · {model.unreadCount} nepřečtených
							</div>
						</div>
						<button type="button" data-personal-compose onClick={() => setComposerOpen(true)} disabled={model.accounts.every((account) => account.status !== "connected")} style={{ minHeight: 44, border: 0, borderRadius: 10, background: "var(--ink)", color: "var(--panel)", padding: "0 12px", fontWeight: 750, cursor: "pointer" }}>
							Napsat
						</button>
						<button type="button" onClick={() => void model.requestSync()} disabled={model.syncing || model.accounts.every((account) => account.status !== "connected")} title="Zkontrolovat nové zprávy" style={{ minWidth: 44, height: 44, border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}>
							{model.syncing ? "…" : "↻"}
						</button>
					</div>
					{model.accounts.length > 1 && (
						<label style={{ display: "grid", gap: 4, fontSize: 10, color: "var(--ink-3)" }}>
							Účet
							<select value={model.accountFilter} onChange={(event) => { model.setAccountFilter(event.target.value); model.closeMessage(); }} style={{ minHeight: 40, border: "1px solid var(--line)", borderRadius: 9, background: "var(--panel)", color: "var(--ink)", padding: "0 10px" }}>
								<option value="all">Všechny osobní účty</option>
								{model.accounts.map((account) => <option key={account.id} value={account.id}>{account.emailAddress}</option>)}
							</select>
						</label>
					)}
					<div style={{ borderRadius: 9, padding: "8px 10px", background: "var(--success-soft)", color: "var(--success-ink)", fontSize: 10.5, lineHeight: 1.4 }}>
						Skutečný šifrovaný příjem i odesílání. Hromadné poštovní akce mimo osobní schránku zůstávají demo.
					</div>
					{needsAttention && (
						<div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 9, padding: "8px 10px", background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 10.5, lineHeight: 1.4 }}>
							<span style={{ flex: 1 }}>{aggregateStatus === "reauth_required" ? "Google přístup vypršel. Obnov souhlas, zprávy zůstanou bezpečně uložené." : "Synchronizace vyžaduje kontrolu účtu."}</span>
							<button type="button" onClick={() => void navigate({ to: "/nastaveni", search: { sekce: "integrace" } })} style={{ minHeight: 40, border: "1px solid currentColor", borderRadius: 8, background: "transparent", color: "inherit", padding: "0 10px", fontWeight: 700, cursor: "pointer" }}>Nastavení</button>
						</div>
					)}
				</header>
				{model.error && <div role="alert" style={{ margin: 10, padding: "9px 10px", borderRadius: 9, background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 11 }}>{errorLabels[model.error] ?? "Poštu se nepodařilo bezpečně načíst. Zkus obnovení."}</div>}
				{model.outbound.slice(0, 3).map((message) => {
					const scheduled = Date.parse(message.scheduledFor) - Date.parse(message.createdAt) > 20_000;
					const danger = message.status === "failed" || message.status === "uncertain";
					return (
						<div key={message.id} data-personal-outbound-status={message.status} role={danger ? "alert" : "status"} style={{ margin: "10px 10px 0", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 10px", background: danger ? "var(--danger-soft)" : message.status === "accepted" ? "var(--success-soft)" : "var(--panel-2)", color: danger ? "var(--danger-ink)" : "var(--ink-2)", fontSize: 10.5, lineHeight: 1.4 }}>
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								<div style={{ flex: 1, minWidth: 0 }}>
									<strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.subject || "(bez předmětu)"}</strong>
									<span>{outboundLabels[message.status] ?? message.status}{scheduled && message.status === "queued" ? ` · ${formatDate(message.scheduledFor)}` : ""}</span>
								</div>
								{message.canCancel && (
									<button type="button" onClick={() => void model.cancelOutbound(message).catch(() => undefined)} disabled={model.cancellingOutboundId !== null} style={{ minHeight: 40, border: "1px solid currentColor", borderRadius: 8, background: "transparent", color: "inherit", padding: "0 10px", fontWeight: 750, cursor: "pointer" }}>
										{model.cancellingOutboundId === message.id ? "Vracím…" : scheduled ? "Zrušit plán" : "Vrátit odeslání"}
									</button>
								)}
							</div>
						</div>
					);
				})}
				<div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
					{model.loadingMessages ? (
						<div aria-live="polite" style={{ padding: 18, fontSize: 12, color: "var(--ink-3)" }}>Načítám šifrovanou poštu…</div>
					) : model.messages.length === 0 ? (
						<div style={{ padding: 22, textAlign: "center", fontSize: 12, color: "var(--ink-3)" }}>
							<strong style={{ display: "block", color: "var(--ink-2)", marginBottom: 5 }}>Zatím žádné synchronizované zprávy</strong>
							První synchronizace může chvíli trvat. Tlačítkem ↻ ji můžeš zkontrolovat.
						</div>
					) : model.messages.map((message) => (
						<MessageRow
							key={`${message.accountId}:${message.id}`}
							message={message}
							accountLabel={accountById.get(message.accountId)?.emailAddress ?? "Osobní účet"}
							selected={selectedKey === `${message.accountId}:${message.id}`}
							execution={model.executionFor(message)}
							onOpen={() => void model.openMessage(message)}
						/>
					))}
					{model.hasMore && <div style={{ padding: 12, textAlign: "center" }}><button type="button" onClick={() => void model.loadMore()} disabled={model.loadingMore} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 14px", cursor: "pointer" }}>{model.loadingMore ? "Načítám…" : "Načíst starší"}</button></div>}
				</div>
			</div>

			<article data-personal-detail style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "18px clamp(16px, 3vw, 42px)" }}>
				{!model.selected ? (
					<div style={{ minHeight: "100%", display: "grid", placeItems: "center", color: "var(--ink-3)", textAlign: "center" }}>
						<div><div aria-hidden style={{ fontSize: 30, marginBottom: 8 }}>✉</div><div style={{ fontSize: 12 }}>Vyber zprávu ze skutečné osobní pošty.</div></div>
					</div>
				) : model.loadingDetail ? (
					<div aria-live="polite" style={{ padding: 20, color: "var(--ink-3)", fontSize: 12 }}>Dešifruji detail zprávy…</div>
				) : !model.detail ? (
					<div role="alert" style={{ maxWidth: 520, margin: "20px auto", borderRadius: 12, padding: 18, background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 12, lineHeight: 1.55 }}>
						<strong>Detail zprávy se nepodařilo bezpečně načíst.</strong>
						<div style={{ marginTop: 5 }}>Zkus se vrátit do seznamu a zprávu otevřít znovu.</div>
						<button type="button" data-personal-back onClick={model.closeMessage} style={{ minHeight: 44, marginTop: 12, border: "1px solid currentColor", borderRadius: 9, background: "transparent", color: "inherit", padding: "0 12px", cursor: "pointer" }}>← Zpět na zprávy</button>
					</div>
				) : (
					<div style={{ maxWidth: 820, margin: "0 auto" }}>
						<button type="button" data-personal-back onClick={model.closeMessage} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 12px", cursor: "pointer", marginBottom: 12 }}>← Zpět na zprávy</button>
						<div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
							<div style={{ flex: 1, minWidth: 0 }}>
								<h1 style={{ margin: 0, fontSize: "clamp(19px, 2.4vw, 28px)", lineHeight: 1.2, color: "var(--ink)", overflowWrap: "anywhere" }}>{model.detail.subject || "(bez předmětu)"}</h1>
								<div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)", overflowWrap: "anywhere" }}>
									<strong>{model.detail.from || "Neznámý odesílatel"}</strong><br />
									<span style={{ color: "var(--ink-3)" }}>Komu: {model.detail.to.join(", ") || selectedAccount?.emailAddress || "—"}</span>
									{model.detail.cc.length > 0 && <><br /><span style={{ color: "var(--ink-3)" }}>Kopie: {model.detail.cc.join(", ")}</span></>}
								</div>
							</div>
							<time dateTime={model.detail.internalDate} style={{ flex: "none", fontSize: 10.5, color: "var(--ink-3)" }}>{formatDate(model.detail.internalDate)}</time>
						</div>
						<div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 18, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13.5, lineHeight: 1.65, color: "var(--ink-2)" }}>
							{model.detail.textBody || "Tato zpráva nemá bezpečně zobrazitelnou textovou část. HTML Watson úmyslně nevykresluje."}
						</div>
						{selectedMessage && (
							<section aria-label="Propojení mailu a úkolu" style={{ marginTop: 22, border: "1px solid var(--line)", borderRadius: 12, padding: 13, background: "var(--panel-2)" }}>
								<div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
									<div style={{ flex: 1, minWidth: 200 }}>
										<strong style={{ display: "block", fontSize: 12, color: "var(--ink)" }}>Execution Inbox</strong>
										<div style={{ marginTop: 3, fontSize: 10.5, lineHeight: 1.45, color: selectedExecution && !selectedExecution.taskExists ? "var(--danger-ink)" : "var(--ink-3)" }}>
											{!selectedExecution
												? "Vytvoř skutečný osobní úkol s dohledatelným odkazem na tuto zprávu."
												: selectedExecution.taskExists
													? `${selectedExecution.completedAt ? "Hotovo" : `P${selectedExecution.priority ?? "?"}`} · ${selectedExecution.taskName ?? "Navázaný úkol"}`
													: "Navázaný úkol byl smazán. Provenance zůstala zachovaná."}
										</div>
									</div>
									{selectedExecution?.taskExists ? (
										<button type="button" onClick={() => openTask(selectedExecution.taskId)} style={{ minHeight: 44, border: "1px solid var(--brass)", borderRadius: 9, background: "var(--brass-soft)", color: "var(--brass-text)", padding: "0 13px", fontWeight: 700, cursor: "pointer" }}>Otevřít úkol</button>
									) : (
										<button type="button" onClick={() => setTaskDialogMessage(selectedMessage)} style={{ minHeight: 44, border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", padding: "0 13px", fontWeight: 700, cursor: "pointer" }}>
											{selectedExecution ? "Vytvořit náhradní úkol" : "Vytvořit úkol"}
										</button>
									)}
								</div>
							</section>
						)}
						{model.detail.attachments.length > 0 && (
							<section aria-labelledby="personal-mail-attachments" style={{ marginTop: 22 }}>
								<h2 id="personal-mail-attachments" style={{ fontSize: 12, color: "var(--ink-2)" }}>Přílohy ({model.detail.attachments.length})</h2>
								<div style={{ display: "grid", gap: 8 }}>{model.detail.attachments.map((attachment) => <div key={attachment.attachmentId ?? `${attachment.filename}:${attachment.mimeType}:${attachment.size}`} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", fontSize: 11.5, color: "var(--ink-2)" }}><strong>{attachment.filename || "Příloha bez názvu"}</strong><div style={{ marginTop: 3, color: "var(--ink-3)", fontSize: 10 }}>{attachment.mimeType} · {Math.max(0, attachment.size).toLocaleString("cs-CZ")} B · stažení přijde v další etapě</div></div>)}</div>
							</section>
						)}
						<div style={{ marginTop: 24, padding: "10px 12px", borderRadius: 10, background: "var(--panel-2)", color: "var(--ink-3)", fontSize: 10.5, lineHeight: 1.5 }}>
							Bezpečný textový náhled M1. Surové HTML, tracking pixely a vzdálené obrázky se nespouštějí.
						</div>
					</div>
				)}
			</article>
			{taskDialogMessage && (
				<PersonalMailTaskDialog
					message={taskDialogMessage}
					existing={model.executionFor(taskDialogMessage)}
					projects={model.projects[taskDialogMessage.accountId] ?? []}
					creating={model.creatingTask}
					onClose={() => setTaskDialogMessage(null)}
					onCreate={model.createExecutionTask}
					onOpenTask={openTask}
				/>
			)}
			{composerOpen && <PersonalMailComposer model={model} onClose={() => setComposerOpen(false)} />}
		</section>
	);
}
