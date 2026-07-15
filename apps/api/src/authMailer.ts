import { env } from "./env";

type AuthMail = {
	to: string;
	subject: string;
	text: string;
	actionUrl: string;
};

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

/**
 * Jediný výstupní bod pro přihlašovací odkazy. Produkce bez maileru odmítne
 * nastartovat v auth.ts; v dev se URL vypíše jen po explicitním opt-in flagu.
 */
export async function sendAuthMail(mail: AuthMail): Promise<void> {
	if (!env.resendApiKey) {
		if (
			process.env.DEV_AUTH_LOG_LINKS === "1" &&
			process.env.NODE_ENV !== "production"
		) {
			console.log(
				`\n[watson-api] ✉️  ${mail.subject} pro ${mail.to}:\n${mail.actionUrl}\n`,
			);
			return;
		}
		throw new Error(
			"Auth e-mail nelze doručit: RESEND_API_KEY chybí a DEV_AUTH_LOG_LINKS není bezpečně povolen.",
		);
	}

	const safeText = escapeHtml(mail.text);
	const safeUrl = escapeHtml(mail.actionUrl);
	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		signal: AbortSignal.timeout(12_000),
		headers: {
			Authorization: `Bearer ${env.resendApiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from: env.authEmailFrom,
			to: [mail.to],
			subject: mail.subject,
			text: `${mail.text}\n\n${mail.actionUrl}`,
			html: `<p>${safeText}</p><p><a href="${safeUrl}">Pokračovat do Watsonu</a></p><p style="color:#666;font-size:12px">Pokud jste o tento e-mail nežádali, můžete ho ignorovat.</p>`,
		}),
	});

	if (!response.ok) {
		// Nezapisovat response body: externí provider do něj může vložit adresu či URL.
		throw new Error(`Auth e-mail provider odmítl požadavek (${response.status}).`);
	}
}
