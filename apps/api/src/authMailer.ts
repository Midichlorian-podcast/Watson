import { sendProviderEmail, escapeEmailHtml } from "./emailProvider";
import { env } from "./env";

type AuthMail = {
	to: string;
	subject: string;
	text: string;
	actionUrl: string;
};

/**
 * Jediný výstupní bod pro přihlašovací odkazy. Produkce bez maileru odmítne
 * nastartovat v auth.ts; v dev se URL vypíše jen po explicitním opt-in flagu.
 */
export async function sendAuthMail(mail: AuthMail): Promise<void> {
	if (!env.resendApiKey) {
		if (process.env.DEV_AUTH_LOG_LINKS === "1" && process.env.NODE_ENV !== "production") {
			console.log(`\n[watson-api] ✉️  ${mail.subject} pro ${mail.to}:\n${mail.actionUrl}\n`);
			return;
		}
		throw new Error(
			"Auth e-mail nelze doručit: RESEND_API_KEY chybí a DEV_AUTH_LOG_LINKS není bezpečně povolen.",
		);
	}

	const safeText = escapeEmailHtml(mail.text);
	const safeUrl = escapeEmailHtml(mail.actionUrl);
	const result = await sendProviderEmail({
		from: env.authEmailFrom,
		to: mail.to,
		subject: mail.subject,
		text: `${mail.text}\n\n${mail.actionUrl}`,
		html: `<p>${safeText}</p><p><a href="${safeUrl}">Pokračovat do Watsonu</a></p><p style="color:#666;font-size:12px">Pokud jste o tento e-mail nežádali, můžete ho ignorovat.</p>`,
	});
	if (!result.ok) throw new Error(`Auth e-mail provider selhal (${result.errorCode}).`);
}
