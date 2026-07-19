import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { showToast } from "../lib/toast";

const SCOPES = [
	["projects:read", "Číst projekty"],
	["tasks:read", "Číst úkoly"],
	["tasks:write", "Vytvářet a upravovat úkoly"],
] as const;
const EVENTS = [
	["task.created", "Úkol vytvořen"],
	["task.updated", "Úkol upraven"],
	["task.completed", "Úkol dokončen"],
	["task.deleted", "Úkol smazán"],
	["project.created", "Projekt vytvořen"],
	["project.updated", "Projekt upraven"],
	["project.deleted", "Projekt smazán"],
] as const;

type Project = { id: string; name: string; status: string };
type ApiClient = {
	id: string;
	name: string;
	keyPrefix: string;
	scopes: string[];
	projectIds: string[];
	lastUsedAt: string | null;
	expiresAt: string | null;
	revokedAt: string | null;
	createdAt: string;
};
type Subscription = {
	id: string;
	name: string;
	endpointUrl: string;
	eventTypes: string[];
	projectIds: string[];
	active: boolean;
	version: number;
	failureCount: number;
	lastAttemptAt: string | null;
	lastSuccessAt: string | null;
	lastErrorCode: string | null;
};
type DeveloperSnapshot = {
	clients: ApiClient[];
	subscriptions: Subscription[];
	projects: Project[];
	openApiUrl: string;
};

async function readSnapshot(workspaceId: string): Promise<DeveloperSnapshot> {
	const response = await fetch(
		`${API_URL}/api/developer?workspaceId=${encodeURIComponent(workspaceId)}`,
		{ credentials: "include" },
	);
	if (!response.ok) throw new Error("developer_settings_failed");
	return response.json() as Promise<DeveloperSnapshot>;
}

