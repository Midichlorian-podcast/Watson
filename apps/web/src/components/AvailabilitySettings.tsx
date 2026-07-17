import { useQuery } from "@tanstack/react-query";
import i18n, { useTranslation } from "@watson/i18n";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import {
	dateInTimeZone,
	isValidTimeZone,
	wallTimeFromInstant,
	zonedDateTimeToIso,
} from "../lib/timeZone";
import { showToast } from "../lib/toast";
import { useOverlayLayer } from "../lib/useOverlayLayer";

type Interval = { startMinute: number; endMinute: number };
type WorkingHours = { enabled: boolean; days: Array<{ day: number; intervals: Interval[] }> };
type QuietHours = { enabled: boolean; days: number[]; startMinute: number; endMinute: number };
type Profile = {
	id: string | null;
	workingHours: WorkingHours;
	quietHours: QuietHours;
	manualSnoozeStartedAt: string | null;
	manualSnoozeUntil: string | null;
	version: number;
};
type AvailabilityStatus = {
	kind: "manual_snooze" | "focus" | "unavailable" | "absence" | "holiday" | "quiet_hours";
	until: string | null;
	label: string | null;
};
type AvailabilityMember = {
	userId: string;
	name: string;
	image: string | null;
	timezone: string;
	profile: Profile;
	status: AvailabilityStatus | null;
	withinWorkingHours: boolean | null;
};
type AvailabilityBlock = {
	id: string;
	workspaceId: string;
	userId: string;
	kind: "focus" | "unavailable" | "absence" | "holiday";
	startsAt: string;
	endsAt: string;
	timezone: string;
	label: string | null;
	visibility: "team" | "private";
	source: "manual" | "calendar" | "luckyos";
	version: number;
};
type AvailabilityResponse = {
	generatedAt: string;
	members: AvailabilityMember[];
	blocks: AvailabilityBlock[];
};

type Draft = { timezone: string; workingHours: WorkingHours; quietHours: QuietHours };
type BlockDraft = {
	id: string | null;
	version: number | null;
	kind: AvailabilityBlock["kind"];
	timezone: string;
	startLocal: string;
	endLocal: string;
	label: string;
	visibility: AvailabilityBlock["visibility"];
};

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const SECTION_LABEL = {
	fontWeight: 700,
	fontSize: 11,
	letterSpacing: ".06em",
	textTransform: "uppercase" as const,
	color: "var(--w-ink-3)",
	margin: "0 0 8px",
};
const CARD = {
	background: "var(--w-card)",
	border: "1px solid var(--w-line)",
	borderRadius: 13,
};
const INPUT = {
	minHeight: 44,
	border: "1px solid var(--w-line)",
	borderRadius: 8,
	background: "var(--w-panel-2)",
	color: "var(--w-ink)",
	padding: "8px 10px",
	fontSize: 12.5,
};
const BUTTON = {
	minHeight: 44,
	borderRadius: 9,
	border: "1px solid var(--w-line)",
	background: "var(--w-card)",
	color: "var(--w-ink-2)",
	padding: "8px 12px",
	fontSize: 12,
	fontWeight: 700,
	cursor: "pointer",
};

const clone = <T,>(value: T): T => structuredClone(value);
const minutesToTime = (minutes: number) =>
	`${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const timeToMinutes = (value: string) => {
	const [hours, minutes] = value.split(":").map(Number);
	return (hours ?? 0) * 60 + (minutes ?? 0);
};
const addIsoDay = (iso: string, days: number) => {
	const date = new Date(`${iso}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
};
const localDateTimeValue = (instant: Date, timezone: string) => {
	const date = dateInTimeZone(timezone, instant);
	const time = wallTimeFromInstant(instant.toISOString(), timezone)?.slice(0, 5) ?? "09:00";
	return `${date}T${time}`;
};
const defaultBlockDraft = (timezone: string): BlockDraft => {
	const now = new Date();
	const rounded = new Date(Math.ceil(now.getTime() / 1_800_000) * 1_800_000);
	return {
		id: null,
		version: null,
		kind: "focus",
		timezone,
		startLocal: localDateTimeValue(rounded, timezone),
		endLocal: localDateTimeValue(new Date(rounded.getTime() + 60 * 60_000), timezone),
		label: "",
		visibility: "team",
	};
};

