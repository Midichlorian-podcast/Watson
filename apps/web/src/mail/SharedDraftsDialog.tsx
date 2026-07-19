import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { useOverlayLayer } from "../lib/useOverlayLayer";
import type { PersonalMailAccount } from "./usePersonalMail";
import { type SharedDraft, type SharedDraftContent, useSharedDrafts } from "./useSharedDrafts";

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const statusLabels: Record<SharedDraft["status"], string> = {
	draft: "Rozpracováno",
	pending_approval: "Čeká na schválení",
	approved: "Schváleno",
	rejected: "Vráceno k úpravě",
	queued: "Zařazeno k odeslání",
	cancelled: "Zrušeno",
};
const errorLabels: Record<string, string> = {
	mail_shared_draft_conflict: "Koncept mezitím změnil někdo jiný. Stav jsme obnovili; zkontroluj novou verzi.",
	mail_shared_draft_content_locked: "Tato verze je ve schvalování nebo schválená a nelze ji potichu změnit.",
	mail_shared_draft_member_invalid: "Vybraný člověk už není členem týmového prostoru.",
	mail_shared_workspace_forbidden: "K týmovému prostoru už nemáš přístup.",
	mail_account_inactive: "Odesílací účet není aktivní.",
};

function fieldStyle(): CSSProperties {
	return { width: "100%", boxSizing: "border-box", minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "var(--panel)", color: "var(--ink)", padding: "9px 10px", font: "inherit" };
}

