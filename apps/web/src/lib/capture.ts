export interface CaptureInput {
	title?: string;
	text?: string;
	url?: string;
}

export interface CapturePrefill {
	rawName: string;
	description: string;
}

function isUnsafeCodePoint(code: number): boolean {
	return (
		(code < 0x20 && code !== 0x09 && code !== 0x0a) ||
		code === 0x7f ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069)
	);
}

function clean(value: string | undefined, max: number): string {
	const normalized = Array.from((value ?? "").slice(0, max * 2))
		.filter((character) => !isUnsafeCodePoint(character.codePointAt(0) ?? 0))
		.join("")
		.replace(/\r\n?/g, "\n")
		.trim();
	return Array.from(normalized).slice(0, max).join("").trim();
}

export function safeCaptureUrl(value: string | undefined): string {
	const candidate = clean(value, 2_048);
	if (!candidate) return "";
	try {
		const parsed = new URL(candidate);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
		if (parsed.username || parsed.password) return "";
		const serialized = parsed.toString();
		return serialized.length <= 2_048 ? serialized : "";
	} catch {
		return "";
	}
}

function urlTitle(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "").slice(0, 180);
	} catch {
		return "";
	}
}

/**
 * Converts untrusted Web Share Target / bookmarklet input to a bounded task draft.
 * The URL is context, never executable markup, and only http(s) survives.
 */
export function capturePrefill(input: CaptureInput): CapturePrefill {
	const title = clean(input.title, 240);
	const text = clean(input.text, 2_000);
	const explicitUrl = safeCaptureUrl(input.url);
	const textAsUrl = safeCaptureUrl(text);
	const sourceUrl = explicitUrl || textAsUrl;
	const firstLine = text.split("\n").find(Boolean) ?? "";
	const rawName = clean(
		title || (textAsUrl ? urlTitle(textAsUrl) : firstLine) || urlTitle(sourceUrl),
		240,
	);
	const contextParts: string[] = [];
	if (text && text !== rawName && !textAsUrl) contextParts.push(text);
	if (sourceUrl && !contextParts.some((part) => part.includes(sourceUrl))) contextParts.push(sourceUrl);
	return {
		rawName,
		description: clean(contextParts.join("\n\n"), 4_096),
	};
}

/** No javascript: href is ever rendered inside Watson; users copy this text to bookmarks. */
export function captureBookmarklet(origin: string): string {
	const safeOrigin = new URL(origin).origin;
	const target = `${safeOrigin}/zachytit`;
	return `javascript:(()=>{const u=new URL(${JSON.stringify(target)}),s=getSelection()?.toString().trim();u.searchParams.set('title',document.title.slice(0,240));u.searchParams.set('url',location.href.slice(0,2048));if(s)u.searchParams.set('text',s.slice(0,2000));open(u.toString(),'watson_capture','noopener,noreferrer')})()`;
}
