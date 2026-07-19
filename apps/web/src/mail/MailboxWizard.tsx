/**
 * F5 Mail M1 — pravdivá správa osobních mailbox účtů.
 *
 * Google používá serverový OAuth/PKCE flow. Obecné schránky se připojí přes
 * ověřený IMAP/SMTP pár; credential i zprávy jsou ve vaultu šifrované.
 */
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import { showToast } from "../lib/toast";
import { useOverlayLayer } from "../lib/useOverlayLayer";

type MailAccount = {
	id: string;
	provider: "google" | "imap_smtp";
	emailAddress: string;
	displayName: string | null;
	status: "connected" | "syncing" | "degraded" | "reauth_required" | "revoked";
	grantedScopes: string[];
	capabilities: string[];
	lastSuccessAt: string | null;
	lastErrorCode: string | null;
	revokedAt: string | null;
	version: number;
};

type AccountsResponse = { accounts: MailAccount[]; googleAvailable: boolean };

const providerCards = [
	{
		id: "google",
		name: "Gmail / Google Workspace",
		description: "Osobní účet přes Google OAuth. Heslo Watson nikdy nevidí.",
		available: true,
	},
	{
		id: "m365",
		name: "Microsoft 365",
		description: "Provider adapter bude následovat po dokončení osobního Gmailu.",
		available: false,
	},
	{
		id: "imap",
		name: "IMAP + SMTP",
		description: "Obecná schránka. Watson před uložením ověří příjem i odesílání a heslo zašifruje.",
		available: true,
	},
] as const;

const errorCopy: Record<string, string> = {
	mail_google_not_configured: "Google připojení zatím není na serveru nakonfigurované.",
	mail_accounts_unavailable: "Bezpečný stav účtů se nepodařilo načíst. Zavři okno a zkus to znovu.",
	mail_authorization_url_rejected: "Server vrátil nedůvěryhodnou autorizační adresu. Připojení bylo zastaveno.",
	mail_connection_failed: "Připojení nebylo dokončeno a žádný nový credential se neuložil.",
	mail_provider_timeout: "Poštovní server neodpověděl včas. Zkus to znovu za chvíli.",
	mail_provider_unavailable: "Poštovní server je teď nedostupný. Účet se nezměnil.",
	mail_revoke_failed: "Odpojení se nepodařilo bezpečně dokončit. Credential zůstal uložený; zkus to znovu.",
	invalid_imap_smtp_account: "Zkontroluj adresy serverů, porty a přihlašovací údaje.",
	mail_endpoint_private: "Z bezpečnostních důvodů nelze připojit lokální ani interní poštovní server.",
	mail_endpoint_unresolved: "Adresu poštovního serveru se nepodařilo ověřit.",
	mail_credentials_invalid: "IMAP nebo SMTP odmítl přihlášení. Nic se neuložilo.",
	mail_connection_verification_failed: "Nepodařilo se bezpečně ověřit oba servery a jejich TLS nastavení. Nic se neuložilo.",
	mail_account_exists: "Tato schránka už je připojená.",
	personal_workspace_missing: "Chybí osobní pracovní prostor. Kontaktuj správce provozu.",
	mail_credentials_missing: "Účet nemá úplný credential. Nic se nezměnilo; kontaktuj správce provozu.",
	mail_account_already_revoked: "Účet už byl odpojený. Stav jsme znovu načetli.",
	stale_version: "Účet se mezitím změnil. Stav jsme znovu načetli; operaci případně zopakuj.",
	operation_id_reused: "Tento bezpečnostní příkaz už byl použit pro jinou operaci. Zkus akci znovu.",
	unauthorized: "Přihlášení vypršelo. Obnov stránku a přihlas se znovu.",
};

type ImapSecurity = "tls" | "starttls";
type ImapForm = {
	displayName: string;
	emailAddress: string;
	username: string;
	password: string;
	imapHost: string;
	imapPort: string;
	imapSecurity: ImapSecurity;
	smtpHost: string;
	smtpPort: string;
	smtpSecurity: ImapSecurity;
};

