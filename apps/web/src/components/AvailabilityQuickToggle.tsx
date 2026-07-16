import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { dateInTimeZone, zonedDateTimeToIso } from "../lib/timeZone";
import { showToast } from "../lib/toast";
import { useWorkspace } from "../lib/workspace";

type StatusKind = "manual_snooze" | "focus" | "unavailable" | "absence" | "holiday" | "quiet_hours";
type QuickMember = {
	userId: string;
	timezone: string;
	status: { kind: StatusKind; until: string | null } | null;
	profile: {
		version: number;
		manualSnoozeStartedAt: string | null;
		manualSnoozeUntil: string | null;
	};
};
type QuickResponse = { members: QuickMember[] };

const addIsoDay = (iso: string, days: number) => {
	const date = new Date(`${iso}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
};

export function AvailabilityQuickToggle({ isMobile }: { isMobile: boolean }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { activeWs } = useWorkspace();
	const { data: session } = useSession();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const userId = session?.user?.id;
	const query = useQuery({
		queryKey: ["availability", activeWs],
		enabled: Boolean(activeWs && userId),
		queryFn: async () => {
			const response = await fetch(`${API_URL}/api/workspaces/${activeWs}/availability`, {
				credentials: "include",
			});
			if (!response.ok) throw new Error("availability_load_failed");
			return (await response.json()) as QuickResponse;
		},
		refetchInterval: 60_000,
	});
	const mine = query.data?.members.find((member) => member.userId === userId);
	const manualActive = Boolean(
		mine?.profile.manualSnoozeStartedAt &&
		(!mine.profile.manualSnoozeUntil || Date.parse(mine.profile.manualSnoozeUntil) > Date.now()),
	);
	const held = Boolean(mine?.status);

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
				triggerRef.current?.focus();
			}
		};
		document.addEventListener("mousedown", onPointer);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onPointer);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	async function mutate(method: "PUT" | "DELETE", until?: string | null) {
		if (!activeWs || !mine || busy) return;
		setBusy(true);
		try {
			const response = await fetch(`${API_URL}/api/workspaces/${activeWs}/availability/me/snooze`, {
				method,
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					expectedVersion: mine.profile.version,
					...(method === "PUT" ? { until: until ?? null } : {}),
				}),
			});
			if (!response.ok) throw new Error("snooze_failed");
			setOpen(false);
			queueMicrotask(() => triggerRef.current?.focus());
			await query.refetch();
			showToast(t(method === "PUT" ? "availability.snoozeStarted" : "availability.snoozeStoppedShort"));
		} catch {
			showToast(t("availability.saveFailed"));
		} finally {
			setBusy(false);
		}
	}

	const tomorrowAtNine = () => {
		const timezone = mine?.timezone ?? "Europe/Prague";
		return (
			zonedDateTimeToIso(addIsoDay(dateInTimeZone(timezone), 1), "09:00", timezone) ??
			new Date(Date.now() + 12 * 60 * 60_000).toISOString()
		);
	};

	return (
		<div ref={rootRef} className="relative">
				<button
					ref={triggerRef}
					type="button"
					disabled={query.isLoading || !activeWs || !userId}
					onClick={() => {
						if (query.isError || !mine) {
							showToast(t("availability.loadFailed"));
							return;
						}
						setOpen((value) => !value);
					}}
					aria-label={t("availability.quickButton")}
					aria-busy={query.isLoading}
				aria-expanded={open}
				aria-haspopup="dialog"
				title={t("availability.quickButton")}
				className="grid h-11 w-11 place-items-center rounded-[9px] border md:h-[34px] md:w-[34px]"
				style={{
					borderColor: held ? "var(--w-brass)" : "var(--w-line)",
					background: held ? "var(--w-brass-soft)" : "var(--w-panel-2)",
					color: held ? "var(--w-brass-text)" : "var(--w-ink-2)",
				}}
			>
				<span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>☾</span>
				{held && (
					<span
						aria-hidden
						style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: "50%", background: "var(--w-brass)", boxShadow: "0 0 0 2px var(--w-card)" }}
					/>
				)}
			</button>
			{open && (
				<div
					role="dialog"
					aria-label={t("availability.quickTitle")}
					style={{
						position: "absolute",
						top: isMobile ? 48 : 39,
						right: 0,
						zIndex: 80,
						width: "min(310px, calc(100vw - 24px))",
						padding: 12,
						border: "1px solid var(--w-line)",
						borderRadius: 12,
						background: "var(--w-card)",
						boxShadow: "var(--w-shadow)",
					}}
				>
					<div className="font-display" style={{ fontWeight: 750, fontSize: 13.5, color: "var(--w-ink)" }}>
						{held && mine?.status ? t(`availability.status.${mine.status.kind}`) : t("availability.quickTitle")}
					</div>
					<p style={{ margin: "4px 0 10px", fontSize: 11.5, color: "var(--w-ink-3)" }}>
						{manualActive ? t("availability.quickActiveDesc") : held ? t("availability.quickScheduledDesc") : t("availability.quickDesc")}
					</p>
					{manualActive ? (
						<button type="button" disabled={busy} onClick={() => void mutate("DELETE")} style={{ width: "100%", minHeight: 44, borderRadius: 9, border: "1px solid var(--w-brass)", background: "var(--w-brass-soft)", color: "var(--w-brass-text)", fontWeight: 700, cursor: "pointer" }}>
							{t("availability.stopSnooze")}
						</button>
					) : !held ? (
						<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
							<button type="button" disabled={busy} onClick={() => void mutate("PUT", new Date(Date.now() + 60 * 60_000).toISOString())} style={quickButtonStyle}>{t("availability.oneHour")}</button>
							<button type="button" disabled={busy} onClick={() => void mutate("PUT", tomorrowAtNine())} style={quickButtonStyle}>{t("availability.untilTomorrow")}</button>
							<button type="button" disabled={busy} onClick={() => void mutate("PUT", null)} style={{ ...quickButtonStyle, gridColumn: "1 / -1", borderColor: "var(--w-brass)", color: "var(--w-brass-text)" }}>{t("availability.indefinite")}</button>
						</div>
					) : null}
					<button
						type="button"
						onClick={() => {
							setOpen(false);
							void navigate({ to: "/nastaveni", hash: "availability-settings-title" });
						}}
						style={{ width: "100%", minHeight: 44, marginTop: 6, border: 0, background: "transparent", color: "var(--w-ink-3)", fontSize: 11.5, fontWeight: 650, cursor: "pointer" }}
					>
						{t("availability.openSettings")}
					</button>
				</div>
			)}
		</div>
	);
}

const quickButtonStyle = {
	minHeight: 44,
	borderRadius: 8,
	border: "1px solid var(--w-line)",
	background: "var(--w-panel-2)",
	color: "var(--w-ink-2)",
	fontSize: 11.5,
	fontWeight: 700,
	cursor: "pointer",
};
