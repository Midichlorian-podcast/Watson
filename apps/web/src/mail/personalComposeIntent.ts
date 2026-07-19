import { takePrivateJson, writePrivateJson } from "../lib/powersync/privateState";

const KEY = "watson.personal-mail.compose-intent";
export const PERSONAL_COMPOSE_INTENT_EVENT = "watson:personal-mail-compose-intent";

export interface PersonalComposeIntent {
	id: string;
	createdAt: string;
	to: string;
	subject: string;
	body: string;
}

const clean = (value: unknown, limit: number) =>
	typeof value === "string" ? value.slice(0, limit) : "";

function parse(value: unknown): PersonalComposeIntent | null {
	if (!value || typeof value !== "object") return null;
	const candidate = value as Record<string, unknown>;
	const id = clean(candidate.id, 100);
	const createdAt = clean(candidate.createdAt, 40);
	const timestamp = Date.parse(createdAt);
	if (!id || !Number.isFinite(timestamp) || Date.now() - timestamp > 24 * 60 * 60 * 1_000) {
		return null;
	}
	return {
		id,
		createdAt,
		to: clean(candidate.to, 2_000),
		subject: clean(candidate.subject, 998),
		body: clean(candidate.body, 512 * 1_024),
	};
}

/**
 * Citlivý AI návrh nesmí skončit v URL ani sessionStorage. Do otevření mailové
 * obrazovky proto krátce čeká v šifrované lokální DB uživatele.
 */
export async function savePersonalComposeIntent(
	input: Pick<PersonalComposeIntent, "to" | "subject" | "body">,
) {
	const intent: PersonalComposeIntent = {
		id: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		to: clean(input.to, 2_000),
		subject: clean(input.subject, 998),
		body: clean(input.body, 512 * 1_024),
	};
	await writePrivateJson(KEY, intent);
	return intent;
}

/** Atomicky převezme jednorázový návrh, takže jej může otevřít jen jedno okno. */
export async function takePersonalComposeIntent() {
	return parse(await takePrivateJson<unknown>(KEY, null));
}