function statusKey(kind: AvailabilityStatus["kind"]) {
	return `availability.status.${kind}`;
}

export function AvailabilitySettings({ workspaceId }: { workspaceId: string | undefined }) {
	const { t } = useTranslation();
	const { data: session } = useSession();
	const userId = session?.user?.id;
	const query = useQuery({
		queryKey: ["availability", workspaceId],
		enabled: Boolean(workspaceId && userId),
		queryFn: async () => {
			const response = await fetch(`${API_URL}/api/workspaces/${workspaceId}/availability`, {
				credentials: "include",
			});
			if (!response.ok) throw new Error("availability_load_failed");
			return (await response.json()) as AvailabilityResponse;
		},
		refetchInterval: 60_000,
	});
	const mine = query.data?.members.find((member) => member.userId === userId);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [blockOpen, setBlockOpen] = useState(false);
	const [blockDraft, setBlockDraft] = useState<BlockDraft | null>(null);
	const blockDialogRef = useOverlayLayer<HTMLDivElement>(blockOpen, () => {
		setBlockOpen(false);
		setBlockDraft(null);
	});

	useEffect(() => {
		if (!mine || dirty) return;
		setDraft({
			timezone: mine.timezone,
			workingHours: clone(mine.profile.workingHours),
			quietHours: clone(mine.profile.quietHours),
		});
	}, [dirty, mine]);
	const ownBlocks = useMemo(
		() =>
			(query.data?.blocks ?? [])
				.filter((block) => block.userId === userId && new Date(block.endsAt).getTime() > Date.now())
				.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)),
		[query.data?.blocks, userId],
	);
	const teamUnavailable = (query.data?.members ?? []).filter((member) => member.status);

	const mutate = async (path: string, method: string, body: unknown) => {
		const response = await fetch(`${API_URL}${path}`, {
			method,
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!response.ok) {
			const problem = (await response.json().catch(() => ({}))) as { error?: string };
			throw new Error(problem.error ?? "availability_save_failed");
		}
		return response.json() as Promise<Record<string, unknown>>;
	};

	async function refreshAfterMutation(message: string) {
		setDirty(false);
		await query.refetch();
		showToast(message);
	}

	async function saveProfile() {
		if (!workspaceId || !mine || !draft || busy) return;
		if (!isValidTimeZone(draft.timezone)) {
			showToast(t("availability.invalidTimezone"));
			return;
		}
		setBusy(true);
		try {
			await mutate(`/api/workspaces/${workspaceId}/availability/me`, "PUT", {
				expectedVersion: mine.profile.version,
				...draft,
			});
			await refreshAfterMutation(t("availability.profileSaved"));
		} catch (error) {
			if (error instanceof Error && error.message === "stale_profile") await query.refetch();
			showToast(t("availability.saveFailed"));
		} finally {
			setBusy(false);
		}
	}

	async function startSnooze(until: string | null) {
		if (!workspaceId || !mine || busy) return;
		setBusy(true);
		try {
			await mutate(`/api/workspaces/${workspaceId}/availability/me/snooze`, "PUT", {
				expectedVersion: mine.profile.version,
				until,
			});
			await refreshAfterMutation(t("availability.snoozeStarted"));
		} catch {
			showToast(t("availability.saveFailed"));
		} finally {
			setBusy(false);
		}
	}

	async function stopSnooze() {
		if (!workspaceId || !mine || busy) return;
		setBusy(true);
		try {
			const result = await mutate(
				`/api/workspaces/${workspaceId}/availability/me/snooze`,
				"DELETE",
				{ expectedVersion: mine.profile.version },
			);
			await refreshAfterMutation(
				t("availability.snoozeStopped", { count: Number(result.releasedReminders ?? 0) }),
			);
		} catch {
			showToast(t("availability.saveFailed"));
		} finally {
			setBusy(false);
		}
	}

	function tomorrowAtNine(timezone: string) {
		const tomorrow = addIsoDay(dateInTimeZone(timezone), 1);
		return zonedDateTimeToIso(tomorrow, "09:00", timezone) ?? new Date(Date.now() + 12 * 60 * 60_000).toISOString();
	}

	function setWorkingDayEnabled(day: number, enabled: boolean) {
		if (!draft) return;
		const days = draft.workingHours.days.filter((entry) => entry.day !== day);
		if (enabled) days.push({ day, intervals: [{ startMinute: 9 * 60, endMinute: 17 * 60 }] });
		setDraft({
			...draft,
			workingHours: { ...draft.workingHours, days: days.sort((left, right) => left.day - right.day) },
		});
		setDirty(true);
	}

	function updateInterval(day: number, index: number, field: keyof Interval, value: string) {
		if (!draft) return;
		const minutes = timeToMinutes(value);
		const workingHours = clone(draft.workingHours);
		const target = workingHours.days.find((entry) => entry.day === day)?.intervals[index];
		if (!target) return;
		target[field] = minutes;
		setDraft({ ...draft, workingHours });
		setDirty(true);
	}

	function addInterval(day: number) {
		if (!draft) return;
		const workingHours = clone(draft.workingHours);
		const target = workingHours.days.find((entry) => entry.day === day);
		if (!target || target.intervals.length >= 4) return;
		const lastEnd = Math.max(12 * 60, ...target.intervals.map((interval) => interval.endMinute));
		if (lastEnd > 23 * 60 + 30) return;
		target.intervals.push({ startMinute: lastEnd, endMinute: Math.min(lastEnd + 60, 24 * 60) });
		setDraft({ ...draft, workingHours });
		setDirty(true);
	}

	function removeInterval(day: number, index: number) {
		if (!draft) return;
		const workingHours = clone(draft.workingHours);
		const target = workingHours.days.find((entry) => entry.day === day);
		if (!target) return;
		target.intervals.splice(index, 1);
		if (target.intervals.length === 0) workingHours.days = workingHours.days.filter((entry) => entry.day !== day);
		setDraft({ ...draft, workingHours });
		setDirty(true);
	}

	function openNewBlock() {
		const timezone = draft?.timezone ?? mine?.timezone ?? "Europe/Prague";
		setBlockDraft(defaultBlockDraft(timezone));
		setBlockOpen(true);
	}

	function openEditBlock(block: AvailabilityBlock) {
		setBlockDraft({
			id: block.id,
			version: block.version,
			kind: block.kind,
			timezone: block.timezone,
			startLocal: localDateTimeValue(new Date(block.startsAt), block.timezone),
			endLocal: localDateTimeValue(new Date(block.endsAt), block.timezone),
			label: block.label ?? "",
			visibility: block.visibility,
		});
		setBlockOpen(true);
	}

	async function saveBlock() {
		if (!workspaceId || !blockDraft || busy) return;
		const timezone = blockDraft.timezone;
		const [startDate, startTime] = blockDraft.startLocal.split("T");
		const [endDate, endTime] = blockDraft.endLocal.split("T");
		const startsAt = startDate && startTime ? zonedDateTimeToIso(startDate, startTime, timezone) : null;
		const endsAt = endDate && endTime ? zonedDateTimeToIso(endDate, endTime, timezone) : null;
		if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
			showToast(t("availability.invalidBlockTime"));
			return;
		}
		setBusy(true);
		try {
			const body = {
				kind: blockDraft.kind,
				startsAt,
				endsAt,
				timezone,
				label: blockDraft.label.trim() || null,
				visibility: blockDraft.visibility,
			};
			if (blockDraft.id && blockDraft.version) {
				await mutate(
					`/api/workspaces/${workspaceId}/availability/blocks/${blockDraft.id}`,
					"PUT",
					{ ...body, expectedVersion: blockDraft.version },
				);
			} else {
				await mutate(`/api/workspaces/${workspaceId}/availability/blocks`, "POST", {
					...body,
					id: crypto.randomUUID(),
				});
			}
			setBlockOpen(false);
			setBlockDraft(null);
			await refreshAfterMutation(t("availability.blockSaved"));
		} catch {
			showToast(t("availability.saveFailed"));
		} finally {
			setBusy(false);
		}
	}

	async function cancelBlock(block: AvailabilityBlock) {
		if (!workspaceId || busy || !window.confirm(t("availability.cancelBlockConfirm"))) return;
		setBusy(true);
		try {
			await mutate(`/api/workspaces/${workspaceId}/availability/blocks/${block.id}`, "DELETE", {
				expectedVersion: block.version,
			});
			await refreshAfterMutation(t("availability.blockCancelled"));
		} catch {
			showToast(t("availability.saveFailed"));
		} finally {
			setBusy(false);
		}
	}

	if (!workspaceId) return null;
	if (query.isLoading || !mine || !draft) {
		return (
			<section aria-labelledby="availability-settings-title">
				<h2 id="availability-settings-title" className="font-display" style={SECTION_LABEL}>
					{t("availability.title")}
				</h2>
				<div style={{ ...CARD, padding: 16, color: "var(--w-ink-3)", fontSize: 12.5 }}>
					{query.isError ? t("availability.loadFailed") : t("common.loading")}
				</div>
			</section>
		);
	}

	const manualSnoozeActive = Boolean(
		mine.profile.manualSnoozeStartedAt &&
		(!mine.profile.manualSnoozeUntil || Date.parse(mine.profile.manualSnoozeUntil) > Date.now()),
	);
	const formatUntil = (value: string | null) =>
		value
			? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
			: t("availability.untilFurtherNotice");

	return (
		<section aria-labelledby="availability-settings-title">
			<h2 id="availability-settings-title" className="font-display" style={SECTION_LABEL}>
				{t("availability.title")}
			</h2>
			<div style={{ ...CARD, overflow: "hidden", marginBottom: 22 }}>
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						alignItems: "center",
						gap: 12,
						padding: 16,
						background: manualSnoozeActive ? "var(--w-brass-soft)" : "var(--w-card)",
					}}
				>
					<div
						aria-hidden
						style={{
							width: 38,
							height: 38,
							borderRadius: 12,
							display: "grid",
							placeItems: "center",
							background: manualSnoozeActive ? "var(--w-brass)" : "var(--w-panel-2)",
							color: manualSnoozeActive ? "#fff" : "var(--w-ink-2)",
							fontSize: 19,
						}}
					>
						☾
					</div>
					<div style={{ flex: 1, minWidth: 0 }}>
						<div className="font-display" style={{ fontWeight: 750, color: "var(--w-ink)", fontSize: 14 }}>
							{manualSnoozeActive ? t("availability.snoozeActive") : t("availability.snoozeReady")}
						</div>
						<div style={{ color: "var(--w-ink-3)", fontSize: 12, marginTop: 2 }}>
							{manualSnoozeActive
								? t("availability.snoozeActiveDesc", { until: formatUntil(mine.profile.manualSnoozeUntil) })
								: t("availability.snoozeReadyDesc")}
						</div>
					</div>
					{manualSnoozeActive ? (
						<button type="button" disabled={busy} onClick={() => void stopSnooze()} style={BUTTON}>
							{t("availability.stopSnooze")}
						</button>
					) : (
						<div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 }}>
							<button
								type="button"
								disabled={busy}
								onClick={() => void startSnooze(new Date(Date.now() + 60 * 60_000).toISOString())}
								style={BUTTON}
							>
								{t("availability.oneHour")}
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={() => void startSnooze(tomorrowAtNine(draft.timezone))}
								style={BUTTON}
							>
								{t("availability.untilTomorrow")}
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={() => void startSnooze(null)}
								style={{ ...BUTTON, borderColor: "var(--w-brass)", color: "var(--w-brass-text)" }}
							>
								{t("availability.indefinite")}
							</button>
						</div>
					)}
				</div>

				<details style={{ borderTop: "1px solid var(--w-line)" }}>
					<summary
						className="font-display"
						style={{ padding: "14px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13, color: "var(--w-ink)" }}
					>
						{t("availability.scheduleTitle")}
					</summary>
					<div style={{ padding: "0 16px 16px", display: "grid", gap: 16 }}>
						<label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--w-ink-2)" }}>
							<span className="font-display" style={{ fontWeight: 700 }}>{t("availability.timezone")}</span>
							<input
								value={draft.timezone}
								onChange={(event) => {
									setDraft({ ...draft, timezone: event.target.value });
									setDirty(true);
								}}
								list="watson-timezones"
								style={INPUT}
							/>
							<datalist id="watson-timezones">
								<option value="Europe/Prague" />
								<option value="Europe/Paris" />
								<option value="Europe/London" />
								<option value="UTC" />
							</datalist>
						</label>

						<div>
							<label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--w-ink)" }}>
								<input
									type="checkbox"
									checked={draft.workingHours.enabled}
									onChange={(event) => {
										setDraft({ ...draft, workingHours: { ...draft.workingHours, enabled: event.target.checked } });
										setDirty(true);
									}}
								/>
								<strong>{t("availability.workingHours")}</strong>
							</label>
							<p style={{ margin: "5px 0 10px 24px", fontSize: 11.5, color: "var(--w-ink-3)" }}>
								{t("availability.workingHoursDesc")}
							</p>
							{draft.workingHours.enabled && (
								<div style={{ display: "grid", gap: 7 }}>
									{DAY_KEYS.map((key, index) => {
										const day = index + 1;
										const configured = draft.workingHours.days.find((entry) => entry.day === day);
										const canAddInterval = Boolean(
											configured &&
												configured.intervals.length < 4 &&
												Math.max(0, ...configured.intervals.map((interval) => interval.endMinute)) <= 23 * 60 + 30,
										);
										return (
											<div key={key} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
												<label style={{ width: 42, display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
													<input type="checkbox" checked={Boolean(configured)} onChange={(event) => setWorkingDayEnabled(day, event.target.checked)} />
													{t(`availability.days.${key}`)}
												</label>
										{configured?.intervals.map((interval, intervalIndex) => (
											<div key={`${day}-${interval.startMinute}-${interval.endMinute}`} style={{ display: "flex", alignItems: "center", gap: 5 }}>
														<input aria-label={t("availability.from")} type="time" value={minutesToTime(interval.startMinute)} onChange={(event) => updateInterval(day, intervalIndex, "startMinute", event.target.value)} style={{ ...INPUT, width: 106 }} />
														<span style={{ color: "var(--w-ink-3)" }}>–</span>
														<input aria-label={t("availability.to")} type="time" value={minutesToTime(interval.endMinute)} onChange={(event) => updateInterval(day, intervalIndex, "endMinute", event.target.value)} style={{ ...INPUT, width: 106 }} />
														<button type="button" aria-label={t("availability.removeInterval")} onClick={() => removeInterval(day, intervalIndex)} style={{ ...BUTTON, width: 44, padding: 0 }}>×</button>
													</div>
												))}
											{canAddInterval && (
												<button type="button" onClick={() => addInterval(day)} style={{ ...BUTTON, padding: "5px 9px" }}>+ {t("availability.interval")}</button>
												)}
											</div>
										);
									})}
								</div>
							)}
						</div>

						<div style={{ borderTop: "1px solid var(--w-line)", paddingTop: 14 }}>
							<label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--w-ink)" }}>
								<input
									type="checkbox"
									checked={draft.quietHours.enabled}
									onChange={(event) => {
										setDraft({ ...draft, quietHours: { ...draft.quietHours, enabled: event.target.checked } });
										setDirty(true);
									}}
								/>
								<strong>{t("availability.quietHours")}</strong>
							</label>
							<p style={{ margin: "5px 0 10px 24px", fontSize: 11.5, color: "var(--w-ink-3)" }}>
								{t("availability.quietHoursDesc")}
							</p>
							{draft.quietHours.enabled && (
								<div style={{ marginLeft: 24, display: "grid", gap: 10 }}>
									<div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
										{DAY_KEYS.map((key, index) => {
											const day = index + 1;
											const active = draft.quietHours.days.includes(day);
											return (
												<button
													key={key}
													type="button"
													aria-pressed={active}
													onClick={() => {
														const days = active ? draft.quietHours.days.filter((value) => value !== day) : [...draft.quietHours.days, day].sort();
														if (days.length === 0) return;
														setDraft({ ...draft, quietHours: { ...draft.quietHours, days } });
														setDirty(true);
													}}
												style={{ ...BUTTON, padding: "5px 9px", background: active ? "var(--w-brass-soft)" : "var(--w-card)", borderColor: active ? "var(--w-brass)" : "var(--w-line)" }}
												>
													{t(`availability.days.${key}`)}
												</button>
											);
										})}
									</div>
									<div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
										<input aria-label={t("availability.quietStart")} type="time" value={minutesToTime(draft.quietHours.startMinute)} onChange={(event) => { setDraft({ ...draft, quietHours: { ...draft.quietHours, startMinute: timeToMinutes(event.target.value) } }); setDirty(true); }} style={{ ...INPUT, width: 112 }} />
										<span style={{ color: "var(--w-ink-3)" }}>–</span>
										<input aria-label={t("availability.quietEnd")} type="time" value={minutesToTime(draft.quietHours.endMinute)} onChange={(event) => { setDraft({ ...draft, quietHours: { ...draft.quietHours, endMinute: timeToMinutes(event.target.value) } }); setDirty(true); }} style={{ ...INPUT, width: 112 }} />
									</div>
								</div>
							)}
						</div>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--w-line)", paddingTop: 14 }}>
							<span aria-live="polite" style={{ fontSize: 11.5, color: "var(--w-ink-3)" }}>
								{dirty ? t("availability.unsaved") : t("availability.savedVersion", { version: mine.profile.version })}
							</span>
							<button type="button" disabled={!dirty || busy} onClick={() => void saveProfile()} style={{ ...BUTTON, background: dirty ? "var(--w-brass)" : "var(--w-panel-2)", color: dirty ? "#fff" : "var(--w-ink-3)", cursor: !dirty || busy ? "not-allowed" : "pointer" }}>
								{busy ? t("common.saving") : t("common.save")}
							</button>
						</div>
					</div>
				</details>

				<div style={{ borderTop: "1px solid var(--w-line)", padding: 16 }}>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
						<div>
							<div className="font-display" style={{ fontWeight: 700, fontSize: 13.5, color: "var(--w-ink)" }}>
								{t("availability.blocksTitle")}
							</div>
							<div style={{ fontSize: 11.5, color: "var(--w-ink-3)", marginTop: 3 }}>
								{t("availability.blocksDesc")}
							</div>
						</div>
						<button type="button" onClick={openNewBlock} style={{ ...BUTTON, borderColor: "var(--w-brass)", color: "var(--w-brass-text)" }}>
							+ {t("availability.addBlock")}
						</button>
					</div>
					{ownBlocks.length === 0 ? (
						<div style={{ marginTop: 12, padding: 12, borderRadius: 9, background: "var(--w-panel-2)", fontSize: 12, color: "var(--w-ink-3)" }}>
							{t("availability.noBlocks")}
						</div>
					) : (
						<div style={{ display: "grid", gap: 7, marginTop: 12 }}>
							{ownBlocks.map((block) => (
								<div key={block.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: 10, border: "1px solid var(--w-line)", borderRadius: 10, background: block.kind === "focus" ? "repeating-linear-gradient(135deg, var(--w-panel-2), var(--w-panel-2) 7px, var(--w-card) 7px, var(--w-card) 14px)" : "var(--w-card)" }}>
									<div style={{ flex: 1, minWidth: 0 }}>
										<div className="font-display" style={{ fontWeight: 700, fontSize: 12.5, color: "var(--w-ink)" }}>
											{t(`availability.kind.${block.kind}`)}{block.label ? ` · ${block.label}` : ""}
										</div>
										<div style={{ fontSize: 11.5, color: "var(--w-ink-3)", marginTop: 2 }}>
											{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(block.startsAt))} – {new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(block.endsAt))}
											{block.visibility === "private" ? ` · ${t("availability.privateLabel")}` : ""}
										</div>
									</div>
									{block.source === "manual" && (
										<>
												<button type="button" onClick={() => openEditBlock(block)} style={{ ...BUTTON, padding: "5px 9px" }}>{t("common.edit")}</button>
												<button type="button" onClick={() => void cancelBlock(block)} style={{ ...BUTTON, padding: "5px 9px", color: "var(--w-overdue)" }}>{t("common.cancel")}</button>
										</>
									)}
								</div>
							))}
						</div>
					)}
				</div>

				<div style={{ borderTop: "1px solid var(--w-line)", padding: 16 }}>
					<div className="font-display" style={{ fontWeight: 700, fontSize: 13.5, color: "var(--w-ink)" }}>
						{t("availability.teamNow")}
					</div>
					<div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 9 }}>
						{teamUnavailable.length === 0 ? (
							<span style={{ fontSize: 12, color: "var(--w-ink-3)" }}>{t("availability.teamAvailable")}</span>
						) : (
							teamUnavailable.map((member) => (
								<span key={member.userId} style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 32, borderRadius: 999, padding: "4px 10px", background: "var(--w-panel-2)", border: "1px solid var(--w-line)", color: "var(--w-ink-2)", fontSize: 11.5 }}>
									<span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--w-brass)" }} />
									<strong>{member.name}</strong> · {t(statusKey(member.status?.kind ?? "unavailable"))}
								</span>
							))
						)}
					</div>
				</div>
			</div>

			{blockOpen && blockDraft && (
				<div style={{ position: "fixed", inset: 0, zIndex: "var(--w-layer-modal)", background: "rgba(8,18,32,.48)", display: "grid", placeItems: "center", padding: 16 }}>
						<button
							type="button"
							data-focus-trap-companion
						aria-label={t("common.close")}
						onClick={() => {
							setBlockOpen(false);
							setBlockDraft(null);
						}}
						style={{ position: "absolute", inset: 0, border: 0, background: "transparent", cursor: "default" }}
					/>
					<div ref={blockDialogRef} role="dialog" aria-modal="true" aria-labelledby="availability-block-title" style={{ ...CARD, position: "relative", zIndex: 1, width: "min(480px, 100%)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto", padding: 18, boxShadow: "var(--w-shadow)", display: "grid", gap: 13 }}>
						<div id="availability-block-title" className="font-display" style={{ fontWeight: 750, fontSize: 16, color: "var(--w-ink)" }}>
							{blockDraft.id ? t("availability.editBlock") : t("availability.addBlock")}
						</div>
						<label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--w-ink-2)" }}>
							{t("availability.blockType")}
							<select value={blockDraft.kind} onChange={(event) => setBlockDraft({ ...blockDraft, kind: event.target.value as AvailabilityBlock["kind"] })} style={INPUT}>
								<option value="focus">{t("availability.kind.focus")}</option>
								<option value="unavailable">{t("availability.kind.unavailable")}</option>
								<option value="absence">{t("availability.kind.absence")}</option>
								<option value="holiday">{t("availability.kind.holiday")}</option>
							</select>
						</label>
						{blockDraft.kind === "focus" && <div style={{ padding: 10, borderRadius: 9, background: "var(--w-brass-soft)", color: "var(--w-ink-2)", fontSize: 11.5 }}>{t("availability.focusEmergencyNote")}</div>}
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
							<label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--w-ink-2)" }}>{t("availability.startsAt")}<input type="datetime-local" value={blockDraft.startLocal} onChange={(event) => setBlockDraft({ ...blockDraft, startLocal: event.target.value })} style={INPUT} /></label>
							<label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--w-ink-2)" }}>{t("availability.endsAt")}<input type="datetime-local" value={blockDraft.endLocal} onChange={(event) => setBlockDraft({ ...blockDraft, endLocal: event.target.value })} style={INPUT} /></label>
						</div>
						<label style={{ display: "grid", gap: 5, fontSize: 12, color: "var(--w-ink-2)" }}>{t("availability.label")}<input value={blockDraft.label} maxLength={160} onChange={(event) => setBlockDraft({ ...blockDraft, label: event.target.value })} placeholder={t("availability.labelPlaceholder")} style={INPUT} /></label>
						<label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--w-ink-2)" }}><input type="checkbox" checked={blockDraft.visibility === "private"} onChange={(event) => setBlockDraft({ ...blockDraft, visibility: event.target.checked ? "private" : "team" })} />{t("availability.privateBlock")}</label>
						<div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
							<button type="button" onClick={() => { setBlockOpen(false); setBlockDraft(null); }} style={BUTTON}>{t("common.cancel")}</button>
							<button type="button" disabled={busy} onClick={() => void saveBlock()} style={{ ...BUTTON, background: "var(--w-brass)", color: "#fff", borderColor: "var(--w-brass)" }}>{busy ? t("common.saving") : t("common.save")}</button>
						</div>
					</div>
				</div>
			)}
		</section>
	);
}
