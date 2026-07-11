/**
 * Mail — panel 2: seznam konverzací (prototyp data-listpane, ř. 452–778 +
 * mailVals ř. 3510–3630): hlavička s titulem a filtry, záložky Inbox/Oznámení/
 * Newslettery, blok Připnuté (3 + rozbalit), Rozpracované, řádky s hover
 * akcemi, urgencí, stavem, per-osoba štítkem „už četl(a)" a chipem úkolu.
 * Hledání a Napsat přijdou s další várkou (⌘K, plovoucí composery).
 */
import {
	type CSSProperties,
	Fragment,
	type MouseEvent,
	type ReactNode,
	useMemo,
	useRef,
	useState,
	useEffect,
} from "react";
import { CtxMenu } from "./CtxMenu";
import { GK, MB, P, SLA, STL, type MailThread } from "./data";
import { type ThreadEff, useMail } from "./state";

/** Ženská příjmení v seed světě (prototyp FEM — „už četla" vs „už četl"). */
const FEM: Record<string, 1> = { tm: 1, mh: 1, ps: 1 };

export interface RowVM {
	t: MailThread;
	e: ThreadEff;
	unread: boolean;
	flagL: string;
	stLabel: string;
	showSt: boolean;
	showMb: boolean;
	isInbox: boolean;
	hasDraft: boolean;
	rbOn: boolean;
	rbIni: string;
	rbL: string;
	hasTaskB: boolean;
	taskDone: boolean;
	taskBL: string;
	hasFu: boolean;
	snoozedL: string;
	nmsg: number;
}

