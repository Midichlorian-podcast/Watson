import { useQuery as usePsQuery } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@watson/i18n";
import { useMemo, useState } from "react";
import { API_URL } from "../lib/api";
import type { ProjectRow } from "../lib/powersync/AppSchema";
import { dateInTimeZone, zonedDateTimeToIso } from "../lib/timeZone";
import { showToast } from "../lib/toast";

type Reservation = {
	id: string;
	version: number;
	bookedBy: string | null;
	bookedByName: string | null;
	meetingId: string | null;
};
type BookingSlot = {
	id: string;
	startsAt: string;
	endsAt: string;
	version: number;
	booked: boolean;
	reservation: Reservation | null;
};
type BookingPage = {
	id: string;
	projectId: string;
	projectName: string;
	title: string;
	description: string | null;
	durationMin: number;
	timezone: string;
	organizerId: string;
	organizerName: string;
	archivedAt: string | null;
	version: number;
	canManage: boolean;
	participants: Array<{ id: string; name: string }>;
	slots: BookingSlot[];
};
type SlotDraft = { id: string; date: string; time: string };

const fieldClass =
	"min-h-11 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-brass focus:ring-2 focus:ring-brass/20";
const primaryClass =
	"min-h-11 rounded-lg bg-brass px-4 py-2 font-display text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const ghostClass =
	"min-h-11 rounded-lg border border-line bg-transparent px-3 py-2 font-display text-sm font-semibold text-ink-2 disabled:cursor-not-allowed disabled:opacity-50";

function tomorrowDraft(timezone: string, hour = "10:00"): SlotDraft {
	return {
		id: crypto.randomUUID(),
		date: dateInTimeZone(timezone, new Date(Date.now() + 86_400_000)),
		time: hour,
	};
}

