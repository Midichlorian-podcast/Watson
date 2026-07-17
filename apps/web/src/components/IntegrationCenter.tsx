import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import type { CSSProperties } from "react";
import { useState } from "react";
import { API_URL } from "../lib/api";

type IntegrationStatus =
	| "configured"
	| "healthy"
	| "degraded"
	| "not_configured"
	| "revoked";

type Integration = {
	id: string;
	provider: "luckyos" | "resend_email" | "watson_attachments";
	name: string;
	status: IntegrationStatus;
	mode: "configured" | "demo" | "not_configured" | "built_in";
	enabled: boolean;
	canTest: boolean;
	canRevoke: boolean;
	scopes: string[];
	capabilities: string[];
	lastTestedAt: string | null;
	lastSuccessAt: string | null;
	lastErrorAt: string | null;
	lastErrorCode: string | null;
	revokedAt: string | null;
	version: number;
};

type IntegrationsResponse = { integrations: Integration[] };

const STATUS_COLOR: Record<IntegrationStatus, string> = {
	configured: "var(--w-p3)",
	healthy: "var(--w-success)",
	degraded: "var(--w-p2)",
	not_configured: "var(--w-ink-3)",
	revoked: "var(--w-overdue)",
};

const PROVIDER_MARK: Record<Integration["provider"], string> = {
	luckyos: "LO",
	resend_email: "E",
	watson_attachments: "P",
};

async function readIntegrations(): Promise<Integration[]> {
	const response = await fetch(`${API_URL}/api/integrations`, { credentials: "include" });
	if (!response.ok) throw new Error("integration_list_failed");
	return ((await response.json()) as IntegrationsResponse).integrations;
}