/** Scope + řádky dle složky (prototyp mailVals) — sdílí to seznam i klávesnice. */
export function useListRows() {
	const m = useMail();
	return useMemo(() => {
		const team = m.threads.filter((t) => !t.personal);
		const isDor = (t: MailThread, e: ThreadEff) =>
			!t.sentF && !t.draftF && !e.arch && !e.snoozed && !e.spam && !e.trash;
		const inMb = (t: MailThread) =>
			m.folder === "vse" || m.folder === "pinned" || m.folder === "odlozene"
				? true
				: t.mb === m.folder;
		const passF = (t: MailThread) => {
			const e = m.eff(t);
			if (m.filters.unread && !m.unreadFor(t)) return false;
			if (m.filters.att && !t.att) return false;
			if (m.filters.mine && e.owner !== "ad") return false;
			if (m.filters.fu && !t.fu) return false;
			return true;
		};

		let scope: MailThread[] = [];
		const f = m.folder;
		if (f === "osobni") scope = m.threads.filter((t) => t.personal);
		else if (f === "pinned")
			scope = team.filter((t) => {
				const e = m.eff(t);
				return e.pin && isDor(t, e);
			});
		else if (f === "odlozene")
			scope = team.filter((t) => {
				const e = m.eff(t);
				return !!e.snoozed && !e.arch;
			});
		else if (f === "f_sent") scope = team.filter((t) => t.sentF || m.eff(t).sent);
		else if (f === "f_drafts")
			scope = team.filter((t) => t.draftF || !!m.drafts[t.id]?.text?.trim());
		else if (f === "f_arch")
			scope = team.filter((t) => {
				const e = m.eff(t);
				return e.arch && !e.trash;
			});
		else if (f === "f_trash") scope = team.filter((t) => m.eff(t).trash);
		else if (f === "f_block") scope = team.filter((t) => m.eff(t).spam);
		else if (f === "d_nepr")
			scope = team.filter((t) => {
				const e = m.eff(t);
				return isDor(t, e) && t.grp === "inbox" && !e.owner && !e.closed;
			});
		else if (f === "d_moje")
			scope = team.filter((t) => {
				const e = m.eff(t);
				return isDor(t, e) && t.grp === "inbox" && e.owner === "ad" && !e.closed;
			});
		else if (f === "d_ost")
			scope = team.filter((t) => {
				const e = m.eff(t);
				return (
					isDor(t, e) && t.grp === "inbox" && !!e.owner && e.owner !== "ad" && !e.closed
				);
			});
		else if (f === "d_done")
			scope = team.filter((t) => {
				const e = m.eff(t);
				return e.closed && !e.trash;
			});
		else if (f !== "gatekeeper")
			scope = team.filter((t) => {
				const e = m.eff(t);
				if (!inMb(t)) return false;
				if (m.fdr === "odeslane") return !!t.sentF;
				if (m.fdr === "koncepty") return !!t.draftF;
				if (m.fdr === "archiv") return !!e.arch;
				return isDor(t, e);
			});

		const isDorView = m.fdr === "dorucene" && (f === "vse" || !!MB[f]);
		const grpOf = (t: MailThread) => m.ovOf(t.id).grp ?? t.grp;
		const gN = { inbox: 0, ozn: 0, news: 0 };
		if (isDorView) {
			gN.inbox = scope.filter((t) => grpOf(t) === "inbox").length;
			gN.ozn = scope.filter((t) => grpOf(t) === "ozn").length;
			gN.news = scope.filter((t) => grpOf(t) === "news").length;
		}
		scope = scope.filter(passF);
		let main = scope;
		let pinList: MailThread[] = [];
		let rozList: MailThread[] = [];
		if (isDorView) {
			main = scope.filter((t) => grpOf(t) === m.grp);
			if (m.grp === "inbox") {
				const pOrd: Record<string, number> = { p1: 0, p2: 1, p3: 2, p4: 3 };
				pinList = main
					.filter((t) => m.eff(t).pin)
					.sort(
						(a, b) => (pOrd[m.eff(a).flag] ?? 4) - (pOrd[m.eff(b).flag] ?? 4),
					);
				rozList = main.filter((t) => t.roz && !m.eff(t).pin);
				main = main.filter((t) => !m.eff(t).pin && !t.roz);
			}
		}

		const vm = (t: MailThread): RowVM => {
			const e = m.eff(t);
			const isInbox =
				grpOf(t) === "inbox" && !t.personal && !t.sentF && !t.draftF;
			const hasDraftRaw = !!m.drafts[t.id]?.text?.trim();
			const stRaw =
				(isInbox || !!t.sentF) &&
				(e.st === "ceka" || e.st === "odeslano" || e.st === "hotovo");
			const links = m.taskLinks[t.id] ?? [];
			const ts = m.bridge.taskStates;
			const taskDone =
				links.length > 0 && links.every((x) => ts?.[x.app]?.done);
			const rb = t.readBy ?? [];
			const rbL =
				rb.length === 0
					? ""
					: rb.length === 1
						? `${P[rb[0] ?? ""]?.n.split(" ")[0] ?? ""} ${FEM[rb[0] ?? ""] ? "už četla" : "už četl"}`
						: `četli ${rb.map((k) => P[k]?.ini ?? k).join(", ")}`;
			return {
				t,
				e,
				unread: m.unreadFor(t),
				flagL:
					e.flag === "none"
						? ""
						: (e.flag === "p1" || e.flag === "p2") && !e.sent && !e.closed
							? `${SLA[e.flag]?.chip ?? ""} · ${e.flag === "p1" ? "6 h" : "31 h"}`
							: (SLA[e.flag]?.chip ?? ""),
				stLabel:
					e.closed && m.unreadFor(t)
						? "Hotovo · nová odpověď"
						: (STL[e.st] ?? e.st),
				showSt: stRaw || (e.closed && m.unreadFor(t)),
				showMb: m.folder === "vse" && !t.personal,
				isInbox,
				hasDraft: hasDraftRaw,
				rbOn:
					m.readModeOf(t) === "per" &&
					m.unreadFor(t) &&
					rb.length > 0 &&
					!t.personal,
				rbIni: rb.length ? (P[rb[0] ?? ""]?.ini ?? "") : "",
				rbL,
				hasTaskB: links.length > 0,
				taskDone,
				taskBL: links.length ? (taskDone ? "úkol hotov" : "má úkol") : "",
				hasFu: !hasDraftRaw && !stRaw && !!t.fu && !e.closed && isInbox,
				snoozedL: e.snoozed && m.folder === "odlozene" ? e.snoozed : "",
				nmsg: m.msgsOf(t),
			};
		};

		const order = pinList.map((t) => t.id).concat(main.map((t) => t.id));
		return {
			isDorView,
			gN,
			pinRows: pinList.map(vm),
			rozRows: rozList.map(vm),
			rows: main.map(vm),
			order,
		};
	}, [m]);
}

const rowBtn = (
	onClick: (e: MouseEvent) => void,
	title: string,
	child: ReactNode,
) => (
	<span data-rowbtn onClick={onClick} title={title}>
		{child}
	</span>
);

