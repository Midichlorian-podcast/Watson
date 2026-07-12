import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import i18n, { useTranslation } from "@watson/i18n";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { useTheme } from "../layout/useTheme";
import { API_URL } from "../lib/api";
import { signOut, useSession } from "../lib/auth-client";
import { downloadBackup } from "../lib/backup";
import { NastaveniScreen as MailSettings } from "../mail/NastaveniScreen";
import { initials } from "../lib/format";
import { disconnectPowerSync } from "../lib/powersync/db";
import { showToast } from "../lib/toast";
import {
	type Accent,
	type Density,
	getAccent,
	getDensity,
	setAccent as persistAccent,
	setDensity as persistDensity,
} from "../lib/tweaks";
import { useWorkspace } from "../lib/workspace";

type Workspace = {
	id: string;
	name: string;
	isPersonal: boolean;
	role: string;
	color: string | null;
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

/** Nastavení — 1:1 dle design handoffu (sekce Vzhled / Účet / Tým a role / Oznámení). */
export function Nastaveni() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { theme, toggle } = useTheme();
	const { data: session } = useSession();
	const [openRoleId, setOpenRoleId] = useState<string | null>(null);
	// obal otevřeného menu role — pro zavření klikem mimo (stejně jako Invite modal má Esc)
	const roleMenuRef = useRef<HTMLDivElement>(null);
	const [density, setDensityState] = useState<Density>(getDensity);
	// výchozí obrazovka po startu (watson.landing; čte AppLayout při prvním načtení)
	const [landing, setLandingState] = useState<"dnes" | "prehled">(() =>
		localStorage.getItem("watson.landing") === "prehled" ? "prehled" : "dnes",
	);
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
	// Zavři menu role klikem mimo nebo Esc (jinak overlay zůstane viset přes obsah).
	useEffect(() => {
		if (!openRoleId) return;
		const onDown = (e: MouseEvent) => {
			if (!roleMenuRef.current?.contains(e.target as Node)) setOpenRoleId(null);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpenRoleId(null);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [openRoleId]);

	const { data: workspaces } = useQuery({
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
		await disconnectPowerSync();
		await signOut();
	};

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
	// Rozepsaná editace oblastí/popisu jednoho člena (null = zavřeno).
	const [profileEd, setProfileEd] = useState<{
		id: string;
		areas: string;
		bio: string;
	} | null>(null);

	// Lokální záloha „o nic nepřijít" — stáhne všechna data do souboru (bez Googlu).
	const [backingUp, setBackingUp] = useState(false);
	async function runBackup() {
		if (backingUp) return;
		setBackingUp(true);
		try {
			const res = await downloadBackup(new Date().toISOString());
			showToast(`Záloha stažena — ${res.rowCount} položek (${res.filename})`);
		} catch {
			showToast("Zálohu se nepodařilo vytvořit");
		} finally {
			setBackingUp(false);
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

	return (
		<div style={{ maxWidth: 680, margin: "0 auto", padding: "20px 22px 90px" }}>
			{/* VZHLED */}
			<div className="font-display" style={SECTION_LABEL}>
				{t("settings.appearance")}
			</div>
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
							localStorage.setItem("watson.landing", v);
						}}
						options={[
							["prehled", t("nav.overview")],
							["dnes", t("nav.today")],
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

			{/* ÚČET */}
			<div className="font-display" style={SECTION_LABEL}>
				{t("settings.account")}
			</div>
			<div style={{ ...CARD, ...ROW, gap: 13, marginBottom: 22 }}>
				<Avatar text={initials(userName)} size={40} bg="var(--w-brass)" />
				<div style={{ flex: 1, minWidth: 0 }}>
					<div
						className="font-display"
						style={{ fontWeight: 700, fontSize: 14.5, color: "var(--w-ink)" }}
					>
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

			{/* ZÁLOHY A PŘIPOJENÍ — lokální stažení funguje hned; Google je volitelná nadstavba */}
			<div className="font-display" style={{ ...SECTION_LABEL, marginTop: 22 }}>
				Zálohy a připojení
			</div>
			<div style={{ ...CARD, marginBottom: 10 }}>
				{/* Stáhnout zálohu — reálné, offline, bez Googlu */}
				<div
					style={{
						...ROW,
						justifyContent: "space-between",
						borderBottom: "1px solid var(--w-line)",
					}}
				>
					<div style={{ minWidth: 0 }}>
						<div
							className="font-display"
							style={{ fontWeight: 700, fontSize: 13.5, color: "var(--w-ink)" }}
						>
							Stáhnout zálohu
						</div>
						<div
							className="font-body"
							style={{ fontSize: 11.5, color: "var(--w-ink-3)", marginTop: 2 }}
						>
							Uloží všechna tvoje data (úkoly, projekty, seznamy, cíle, kontakty) do jednoho
							souboru. Ať o nic nepřijdeš.
						</div>
					</div>
					<button
						type="button"
						onClick={() => void runBackup()}
						disabled={backingUp}
						className="font-display"
						style={{
							...BTN_PRIMARY,
							flex: "none",
							fontSize: 12.5,
							padding: "7px 16px",
							opacity: backingUp ? 0.6 : 1,
							cursor: backingUp ? "default" : "pointer",
						}}
					>
						{backingUp ? "Zálohuji…" : "Stáhnout"}
					</button>
				</div>
				{/* Google Disk — automatická záloha; upřímný stav (vyžaduje propojení s Googlem) */}
				<div style={{ ...ROW, justifyContent: "space-between" }}>
					<div style={{ minWidth: 0 }}>
						<div
							className="font-display"
							style={{ fontWeight: 700, fontSize: 13.5, color: "var(--w-ink)" }}
						>
							Automatická záloha na Google Disk
						</div>
						<div
							className="font-body"
							style={{ fontSize: 11.5, color: "var(--w-ink-3)", marginTop: 2 }}
						>
							Pravidelné zálohy přímo na tvůj Google Disk. Vyžaduje jednorázové propojení s Googlem
							(přihlásíš se ve svém účtu) — připravujeme.
						</div>
					</div>
					<span
						className="font-display"
						style={{
							flex: "none",
							fontSize: 11,
							fontWeight: 600,
							color: "var(--w-ink-3)",
							border: "1px solid var(--w-line)",
							borderRadius: 999,
							padding: "4px 11px",
						}}
					>
						Brzy
					</span>
				</div>
			</div>

			{/* POŠTA — mailová nastavení (podpisy, VIP, schránky…) na JEDNOM místě,
			    ne schovaná uvnitř mailu. Embedded = bez vlastní hlavičky/motivu (ten je výš). */}
			<div className="font-display" style={{ ...SECTION_LABEL, marginTop: 22 }}>
				Pošta
			</div>
			<div style={{ ...CARD, overflow: "hidden", marginBottom: 10 }}>
				<MailSettings embedded />
			</div>

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
										<div
											ref={menuOpen ? roleMenuRef : undefined}
											style={{ position: "relative", flex: "none" }}
										>
											<button
												type="button"
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
												<svg
													width="9"
													height="9"
													viewBox="0 0 10 10"
													style={{ opacity: 0.7 }}
													aria-hidden
												>
													<path
														d="M2 3.5 L5 6.5 L8 3.5"
														stroke="currentColor"
														strokeWidth="1.3"
														fill="none"
														strokeLinecap="round"
														strokeLinejoin="round"
													/>
												</svg>
											</button>
											{menuOpen && (
												<div
													style={{
														position: "absolute",
														top: 30,
														right: 0,
														width: 148,
														background: "var(--w-card)",
														border: "1px solid var(--w-line)",
														borderRadius: 11,
														boxShadow: "var(--w-shadow)",
														zIndex: 6,
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
											style={{ display: "flex", flexDirection: "column", gap: 7, paddingLeft: 48 }}
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
												<button
													type="button"
													onClick={() => void saveProfile()}
													className="font-display"
													style={BTN_PRIMARY}
												>
													Uložit
												</button>
												<button
													type="button"
													onClick={() => setProfileEd(null)}
													className="font-display"
													style={BTN_GHOST}
												>
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
													<span
														className="font-body"
														style={{ fontSize: 11, color: "var(--w-ink-3)" }}
													>
														{m.bio}
													</span>
												)}
												{areaChips.length === 0 && !m.bio && canManage && (
													<span
														className="font-body"
														style={{ fontSize: 11, color: "var(--w-ink-3)", fontStyle: "italic" }}
													>
														Bez oblastí
													</span>
												)}
												{canManage && (
													<button
														type="button"
														onClick={() =>
															setProfileEd({ id: m.id, areas: m.areas ?? "", bio: m.bio ?? "" })
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
						{/* biome-ignore lint/a11y/useKeyWithClickEvents: řádkové tlačítko */}
						<div
							onClick={() => setInviteOpen(true)}
							style={{
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
									<line
										x1="6.5"
										y1="2"
										x2="6.5"
										y2="11"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
									/>
									<line
										x1="2"
										y1="6.5"
										x2="11"
										y2="6.5"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
									/>
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
						</div>
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

			{/* OZNÁMENÍ A WATSON */}
			<div className="font-display" style={SECTION_LABEL}>
				{t("settings.notifications")}
			</div>
			<div style={{ ...CARD, overflow: "hidden" }}>
				<NotifyRow
					title={t("settings.morningSummary")}
					desc={t("settings.morningSummaryDesc")}
					divider
				/>
				<NotifyRow
					title={t("settings.deadlineReminders")}
					desc={t("settings.deadlineRemindersDesc")}
				/>
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
							// uživatel zatím neexistuje — pending (e-mailová pozvánka = mail infra #8)
							setInvited((arr) =>
								arr.some((x) => x.email === email) ? arr : [...arr, { name, email }],
							);
							setToast(t("settings.inviteNoUser"));
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
					<span
						className="rounded-full"
						style={{ width: 8, height: 8, background: "var(--w-brass)" }}
					/>
					{toast}
				</div>
			)}
		</div>
	);
}

/** Segmentový přepínač (Tweaks). */
function Segments({
	value,
	onChange,
	options,
}: {
	value: string;
	onChange: (v: string) => void;
	options: [string, string][];
}) {
	return (
		<div className="inline-flex rounded-[9px] border border-line bg-panel-2" style={{ padding: 3 }}>
			{options.map(([k, l]) => (
				<button
					key={k}
					type="button"
					onClick={() => onChange(k)}
					className="rounded-[7px] font-display font-semibold"
					style={{
						fontSize: 11.5,
						padding: "5px 10px",
						background: value === k ? "var(--w-card)" : "transparent",
						color: value === k ? "var(--w-ink)" : "var(--w-ink-3)",
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
function InviteModal({
	wsId,
	onClose,
	onDone,
}: {
	wsId: string;
	onClose: () => void;
	onDone: (r: { added: boolean; reason?: string; name: string; email: string }) => void;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState<string | null>(null);
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
				body: JSON.stringify({ email: mail, role: "member" }),
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
	useEffect(() => {
		const h = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onClose]);
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
			<button
				type="button"
				aria-label={t("settings.inviteCancel")}
				onClick={onClose}
				className="fixed inset-0"
				style={{ background: "rgba(10,14,20,.42)", zIndex: 50 }}
			/>
			<div
				data-esc-layer
				className="pointer-events-none fixed inset-0 flex items-start justify-center"
				style={{ zIndex: 51, paddingTop: "14vh" }}
			>
				<div
					className="pointer-events-auto rounded-2xl border border-line bg-card"
					style={{ width: 440, maxWidth: "94vw", boxShadow: "var(--w-shadow)" }}
				>
					<div style={{ padding: "18px 20px" }}>
						<div className="mb-4 font-display font-bold text-ink" style={{ fontSize: 16 }}>
							{t("settings.inviteTitle2")}
						</div>
						<label style={fieldLabel}>{t("settings.inviteNameLabel")}</label>
						<input
							// biome-ignore lint/a11y/noAutofocus: invite modal
							autoFocus
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("settings.inviteName")}
							className="mb-3 w-full rounded-[10px] border border-line bg-panel-2 font-body text-ink outline-none focus:border-brass"
							style={{ padding: "10px 12px", fontSize: 14 }}
						/>
						<label style={fieldLabel}>{t("settings.inviteEmailLabel")}</label>
						<input
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
					<div
						className="flex items-center border-line border-t"
						style={{ gap: 12, padding: "13px 20px" }}
					>
						<span className="font-body text-ink-3" style={{ fontSize: 11.5, flex: 1 }}>
							{t("settings.inviteNote")}
						</span>
						<button
							type="button"
							onClick={onClose}
							className="rounded-[9px] border border-line font-display font-semibold text-ink-2 hover:border-ink-3"
							style={{ padding: "8px 14px", fontSize: 13 }}
						>
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

/** Řádek oznámení — dekorativní zapnutý přepínač (dle designu napevno ON). */
function NotifyRow({ title, desc, divider }: { title: string; desc: string; divider?: boolean }) {
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
			<div
				style={{
					width: 42,
					height: 24,
					borderRadius: 999,
					padding: 2,
					background: "var(--w-brass)",
					display: "flex",
				}}
			>
				<span
					style={{
						width: 20,
						height: 20,
						borderRadius: "50%",
						background: "#fff",
						marginLeft: 20,
					}}
				/>
			</div>
		</div>
	);
}