function splitAddresses(value: string) {
	return [...new Set(value.split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function initials(value: string) {
	return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

export function SharedDraftsDialog({
	open,
	accounts,
	onClose,
}: {
	open: boolean;
	accounts: PersonalMailAccount[];
	onClose: () => void;
}) {
	const model = useSharedDrafts(open);
	const [newMode, setNewMode] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [workspaceId, setWorkspaceId] = useState("");
	const [accountId, setAccountId] = useState("");
	const [to, setTo] = useState("");
	const [cc, setCc] = useState("");
	const [bcc, setBcc] = useState("");
	const [subject, setSubject] = useState("");
	const [textBody, setTextBody] = useState("");
	const [approverId, setApproverId] = useState("");
	const [editorIds, setEditorIds] = useState<string[]>([]);
	const [localError, setLocalError] = useState<string | null>(null);
	const trapRef = useOverlayLayer<HTMLDivElement>(open, onClose);
	const selected = model.drafts.find((draft) => draft.id === selectedId) ?? null;
	const workspace = model.options.workspaces.find((item) => item.id === workspaceId) ?? model.options.workspaces[0] ?? null;
	const connectedAccounts = accounts.filter((account) => account.status === "connected");

	useEffect(() => {
		if (!open) return;
		setWorkspaceId((current) => current || model.options.workspaces[0]?.id || "");
		setAccountId((current) => current || connectedAccounts[0]?.id || "");
	}, [open, model.options.workspaces, connectedAccounts]);

	useEffect(() => {
		if (!selected?.content) return;
		setTo(selected.content.to.join(", "));
		setCc(selected.content.cc.join(", "));
		setBcc(selected.content.bcc.join(", "));
		setSubject(selected.content.subject);
		setTextBody(selected.content.textBody);
		setLocalError(null);
	}, [selected]);

	useEffect(() => {
		if (!selectedId || model.drafts.some((draft) => draft.id === selectedId)) return;
		setSelectedId(null);
	}, [model.drafts, selectedId]);

	const resetNew = () => {
		setNewMode(true);
		setSelectedId(null);
		setTo(""); setCc(""); setBcc(""); setSubject(""); setTextBody("");
		setApproverId(""); setEditorIds([]); setLocalError(null);
	};

	const content = (): SharedDraftContent | null => {
		const parsed = { to: splitAddresses(to), cc: splitAddresses(cc), bcc: splitAddresses(bcc), subject: subject.trim(), textBody };
		const invalid = [...parsed.to, ...parsed.cc, ...parsed.bcc].find((address) => !ADDRESS.test(address));
		if (parsed.to.length === 0) { setLocalError("Doplň alespoň jednoho příjemce."); return null; }
		if (invalid) { setLocalError(`Adresa „${invalid}“ není platná.`); return null; }
		if (!parsed.subject && !parsed.textBody.trim()) { setLocalError("Napiš předmět nebo text zprávy."); return null; }
		return parsed;
	};

	const createDraft = async (event: FormEvent) => {
		event.preventDefault();
		const draftContent = content();
		if (!draftContent) return;
		if (!workspaceId || !accountId) return setLocalError("Vyber týmový prostor a odesílací účet.");
		if (!approverId) return setLocalError("Vyber člověka, který odpověď schválí.");
		try {
			const draft = await model.create({
				id: crypto.randomUUID(), workspaceId, accountId, content: draftContent,
				editors: editorIds.filter((id) => id !== approverId), approvers: [approverId], requiredApprovals: 1,
			});
			setNewMode(false);
			setSelectedId(draft.id);
		} catch { await model.refresh(); }
	};

	const save = async () => {
		if (!selected) return;
		const draftContent = content();
		if (!draftContent) return;
		try { await model.update(selected, draftContent); } catch { await model.refresh(); }
	};

	if (!open) return null;
	const canEdit = selected && ["owner", "editor"].includes(selected.viewerRole) && ["draft", "rejected"].includes(selected.status);
	const error = localError ?? (model.error ? (errorLabels[model.error] ?? "Operaci se nepodařilo dokončit. Koncept zůstal beze změny.") : null);

	return (
		<div data-esc-layer style={{ position: "fixed", inset: 0, zIndex: 140, display: "grid", placeItems: "center", padding: 12 }}>
			<button type="button" aria-label="Zavřít sdílené koncepty" onClick={onClose} style={{ position: "absolute", inset: 0, border: 0, background: "color-mix(in srgb, var(--ink) 38%, transparent)" }} />
			<div ref={trapRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="shared-drafts-title" style={{ position: "relative", width: "min(1080px, 100%)", height: "min(760px, calc(100vh - 24px))", overflow: "hidden", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", border: "1px solid var(--line)", borderRadius: 16, background: "var(--panel)", boxShadow: "var(--shadow)" }}>
				<header style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: "1px solid var(--line)" }}>
					<div style={{ minWidth: 0, flex: 1 }}><h2 id="shared-drafts-title" style={{ margin: 0, color: "var(--ink)", fontSize: 17 }}>Sdílené koncepty a schválení</h2><p style={{ margin: "4px 0 0", color: "var(--ink-3)", fontSize: 10.5 }}>Sdílí se jen tento koncept. Soukromá schránka ani ostatní zprávy se kolegům nezpřístupní.</p></div>
					<button type="button" onClick={resetNew} disabled={model.options.workspaces.length === 0 || connectedAccounts.length === 0} style={{ minHeight: 44, border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", padding: "0 13px", fontWeight: 700, cursor: "pointer" }}>Nový koncept</button>
					<button type="button" onClick={onClose} aria-label="Zavřít" style={{ width: 44, height: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}>×</button>
				</header>
				<div data-shared-draft-layout style={{ minHeight: 0, display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)" }}>
					<aside data-shared-draft-list aria-label="Seznam sdílených konceptů" style={{ minHeight: 0, overflow: "auto", borderRight: "1px solid var(--line)", background: "var(--panel-2)" }}>
						{model.loading ? <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 11 }}>Načítám koncepty…</div> : model.drafts.length === 0 ? <div style={{ padding: 18, color: "var(--ink-3)", fontSize: 11, lineHeight: 1.5 }}><strong style={{ display: "block", color: "var(--ink-2)", marginBottom: 4 }}>Žádný sdílený koncept</strong>Vytvoř první návrh a urči, kdo ho smí upravit a kdo ho schválí.</div> : model.drafts.map((draft) => <button key={draft.id} type="button" onClick={() => { setNewMode(false); setSelectedId(draft.id); }} data-selected={draft.id === selectedId || undefined} style={{ width: "100%", border: 0, borderBottom: "1px solid var(--line)", background: draft.id === selectedId ? "var(--accent-soft)" : "transparent", color: "inherit", padding: 13, textAlign: "left", cursor: "pointer" }}><span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ width: 30, height: 30, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--avatar-navy)", color: "white", fontSize: 9, fontWeight: 800 }}>{initials(draft.content?.subject || "Koncept")}</span><span style={{ minWidth: 0, flex: 1 }}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink)", fontSize: 11.5 }}>{draft.content?.subject || "(obsah nedostupný)"}</strong><span style={{ display: "block", marginTop: 3, color: draft.status === "rejected" ? "var(--danger-ink)" : draft.status === "approved" ? "var(--success-ink)" : "var(--ink-3)", fontSize: 9.5 }}>{statusLabels[draft.status]} · {draft.viewerRole === "owner" ? "vlastník" : draft.viewerRole}</span></span></span></button>)}
					</aside>
					<main data-shared-draft-main aria-label="Obsah sdíleného konceptu" style={{ minHeight: 0, overflow: "auto", padding: "16px clamp(14px, 3vw, 28px)" }}>
						{model.options.workspaces.length === 0 ? <div style={{ maxWidth: 560, margin: "40px auto", textAlign: "center", color: "var(--ink-3)", fontSize: 12, lineHeight: 1.6 }}><strong style={{ display: "block", color: "var(--ink)", fontSize: 17, marginBottom: 7 }}>Nejdřív potřebuješ týmový prostor</strong>Sdílené schválení se nikdy nevytváří v osobním prostoru. Připoj se k týmu nebo týmový prostor založ.</div> : newMode ? (
							<form onSubmit={(event) => void createDraft(event)} style={{ maxWidth: 760, display: "grid", gap: 12 }}>
								<h3 style={{ margin: 0, color: "var(--ink)", fontSize: 16 }}>Nový sdílený koncept</h3>
								<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
									<label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Týmový prostor<select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setApproverId(""); setEditorIds([]); }} style={fieldStyle()}>{model.options.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
									<label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Odeslat z<select value={accountId} onChange={(event) => setAccountId(event.target.value)} style={fieldStyle()}>{connectedAccounts.map((account) => <option key={account.id} value={account.id}>{account.emailAddress}</option>)}</select></label>
								</div>
								<label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Komu<input value={to} onChange={(event) => setTo(event.target.value)} inputMode="email" style={fieldStyle()} /></label>
								<details><summary style={{ minHeight: 36, display: "flex", alignItems: "center", color: "var(--brass-text)", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>Kopie a skrytá kopie</summary><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}><label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Kopie<input value={cc} onChange={(event) => setCc(event.target.value)} style={fieldStyle()} /></label><label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Skrytá kopie<input value={bcc} onChange={(event) => setBcc(event.target.value)} style={fieldStyle()} /></label></div></details>
								<label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Předmět<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={998} style={fieldStyle()} /></label>
								<label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Text<textarea value={textBody} onChange={(event) => setTextBody(event.target.value)} rows={8} maxLength={512 * 1024} style={{ ...fieldStyle(), resize: "vertical", lineHeight: 1.55 }} /></label>
								<fieldset style={{ border: "1px solid var(--line)", borderRadius: 11, padding: 12 }}><legend style={{ padding: "0 6px", color: "var(--ink-2)", fontSize: 11, fontWeight: 700 }}>Kdo schválí?</legend><div style={{ display: "grid", gap: 7 }}>{workspace?.members.map((member) => <label key={member.userId} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 36, fontSize: 11, color: "var(--ink-2)" }}><input type="radio" name="draft-approver" checked={approverId === member.userId} onChange={() => { setApproverId(member.userId); setEditorIds((current) => current.filter((id) => id !== member.userId)); }} />{member.name} <span style={{ color: "var(--ink-3)" }}>· {member.email}</span></label>)}</div></fieldset>
								<fieldset style={{ border: "1px solid var(--line)", borderRadius: 11, padding: 12 }}><legend style={{ padding: "0 6px", color: "var(--ink-2)", fontSize: 11, fontWeight: 700 }}>Kdo může upravovat? <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>volitelné</span></legend><div style={{ display: "grid", gap: 7 }}>{workspace?.members.filter((member) => member.userId !== approverId).map((member) => <label key={member.userId} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 36, fontSize: 11, color: "var(--ink-2)" }}><input type="checkbox" checked={editorIds.includes(member.userId)} onChange={(event) => setEditorIds((current) => event.target.checked ? [...current, member.userId] : current.filter((id) => id !== member.userId))} />{member.name}</label>)}</div></fieldset>
								{error && <div role="alert" style={{ padding: "9px 11px", borderRadius: 9, background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 11 }}>{error}</div>}
								<div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" onClick={() => setNewMode(false)} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 13px", cursor: "pointer" }}>Zrušit</button><button type="submit" disabled={model.busy} style={{ minHeight: 44, border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", padding: "0 15px", fontWeight: 700, cursor: "pointer" }}>{model.busy ? "Vytvářím…" : "Vytvořit koncept"}</button></div>
							</form>
						) : selected ? <DraftEditor draft={selected} to={to} cc={cc} bcc={bcc} subject={subject} textBody={textBody} setTo={setTo} setCc={setCc} setBcc={setBcc} setSubject={setSubject} setTextBody={setTextBody} canEdit={Boolean(canEdit)} busy={model.busy} error={error} onSave={() => void save()} onSubmit={() => void model.submit(selected).catch(() => model.refresh())} onDecide={(decision) => void model.decide(selected, decision).catch(() => model.refresh())} onCancel={() => void model.cancel(selected).catch(() => model.refresh())} onSend={() => void model.send(selected).catch(() => model.refresh())} /> : <div style={{ minHeight: "100%", display: "grid", placeItems: "center", textAlign: "center", color: "var(--ink-3)", fontSize: 11 }}><div><div aria-hidden style={{ fontSize: 30, marginBottom: 8 }}>✎</div>Vyber koncept nebo vytvoř nový.</div></div>}
					</main>
				</div>
			</div>
		</div>
	);
}

