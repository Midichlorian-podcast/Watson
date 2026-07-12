/**
 * Reálný adresář kontaktů (tabulka `contacts`, workspace-scoped) — zdroj pro
 * našeptávání příjemce v mailu i budoucí správu kontaktů. Nahrazuje demo
 * konstanty. `addContact` zapíše přes PowerSync write-path (sféra = aktivní
 * prostor). Feedback 2026-07-12 „práce s kontakty je slabá".
 */
import { useQuery as usePsQuery } from "@powersync/react";
import { useMemo } from "react";
import { useSession } from "./auth-client";
import type { ContactRow } from "./powersync/AppSchema";
import { powerSync } from "./powersync/db";
import { useWorkspace } from "./workspace";

export interface ContactSuggestion {
	name: string;
	addr: string;
	org?: string;
}

/** Kontakty s e-mailem napříč syncnutými prostory (osobní + týmové). */
export function useContacts(): ContactSuggestion[] {
	const { data: rows } = usePsQuery<ContactRow>(
		"SELECT name, email, org FROM contacts WHERE email IS NOT NULL AND email <> ''",
	);
	return useMemo(
		() =>
			(rows ?? []).map((r) => ({
				name: r.name ?? "",
				addr: r.email ?? "",
				org: r.org ?? undefined,
			})),
		[rows],
	);
}

/** Založí kontakt v aktivním prostoru (např. „přidat jako nový kontakt" z composeru). */
export function useAddContact(): (c: {
	name: string;
	email?: string;
	org?: string;
	role?: string;
	areas?: string;
}) => Promise<void> {
	const { activeWs } = useWorkspace();
	const { data: session } = useSession();
	return async (c) => {
		if (!activeWs || !c.name.trim()) return;
		await powerSync.execute(
			`INSERT INTO contacts (id, workspace_id, name, email, org, role, areas, created_by, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				crypto.randomUUID(),
				activeWs,
				c.name.trim(),
				c.email?.trim() || null,
				c.org?.trim() || null,
				c.role?.trim() || null,
				c.areas?.trim() || null,
				session?.user?.id ?? null,
				new Date().toISOString(),
			],
		);
	};
}
