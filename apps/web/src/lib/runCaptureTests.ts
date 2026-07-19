import { captureBookmarklet, capturePrefill, safeCaptureUrl } from "./capture";

function check(label: string, ok: boolean) {
	if (!ok) throw new Error(`capture test failed: ${label}`);
	console.log(`  ✓ ${label}`);
}

const page = capturePrefill({
	title: "Watson product review",
	text: "Compare the navigation with Todoist.",
	url: "https://example.com/review?q=watson",
});
check("page title becomes the task name", page.rawName === "Watson product review");
check("selected text and URL stay in description", page.description.includes("Compare") && page.description.includes("https://example.com"));

const urlOnly = capturePrefill({ text: "https://www.example.com/article" });
check("URL-only share gets a useful hostname title", urlOnly.rawName === "example.com");
check("URL-only share keeps the source", urlOnly.description === "https://www.example.com/article");

check("javascript URL is rejected", safeCaptureUrl("javascript:alert(1)") === "");
check("credential-bearing URL is rejected", safeCaptureUrl("https://user:pass@example.com") === "");
check("bidi controls are removed", !capturePrefill({ title: "safe\u202eevil" }).rawName.includes("\u202e"));
check(
	"unicode bounds do not split a surrogate pair",
	!capturePrefill({ title: `${"x".repeat(239)}😀` }).rawName.endsWith("�"),
);

const bounded = capturePrefill({ title: "x".repeat(500), text: "y".repeat(5_000) });
check("share input is bounded", bounded.rawName.length === 240 && bounded.description.length <= 4_096);

const bookmarklet = captureBookmarklet("https://watson.example.test/path");
check("bookmarklet targets the canonical capture route", bookmarklet.includes("https://watson.example.test/zachytit"));
check("bookmarklet does not interpolate the current page into source code", bookmarklet.includes("location.href.slice"));
check("bookmarklet includes bounded selected text", bookmarklet.includes("getSelection") && bookmarklet.includes("s.slice(0,2000)"));

console.log("Capture: sanitization, bounds, URL handling and bookmarklet checks passed.");