function time(value: string | null): string {
	if (!value) return "Nikdy";
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? "—"
		: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function scopeLabel(value: string): string {
	return SCOPES.find(([scope]) => scope === value)?.[1] ?? value;
}

function safeEndpointLabel(value: string): string {
	try {
		const url = new URL(value);
		return `${url.origin}${url.pathname}${url.search ? "?…" : ""}`;
	} catch {
		return "Neplatná adresa";
	}
}

function ChoiceGrid(props: {
	legend: string;
	items: readonly (readonly [string, string])[];
	selected: string[];
	onChange: (next: string[]) => void;
}) {
	return (
		<fieldset className="w-developer-choices">
			<legend>{props.legend}</legend>
			{props.items.map(([value, label]) => (
				<label key={value}>
					<input
						type="checkbox"
						checked={props.selected.includes(value)}
						onChange={(event) =>
							props.onChange(
								event.currentTarget.checked
									? [...props.selected, value]
									: props.selected.filter((item) => item !== value),
							)
						}
					/>
					<span>{label}</span>
				</label>
			))}
		</fieldset>
	);
}

/** Admin-only public API and webhook control plane. Secrets live only in component state. */
export function DeveloperApiSettings(props: { workspaceId: string; canManage: boolean }) {
	const [mode, setMode] = useState<"client" | "webhook" | null>(null);
	const [name, setName] = useState("");
	const [endpoint, setEndpoint] = useState("");
	const [scopes, setScopes] = useState<string[]>(SCOPES.map(([value]) => value));
	const [events, setEvents] = useState<string[]>(EVENTS.slice(0, 4).map(([value]) => value));
	const [projectIds, setProjectIds] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const [revealed, setRevealed] = useState<{ label: string; value: string } | null>(null);
	const query = useQuery({
		queryKey: ["developer-api", props.workspaceId],
		queryFn: () => readSnapshot(props.workspaceId),
		enabled: props.canManage,
		staleTime: 20_000,
	});
	const projectChoices = useMemo(
		() => (query.data?.projects ?? []).map((project) => [project.id, project.name] as const),
		[query.data?.projects],
	);

	if (!props.canManage) return null;

	function resetForm() {
		setMode(null);
		setName("");
		setEndpoint("");
		setProjectIds([]);
	}

	async function createClient() {
		if (!name.trim() || projectIds.length === 0 || scopes.length === 0 || busy) return;
		setBusy(true);
		try {
			const response = await fetch(`${API_URL}/api/developer/clients`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workspaceId: props.workspaceId, name, scopes, projectIds }),
			});
			const body = (await response.json().catch(() => ({}))) as { token?: string; error?: string };
			if (!response.ok || !body.token) throw new Error(body.error ?? "create_failed");
			setRevealed({ label: "API token", value: body.token });
			resetForm();
			await query.refetch();
		} catch {
			showToast("API klíč se nepodařilo vytvořit.");
		} finally {
			setBusy(false);
		}
	}

	async function createWebhook() {
		if (!name.trim() || !endpoint.trim() || projectIds.length === 0 || events.length === 0 || busy)
			return;
		setBusy(true);
		try {
			const response = await fetch(`${API_URL}/api/developer/webhooks`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					workspaceId: props.workspaceId,
					name,
					endpointUrl: endpoint,
					eventTypes: events,
					projectIds,
				}),
			});
			const body = (await response.json().catch(() => ({}))) as {
				signingSecret?: string;
				error?: string;
			};
			if (!response.ok || !body.signingSecret) throw new Error(body.error ?? "create_failed");
			setRevealed({ label: "Webhook signing secret", value: body.signingSecret });
			resetForm();
			await query.refetch();
		} catch {
			showToast("Webhook se nepodařilo vytvořit. Produkční adresa musí používat HTTPS.");
		} finally {
			setBusy(false);
		}
	}

	async function revoke(client: ApiClient) {
		if (busy || client.revokedAt || !window.confirm(`Zneplatnit klíč „${client.name}“?`)) return;
		setBusy(true);
		try {
			const response = await fetch(`${API_URL}/api/developer/clients/${client.id}`, {
				method: "DELETE",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workspaceId: props.workspaceId }),
			});
			if (!response.ok) throw new Error("revoke_failed");
			await query.refetch();
		} catch {
			showToast("Klíč se nepodařilo zneplatnit.");
		} finally {
			setBusy(false);
		}
	}

	async function toggle(subscription: Subscription) {
		if (busy) return;
		setBusy(true);
		try {
			const response = await fetch(`${API_URL}/api/developer/webhooks/${subscription.id}`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					workspaceId: props.workspaceId,
					expectedVersion: subscription.version,
					active: !subscription.active,
				}),
			});
			if (!response.ok) throw new Error("toggle_failed");
			await query.refetch();
		} catch {
			showToast("Stav webhooku se nepodařilo změnit. Obnovte seznam.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="w-developer" aria-labelledby="developer-api-title">
			<div className="w-integration-intro">
				<div>
					<h2 id="developer-api-title">API a webhooky</h2>
					<p>
						Bezpečné napojení vlastních systémů. Každý klíč vidí jen vybrané projekty a
						výslovně povolené operace.
					</p>
				</div>
				<span>Admin</span>
			</div>

			{revealed && (
				<div className="w-developer-secret" role="status">
					<strong>{revealed.label} — zobrazí se jen teď</strong>
					<code>{revealed.value}</code>
					<div>
						<button
							type="button"
							onClick={() => {
								void navigator.clipboard.writeText(revealed.value);
								showToast("Tajný údaj zkopírován.");
							}}
						>
							Kopírovat
						</button>
						<button type="button" onClick={() => setRevealed(null)}>
							Mám bezpečně uloženo
						</button>
					</div>
				</div>
			)}

			{query.isPending && <div className="w-integration-loading">Načítám vývojářská napojení…</div>}
			{query.isError && (
				<div className="w-integration-error" role="alert">
					Nastavení API se nepodařilo načíst.
					<button type="button" onClick={() => void query.refetch()}>
						Zkusit znovu
					</button>
				</div>
			)}

			{query.data && (
				<>
					<div className="w-developer-toolbar">
						<a href={query.data.openApiUrl} target="_blank" rel="noreferrer">
							OpenAPI specifikace
						</a>
						<button type="button" onClick={() => setMode(mode === "client" ? null : "client")}>
							Nový API klíč
						</button>
						<button type="button" onClick={() => setMode(mode === "webhook" ? null : "webhook")}>
							Nový webhook
						</button>
					</div>

					{mode && (
						<form
							className="w-developer-form"
							onSubmit={(event) => {
								event.preventDefault();
								void (mode === "client" ? createClient() : createWebhook());
							}}
						>
							<label>
								<span>Název napojení</span>
								<input value={name} maxLength={120} required onChange={(event) => setName(event.currentTarget.value)} />
							</label>
							{mode === "webhook" && (
								<label>
									<span>HTTPS adresa příjemce</span>
									<input type="url" value={endpoint} maxLength={2048} required placeholder="https://…" onChange={(event) => setEndpoint(event.currentTarget.value)} />
								</label>
							)}
							{mode === "client" ? (
								<ChoiceGrid legend="Oprávnění" items={SCOPES} selected={scopes} onChange={setScopes} />
							) : (
								<ChoiceGrid legend="Události" items={EVENTS} selected={events} onChange={setEvents} />
							)}
							<ChoiceGrid legend="Povolené projekty" items={projectChoices} selected={projectIds} onChange={setProjectIds} />
							<div className="w-developer-form-actions">
								<button type="button" onClick={resetForm}>Zrušit</button>
								<button type="submit" className="primary" disabled={busy || !name.trim() || projectIds.length === 0 || (mode === "client" ? scopes.length === 0 : events.length === 0)}>
									{busy ? "Ukládám…" : mode === "client" ? "Vytvořit klíč" : "Vytvořit webhook"}
								</button>
							</div>
						</form>
					)}

					<div className="w-developer-columns">
						<section aria-labelledby="developer-clients-title">
							<h3 id="developer-clients-title">API klíče</h3>
							{query.data.clients.length === 0 ? (
								<p className="w-developer-empty">Zatím není vytvořen žádný klíč.</p>
							) : query.data.clients.map((client) => (
								<article className="w-developer-item" key={client.id}>
									<div><strong>{client.name}</strong><span>{client.revokedAt ? "Zneplatněn" : `Aktivní · …${client.keyPrefix.slice(-6)}`}</span></div>
									<p>{client.scopes.map(scopeLabel).join(" · ")}</p>
									<small>Naposledy použit: {time(client.lastUsedAt)}</small>
									{!client.revokedAt && <button type="button" disabled={busy} onClick={() => void revoke(client)}>Zneplatnit</button>}
								</article>
							))}
						</section>
						<section aria-labelledby="developer-webhooks-title">
							<h3 id="developer-webhooks-title">Webhooky</h3>
							{query.data.subscriptions.length === 0 ? (
								<p className="w-developer-empty">Zatím není vytvořen žádný webhook.</p>
							) : query.data.subscriptions.map((subscription) => (
								<article className="w-developer-item" key={subscription.id}>
									<div><strong>{subscription.name}</strong><span>{subscription.active ? "Aktivní" : "Pozastaven"}</span></div>
									<p className="w-developer-url">{safeEndpointLabel(subscription.endpointUrl)}</p>
									<small>{subscription.lastErrorCode ? `Chyba: ${subscription.lastErrorCode} · ${subscription.failureCount}×` : `Poslední úspěch: ${time(subscription.lastSuccessAt)}`}</small>
									<button type="button" disabled={busy} onClick={() => void toggle(subscription)}>{subscription.active ? "Pozastavit" : "Zapnout"}</button>
								</article>
							))}
						</section>
					</div>
				</>
			)}
		</section>
	);
}