const emptyImapForm = (): ImapForm => ({
	displayName: "", emailAddress: "", username: "", password: "",
	imapHost: "", imapPort: "993", imapSecurity: "tls",
	smtpHost: "", smtpPort: "587", smtpSecurity: "starttls",
});

const accountStatus: Record<MailAccount["status"], { label: string; tone: string }> = {
	connected: { label: "Účet připravený", tone: "var(--success-ink)" },
	syncing: { label: "Probíhá kontrola", tone: "var(--ink-2)" },
	degraded: { label: "Vyžaduje pozornost", tone: "var(--danger-ink)" },
	reauth_required: { label: "Obnovit souhlas", tone: "var(--danger-ink)" },
	revoked: { label: "Odpojený", tone: "var(--ink-3)" },
};

async function readAccounts(): Promise<AccountsResponse> {
	const response = await fetch(`${API_URL}/api/mail/accounts`, { credentials: "include" });
	if (!response.ok) throw new Error(response.status === 401 ? "unauthorized" : "mail_accounts_unavailable");
	return (await response.json()) as AccountsResponse;
}

function trustedAuthorizationUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		if (url.origin === "https://accounts.google.com") return url.toString();
		if (import.meta.env.DEV && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) {
			return url.toString();
		}
		return null;
	} catch {
		return null;
	}
}