async function apiRequest(path: string, method: string, body?: unknown) {
	const response = await fetch(`${API_URL}${path}`, {
		method,
		credentials: "include",
		headers: body === undefined ? undefined : { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (!response.ok) {
		const error = new Error(String(payload.error ?? `HTTP ${response.status}`));
		(error as Error & { code?: string }).code = String(payload.error ?? "request_failed");
		throw error;
	}
	return payload;
}

function errorCode(error: unknown) {
	return error instanceof Error ? (error as Error & { code?: string }).code ?? error.message : "";
}

export function InternalBooking({
	workspaceId,
	userId,
	userLabel,
	timezone,
	manageProjects,
	members,
	onBack,
	onOpenMeeting,
}: {
	workspaceId: string;
	userId: string;
	userLabel: string;
	timezone: string;
	manageProjects: ProjectRow[];
	members: Map<string, string>;
	onBack: () => void;
	onOpenMeeting: (meetingId: string) => void;
}) {
	const { t, i18n } = useTranslation();
	const [creating, setCreating] = useState(false);
	const [addTo, setAddTo] = useState<BookingPage | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [projectId, setProjectId] = useState(manageProjects[0]?.id ?? "");
	const [duration, setDuration] = useState(30);
	const [selected, setSelected] = useState<Record<string, boolean>>({ [userId]: true });
	const [drafts, setDrafts] = useState<SlotDraft[]>([tomorrowDraft(timezone)]);

	const bookingQuery = useQuery({
		queryKey: ["internal-bookings", workspaceId],
		queryFn: async () => {
			const response = await fetch(`${API_URL}/api/workspaces/${workspaceId}/bookings`, {
				credentials: "include",
			});
			if (!response.ok) throw new Error("bookings_load_failed");
			return (await response.json()) as { pages: BookingPage[] };
		},
	});
	const { data: projectMemberRows } = usePsQuery<{ user_id: string }>(
		"SELECT user_id FROM project_members WHERE project_id = ?",
		[projectId || ""],
	);
	const projectMembers = useMemo(
		() =>
			(projectMemberRows ?? [])
				.map((row) => {
					const knownName = members.get(row.user_id)?.trim();
					return {
						id: row.user_id,
						name: knownName || (row.user_id === userId ? userLabel : "…"),
					};
				})
				.sort((a, b) => a.name.localeCompare(b.name, i18n.language)),
		[projectMemberRows, members, i18n.language, userId, userLabel],
	);
	const pages = bookingQuery.data?.pages ?? [];
	const activePages = pages.filter((page) => !page.archivedAt);
	const archivedPages = pages.filter((page) => page.archivedAt);

	const resetDrafts = () => setDrafts([tomorrowDraft(timezone)]);
	const changeProject = (next: string) => {
		setProjectId(next);
		setSelected({ [userId]: true });
	};
	const slotPayload = (source: SlotDraft[], targetTimezone: string) => {
		const slots = source.map((slot) => ({
			id: slot.id,
			startsAt: zonedDateTimeToIso(slot.date, slot.time, targetTimezone),
		}));
		if (slots.some((slot) => !slot.startsAt)) return null;
		return slots as Array<{ id: string; startsAt: string }>;
	};
	const toastError = (error: unknown, fallback: string) => {
		const code = errorCode(error);
		if (code === "booking_slot_taken") showToast(t("booking.takenError"));
		else if (code === "schedule_conflict" || code === "availability_conflict")
			showToast(t("booking.conflictError"));
		else if (code.startsWith("stale_")) showToast(t("booking.staleError"));
		else showToast(fallback);
	};

	async function createOffer() {
		const slots = slotPayload(drafts, timezone);
		const participantIds = projectMembers.filter((member) => selected[member.id]).map((member) => member.id);
		if (!title.trim() || !projectId || !slots || slots.length === 0 || !participantIds.includes(userId)) {
			showToast(t("booking.fill"));
			return;
		}
		setBusy("create");
		try {
			await apiRequest(`/api/projects/${projectId}/bookings`, "POST", {
				id: crypto.randomUUID(),
				title: title.trim(),
				description: description.trim() || null,
				durationMin: duration,
				timezone,
				organizerId: userId,
				participantIds,
				slots,
			});
			showToast(t("booking.saved"));
			setCreating(false);
			setTitle("");
			setDescription("");
			resetDrafts();
			await bookingQuery.refetch();
		} catch (error) {
			toastError(error, t("booking.saveError"));
		} finally {
			setBusy(null);
		}
	}

	async function addSlots(page: BookingPage) {
		const slots = slotPayload(drafts, page.timezone);
		if (!slots) {
			showToast(t("booking.fill"));
			return;
		}
		setBusy(`add:${page.id}`);
		try {
			await apiRequest(`/api/bookings/${page.id}/slots`, "POST", {
				operationId: crypto.randomUUID(),
				expectedVersion: page.version,
				slots,
			});
			showToast(t("booking.updated"));
			setAddTo(null);
			resetDrafts();
			await bookingQuery.refetch();
		} catch (error) {
			toastError(error, t("booking.actionError"));
		} finally {
			setBusy(null);
		}
	}

	async function book(page: BookingPage, slot: BookingSlot) {
		if (!window.confirm(t("booking.confirmBook"))) return;
		setBusy(`book:${slot.id}`);
		try {
			await apiRequest(`/api/bookings/${page.id}/slots/${slot.id}/book`, "POST", {
				reservationId: crypto.randomUUID(),
				meetingId: crypto.randomUUID(),
				hubTaskId: crypto.randomUUID(),
			});
			showToast(t("booking.reserved"));
			await bookingQuery.refetch();
		} catch (error) {
			toastError(error, t("booking.actionError"));
		} finally {
			setBusy(null);
		}
	}

	async function cancelReservation(reservation: Reservation) {
		if (!window.confirm(t("booking.confirmCancel"))) return;
		setBusy(`cancel:${reservation.id}`);
		try {
			await apiRequest(`/api/booking-reservations/${reservation.id}/cancel`, "POST", {
				operationId: crypto.randomUUID(),
				expectedVersion: reservation.version,
			});
			showToast(t("booking.cancelled"));
			await bookingQuery.refetch();
		} catch (error) {
			toastError(error, t("booking.actionError"));
		} finally {
			setBusy(null);
		}
	}

	async function cancelSlot(page: BookingPage, slot: BookingSlot) {
		setBusy(`slot:${slot.id}`);
		try {
			await apiRequest(`/api/bookings/${page.id}/slots/${slot.id}`, "DELETE", {
				operationId: crypto.randomUUID(),
				expectedVersion: slot.version,
			});
			showToast(t("booking.slotCancelled"));
			await bookingQuery.refetch();
		} catch (error) {
			toastError(error, t("booking.actionError"));
		} finally {
			setBusy(null);
		}
	}

	async function toggleArchive(page: BookingPage) {
		if (!page.archivedAt && !window.confirm(t("booking.confirmArchive"))) return;
		setBusy(`archive:${page.id}`);
		try {
			await apiRequest(`/api/bookings/${page.id}`, "PATCH", {
				operationId: crypto.randomUUID(),
				expectedVersion: page.version,
				archived: !page.archivedAt,
			});
			showToast(t("booking.updated"));
			await bookingQuery.refetch();
		} catch (error) {
			toastError(error, t("booking.actionError"));
		} finally {
			setBusy(null);
		}
	}

	const renderDrafts = (targetTimezone: string) => (
		<div className="space-y-2">
			{drafts.map((slot, index) => (
				<div key={slot.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
					<label className="sr-only" htmlFor={`booking-date-${slot.id}`}>
						{t("common.date")}
					</label>
					<input
						id={`booking-date-${slot.id}`}
						type="date"
						value={slot.date}
						onChange={(event) =>
							setDrafts((current) =>
								current.map((item) =>
									item.id === slot.id ? { ...item, date: event.target.value } : item,
								),
							)
						}
						className={fieldClass}
					/>
					<label className="sr-only" htmlFor={`booking-time-${slot.id}`}>
						{t("common.time")}
					</label>
					<input
						id={`booking-time-${slot.id}`}
						type="time"
						value={slot.time}
						onChange={(event) =>
							setDrafts((current) =>
								current.map((item) =>
									item.id === slot.id ? { ...item, time: event.target.value } : item,
								),
							)
						}
						className={fieldClass}
					/>
					<button
						type="button"
						className={ghostClass}
						disabled={drafts.length === 1}
						onClick={() => setDrafts((current) => current.filter((item) => item.id !== slot.id))}
						aria-label={`${t("booking.removeSlot")} ${index + 1}`}
					>
						{t("common.remove")}
					</button>
				</div>
			))}
			<button
				type="button"
				className={ghostClass}
				onClick={() => setDrafts((current) => [...current, tomorrowDraft(targetTimezone, "11:00")])}
			>
				+ {t("booking.addSlot")}
			</button>
			<p className="text-xs text-ink-3">{t("booking.timezone", { timezone: targetTimezone })}</p>
		</div>
	);

	const renderPage = (page: BookingPage) => {
		const now = Date.now();
		const visibleSlots = page.slots.filter((slot) => Date.parse(slot.endsAt) > now || slot.booked);
		const metadata = [
			page.projectName,
			`${page.durationMin} min`,
			page.organizerName ? t("booking.organizer", { name: page.organizerName }) : "",
		]
			.map((value) => value.trim())
			.filter(Boolean)
			.join(" · ");
		const participantNames = page.participants
			.map((participant) => participant.name.trim())
			.filter(Boolean)
			.join(", ");
		return (
			<section key={page.id} className="rounded-xl border border-line bg-card p-4 sm:p-5">
				<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
					<div className="w-full min-w-0 sm:flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="font-display text-lg font-bold text-ink">{page.title}</h2>
							{page.archivedAt && (
								<span className="rounded-full bg-panel-2 px-2 py-1 text-xs font-semibold text-ink-3">
									{t("booking.archived")}
								</span>
							)}
						</div>
						{metadata && <p className="mt-1 text-sm text-ink-2">{metadata}</p>}
						{page.description && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{page.description}</p>}
						{participantNames && (
							<p className="mt-2 text-xs text-ink-3">
								{t("booking.participants")}: {participantNames}
							</p>
						)}
					</div>
					{page.canManage && (
						<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
							{!page.archivedAt && (
								<button
									type="button"
									className={`${ghostClass} w-full sm:w-auto`}
									onClick={() => {
										setAddTo(page);
										resetDrafts();
									}}
								>
									{t("booking.addMore")}
								</button>
							)}
							<button
								type="button"
								className={`${ghostClass} w-full sm:w-auto`}
								disabled={busy === `archive:${page.id}`}
								onClick={() => void toggleArchive(page)}
							>
								{page.archivedAt ? t("booking.restore") : t("booking.archive")}
							</button>
						</div>
					)}
				</div>

				{addTo?.id === page.id && (
					<div className="mt-4 rounded-lg border border-line bg-panel-2 p-3">
						<h3 className="mb-3 font-display text-sm font-semibold text-ink">{t("booking.addMore")}</h3>
						{renderDrafts(page.timezone)}
						<div className="mt-3 flex gap-2">
							<button
								type="button"
								className={primaryClass}
								disabled={busy === `add:${page.id}`}
								onClick={() => void addSlots(page)}
							>
								{t("booking.addMore")}
							</button>
							<button type="button" className={ghostClass} onClick={() => setAddTo(null)}>
								{t("common.cancel")}
							</button>
						</div>
					</div>
				)}

				<section className="mt-4 space-y-2" aria-label={t("booking.available")}>
					{visibleSlots.length === 0 && <p className="text-sm text-ink-3">{t("booking.empty")}</p>}
					{visibleSlots.map((slot) => {
						const starts = new Date(slot.startsAt);
						const past = Date.parse(slot.endsAt) <= now;
						const mine = slot.reservation?.bookedBy === userId;
						const dateLabel = new Intl.DateTimeFormat(i18n.language, {
							timeZone: page.timezone,
							weekday: "short",
							day: "numeric",
							month: "short",
							hour: "2-digit",
							minute: "2-digit",
						}).format(starts);
						return (
							<div
								key={slot.id}
								className="grid gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2 sm:flex sm:flex-wrap sm:items-center"
							>
								<span className="font-display text-sm font-semibold text-ink sm:min-w-44 sm:flex-1">
									{dateLabel}
								</span>
								{slot.booked ? (
									<>
										<span className="text-sm text-ink-3">
											{mine
												? t("booking.mine")
												: slot.reservation?.bookedByName
													? t("booking.bookedBy", { name: slot.reservation.bookedByName })
													: t("booking.booked")}
										</span>
										{slot.reservation?.meetingId && (
										<button
											type="button"
											className={`${ghostClass} w-full sm:w-auto`}
												onClick={() => onOpenMeeting(slot.reservation?.meetingId as string)}
											>
												{t("booking.openMeeting")}
											</button>
										)}
										{slot.reservation && !past && (
										<button
											type="button"
											className={`${ghostClass} w-full sm:w-auto`}
												disabled={busy === `cancel:${slot.reservation.id}`}
												onClick={() => void cancelReservation(slot.reservation as Reservation)}
											>
												{t("booking.cancelReservation")}
											</button>
										)}
									</>
								) : past || page.archivedAt ? (
									<span className="text-sm text-ink-3">{past ? t("booking.past") : t("booking.archived")}</span>
								) : (
									<>
									<button
										type="button"
										className={`${primaryClass} w-full sm:w-auto`}
											disabled={busy === `book:${slot.id}`}
											onClick={() => void book(page, slot)}
										>
											{busy === `book:${slot.id}` ? t("booking.booking") : t("booking.book")}
										</button>
										{page.canManage && (
										<button
											type="button"
											className={`${ghostClass} w-full sm:w-auto`}
												disabled={busy === `slot:${slot.id}`}
												onClick={() => void cancelSlot(page, slot)}
											>
												{t("booking.cancelSlot")}
											</button>
										)}
									</>
								)}
							</div>
						);
					})}
				</section>
			</section>
		);
	};

	return (
		<div className="mx-auto max-w-4xl px-4 py-5 pb-16 sm:px-5">
			<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
				<div className="w-full min-w-0 sm:flex-1">
					<h1 className="font-display text-2xl font-extrabold text-ink">{t("booking.heading")}</h1>
					<p className="mt-1 max-w-2xl text-sm text-ink-3">{t("booking.intro")}</p>
				</div>
				<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
					{manageProjects.length > 0 && (
						<button
							type="button"
							className={`${primaryClass} w-full sm:w-auto`}
							onClick={() => {
								setCreating((value) => !value);
								setAddTo(null);
							}}
						>
							+ {t("booking.new")}
						</button>
					)}
					<button type="button" className={`${ghostClass} w-full sm:w-auto`} onClick={onBack}>
						{t("booking.back")}
					</button>
				</div>
			</div>

			{creating && (
				<section className="mt-5 rounded-xl border border-line bg-card p-4 sm:p-5">
					<h2 className="font-display text-lg font-bold text-ink">{t("booking.createTitle")}</h2>
					<div className="mt-4 grid gap-4 sm:grid-cols-2">
						<label className="block text-sm font-semibold text-ink">
							{t("booking.project")}
							<select value={projectId} onChange={(event) => changeProject(event.target.value)} className={`${fieldClass} mt-1`}>
								{manageProjects.map((project) => (
									<option key={project.id} value={project.id}>
										{project.name}
									</option>
								))}
							</select>
						</label>
						<label className="block text-sm font-semibold text-ink">
							{t("booking.duration")}
							<select value={duration} onChange={(event) => setDuration(Number(event.target.value))} className={`${fieldClass} mt-1`}>
								{[15, 30, 45, 60, 90, 120].map((minutes) => (
									<option key={minutes} value={minutes}>
										{minutes} min
									</option>
								))}
							</select>
						</label>
					</div>
					<label className="mt-4 block text-sm font-semibold text-ink">
						{t("booking.title")}
						<input value={title} onChange={(event) => setTitle(event.target.value)} className={`${fieldClass} mt-1`} placeholder={t("booking.titlePlaceholder")} />
					</label>
					<label className="mt-4 block text-sm font-semibold text-ink">
						{t("booking.description")}
						<textarea value={description} onChange={(event) => setDescription(event.target.value)} className={`${fieldClass} mt-1 resize-y`} rows={3} />
					</label>
					<fieldset className="mt-4">
						<legend className="text-sm font-semibold text-ink">{t("booking.participants")}</legend>
						<p className="mt-1 text-xs text-ink-3">{t("booking.participantsHint")}</p>
						<div className="mt-2 flex flex-wrap gap-2">
							{projectMembers.map((member) => (
								<label key={member.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-2 text-sm text-ink-2">
									<input
										type="checkbox"
										checked={Boolean(selected[member.id])}
										disabled={member.id === userId}
										onChange={(event) => setSelected((current) => ({ ...current, [member.id]: event.target.checked }))}
									/>
									{member.name}{member.id === userId ? ` (${t("common.you")})` : ""}
								</label>
							))}
						</div>
					</fieldset>
					<div className="mt-4">
						<h3 className="mb-2 text-sm font-semibold text-ink">{t("booking.slots")}</h3>
						{renderDrafts(timezone)}
					</div>
					<div className="mt-4 flex flex-wrap gap-2">
						<button type="button" className={primaryClass} disabled={busy === "create"} onClick={() => void createOffer()}>
							{busy === "create" ? t("booking.creating") : t("booking.create")}
						</button>
						<button type="button" className={ghostClass} onClick={() => setCreating(false)}>
							{t("common.cancel")}
						</button>
					</div>
				</section>
			)}

			<div className="mt-5 space-y-4" aria-live="polite">
				{bookingQuery.isLoading && <p className="text-sm text-ink-3">{t("common.loading")}</p>}
				{bookingQuery.isError && (
					<div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
						{t("booking.loadError")}
						<button type="button" className={`${ghostClass} ml-3`} onClick={() => void bookingQuery.refetch()}>
							{t("common.retry")}
						</button>
					</div>
				)}
				{!bookingQuery.isLoading && !bookingQuery.isError && activePages.length === 0 && (
					<div className="rounded-xl border border-line bg-card p-6 text-center">
						<p className="font-display font-semibold text-ink">{t("booking.empty")}</p>
						<p className="mt-1 text-sm text-ink-3">{t("booking.emptyHint")}</p>
					</div>
				)}
				{activePages.map(renderPage)}
				{archivedPages.length > 0 && (
					<details className="rounded-xl border border-line bg-card p-4">
						<summary className="min-h-11 cursor-pointer font-display text-sm font-semibold text-ink-2">
							{t("booking.archived")} ({archivedPages.length})
						</summary>
						<div className="mt-3 space-y-4">{archivedPages.map(renderPage)}</div>
					</details>
				)}
			</div>
			{manageProjects.length === 0 && <p className="mt-5 text-xs text-ink-3">{t("booking.manageOnly")}</p>}
		</div>
	);
}
