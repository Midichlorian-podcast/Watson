import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { deviceTimeZone } from "../lib/timeZone";

type Severity = "critical" | "high" | "medium";
type RadarEvidence = {
	id: string;
	code: string;
	label: string;
	detail: string;
	weight: number;
	basis: "fact" | "projection";
	source: { type: string; id: string };
};
type RadarItem = {
	id: string;
	entityType: "task" | "decision";
	entityId: string;
	workspaceId: string;
	workspaceName: string;
	projectId: string;
	projectName: string;
	title: string;
	severity: Severity;
	score: number;
	confidence: "high" | "medium";
	targetDate: string | null;
	evidence: RadarEvidence[];
};
type RadarSnapshot = {
	rulesetVersion: "radar:v1";
	asOf: string;
	timezone: string;
	coverage: "complete" | "partial";
	total: number;
	counts: Record<Severity, number>;
	items: RadarItem[];
};

const severityMeta: Record<Severity, { label: string; color: string; bg: string }> = {
	critical: { label: "Kritické", color: "var(--w-overdue)", bg: "color-mix(in srgb, var(--w-overdue) 10%, transparent)" },
	high: { label: "Vysoké", color: "var(--w-brass-text)", bg: "color-mix(in srgb, var(--w-brass) 14%, transparent)" },
	medium: { label: "Střední", color: "var(--w-ink-2)", bg: "var(--w-panel-2)" },
};

async function loadRadar(workspaceId: string | null, timezone: string) {
	const params = new URLSearchParams({ timezone, limit: "100" });
	if (workspaceId) params.set("workspaceId", workspaceId);
	const response = await fetch(`${API_URL}/api/radar?${params}`, { credentials: "include" });
	if (!response.ok) throw new Error(response.status === 404 ? "radar_scope" : "radar_unavailable");
	return (await response.json()) as RadarSnapshot;
}

function humanDate(value: string | null) {
	if (!value) return null;
	const parsed = new Date(`${value}T12:00:00`);
	if (Number.isNaN(parsed.getTime())) return value;
	return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium" }).format(parsed);
}