/** Hover akce řádku (prototyp data-rowacts): úkol · hotovo · pin · snooze · archiv. */
function RowActs({ vm }: { vm: RowVM }) {
	const m = useMail();
	const id = vm.t.id;
	const stop =
		(fn: () => void) =>
		(e: MouseEvent): void => {
			e.stopPropagation();
			fn();
		};
	return (
		<div data-rowacts>
			{rowBtn(
				stop(() => m.quickTask(id)),
				"Vytvořit úkol z vlákna — priorita a termín se předvyplní, přistane v osobní Schránce",
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
					<path d="M4 7 L5.4 8.4 L7.8 6" />
					<line x1="10.5" y1="7.3" x2="19" y2="7.3" />
					<path d="M4 13 L5.4 14.4 L7.8 12" />
					<line x1="10.5" y1="13.3" x2="19" y2="13.3" />
					<line x1="17.5" y1="16.4" x2="17.5" y2="21.6" />
					<line x1="14.9" y1="19" x2="20.1" y2="19" />
				</svg>,
			)}
			{rowBtn(
				stop(() => m.rowAct(id, "done")),
				"Hotovo (H)",
				<svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
					<path d="M2.5 7.4 L5.5 10.4 L11.5 3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
				</svg>,
			)}
			{rowBtn(
				stop(() => m.rowAct(id, "pin")),
				"Připnout (D)",
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
					<path d="M9 4 H15 L14.2 10 C16 10.8 17 12.2 17.2 14 H6.8 C7 12.2 8 10.8 9.8 10 Z" />
					<line x1="12" y1="14" x2="12" y2="20" />
				</svg>,
			)}
			{rowBtn(
				stop(() => m.rowAct(id, "snooze")),
				"Odložit na zítra (S)",
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
					<circle cx="12" cy="12" r="8" />
					<path d="M12 7.5 V12 L15.2 14.4" />
				</svg>,
			)}
			{vm.e.arch || vm.e.trash
				? rowBtn(
						stop(() => m.rowAct(id, "restore")),
						"Vrátit do Inboxu",
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden>
							<rect x="4" y="10" width="16" height="9" rx="1.4" />
							<path d="M12 14 V4 M8.5 7.5 L12 4 L15.5 7.5" />
						</svg>,
					)
				: rowBtn(
						stop(() => m.rowAct(id, "arch")),
						"Archivovat (E)",
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
							<rect x="4" y="8" width="16" height="11" rx="1.4" />
							<path d="M3.4 5 H20.6 V8 H3.4 Z" />
							<line x1="10" y1="12" x2="14" y2="12" />
						</svg>,
					)}
		</div>
	);
}

