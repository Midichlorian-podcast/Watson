/**
 * Mail — panel 2: seznam konverzací (prototyp data-listpane, ř. 452–778 +
 * mailVals ř. 3510–3630): hlavička s titulem, zvonkem (NotifCenter), Ask
 * Watsonem a filtry, řádek aktivních chipů, záložky Inbox/Oznámení/Newslettery
 * (+ Dispečink s počty), AI fronta návrhů (banner, ř. 629–652), syncWarn,
 * blok Připnuté (3 + rozbalit), Rozpracované, řádky s hover akcemi, urgencí,
 * stavem, per-osoba štítkem „už četl(a)" a chipem úkolu; kontextové prázdné
 * stavy (empties, ř. 3657–3672) a Gatekeeper karty s verdiktem.
 */

import { useNavigate } from "@tanstack/react-router";
import {
	type CSSProperties,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { chipStyle, FilterSectionLabel, pillStyle } from "../components/filterUi";
import { NotifCenter } from "../components/NotifCenter";
import { storageGet, storageSet } from "../lib/storage";
import { showToast } from "../lib/toast";
import { type SwipeSide, useSwipe } from "../lib/useSwipe";
import { useWatson } from "../lib/watson";
import { CtxMenu } from "./CtxMenu";
import { AI_QUEUE_SEED, type AiQueueItem, GK, type MailThread, MB, P, SLA, STL } from "./data";
import { type ThreadEff, useMail } from "./state";

/** Ženská příjmení v seed světě (prototyp FEM — „už četla" vs „už četl"). */
const FEM: Record<string, 1> = { tm: 1, mh: 1, ps: 1 };

/** AI fronta návrhů (prototyp state.aiQ) — module cache, přežije přepnutí složek. */
const aiCache: { rows: AiQueueItem[]; open: boolean } = {
	rows: AI_QUEUE_SEED.map((q) => ({ ...q })),
	open: false,
};

/** Zvonek: tečka „neviděno" zmizí prvním otevřením (prototyp notifSeen). */
let bellSeen = false;

const lsGet = storageGet;
const lsSet = storageSet;

/** Kontextové prázdné stavy per složka/skupina (prototyp empties, ř. 3657–3672). */
const EMPTY_FALLBACK: [string, string] = ["Nic tu není", "Zatím žádné položky."];
const EMPTIES: Record<string, [string, string]> = {
	inbox: ["Inbox je prázdný", "Nové konverzace od přijatých odesílatelů se objeví tady."],
	ozn: ["Žádná oznámení", "Faktury, potvrzení a výpisy se třídí sem — mimo hlavní proud."],
	news: ["Žádné newslettery", "Hromadné odběry se drží stranou, dokud na ně nemáš čas."],
	archiv: ["Archiv je prázdný", "Archivované konverzace zůstávají dohledatelné hledáním."],
	f_sent: ["Nic odeslaného", "Odeslané odpovědi i nové zprávy se řadí sem."],
	f_drafts: [
		"Žádné koncepty",
		"Rozepsané odpovědi se ukládají samy — najdeš je tady i v chipech vpravo dole.",
	],
	f_arch: ["Archiv je prázdný", "Archivované konverzace zůstávají dohledatelné hledáním."],
	f_trash: ["Koš je prázdný", "Smazané konverzace tu drží 30 dní, pak zmizí."],
	f_block: ["Nikdo není blokovaný", "Blokovaní odesílatelé a spam končí tady — bez upozornění."],
	d_nepr: [
		"Vše je rozebrané",
		"Týmové konverzace bez vlastníka se objeví tady — u P1/P2 sem míří i eskalace.",
	],
	d_moje: ["Nic ti nevisí", "Konverzace předané tobě se objeví tady."],
	d_ost: ["Kolegové nic nedrží", "Co vyřizují ostatní, vidíš tady — bez zásahů do jejich práce."],
	d_done: [
		"Zatím nic dokončeného",
		"Hotové konverzace se ukládají sem a stav se zrcadlí do úkolů.",
	],
	jine: EMPTY_FALLBACK,
};

/** Labely chipů aktivních filtrů (prototyp fLbl, ř. 3632). */
const CHIP_LBL: Record<string, string> = {
	unread: "Nepřečtené",
	att: "S přílohou",
	mine: "Přiřazené mně",
	fu: "Follow-up",
};

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
				return isDor(t, e) && t.grp === "inbox" && !!e.owner && e.owner !== "ad" && !e.closed;
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
				// koncepty: seed koncepty + ŽIVĚ rozepsané odpovědi odkudkoli
				// (vlákno, plovoucí okno, peek z Přehledu/Velína — persist drafts)
				if (m.fdr === "koncepty") return !!t.draftF || !!m.drafts[t.id]?.text?.trim();
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
					.sort((a, b) => (pOrd[m.eff(a).flag] ?? 4) - (pOrd[m.eff(b).flag] ?? 4));
				rozList = main.filter((t) => t.roz && !m.eff(t).pin);
				main = main.filter((t) => !m.eff(t).pin && !t.roz);
			}
		}

		const vm = (t: MailThread): RowVM => {
			const e = m.eff(t);
			const isInbox = grpOf(t) === "inbox" && !t.personal && !t.sentF && !t.draftF;
			const hasDraftRaw = !!m.drafts[t.id]?.text?.trim();
			const stRaw =
				(isInbox || !!t.sentF) && (e.st === "ceka" || e.st === "odeslano" || e.st === "hotovo");
			const links = m.taskLinks[t.id] ?? [];
			const ts = m.bridge.taskStates;
			const taskDone = links.length > 0 && links.every((x) => ts?.[x.app]?.done);
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
				stLabel: e.closed && m.unreadFor(t) ? "Hotovo · nová odpověď" : (STL[e.st] ?? e.st),
				showSt: stRaw || (e.closed && m.unreadFor(t)),
				showMb: m.folder === "vse" && !t.personal,
				isInbox,
				hasDraft: hasDraftRaw,
				rbOn: m.readModeOf(t) === "per" && m.unreadFor(t) && rb.length > 0 && !t.personal,
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

const rowBtn = (onClick: (e: MouseEvent) => void, title: string, child: ReactNode) => (
	<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }} data-rowbtn onClick={onClick} title={title}>
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
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.9"
					strokeLinecap="round"
					aria-hidden
				>
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
					<path
						d="M2.5 7.4 L5.5 10.4 L11.5 3.6"
						stroke="currentColor"
						strokeWidth="1.7"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>,
			)}
			{rowBtn(
				stop(() => m.rowAct(id, "pin")),
				"Připnout (D)",
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.9"
					aria-hidden
				>
					<path d="M9 4 H15 L14.2 10 C16 10.8 17 12.2 17.2 14 H6.8 C7 12.2 8 10.8 9.8 10 Z" />
					<line x1="12" y1="14" x2="12" y2="20" />
				</svg>,
			)}
			{rowBtn(
				stop(() => m.rowAct(id, "snooze")),
				"Odložit na zítra (S)",
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.9"
					aria-hidden
				>
					<circle cx="12" cy="12" r="8" />
					<path d="M12 7.5 V12 L15.2 14.4" />
				</svg>,
			)}
			{vm.e.arch || vm.e.trash
				? rowBtn(
						stop(() => m.rowAct(id, "restore")),
						"Vrátit do Inboxu",
						<svg
							width="13"
							height="13"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.9"
							strokeLinecap="round"
							aria-hidden
						>
							<rect x="4" y="10" width="16" height="9" rx="1.4" />
							<path d="M12 14 V4 M8.5 7.5 L12 4 L15.5 7.5" />
						</svg>,
					)
				: rowBtn(
						stop(() => m.rowAct(id, "arch")),
						"Archivovat (E)",
						<svg
							width="13"
							height="13"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.9"
							aria-hidden
						>
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
	// Swipe — JEDNOTNÝ systém s úkoly (lib/useSwipe): akce se provede PŘI
	// PUŠTĚNÍ (dotyk/stisk/trackpad po usazení) — bez potvrzovacích tlačítek.
	const swcRef = useRef<HTMLDivElement>(null);
	const swuRef = useRef<HTMLDivElement>(null);

	// stavové akce stran — reverzní pro reverzní stav (feedback: pin↔odepnout…)
	const sideActs = (side: SwipeSide) =>
		side === "r"
			? [
					e.closed
						? {
								css: "done",
								label: "Vrátit",
								run: () => {
									m.setOv(t.id, { closed: false, st: "otevreny" });
									showToast("Vráceno mezi otevřené");
								},
							}
						: { css: "done", label: "Hotovo", run: () => m.rowAct(t.id, "done") },
					{
						css: "pin",
						label: e.pin ? "Odepnout" : "Připnout",
						run: () => m.rowAct(t.id, "pin"),
					},
				]
			: [
					e.snoozed
						? {
								css: "snooze",
								label: "Probudit",
								run: () => m.rowAct(t.id, "restore"),
							}
						: {
								css: "snooze",
								label: "Odložit",
								run: () => m.rowAct(t.id, "snooze"),
							},
					e.arch
						? { css: "arch", label: "Obnovit", run: () => m.rowAct(t.id, "restore") }
						: { css: "arch", label: "Archiv", run: () => m.rowAct(t.id, "arch") },
				];

	// vizuál: hook dodává eased dx + mag → DOM zápis (data-swu/pilulky prototypu)
	const swApply = (dx: number, mag: string) => {
		const swc = swcRef.current;
		const swu = swuRef.current;
		if (!swc || !swu) return;
		if (dx === 0) {
			swc.style.transition = "transform .18s ease";
			setTimeout(() => {
				if (swcRef.current) swcRef.current.style.transition = "";
			}, 200);
		} else {
			swc.style.transition = "";
		}
		swc.style.transform = `translateX(${dx}px)`;
		const side: SwipeSide = dx > 0 ? "r" : "l";
		const acts = sideActs(side);
		const tierAct = mag === "none" ? null : (acts[mag.endsWith("2") ? 1 : 0] ?? null);
		swu.setAttribute("data-mag", mag);
		swu.setAttribute("data-act", tierAct ? tierAct.css : "none");
		const pill = swu.querySelector<HTMLElement>(`[data-swpill="${side}"]`);
		const other = swu.querySelector<HTMLElement>(`[data-swpill="${side === "r" ? "l" : "r"}"]`);
		if (pill) {
			pill.style.width = dx === 0 ? "0px" : `${Math.max(0, Math.abs(dx) - 16)}px`;
			const txt = pill.querySelector("[data-swtxt]");
			if (txt) txt.textContent = tierAct ? tierAct.label : "";
		}
		if (other) other.style.width = "0px";
	};

	const swipe = useSwipe({
		onUpdate: swApply,
		onSwipe: (mag: "r1" | "r2" | "l1" | "l2") => {
			const acts = sideActs(mag[0] === "r" ? "r" : "l");
			acts[mag.endsWith("2") ? 1 : 0]?.run();
		},
	});
	return (
		<div
			role="group"
			aria-label={`Vlákno ${t.subj}`}
			onContextMenu={(ev) => {
				if (!onCtx) return;
				ev.preventDefault();
				onCtx(t.id, ev.clientX, ev.clientY);
			}}
			{...swipe.handlers}
			data-tid={t.id}
			data-mrow
			data-swipe-surface="mail"
			data-sel={m.sel === t.id || undefined}
			data-unread={vm.unread || undefined}
			style={{
				touchAction: "pan-y",
				overscrollBehaviorX: "none",
				position: "relative",
				overflow: "hidden",
			}}
		>
			{/* podklad swipe akcí (prototyp data-swu + pilulky, CSS ř. 76–86) */}
			<div ref={swuRef} data-swu data-mag="none" data-act="none">
				<span data-swpill="r">
					<span data-swtxt />
				</span>
				<span data-swpill="l">
					<span data-swtxt />
				</span>
			</div>

			<div ref={swcRef} data-swc style={{ display: "flex", gap: 10, padding: "12px 14px 11px" }}>
				<RowActs vm={vm} />
				<span
					data-pbar={e.flag}
					style={{
						position: "absolute",
						left: 0,
						top: 8,
						bottom: 8,
						width: 3,
						borderRadius: "0 2px 2px 0",
					}}
				/>
				<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
					data-mainav
					onClick={(ev) => {
						ev.stopPropagation();
						m.toggleSel(t.id);
					}}
					title="Vybrat do hromadných akcí (X)"
					style={{ flex: "none", marginTop: 1, cursor: "pointer" }}
				>
					{selOn ? (
						<span
							style={{
								width: 32,
								height: 32,
								borderRadius: "50%",
								background: "var(--brass)",
								color: "#fff",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
								<path
									d="M2.5 7.4 L5.5 10.4 L11.5 3.6"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
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
				<div
					role="button"
					tabIndex={0}
					aria-label={`Otevřít vlákno ${t.subj}`}
					onClick={() => {
						if (swipe.swipedRecently()) return;
						m.openThread(t.id);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							m.openThread(t.id);
						}
					}}
					style={{ flex: 1, minWidth: 0 }}
				>
					<div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
						{e.pin && (
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="var(--brass)"
								style={{ flex: "none" }}
								aria-hidden
							>
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
							<span
								style={{
									fontFamily: "var(--w-font-mono)",
									fontSize: 10,
									color: "var(--ink-3)",
									flex: "none",
								}}
							>
								{vm.nmsg}
							</span>
						)}
						<span style={{ flex: 1 }} />
						{t.att && !compactPin && (
							<svg
								width="11"
								height="11"
								viewBox="0 0 14 14"
								fill="none"
								style={{ color: "var(--ink-3)", flex: "none" }}
								aria-hidden
							>
								<path
									d="M11 6.2 L6.8 10.4 A2.6 2.6 0 0 1 3.1 6.7 L7.6 2.2 A1.8 1.8 0 0 1 10.2 4.8 L5.9 9.1 A0.9 0.9 0 0 1 4.6 7.8 L8.4 4"
									stroke="currentColor"
									strokeWidth="1.2"
									strokeLinecap="round"
								/>
							</svg>
						)}
						{e.muted && (
							<svg
								width="11"
								height="11"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								style={{ color: "var(--ink-3)", flex: "none" }}
								aria-hidden
							>
								<path d="M9.5 19 A2.6 2.6 0 0 0 14.5 19" />
								<path d="M6 16.4 V11 A6 6 0 0 1 14.8 5.7 M17.9 9.4 C18 9.9 18 10.4 18 11 V16.4 L19.4 18 H8" />
								<line x1="4" y1="4" x2="20" y2="20" />
							</svg>
						)}
						<span
							style={{
								fontFamily: "var(--w-font-mono)",
								fontSize: 10.5,
								color: "var(--ink-3)",
								flex: "none",
							}}
						>
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
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								flexWrap: "wrap",
								marginTop: 7,
							}}
						>
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
										<path
											d="M2 1 V11 M2 1.5 H8.6 L7 4.25 L8.6 7 H2"
											stroke="currentColor"
											strokeWidth="1.4"
											strokeLinejoin="round"
										/>
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
										<path
											d="M2.5 7.4 L5.5 10.4 L11.5 3.6"
											stroke="currentColor"
											strokeWidth="1.8"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
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
										<path
											d="M2 12 L2.8 9.2 L9.8 2.2 A1.1 1.1 0 0 1 11.4 2.2 L11.8 2.6 A1.1 1.1 0 0 1 11.8 4.2 L4.8 11.2 Z"
											stroke="currentColor"
											strokeWidth="1.3"
											strokeLinejoin="round"
										/>
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
	listWidth,
	onOpenDrawer,
	onSearch,
	onCompose,
}: {
	listWidth: number;
	onOpenDrawer: () => void;
	onSearch: () => void;
	onCompose: () => void;
}) {
	const m = useMail();
	const navigate = useNavigate();
	const { isDorView, gN, pinRows, rozRows, rows, order } = useListRows();
	const [vmenu, setVmenu] = useState(false);
	// kontextové menu řádku (pravý klik); hledání a Napsat řídí MailScreen (⌘K/C)
	const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null);
	// zvonek (NotifCenter) ukotvený na hlavičce; Watson = JEDEN globální (karta W)
	const [notifOn, setNotifOn] = useState(false);
	const { toggleWatson } = useWatson();
	const [bellDot, setBellDot] = useState(!bellSeen);
	// zobrazení: hustota + počet řádků náhledu (prototyp dens/lines, persist)
	const [dens, setDensRaw] = useState<"comfort" | "compact">(() =>
		lsGet("watson-mail.dens") === "compact" ? "compact" : "comfort",
	);
	const [lines, setLinesRaw] = useState<1 | 2>(() => (lsGet("watson-mail.lines") === "1" ? 1 : 2));
	const setDens = (v: "comfort" | "compact") => {
		setDensRaw(v);
		lsSet("watson-mail.dens", v);
	};
	const setLines = (v: 1 | 2) => {
		setLinesRaw(v);
		lsSet("watson-mail.lines", String(v));
	};
	// šířka seznamu z resize táhla (MailScreen) — při mountu se obnoví z localStorage
	// AI fronta návrhů (prototyp aiQ + aiDecide, ř. 3316–3336)
	const [aiQ, setAiQ] = useState<AiQueueItem[]>(aiCache.rows);
	const [aiOpen, setAiOpenRaw] = useState(aiCache.open);
	const setAiOpen = (v: boolean) => {
		aiCache.open = v;
		setAiOpenRaw(v);
	};
	const setAiRows = (rowsN: AiQueueItem[]) => {
		aiCache.rows = rowsN;
		setAiQ(rowsN);
	};
	/** Provedení schváleného návrhu (prototyp aiDecide — route/flag/grp/draftall). */
	const applyAi = (q: AiQueueItem) => {
		if (q.k === "route") m.setOwner(q.th, q.who ?? null);
		else if (q.k === "flag") m.setFlag(q.th, q.flag ?? "p3");
		else if (q.k === "grp") m.setOv(q.th, { grp: "ozn" });
		else if ((q.k as string) === "draftall") {
			m.setDraft(q.th, "", "draft");
			showToast("Návrh odpovědi čeká v editoru vlákna");
		}
	};
	const aiDecide = (i: number, yes: boolean) => {
		const q = aiQ[i];
		if (q?.st !== "ceka") return;
		if (yes) applyAi(q);
		setAiRows(aiQ.map((z, j) => (j === i ? { ...z, st: yes ? "ok" : "no" } : z)));
		showToast(
			yes ? "Schváleno a provedeno — zapsáno do Dění." : "Zamítnuto — AI si korekci zapíše.",
		);
	};
	const aiAll = () => {
		const waiting = aiQ.filter((q) => q.st === "ceka");
		for (const q of waiting) applyAi(q);
		setAiRows(aiQ.map((z) => (z.st === "ceka" ? { ...z, st: "ok" } : z)));
		showToast(`Schváleno ${waiting.length} návrhů najednou — zapsáno do Dění.`);
	};
	const aiWait = aiQ.filter((q) => q.st === "ceka").length;
	const aiPlural =
		aiWait === 1 ? "AI návrh čeká" : aiWait < 5 ? "AI návrhy čekají" : "AI návrhů čeká";
	const vmenuRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!vmenu) return;
		const h = (e: globalThis.MouseEvent) => {
			if (vmenuRef.current && !vmenuRef.current.contains(e.target as Node)) setVmenu(false);
		};
		document.addEventListener("mousedown", h);
		return () => document.removeEventListener("mousedown", h);
	}, [vmenu]);

	// Akce hlavičky navíc zavřou popover Filtry/Zobrazení — jinak zůstal otevřený
	// „na pozadí" pod jiným overlayem (audit LOW MailList.tsx:1012).
	const openDrawer = () => {
		setVmenu(false);
		onOpenDrawer();
	};
	const openSearch = () => {
		setVmenu(false);
		onSearch();
	};
	const openBell = () => {
		setVmenu(false);
		bellSeen = true;
		setBellDot(false);
		setNotifOn(true);
	};
	// Watson v mailu = TÝŽ globální Watson jako všude jinde (jedna karta, jedno chování).
	const openAsk = () => {
		setVmenu(false);
		toggleWatson();
	};
	const openCompose = () => {
		setVmenu(false);
		onCompose();
	};
	const toggleVmenu = () => setVmenu((v) => !v);
	// Hromadné „→ úkoly": jeden souhrnný toast (i pro 1 vlákno), per-vlákno hlášky
	// quickTasku potlačené (audit LOW MailList.tsx:1674).
	const bulkToTasks = () => {
		const ids = Object.keys(m.selIds);
		let created = 0;
		let skipped = 0;
		for (const id of ids) {
			if (m.quickTask(id, { silent: true }) === "created") created++;
			else skipped++;
		}
		m.clearSel();
		showToast(
			skipped
				? `${created} úkolů založeno · ${skipped} přeskočeno (už úkol mají)`
				: `${created} úkolů založeno z vybraných vláken`,
		);
	};

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
	const activeF = FROWS.filter((f) => m.filters[f.k]);

	/** Počty Dispečinku na záložkách (prototyp dCounts, ř. 3709–3716). */
	const dC = useMemo(() => {
		const team = m.threads.filter((t) => !t.personal);
		const isDorT = (t: MailThread) => {
			const e = m.eff(t);
			return !t.sentF && !t.draftF && !e.arch && !e.snoozed && !e.spam && !e.trash;
		};
		const base = team.filter((t) => isDorT(t) && t.grp === "inbox");
		const n = base.filter((t) => {
			const e = m.eff(t);
			return !e.owner && !e.closed;
		}).length;
		const mo = base.filter((t) => {
			const e = m.eff(t);
			return e.owner === "ad" && !e.closed;
		}).length;
		const o = base.filter((t) => {
			const e = m.eff(t);
			return !!e.owner && e.owner !== "ad" && !e.closed;
		}).length;
		const d = team.filter((t) => {
			const e = m.eff(t);
			return e.closed && !e.trash;
		}).length;
		return {
			n: n ? String(n) : "",
			m: mo ? String(mo) : "",
			o: o ? String(o) : "",
			d: d ? String(d) : "",
		};
	}, [m]);

	/** Zvonek má co ukázat — zrcadlí odvození položek NotifCenteru. */
	const hasNotif =
		m.gkLeft > 0 ||
		m.threads.some((t) => {
			if (t.personal) return false;
			const e = m.eff(t);
			if ((e.flag === "p1" || e.flag === "p2") && !e.closed && !e.sent) return true;
			if (t.bounce && !m.ovOf(t.id).bounceFixed) return true;
			return t.chat.some((c) => c.m === "@Adam" && c.who !== "ad");
		});

	// AI banner jen v Inboxu složky Vše (prototyp aiBan.show, ř. 3728)
	const aiShow = isDorView && m.grp === "inbox" && m.folder === "vse" && aiWait > 0;
	// podcast@ token — banner nad seznamem, dokud admin neobnoví (prototyp ř. 3794)
	const syncWarn = m.folder === "vse" && !!MB.podcast?.warn && !m.adm.fixed;

	/** Prázdný stav dle složky/skupiny (prototyp ek, ř. 3673). */
	const ekey = EMPTIES[m.folder]
		? m.folder
		: m.fdr === "archiv"
			? "archiv"
			: isDorView
				? m.grp
				: "jine";
	const [emptyT, emptyS] = EMPTIES[ekey] ?? EMPTY_FALLBACK;

	/** Označit vše v aktuálním pohledu jako přečtené (prototyp markAllRead, ř. 3699). */
	const markAllRead = () => {
		for (const id of order) m.setOv(id, { read: true });
		setVmenu(false);
		showToast("Vše v aktuálním pohledu označeno jako přečtené.");
	};

	return (
		<div
			data-listpane
			data-dens={dens}
			data-lines={lines}
			style={{
				display: "flex",
				flexDirection: "column",
				minHeight: 0,
				background: "var(--panel)",
				position: "relative",
				width: listWidth,
			}}
		>
			<div
				style={{
					flex: "none",
					padding: "11px 14px 0",
					display: "flex",
					flexDirection: "column",
					gap: 9,
				}}
			>
				<div
					ref={vmenuRef}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 7,
						position: "relative",
						zIndex: 45,
					}}
				>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-msubbtn
						onClick={openDrawer}
						aria-label="Schránky a složky"
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
							<line
								x1="2.5"
								y1="4.5"
								x2="13.5"
								y2="4.5"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
							<line
								x1="2.5"
								y1="8"
								x2="13.5"
								y2="8"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
							<line
								x1="2.5"
								y1="11.5"
								x2="10"
								y2="11.5"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
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
						<span
							style={{
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								minWidth: 0,
							}}
						>
							{listTitle(m.folder, m.fdr)}
						</span>
					</span>
					<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10.5, color: "var(--ink-3)" }}>
						{isGk ? m.gkLeft : pinRows.length + rows.length}
					</span>
					<span style={{ flex: 1 }} />
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-rowbtn
						onClick={openSearch}
						aria-label="Hledat v poště"
						title="Hledat v poště ( / nebo ⌘K )"
						style={{ border: "1px solid var(--line)", background: "var(--panel)" }}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.9"
							aria-hidden
						>
							<circle cx="10.5" cy="10.5" r="6" />
							<line x1="15" y1="15" x2="20" y2="20" />
						</svg>
					</span>
					{/* zvonek — NotifCenter (prototyp ui.bell, ř. 329) */}
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-rowbtn
						onClick={openBell}
						aria-label="Oznámení"
						title="Oznámení"
						style={{
							border: "1px solid var(--line)",
							background: "var(--panel)",
							position: "relative",
						}}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.9"
							aria-hidden
						>
							<path d="M6.6 17 C6.6 11.2 7.8 8.6 12 8.6 C16.2 8.6 17.4 11.2 17.4 17 Z" />
							<line x1="5" y1="17" x2="19" y2="17" />
							<path d="M10.2 20 A2.1 2.1 0 0 0 13.8 20" />
							<line x1="12" y1="6" x2="12" y2="8.6" />
						</svg>
						{bellDot && hasNotif && (
							<span
								style={{
									position: "absolute",
									top: 2,
									right: 3,
									width: 6,
									height: 6,
									borderRadius: "50%",
									background: "var(--overdue)",
									boxShadow: "0 0 0 2px var(--panel)",
								}}
							/>
						)}
					</span>
					{/* Ask Watson — mosazné W (prototyp ui.ask, ř. 330) */}
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-rowbtn
						onClick={openAsk}
						aria-label="Zeptej se Watsona"
						title="Zeptej se Watsona"
						style={{
							border: "1px solid var(--brass)",
							background: "var(--brass-soft)",
							color: "var(--brass-text)",
						}}
					>
						<span
							style={{
								width: 14,
								height: 14,
								borderRadius: "50%",
								border: "1.6px solid currentColor",
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								fontSize: 8,
								fontWeight: 800,
								fontFamily: "var(--w-font-display)",
							}}
						>
							W
						</span>
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-rowbtn
						onClick={toggleVmenu}
						aria-label="Filtry a zobrazení"
						title="Filtry a zobrazení"
						style={{
							border: "1px solid var(--line)",
							background: "var(--panel)",
							position: "relative",
						}}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							aria-hidden
						>
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
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-primary
						onClick={openCompose}
						aria-label="Napsat novou zprávu"
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							fontSize: 12,
							padding: "7px 13px",
						}}
					>
						<svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
							<path
								d="M2 12 L2.8 9.2 L9.8 2.2 A1.1 1.1 0 0 1 11.4 2.2 L11.8 2.6 A1.1 1.1 0 0 1 11.8 4.2 L4.8 11.2 Z"
								stroke="currentColor"
								strokeWidth="1.3"
								strokeLinejoin="round"
							/>
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
							{/* Filtry — sdílený vzhled s toolbarem úkolů (pilulky + „Vymazat filtry“). */}
							<div style={{ padding: "4px 9px 2px" }}>
								<FilterSectionLabel>Filtry</FilterSectionLabel>
								<div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
									{FROWS.map((f) => (
										<button
											key={f.k}
											type="button"
											onClick={() => m.toggleFilter(f.k)}
											style={pillStyle(m.filters[f.k], 11.5, "4px 10px")}
										>
											{f.label}
										</button>
									))}
								</div>
								{fCount > 0 && (
									<button
										type="button"
										onClick={() => {
											for (const f of activeF) m.toggleFilter(f.k);
										}}
										style={{
											marginTop: 8,
											fontFamily: "var(--w-font-display)",
											fontWeight: 600,
											fontSize: 11.5,
											color: "var(--w-brass-text)",
											background: "transparent",
											border: "none",
											cursor: "pointer",
											padding: 0,
										}}
									>
										Vymazat filtry
									</button>
								)}
							</div>
							{/* Zobrazení — hustota a náhled (prototyp ř. 483–492) */}
							<div
								style={{
									padding: "8px 9px 2px",
									borderTop: "1px solid var(--line)",
									marginTop: 7,
								}}
							>
								<FilterSectionLabel>Zobrazení</FilterSectionLabel>
								<div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
									<button
										type="button"
										onClick={() => setDens("comfort")}
										style={pillStyle(dens === "comfort", 11.5, "4px 10px")}
									>
										Komfortní
									</button>
									<button
										type="button"
										onClick={() => setDens("compact")}
										style={pillStyle(dens === "compact", 11.5, "4px 10px")}
									>
										Kompaktní
									</button>
								</div>
							</div>
							<div
								style={{ display: "flex", gap: 5, padding: "6px 9px 2px", alignItems: "center" }}
							>
								<span
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 11,
										color: "var(--ink-3)",
										flex: 1,
									}}
								>
									Náhled
								</span>
								<button
									type="button"
									onClick={() => setLines(1)}
									style={pillStyle(lines === 1, 11.5, "4px 10px")}
								>
									1 řádek
								</button>
								<button
									type="button"
									onClick={() => setLines(2)}
									style={pillStyle(lines === 2, 11.5, "4px 10px")}
								>
									2 řádky
								</button>
							</div>
							<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={markAllRead}
								data-menuitem
								style={{ borderTop: "1px solid var(--line)", marginTop: 7 }}
							>
								Označit vše jako přečtené
							</div>
						</div>
					)}
				</div>

				{/* řádek aktivních filtrů (prototyp ř. 497–504) */}
				{fCount > 0 && (
					<div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
						{activeF.map((f) => (
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								key={f.k}
								onClick={() => m.toggleFilter(f.k)}
								style={{ ...chipStyle(true, 999), fontSize: 11, padding: "3px 6px 3px 11px" }}
							>
								{CHIP_LBL[f.k]}
								<span style={{ fontSize: 12, lineHeight: 1, opacity: 0.7 }}>×</span>
							</span>
						))}
						<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
							onClick={() => {
								for (const f of activeF) m.toggleFilter(f.k);
							}}
							style={{
								fontFamily: "var(--w-font-display)",
								fontWeight: 600,
								fontSize: 11,
								color: "var(--w-brass-text)",
								cursor: "pointer",
								padding: "3px 4px",
							}}
						>
							Vymazat filtry
						</span>
					</div>
				)}

				{isDorView && !isGk && (
					<div
						style={{
							display: "flex",
							background: "var(--panel-2)",
							border: "1px solid var(--line)",
							borderRadius: 10,
							padding: 3,
						}}
					>
						{(
							[
								["inbox", "Inbox", gN.inbox],
								["ozn", "Oznámení", gN.ozn],
								["news", "Newslettery", gN.news],
							] as const
						).map(([k, label, n]) => (
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
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
								<span style={{ fontFamily: "var(--w-font-mono)", fontSize: 10.5, opacity: 0.65 }}>
									{n}
								</span>
							</span>
						))}
					</div>
				)}

				{dispOn && (
					<div
						style={{
							display: "flex",
							background: "var(--panel-2)",
							border: "1px solid var(--line)",
							borderRadius: 10,
							padding: 3,
						}}
					>
						{(
							[
								["d_nepr", "Nepřiřazené", dC.n, true],
								["d_moje", "Moje", dC.m, false],
								["d_ost", "Ostatních", dC.o, false],
								["d_done", "Hotové", dC.d, false],
							] as const
						).map(([k, label, n, brass]) => (
							<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
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
								{/* počty záložek Dispečinku (prototyp dCounts, ř. 514–517) */}
								{!!n && (
									<span
										style={{
											fontFamily: "var(--w-font-mono)",
											fontSize: 10,
											...(brass ? { color: "var(--brass-text)" } : { opacity: 0.65 }),
										}}
									>
										{n}
									</span>
								)}
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
					<span
						style={{
							fontFamily: "var(--w-font-display)",
							fontWeight: 700,
							fontSize: 11.5,
							color: "var(--brass-text)",
							flex: "none",
						}}
					>
						{selCount} vybráno
					</span>
					<span style={{ flex: 1 }} />
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-ghost
						onClick={bulkToTasks}
						title="Z každého vybraného vlákna vznikne úkol s předvyplněním"
						style={{ fontSize: 11, padding: "5px 10px", color: "var(--brass-text)" }}
					>
						→ úkoly
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-ghost
						onClick={() => m.bulkAct("done")}
						style={{ fontSize: 11, padding: "5px 10px" }}
					>
						Hotovo
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-ghost
						onClick={() => m.bulkAct("unread")}
						style={{ fontSize: 11, padding: "5px 10px" }}
					>
						Přečtené
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-ghost
						onClick={() => m.bulkAct("snooze")}
						style={{ fontSize: 11, padding: "5px 10px" }}
					>
						Odložit
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-ghost
						onClick={() => m.bulkAct("arch")}
						style={{ fontSize: 11, padding: "5px 10px" }}
					>
						Archiv
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-ghost
						onClick={() => m.bulkAct("trash")}
						style={{ fontSize: 11, padding: "5px 10px", color: "var(--overdue)" }}
					>
						Koš
					</span>
					<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
						data-rowbtn
						onClick={m.clearSel}
						aria-label="Zrušit výběr"
						title="Zrušit výběr (Esc)"
						style={{ border: "1px solid var(--line)", background: "var(--panel)" }}
					>
						×
					</span>
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
						<svg
							width="13"
							height="13"
							viewBox="0 0 12 12"
							fill="none"
							style={{ color: "var(--mb-osobni)", flex: "none", marginTop: 1 }}
							aria-hidden
						>
							<rect
								x="2.2"
								y="5"
								width="7.6"
								height="5.2"
								rx="1.2"
								stroke="currentColor"
								strokeWidth="1.3"
							/>
							<path d="M4 5 V3.8 A2 2 0 0 1 8 3.8 V5" stroke="currentColor" strokeWidth="1.3" />
						</svg>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div
								style={{
									fontFamily: "var(--w-font-display)",
									fontWeight: 700,
									fontSize: 10.5,
									letterSpacing: ".05em",
									color: "var(--pers-ink)",
								}}
							>
								OSOBNÍ SCHRÁNKA — DEMO
							</div>
							<div
								style={{
									fontFamily: "var(--w-font-body)",
									fontSize: 11.5,
									color: "var(--ink-2)",
									lineHeight: 1.5,
									marginTop: 2,
								}}
							>
								Uložené zprávy nikdo z provozu nečte. Bez AI, bez týmových funkcí, mimo dohled
								adminů.
							</div>
						</div>
					</div>
				)}

				{isGk ? (
					<GkQueue />
				) : (
					<>
						{/* syncWarn — podcast@ token (prototyp ř. 622–628) */}
						{syncWarn && (
							<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
								onClick={() => void navigate({ to: "/nastaveni", hash: "posta-admin" })}
								style={{
									margin: "0 14px 8px",
									display: "flex",
									alignItems: "center",
									gap: 8,
									border: "1px solid var(--line)",
									borderRadius: 10,
									padding: "6px 11px",
									cursor: "pointer",
									background: "var(--panel-2)",
								}}
							>
								<span
									data-health="warn"
									style={{ width: 7, height: 7, borderRadius: "50%", flex: "none" }}
								/>
								<span
									style={{
										flex: 1,
										fontFamily: "var(--w-font-body)",
										fontSize: 11.5,
										color: "var(--ink-2)",
									}}
								>
									podcast@ se nedaří synchronizovat (token vyprší) — ostatní schránky jedou normálně
								</span>
								<span
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 10.5,
										color: "var(--brass-text)",
										flex: "none",
									}}
								>
									Obnovit →
								</span>
							</div>
						)}

						{/* AI fronta návrhů — banner ke schválení (prototyp aiBan, ř. 629–652) */}
						{aiShow && (
							<div
								style={{
									margin: "0 14px 10px",
									border: "1px dashed var(--brass)",
									borderRadius: 11,
									background: "var(--brass-soft)",
									overflow: "hidden",
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: 9,
										padding: "8px 12px",
										flexWrap: "wrap",
									}}
								>
									<span
										style={{
											width: 16,
											height: 16,
											borderRadius: "50%",
											border: "1.6px solid var(--brass-text)",
											color: "var(--brass-text)",
											display: "inline-flex",
											alignItems: "center",
											justifyContent: "center",
											fontSize: 8.5,
											fontWeight: 800,
											fontFamily: "var(--w-font-display)",
											flex: "none",
										}}
									>
										W
									</span>
									<span
										style={{
											flex: 1,
											minWidth: 120,
											fontFamily: "var(--w-font-body)",
											fontSize: 12,
											color: "var(--ink-2)",
										}}
									>
										<span style={{ fontWeight: 600, color: "var(--brass-text)" }}>{aiWait}</span>{" "}
										{aiPlural} na schválení
									</span>
									<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={() => setAiOpen(!aiOpen)}
										data-ghost
										style={{
											fontSize: 10.5,
											padding: "4px 11px",
											background: "var(--panel)",
											flex: "none",
										}}
									>
										{aiOpen ? "Skrýt" : "Projít"}
									</span>
									<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={aiAll}
										data-primary
										style={{ fontSize: 10.5, padding: "4px 12px", flex: "none" }}
									>
										Schválit vše ({aiWait})
									</span>
								</div>
								{aiOpen &&
									aiQ.map((q, i) =>
										q.st !== "ceka" ? null : (
											<div
												key={`${q.k}:${q.th}`}
												style={{
													display: "flex",
													gap: 9,
													padding: "9px 12px",
													borderTop: "1px solid var(--line)",
													background: "var(--panel)",
													alignItems: "flex-start",
												}}
											>
												<div style={{ flex: 1, minWidth: 0 }}>
													<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
														onClick={() => m.openThread(q.th)}
														style={{
															fontFamily: "var(--w-font-body)",
															fontSize: 12,
															color: "var(--ink)",
															cursor: "pointer",
														}}
													>
														{q.txt}
													</div>
													<div
														style={{
															fontFamily: "var(--w-font-body)",
															fontSize: 10.5,
															color: "var(--ink-3)",
															marginTop: 2,
															lineHeight: 1.45,
														}}
													>
														<span
															style={{
																fontFamily: "var(--w-font-mono)",
																fontSize: 9,
																border: "1px solid var(--line)",
																borderRadius: 4,
																padding: "0 4px",
																marginRight: 5,
															}}
														>
															proč
														</span>
														{q.why}
													</div>
												</div>
												<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
													onClick={() => aiDecide(i, true)}
													data-ghost
													style={{
														fontSize: 10,
														padding: "3px 10px",
														color: "var(--success-ink)",
														borderColor: "var(--success)",
														flex: "none",
														background: "var(--panel)",
													}}
												>
													Schválit
												</span>
												<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
													onClick={() => aiDecide(i, false)}
													data-ghost
													style={{
														fontSize: 10,
														padding: "3px 10px",
														flex: "none",
														background: "var(--panel)",
													}}
												>
													Zamítnout
												</span>
											</div>
										),
									)}
							</div>
						)}

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
									<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={() => m.setPinExp(true)}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 8,
											padding: "8px 14px",
											cursor: "pointer",
											borderBottom: "1px solid var(--line)",
										}}
									>
										<svg
											width="11"
											height="11"
											viewBox="0 0 24 24"
											fill="var(--ink-3)"
											style={{ flex: "none" }}
											aria-hidden
										>
											<path d="M9 3.4 H15 L14.3 10 C16.2 10.9 17.2 12.3 17.4 14.2 H6.6 C6.8 12.3 7.8 10.9 9.7 10 Z" />
											<rect x="11.2" y="14" width="1.6" height="6.2" rx="0.8" />
										</svg>
										<span
											style={{
												fontFamily: "var(--w-font-display)",
												fontWeight: 600,
												fontSize: 11.5,
												color: "var(--brass-text)",
											}}
										>
											Zobrazit dalších {pinMore} připnutých
										</span>
									</div>
								)}
								{m.pinExp && (
									<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										onClick={() => m.setPinExp(false)}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 8,
											padding: "8px 14px",
											cursor: "pointer",
											borderBottom: "1px solid var(--line)",
										}}
									>
										<span
											style={{
												fontFamily: "var(--w-font-display)",
												fontWeight: 600,
												fontSize: 11.5,
												color: "var(--ink-3)",
											}}
										>
											Sbalit připnuté na 3 nejnovější
										</span>
									</div>
								)}
								<div style={{ ...secHead, padding: "10px 14px 4px" }}>Konverzace</div>
							</>
						)}

						{m.grp === "ozn" && isDorView && (
							<div style={{ margin: "0 14px 8px", display: "flex", alignItems: "center", gap: 8 }}>
								<span
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 11.5,
										color: "var(--ink-3)",
										flex: 1,
									}}
								>
									Automatické zprávy — faktury, potvrzení, výpisy.
								</span>
								{/* označit oznámení jako viděná (prototyp oznBar, ř. 546–551) */}
								{rows.length > 0 && (
									<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
										data-ghost
										onClick={() => {
											for (const r of rows) m.setOv(r.t.id, { read: true });
											showToast("Oznámení označena jako viděná.");
										}}
										style={{ fontSize: 11, padding: "4px 10px" }}
									>
										Označit vše jako viděné
									</span>
								)}
							</div>
						)}

						{rows.map((vm) => (
							<MailRow key={vm.t.id} vm={vm} onCtx={(id, x, y) => setCtx({ id, x, y })} />
						))}

						{rows.length === 0 && pinRows.length === 0 && (
							<div style={{ textAlign: "center", padding: "44px 20px" }}>
								<div
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 700,
										fontSize: 13.5,
										color: "var(--ink)",
										marginBottom: 4,
									}}
								>
									{emptyT}
								</div>
								<div
									style={{
										fontFamily: "var(--w-font-body)",
										fontSize: 12.5,
										color: "var(--ink-3)",
									}}
								>
									{emptyS}
								</div>
							</div>
						)}

						{isDorView && m.grp === "inbox" && rozRows.length > 0 && (
							<div
								style={{
									margin: "4px 0 16px",
									borderTop: "1px solid var(--line)",
									padding: "8px 14px 0",
								}}
							>
								<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									onClick={() => m.setRozOn(!m.rozOn)}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 8,
										cursor: "pointer",
										padding: "3px 0",
									}}
								>
									<span
										title="Přečtené a otevřené konverzace bez rozhodnutí — vypadnou, jakmile dostanou stav, vlajku nebo odpověď"
										style={{
											fontFamily: "var(--w-font-display)",
											fontWeight: 700,
											fontSize: 9.5,
											letterSpacing: ".07em",
											textTransform: "uppercase",
											color: "var(--ink-3)",
										}}
									>
										Rozpracované
									</span>
									<span
										style={{
											fontFamily: "var(--w-font-mono)",
											fontSize: 10,
											color: "var(--ink-3)",
										}}
									>
										{rozRows.length}
									</span>
									<svg
										width="9"
										height="9"
										viewBox="0 0 9 9"
										style={{
											color: "var(--ink-3)",
											transform: m.rozOn ? "rotate(180deg)" : undefined,
										}}
										aria-hidden
									>
										<path
											d="M2 3 L4.5 6 L7 3"
											stroke="currentColor"
											strokeWidth="1.5"
											fill="none"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</div>
								{m.rozOn &&
									rozRows.map((vm) => (
										<div role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
											key={vm.t.id}
											onClick={() => m.openThread(vm.t.id)}
											style={{
												display: "flex",
												alignItems: "center",
												gap: 9,
												padding: "9px 0",
												borderBottom: "1px solid var(--line)",
												cursor: "pointer",
											}}
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
											<span
												style={{
													fontFamily: "var(--w-font-body)",
													fontSize: 12.5,
													color: "var(--ink-2)",
													flex: 1,
													minWidth: 0,
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap",
												}}
											>
												{vm.t.subj}
											</span>
											<span
												data-mbdot={vm.t.mb}
												style={{ width: 7, height: 7, borderRadius: "50%", flex: "none" }}
											/>
											<span
												style={{
													fontFamily: "var(--w-font-mono)",
													fontSize: 10,
													color: "var(--ink-3)",
													flex: "none",
												}}
											>
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
			{/* overlaye hlavičky: notifikační centrum + Ask Watson */}
			<NotifCenter open={notifOn} onClose={() => setNotifOn(false)} />
		</div>
	);
}

/** Verdikty rozhodnutých karet Gatekeeperu (prototyp verdicts, ř. 3637). */
const GK_VERDICTS: Record<string, string> = {
	accept: "Přijato — příště padá rovnou do Inboxu.",
	acceptDone: "Přijato a rovnou označeno Hotovo.",
	block: "Blokováno — odesílatel míří do složky Blocked.",
	blockDom: "Blokována celá doména.",
};

/** Gatekeeper — karty nových odesílatelů (prototyp gkRows, ř. 592–620).
 * Rozhodnutá karta nemizí: zůstává ztlumená se zobrazeným verdiktem. */
function GkQueue() {
	const m = useMail();
	return (
		<div style={{ padding: "0 14px 12px" }}>
			<p
				style={{
					fontFamily: "var(--w-font-body)",
					fontSize: 12,
					color: "var(--ink-3)",
					lineHeight: 1.55,
					margin: "2px 0 12px",
				}}
			>
				Čekající zprávy nemají SLA ani nepočítají do nepřečtených — pokud něco vypadá urgentně,
				fronta zvedne upozornění. Noví odesílatelé zůstávají před branou, dokud je nepustíš dál.
				Rozhodnutí platí i pro všechny jejich další zprávy.
			</p>
			{GK.map((g) => {
				const d = m.gkDone[g.id];
				return (
					<div
						key={g.id}
						style={{
							border: "1px solid var(--line)",
							borderRadius: 12,
							padding: "11px 13px",
							marginBottom: 9,
							background: "var(--panel)",
							boxShadow: "var(--shadow-sm)",
							opacity: d ? 0.6 : undefined,
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: 9 }}>
							<span
								data-av="ext"
								style={{
									width: 28,
									height: 28,
									borderRadius: "50%",
									color: "#fff",
									fontFamily: "var(--w-font-display)",
									fontWeight: 700,
									fontSize: 10,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									flex: "none",
								}}
							>
								{g.ini}
							</span>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										fontFamily: "var(--w-font-display)",
										fontWeight: 600,
										fontSize: 12.5,
										color: "var(--ink)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{g.name}
								</div>
								<div
									style={{
										fontFamily: "var(--w-font-mono)",
										fontSize: 10,
										color: "var(--ink-3)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{g.addr}
								</div>
							</div>
							<span
								data-mbdot={g.mb}
								title={MB[g.mb]?.short}
								style={{ width: 8, height: 8, borderRadius: "50%", flex: "none" }}
							/>
						</div>
						<div
							style={{
								fontFamily: "var(--w-font-body)",
								fontSize: 12,
								color: "var(--ink-2)",
								margin: "7px 0 0 37px",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{g.subj}
						</div>
						{!d ? (
							<div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 0 37px" }}>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									data-primary
									onClick={() => m.gkDecide(g.id, "accept")}
									style={{ fontSize: 11, padding: "5px 11px" }}
								>
									Přijmout
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									data-ghost
									onClick={() => m.gkDecide(g.id, "acceptDone")}
									style={{ fontSize: 11, padding: "5px 11px" }}
								>
									Přijmout a Hotovo
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									data-ghost
									onClick={() => m.gkDecide(g.id, "block")}
									style={{ fontSize: 11, padding: "5px 11px", color: "var(--overdue)" }}
								>
									Blokovat
								</span>
								<span role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}
									data-ghost
									onClick={() => m.gkDecide(g.id, "blockDom")}
									style={{ fontSize: 11, padding: "5px 11px", color: "var(--overdue)" }}
								>
									Blokovat doménu
								</span>
							</div>
						) : (
							<div
								style={{
									fontFamily: "var(--w-font-mono)",
									fontSize: 10.5,
									color: "var(--ink-3)",
									margin: "9px 0 0 37px",
								}}
							>
								{GK_VERDICTS[d]}
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
