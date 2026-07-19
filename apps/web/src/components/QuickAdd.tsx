import { useTranslation } from "@watson/i18n";
import { Button, Chip, Icon, type IconName } from "@watson/ui";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../lib/auth-client";
import { powerSync } from "../lib/powersync/db";
import type { Highlight, RecurrenceRule } from "../lib/quickadd";
import { parseQuick } from "../lib/quickadd";
import { buildQuickAddTaskRow, quickAddInsertSql } from "../lib/quickadd/insert";
import { dateInTimeZone, deviceTimeZone } from "../lib/timeZone";

type Project = { id: string; name: string };
type Person = { id: string; name: string; initials: string };

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** Segmenty rawName pro overlay zvýraznění (z highlights rozsahů). */
function segments(raw: string, hl: Highlight[]) {
	const segs: { text: string; mark: boolean; start: number }[] = [];
	let pos = 0;
	for (const h of hl) {
		if (h.start > pos) segs.push({ text: raw.slice(pos, h.start), mark: false, start: pos });
		segs.push({ text: raw.slice(h.start, h.end), mark: true, start: h.start });
		pos = h.end;
	}
	if (pos < raw.length) segs.push({ text: raw.slice(pos), mark: false, start: pos });
	return segs;
}

/**
 * Chytré přidání úkolu — živé parsování přirozené češtiny (parser §1), zvýraznění
 * rozpoznaných tokenů, pilulky atributů, našeptávač `#projekt`. Vloží parsed pole offline.
 */