function MailRow({
	vm,
	compactPin,
	onCtx,
}: {
	vm: RowVM;
	compactPin?: boolean;
	/** Pravý klik → kontextové menu (prototyp contextmenu listener, ř. 2509). */
	onCtx?: (id: string, x: number, y: number) => void;
}) {
	const m = useMail();
	const t = vm.t;
	const e = vm.e;
	const selOn = !!m.selIds[t.id];
	return (
		<div
			onClick={() => m.openThread(t.id)}
			onContextMenu={(ev) => {
				if (!onCtx) return;
				ev.preventDefault();
				onCtx(t.id, ev.clientX, ev.clientY);
			}}
			data-tid={t.id}
			tabIndex={0}
			data-mrow
			data-sel={m.sel === t.id || undefined}
			data-unread={vm.unread || undefined}
			style={{ touchAction: "pan-y" }}
		>
			<div data-swc style={{ display: "flex", gap: 10, padding: "12px 14px 11px" }}>
				<RowActs vm={vm} />
				<span
					data-pbar={e.flag}
					style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: "0 2px 2px 0" }}
				/>
				<span
					data-mainav
					onClick={(ev) => {
						ev.stopPropagation();
						m.toggleSel(t.id);
					}}
					title="Vybrat do hromadných akcí (X)"
					style={{ flex: "none", marginTop: 1, cursor: "pointer" }}
				>
					{selOn ? (
						<span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--brass)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
							<svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
								<path d="M2.5 7.4 L5.5 10.4 L11.5 3.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</span>
					) : (
						<span
							data-av="ext"
							style={{
								width: 32,
								height: 32,
								borderRadius: "50%",
								background: "var(--avatar-navy)",
								color: "#fff",
								fontFamily: "var(--w-font-display)",
								fontWeight: 700,
								fontSize: 11,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							{t.from.ini}
						</span>
					)}
				</span>
				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
						{e.pin && (
							<svg width="14" height="14" viewBox="0 0 24 24" fill="var(--brass)" style={{ flex: "none" }} aria-hidden>
								<path d="M8.6 2.8 H15.4 L14.6 10 C16.7 11 17.8 12.5 18 14.6 H6 C6.2 12.5 7.3 11 9.4 10 Z" />
								<rect x="11.1" y="14.4" width="1.8" height="6.6" rx="0.9" />
							</svg>
						)}
						{vm.unread && (
							<span data-udot title="Nepřečtené — zmizí otevřením, vrátíš přes klávesu U" />
						)}
						<span
							data-rname
							style={{
								fontFamily: "var(--w-font-display)",
								fontWeight: 600,
								fontSize: 13,
								color: "var(--ink-2)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{t.from.n}
						</span>
						{vm.nmsg > 1 && !compactPin && (
							<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10, color: "var(--ink-3)", flex: "none" }}>
								{vm.nmsg}
							</span>
						)}
						<span style={{ flex: 1 }} />
						{t.att && !compactPin && (
							<svg width="11" height="11" viewBox="0 0 14 14" fill="none" style={{ color: "var(--ink-3)", flex: "none" }} aria-hidden>
								<path d="M11 6.2 L6.8 10.4 A2.6 2.6 0 0 1 3.1 6.7 L7.6 2.2 A1.8 1.8 0 0 1 10.2 4.8 L5.9 9.1 A0.9 0.9 0 0 1 4.6 7.8 L8.4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
							</svg>
						)}
						{e.muted && (
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ color: "var(--ink-3)", flex: "none" }} aria-hidden>
								<path d="M9.5 19 A2.6 2.6 0 0 0 14.5 19" />
								<path d="M6 16.4 V11 A6 6 0 0 1 14.8 5.7 M17.9 9.4 C18 9.9 18 10.4 18 11 V16.4 L19.4 18 H8" />
								<line x1="4" y1="4" x2="20" y2="20" />
							</svg>
						)}
						<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10.5, color: "var(--ink-3)", flex: "none" }}>
							{m.ovOf(t.id).time ?? t.time}
						</span>
					</div>
					<div
						data-rsub
						style={{
							fontFamily: "var(--w-font-body)",
							fontSize: 13,
							color: "var(--ink-2)",
							marginTop: 2,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{t.subj}
					</div>
					{!compactPin && (
						<div
							data-rsnip
							style={{
								fontFamily: "var(--w-font-body)",
								fontSize: 12,
								color: "var(--ink-3)",
								marginTop: 2,
								lineHeight: 1.45,
								maxHeight: "2.9em",
								overflow: "hidden",
							}}
						>
							{m.ovOf(t.id).snip ?? t.snip}
						</div>
					)}
					{(vm.isInbox || !!t.sentF || m.folder === "vse") && !t.personal && (
						<div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
							{vm.showMb && (
								<span
									data-mbdot={t.mb}
									title={MB[t.mb ?? ""]?.short}
									style={{ width: 8, height: 8, borderRadius: "50%", flex: "none" }}
								/>
							)}
							{vm.showSt && <span data-mstate={e.st}>{vm.stLabel}</span>}
							{e.flag !== "none" && !e.closed && vm.isInbox && (
								<span data-pflag={e.flag} style={{ fontSize: 10, padding: "2px 8px" }}>
									<svg width="9" height="10" viewBox="0 0 10 12" fill="none" aria-hidden>
										<path d="M2 1 V11 M2 1.5 H8.6 L7 4.25 L8.6 7 H2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
									</svg>
									{vm.flagL}
								</span>
							)}
							{vm.hasTaskB && (
								<span
									data-tkb={vm.taskDone || undefined}
									title="Vlákno má propojený úkol v appce — stav se propisuje živě"
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 4,
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 10,
										padding: "2px 8px",
										borderRadius: 999,
										border: "1px solid var(--brass)",
										color: "var(--brass-text)",
										whiteSpace: "nowrap",
									}}
								>
									<svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden>
										<path d="M2.5 7.4 L5.5 10.4 L11.5 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
									</svg>
									{vm.taskBL}
								</span>
							)}
							{!!e.owner && (vm.isInbox || !!t.sentF) && (
								<span
									title={t.sentF ? `odeslala ${P[e.owner]?.n}` : `vyřizuje ${P[e.owner]?.n}`}
									data-av={P[e.owner]?.av ?? ""}
									style={{
										width: 18,
										height: 18,
										borderRadius: "50%",
										background: "var(--avatar-navy)",
										color: "#fff",
										fontFamily: "var(--w-font-display)",
										fontWeight: 700,
										fontSize: 7.5,
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										flex: "none",
									}}
								>
									{P[e.owner]?.ini}
								</span>
							)}
							{vm.rbOn && (
								<span
									title="Kolega konverzaci otevřel, ale nepřečtené se počítá per osoba — pro tebe zůstává nová, dokud ji neotevřeš ty. (Nastavení pošty → Nepřečtené ve sdílených schránkách)"
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 5,
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 10,
										padding: "2px 8px 2px 3px",
										borderRadius: 999,
										border: "1px dashed var(--ink-3)",
										color: "var(--ink-2)",
										whiteSpace: "nowrap",
									}}
								>
									<span
										style={{
											width: 14,
											height: 14,
											borderRadius: "50%",
											background: "var(--avatar-navy)",
											color: "#fff",
											fontSize: 6.5,
											fontWeight: 700,
											display: "inline-flex",
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										{vm.rbIni}
									</span>
									{vm.rbL}
								</span>
							)}
							{vm.hasDraft && (
								<span
									title="Rozepsaný koncept — pokračuj v composeru"
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 4,
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 10,
										padding: "2px 8px",
										borderRadius: 999,
										border: "1px solid var(--brass)",
										color: "var(--brass-text)",
										whiteSpace: "nowrap",
									}}
								>
									<svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden>
										<path d="M2 12 L2.8 9.2 L9.8 2.2 A1.1 1.1 0 0 1 11.4 2.2 L11.8 2.6 A1.1 1.1 0 0 1 11.8 4.2 L4.8 11.2 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
									</svg>
									koncept
								</span>
							)}
							{vm.hasFu && (
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 4,
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 10,
										padding: "2px 8px",
										borderRadius: 999,
										background: "var(--panel-2)",
										border: "1px solid var(--line)",
										color: "var(--ink-2)",
										whiteSpace: "nowrap",
									}}
								>
									↻ {t.fu}
								</span>
							)}
							{vm.snoozedL && (
								<span
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 4,
										fontFamily: "var(--w-font-mono)",
										fontSize: 10,
										padding: "2px 8px",
										borderRadius: 999,
										background: "var(--panel-2)",
										border: "1px solid var(--line)",
										color: "var(--ink-2)",
										whiteSpace: "nowrap",
									}}
								>
									⏾ {vm.snoozedL}
								</span>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