export function RadarPanel({
	workspaceId,
	onOpenTask,
	onOpenDecision,
}: {
	workspaceId: string | null;
	onOpenTask: (id: string) => void;
	onOpenDecision: (id: string, workspaceId: string) => void;
}) {
	const timezone = useMemo(deviceTimeZone, []);
	const [severity, setSeverity] = useState<"all" | Severity>("all");
	const [expanded, setExpanded] = useState(false);
	const query = useQuery({
		queryKey: ["radar", workspaceId, timezone],
		queryFn: () => loadRadar(workspaceId, timezone),
		refetchInterval: 60_000,
		refetchOnWindowFocus: true,
		retry: 1,
	});
	const filtered = (query.data?.items ?? []).filter(
		(item) => severity === "all" || item.severity === severity,
	);
	const visible = expanded ? filtered : filtered.slice(0, 6);
	const asOf = query.data?.asOf
		? new Intl.DateTimeFormat("cs-CZ", { hour: "2-digit", minute: "2-digit" }).format(
				new Date(query.data.asOf),
			)
		: null;

	return (
		<section
			aria-labelledby="radar-title"
			className="mb-3.5 overflow-hidden rounded-[16px] border border-line bg-card"
			style={{ boxShadow: "var(--w-shadow-sm)" }}
		>
			<div className="flex flex-wrap items-start gap-3 border-line border-b px-4 py-4 sm:px-5">
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<h2 id="radar-title" className="font-display text-base font-extrabold text-ink">
							Watson Radar
						</h2>
						<span className="rounded-full bg-panel-2 px-2 py-1 font-mono text-[9px] font-bold text-ink-3">
							VYSVĚTLITELNÝ · LIVE
						</span>
					</div>
					<p className="mt-1 max-w-[720px] font-body text-xs leading-relaxed text-ink-3">
						Včas ukazuje práci, která může selhat. Každé skóre je součet viditelných faktů —
						žádné skryté hodnocení lidí.
					</p>
				</div>
				<div className="flex items-center gap-2">
					{asOf && <span className="font-mono text-[10px] text-ink-3">stav {asOf}</span>}
					<button
						type="button"
						onClick={() => void query.refetch()}
						disabled={query.isFetching}
						className="min-h-11 rounded-lg border border-line bg-panel-2 px-3 font-display text-xs font-semibold text-ink-2 hover:border-brass disabled:opacity-60"
					>
						{query.isFetching ? "Počítám…" : "Přepočítat"}
					</button>
				</div>
			</div>

			{query.isPending && (
				<div role="status" className="grid gap-2 p-4 sm:grid-cols-3" aria-label="Radar se načítá">
					{[0, 1, 2].map((item) => (
						<div key={item} className="h-20 animate-pulse rounded-xl bg-panel-2" />
					))}
				</div>
			)}

			{query.isError && (
				<div role="alert" className="px-4 py-5 sm:px-5">
					<div className="font-display text-sm font-bold text-ink">Radar teď nelze přepočítat</div>
					<p className="mt-1 font-body text-xs text-ink-3">
						Data nevydáváme za aktuální. Zkontrolujte spojení a zkuste načtení znovu.
					</p>
					<button
						type="button"
						onClick={() => void query.refetch()}
						className="mt-3 min-h-11 rounded-lg bg-ink px-4 font-display text-xs font-bold text-card"
					>
						Zkusit znovu
					</button>
				</div>
			)}

			{query.data && (
				<>
					<div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
						<FilterChip
							active={severity === "all"}
							label={`Vše ${query.data.total}`}
							onClick={() => setSeverity("all")}
						/>
						{(["critical", "high", "medium"] as const).map((value) => (
							<FilterChip
								key={value}
								active={severity === value}
								label={`${severityMeta[value].label} ${query.data.counts[value]}`}
								onClick={() => setSeverity(value)}
							/>
						))}
						<div className="flex-1" />
						<span className="font-body text-[10px] text-ink-3">pravidla {query.data.rulesetVersion}</span>
					</div>
					{query.data.coverage === "partial" && (
						<div role="status" className="mx-4 mb-3 rounded-lg border border-brass/40 bg-brass/10 px-3 py-2 font-body text-xs text-ink-2 sm:mx-5">
							Objem dat překročil bezpečný limit okamžitého výpočtu. Zobrazený Radar je jen částečný.
						</div>
					)}
					<div className="divide-y divide-line" aria-live="polite">
						{visible.map((risk) => {
							const meta = severityMeta[risk.severity];
							return (
								<details key={risk.id} className="group px-4 py-3 sm:px-5">
									<summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brass/40">
										<span
											className="shrink-0 rounded-full px-2 py-1 font-display text-[10px] font-bold"
											style={{ color: meta.color, background: meta.bg }}
										>
											{meta.label}
										</span>
										<div className="min-w-0 flex-1">
											<div className="truncate font-display text-[13px] font-bold text-ink">{risk.title}</div>
											<div className="mt-0.5 truncate font-body text-[10.5px] text-ink-3">
												{risk.workspaceName} · {risk.projectName}
												{risk.targetDate ? ` · ${humanDate(risk.targetDate)}` : ""}
											</div>
										</div>
										<span className="shrink-0 text-right">
											<span className="block font-mono text-sm font-bold text-ink">{risk.score}</span>
											<span className="block font-body text-[9px] text-ink-3">riziko práce</span>
										</span>
										<span aria-hidden className="text-ink-3 transition-transform group-open:rotate-180">⌄</span>
									</summary>
									<div className="ml-0 mt-3 rounded-xl bg-panel-2 p-3 sm:ml-[74px]">
										<div className="mb-2 flex flex-wrap items-center gap-2 font-body text-[10px] text-ink-3">
											<span>{risk.confidence === "high" ? "Vysoká jistota vstupů" : "Střední jistota vstupů"}</span>
											<span aria-hidden>·</span>
											<span>součet zveřejněných vah, maximum 100</span>
										</div>
										<ul className="space-y-2">
											{risk.evidence.map((evidence) => (
												<li key={evidence.id} className="flex items-start gap-2">
													<span className="mt-0.5 shrink-0 rounded bg-card px-1.5 py-0.5 font-mono text-[9px] font-bold text-ink-2">
														+{evidence.weight}
													</span>
													<span className="min-w-0 font-body text-[11px] leading-relaxed text-ink-2">
														<b>{evidence.label}.</b> {evidence.detail}{" "}
														<span className="text-ink-3">({evidence.basis === "fact" ? "ověřený fakt" : "projekce"})</span>
													</span>
												</li>
											))}
										</ul>
										<button
											type="button"
											onClick={() =>
												risk.entityType === "task"
													? onOpenTask(risk.entityId)
													: onOpenDecision(risk.entityId, risk.workspaceId)
											}
											className="mt-3 min-h-11 rounded-lg bg-ink px-4 font-display text-xs font-bold text-card"
										>
											{risk.entityType === "task" ? "Otevřít úkol" : "Otevřít rozhodnutí"}
										</button>
									</div>
								</details>
							);
						})}
						{filtered.length === 0 && (
							<div className="px-5 py-8 text-center">
								<div className="font-display text-sm font-bold text-ink">Žádné riziko v tomto filtru</div>
								<p className="mt-1 font-body text-xs text-ink-3">
									Radar nenašel termín, blokaci, kolizi ani revizi, která by sem patřila.
								</p>
							</div>
						)}
					</div>
					{filtered.length > 6 && (
						<div className="border-line border-t px-4 py-3 text-center">
							<button
								type="button"
								onClick={() => setExpanded((value) => !value)}
								className="min-h-11 px-3 font-display text-xs font-bold text-brass-text hover:underline"
							>
								{expanded ? "Zobrazit nejdůležitější" : `Zobrazit všech ${filtered.length}`}
							</button>
						</div>
					)}
				</>
			)}
		</section>
	);
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className="min-h-11 rounded-full border px-3 font-display text-[11px] font-bold"
			style={{
				background: active ? "var(--w-ink)" : "var(--w-card)",
				color: active ? "var(--w-card)" : "var(--w-ink-2)",
				borderColor: active ? "var(--w-ink)" : "var(--w-line)",
			}}
		>
			{label}
		</button>
	);
}
