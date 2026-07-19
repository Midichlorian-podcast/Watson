import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import i18n, { useTranslation } from "@watson/i18n";
import { type CSSProperties, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { AvailabilitySettings } from "../components/AvailabilitySettings";
import { DeveloperApiSettings } from "../components/DeveloperApiSettings";
import { IntegrationCenter } from "../components/IntegrationCenter";
import { PwaInstallCard } from "../components/PwaInstallCard";
import { SyncProblems } from "../components/SyncProblems";
import { useTheme } from "../layout/useTheme";
import { API_URL } from "../lib/api";
import { authClient, signOut, useSession } from "../lib/auth-client";
import { downloadBackup, type RestoreReport, readRestoreFile, restoreBackup, type ServerBackup } from "../lib/backup";
import { focusOnMount } from "../lib/focusOnMount";
import { initials } from "../lib/format";
import {
	setNavigationMode,
	useNavigationMode,
} from "../lib/navigationPreferences";
import { shutdownPowerSync } from "../lib/powersync/db";
import { type SettingsSection, settingsSectionForHash } from "../lib/settingsSections";
import { storageGet, storageSet } from "../lib/storage";
import { showToast } from "../lib/toast";
import { type Accent, type Density, getAccent, getDensity, setAccent as persistAccent, setDensity as persistDensity } from "../lib/tweaks";
import { useOverlayLayer } from "../lib/useOverlayLayer";
import { usePopoverLayer } from "../lib/usePopoverLayer";
import { useWorkspace } from "../lib/workspace";
import { AdminScreen } from "../mail/AdminScreen";
import { MailDemoBanner } from "../mail/DemoBanner";
import { NastaveniScreen as MailSettings } from "../mail/NastaveniScreen";

const ImportWizard = lazy(() => import("../components/ImportWizard"));

type Workspace = {
	id: string;
	name: string;
	isPersonal: boolean;
	role: string;
	color: string | null;
	taskConflictPolicy: "warning" | "strict";
};
type Member = {
	id: string;
	name: string;
	email: string;
	image: string | null;
	job: string | null;
	role: string;
	isOwner: boolean;
	/** Oblasti odpovědnosti v prostoru (comma-separated) — pro AI směrování a přehled. */
	areas: string | null;
	/** Krátký popis role člověka v prostoru. */
	bio: string | null;
};

/** Rozparsuje comma/newline-separated oblasti na čipy (bez prázdných). */
const parseAreas = (s: string | null): string[] =>
	(s ?? "")
		.split(/[,\n]/)
		.map((a) => a.trim())
		.filter(Boolean);

/** Mapuje DB roli + vlastnictví na CS popisek dle design taxonomie (Vlastník/Admin/Člen/Host). */
function roleLabel(m: Member, t: (k: string) => string) {
	if (m.isOwner) return t("settings.roleOwner");
	if (m.role === "admin" || m.role === "manager") return t("settings.roleAdmin");
	if (m.role === "guest") return t("settings.roleGuest");
	return t("settings.roleMember");
}

const SECTION_LABEL: CSSProperties = {
	fontWeight: 700,
	fontSize: 11,
	letterSpacing: ".06em",
	textTransform: "uppercase",
	color: "var(--w-ink-3)",
	margin: "0 0 8px",
};
const CARD: CSSProperties = {
	background: "var(--w-card)",
	border: "1px solid var(--w-line)",
	borderRadius: 13,
};
const ROW: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: 12,
	padding: "14px 16px",
};
/** Malé vstupní pole (editor oblastí/popisu člena). */
const INPUT_SM: CSSProperties = {
	width: "100%",
	fontSize: 12,
	color: "var(--w-ink)",
	background: "var(--w-panel-2)",
	border: "1px solid var(--w-line)",
	borderRadius: 8,
	padding: "6px 9px",
};
const BTN_PRIMARY: CSSProperties = {
	fontSize: 11.5,
	fontWeight: 600,
	color: "var(--w-brass-text)",
	background: "var(--w-brass-soft)",
	border: "1px solid var(--w-brass)",
	borderRadius: 8,
	padding: "5px 12px",
	cursor: "pointer",
};
const BTN_GHOST: CSSProperties = {
	fontSize: 11.5,
	fontWeight: 600,
	color: "var(--w-ink-3)",
	background: "transparent",
	border: "1px solid var(--w-line)",
	borderRadius: 8,
	padding: "5px 12px",
	cursor: "pointer",
};
/** Čip oblasti odpovědnosti. */
const AREA_CHIP: CSSProperties = {
	fontSize: 11,
	color: "var(--w-ink-2)",
	border: "1px solid var(--w-line)",
	borderRadius: 999,
	padding: "2px 10px",
	whiteSpace: "nowrap",
};

const PROFILE_SETTINGS_SECTION = {
	id: "profil",
	label: "settings.sectionProfile",
	description: "settings.sectionProfileDesc",
} as const;

const SETTINGS_NAV: ReadonlyArray<{
	id: SettingsSection;
	label: string;
	description: string;
}> = [
	PROFILE_SETTINGS_SECTION,
	{ id: "tym", label: "settings.sectionTeam", description: "settings.sectionTeamDesc" },
	{
		id: "zabezpeceni",
		label: "settings.sectionSecurity",
		description: "settings.sectionSecurityDesc",
	},
	{ id: "data", label: "settings.sectionData", description: "settings.sectionDataDesc" },
	{
		id: "integrace",
		label: "settings.sectionIntegrations",
		description: "settings.sectionIntegrationsDesc",
	},
	{
		id: "oznameni",
		label: "settings.sectionNotifications",
		description: "settings.sectionNotificationsDesc",
	},
	{
		id: "vzhled",
		label: "settings.sectionAppearance",
		description: "settings.sectionAppearanceDesc",
	},
];