function timestamp(value: string | null, locale: string): string {
	if (!value) return "—";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

/** Produkční provider registry; žádný token, URL ani upstream payload se do klienta neposílá. */
export function IntegrationCenter() {
	const { t, i18n } = useTranslation();
	const [busy, setBusy] = useState<string | null>(null);
	const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
	const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
	const query = useQuery({
		queryKey: ["integration-center"],
		queryFn: readIntegrations,
		staleTime: 30_000,
	});

	async function command(
		integration: Integration,
		action: "test" | "revoke" | "reconnect",
	) {
		if (busy) return;
		setBusy(`${integration.provider}:${action}`);
		setNotice(null);
		try {
			const response = await fetch(`${API_URL}/api/integrations/${integration.provider}/${action}`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body:
					action === "test"
						? undefined
						: JSON.stringify({
								operationId: crypto.randomUUID(),
								expectedVersion: integration.version,
							}),
			});
			await query.refetch();
			if (!response.ok) throw new Error("integration_command_failed");
			setConfirmRevoke(null);
			setNotice({
				kind: "ok",
				text: t(`settings.integrationProvider.${integration.provider}.${action}Success`),
			});
		} catch {
			setNotice({ kind: "error", text: t("settings.integrationActionError") });
		} finally {
			setBusy(null);
		}
	}

	if (query.isLoading) {
		return (
			<div className="w-integration-loading" role="status">
				{t("settings.integrationLoading")}
			</div>
		);
	}
	if (query.isError) {
		return (
			<div className="w-integration-error" role="alert">
				<div>{t("settings.integrationLoadError")}</div>
				<button type="button" onClick={() => void query.refetch()}>
					{t("common.retry")}
				</button>
			</div>
		);
	}

	return (
		<div className="w-integration-center" aria-busy={Boolean(busy)}>
			<div className="w-integration-intro">
				<div>
					<h2>{t("settings.integrationCenterTitle")}</h2>
					<p>{t("settings.integrationCenterDesc")}</p>
				</div>
				<span>{t("settings.integrationPersonalScope")}</span>
			</div>
			{notice && (
				<div
					className={`w-integration-notice ${notice.kind}`}
					role={notice.kind === "error" ? "alert" : "status"}
				>
					{notice.text}
				</div>
			)}
			{query.data?.map((integration) => {
				const actionBusy = busy?.startsWith(`${integration.provider}:`) ?? false;
				const canContact = integration.mode !== "not_configured";
				return (
					<article className="w-integration-card" key={integration.id}>
						<div className="w-integration-head">
							<div className="w-integration-mark" aria-hidden="true">
								{PROVIDER_MARK[integration.provider]}
							</div>
							<div className="w-integration-title">
								<div>
									<h3>{t(`settings.integrationProvider.${integration.provider}.name`)}</h3>
									<span
										className="w-integration-status"
										style={{ "--integration-status": STATUS_COLOR[integration.status] } as CSSProperties}
									>
										{t(`settings.integrationStatus.${integration.status}`)}
									</span>
								</div>
								<p>{t(`settings.integrationProvider.${integration.provider}.desc`)}</p>
							</div>
						</div>

						{integration.mode === "demo" && (
							<div className="w-integration-mode" role="note">
								<strong>{t("settings.integrationDemoTitle")}</strong>{" "}
								{t("settings.integrationDemoDesc")}
							</div>
						)}
						{integration.mode === "not_configured" && (
							<div className="w-integration-mode warning" role="note">
								<strong>{t("settings.integrationNotConfiguredTitle")}</strong>{" "}
								{t("settings.integrationNotConfiguredDesc")}
							</div>
						)}
						{integration.mode === "built_in" && (
							<div className="w-integration-mode" role="note">
								<strong>{t("settings.integrationBuiltInTitle")}</strong>{" "}
								{t("settings.integrationBuiltInDesc")}
							</div>
						)}

						<dl className="w-integration-health">
							<div>
								<dt>{t("settings.integrationLastSuccess")}</dt>
								<dd>{timestamp(integration.lastSuccessAt, i18n.language)}</dd>
							</div>
							<div>
								<dt>{t("settings.integrationLastTest")}</dt>
								<dd>{timestamp(integration.lastTestedAt, i18n.language)}</dd>
							</div>
							<div>
								<dt>{t("settings.integrationLastError")}</dt>
								<dd>
									{integration.lastErrorCode
										? `${t(`settings.integrationError.${integration.lastErrorCode}`)} · ${timestamp(integration.lastErrorAt, i18n.language)}`
										: t("settings.integrationNoError")}
								</dd>
							</div>
						</dl>

						<details className="w-integration-details">
							<summary>{t("settings.integrationPermissions")}</summary>
							<p>{t("settings.integrationPermissionsDesc")}</p>
							<ul>
								{integration.scopes.map((scope) => (
									<li key={scope}>
										{t(`settings.integrationScope.${scope.replaceAll(".", "_")}`)}
									</li>
								))}
							</ul>
						</details>

						<div className="w-integration-actions">
							{integration.canTest && (
								<button
									type="button"
									disabled={actionBusy || !canContact}
									onClick={() => void command(integration, "test")}
								>
									{busy === `${integration.provider}:test`
										? t("settings.integrationTesting")
										: t("settings.integrationTest")}
								</button>
							)}
							{integration.canRevoke && integration.status === "revoked" ? (
								<button
									type="button"
									className="primary"
									disabled={actionBusy || !canContact}
									onClick={() => void command(integration, "reconnect")}
								>
									{busy === `${integration.provider}:reconnect`
										? t("settings.integrationReconnecting")
										: t("settings.integrationReconnect")}
								</button>
							) : integration.canRevoke ? (
								<button
									type="button"
									className="danger"
									disabled={actionBusy || !canContact}
									onClick={() => setConfirmRevoke(integration.id)}
								>
									{t("settings.integrationRevoke")}
								</button>
							) : null}
						</div>

						{confirmRevoke === integration.id && integration.status !== "revoked" && (
							<div className="w-integration-confirm" role="alert">
								<div>
									<strong>
										{t(`settings.integrationProvider.${integration.provider}.revokeTitle`)}
									</strong>
									<p>{t(`settings.integrationProvider.${integration.provider}.revokeDesc`)}</p>
								</div>
								<div>
									<button type="button" onClick={() => setConfirmRevoke(null)}>
										{t("common.cancel")}
									</button>
									<button
										type="button"
										className="danger"
										disabled={actionBusy}
										onClick={() => void command(integration, "revoke")}
									>
										{busy === `${integration.provider}:revoke`
											? t("settings.integrationRevoking")
											: t("settings.integrationRevokeConfirm")}
									</button>
								</div>
							</div>
						)}
					</article>
				);
			})}
		</div>
	);
}