export function QuickAdd({
	projects,
	people = [],
	inboxId,
	onDone,
	autoFocus,
}: {
	projects: Project[];
	people?: Person[];
	inboxId?: string;
	/** Zavolá se po přidání (např. zavření modalu). */
	onDone?: () => void;
	autoFocus?: boolean;
}) {
	const { t } = useTranslation();
	const { data: session } = useSession();
	const userTimeZone = session?.user?.timezone ?? deviceTimeZone();
	const [raw, setRaw] = useState("");
	const [sugIdx, setSugIdx] = useState(0);
	// Výběr z našeptávače se aplikuje jako atribut (token pryč), ne jako text (audit re:add-task).
	const [pickedProj, setPickedProj] = useState<Project | null>(null);
	const [pickedPeople, setPickedPeople] = useState<Person[]>([]);
	const [sugDismissed, setSugDismissed] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	// In-flight guard: bez něj rychlé 2× Enter (async okno před vyčištěním inputu) vloží úkol dvakrát.
	const submittingRef = useRef(false);
	const [submitting, setSubmitting] = useState(false);
	// CC-P0-02: selhání lokální transakce NESMÍ být tiché a input se NESMÍ vyčistit.
	const [saveError, setSaveError] = useState(false);
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	const ctx = useMemo(
		() => ({ today: dateInTimeZone(userTimeZone), projects, people }),
		[userTimeZone, projects, people],
	);
	const parsed = useMemo(() => parseQuick(raw, ctx), [raw, ctx]);

	// Našeptávač: token na konci vstupu
	const sugRaw = useMemo(() => {
		const mProj = raw.match(/#(\p{L}*)$/u);
		if (mProj) {
			const q = (mProj[1] ?? "").toLowerCase();
			const list = projects
				.filter((p) => p.name.toLowerCase().includes(q))
				.slice(0, 6)
				.map((p) => ({
					kind: "proj" as const,
					id: p.id,
					label: p.name,
					token: mProj[0] ?? "",
				}));
			return list.length ? list : null;
		}
		const mPer = raw.match(/[@+](\p{L}*)$/u);
		if (mPer) {
			const q = (mPer[1] ?? "").toLowerCase();
			const list = people
				.filter((p) => p.name.toLowerCase().includes(q) || p.initials.toLowerCase().startsWith(q))
				.slice(0, 5)
				.map((p) => ({
					kind: "person" as const,
					id: p.id,
					label: p.name,
					token: mPer[0] ?? "",
				}));
			return list.length ? list : null;
		}
		return null;
	}, [raw, projects, people]);
	const sug = sugDismissed ? null : sugRaw;

	function applySug(item: { id: string; label: string; token: string; kind: "proj" | "person" }) {
		// Odstranit token ze vstupu a atribut si zapamatovat (prototyp: výběr aplikuje entitu).
		setRaw(raw.slice(0, raw.length - item.token.length));
		if (item.kind === "proj") {
			const pr = projects.find((x) => x.id === item.id);
			if (pr) setPickedProj(pr);
		} else {
			const pe = people.find((x) => x.id === item.id);
			if (pe) setPickedPeople((arr) => (arr.some((x) => x.id === pe.id) ? arr : [...arr, pe]));
		}
		setSugIdx(0);
		inputRef.current?.focus();
	}

	/**
	 * Volný @token → osoba. Přiřazujeme jen při JEDNOZNAČNÉ shodě: 0 shod = nerozpoznáno,
	 * >1 = nejednoznačné (jinak by substring/iniciály tiše přiřadily libovolného „Jana").
	 * Ambiguitu ať uživatel rozřeší výběrem z našeptávače.
	 */
	function resolvePerson(q: string): {
		status: "ok" | "none" | "ambiguous";
		person?: Person;
	} {
		const ql = q.toLowerCase();
		if (!ql) return { status: "none" };
		const matches = people.filter(
			(p) => p.name.toLowerCase().includes(ql) || p.initials.toLowerCase().startsWith(ql),
		);
		if (matches.length === 0) return { status: "none" };
		if (matches.length === 1) return { status: "ok", person: matches[0] };
		// Víc kandidátů: přijmi jen přesnou shodu celého jména / iniciál, jinak nech na uživateli.
		const exact = matches.filter(
			(p) => p.name.toLowerCase() === ql || p.initials.toLowerCase() === ql,
		);
		return exact.length === 1 ? { status: "ok", person: exact[0] } : { status: "ambiguous" };
	}

	async function submit() {
		// Bez fallbacku na raw: po vytažení formulí musí zbýt reálný název (README ř. 48).
		const name = parsed.name.trim();
		if (!name || !inboxId) return;
		if (submittingRef.current) return;
		submittingRef.current = true;
		setSubmitting(true);
		setSaveError(false);
		try {
			const taskId = crypto.randomUUID();
			const now = new Date().toISOString();
			const projId = pickedProj?.id ?? parsed.projectId ?? inboxId;
			// @osoby: vybrané z našeptávače + rozpoznané parserem → reálná přiřazení.
			const assigned = new Set<string>();
			const resolved: Person[] = [...pickedPeople];
			for (const q of parsed.personQueries ?? []) {
				// Jen jednoznačná shoda → přiřazení; nerozpoznané/nejednoznačné se NEpřiřadí (viz pilulka varování).
				const r = resolvePerson(q);
				if (r.status === "ok" && r.person) resolved.push(r.person);
			}
			// R2 — u ≥2 přiřazených neinteraktivně `shared_all` (default), jinak `single`.
			const uniqueAssignees = resolved.filter((p) => {
				if (assigned.has(p.id)) return false;
				assigned.add(p.id);
				return true;
			});
			const assignmentMode = uniqueAssignees.length >= 2 ? "shared_all" : "single";
			// CC-P0-02: recurrence_basis nikdy NULL + days se ukládá (builder), úkol a přiřazení
			// v JEDNÉ lokální transakci — pád uprostřed nesmí nechat úkol bez assignments.
			const row = buildQuickAddTaskRow({
				parsed,
				taskId,
				projectId: projId,
				name,
				assignmentMode,
				userId: session?.user?.id ?? null,
				today: dateInTimeZone(userTimeZone),
				now,
				timeZone: userTimeZone,
			});
			await powerSync.writeTransaction(async (tx) => {
				await tx.execute(quickAddInsertSql(row), row.values);
				for (const person of uniqueAssignees) {
					// project_id je NUTNÝ — sync bucket assignments je per projekt; bez něj se řádek nikdy
					// nesyncne (kolegům se přiřazení nezobrazí, po resyncu zmizí i autorovi).
					await tx.execute(
						"INSERT INTO assignments (id, task_id, project_id, user_id, created_at) VALUES (uuid(), ?, ?, ?, ?)",
						[taskId, projId, person.id, now],
					);
				}
			});
			setRaw("");
			setSugIdx(0);
			setPickedProj(null);
			setPickedPeople([]);
			onDone?.();
		} catch (err) {
			// Input zůstává (uživatel o text nepřijde); chybu ukážeme inline, ne tiše.
			console.error("[quickadd] lokální insert selhal", err);
			setSaveError(true);
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	}

	function onKey(e: KeyboardEvent<HTMLInputElement>) {
		if (sug) {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSugIdx((i) => (i + 1) % sug.length);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				setSugIdx((i) => (i - 1 + sug.length) % sug.length);
				return;
			}
			if (e.key === "Enter") {
				e.preventDefault();
				const item = sug[sugIdx] ?? sug[0];
				if (item) applySug(item);
				return;
			}
			if (e.key === "Escape") {
				e.stopPropagation();
				setSugDismissed(true);
				return;
			}
		}
		if (e.key === "Enter") {
			e.preventDefault();
			void submit();
		}
	}

	const segs = segments(raw, parsed.highlights);

	// Trvání pilulky: základní jednotky z i18n (min/h).
	const durLabel = (min: number) =>
		min < 60 ? `${min} ${t("quickadd.unitMin")}` : `${min / 60} ${t("quickadd.unitHour")}`;
	// Opakování: základní druhy → i18n; bohatší pravidla (nth/day/parity) nechají
	// lidský label parseru, aby se neztratila konkrétnost (např. „Každou středu").
	const recLabel = (r: RecurrenceRule) => {
		const base: Partial<Record<RecurrenceRule["kind"], string>> = {
			daily: t("quickadd.repDaily"),
			weekly: t("quickadd.repWeekly"),
			biweekly: t("quickadd.repBiweekly"),
			monthly: t("quickadd.repMonthly"),
			yearly: t("quickadd.repYearly"),
		};
		const isRich =
			r.weekday != null ||
			r.day != null ||
			r.nth != null ||
			r.parity != null ||
			r.kind === "monthly-nth" ||
			r.kind === "monthly-day";
		return (isRich ? undefined : base[r.kind]) ?? r.label;
	};

	// Pilulky rozpoznaných atributů
	const pills: { icon: IconName; label: string; tone?: "brass" | "overdue" }[] = [];
	if (parsed.priority) pills.push({ icon: "priorita", label: `P${parsed.priority}` });
	if (parsed.due) pills.push({ icon: "termin", label: parsed.due });
	if (parsed.startMin != null) pills.push({ icon: "termin", label: hhmm(parsed.startMin) });
	if (parsed.durationMin != null)
		pills.push({ icon: "trvani", label: durLabel(parsed.durationMin) });
	if (parsed.recurrence) pills.push({ icon: "opakovani", label: recLabel(parsed.recurrence) });
	if (parsed.deadline)
		pills.push({
			icon: "deadline",
			label: t("quickadd.deadlinePill", { date: parsed.deadline }),
		});
	if (parsed.days)
		pills.push({
			icon: "termin",
			label: t("quickadd.daysPill", { n: parsed.days }),
		});
	const pillProj = pickedProj ?? projects.find((x) => x.id === parsed.projectId);
	if (pillProj) pills.push({ icon: "projekt", label: pillProj.name });
	for (const pe of pickedPeople) pills.push({ icon: "prirazeni", label: `@${pe.name}` });
	for (const q of parsed.personQueries ?? []) {
		const r = resolvePerson(q);
		if (r.status === "ok" && r.person)
			pills.push({ icon: "prirazeni", label: `@${r.person.name}` });
		// Nerozpoznaný/nejednoznačný @token odliš (overdue tón), ať uživatel nemyslí, že přiřazení proběhlo.
		else
			pills.push({
				icon: "prirazeni",
				label:
					r.status === "ambiguous"
						? t("quickadd.personAmbiguous", { q })
						: t("quickadd.personUnknown", { q }),
				tone: "overdue",
			});
	}

	return (
		<div className="relative">
			<div className="flex gap-2">
				{/* input + overlay zvýraznění */}
				<div className="relative min-w-0 flex-1">
					<div
						aria-hidden
						className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre rounded-lg px-3 py-2 font-body text-sm"
					>
						{segs.map((s) =>
							s.mark ? (
								<span
									key={s.start}
									className="rounded-[4px] text-transparent"
									style={{
										background: "var(--w-brass-soft)",
										boxShadow: "0 0 0 2px var(--w-brass-soft)",
									}}
								>
									{s.text}
								</span>
							) : (
								<span key={s.start} className="text-transparent">
									{s.text}
								</span>
							),
						)}
					</div>
					<input
						ref={inputRef}
						value={raw}
						onChange={(e) => {
							setRaw(e.target.value);
							setSugDismissed(false);
						}}
						onKeyDown={onKey}
						placeholder={t("quickadd.placeholder")}
						aria-label={t("quickadd.placeholder")}
						className="relative w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none focus:border-brass"
					/>
				</div>
				<Button
					onClick={() => void submit()}
					disabled={!inboxId || !parsed.name.trim() || submitting}
				>
					<Icon name="pridat" size={16} />
					{t("today.add")}
				</Button>
			</div>

			{/* našeptávač */}
			{sug && (
				<ul className="absolute z-20 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-card py-1 shadow-[var(--w-shadow)]">
					{sug.map((it, i) => (
						<li key={it.id}>
							<button
								type="button"
								onMouseDown={(e) => {
									e.preventDefault();
									applySug(it);
								}}
								className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === sugIdx ? "bg-panel-2" : ""}`}
							>
								<Icon name={it.kind === "proj" ? "projekt" : "prirazeni"} size={16} />
								<span className="truncate">{it.label}</span>
							</button>
						</li>
					))}
				</ul>
			)}

			{/* selhání lokálního uložení — input zůstal, uživatel může zkusit znovu */}
			{saveError && (
				<p role="alert" className="mt-1.5 text-overdue text-xs">
					{t("quickadd.saveFailed")}
				</p>
			)}

			{/* pilulky rozpoznaných atributů */}
			{pills.length > 0 && (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{pills.map((p) => (
						<Chip key={`${p.icon}:${p.label}`} tone={p.tone ?? "brass"}>
							<Icon name={p.icon} size={13} />
							{p.label}
						</Chip>
					))}
				</div>
			)}
		</div>
	);
}
