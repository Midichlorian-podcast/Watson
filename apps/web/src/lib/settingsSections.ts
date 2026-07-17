export const SETTINGS_SECTIONS = ["profil", "tym", "zabezpeceni", "data", "integrace", "oznameni", "vzhled"] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SETTINGS_SECTION_SET = new Set<string>(SETTINGS_SECTIONS);

export function parseSettingsSection(value: unknown): SettingsSection | undefined {
	return typeof value === "string" && SETTINGS_SECTION_SET.has(value) ? (value as SettingsSection) : undefined;
}

/** Zachová staré deep-linky a po otevření je přesměruje do správné nové sekce. */
export function settingsSectionForHash(hash: string | undefined): SettingsSection | undefined {
	switch ((hash ?? "").replace(/^#/, "")) {
		case "posta-admin":
			return "integrace";
		case "sync-problems-title":
			return "data";
		case "availability-settings-title":
			return "profil";
		case "zabezpeceni":
			return "zabezpeceni";
		default:
			return undefined;
	}
}
