import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useOverlayLayer } from "../lib/useOverlayLayer";
import { PersonalMailComposer } from "./PersonalMailComposer";
import {
	PERSONAL_COMPOSE_INTENT_EVENT,
	takePersonalComposeIntent,
	type PersonalComposeIntent,
} from "./personalComposeIntent";
import { PersonalMailTaskDialog } from "./PersonalMailTaskDialog";
import { SharedDraftsDialog } from "./SharedDraftsDialog";
import { useMail } from "./state";
import { usePersonalMailTools, type PersonalMailPerson, type PersonalMailView } from "./usePersonalMailTools";
import type {
	PersonalMailExecution,
	PersonalMailModel,
	PersonalMessageDetail,
	PersonalMessageSummary,
} from "./usePersonalMail";

const syncLabels: Record<string, string> = {
	pending: "Čeká na synchronizaci",
	running: "Synchronizuji…",
	idle: "Aktuální",
	retry: "Zkusím znovu",
	dead: "Vyžaduje kontrolu",
	reauth_required: "Obnovit přístup k účtu",
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
	mail_account_inactive: "Účet není aktivní. Obnov jeho přístup v Nastavení.",
	mail_account_not_found: "Účet už není dostupný.",
};

const outboundLabels: Record<string, string> = {
	queued: "Čeká na odeslání",
	sending: "Odesílá se…",
	cancelled: "Odeslání vráceno",
	uncertain: "Výsledek je nejistý · Watson zprávu automaticky neopakuje",
	failed: "Zprávu se nepodařilo odeslat",
};

function outboundLabel(status: string, provider: string | undefined) {
	if (status === "retry") return `${provider === "google" ? "Google" : "SMTP server"} dočasně omezuje provoz · Watson zkusí znovu`;
	if (status === "accepted") return `${provider === "google" ? "Google" : "SMTP server"} přijal zprávu`;
	return outboundLabels[status] ?? status;
}

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

function emailAddress(value: string) {
	return (/<([^<>\s]+@[^<>\s]+)>/.exec(value)?.[1] ?? /([^<>\s]+@[^<>\s]+)/.exec(value)?.[1] ?? "")
		.replace(/[>,;]+$/, "")
		.toLowerCase();
}

