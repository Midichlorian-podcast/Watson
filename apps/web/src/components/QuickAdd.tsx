import { useTranslation } from "@watson/i18n";
import { Button, Chip, Icon, type IconName } from "@watson/ui";
import {
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSession } from "../lib/auth-client";
import { powerSync } from "../lib/powersync/db";
import type { Highlight } from "../lib/quickadd";
import { parseQuick } from "../lib/quickadd";
import { todayISO } from "../lib/tasks";

type Project = { id: string; name: string };
type Person = { id: string; name: string; initials: string };

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const durLabel = (min: number) => (min < 60 ? `${min} min` : `${min / 60} h`);

/** Segmenty rawName pro overlay zvýraznění (z highlights rozsahů). */
function segments(raw: string, hl: Highlight[]) {
	const segs: { text: string; mark: boolean }[] = [];
	let pos = 0;
	for (const h of hl) {
		if (h.start > pos)
			segs.push({ text: raw.slice(pos, h.start), mark: false });
		segs.push({ text: raw.slice(h.start, h.end), mark: true });
		pos = h.end;
	}
	if (pos < raw.length) segs.push({ text: raw.slice(pos), mark: false });
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
	const [raw, setRaw] = useState("");
	const [sugIdx, setSugIdx] = useState(0);
	// Výběr z našeptávače se aplikuje jako atribut (token pryč), ne jako text (audit re:add-task).
	const [pickedProj, setPickedProj] = useState<Project | null>(null);
	const [pickedPeople, setPickedPeople] = useState<Person[]>([]);
	const [sugDismissed, setSugDismissed] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	const ctx = useMemo(
		() => ({ today: todayISO(), projects, people }),
		[projects, people],
	);
	const parsed = useMemo(() => parseQuick(raw, ctx), [raw, ctx]);

	// Našeptávač: token na konci vstupu
	const sugRaw = useMemo(() => {
		const mProj = raw.match(/#(\p{L}*)$/u);
		if (mProj) {
			const q = mProj[1]!.toLowerCase();
			const list = projects
				.filter((p) => p.name.toLowerCase().includes(q))
				.slice(0, 6)
				.map((p) => ({
					kind: "proj" as const,
					id: p.id,
					label: p.name,
					token: mProj[0]!,
				}));
			return list.length ? list : null;
		}
		const mPer = raw.match(/[@+](\p{L}*)$/u);
		if (mPer) {
			const q = mPer[1]!.toLowerCase();
			const list = people
				.filter(
					(p) =>
						p.name.toLowerCase().includes(q) ||
						p.initials.toLowerCase().startsWith(q),
				)
				.slice(0, 5)
				.map((p) => ({
					kind: "person" as const,
					id: p.id,
					label: p.name,
					token: mPer[0]!,
				}));
			return list.length ? list : null;
		}
		return null;
	}, [raw, projects, people]);
	const sug = sugDismissed ? null : sugRaw;

	function applySug(item: {
		id: string;
		label: string;
		token: string;
		kind: "proj" | "person";
	}) {
		// Odstranit token ze vstupu a atribut si zapamatovat (prototyp: výběr aplikuje entitu).
		setRaw(raw.slice(0, raw.length - item.token.length));
		if (item.kind === "proj") {
			const pr = projects.find((x) => x.id === item.id);
			if (pr) setPickedProj(pr);
		} else {
			const pe = people.find((x) => x.id === item.id);
			if (pe)
				setPickedPeople((arr) =>
					arr.some((x) => x.id === pe.id) ? arr : [...arr, pe],
				);
		}
		setSugIdx(0);
		inputRef.current?.focus();
	}

	async function submit() {
		// Bez fallbacku na raw: po vytažení formulí musí zbýt reálný název (README ř. 48).
		const name = parsed.name.trim();
		if (!name || !inboxId) return;
		// start_date = termín (nebo dnes) + čas dne, pokud parser rozpoznal čas.
		let startDate: string | null = null;
		if (parsed.startMin != null) {
			const base = parsed.due ?? todayISO();
			const hh = String(Math.floor(parsed.startMin / 60)).padStart(2, "0");
			const mm = String(parsed.startMin % 60).padStart(2, "0");
			startDate = `${base}T${hh}:${mm}:00`;
		}
		const taskId = crypto.randomUUID();
		const now = new Date().toISOString();
		await powerSync.execute(
			"INSERT INTO tasks (id, project_id, name, priority, due_date, start_date, deadline, duration_min, recurrence, recurrence_rule, recurrence_basis, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[
				taskId,
				pickedProj?.id ?? parsed.projectId ?? inboxId,
				name,
				parsed.priority ?? 2,
				parsed.due ?? null,
				startDate,
				parsed.deadline ?? null,
				parsed.durationMin ?? null,
				parsed.recurrence?.label ?? null,
				parsed.recurrence ? JSON.stringify(parsed.recurrence) : null,
				parsed.recurrence ? "due_date" : null,
				session?.user?.id ?? null,
				now,
			],
		);
		// @osoby: vybrané z našeptávače + rozpoznané parserem → reálná přiřazení.
		const assigned = new Set<string>();
		const resolved: Person[] = [...pickedPeople];
		for (const q of parsed.personQueries ?? []) {
			const ql = q.toLowerCase();
			const person = people.find(
				(p) =>
					p.name.toLowerCase().includes(ql) ||
					p.initials.toLowerCase().startsWith(ql),
			);
			if (person) resolved.push(person);
		}
		for (const person of resolved) {
			if (assigned.has(person.id)) continue;
			assigned.add(person.id);
			await powerSync.execute(
				"INSERT INTO assignments (id, task_id, user_id, created_at) VALUES (uuid(), ?, ?, ?)",
				[taskId, person.id, now],
			);
		}
		setRaw("");
		setSugIdx(0);
		setPickedProj(null);
		setPickedPeople([]);
		onDone?.();
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
				applySug(sug[sugIdx] ?? sug[0]!);
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

	// Pilulky rozpoznaných atributů
	const pills: { icon: IconName; label: string }[] = [];
	if (parsed.priority)
		pills.push({ icon: "priorita", label: `P${parsed.priority}` });
	if (parsed.due) pills.push({ icon: "termin", label: parsed.due });
	if (parsed.startMin != null)
		pills.push({ icon: "termin", label: hhmm(parsed.startMin) });
	if (parsed.durationMin != null)
		pills.push({ icon: "trvani", label: durLabel(parsed.durationMin) });
	if (parsed.recurrence)
		pills.push({ icon: "opakovani", label: parsed.recurrence.label });
	if (parsed.deadline)
		pills.push({ icon: "deadline", label: `do ${parsed.deadline}` });
	if (parsed.days) pills.push({ icon: "termin", label: `${parsed.days} dní` });
	const pillProj =
		pickedProj ?? projects.find((x) => x.id === parsed.projectId);
	if (pillProj) pills.push({ icon: "projekt", label: pillProj.name });
	for (const pe of pickedPeople)
		pills.push({ icon: "prirazeni", label: `@${pe.name}` });
	for (const q of parsed.personQueries ?? [])
		pills.push({ icon: "prirazeni", label: `@${q}` });

	return (
		<div className="relative">
			<div className="flex gap-2">
				{/* input + overlay zvýraznění */}
				<div className="relative min-w-0 flex-1">
					<div
						aria-hidden
						className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre rounded-lg px-3 py-2 font-body text-sm"
					>
						{segs.map((s, i) =>
							s.mark ? (
								<span
									key={i}
									className="rounded-[4px] text-transparent"
									style={{
										background: "var(--w-brass-soft)",
										boxShadow: "0 0 0 2px var(--w-brass-soft)",
									}}
								>
									{s.text}
								</span>
							) : (
								<span key={i} className="text-transparent">
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
						className="relative w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none focus:border-brass"
					/>
				</div>
				<Button
					onClick={() => void submit()}
					disabled={!inboxId || !parsed.name.trim()}
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
								<Icon
									name={it.kind === "proj" ? "projekt" : "prirazeni"}
									size={16}
								/>
								<span className="truncate">{it.label}</span>
							</button>
						</li>
					))}
				</ul>
			)}

			{/* pilulky rozpoznaných atributů */}
			{pills.length > 0 && (
				<div className="mt-2 flex flex-wrap gap-1.5">
					{pills.map((p, i) => (
						<Chip key={i} tone="brass">
							<Icon name={p.icon} size={13} />
							{p.label}
						</Chip>
					))}
				</div>
			)}
		</div>
	);
}
