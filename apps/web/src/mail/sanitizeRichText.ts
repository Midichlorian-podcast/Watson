/** Striktní bezpečnostní hranice pro HTML mailového composeru. */
const ALLOWED_TAGS = new Set([
	"A",
	"B",
	"BR",
	"DIV",
	"EM",
	"I",
	"LI",
	"OL",
	"P",
	"SPAN",
	"STRONG",
	"U",
	"UL",
]);

const DROP_WITH_CONTENT = new Set([
	"AUDIO",
	"EMBED",
	"FORM",
	"IFRAME",
	"MATH",
	"OBJECT",
	"SCRIPT",
	"STYLE",
	"SVG",
	"TEMPLATE",
	"VIDEO",
]);

const COLOR_VALUE = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%a-z]+\)|var\(--[a-z0-9-]+\)|[a-z]{1,24})$/i;

/** Vrátí kanonický bezpečný href, nebo null. */
export function safeRichTextHref(raw: string): string | null {
	const value = raw.trim();
	if (!value || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
		return null;
	try {
		const url = new URL(value, window.location.origin);
		if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
		return url.href;
	} catch {
		return null;
	}
}

function sanitizeElement(element: Element): void {
	for (const child of [...element.children]) sanitizeElement(child);

	if (!ALLOWED_TAGS.has(element.tagName)) {
		if (DROP_WITH_CONTENT.has(element.tagName)) {
			element.remove();
			return;
		}
		element.replaceWith(...element.childNodes);
		return;
	}

	const href = element.tagName === "A" ? safeRichTextHref(element.getAttribute("href") ?? "") : null;
	const color = element.tagName === "SPAN" ? (element as HTMLElement).style.color.trim() : "";
	for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);

	if (element.tagName === "A") {
		if (!href) {
			element.replaceWith(...element.childNodes);
			return;
		}
		element.setAttribute("href", href);
		element.setAttribute("target", "_blank");
		element.setAttribute("rel", "noopener noreferrer nofollow");
	}
	if (element.tagName === "SPAN" && color && color.length <= 64 && COLOR_VALUE.test(color)) {
		(element as HTMLElement).style.color = color;
	}
}

export function sanitizeRichText(html: string): string {
	const template = document.createElement("template");
	template.innerHTML = html;
	for (const child of [...template.content.children]) sanitizeElement(child);
	return template.innerHTML;
}

export function escapeHtmlText(value: string): string {
	const span = document.createElement("span");
	span.textContent = value;
	return span.innerHTML;
}