/** Nastavení — 1:1 dle design handoffu (sekce Vzhled / Účet / Tým a role / Oznámení). */
export function Nastaveni() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { sekce } = useSearch({ from: "/nastaveni" });
	// Hash z routeru — mailová „Administrace“ sem naviguje s #posta-admin a odroluje na sekci.
	const hash = useRouterState({ select: (s) => s.location.hash });
	const hashSection = settingsSectionForHash(hash);
	const activeSection = sekce ?? hashSection ?? "profil";
	const activeSectionMeta = SETTINGS_NAV.find((section) => section.id === activeSection) ?? PROFILE_SETTINGS_SECTION;
	const { theme, toggle } = useTheme();
	const { data: session, refetch: refetchSession } = useSession();
	const [twoFactorPassword, setTwoFactorPassword] = useState("");
	const [twoFactorCode, setTwoFactorCode] = useState("");
	const [twoFactorBusy, setTwoFactorBusy] = useState(false);
	const [twoFactorSaved, setTwoFactorSaved] = useState(false);
	const [twoFactorSetup, setTwoFactorSetup] = useState<{
		totpURI: string;
		backupCodes: string[];
	} | null>(null);
	const [rotatedBackupCodes, setRotatedBackupCodes] = useState<string[] | null>(null);
	const [rotatedCodesSaved, setRotatedCodesSaved] = useState(false);
	const [openRoleId, setOpenRoleId] = useState<string | null>(null);
	const [taskPolicyBusy, setTaskPolicyBusy] = useState(false);
	const settingsNavRef = useRef<HTMLElement>(null);
	const roleMenuTriggerRef = useRef<HTMLButtonElement>(null);
	const roleMenuRef = usePopoverLayer<HTMLDivElement>(
		Boolean(openRoleId),
		() => setOpenRoleId(null),
		roleMenuTriggerRef,
	);
	const restoreInputRef = useRef<HTMLInputElement>(null);
	const [density, setDensityState] = useState<Density>(getDensity);
	// výchozí obrazovka po startu (watson.landing; čte AppLayout při prvním načtení)
	const [landing, setLandingState] = useState<"dnes" | "prehled">(() => (storageGet("watson.landing") === "prehled" ? "prehled" : "dnes"));
	const navigationMode = useNavigationMode();
	const [accent, setAccentState] = useState<Accent>(getAccent);
	const [inviteOpen, setInviteOpen] = useState(false);
	const [invited, setInvited] = useState<{ name: string; email: string }[]>([]);
	const [toast, setToast] = useState<string | null>(null);
	const setDensity = (d: Density) => {
		setDensityState(d);
		persistDensity(d);
	};
	const setAccent = (a: Accent) => {
		setAccentState(a);
		persistAccent(a);
	};
	useEffect(() => {
		if (!toast) return;
		const id = setTimeout(() => setToast(null), 2500);
		return () => clearTimeout(id);
	}, [toast]);
	// Staré odkazy přes hash zůstávají funkční, ale URL se zároveň převede na
	// novou adresovatelnou sekci. Díky tomu lze cílový pohled sdílet i obnovit.
	useEffect(() => {
		if (!hashSection || hashSection === sekce) return;
		void navigate({
			to: "/nastaveni",
			search: { sekce: hashSection },
			hash,
			replace: true,
		});
	}, [hash, hashSection, navigate, sekce]);
	// Mobilní navigace je vodorovně rolovatelná. Deep link proto aktivní sekci
	// vystředí; uživatel po otevření Integrací nesmí vidět jen utržený kus názvu.
	useEffect(() => {
		const nav = settingsNavRef.current;
		if (!nav || nav.scrollWidth <= nav.clientWidth) return;
		const active = nav.querySelector<HTMLElement>(
			`[data-settings-section="${activeSection}"]`,
		);
		if (!active) return;
		const left = active.offsetLeft - (nav.clientWidth - active.clientWidth) / 2;
		nav.scrollTo({ left: Math.max(0, left), behavior: "auto" });
	}, [activeSection]);
	// Odroluj na sekci dle hashe (#posta-admin z mailu). Cílová sekce (Administrace
	// pošty) se renderuje až po dojezdu async dotazů (teamWs), takže na jeden rAF
	// ještě v DOM není — pollujeme po rámcích ~1,5 s, dokud se element neobjeví.
	useEffect(() => {
		const h = (hash ?? "").replace(/^#/, "");
		if (!h) return;
		let raf = 0;
		let tries = 0;
		const tick = () => {
			const el = document.getElementById(h);
			if (el) {
				el.scrollIntoView({ behavior: "smooth", block: "start" });
				return;
			}
			if (tries++ < 90) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [hash]);
	// Klik mimo zavírá; topmost Escape a návrat fokusu zajišťuje sdílená popover vrstva.
	useEffect(() => {
		if (!openRoleId) return;
		const onDown = (e: MouseEvent) => {
			if (
				!roleMenuRef.current?.contains(e.target as Node) &&
				!roleMenuTriggerRef.current?.contains(e.target as Node)
			)
				setOpenRoleId(null);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [openRoleId, roleMenuRef]);

	const { data: workspaces, refetch: refetchWorkspaces } = useQuery({
		queryKey: ["workspaces"],
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/workspaces`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("workspaces");
			return (await r.json()).workspaces as Workspace[];
		},
	});
	// Tým a role = AKTIVNÍ prostor (prototyp ř. 3182); v osobním prostoru se sekce skryje.
	const { activeWs } = useWorkspace();
	const activeWorkspace = workspaces?.find((w) => w.id === activeWs);
	const teamWs = activeWorkspace && !activeWorkspace.isPersonal ? activeWorkspace : undefined;
	const accountWsName = activeWorkspace?.name ?? workspaces?.[0]?.name ?? "";

	// POZOR: klíč ["wsMembersFull", id] sdílí BulkBar/overview/Seznamy/paleta a
	// všichni čekají Member[] — vracet stejný tvar, jinak jim přepis cache spadne.
	const { data: team, refetch } = useQuery({
		queryKey: ["wsMembersFull", teamWs?.id],
		enabled: !!teamWs,
		queryFn: async () => {
			const r = await fetch(`${API_URL}/api/workspaces/${teamWs?.id}/members`, {
				credentials: "include",
			});
			if (!r.ok) throw new Error("members");
			return (await r.json()).members as Member[];
		},
	});

	const onSignOut = async () => {
		await shutdownPowerSync();
		await signOut();
	};

	// CC-P0-03 — „odhlásit a odstranit data ze zařízení": smaže lokální DB obsah
	// i citlivé localStorage klíče. Pro sdílené/cizí zařízení.
	const onSignOutWipe = async () => {
		if (!window.confirm(t("settings.signOutWipeConfirm"))) return;
		await shutdownPowerSync({ removeLocalData: true });
		await signOut();
	};

	async function beginTwoFactorSetup() {
		if (twoFactorBusy) return;
		setTwoFactorBusy(true);
		try {
			const result = await authClient.twoFactor.enable({
				password: twoFactorPassword || undefined,
				issuer: "Watson",
			});
			if (result.error || !result.data) throw new Error("two_factor_enable_failed");
			setTwoFactorSetup(result.data);
			setTwoFactorSaved(false);
			setTwoFactorCode("");
			showToast(t("settings.twoFactorScanReady"));
		} catch {
			showToast(t("settings.twoFactorStartError"));
		} finally {
			setTwoFactorBusy(false);
		}
	}

	async function verifyTwoFactorSetup() {
		if (twoFactorBusy || !/^\d{6}$/.test(twoFactorCode) || !twoFactorSaved) return;
		setTwoFactorBusy(true);
		try {
			const result = await authClient.twoFactor.verifyTotp({
				code: twoFactorCode,
				trustDevice: true,
			});
			if (result.error) throw new Error("two_factor_verify_failed");
			setTwoFactorSetup(null);
			setTwoFactorPassword("");
			setTwoFactorCode("");
			setTwoFactorSaved(false);
			await refetchSession();
			showToast(t("settings.twoFactorEnabledToast"));
		} catch {
			showToast(t("settings.twoFactorVerifyError"));
		} finally {
			setTwoFactorBusy(false);
		}
	}

	async function rotateBackupCodes() {
		if (twoFactorBusy) return;
		setTwoFactorBusy(true);
		try {
			const result = await authClient.twoFactor.generateBackupCodes({
				password: twoFactorPassword || undefined,
			});
			if (result.error || !result.data?.backupCodes) throw new Error("backup_code_rotation_failed");
			setRotatedBackupCodes(result.data.backupCodes);
			setRotatedCodesSaved(false);
			setTwoFactorPassword("");
			showToast(t("settings.twoFactorRotateReady"));
		} catch {
			showToast(t("settings.twoFactorRotateError"));
		} finally {
			setTwoFactorBusy(false);
		}
	}

	async function setRole(userId: string, role: "admin" | "member" | "guest") {
		setOpenRoleId(null);
		try {
			const r = await fetch(`${API_URL}/api/workspaces/${teamWs?.id}/members/${userId}/role`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ role }),
			});
			if (!r.ok) throw new Error("role");
			void refetch();
		} catch {
			showToast(t("settings.roleChangeError"));
		}
	}

	// Smí přihlášený uživatel spravovat lidi (role + oblasti)? admin/manager/vlastník.
	const canManage = !!teamWs && (teamWs.role === "admin" || teamWs.role === "manager");
	async function setTaskConflictPolicy(policy: "warning" | "strict") {
		if (!teamWs || !canManage || taskPolicyBusy || teamWs.taskConflictPolicy === policy) return;
		setTaskPolicyBusy(true);
		try {
			const response = await fetch(`${API_URL}/api/workspaces/${teamWs.id}/task-conflict-policy`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ policy }),
			});
			if (!response.ok) throw new Error("task_conflict_policy");
			await refetchWorkspaces();
			showToast(t("settings.taskConflictPolicySaved"));
		} catch {
			showToast(t("settings.taskConflictPolicyError"));
		} finally {
			setTaskPolicyBusy(false);
		}
	}
	// Rozepsaná editace oblastí/popisu jednoho člena (null = zavřeno).
	const [profileEd, setProfileEd] = useState<{
		id: string;
		areas: string;
		bio: string;
	} | null>(null);

	// P1-12: lokální EXPORT nasyncovaných dat — bez importu/restore to NENÍ záloha
	// a UI to nesmí tvrdit (skutečná záloha s obnovou = F3/CC-P0-14).
	const [backingUp, setBackingUp] = useState(false);
	const [backupPassphrase, setBackupPassphrase] = useState("");
	const [restoreCandidate, setRestoreCandidate] = useState<ServerBackup | null>(null);
	const [restoreFileName, setRestoreFileName] = useState("");
	const [restoreReport, setRestoreReport] = useState<RestoreReport | null>(null);
	const [restoreBusy, setRestoreBusy] = useState(false);
	const [restoreConflictMode, setRestoreConflictMode] = useState<"skip" | "fail">("skip");
	async function runBackup() {
		if (backingUp || backupPassphrase.length < 12) return;
		setBackingUp(true);
		try {
			const res = await downloadBackup(new Date().toISOString(), backupPassphrase);
			showToast(t("settings.backupDownloaded", { count: res.rowCount, filename: res.filename }));
		} catch {
			showToast(t("settings.backupDownloadError"));
		} finally {
			setBackingUp(false);
		}
	}

	async function selectRestoreFile(file: File | undefined) {
		setRestoreCandidate(null);
		setRestoreReport(null);
		setRestoreFileName("");
		if (!file) return;
		try {
			const candidate = await readRestoreFile(file, backupPassphrase);
			setRestoreCandidate(candidate);
			setRestoreFileName(file.name);
			showToast(t("settings.restoreFileReady"));
		} catch (error) {
			showToast(
				t("settings.restoreRejected", {
					code: error instanceof Error ? error.message : "invalid_file",
				}),
			);
			if (restoreInputRef.current) restoreInputRef.current.value = "";
		}
	}

	async function runRestoreDryRun() {
		if (!restoreCandidate || restoreBusy) return;
		setRestoreBusy(true);
		setRestoreReport(null);
		try {
			const report = await restoreBackup(restoreCandidate, "dry-run", restoreConflictMode);
			setRestoreReport(report);
			showToast(t("settings.restoreDryRunPassed"));
		} catch (error) {
			showToast(
				t("settings.restoreRejected", {
					code: error instanceof Error ? error.message : "restore_failed",
				}),
			);
		} finally {
			setRestoreBusy(false);
		}
	}

	async function runRestoreApply() {
		if (!restoreCandidate || !restoreReport || restoreReport.mode !== "dry-run" || restoreReport.checksum !== restoreCandidate.manifest.checksum || restoreBusy) return;
		if (!window.confirm(t("settings.restoreApplyConfirm", { count: restoreReport.totalInserted }))) return;
		setRestoreBusy(true);
		try {
			const report = await restoreBackup(restoreCandidate, "apply", restoreConflictMode);
			setRestoreReport(report);
			showToast(t("settings.restoreApplied", { count: report.totalInserted }));
		} catch (error) {
			showToast(
				t("settings.restoreRejected", {
					code: error instanceof Error ? error.message : "restore_failed",
				}),
			);
		} finally {
			setRestoreBusy(false);
		}
	}

	async function saveProfile() {
		if (!profileEd) return;
		const { id, areas, bio } = profileEd;
		setProfileEd(null);
		try {
			const r = await fetch(`${API_URL}/api/workspaces/${teamWs?.id}/members/${id}/profile`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ areas, bio }),
			});
			if (!r.ok) throw new Error("profile");
			void refetch();
			showToast("Oblasti uloženy");
		} catch {
			showToast("Uložení se nezdařilo");
		}
	}

	const user = session?.user;
	const userName = user?.name ?? "";
	const twoFactorEnabled = Boolean((user as (typeof user & { twoFactorEnabled?: boolean }) | undefined)?.twoFactorEnabled);

	return (
		<div className="w-settings-shell">
			<header style={{ marginBottom: 24 }}>
				<h1 id="settings-title" className="font-display" style={{ margin: 0, color: "var(--w-ink)", fontSize: 24, lineHeight: 1.25 }}>
					{t("settings.title")}
				</h1>
				<p className="font-body" style={{ margin: "5px 0 0", color: "var(--w-ink-3)", fontSize: 13 }}>
					{t("settings.subtitle")}
				</p>
			</header>
			<div className="w-settings-layout">
				<nav ref={settingsNavRef} className="w-settings-nav" aria-label={t("settings.title")}>
					{SETTINGS_NAV.map((section) => {
						const active = section.id === activeSection;
						return (
							<Link
								key={section.id}
								data-settings-section={section.id}
								to="/nastaveni"
								search={{ sekce: section.id }}
								aria-current={active ? "page" : undefined}
								className="font-display"
								style={{
									display: "flex",
									alignItems: "center",
									minHeight: 44,
									padding: "8px 11px",
									borderRadius: 9,
									border: `1px solid ${active ? "var(--w-brass)" : "transparent"}`,
									background: active ? "var(--w-brass-soft)" : "transparent",
									color: active ? "var(--w-brass-text)" : "var(--w-ink-2)",
									fontSize: 12.5,
									fontWeight: active ? 700 : 600,
									textDecoration: "none",
								}}
							>
								{t(section.label)}
							</Link>
						);
					})}
				</nav>
				<section className="w-settings-content" aria-labelledby={`settings-section-${activeSection}`}>
					<header style={{ marginBottom: 18 }}>
						<h2 id={`settings-section-${activeSection}`} className="font-display" style={{ margin: 0, color: "var(--w-ink)", fontSize: 19, lineHeight: 1.3 }}>
							{t(activeSectionMeta.label)}
						</h2>
						<p className="font-body" style={{ margin: "4px 0 0", color: "var(--w-ink-3)", fontSize: 12.5 }}>
							{t(activeSectionMeta.description)}
						</p>
					</header>

					{activeSection === "vzhled" && (
						<>
							{/* VZHLED */}
							<div style={{ ...CARD, overflow: "hidden", marginBottom: 22 }}>
								<div style={{ ...ROW, borderBottom: "1px solid var(--w-line)" }}>
									<div style={{ flex: 1 }}>
										<RowTitle>{t("settings.darkMode")}</RowTitle>
										<RowDesc>{t("settings.darkModeDesc")}</RowDesc>
									</div>
									<button
										type="button"
										onClick={toggle}
										aria-label={t("settings.darkMode")}
										style={{
											width: 42,
											height: 24,
											borderRadius: 999,
											padding: 2,
											border: "none",
											cursor: "pointer",
											background: theme === "dark" ? "var(--w-brass)" : "var(--w-line)",
											display: "flex",
										}}
									>
										<span
											style={{
												width: 20,
												height: 20,
												borderRadius: "50%",
												background: "#fff",
												boxShadow: "0 1px 2px rgba(0,0,0,.25)",
												marginLeft: theme === "dark" ? 20 : 0,
												transition: "margin-left .15s ease",
											}}
										/>
									</button>
								</div>
								<div style={ROW}>
									<div style={{ flex: 1 }}>
										<RowTitle>{t("settings.density")}</RowTitle>
										<RowDesc>{t("settings.densityDesc")}</RowDesc>
									</div>
									<Segments
										value={density}
										onChange={(v) => setDensity(v as Density)}
										options={[
											// „Kompaktní" vynechána dle README ř. 111 (produkčně doporučeny jen Vzdušné/Vyvážené).
											["vzdusne", t("settings.densityAiry")],
											["vyvazene", t("settings.densityBalanced")],
										]}
									/>
								</div>
								<div style={{ ...ROW, borderTop: "1px solid var(--w-line)" }}>
									<div style={{ flex: 1 }}>
										<RowTitle>{t("settings.accentLabel")}</RowTitle>
									</div>
									<Segments
										value={accent}
										onChange={(v) => setAccent(v as Accent)}
										options={[
											["multi", t("settings.accentMulti")],
											["brass", t("settings.accentBrass")],
										]}
									/>
								</div>
								{/* výchozí obrazovka po startu (prototyp prop vychoziObrazovka: Přehled | Dnes) */}
								<div style={{ ...ROW, borderTop: "1px solid var(--w-line)" }}>
									<div style={{ flex: 1 }}>
										<RowTitle>{t("settings.landing")}</RowTitle>
										<RowDesc>{t("settings.landingDesc")}</RowDesc>
									</div>
									<Segments
										value={landing}
										onChange={(v) => {
											setLandingState(v as "dnes" | "prehled");
											storageSet("watson.landing", v);
										}}
										options={[
											["prehled", t("nav.overview")],
											["dnes", t("nav.today")],
										]}
									/>
								</div>
								<div style={{ ...ROW, borderTop: "1px solid var(--w-line)" }}>
									<div style={{ flex: 1 }}>
										<RowTitle>{t("settings.navigationMode")}</RowTitle>
										<RowDesc>{t("settings.navigationModeDesc")}</RowDesc>
									</div>
									<Segments
										value={navigationMode}
										onChange={(value) =>
											setNavigationMode(value === "advanced" ? "advanced" : "guided")
										}
										options={[
											["guided", t("settings.navigationGuided")],
											["advanced", t("settings.navigationAdvanced")],
										]}
									/>
								</div>
								{/* jazyk — přesunuto z headeru (v pixel referenci header CS/EN nemá) */}
								<div style={{ ...ROW, borderTop: "1px solid var(--w-line)" }}>
									<div style={{ flex: 1 }}>
										<RowTitle>{t("settings.language")}</RowTitle>
										<RowDesc>{t("settings.languageDesc")}</RowDesc>
									</div>
									<Segments
										value={i18n.language?.startsWith("cs") ? "cs" : "en"}
										onChange={(v) => void i18n.changeLanguage(v)}
										options={[
											["cs", "Čeština"],
											["en", "English"],
										]}
									/>
								</div>
							</div>
							<PwaInstallCard />
						</>
					)}

					{activeSection === "profil" && (
						<>
							{/* ÚČET */}
							<div className="font-display" style={SECTION_LABEL}>
								{t("settings.account")}
							</div>
					<div className="w-settings-account-card" style={{ ...CARD, ...ROW, gap: 13, marginBottom: 22 }}>
								<Avatar text={initials(userName)} size={40} bg="var(--w-brass)" />
								<div style={{ flex: 1, minWidth: 0 }}>
									<div className="font-display" style={{ fontWeight: 700, fontSize: 14.5, color: "var(--w-ink)" }}>
										{userName}
									</div>
									<div
										className="font-body"
										style={{
											fontSize: 12.5,
											color: "var(--w-ink-3)",
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{user?.email}
										{accountWsName ? ` · ${accountWsName}` : ""}
									</div>
								</div>
						<div
							className="w-settings-account-actions"
							style={{ display: "flex", gap: 8, flex: "none", alignItems: "center" }}
						>
									<button
										type="button"
										onClick={onSignOutWipe}
										title={t("settings.signOutWipeHint")}
										className="font-display hover:border-overdue"
										style={{
											fontWeight: 600,
											fontSize: 12.5,
											color: "var(--w-ink-3)",
											border: "1px solid var(--w-line)",
											borderRadius: 9,
											padding: "7px 13px",
											background: "transparent",
											cursor: "pointer",
										}}
									>
										{t("settings.signOutWipe")}
									</button>
									<button
										type="button"
										onClick={onSignOut}
										className="font-display hover:border-brass"
										style={{
											fontWeight: 600,
											fontSize: 12.5,
											color: "var(--w-ink-2)",
											border: "1px solid var(--w-line)",
											borderRadius: 9,
											padding: "7px 13px",
											background: "transparent",
											cursor: "pointer",
										}}
									>
										{t("common.signOut")}
									</button>
								</div>
							</div>
							<AvailabilitySettings workspaceId={activeWorkspace?.id} />
						</>
					)}

					{activeSection === "zabezpeceni" && (
						<>
							{/* 2FA není jen deklarovaný backend plugin: uživatel musí mít bezpečný,
			    dokončitelný setup s ověřením a jednorázově zobrazenými recovery kódy. */}
							<div id="zabezpeceni" className="font-display" style={SECTION_LABEL}>
								{t("settings.security")}
							</div>
							<div style={{ ...CARD, padding: "16px", marginBottom: 22 }}>
								<div
									style={{
										display: "flex",
										gap: 12,
										justifyContent: "space-between",
										alignItems: "start",
									}}
								>
									<div>
										<RowTitle>{t("settings.twoFactorTitle")}</RowTitle>
										<RowDesc>{twoFactorEnabled ? t("settings.twoFactorEnabledDesc") : t("settings.twoFactorDesc")}</RowDesc>
									</div>
									<span
										className="font-display"
										style={{
											fontSize: 11,
											fontWeight: 700,
											color: twoFactorEnabled ? "var(--w-success, #227a47)" : "var(--w-overdue)",
											border: "1px solid currentColor",
											borderRadius: 999,
											padding: "4px 9px",
											whiteSpace: "nowrap",
										}}
									>
										{twoFactorEnabled ? t("settings.twoFactorOn") : t("settings.twoFactorOff")}
									</span>
								</div>

								{!twoFactorEnabled && !twoFactorSetup && (
									<div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
										<input
											type="password"
											autoComplete="current-password"
											value={twoFactorPassword}
											onChange={(event) => setTwoFactorPassword(event.target.value)}
											placeholder={t("settings.twoFactorPasswordOptional")}
											aria-label={t("settings.twoFactorPasswordOptional")}
											style={{ ...INPUT_SM, width: 260, maxWidth: "100%" }}
										/>
										<button type="button" onClick={() => void beginTwoFactorSetup()} disabled={twoFactorBusy} style={{ ...BTN_PRIMARY, opacity: twoFactorBusy ? 0.6 : 1 }}>
											{twoFactorBusy ? t("settings.twoFactorStarting") : t("settings.twoFactorStart")}
										</button>
									</div>
								)}

								{!twoFactorEnabled && twoFactorSetup && (
									<div style={{ marginTop: 16, display: "grid", gap: 14 }}>
										<div>
											<RowTitle>{t("settings.twoFactorStepApp")}</RowTitle>
											<RowDesc>{t("settings.twoFactorStepAppDesc")}</RowDesc>
											<code
												style={{
													display: "block",
													marginTop: 7,
													padding: 9,
													borderRadius: 7,
													background: "var(--w-panel-2)",
													overflowWrap: "anywhere",
													userSelect: "all",
													fontSize: 11,
												}}
											>
												{twoFactorSetup.totpURI}
											</code>
										</div>
										<div>
											<RowTitle>{t("settings.twoFactorRecovery")}</RowTitle>
											<RowDesc>{t("settings.twoFactorRecoveryDesc")}</RowDesc>
											<div
												style={{
													marginTop: 7,
													padding: 10,
													border: "1px solid var(--w-line)",
													borderRadius: 8,
													display: "grid",
													gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
													gap: 6,
												}}
											>
												{twoFactorSetup.backupCodes.map((code) => (
													<code key={code} style={{ userSelect: "all" }}>
														{code}
													</code>
												))}
											</div>
											<label
												style={{
													display: "flex",
													gap: 8,
													alignItems: "center",
													marginTop: 9,
													fontSize: 12,
													color: "var(--w-ink-2)",
												}}
											>
												<input type="checkbox" checked={twoFactorSaved} onChange={(event) => setTwoFactorSaved(event.target.checked)} />
												{t("settings.twoFactorRecoverySaved")}
											</label>
										</div>
										<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
											<input
												value={twoFactorCode}
												onChange={(event) => setTwoFactorCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
												inputMode="numeric"
												autoComplete="one-time-code"
												placeholder={t("settings.twoFactorCode")}
												aria-label={t("settings.twoFactorCode")}
												style={{ ...INPUT_SM, width: 180 }}
											/>
											<button
												type="button"
												onClick={() => void verifyTwoFactorSetup()}
												disabled={twoFactorBusy || !twoFactorSaved || !/^\d{6}$/.test(twoFactorCode)}
												style={{
													...BTN_PRIMARY,
													opacity: twoFactorBusy || !twoFactorSaved || !/^\d{6}$/.test(twoFactorCode) ? 0.5 : 1,
												}}
											>
												{twoFactorBusy ? t("settings.twoFactorVerifying") : t("settings.twoFactorVerify")}
											</button>
										</div>
									</div>
								)}

								{twoFactorEnabled && !rotatedBackupCodes && (
									<div style={{ marginTop: 14 }}>
										<RowTitle>{t("settings.twoFactorRotateTitle")}</RowTitle>
										<RowDesc>{t("settings.twoFactorRotateDesc")}</RowDesc>
										<div style={{ marginTop: 9, display: "flex", gap: 8, flexWrap: "wrap" }}>
											<input
												type="password"
												autoComplete="current-password"
												value={twoFactorPassword}
												onChange={(event) => setTwoFactorPassword(event.target.value)}
												placeholder={t("settings.twoFactorPasswordOptional")}
												aria-label={t("settings.twoFactorPasswordOptional")}
												style={{ ...INPUT_SM, width: 260, maxWidth: "100%" }}
											/>
											<button type="button" onClick={() => void rotateBackupCodes()} disabled={twoFactorBusy} style={{ ...BTN_GHOST, opacity: twoFactorBusy ? 0.6 : 1 }}>
												{twoFactorBusy ? t("settings.twoFactorStarting") : t("settings.twoFactorRotate")}
											</button>
										</div>
									</div>
								)}

								{twoFactorEnabled && rotatedBackupCodes && (
									<div style={{ marginTop: 14 }}>
										<RowTitle>{t("settings.twoFactorRotateResult")}</RowTitle>
										<RowDesc>{t("settings.twoFactorRotateInvalidated")}</RowDesc>
										<div
											style={{
												marginTop: 7,
												padding: 10,
												border: "1px solid var(--w-line)",
												borderRadius: 8,
												display: "grid",
												gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
												gap: 6,
											}}
										>
											{rotatedBackupCodes.map((code) => (
												<code key={code} style={{ userSelect: "all" }}>
													{code}
												</code>
											))}
										</div>
										<label
											style={{
												display: "flex",
												gap: 8,
												alignItems: "center",
												marginTop: 9,
												fontSize: 12,
												color: "var(--w-ink-2)",
											}}
										>
											<input type="checkbox" checked={rotatedCodesSaved} onChange={(event) => setRotatedCodesSaved(event.target.checked)} />
											{t("settings.twoFactorRecoverySaved")}
										</label>
										<button
											type="button"
											disabled={!rotatedCodesSaved}
											onClick={() => {
												setRotatedBackupCodes(null);
												setRotatedCodesSaved(false);
											}}
											style={{ ...BTN_PRIMARY, marginTop: 9, opacity: rotatedCodesSaved ? 1 : 0.5 }}
										>
											{t("common.done")}
										</button>
									</div>
								)}
							</div>
						</>
					)}

					{activeSection === "data" && (
						<>
							{/* F3 — čitelný outbox pro čekající i odmítnuté lokální změny. */}
							<SyncProblems />

							<div className="font-display" style={{ ...SECTION_LABEL, marginTop: 22 }}>
								{t("settings.importTransfer")}
							</div>
							<Suspense fallback={<div style={{ ...CARD, ...ROW, color: "var(--w-ink-3)", fontSize: 12 }}>{t("common.loading")}</div>}>
								<ImportWizard />
							</Suspense>

							{/* ZÁLOHY A OBNOVA — serverový podepsaný export + povinný dry-run před apply. */}
							<div className="font-display" style={{ ...SECTION_LABEL, marginTop: 22 }}>
								{t("settings.backupRestore")}
							</div>
							<div style={{ ...CARD, marginBottom: 10 }}>
								<div
									style={{
										...ROW,
										display: "grid",
										gap: 6,
										borderBottom: "1px solid var(--w-line)",
									}}
								>
									<label htmlFor="backup-passphrase">
										<RowTitle>{t("settings.backupPassphrase")}</RowTitle>
										<RowDesc>{t("settings.backupPassphraseDesc")}</RowDesc>
									</label>
									<input
										id="backup-passphrase"
										type="password"
										autoComplete="new-password"
										minLength={12}
										value={backupPassphrase}
										onChange={(event) => setBackupPassphrase(event.target.value)}
										placeholder={t("settings.backupPassphrasePlaceholder")}
										aria-label={t("settings.backupPassphrase")}
										style={{ ...INPUT_SM, width: 360, maxWidth: "100%" }}
									/>
								</div>
								<div
									style={{
										...ROW,
										justifyContent: "space-between",
										borderBottom: "1px solid var(--w-line)",
									}}
								>
									<div style={{ minWidth: 0 }}>
										<div className="font-display" style={{ fontWeight: 700, fontSize: 13.5, color: "var(--w-ink)" }}>
											{t("settings.backupDownloadTitle")}
										</div>
										<div className="font-body" style={{ fontSize: 11.5, color: "var(--w-ink-3)", marginTop: 2 }}>
											{t("settings.backupDownloadDesc")}
										</div>
									</div>
									<button
										type="button"
										onClick={() => void runBackup()}
										disabled={backingUp || backupPassphrase.length < 12}
										className="font-display"
										style={{
											...BTN_PRIMARY,
											flex: "none",
											fontSize: 12.5,
											padding: "7px 16px",
											opacity: backingUp || backupPassphrase.length < 12 ? 0.6 : 1,
											cursor: backingUp || backupPassphrase.length < 12 ? "default" : "pointer",
										}}
									>
										{backingUp ? t("settings.backupDownloading") : t("settings.backupDownload")}
									</button>
								</div>
								<div style={{ ...ROW, display: "grid", gap: 12 }}>
									<div>
										<RowTitle>{t("settings.restoreTitle")}</RowTitle>
										<RowDesc>{t("settings.restoreDesc")}</RowDesc>
									</div>
									<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
										<input
											ref={restoreInputRef}
											type="file"
											accept="application/json,.json"
											onChange={(event) => void selectRestoreFile(event.target.files?.[0])}
											aria-label={t("settings.restoreChoose")}
											style={{
												maxWidth: "100%",
												minHeight: 44,
												fontSize: 12,
												color: "var(--w-ink-2)",
											}}
										/>
										<select
											value={restoreConflictMode}
											onChange={(event) => {
												setRestoreConflictMode(event.target.value === "fail" ? "fail" : "skip");
												setRestoreReport(null);
											}}
											aria-label={t("settings.restoreConflictMode")}
											style={{ ...INPUT_SM, width: "auto" }}
										>
											<option value="skip">{t("settings.restoreConflictSkip")}</option>
											<option value="fail">{t("settings.restoreConflictFail")}</option>
										</select>
										<button type="button" onClick={() => void runRestoreDryRun()} disabled={!restoreCandidate || restoreBusy} style={{ ...BTN_GHOST, opacity: !restoreCandidate || restoreBusy ? 0.5 : 1 }}>
											{restoreBusy ? t("settings.restoreChecking") : t("settings.restoreDryRun")}
										</button>
										<button
											type="button"
											onClick={() => void runRestoreApply()}
											disabled={restoreReport?.mode !== "dry-run" || restoreBusy}
											style={{
												...BTN_PRIMARY,
												opacity: restoreReport?.mode !== "dry-run" || restoreBusy ? 0.5 : 1,
											}}
										>
											{t("settings.restoreApply")}
										</button>
									</div>
									{restoreFileName && <div style={{ fontSize: 11.5, color: "var(--w-ink-3)" }}>{t("settings.restoreSelected", { filename: restoreFileName })}</div>}
									{restoreReport && (
										<div
											role="status"
											style={{
												padding: 10,
												borderRadius: 8,
												background: "var(--w-panel-2)",
												fontSize: 12,
												color: "var(--w-ink-2)",
											}}
										>
											{restoreReport.mode === "dry-run"
												? t("settings.restoreDryRunResult", {
														insert: restoreReport.totalInserted,
														skip: restoreReport.totalSkippedExisting,
													})
												: t("settings.restoreApplyResult", {
														insert: restoreReport.totalInserted,
														skip: restoreReport.totalSkippedExisting,
													})}
										</div>
									)}
								</div>
							</div>
						</>
					)}

					{activeSection === "integrace" && (
						<>
							{/* F4 — serverový registry/health povrch. LuckyOS je první skutečný adapter;
							    mail zůstává pravdivě označený jako demo až do samostatného F5. */}
							<IntegrationCenter />
							{activeWorkspace && (
								<DeveloperApiSettings
									workspaceId={activeWorkspace.id}
									canManage={activeWorkspace.role === "admin"}
								/>
							)}

							{/* POŠTA — mailová nastavení (podpisy, VIP, schránky…) na JEDNOM místě,
			    ne schovaná uvnitř mailu. Embedded = bez vlastní hlavičky. Obal data-wm-theme
			    dodá mailové tokeny (--panel/--ink/--line…), aby karty vypadaly 1:1 jako v mailu. */}
							<div className="font-display" style={{ ...SECTION_LABEL, marginTop: 22 }}>
								Pošta
							</div>
							<div data-wm-theme={theme === "dark" ? "dark" : "light"} style={{ marginBottom: 10 }}>
								{/* CC-P0-08 — mailová sekce v Nastavení musí nést demo stav stejně jako modul */}
								<MailDemoBanner compact />
								<MailSettings embedded />
							</div>

							{/* ADMINISTRACE POŠTY — jen správci týmu (schránky, přístupy, AI, pravidla, šablony).
			    Dřív schovaná uvnitř mailu; teď je správa pošty tam, kde je i zbytek správy týmu. */}
							{teamWs && canManage && (
								<>
									<div id="posta-admin" className="font-display" style={{ ...SECTION_LABEL, marginTop: 22, scrollMarginTop: 16 }}>
										Administrace pošty
									</div>
									<div data-wm-theme={theme === "dark" ? "dark" : "light"} style={{ marginBottom: 10 }}>
										<MailDemoBanner compact />
										<AdminScreen embedded />
									</div>
								</>
							)}
						</>
					)}

					{activeSection === "tym" && (
						<>
							{/* TÝM A ROLE */}
							{teamWs && (
								<>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 8,
											margin: "0 0 8px",
										}}
									>
										<span className="font-display" style={{ ...SECTION_LABEL, margin: 0 }}>
											{t("settings.team")}
										</span>
										<span
											style={{
												width: 7,
												height: 7,
												borderRadius: 2,
												flex: "none",
												background: teamWs.color ?? "var(--w-brass)",
											}}
										/>
										<span
											className="font-display"
											style={{
												fontWeight: 600,
												fontSize: 11.5,
												color: "var(--w-ink-3)",
											}}
										>
											{teamWs.name}
										</span>
									</div>
									<div style={{ ...CARD, ...ROW, marginBottom: 10, flexWrap: "wrap" }}>
										<div style={{ flex: "1 1 260px" }}>
											<RowTitle>{t("settings.taskConflictPolicy")}</RowTitle>
											<RowDesc>{t("settings.taskConflictPolicyDesc")}</RowDesc>
										</div>
										<Segments
											value={teamWs.taskConflictPolicy ?? "warning"}
											onChange={(value) => void setTaskConflictPolicy(value as "warning" | "strict")}
											disabled={!canManage || taskPolicyBusy}
											options={[
												["warning", t("settings.taskConflictWarning")],
												["strict", t("settings.taskConflictStrict")],
											]}
										/>
										{!canManage && (
											<p className="w-full font-body text-ink-3" style={{ fontSize: 11.5 }}>
												{t("settings.taskConflictPolicyAdminOnly")}
											</p>
										)}
										{taskPolicyBusy && (
											<span className="font-body text-ink-3" style={{ fontSize: 11.5 }} role="status">
												{t("settings.taskConflictSaving")}
											</span>
										)}
									</div>
									<div style={{ ...CARD, overflow: "visible", marginBottom: 10 }}>
										{(team ?? []).map((m) => {
											const label = roleLabel(m, t);
											const menuOpen = openRoleId === m.id;
											const areaChips = parseAreas(m.areas);
											const editing = profileEd?.id === m.id;
											return (
												<div
													key={m.id}
													style={{
														display: "flex",
														flexDirection: "column",
														gap: 8,
														padding: "12px 16px",
														borderBottom: "1px solid var(--w-line)",
													}}
												>
													<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
														{/* klik na avatara/jméno → karta člena (Reporty/Lidé, prototyp ř. 920–923) */}
														<button
															type="button"
															onClick={() =>
																void navigate({
																	to: "/reporty",
																	search: { tab: "lide", clen: m.id },
																})
															}
															className="shrink-0 cursor-pointer"
														>
															<Avatar text={initials(m.name)} size={36} bg="var(--w-avatar)" />
														</button>
														<div style={{ minWidth: 0, flex: 1 }}>
															<button
																type="button"
																onClick={() =>
																	void navigate({
																		to: "/reporty",
																		search: { tab: "lide", clen: m.id },
																	})
																}
																className="cursor-pointer font-display hover:text-brass-text"
																style={{
																	fontWeight: 700,
																	fontSize: 13.5,
																	color: "var(--w-ink)",
																}}
															>
																{m.name}
															</button>
															<div
																className="font-body"
																style={{
																	fontSize: 11.5,
																	color: "var(--w-ink-3)",
																	overflow: "hidden",
																	textOverflow: "ellipsis",
																	whiteSpace: "nowrap",
																}}
															>
																{m.job ? `${m.job} · ${m.email}` : m.email}
															</div>
														</div>
												<div style={{ position: "relative", flex: "none" }}>
													<button
														ref={menuOpen ? roleMenuTriggerRef : undefined}
														type="button"
														disabled={m.isOwner}
														aria-haspopup={m.isOwner ? undefined : "menu"}
														aria-expanded={m.isOwner ? undefined : menuOpen}
														aria-controls={menuOpen ? `role-menu-${m.id}` : undefined}
																onClick={() => !m.isOwner && setOpenRoleId(menuOpen ? null : m.id)}
																className="font-display"
																style={{
																	display: "inline-flex",
																	alignItems: "center",
																	gap: 5,
																	fontWeight: 600,
																	fontSize: 11.5,
																	borderRadius: 999,
																	padding: "4px 10px 4px 11px",
																	cursor: m.isOwner ? "default" : "pointer",
																	background: m.isOwner ? "var(--w-brass-soft)" : "var(--w-panel-2)",
																	border: `1px solid ${m.isOwner ? "var(--w-brass)" : "var(--w-line)"}`,
																	color: m.isOwner ? "var(--w-brass-text)" : "var(--w-ink-2)",
																}}
															>
																{label}
																<svg width="9" height="9" viewBox="0 0 10 10" style={{ opacity: 0.7 }} aria-hidden>
																	<path d="M2 3.5 L5 6.5 L8 3.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
																</svg>
															</button>
													{menuOpen && (
														<div
															ref={roleMenuRef}
															id={`role-menu-${m.id}`}
															role="menu"
															aria-label={`${t("settings.team")} — ${m.name}`}
															style={{
																		position: "absolute",
																		top: 30,
																		right: 0,
																		width: 148,
																		background: "var(--w-card)",
																		border: "1px solid var(--w-line)",
																		borderRadius: 11,
																		boxShadow: "var(--w-shadow)",
																zIndex: "var(--w-layer-popover)",
																		padding: 5,
																	}}
																>
																	{(
																		[
																			["admin", t("settings.roleAdmin")],
																			["member", t("settings.roleMember")],
																			["guest", t("settings.roleGuest")],
																		] as const
																	).map(([role, lbl]) => (
																	<button
																		key={role}
																		type="button"
																		role="menuitemradio"
																		aria-checked={lbl === label}
																			onClick={() => void setRole(m.id, role)}
																			className="font-body hover:bg-panel-2"
																			style={{
																				display: "flex",
																				alignItems: "center",
																				gap: 7,
																				width: "100%",
																				padding: "7px 9px",
																				borderRadius: 8,
																				cursor: "pointer",
																				background: "transparent",
																				border: "none",
																				fontSize: 12.5,
																				color: "var(--w-ink)",
																				textAlign: "left",
																			}}
																		>
																			<span
																				style={{
																					width: 12,
																					flex: "none",
																					color: "var(--w-brass-text)",
																					fontWeight: 700,
																				}}
																			>
																				{lbl === label ? "✓" : ""}
																			</span>
																			{lbl}
																		</button>
																	))}
																</div>
															)}
														</div>
													</div>
													{/* Oblasti odpovědnosti + popis (per prostor) — čipy; editace pro admina/manažera.
									    Podklad pro AI směrování „kdo co řeší" i lidský přehled. */}
													{editing ? (
														<div
															style={{
																display: "flex",
																flexDirection: "column",
																gap: 7,
																paddingLeft: 48,
															}}
														>
															<input
																value={profileEd.areas}
																onChange={(e) => setProfileEd({ ...profileEd, areas: e.target.value })}
																placeholder="Oblasti — oddělené čárkou (např. granty, smlouvy, provoz)"
																className="font-body"
																style={INPUT_SM}
															/>
															<textarea
																value={profileEd.bio}
																onChange={(e) => setProfileEd({ ...profileEd, bio: e.target.value })}
																placeholder="Krátký popis — co má na starosti (podklad pro AI směrování)"
																rows={2}
																className="font-body"
																style={{ ...INPUT_SM, resize: "vertical" }}
															/>
															<div style={{ display: "flex", gap: 8 }}>
																<button type="button" onClick={() => void saveProfile()} className="font-display" style={BTN_PRIMARY}>
																	Uložit
																</button>
																<button type="button" onClick={() => setProfileEd(null)} className="font-display" style={BTN_GHOST}>
																	Zrušit
																</button>
															</div>
														</div>
													) : (
														(areaChips.length > 0 || m.bio || canManage) && (
															<div
																style={{
																	display: "flex",
																	flexWrap: "wrap",
																	alignItems: "center",
																	gap: 6,
																	paddingLeft: 48,
																}}
															>
																{areaChips.map((a) => (
																	<span key={a} className="font-body" style={AREA_CHIP}>
																		{a}
																	</span>
																))}
																{m.bio && (
																	<span className="font-body" style={{ fontSize: 11, color: "var(--w-ink-3)" }}>
																		{m.bio}
																	</span>
																)}
																{areaChips.length === 0 && !m.bio && canManage && (
																	<span
																		className="font-body"
																		style={{
																			fontSize: 11,
																			color: "var(--w-ink-3)",
																			fontStyle: "italic",
																		}}
																	>
																		Bez oblastí
																	</span>
																)}
																{canManage && (
																	<button
																		type="button"
																		onClick={() =>
																			setProfileEd({
																				id: m.id,
																				areas: m.areas ?? "",
																				bio: m.bio ?? "",
																			})
																		}
																		className="font-display hover:text-brass-text"
																		style={{
																			fontSize: 11,
																			fontWeight: 600,
																			color: "var(--w-ink-3)",
																			background: "transparent",
																			border: "none",
																			cursor: "pointer",
																			padding: "2px 4px",
																		}}
																	>
																		{areaChips.length || m.bio ? "Upravit" : "+ Oblasti"}
																	</button>
																)}
															</div>
														)
													)}
												</div>
											);
										})}
										{/* Optimisticky pozvaní členové (prototyp submitMember → newMembers, ř. 2384) */}
										{invited.map((iv) => (
											<div
												key={iv.email}
												style={{
													display: "flex",
													alignItems: "center",
													gap: 12,
													padding: "12px 16px",
													borderBottom: "1px solid var(--w-line)",
												}}
											>
												<Avatar text={initials(iv.name || iv.email)} size={36} bg="var(--w-ink-3)" />
												<div style={{ minWidth: 0, flex: 1 }}>
													<div
														className="font-display"
														style={{
															fontWeight: 600,
															fontSize: 14,
															color: "var(--w-ink)",
														}}
													>
														{iv.name || iv.email}
													</div>
													<div className="font-mono" style={{ fontSize: 11.5, color: "var(--w-ink-3)" }}>
														{iv.email}
													</div>
												</div>
												<span
													className="font-display font-semibold"
													style={{
														fontSize: 11,
														color: "var(--w-brass-text)",
														background: "var(--w-brass-soft)",
														borderRadius: 999,
														padding: "3px 10px",
													}}
												>
													{t("settings.rolePending")}
												</span>
											</div>
										))}
										{/* Pozvat člena */}
										<button
											type="button"
											onClick={() => setInviteOpen(true)}
											style={{
												width: "100%",
												border: 0,
												background: "transparent",
												textAlign: "left",
												display: "flex",
												alignItems: "center",
												gap: 9,
												padding: "13px 16px",
												cursor: "pointer",
											}}
										>
											<span
												style={{
													width: 36,
													height: 36,
													borderRadius: "50%",
													border: "1.5px dashed var(--w-line)",
													color: "var(--w-brass-text)",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													flex: "none",
												}}
											>
												<svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
													<line x1="6.5" y1="2" x2="6.5" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
													<line x1="2" y1="6.5" x2="11" y2="6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
												</svg>
											</span>
											<span
												className="font-display"
												style={{
													fontWeight: 700,
													fontSize: 13,
													color: "var(--w-brass-text)",
												}}
											>
												{t("settings.invite")}
											</span>
										</button>
									</div>
									<p
										className="font-body"
										style={{
											fontSize: 11.5,
											color: "var(--w-ink-3)",
											margin: "0 0 22px",
											padding: "0 2px",
										}}
									>
										{t("settings.teamNote")}
									</p>
								</>
							)}
							{!teamWs && (
								<div className="font-body" style={{ ...CARD, ...ROW, color: "var(--w-ink-3)", fontSize: 12.5 }}>
									{t("settings.teamPersonalEmpty")}
								</div>
							)}
						</>
					)}

					{activeSection === "oznameni" && (
						<>
							{/* OZNÁMENÍ A WATSON */}
							<div style={{ ...CARD, overflow: "hidden" }}>
								<NotifyRow
									title={t("settings.morningSummary")}
									desc={t("settings.morningSummaryDesc")}
									status={t("settings.notificationPlanned")}
									divider
								/>
								<NotifyRow
									title={t("settings.deadlineReminders")}
									desc={t("settings.deadlineRemindersDesc")}
									status={t("settings.notificationPerTask")}
								/>
							</div>
						</>
					)}
				</section>
			</div>

			{inviteOpen && (
				<InviteModal
					wsId={teamWs?.id ?? ""}
					onClose={() => setInviteOpen(false)}
					onDone={({ added, name, email }) => {
						setInviteOpen(false);
						if (added) {
							// reálně přidán do rosteru — obnovit seznam členů
							void refetch();
							setToast(t("settings.inviteAdded"));
						} else {
							// Nový účet: server pozvánku uložil a skutečně odeslal magic link.
							setInvited((arr) => (arr.some((x) => x.email === email) ? arr : [...arr, { name, email }]));
							setToast(t("settings.inviteSent"));
						}
					}}
				/>
			)}
			{toast && (
				<div
					className="fixed bottom-6 left-1/2 flex items-center gap-2.5 rounded-full bg-navy px-4 py-2.5 font-display font-semibold text-white"
					style={{
						transform: "translateX(-50%)",
						boxShadow: "var(--w-shadow)",
						zIndex: 60,
						fontSize: 13.5,
					}}
				>
					<span className="rounded-full" style={{ width: 8, height: 8, background: "var(--w-brass)" }} />
					{toast}
				</div>
			)}
		</div>
	);
}

/** Segmentový přepínač (Tweaks). */
function Segments({ value, onChange, options, disabled = false }: { value: string; onChange: (v: string) => void; options: [string, string][]; disabled?: boolean }) {
	return (
		<div className="inline-flex rounded-[9px] border border-line bg-panel-2" style={{ padding: 3, opacity: disabled ? 0.7 : 1 }}>
			{options.map(([k, l]) => (
				<button
					key={k}
					type="button"
					disabled={disabled}
					onClick={() => onChange(k)}
					className="rounded-[7px] font-display font-semibold"
					style={{
						fontSize: 11.5,
						minHeight: 44,
						padding: "5px 12px",
						background: value === k ? "var(--w-card)" : "transparent",
						color: value === k ? "var(--w-ink)" : "var(--w-ink-3)",
						cursor: disabled ? "not-allowed" : "pointer",
					}}
				>
					{l}
				</button>
			))}
		</div>
	);
}

/**
 * Pozvat člena — 1:1 dle prototypu (ř. 1273–1288): uppercase labely, poznámka + border-top,
 * šířka 440 px / 14vh (mailová infrastruktura = Mail #8; zatím optimistický roster + toast).
 */
function InviteModal({ wsId, onClose, onDone }: { wsId: string; onClose: () => void; onDone: (r: { added: boolean; reason?: string; name: string; email: string }) => void }) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const modalRef = useOverlayLayer<HTMLDivElement>(true, onClose);
	const submit = async () => {
		const mail = email.trim();
		if (!mail || busy) return;
		setBusy(true);
		setErr(null);
		try {
			const r = await fetch(`${API_URL}/api/workspaces/${wsId}/invite`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: mail, name: name.trim() || undefined, role: "member" }),
			});
			if (!r.ok) throw new Error("invite");
			const data = (await r.json()) as { added: boolean; reason?: string };
			onDone({
				added: data.added,
				reason: data.reason,
				name: name.trim(),
				email: mail,
			});
		} catch {
			setErr(t("settings.inviteError"));
			setBusy(false);
		}
	};
	const fieldLabel: CSSProperties = {
		fontFamily: "var(--w-font-display)",
		fontWeight: 700,
		fontSize: 10.5,
		letterSpacing: ".06em",
		textTransform: "uppercase",
		color: "var(--w-ink-3)",
		marginBottom: 6,
		display: "block",
	};
	return (
		<>
			<button type="button" aria-label={t("settings.inviteCancel")} onClick={onClose} className="fixed inset-0" style={{ background: "rgba(10,14,20,.42)", zIndex: "var(--w-layer-modal)" }} />
			<div data-esc-layer className="pointer-events-none fixed inset-0 flex items-start justify-center" style={{ zIndex: "calc(var(--w-layer-modal) + 1)", paddingTop: "14vh" }}>
				<div
					ref={modalRef}
					role="dialog"
					aria-modal="true"
					aria-label={t("settings.inviteTitle2")}
					data-esc-layer
					className="pointer-events-auto rounded-2xl border border-line bg-card"
					style={{ width: 440, maxWidth: "94vw", boxShadow: "var(--w-shadow)" }}
				>
					<div style={{ padding: "18px 20px" }}>
						<div className="mb-4 font-display font-bold text-ink" style={{ fontSize: 16 }}>
							{t("settings.inviteTitle2")}
						</div>
						<label htmlFor="workspace-invite-name" style={fieldLabel}>
							{t("settings.inviteNameLabel")}
						</label>
						<input
							id="workspace-invite-name"
							ref={focusOnMount}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("settings.inviteName")}
							className="mb-3 w-full rounded-[10px] border border-line bg-panel-2 font-body text-ink outline-none focus:border-brass"
							style={{ padding: "10px 12px", fontSize: 14 }}
						/>
						<label htmlFor="workspace-invite-email" style={fieldLabel}>
							{t("settings.inviteEmailLabel")}
						</label>
						<input
							id="workspace-invite-email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && void submit()}
							placeholder={t("settings.inviteEmail")}
							type="email"
							className="w-full rounded-[10px] border border-line bg-panel-2 font-mono text-ink outline-none focus:border-brass"
							style={{ padding: "10px 12px", fontSize: 13 }}
						/>
						{err && (
							<div className="mt-2 font-body text-overdue" style={{ fontSize: 12 }}>
								{err}
							</div>
						)}
					</div>
					<div className="flex items-center border-line border-t" style={{ gap: 12, padding: "13px 20px" }}>
						<span className="font-body text-ink-3" style={{ fontSize: 11.5, flex: 1 }}>
							{t("settings.inviteNote")}
						</span>
						<button type="button" onClick={onClose} className="rounded-[9px] border border-line font-display font-semibold text-ink-2 hover:border-ink-3" style={{ padding: "8px 14px", fontSize: 13 }}>
							{t("settings.inviteCancel")}
						</button>
						<button
							type="button"
							onClick={() => void submit()}
							disabled={!email.trim() || busy}
							className="rounded-[9px] font-display font-bold text-white hover:brightness-105 disabled:opacity-50"
							style={{
								background: "var(--w-brass)",
								padding: "8px 16px",
								fontSize: 13,
							}}
						>
							{busy ? "…" : t("settings.inviteBtn")}
						</button>
					</div>
				</div>
			</div>
		</>
	);
}

function RowTitle({ children }: { children: ReactNode }) {
	return (
		<div className="font-display" style={{ fontWeight: 600, fontSize: 14, color: "var(--w-ink)" }}>
			{children}
		</div>
	);
}
function RowDesc({ children }: { children: ReactNode }) {
	return (
		<div className="font-body" style={{ fontSize: 12, color: "var(--w-ink-3)" }}>
			{children}
		</div>
	);
}

function Avatar({ text, size, bg }: { text: string; size: number; bg: string }) {
	return (
		<span
			className="font-display"
			style={{
				width: size,
				height: size,
				borderRadius: "50%",
				background: bg,
				color: "#fff",
				fontWeight: 700,
				fontSize: 13,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				flex: "none",
			}}
		>
			{text}
		</span>
	);
}

/** Pravdivý stav oznámení; nepředstírá interaktivní přepínač bez write-path. */
function NotifyRow({
	title,
	desc,
	status,
	divider,
}: {
	title: string;
	desc: string;
	status: string;
	divider?: boolean;
}) {
	return (
		<div
			style={{
				...ROW,
				borderBottom: divider ? "1px solid var(--w-line)" : undefined,
			}}
		>
			<div style={{ flex: 1 }}>
				<RowTitle>{title}</RowTitle>
				<RowDesc>{desc}</RowDesc>
			</div>
			<span
				style={{
					minHeight: 28,
					borderRadius: 999,
					padding: "6px 10px",
					background: "var(--w-panel-2)",
					border: "1px solid var(--w-line)",
					color: "var(--w-ink-3)",
					fontSize: 11,
					fontWeight: 700,
					whiteSpace: "nowrap",
				}}
			>
				{status}
			</span>
		</div>
	);
}