const secHead: CSSProperties = {
	padding: "2px 14px 4px",
	fontFamily: "var(--w-font-display)",
	fontWeight: 700,
	fontSize: 9.5,
	letterSpacing: ".07em",
	textTransform: "uppercase",
	color: "var(--ink-3)",
};

/** Titulek seznamu dle složky (prototyp listTitle). */
function listTitle(folder: string, fdr: string): string {
	const F: Record<string, string> = {
		vse: "Doručené",
		pinned: "Připnuté",
		odlozene: "Odloženo",
		gatekeeper: "Gatekeeper",
		osobni: "Osobní",
		f_sent: "Odeslané",
		f_drafts: "Koncepty",
		f_arch: "Archiv",
		f_trash: "Koš",
		f_block: "Blokované",
		d_nepr: "Dispečink",
		d_moje: "Dispečink",
		d_ost: "Dispečink",
		d_done: "Dispečink",
	};
	if (MB[folder]) {
		const sub: Record<string, string> = {
			odeslane: " — odeslané",
			koncepty: " — koncepty",
			archiv: " — archiv",
		};
		return (MB[folder]?.short ?? folder) + (sub[fdr] ?? "");
	}
	return F[folder] ?? "Doručené";
}

export function MailList({
	onOpenDrawer,
	onSearch,
	onCompose,
}: {
	onOpenDrawer: () => void;
	onSearch: () => void;
	onCompose: () => void;
}) {
	const m = useMail();
	const { isDorView, gN, pinRows, rozRows, rows } = useListRows();
	const [vmenu, setVmenu] = useState(false);
	// kontextové menu řádku (pravý klik); hledání a Napsat řídí MailScreen (⌘K/C)
	const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(
		null,
	);
	const vmenuRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!vmenu) return;
		const h = (e: globalThis.MouseEvent) => {
			if (vmenuRef.current && !vmenuRef.current.contains(e.target as Node))
				setVmenu(false);
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, [vmenu]);

	const selCount = Object.keys(m.selIds).length;
	const fCount = Object.values(m.filters).filter(Boolean).length;
	const pinShown = m.pinExp ? pinRows : pinRows.slice(0, 3);
	const pinMore = pinRows.length - 3;
	const isGk = m.folder === "gatekeeper";
	const dispOn = m.folder.startsWith("d_");

	const FROWS: { k: "unread" | "att" | "mine" | "fu"; label: string }[] = [
		{ k: "unread", label: "Jen nepřečtené" },
		{ k: "att", label: "S přílohou" },
		{ k: "mine", label: "Přiřazené mně" },
		{ k: "fu", label: "Follow-up" },
	];

	return (
		<div
			data-listpane
			data-dens="comfort"
			data-lines={2}
			style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--panel)", position: "relative" }}
		>
			<div style={{ flex: "none", padding: "11px 14px 0", display: "flex", flexDirection: "column", gap: 9 }}>
				<div ref={vmenuRef} style={{ display: "flex", alignItems: "center", gap: 7, position: "relative", zIndex: 45 }}>
					<span
						data-msubbtn
						onClick={onOpenDrawer}
						style={{
							width: 31,
							height: 31,
							borderRadius: 8,
							border: "1px solid var(--line)",
							background: "var(--panel-2)",
							color: "var(--ink-2)",
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							cursor: "pointer",
							flex: "none",
						}}
					>
						<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
							<line x1="2.5" y1="4.5" x2="13.5" y2="4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
							<line x1="2.5" y1="8" x2="13.5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
							<line x1="2.5" y1="11.5" x2="10" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						</svg>
					</span>
					<span
						style={{
							display: "inline-flex",
							alignItems: "center",
							fontFamily: "var(--w-font-display)",
							fontWeight: 800,
							fontSize: 14,
							color: "var(--ink)",
							minWidth: 0,
							padding: "6px 2px",
						}}
					>
						<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
							{listTitle(m.folder, m.fdr)}
						</span>
					</span>
					<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>
						{isGk ? m.gkLeft : pinRows.length + rows.length}
					</span>
					<span style={{ flex: 1 }} />
					<span
						data-rowbtn
						onClick={onSearch}
						title="Hledat v poště ( / nebo ⌘K )"
						style={{ border: "1px solid var(--line)", background: "var(--panel)" }}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
							<circle cx="10.5" cy="10.5" r="6" />
							<line x1="15" y1="15" x2="20" y2="20" />
						</svg>
					</span>
					<span
						data-rowbtn
						onClick={() => setVmenu((v) => !v)}
						title="Filtry a zobrazení"
						style={{ border: "1px solid var(--line)", background: "var(--panel)", position: "relative" }}
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
							<line x1="2.5" y1="4.5" x2="13.5" y2="4.5" />
							<circle cx="6" cy="4.5" r="1.7" fill="var(--panel)" />
							<line x1="2.5" y1="8" x2="13.5" y2="8" />
							<circle cx="10.5" cy="8" r="1.7" fill="var(--panel)" />
							<line x1="2.5" y1="11.5" x2="13.5" y2="11.5" />
							<circle cx="5" cy="11.5" r="1.7" fill="var(--panel)" />
						</svg>
						{fCount > 0 && (
							<span
								style={{
									position: "absolute",
									top: -4,
									right: -4,
									minWidth: 15,
									height: 15,
									borderRadius: 999,
									background: "var(--brass)",
									color: "#fff",
									fontFamily: "var(--w-font-mono)",
									fontSize: 9,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									padding: "0 3px",
								}}
							>
								{fCount}
							</span>
						)}
					</span>
					<span
						data-primary
						onClick={onCompose}
						style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "7px 13px" }}
					>
						<svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
							<path d="M2 12 L2.8 9.2 L9.8 2.2 A1.1 1.1 0 0 1 11.4 2.2 L11.8 2.6 A1.1 1.1 0 0 1 11.8 4.2 L4.8 11.2 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
						</svg>
						<span data-npslbl>Napsat</span>
					</span>

					{vmenu && (
						<div
							style={{
								position: "absolute",
								top: "calc(100% + 4px)",
								right: 0,
								zIndex: 50,
								width: 246,
								background: "var(--panel)",
								border: "1px solid var(--line)",
								borderRadius: 12,
								boxShadow: "var(--shadow)",
								padding: 7,
								animation: "wPop .14s ease",
							}}
						>
							<div style={{ fontFamily: "var(--w-font-display)", fontWeight: 700, fontSize: 10, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)", padding: "4px 9px 5px" }}>
								Filtry
							</div>
							{FROWS.map((f) => (
								<div key={f.k} onClick={() => m.toggleFilter(f.k)} data-menuitem>
									<span style={{ flex: 1 }}>{f.label}</span>
									{m.filters[f.k] && (
										<svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ color: "var(--brass-text)" }} aria-hidden>
											<path d="M2.5 7.4 L5.5 10.4 L11.5 3.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									)}
								</div>
							))}
						</div>
					)}
				</div>

				{isDorView && !isGk && (
					<div style={{ display: "flex", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 10, padding: 3 }}>
						{(
							[
								["inbox", "Inbox", gN.inbox],
								["ozn", "Oznámení", gN.ozn],
								["news", "Newslettery", gN.news],
							] as const
						).map(([k, label, n]) => (
							<span
								key={k}
								onClick={() => m.setGrp(k)}
								data-tab
								data-active={m.grp === k || undefined}
								style={{
									flex: 1,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									gap: 6,
									fontFamily: "var(--w-font-display)",
									fontWeight: 600,
									fontSize: 12,
									padding: "6px 4px",
									borderRadius: 7,
									cursor: "pointer",
									whiteSpace: "nowrap",
								}}
							>
								{label}
								<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10.5, opacity: 0.65 }}>{n}</span>
							</span>
						))}
					</div>
				)}

				{dispOn && (
					<div style={{ display: "flex", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 10, padding: 3 }}>
						{(
							[
								["d_nepr", "Nepřiřazené"],
								["d_moje", "Moje"],
								["d_ost", "Ostatních"],
								["d_done", "Hotové"],
							] as const
						).map(([k, label]) => (
							<span
								key={k}
								onClick={() => m.setFolder(k)}
								data-tab
								data-active={m.folder === k || undefined}
								style={{
									flex: 1,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									gap: 5,
									fontFamily: "var(--w-font-display)",
									fontWeight: 600,
									fontSize: 11.5,
									padding: "6px 2px",
									borderRadius: 7,
									cursor: "pointer",
									whiteSpace: "nowrap",
								}}
							>
								{label}
							</span>
						))}
					</div>
				)}
			</div>

			{selCount > 0 && (
				<div
					style={{
						flex: "none",
						display: "flex",
						alignItems: "center",
						gap: 6,
						padding: "8px 14px",
						marginTop: 8,
						background: "var(--brass-soft)",
						borderTop: "1px solid var(--line)",
						borderBottom: "1px solid var(--line)",
						flexWrap: "wrap",
					}}
				>
					<span style={{ fontFamily: "var(--w-font-display)", fontWeight: 700, fontSize: 11.5, color: "var(--brass-text)", flex: "none" }}>
						{selCount} vybráno
					</span>
					<span style={{ flex: 1 }} />
					<span data-ghost onClick={() => m.bulkAct("done")} style={{ fontSize: 11, padding: "5px 10px" }}>Hotovo</span>
					<span data-ghost onClick={() => m.bulkAct("unread")} style={{ fontSize: 11, padding: "5px 10px" }}>Přečtené</span>
					<span data-ghost onClick={() => m.bulkAct("arch")} style={{ fontSize: 11, padding: "5px 10px" }}>Archiv</span>
					<span data-ghost onClick={() => m.bulkAct("trash")} style={{ fontSize: 11, padding: "5px 10px", color: "var(--overdue)" }}>Koš</span>
					<span data-rowbtn onClick={m.clearSel} title="Zrušit výběr (Esc)" style={{ border: "1px solid var(--line)", background: "var(--panel)" }}>×</span>
				</div>
			)}

			<div style={{ flex: 1, overflow: "auto", marginTop: 8 }}>
				{m.folder === "osobni" && (
					<div
						style={{
							margin: "0 14px 10px",
							display: "flex",
							gap: 9,
							alignItems: "flex-start",
							background: "var(--pers-bg)",
							border: "1px solid var(--pers-line)",
							borderRadius: 11,
							padding: "9px 12px",
						}}
					>
						<svg width="13" height="13" viewBox="0 0 12 12" fill="none" style={{ color: "var(--mb-osobni)", flex: "none", marginTop: 1 }} aria-hidden>
							<rect x="2.2" y="5" width="7.6" height="5.2" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
							<path d="M4 5 V3.8 A2 2 0 0 1 8 3.8 V5" stroke="currentColor" strokeWidth="1.3" />
						</svg>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div style={{ fontFamily: "var(--w-font-display)", fontWeight: 700, fontSize: 10.5, letterSpacing: ".05em", color: "var(--pers-ink)" }}>
								OSOBNÍ SCHRÁNKA — ŠIFROVÁNO
							</div>
							<div style={{ fontFamily: "var(--w-font-body)", fontSize: 11.5, color: "var(--ink-2)", lineHeight: 1.5, marginTop: 2 }}>
								Uložené zprávy nikdo z provozu nečte. Bez AI, bez týmových funkcí, mimo dohled adminů.
							</div>
						</div>
					</div>
				)}

				{isGk ? (
					<GkQueue />
				) : (
					<>
						{isDorView && m.grp === "inbox" && pinRows.length > 0 && (
							<>
								<div style={secHead}>Připnuté</div>
								{pinShown.map((vm) => (
									<MailRow
										key={vm.t.id}
										vm={vm}
										compactPin
										onCtx={(id, x, y) => setCtx({ id, x, y })}
									/>
								))}
								{!m.pinExp && pinMore > 0 && (
									<div
										onClick={() => m.setPinExp(true)}
										style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid var(--line)" }}
									>
										<svg width="11" height="11" viewBox="0 0 24 24" fill="var(--ink-3)" style={{ flex: "none" }} aria-hidden>
											<path d="M9 3.4 H15 L14.3 10 C16.2 10.9 17.2 12.3 17.4 14.2 H6.6 C6.8 12.3 7.8 10.9 9.7 10 Z" />
											<rect x="11.2" y="14" width="1.6" height="6.2" rx="0.8" />
										</svg>
										<span style={{ fontFamily: "var(--w-font-display)", fontWeight: 600, fontSize: 11.5, color: "var(--brass-text)" }}>
											Zobrazit dalších {pinMore} připnutých
										</span>
									</div>
								)}
								{m.pinExp && (
									<div
										onClick={() => m.setPinExp(false)}
										style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid var(--line)" }}
									>
										<span style={{ fontFamily: "var(--w-font-display)", fontWeight: 600, fontSize: 11.5, color: "var(--ink-3)" }}>
											Sbalit připnuté na 3 nejnovější
										</span>
									</div>
								)}
								<div style={{ ...secHead, padding: "10px 14px 4px" }}>Konverzace</div>
							</>
						)}

						{m.grp === "ozn" && isDorView && (
							<div style={{ margin: "0 14px 8px", display: "flex", alignItems: "center", gap: 8 }}>
								<span style={{ fontFamily: "var(--w-font-body)", fontSize: 11.5, color: "var(--ink-3)", flex: 1 }}>
									Automatické zprávy — faktury, potvrzení, výpisy.
								</span>
							</div>
						)}

						{rows.map((vm) => (
							<MailRow
								key={vm.t.id}
								vm={vm}
								onCtx={(id, x, y) => setCtx({ id, x, y })}
							/>
						))}

						{rows.length === 0 && pinRows.length === 0 && (
							<div style={{ textAlign: "center", padding: "44px 20px" }}>
								<div style={{ fontFamily: "var(--w-font-display)", fontWeight: 700, fontSize: 13.5, color: "var(--ink)", marginBottom: 4 }}>
									Prázdno
								</div>
								<div style={{ fontFamily: "var(--w-font-body)", fontSize: 12.5, color: "var(--ink-3)" }}>
									V této složce teď nic není.
								</div>
							</div>
						)}

						{isDorView && m.grp === "inbox" && rozRows.length > 0 && (
							<div style={{ margin: "4px 0 16px", borderTop: "1px solid var(--line)", padding: "8px 14px 0" }}>
								<div
									onClick={() => m.setRozOn(!m.rozOn)}
									style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "3px 0" }}
								>
									<span
										title="Přečtené a otevřené konverzace bez rozhodnutí — vypadnou, jakmile dostanou stav, vlajku nebo odpověď"
										style={{ fontFamily: "var(--w-font-display)", fontWeight: 700, fontSize: 9.5, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink-3)" }}
									>
										Rozpracované
									</span>
									<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10, color: "var(--ink-3)" }}>{rozRows.length}</span>
									<svg width="9" height="9" viewBox="0 0 9 9" style={{ color: "var(--ink-3)", transform: m.rozOn ? "rotate(180deg)" : undefined }} aria-hidden>
										<path d="M2 3 L4.5 6 L7 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
									</svg>
								</div>
								{m.rozOn &&
									rozRows.map((vm) => (
										<div
											key={vm.t.id}
											onClick={() => m.openThread(vm.t.id)}
											style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 0", borderBottom: "1px solid var(--line)", cursor: "pointer" }}
										>
											<span
												data-av="ext"
												style={{
													width: 24,
													height: 24,
													borderRadius: "50%",
													color: "#fff",
													fontFamily: "var(--w-font-display)",
													fontWeight: 700,
													fontSize: 8.5,
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													flex: "none",
													background: "var(--avatar-navy)",
												}}
											>
												{vm.t.from.ini}
											</span>
											<span style={{ fontFamily: "var(--w-font-body)", fontSize: 12.5, color: "var(--ink-2)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
												{vm.t.subj}
											</span>
											<span data-mbdot={vm.t.mb} style={{ width: 7, height: 7, borderRadius: "50%", flex: "none" }} />
											<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10, color: "var(--ink-3)", flex: "none" }}>
												{vm.t.time}
											</span>
										</div>
									))}
							</div>
						)}
					</>
				)}
			</div>

			{/* kontextové menu řádku (pravý klik) */}
			<CtxMenu ctx={ctx} onClose={() => setCtx(null)} />
		</div>
	);
}

