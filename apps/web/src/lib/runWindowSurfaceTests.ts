import assert from "node:assert/strict";
import {
	buildWatsonWindowUrl,
	parseCalendarDate,
	parseCalendarRange,
	parseWindowShell,
	resolveWindowShell,
	supportsSafeMultiWindowData,
	windowSurfaceForPath,
} from "./windowSurfaces";

assert.equal(parseWindowShell("focus"), "focus");
assert.equal(parseWindowShell("wallboard"), "wallboard");
assert.equal(parseWindowShell("admin"), "app");
assert.equal(parseCalendarRange("week"), "week");
assert.equal(parseCalendarRange("agenda"), undefined);
assert.equal(parseCalendarDate("2026-07-18"), "2026-07-18");
assert.equal(parseCalendarDate("2026-02-30"), undefined);

assert.equal(windowSurfaceForPath("/")?.id, "tasks");
assert.equal(windowSurfaceForPath("/schranka")?.id, "tasks");
assert.equal(windowSurfaceForPath("/nadchazejici")?.id, "upcoming");
assert.equal(windowSurfaceForPath("/znalosti")?.id, "knowledge");
assert.equal(windowSurfaceForPath("/nezname"), null);

assert.equal(resolveWindowShell("/mail", "focus"), "focus");
assert.equal(resolveWindowShell("/velin", "wallboard"), "wallboard");
assert.equal(resolveWindowShell("/seznamy", "wallboard"), "app");
assert.equal(resolveWindowShell("/reporty", "focus"), "app");

assert.equal(
	buildWatsonWindowUrl("/nadchazejici?pohled=abc#tyden", "focus", "https://watson.test/prehled"),
	"/nadchazejici?pohled=abc&shell=focus#tyden",
);
assert.equal(
	buildWatsonWindowUrl("/reporty?tab=lide&shell=wallboard", "focus", "https://watson.test"),
	"/reporty?tab=lide",
);
assert.throws(
	() => buildWatsonWindowUrl("https://evil.test/mail", "focus", "https://watson.test"),
	/cross_origin_window_target/,
);

assert.equal(
	supportsSafeMultiWindowData({ sharedWorker: true, mobileDevice: false, safari: false }),
	true,
);
assert.equal(
	supportsSafeMultiWindowData({ sharedWorker: true, mobileDevice: false, safari: true }),
	false,
);
assert.equal(
	supportsSafeMultiWindowData({ sharedWorker: false, mobileDevice: false, safari: false }),
	false,
);

console.log(
	"windowSurfaces: routing, shell policy, calendar state, same-origin URLs and capability gate passed",
);