function DraftEditor(props: {
	draft: SharedDraft; to: string; cc: string; bcc: string; subject: string; textBody: string;
	setTo: (value: string) => void; setCc: (value: string) => void; setBcc: (value: string) => void;
	setSubject: (value: string) => void; setTextBody: (value: string) => void;
	canEdit: boolean; busy: boolean; error: string | null;
	onSave: () => void; onSubmit: () => void; onDecide: (decision: "approved" | "rejected") => void; onCancel: () => void; onSend: () => void;
}) {
	const { draft } = props;
	const [confirmCancel, setConfirmCancel] = useState(false);
	const approved = draft.approvals.filter((approval) => approval.status === "approved").length;
	return <section style={{ maxWidth: 780, display: "grid", gap: 12 }}>
		<div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}><div style={{ flex: 1, minWidth: 220 }}><span style={{ display: "inline-block", borderRadius: 999, padding: "4px 8px", background: draft.status === "approved" ? "var(--success-soft)" : draft.status === "rejected" ? "var(--danger-soft)" : "var(--accent-soft)", color: draft.status === "approved" ? "var(--success-ink)" : draft.status === "rejected" ? "var(--danger-ink)" : "var(--ink-2)", fontSize: 9.5, fontWeight: 700 }}>{statusLabels[draft.status]}</span><h3 style={{ margin: "8px 0 0", color: "var(--ink)", fontSize: 18 }}>{draft.content?.subject || "(obsah nedostupný)"}</h3><div style={{ marginTop: 4, color: "var(--ink-3)", fontSize: 9.5 }}>Verze obsahu {draft.contentVersion} · {draft.viewerRole === "owner" ? "jsi vlastník odesílacího účtu" : draft.viewerRole === "editor" ? "můžeš upravovat" : "můžeš schválit"}</div></div><div style={{ color: "var(--ink-3)", fontSize: 10 }}>{approved}/{draft.requiredApprovals} schválení</div></div>
		{draft.contentUnavailable ? <div role="alert" style={{ padding: 12, borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 11 }}>Obsah nelze bezpečně dešifrovat. Koncept nelze schválit ani odeslat.</div> : <>
			<label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Komu<input value={props.to} onChange={(event) => props.setTo(event.target.value)} disabled={!props.canEdit} style={fieldStyle()} /></label>
			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}><label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Kopie<input value={props.cc} onChange={(event) => props.setCc(event.target.value)} disabled={!props.canEdit} style={fieldStyle()} /></label><label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Skrytá kopie<input value={props.bcc} onChange={(event) => props.setBcc(event.target.value)} disabled={!props.canEdit} style={fieldStyle()} /></label></div>
			<label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Předmět<input value={props.subject} onChange={(event) => props.setSubject(event.target.value)} disabled={!props.canEdit} style={fieldStyle()} /></label>
			<label style={{ display: "grid", gap: 4, color: "var(--ink-3)", fontSize: 10 }}>Text<textarea value={props.textBody} onChange={(event) => props.setTextBody(event.target.value)} disabled={!props.canEdit} rows={10} style={{ ...fieldStyle(), resize: "vertical", lineHeight: 1.55 }} /></label>
		</>}
		<section aria-label="Schválení" style={{ border: "1px solid var(--line)", borderRadius: 11, padding: 12 }}><strong style={{ display: "block", color: "var(--ink-2)", fontSize: 11 }}>Revize a schválení</strong><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{draft.approvals.map((approval) => <div key={approval.approverUserId} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10.5, color: "var(--ink-2)" }}><span aria-hidden style={{ width: 26, height: 26, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--avatar-navy)", color: "white", fontSize: 8 }}>{initials(approval.name)}</span><span style={{ flex: 1 }}>{approval.name}</span><strong style={{ color: approval.status === "approved" ? "var(--success-ink)" : approval.status === "rejected" ? "var(--danger-ink)" : "var(--ink-3)", fontSize: 9.5 }}>{approval.status === "approved" ? `Schváleno · v${approval.decidedContentVersion}` : approval.status === "rejected" ? "Vráceno" : "Čeká"}</strong></div>)}</div></section>
		{draft.status === "rejected" && <div role="status" style={{ padding: 10, borderRadius: 9, background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 10.5 }}>Schvalovatel verzi vrátil. Po úpravě se všechna předchozí rozhodnutí vynulují a vznikne nová content version.</div>}
		{draft.status === "queued" && <div role="status" style={{ padding: 10, borderRadius: 9, background: "var(--success-soft)", color: "var(--success-ink)", fontSize: 10.5 }}>Schválená verze je ve skutečné odchozí frontě · {draft.outboundStatus ?? "stav se načítá"}. V osobní poště ji lze během Undo okna vrátit.</div>}
		{props.error && <div role="alert" style={{ padding: 9, borderRadius: 9, background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 10.5 }}>{props.error}</div>}
		<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
			{draft.content && <button type="button" onClick={() => void navigator.clipboard?.writeText(draft.content?.textBody ?? "").catch(() => undefined)} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 13px", cursor: "pointer" }}>Kopírovat text</button>}
			{draft.viewerRole === "owner" && !["queued", "cancelled"].includes(draft.status) && <button type="button" onClick={() => { if (confirmCancel) props.onCancel(); else setConfirmCancel(true); }} disabled={props.busy} style={{ minHeight: 44, border: "1px solid var(--danger-ink)", borderRadius: 9, background: confirmCancel ? "var(--danger-soft)" : "transparent", color: "var(--danger-ink)", padding: "0 13px", cursor: "pointer" }}>{confirmCancel ? "Opravdu zrušit" : "Zrušit koncept"}</button>}
			{props.canEdit && <button type="button" onClick={props.onSave} disabled={props.busy} style={{ minHeight: 44, border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", padding: "0 13px", cursor: "pointer" }}>Uložit změny</button>}
			{props.canEdit && draft.status === "draft" && <button type="button" onClick={props.onSubmit} disabled={props.busy} style={{ minHeight: 44, border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", padding: "0 14px", fontWeight: 700, cursor: "pointer" }}>Odeslat ke schválení</button>}
			{draft.viewerRole === "approver" && draft.status === "pending_approval" && draft.viewerApproval?.status === "pending" && <><button type="button" onClick={() => props.onDecide("rejected")} disabled={props.busy} style={{ minHeight: 44, border: "1px solid var(--danger-ink)", borderRadius: 9, background: "transparent", color: "var(--danger-ink)", padding: "0 13px", cursor: "pointer" }}>Vrátit k úpravě</button><button type="button" onClick={() => props.onDecide("approved")} disabled={props.busy} style={{ minHeight: 44, border: 0, borderRadius: 9, background: "var(--success-ink)", color: "white", padding: "0 14px", fontWeight: 700, cursor: "pointer" }}>Schválit verzi {draft.contentVersion}</button></>}
			{draft.viewerRole === "owner" && draft.status === "approved" && <button type="button" onClick={props.onSend} disabled={props.busy} style={{ minHeight: 44, border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", padding: "0 15px", fontWeight: 700, cursor: "pointer" }}>Odeslat schválenou verzi</button>}
		</div>
	</section>;
}
