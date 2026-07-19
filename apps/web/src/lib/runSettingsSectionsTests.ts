import { parseSettingsSection, SETTINGS_SECTIONS, settingsSectionForHash } from "./settingsSections";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

for (const section of SETTINGS_SECTIONS) {
	assert(parseSettingsSection(section) === section, `sekce ${section} musí projít validací`);
}

for (const invalid of [undefined, null, "", "ucet", "admin", 42]) {
	assert(parseSettingsSection(invalid) === undefined, `neplatná sekce ${String(invalid)}`);
}

assert(settingsSectionForHash("#posta-admin") === "integrace", "pošta admin patří do integrací");
assert(settingsSectionForHash("#sync-problems-title") === "data", "problémy synchronizace patří do dat");
assert(settingsSectionForHash("availability-settings-title") === "profil", "dostupnost patří do profilu");
assert(settingsSectionForHash("#zabezpeceni") === "zabezpeceni", "legacy zabezpečení zůstává funkční");
assert(settingsSectionForHash("#unknown") === undefined, "neznámý hash nemění sekci");

console.log("settingsSections: validace URL a legacy deep-linků prošla");
