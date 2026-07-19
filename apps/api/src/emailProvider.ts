/**
 * Jediný serverový adapter pro transakční e-mail přes Resend.
 *
 * Provider odpověď je vždy zredukovaná na bezpečný allowlist. Tělo chyby,
 * recipient ani API key se nesmí propsat do logu, auditu nebo klienta.
 */
import { z } from "zod";
import { env } from "./env";

export type EmailProviderErrorCode =
	| "email_not_configured"
	| "email_timeout"
	| "email_rate_limited"
	| "email_rejected"
	| "email_unavailable"
	| "email_contract_rejected"
	| "email_provider_error";

export type EmailProviderResult =
	| { ok: true; messageId: string }
	| {
			ok: false;
			errorCode: EmailProviderErrorCode;
			/** 4xx odmítnutí se opakováním stejného payloadu neopraví. */
			permanent: boolean;
	  };

type ProviderMail = {
	to: string;
	from: string;
	subject: string;
	text: string;
	html: string;
	idempotencyKey?: string;
};

const responseSchema = z.object({ id: z.string().trim().min(1).max(256) }).strict();

function providerError(status: number): EmailProviderResult {
	if (status === 429) return { ok: false, errorCode: "email_rate_limited", permanent: false };
	if (status >= 500) return { ok: false, errorCode: "email_unavailable", permanent: false };
	if (status >= 400) return { ok: false, errorCode: "email_rejected", permanent: true };
	return { ok: false, errorCode: "email_provider_error", permanent: false };
}

export function escapeEmailHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

export async function sendProviderEmail(mail: ProviderMail): Promise<EmailProviderResult> {
	if (!env.resendApiKey) return { ok: false, errorCode: "email_not_configured", permanent: true };
	try {
		const response = await fetch(`${env.resendApiBaseUrl}/emails`, {
			method: "POST",
			signal: AbortSignal.timeout(12_000),
			headers: {
				Authorization: `Bearer ${env.resendApiKey}`,
				"Content-Type": "application/json",
				...(mail.idempotencyKey ? { "Idempotency-Key": mail.idempotencyKey } : {}),
			},
			body: JSON.stringify({
				from: mail.from,
				to: [mail.to],
				subject: mail.subject,
				text: mail.text,
				html: mail.html,
			}),
		});
		if (!response.ok) return providerError(response.status);
		const parsed = responseSchema.safeParse(await response.json().catch(() => null));
		if (!parsed.success)
			return { ok: false, errorCode: "email_contract_rejected", permanent: false };
		return { ok: true, messageId: parsed.data.id };
	} catch (error) {
		return {
			ok: false,
			errorCode:
				error instanceof DOMException && error.name === "TimeoutError"
					? "email_timeout"
					: "email_provider_error",
			permanent: false,
		};
	}
}