function localDateTime(value: Date) {
	const offset = value.getTimezoneOffset() * 60_000;
	return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function MessageRow({
	message,
	accountLabel,
	selected,
	execution,
	labelNames,
	onOpen,
}: {
	message: PersonalMessageSummary;
	accountLabel: string;
	selected: boolean;
	execution: PersonalMailExecution | null;
	labelNames: string[];
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
					{labelNames.filter((name) => !["INBOX", "UNREAD", "Doručená pošta", "Nepřečtené"].includes(name)).slice(0, 2).map((name) => (
						<span key={name} style={{ fontSize: 9.5, color: "var(--ink-3)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 6px" }}>{name}</span>
					))}
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
	const tools = usePersonalMailTools(true);
	const [taskDialogMessage, setTaskDialogMessage] = useState<PersonalMessageSummary | null>(null);
	const [composerOpen, setComposerOpen] = useState(false);
	const [composerReply, setComposerReply] = useState<PersonalMessageDetail | null>(null);
	const [composerPrefill, setComposerPrefill] = useState<PersonalComposeIntent | null>(null);
	const [sharedDraftsOpen, setSharedDraftsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<PersonalMailView["sort"]>("newest");
	const [saveViewOpen, setSaveViewOpen] = useState(false);
	const [viewName, setViewName] = useState("");
	const [showInsights, setShowInsights] = useState(false);
	const [showFollowups, setShowFollowups] = useState(false);
	const [person, setPerson] = useState<PersonalMailPerson | null>(null);
	const personDialogRef = useOverlayLayer<HTMLDivElement>(Boolean(person), () => setPerson(null));
	const [personLoading, setPersonLoading] = useState(false);
	const [followupFor, setFollowupFor] = useState<string | null>(null);
	const [followupAt, setFollowupAt] = useState("");
	const accountById = new Map(model.accounts.map((account) => [account.id, account]));
	const labelsByAccount = useMemo(() => {
		const result = new Map<string, Map<string, string>>();
		for (const label of tools.labels) {
			const labels = result.get(label.accountId) ?? new Map<string, string>();
			labels.set(label.providerLabelId, label.name);
			result.set(label.accountId, labels);
		}
		return result;
	}, [tools.labels]);
	const labelNamesFor = (message: Pick<PersonalMessageSummary, "accountId" | "labelIds">) =>
		message.labelIds.map((id) => labelsByAccount.get(message.accountId)?.get(id) ?? id);
	const searchMessages = useMemo<PersonalMessageSummary[]>(() => tools.searchHits.map((hit) => ({
		accountId: hit.accountId,
		id: hit.id,
		providerMessageId: hit.providerMessageId,
		threadId: hit.threadId,
		historyId: "0",
		internalDate: hit.internalDate,
		labelIds: hit.labelIds,
		sizeEstimate: 0,
		contentTruncated: false,
		subject: hit.subject,
		from: hit.from,
		to: hit.to,
		cc: [],
		replyTo: "",
		dateHeader: "",
		snippet: hit.snippet,
		hasText: true,
		hasHtml: false,
		attachmentCount: hit.attachmentCount,
	})), [tools.searchHits]);
	const displayedMessages = query.trim() ? searchMessages : model.messages;

	useEffect(() => {
		const timer = window.setTimeout(() => void tools.search(query, sort), 280);
		return () => window.clearTimeout(timer);
	}, [query, sort, tools.search]);
	useEffect(() => {
		let active = true;
		const consume = () => {
			void takePersonalComposeIntent().then((intent) => {
				if (!active || !intent) return;
				setComposerReply(null);
				setComposerPrefill(intent);
				setComposerOpen(true);
			});
		};
		// Odklad je záměrný: vývojový React Strict Mode první efekt ihned uklidí
		// a znovu připojí. Jednorázový návrh proto smí převzít až stabilní mount.
		const timer = window.setTimeout(consume, 0);
		window.addEventListener(PERSONAL_COMPOSE_INTENT_EVENT, consume);
		return () => {
			active = false;
			window.clearTimeout(timer);
			window.removeEventListener(PERSONAL_COMPOSE_INTENT_EVENT, consume);
		};
	}, []);
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector("[data-esc-layer]")) return;
			const active = document.activeElement as HTMLElement | null;
			const typing = active?.matches("input, textarea, select, [contenteditable=true]") ?? false;
			if (typing) {
				if (event.key === "Escape") active?.blur();
				return;
			}
			const key = event.key.toLowerCase();
			if (key === "/") {
				event.preventDefault();
				document.querySelector<HTMLInputElement>("[data-personal-search]")?.focus();
				return;
			}
			if (key === "c") {
				event.preventDefault();
				setComposerReply(null);
				setComposerOpen(true);
				return;
			}
			const rows = [...document.querySelectorAll<HTMLButtonElement>("[data-personal-message-row]")];
			if (!rows.length) return;
			const current = rows.indexOf(document.activeElement as HTMLButtonElement);
			if (key === "j" || key === "k") {
				event.preventDefault();
				const next = key === "j" ? Math.min(rows.length - 1, current + 1) : Math.max(0, current < 0 ? 0 : current - 1);
				rows[next]?.focus();
			}
			if ((key === "o" || key === "enter") && current >= 0) rows[current]?.click();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
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
			<>
				<section data-personal-mail data-detail-open="false" style={{ flex: 1, minWidth: 0, minHeight: 0, display: "grid", placeItems: "center", padding: 24 }}>
					<div style={{ maxWidth: 480, textAlign: "center", border: "1px solid var(--line)", borderRadius: 16, padding: 24, background: "var(--panel)" }}>
						<div aria-hidden style={{ width: 48, height: 48, borderRadius: 14, margin: "0 auto 12px", display: "grid", placeItems: "center", background: "var(--accent-soft)", fontSize: 22 }}>✉</div>
						<h2 style={{ margin: 0, fontSize: 18, color: "var(--ink)" }}>Osobní pošta a týmové koncepty</h2>
						<p style={{ margin: "8px 0 16px", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-3)" }}>
							Připoj vlastní účet, nebo otevři jednotlivé koncepty, které ti kolegové výslovně nasdíleli k úpravě či schválení.
						</p>
						<div style={{ display: "flex", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
							<button type="button" data-personal-shared-drafts onClick={() => setSharedDraftsOpen(true)} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 10, padding: "0 16px", background: "transparent", color: "var(--ink-2)", fontWeight: 700, cursor: "pointer" }}>Sdílené koncepty</button>
							<button type="button" onClick={() => void navigate({ to: "/nastaveni", search: { sekce: "integrace" } })} style={{ minHeight: 44, border: 0, borderRadius: 10, padding: "0 16px", background: "var(--ink)", color: "var(--panel)", fontWeight: 700, cursor: "pointer" }}>Připojit osobní účet</button>
						</div>
					</div>
				</section>
				<SharedDraftsDialog open={sharedDraftsOpen} accounts={model.accounts} onClose={() => setSharedDraftsOpen(false)} />
			</>
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
						<button type="button" data-personal-compose onClick={() => { setComposerReply(null); setComposerOpen(true); }} disabled={model.accounts.every((account) => account.status !== "connected")} style={{ minHeight: 44, border: 0, borderRadius: 10, background: "var(--ink)", color: "var(--panel)", padding: "0 12px", fontWeight: 750, cursor: "pointer" }}>
							Napsat
						</button>
						<button type="button" onClick={() => void model.requestSync()} disabled={model.syncing || model.accounts.every((account) => account.status !== "connected")} title="Zkontrolovat nové zprávy" style={{ minWidth: 44, height: 44, border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}>
							{model.syncing ? "…" : "↻"}
						</button>
					</div>
					<div role="search" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 7 }}>
						<label style={{ position: "relative" }}>
							<span className="sr-only">Hledat jen v osobní poště</span>
							<input
								data-personal-search
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Hledat v poště · from: label: after: has:attachment"
								aria-describedby="personal-mail-search-help"
								style={{ width: "100%", boxSizing: "border-box", minHeight: 44, border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel)", color: "var(--ink)", padding: "0 36px 0 11px", fontSize: 11.5 }}
							/>
							<span aria-hidden style={{ position: "absolute", right: 12, top: 13, color: "var(--ink-3)" }}>{tools.searching ? "…" : "⌕"}</span>
						</label>
						<button type="button" onClick={() => setSaveViewOpen((value) => !value)} disabled={!query.trim()} title="Uložit tento pohled" style={{ minWidth: 44, minHeight: 44, border: "1px solid var(--line)", borderRadius: 10, background: saveViewOpen ? "var(--accent-soft)" : "transparent", color: "var(--ink-2)", cursor: "pointer" }}>☆</button>
					</div>
					<details id="personal-mail-search-help" style={{ fontSize: 9.5, lineHeight: 1.45, color: "var(--ink-3)" }}>
						<summary style={{ minHeight: 28, display: "flex", alignItems: "center", cursor: "pointer", fontWeight: 650 }}>Operátory a klávesové zkratky</summary>
						<div style={{ padding: "2px 2px 5px" }}>from:/od:, to:/komu:, subject:/predmet:, account:/ucet:, label:/stitek:, is:unread, after:2026-07-01, before:2026-07-31. Klávesy: / hledat, C napsat, J/K řádky, O otevřít.</div>
					</details>
					{saveViewOpen && (
						<form onSubmit={(event) => {
							event.preventDefault();
							if (!viewName.trim() || !query.trim()) return;
							void tools.createView(viewName.trim(), query.trim(), sort).then(() => {
								setViewName("");
								setSaveViewOpen(false);
							});
						}} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 7, padding: 8, border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel-2)" }}>
							<label style={{ display: "grid", gap: 3, fontSize: 9.5, color: "var(--ink-3)" }}>Název pohledu<input value={viewName} onChange={(event) => setViewName(event.target.value)} maxLength={120} style={{ minHeight: 40, border: "1px solid var(--line)", borderRadius: 8, background: "var(--panel)", color: "var(--ink)", padding: "0 9px" }} /></label>
							<button type="submit" disabled={!viewName.trim()} style={{ alignSelf: "end", minHeight: 40, border: 0, borderRadius: 8, background: "var(--ink)", color: "var(--panel)", padding: "0 11px", fontWeight: 700, cursor: "pointer" }}>Uložit</button>
						</form>
					)}
					<div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
						{([
							["Nepřečtené", "is:unread"],
							["S přílohou", "has:attachment"],
							["Posledních 7 dní", `after:${new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)}`],
						] as Array<[string, string]>).map(([name, value]) => <button key={name} type="button" onClick={() => { setQuery(value); setSort("newest"); }} style={{ minHeight: 32, border: "1px solid var(--line)", borderRadius: 999, background: query === value ? "var(--accent-soft)" : "transparent", color: "var(--ink-2)", padding: "0 9px", fontSize: 9.5, cursor: "pointer" }}>{name}</button>)}
						{tools.views.map((view) => <span key={view.id} style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--line)", borderRadius: 999, overflow: "hidden" }}><button type="button" onClick={() => { setQuery(view.query); setSort(view.sort); }} style={{ minHeight: 32, border: 0, background: query === view.query ? "var(--accent-soft)" : "transparent", color: "var(--ink-2)", padding: "0 8px", fontSize: 9.5, cursor: "pointer" }}>{view.name}</button><button type="button" aria-label={`Smazat uložený pohled ${view.name}`} onClick={() => void tools.deleteView(view)} style={{ minWidth: 32, minHeight: 32, border: 0, borderLeft: "1px solid var(--line)", background: "transparent", color: "var(--ink-3)", cursor: "pointer" }}>×</button></span>)}
					</div>
					<div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
						<button type="button" data-personal-shared-drafts onClick={() => setSharedDraftsOpen(true)} style={{ minHeight: 36, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 10px", fontSize: 10, cursor: "pointer" }}>Sdílené koncepty</button>
						<button type="button" onClick={() => setShowFollowups((value) => !value)} style={{ minHeight: 36, border: "1px solid var(--line)", borderRadius: 9, background: showFollowups ? "var(--accent-soft)" : "transparent", color: "var(--ink-2)", padding: "0 10px", fontSize: 10, cursor: "pointer" }}>Follow-upy · {tools.followups.filter((item) => item.status === "waiting").length}</button>
						<button type="button" onClick={() => setShowInsights((value) => !value)} style={{ minHeight: 36, border: "1px solid var(--line)", borderRadius: 9, background: showInsights ? "var(--accent-soft)" : "transparent", color: "var(--ink-2)", padding: "0 10px", fontSize: 10, cursor: "pointer" }}>Analytika schránky</button>
					</div>
					{showInsights && tools.analytics && <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, border: "1px solid var(--line)", borderRadius: 10, padding: 8, background: "var(--panel-2)" }}>{[
						["Nepřečtené", tools.analytics.unread], ["> 24 h", tools.analytics.waitingOver24h], ["Follow-up po termínu", tools.analytics.overdueFollowups],
					].map(([label, value]) => <div key={label} style={{ minWidth: 0 }}><strong style={{ display: "block", color: "var(--ink)", fontSize: 15 }}>{value}</strong><span style={{ color: "var(--ink-3)", fontSize: 9 }}>{label}</span></div>)}<div style={{ gridColumn: "1 / -1", fontSize: 9, color: "var(--ink-3)" }}>Souhrn za {tools.analytics.rangeDays} dní · nejde o skóre lidí.</div></div>}
					{showFollowups && <div style={{ display: "grid", gap: 6, maxHeight: 170, overflow: "auto", border: "1px solid var(--line)", borderRadius: 10, padding: 8, background: "var(--panel-2)" }}>{tools.followups.length === 0 ? <span style={{ fontSize: 10, color: "var(--ink-3)" }}>Žádný čekající follow-up.</span> : tools.followups.map((followup) => <div key={followup.id} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 9.5, color: "var(--ink-2)" }}><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{followup.status === "replied" ? "✓ Odpovězeno" : followup.status === "waiting" ? `Čeká do ${formatDate(followup.dueAt)}` : "Uzavřeno"} · {followup.subject ?? "(obsah nedostupný)"}</span>{followup.status === "waiting" && <button type="button" onClick={() => void tools.completeFollowup(followup, "done")} style={{ minHeight: 32, border: "1px solid var(--line)", borderRadius: 7, background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}>Hotovo</button>}</div>)}</div>}
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
						Skutečný šifrovaný příjem, odesílání, hledání a Watson pohledy. Týmové schránky zůstávají oddělená pozdější etapa M3.
					</div>
					{needsAttention && (
						<div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 9, padding: "8px 10px", background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 10.5, lineHeight: 1.4 }}>
							<span style={{ flex: 1 }}>{aggregateStatus === "reauth_required" ? "Google přístup vypršel. Obnov souhlas, zprávy zůstanou bezpečně uložené." : "Synchronizace vyžaduje kontrolu účtu."}</span>
							<button type="button" onClick={() => void navigate({ to: "/nastaveni", search: { sekce: "integrace" } })} style={{ minHeight: 40, border: "1px solid currentColor", borderRadius: 8, background: "transparent", color: "inherit", padding: "0 10px", fontWeight: 700, cursor: "pointer" }}>Nastavení</button>
						</div>
					)}
				</header>
				{(model.error || tools.error) && <div role="alert" style={{ margin: 10, padding: "9px 10px", borderRadius: 9, background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 11 }}>{model.error ? (errorLabels[model.error] ?? "Poštu se nepodařilo bezpečně načíst. Zkus obnovení.") : "Pokročilé poštovní nástroje se nepodařilo načíst; zprávy zůstávají dostupné."}</div>}
				{model.outbound.slice(0, 3).map((message) => {
					const scheduled = Date.parse(message.scheduledFor) - Date.parse(message.createdAt) > 20_000;
					const danger = message.status === "failed" || message.status === "uncertain";
					const followup = tools.followups.find((item) => item.outboundId === message.id);
					return (
						<div key={message.id} data-personal-outbound-status={message.status} role={danger ? "alert" : "status"} style={{ margin: "10px 10px 0", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 10px", background: danger ? "var(--danger-soft)" : message.status === "accepted" ? "var(--success-soft)" : "var(--panel-2)", color: danger ? "var(--danger-ink)" : "var(--ink-2)", fontSize: 10.5, lineHeight: 1.4 }}>
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								<div style={{ flex: 1, minWidth: 0 }}>
									<strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.subject || "(bez předmětu)"}</strong>
									<span>{outboundLabel(message.status, accountById.get(message.accountId)?.provider)}{scheduled && message.status === "queued" ? ` · ${formatDate(message.scheduledFor)}` : ""}</span>
								</div>
								{message.canCancel && (
									<button type="button" onClick={() => void model.cancelOutbound(message).catch(() => undefined)} disabled={model.cancellingOutboundId !== null} style={{ minHeight: 40, border: "1px solid currentColor", borderRadius: 8, background: "transparent", color: "inherit", padding: "0 10px", fontWeight: 750, cursor: "pointer" }}>
										{model.cancellingOutboundId === message.id ? "Vracím…" : scheduled ? "Zrušit plán" : "Vrátit odeslání"}
									</button>
								)}
								{message.status === "accepted" && !followup && <button type="button" onClick={() => {
									setFollowupFor((value) => value === message.id ? null : message.id);
									setFollowupAt(localDateTime(new Date(Date.now() + 3 * 86_400_000)));
								}} style={{ minHeight: 40, border: "1px solid currentColor", borderRadius: 8, background: "transparent", color: "inherit", padding: "0 10px", fontWeight: 700, cursor: "pointer" }}>Pohlídat odpověď</button>}
								{followup && <span style={{ fontSize: 9, whiteSpace: "nowrap" }}>{followup.status === "waiting" ? `Follow-up ${formatDate(followup.dueAt)}` : followup.status === "replied" ? "✓ Odpovězeno" : "Follow-up uzavřen"}</span>}
							</div>
							{followupFor === message.id && <form onSubmit={(event) => {
								event.preventDefault();
								if (!followupAt) return;
								void tools.scheduleFollowup(message.accountId, message.id, new Date(followupAt).toISOString()).then(() => setFollowupFor(null));
							}} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 7, marginTop: 8 }}><label style={{ display: "grid", gap: 3, fontSize: 9 }}>Pokud nikdo neodpoví do<input type="datetime-local" min={localDateTime(new Date(Date.now() + 60_000))} value={followupAt} onChange={(event) => setFollowupAt(event.target.value)} style={{ minHeight: 40, border: "1px solid var(--line)", borderRadius: 8, background: "var(--panel)", color: "var(--ink)", padding: "0 8px" }} /></label><button type="submit" style={{ alignSelf: "end", minHeight: 40, border: 0, borderRadius: 8, background: "var(--ink)", color: "var(--panel)", padding: "0 10px", fontWeight: 700, cursor: "pointer" }}>Nastavit</button></form>}
						</div>
					);
				})}
				<div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
					{query.trim() && <div role="status" style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)", fontSize: 9.5, color: "var(--ink-3)" }}>{tools.searching ? "Prohledávám šifrovanou poštu…" : `${displayedMessages.length} výsledků z ${tools.searchMeta.searchedCount} zkontrolovaných zpráv${tools.searchMeta.truncated ? " · starší korpus je omezen bezpečnostním limitem" : ""}`}</div>}
					{model.loadingMessages && !query.trim() ? (
						<div aria-live="polite" style={{ padding: 18, fontSize: 12, color: "var(--ink-3)" }}>Načítám šifrovanou poštu…</div>
					) : displayedMessages.length === 0 ? (
						<div style={{ padding: 22, textAlign: "center", fontSize: 12, color: "var(--ink-3)" }}>
							<strong style={{ display: "block", color: "var(--ink-2)", marginBottom: 5 }}>{query.trim() ? "Žádná zpráva neodpovídá" : "Zatím žádné synchronizované zprávy"}</strong>
							{query.trim() ? "Zkus ubrat operátor nebo hledaný výraz." : "První synchronizace může chvíli trvat. Tlačítkem ↻ ji můžeš zkontrolovat."}
						</div>
					) : displayedMessages.map((message) => (
						<MessageRow
							key={`${message.accountId}:${message.id}`}
							message={message}
							accountLabel={accountById.get(message.accountId)?.emailAddress ?? "Osobní účet"}
							selected={selectedKey === `${message.accountId}:${message.id}`}
							execution={model.executionFor(message)}
							labelNames={query.trim() ? (tools.searchHits.find((hit) => hit.id === message.id && hit.accountId === message.accountId)?.labelNames ?? labelNamesFor(message)) : labelNamesFor(message)}
							onOpen={() => void model.openMessage(message)}
						/>
					))}
					{!query.trim() && model.hasMore && <div style={{ padding: 12, textAlign: "center" }}><button type="button" onClick={() => void model.loadMore()} disabled={model.loadingMore} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 14px", cursor: "pointer" }}>{model.loadingMore ? "Načítám…" : "Načíst starší"}</button></div>}
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
						<div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
							<button type="button" disabled={selectedAccount?.status !== "connected" || !emailAddress(model.detail.replyTo || model.detail.from)} onClick={() => { setComposerReply(model.detail); setComposerOpen(true); }} style={{ minHeight: 40, border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", padding: "0 13px", cursor: "pointer", fontWeight: 750 }}>Odpovědět</button>
							<button type="button" disabled={personLoading || !emailAddress(model.detail.from)} onClick={() => {
								const address = emailAddress(model.detail?.from ?? "");
								if (!address) return;
								setPersonLoading(true);
								void tools.lookupPerson(address).then(setPerson).finally(() => setPersonLoading(false));
							}} style={{ minHeight: 40, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 11px", cursor: "pointer", fontWeight: 650 }}>{personLoading ? "Načítám…" : "Osoba a firma"}</button>
							{labelNamesFor(model.detail).filter((name) => !["INBOX", "UNREAD", "Doručená pošta", "Nepřečtené"].includes(name)).map((name) => <button type="button" key={name} onClick={() => { setQuery(`label:"${name.replaceAll('"', "")}"`); model.closeMessage(); }} style={{ minHeight: 32, border: "1px solid var(--line)", borderRadius: 999, background: "var(--panel-2)", color: "var(--ink-3)", padding: "0 9px", fontSize: 9.5, cursor: "pointer" }}>{name}</button>)}
						</div>
						{model.detail.security.level !== "verified" && (
							<div role={model.detail.security.level === "danger" ? "alert" : "status"} style={{ marginTop: 14, border: "1px solid currentColor", borderRadius: 11, padding: "10px 12px", background: model.detail.security.level === "danger" ? "var(--danger-soft)" : model.detail.security.level === "warning" ? "var(--w-brass-soft)" : "var(--panel-2)", color: model.detail.security.level === "danger" ? "var(--danger-ink)" : "var(--ink-2)", fontSize: 10.5, lineHeight: 1.5 }}>
								<strong>{model.detail.security.level === "danger" ? "Pozor na identitu odesílatele" : model.detail.security.level === "warning" ? "Zkontroluj adresu před odpovědí" : "Ověření identity není k dispozici"}</strong>
								{model.detail.security.reasons.length > 0 && <ul style={{ margin: "5px 0 0", paddingLeft: 18 }}>{model.detail.security.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
								<div style={{ marginTop: 5, color: "var(--ink-3)" }}>SPF {model.detail.security.authentication.spf} · DKIM {model.detail.security.authentication.dkim} · DMARC {model.detail.security.authentication.dmarc}. Toto hodnocení není záruka bezpečnosti.</div>
							</div>
						)}
						{model.detail.security.level === "verified" && <div role="status" style={{ marginTop: 12, fontSize: 10, color: "var(--success-ink)" }}>✓ Provider ověřil identitu domény (SPF/DKIM/DMARC). Stále zkontroluj obsah a požadovanou akci.</div>}
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
			{person && <div data-esc-layer style={{ position: "fixed", inset: 0, zIndex: 130, display: "grid", placeItems: "center", padding: 12 }}>
				<button type="button" aria-label="Zavřít kartu osoby" onClick={() => setPerson(null)} style={{ position: "absolute", inset: 0, border: 0, background: "color-mix(in srgb, var(--ink) 35%, transparent)" }} />
				<div ref={personDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="personal-mail-person-title" style={{ position: "relative", width: "min(480px, 100%)", maxHeight: "calc(100vh - 24px)", overflow: "auto", border: "1px solid var(--line)", borderRadius: 16, background: "var(--panel)", boxShadow: "var(--shadow)", padding: 18, outline: "none" }}>
					<div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}><div aria-hidden style={{ width: 46, height: 46, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--avatar-navy)", color: "white", fontWeight: 800 }}>{initials(person.name)}</div><div style={{ minWidth: 0, flex: 1 }}><h2 id="personal-mail-person-title" style={{ margin: 0, color: "var(--ink)", fontSize: 18 }}>{person.name}</h2><div style={{ marginTop: 4, color: "var(--ink-3)", fontSize: 11, overflowWrap: "anywhere" }}>{person.address}</div></div><button type="button" onClick={() => setPerson(null)} aria-label="Zavřít" style={{ width: 44, height: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}>×</button></div>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 9, marginTop: 16 }}>{[
						["Firma", person.organization ?? person.domain], ["Role", person.role ?? "—"], ["Zprávy v synchronizaci", person.messages.toLocaleString("cs-CZ")], ["Poslední kontakt", person.lastContactAt ? formatDate(person.lastContactAt) : "—"],
					].map(([label, value]) => <div key={label} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, background: "var(--panel-2)" }}><span style={{ display: "block", color: "var(--ink-3)", fontSize: 9 }}>{label}</span><strong style={{ display: "block", marginTop: 4, color: "var(--ink-2)", fontSize: 11, overflowWrap: "anywhere" }}>{value}</strong></div>)}</div>
					{person.areas && <div style={{ marginTop: 12, fontSize: 11, color: "var(--ink-2)" }}><strong>Oblasti:</strong> {person.areas}</div>}
					{person.note && <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5, color: "var(--ink-2)" }}>{person.note}</div>}
					<div style={{ marginTop: 14, fontSize: 9.5, lineHeight: 1.45, color: "var(--ink-3)" }}>Karta kombinuje vlastní kontakt s tvou soukromou synchronizovanou historií. Není automaticky sdílena s týmem.</div>
				</div>
			</div>}
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
			{composerOpen && <PersonalMailComposer model={model} replyTo={composerReply} prefill={composerPrefill} onClose={() => { setComposerOpen(false); setComposerReply(null); setComposerPrefill(null); }} />}
			<SharedDraftsDialog open={sharedDraftsOpen} accounts={model.accounts} onClose={() => setSharedDraftsOpen(false)} />
		</section>
	);
}
