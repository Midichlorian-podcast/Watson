import {
	dateInTimeZone,
	minutesInTimeZone,
	nextValidZonedDateTimeToIso,
	wallTimeFromInstant,
	zonedDateTimeToIso,
} from "./timeZone";

let failed = 0;
function check(label: string, condition: boolean, detail?: unknown) {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed++;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
}

const summer = zonedDateTimeToIso("2026-07-15", "09:30:00", "Europe/Prague");
check("Praha v létě převádí UTC+2", summer === "2026-07-15T07:30:00.000Z", summer);
const winter = zonedDateTimeToIso("2026-01-15", "09:30:00", "Europe/Prague");
check("Praha v zimě převádí UTC+1", winter === "2026-01-15T08:30:00.000Z", winter);
check(
	"neexistující čas při jarním DST skoku je odmítnut",
	zonedDateTimeToIso("2026-03-29", "02:30:00", "Europe/Prague") === null,
);
check(
	"dvojznačný podzimní čas volí deterministicky dřívější instant",
	zonedDateTimeToIso("2026-10-25", "02:30:00", "Europe/Prague") ===
		"2026-10-25T00:30:00.000Z",
);
const shifted = nextValidZonedDateTimeToIso(
	"2026-03-29",
	"02:30:00",
	"Europe/Prague",
);
check("automatické opakování přes DST mezeru se posune na první validní minutu", !!shifted, shifted);
check(
	"wall-clock round-trip zachová 09:30",
	summer !== null && wallTimeFromInstant(summer, "Europe/Prague") === "09:30:00",
);
check(
	"minuty se čtou v uložené zóně, ne v zóně prohlížeče",
	summer !== null && minutesInTimeZone(summer, "Europe/Prague") === 570,
);
check(
	"kalendářní datum se odvozuje v IANA zóně",
	dateInTimeZone("Europe/Prague", new Date("2026-07-14T22:30:00.000Z")) === "2026-07-15",
);
check(
	"neplatné kalendářní datum se nenormalizuje potichu",
	zonedDateTimeToIso("2026-02-31", "10:00:00", "Europe/Prague") === null,
);

if (failed) throw new Error(`${failed} timezone checks failed`);
console.log("\nTimezone checks passed.");