export function MailboxWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [accounts, setAccounts] = useState<MailAccount[]>([]);
	const [googleAvailable, setGoogleAvailable] = useState(false);
	const [loading, setLoading] = useState(false);
	const [connecting, setConnecting] = useState(false);
	const [imapOpen, setImapOpen] = useState(false);
	const [imapForm, setImapForm] = useState<ImapForm>(emptyImapForm);
	const [error, setError] = useState<string | null>(null);
	const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
	const [revoking, setRevoking] = useState<string | null>(null);
	const trapRef = useOverlayLayer<HTMLDivElement>(open, onClose);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await readAccounts();
			setAccounts(result.accounts);
			setGoogleAvailable(result.googleAvailable);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_accounts_unavailable");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!open) {
			setImapOpen(false);
			setImapForm(emptyImapForm());
			return;
		}
		setConfirmRevoke(null);
		void load();
	}, [open, load]);

	if (!open) return null;

	const connectGoogle = async () => {
		if (!googleAvailable || connecting) return;
		setConnecting(true);
		setError(null);
		try {
			const response = await fetch(`${API_URL}/api/mail/oauth/google/start`, {
				method: "POST",
				credentials: "include",
			});
			const body = (await response.json().catch(() => ({}))) as { authorizationUrl?: unknown; error?: string };
			if (!response.ok) throw new Error(body.error ?? "mail_connection_failed");
			const authorizationUrl = trustedAuthorizationUrl(body.authorizationUrl);
			if (!authorizationUrl) throw new Error("mail_authorization_url_rejected");
			window.location.assign(authorizationUrl);
		} catch (cause) {
			const code = cause instanceof Error ? cause.message : "mail_connection_failed";
			setError(code);
			setConnecting(false);
		}
	};

	const connectImap = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (connecting) return;
		setConnecting(true);
		setError(null);
		try {
			const response = await fetch(`${API_URL}/api/mail/accounts/imap-smtp`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					displayName: imapForm.displayName.trim() || null,
					emailAddress: imapForm.emailAddress.trim(),
					username: imapForm.username,
					password: imapForm.password,
					imap: { host: imapForm.imapHost.trim(), port: Number(imapForm.imapPort), security: imapForm.imapSecurity },
					smtp: { host: imapForm.smtpHost.trim(), port: Number(imapForm.smtpPort), security: imapForm.smtpSecurity },
				}),
			});
			const body = (await response.json().catch(() => ({}))) as { account?: MailAccount; error?: string };
			if (!response.ok || !body.account) throw new Error(body.error ?? "mail_connection_failed");
			const connected = body.account;
			setAccounts((current) => current.some((item) => item.id === connected.id)
				? current.map((item) => item.id === connected.id ? connected : item)
				: [...current, connected]);
			setImapForm(emptyImapForm());
			setImapOpen(false);
			showToast("Schránka je ověřená. Šifrovaná synchronizace IMAP a odesílání přes SMTP běží na pozadí.");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "mail_connection_failed");
		} finally {
			setConnecting(false);
		}
	};

	const revoke = async (account: MailAccount) => {
		setRevoking(account.id);
		setError(null);
		try {
			const response = await fetch(`${API_URL}/api/mail/accounts/${account.id}/revoke`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ operationId: crypto.randomUUID(), expectedVersion: account.version }),
			});
			const body = (await response.json().catch(() => ({}))) as { account?: MailAccount; error?: string };
			if (!response.ok || !body.account) throw new Error(body.error ?? "mail_revoke_failed");
			const updatedAccount = body.account;
			setAccounts((current) => current.map((item) => (item.id === account.id ? updatedAccount : item)));
			setConfirmRevoke(null);
			showToast("Účet je odpojený. Credential i synchronizovaný obsah byly bezpečně odstraněny.");
		} catch (cause) {
			const code = cause instanceof Error ? cause.message : "mail_revoke_failed";
			if (code === "stale_version" || code === "mail_account_already_revoked") await load();
			setError(code);
		} finally {
			setRevoking(null);
		}
	};

	const activeGoogle = accounts.some((account) => account.provider === "google" && account.status !== "revoked");
	const fieldStyle = { minHeight: 44, width: "100%", boxSizing: "border-box" as const, border: "1px solid var(--line)", borderRadius: 9, padding: "0 11px", background: "var(--panel)", color: "var(--ink)", font: "inherit" };
	const labelStyle = { display: "grid", gap: 5, fontSize: 11, color: "var(--ink-2)" };
	const errorMessage = error
		? (errorCopy[error] ?? "Operaci se nepodařilo bezpečně dokončit. Účet zůstal beze změny.")
		: null;

	return (
		<div data-esc-layer style={{ position: "fixed", inset: 0, zIndex: "var(--w-layer-nested)" }}>
			<button
				type="button"
				aria-label="Zavřít správu schránek"
				onClick={onClose}
				style={{ position: "absolute", inset: 0, border: 0, background: "rgba(23,40,63,.32)" }}
			/>
			<div
				ref={trapRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-labelledby="mailbox-manager-title"
				data-screen-label="Správa osobních schránek"
				style={{
					position: "fixed",
					top: "50%",
					left: "50%",
					transform: "translate(-50%, -50%)",
					zIndex: "calc(var(--w-layer-nested) + 1)",
					width: "min(560px, 94vw)",
					maxHeight: "88vh",
					overflow: "auto",
					background: "var(--panel)",
					border: "1px solid var(--line)",
					borderRadius: 16,
					boxShadow: "var(--shadow)",
					padding: "18px",
					outline: "none",
				}}
			>
				<div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
					<div style={{ minWidth: 0, flex: 1 }}>
						<h2 id="mailbox-manager-title" style={{ margin: 0, fontSize: 17, color: "var(--ink)" }}>
							Osobní e-mailové účty
						</h2>
						<p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--ink-3)" }}>
							Každý účet zůstává osobní. Credential i synchronizovaný obsah jsou šifrované a odesílání má desetisekundové Zpět.
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Zavřít"
						style={{ width: 44, height: 44, border: 0, background: "transparent", color: "var(--ink-3)", fontSize: 20, cursor: "pointer" }}
					>
						×
					</button>
				</div>

				{errorMessage && (
					<div role="alert" style={{ marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger-ink)", fontSize: 12 }}>
						{errorMessage}
					</div>
				)}

				<section aria-labelledby="connected-mailboxes" style={{ marginTop: 18 }}>
					<h3 id="connected-mailboxes" style={{ margin: "0 0 8px", fontSize: 12, color: "var(--ink-2)" }}>
						Účty ve Watsonu
					</h3>
					{loading ? (
						<div style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 12, color: "var(--ink-3)", fontSize: 12 }}>
							Načítám bezpečný stav účtů…
						</div>
					) : accounts.length === 0 ? (
						<div style={{ padding: 14, border: "1px dashed var(--line)", borderRadius: 12, color: "var(--ink-3)", fontSize: 12 }}>
							Zatím tu není žádný osobní účet.
						</div>
					) : (
						<div style={{ display: "grid", gap: 8 }}>
							{accounts.map((account) => {
								const status = accountStatus[account.status];
								const confirming = confirmRevoke === account.id;
								return (
									<div key={account.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12 }}>
										<div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
											<span aria-hidden style={{ width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 9, background: "var(--panel-2)", fontWeight: 800, color: "var(--ink)" }}>{account.provider === "google" ? "G" : "I"}</span>
											<div style={{ minWidth: 0, flex: 1 }}>
												<div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)", overflowWrap: "anywhere" }}>{account.emailAddress}</div>
												<div style={{ marginTop: 2, fontSize: 10.5, color: status.tone }}>{account.provider === "google" ? "Google OAuth" : "IMAP + SMTP"} · {status.label} · verze {account.version}</div>
											</div>
											{account.status !== "revoked" && !confirming && (
												<button type="button" onClick={() => setConfirmRevoke(account.id)} style={{ minHeight: 44, padding: "0 13px", border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}>
													Odpojit
												</button>
											)}
										</div>
										{confirming && (
											<div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--ink-2)" }}>
												Watson zneplatní přístup a fyzicky odstraní credential, sync cursor i stažený obsah. Tuto akci nelze vrátit.
												<div style={{ display: "flex", gap: 8, marginTop: 9 }}>
													<button type="button" onClick={() => setConfirmRevoke(null)} disabled={revoking === account.id} style={{ minHeight: 44, padding: "0 13px", border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}>Ponechat účet</button>
													<button type="button" onClick={() => void revoke(account)} disabled={revoking === account.id} style={{ minHeight: 44, padding: "0 13px", border: 0, borderRadius: 9, background: "var(--danger-ink)", color: "white", cursor: "pointer" }}>{revoking === account.id ? "Odpojuji…" : "Potvrdit odpojení"}</button>
												</div>
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</section>

				<section aria-labelledby="mailbox-providers" style={{ marginTop: 18 }}>
					<h3 id="mailbox-providers" style={{ margin: "0 0 8px", fontSize: 12, color: "var(--ink-2)" }}>
						Přidat nebo obnovit účet
					</h3>
					<div style={{ display: "grid", gap: 8 }}>
						{providerCards.map((provider) => {
							const enabled = provider.id === "imap" || (provider.id === "google" && googleAvailable);
							return (
								<div key={provider.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: 12, border: "1px solid var(--line)", borderRadius: 12, background: provider.available ? "transparent" : "var(--panel-2)" }}>
									<div style={{ minWidth: 0, flex: 1 }}>
										<div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)" }}>{provider.name}</div>
										<div style={{ marginTop: 3, fontSize: 11, lineHeight: 1.45, color: "var(--ink-3)" }}>{provider.description}</div>
									</div>
									{provider.id === "google" ? (
										<button type="button" onClick={() => void connectGoogle()} disabled={!enabled || connecting} style={{ minHeight: 44, padding: "0 14px", border: 0, borderRadius: 9, background: enabled ? "var(--ink)" : "var(--line)", color: enabled ? "var(--panel)" : "var(--ink-3)", cursor: enabled ? "pointer" : "not-allowed", flex: "none" }}>
											{connecting ? "Otevírám Google…" : activeGoogle ? "Přidat další" : "Pokračovat"}
										</button>
									) : provider.id === "imap" ? (
										<button type="button" aria-expanded={imapOpen} aria-controls="imap-smtp-form" onClick={() => { setError(null); setImapOpen((value) => !value); }} disabled={connecting} style={{ minHeight: 44, padding: "0 14px", border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", cursor: "pointer", flex: "none" }}>
											{imapOpen ? "Skrýt" : "Nastavit"}
										</button>
									) : (
										<span style={{ fontSize: 10.5, color: "var(--ink-3)", flex: "none" }}>Připravujeme</span>
									)}
								</div>
							);
						})}
					</div>
					{imapOpen && (
						<form id="imap-smtp-form" onSubmit={(event) => void connectImap(event)} autoComplete="on" style={{ marginTop: 10, padding: 14, border: "1px solid var(--line)", borderRadius: 12, background: "var(--panel-2)" }}>
							<div style={{ fontSize: 12.5, fontWeight: 750, color: "var(--ink)" }}>Připojit obecnou schránku</div>
							<p style={{ margin: "4px 0 12px", fontSize: 11, lineHeight: 1.5, color: "var(--ink-3)" }}>Použij heslo aplikace, pokud ho provider vyžaduje. Údaje se uloží až po úspěšném přihlášení k oběma serverům.</p>
							<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
								<label style={labelStyle}>Název účtu (volitelný)<input style={fieldStyle} value={imapForm.displayName} maxLength={160} onChange={(event) => setImapForm((value) => ({ ...value, displayName: event.target.value }))} /></label>
								<label style={labelStyle}>E-mailová adresa<input style={fieldStyle} type="email" autoComplete="email" required maxLength={320} value={imapForm.emailAddress} onChange={(event) => setImapForm((value) => ({ ...value, emailAddress: event.target.value }))} /></label>
								<label style={labelStyle}>Přihlašovací jméno<input style={fieldStyle} autoComplete="username" required maxLength={1024} value={imapForm.username} onChange={(event) => setImapForm((value) => ({ ...value, username: event.target.value }))} /></label>
								<label style={labelStyle}>Heslo nebo heslo aplikace<input style={fieldStyle} type="password" autoComplete="current-password" required maxLength={8192} value={imapForm.password} onChange={(event) => setImapForm((value) => ({ ...value, password: event.target.value }))} /></label>
							</div>
							<fieldset style={{ margin: "14px 0 0", padding: 0, border: 0 }}>
								<legend style={{ marginBottom: 8, fontSize: 11.5, fontWeight: 700, color: "var(--ink)" }}>Příjem — IMAP</legend>
								<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
									<label style={labelStyle}>Server<input style={fieldStyle} required placeholder="imap.example.cz" value={imapForm.imapHost} onChange={(event) => setImapForm((value) => ({ ...value, imapHost: event.target.value }))} /></label>
									<label style={labelStyle}>Port<input style={fieldStyle} type="number" required min={1} max={65535} value={imapForm.imapPort} onChange={(event) => setImapForm((value) => ({ ...value, imapPort: event.target.value }))} /></label>
									<label style={labelStyle}>Zabezpečení<select style={fieldStyle} value={imapForm.imapSecurity} onChange={(event) => setImapForm((value) => ({ ...value, imapSecurity: event.target.value as ImapSecurity }))}><option value="tls">TLS</option><option value="starttls">STARTTLS</option></select></label>
								</div>
							</fieldset>
							<fieldset style={{ margin: "14px 0 0", padding: 0, border: 0 }}>
								<legend style={{ marginBottom: 8, fontSize: 11.5, fontWeight: 700, color: "var(--ink)" }}>Odesílání — SMTP</legend>
								<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
									<label style={labelStyle}>Server<input style={fieldStyle} required placeholder="smtp.example.cz" value={imapForm.smtpHost} onChange={(event) => setImapForm((value) => ({ ...value, smtpHost: event.target.value }))} /></label>
									<label style={labelStyle}>Port<input style={fieldStyle} type="number" required min={1} max={65535} value={imapForm.smtpPort} onChange={(event) => setImapForm((value) => ({ ...value, smtpPort: event.target.value }))} /></label>
									<label style={labelStyle}>Zabezpečení<select style={fieldStyle} value={imapForm.smtpSecurity} onChange={(event) => setImapForm((value) => ({ ...value, smtpSecurity: event.target.value as ImapSecurity }))}><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select></label>
								</div>
							</fieldset>
							<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
								<button type="button" disabled={connecting} onClick={() => { setImapOpen(false); setImapForm(emptyImapForm()); }} style={{ minHeight: 44, padding: "0 14px", border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}>Zrušit</button>
								<button type="submit" disabled={connecting} style={{ minHeight: 44, padding: "0 16px", border: 0, borderRadius: 9, background: "var(--ink)", color: "var(--panel)", cursor: connecting ? "wait" : "pointer" }}>{connecting ? "Ověřuji oba servery…" : "Ověřit a připojit"}</button>
							</div>
						</form>
					)}
				</section>
			</div>
		</div>
	);
}
