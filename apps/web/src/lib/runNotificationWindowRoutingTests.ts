import assert from "node:assert/strict";
import {
	notificationNavigationUrl,
	notificationWindowPriority,
} from "./notificationWindowRouting";

const origin = "https://watson.test";
assert.equal(
	notificationWindowPriority("/mail?mailMessage=1", `${origin}/mail?mailMessage=1`, origin),
	0,
);
assert.equal(
	notificationWindowPriority("/mail?mailMessage=1", `${origin}/mail?shell=focus`, origin),
	10,
);
assert.equal(notificationWindowPriority("/mail", `${origin}/prehled`, origin), 30);
assert.equal(
	notificationWindowPriority("/mail", `${origin}/velin?shell=wallboard`, origin),
	Number.POSITIVE_INFINITY,
);
assert.equal(
	notificationWindowPriority("/ukoly?ukol=1", `${origin}/nadchazejici?shell=focus`, origin),
	Number.POSITIVE_INFINITY,
);
assert.equal(
	notificationWindowPriority("https://evil.test/mail", `${origin}/mail`, origin),
	Number.POSITIVE_INFINITY,
);
assert.equal(
	notificationNavigationUrl("/mail?mailMessage=1", `${origin}/mail?shell=focus`, origin),
	"/mail?mailMessage=1&shell=focus",
);
assert.equal(
	notificationNavigationUrl("/prehled?vstup=provoz", `${origin}/prehled?shell=wallboard`, origin),
	"/prehled?vstup=provoz&shell=wallboard",
);
assert.equal(
	notificationNavigationUrl("/mail", `${origin}/prehled?shell=wallboard`, origin),
	"/mail",
);
assert.equal(notificationNavigationUrl("https://evil.test/mail", `${origin}/mail`, origin), null);

console.log(
	"notificationWindowRouting: exact, surface, app, protected wallboard and shell preservation passed",
);
