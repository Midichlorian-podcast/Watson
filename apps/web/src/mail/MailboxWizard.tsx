/**
 * F5 Mail M1 — pravdivá správa osobních mailbox účtů.
 *
 * Google používá skutečný serverový OAuth/PKCE flow. M365 a IMAP/SMTP jsou
 * viditelně nedostupné, dokud nebudou mít vlastní ověřený adapter. Google zprávy
 * se synchronizují šifrovaně na serveru; osobní read-only inbox je skutečný,
 * týmové schránky a poštovní akce zatím zůstávají demo.
 */
import { useCallback, useEffect, useState } from "react";
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
		description: "Obecné schránky přidáme až s ověřením obou serverů a bezpečným vaultem hesla.",
		available: false,
	},
] as const;

const errorCopy: Record<string, string> = {
	mail_google_not_configured: "Google připojení zatím není na serveru nakonfigurované.",
	mail_accounts_unavailable: "Bezpečný stav účtů se nepodařilo načíst. Zavři okno a zkus to znovu.",
	mail_authorization_url_rejected: "Server vrátil nedůvěryhodnou autorizační adresu. Připojení bylo zastaveno.",
	mail_connection_failed: "Připojení nebylo dokončeno a žádný nový credential se neuložil.",
	mail_provider_timeout: "Google neodpověděl včas. Zkus to znovu za chvíli.",
	mail_provider_unavailable: "Google je teď nedostupný. Účet se nezměnil.",
	mail_revoke_failed: "Google nepotvrdil odpojení. Credential zůstal bezpečně uložený; zkus to znovu.",
	mail_credentials_missing: "Účet nemá úplný credential. Nic se nezměnilo; kontaktuj správce provozu.",
	mail_account_already_revoked: "Účet už byl odpojený. Stav jsme znovu načetli.",
	stale_version: "Účet se mezitím změnil. Stav jsme znovu načetli; operaci případně zopakuj.",
	operation_id_reused: "Tento bezpečnostní příkaz už byl použit pro jinou operaci. Zkus akci znovu.",
	unauthorized: "Přihlášení vypršelo. Obnov stránku a přihlas se znovu.",
};

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
		if (!open) return;
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
			showToast("Google účet je odpojený. Credential i synchronizovaný obsah byly odstraněny; týmové demo schránky se nezměnily.");
		} catch (cause) {
			const code = cause instanceof Error ? cause.message : "mail_revoke_failed";
			if (code === "stale_version" || code === "mail_account_already_revoked") await load();
			setError(code);
		} finally {
			setRevoking(null);
		}
	};

	const activeGoogle = accounts.some((account) => account.provider === "google" && account.status !== "revoked");
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
							Credential i synchronizovaný obsah jsou šifrované. Osobní inbox čte skutečná data; týmové schránky a akce jsou zatím demo.
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
											<span aria-hidden style={{ width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 9, background: "var(--panel-2)", fontWeight: 800, color: "var(--ink)" }}>G</span>
											<div style={{ minWidth: 0, flex: 1 }}>
												<div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)", overflowWrap: "anywhere" }}>{account.emailAddress}</div>
												<div style={{ marginTop: 2, fontSize: 10.5, color: status.tone }}>{status.label} · verze {account.version}</div>
											</div>
											{account.status !== "revoked" && !confirming && (
												<button type="button" onClick={() => setConfirmRevoke(account.id)} style={{ minHeight: 44, padding: "0 13px", border: "1px solid var(--line)", borderRadius: 9, background: "transparent", color: "var(--ink-2)", cursor: "pointer" }}>
													Odpojit
												</button>
											)}
										</div>
										{confirming && (
											<div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--ink-2)" }}>
												Watson požádá Google o revokaci a potom fyzicky odstraní credential, sync cursor i stažený obsah.
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
							const enabled = provider.id === "google" && googleAvailable;
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
									) : (
										<span style={{ fontSize: 10.5, color: "var(--ink-3)", flex: "none" }}>Připravujeme</span>
									)}
								</div>
							);
						})}
					</div>
				</section>
			</div>
		</div>
	);
}