/** Gatekeeper — fronta nových odesílatelů (seed GK + rozhodnutí; prototyp gkRows). */
function GkQueue() {
	const m = useMail();
	const waiting = GK.filter((g) => !m.gkDone[g.id]);
	return (
		<div>
			<div style={{ padding: "2px 14px 10px", fontFamily: "var(--w-font-body)", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
				Noví odesílatelé čekají na screening — rozhodnutí platí pro všechny další zprávy od nich.
			</div>
			{waiting.length === 0 && (
				<div style={{ textAlign: "center", padding: "44px 20px", fontFamily: "var(--w-font-body)", fontSize: 12.5, color: "var(--ink-3)" }}>
					Fronta je prázdná — všichni noví odesílatelé jsou rozhodnutí.
				</div>
			)}
			{waiting.map((g) => (
				<Fragment key={g.id}>
					<div style={{ display: "flex", gap: 10, padding: "12px 14px 11px", borderBottom: "1px solid var(--line)" }}>
						<span
							data-av="ext"
							style={{
								width: 32,
								height: 32,
								borderRadius: "50%",
								background: "var(--avatar-navy)",
								color: "#fff",
								fontFamily: "var(--w-font-display)",
								fontWeight: 700,
								fontSize: 11,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								flex: "none",
							}}
						>
							{g.ini}
						</span>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
								<span style={{ fontFamily: "var(--w-font-display)", fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>{g.name}</span>
								<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10.5, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{g.addr}
								</span>
								<span style={{ flex: 1 }} />
								<span data-mbdot={g.mb} style={{ width: 8, height: 8, borderRadius: "50%", flex: "none" }} />
							</div>
							<div style={{ fontFamily: "var(--w-font-body)", fontSize: 12.5, color: "var(--ink-2)", marginTop: 2 }}>{g.subj}</div>
							<div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
								<span data-ghost onClick={() => m.gkDecide(g.id, "accept")} style={{ fontSize: 11, padding: "5px 10px", color: "var(--success-ink)" }}>
									Povolit
								</span>
								<span data-ghost onClick={() => m.gkDecide(g.id, "acceptDone")} style={{ fontSize: 11, padding: "5px 10px" }}>
									Povolit a vyřídit
								</span>
								<span data-ghost onClick={() => m.gkDecide(g.id, "block")} style={{ fontSize: 11, padding: "5px 10px", color: "var(--overdue)" }}>
									Blokovat
								</span>
								<span data-ghost onClick={() => m.gkDecide(g.id, "blockDom")} style={{ fontSize: 11, padding: "5px 10px", color: "var(--overdue)" }}>
									Blokovat doménu
								</span>
							</div>
						</div>
					</div>
				</Fragment>
			))}
		</div>
	);
}
