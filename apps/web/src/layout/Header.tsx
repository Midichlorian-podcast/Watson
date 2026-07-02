import { useQuery as usePsQuery } from "@powersync/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";
import i18n, { useTranslation } from "@watson/i18n";
import { useAddTask } from "../lib/addTask";
import { useListSearch } from "../lib/listSearch";
import { type ViewMode, useViewMode } from "../lib/viewMode";
import { useWatson } from "../lib/watson";
import { ALL_NAV } from "./nav";
import { useTheme } from "./useTheme";

const ICON_BTN =
  "grid h-[34px] w-[34px] place-items-center rounded-[9px] border border-line bg-panel-2 text-ink-2 hover:border-brass hover:text-brass-text";

/** Horní header — 1:1 dle Cloud Design (square ikon-buttony, Watson pill, brass „+ Úkol"). */
export function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openAdd } = useAddTask();
  const { toggleWatson } = useWatson();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = ALL_NAV.find((n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)));
  const title = active ? t(active.labelKey) : t("app.name");
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  // Podtitulek „{n} úkolů · {x,x} h" pro workspace obrazovky (prototyp ř. 269–274 + 3090–3092):
  // count = úkoly aktuální obrazovky, hodiny = součet trvání úkolů s časem.
  const { data: openRows } = usePsQuery<{
    due_date: string | null;
    start_date: string | null;
    duration_min: number | null;
  }>(
    "SELECT due_date, start_date, duration_min FROM tasks WHERE completed_at IS NULL AND parent_id IS NULL",
  );
  const isWorkspace =
    path === "/" ||
    path.startsWith("/ukoly") ||
    path.startsWith("/nadchazejici") ||
    path.startsWith("/oblibene");
  const subtitle = useMemo(() => {
    if (!isWorkspace) return null;
    const tdy = new Date();
    const tdyISO = `${tdy.getFullYear()}-${String(tdy.getMonth() + 1).padStart(2, "0")}-${String(tdy.getDate()).padStart(2, "0")}`;
    const src = (openRows ?? []).filter((r) => {
      const d = r.due_date ? r.due_date.slice(0, 10) : null;
      if (path === "/") return d === null || d <= tdyISO;
      if (path.startsWith("/nadchazejici")) return d !== null && d >= tdyISO;
      return true;
    });
    const mins = src
      .filter((r) => r.start_date)
      .reduce((a, r) => a + (r.duration_min ?? 30), 0);
    const h = Math.round((mins / 60) * 10) / 10;
    return {
      count: src.length,
      timeLabel: h > 0 ? `${String(h).replace(".", ",")} h` : null,
    };
  }, [openRows, path, isWorkspace]);

  const { q, setQ, open: searchOpen, setOpen: setSearchOpen } = useListSearch();

  // Přepínač pohledů Seznam|Nástěnka|Kalendář v headeru (prototyp ř. 277–287; ne Dnes/Schránka).
  const { view, setView, locked, toggleLock } = useViewMode();
  const showViewSwitcher = path.startsWith("/ukoly") || path.startsWith("/nadchazejici");
  const viewLabels: Record<ViewMode, string> = {
    list: t("calendar.viewList"),
    board: t("toolbar.board"),
    calendar: t("calendar.viewCalendar"),
  };

  return (
    <header
      className="flex items-center gap-3 border-line border-b bg-card px-4"
      style={{ padding: "11px 16px", flex: "none" }}
    >
      <div style={{ flex: "none", minWidth: 0, maxWidth: "34vw" }}>
        <div
          className="truncate font-display font-extrabold text-ink"
          style={{ fontSize: 19, lineHeight: 1.1 }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            className="mt-0.5 flex font-mono text-ink-3"
            style={{ fontSize: 11.5, gap: 8, whiteSpace: "nowrap" }}
          >
            <span>{t("shell.taskCount", { count: subtitle.count })}</span>
            {subtitle.timeLabel && <span>· {subtitle.timeLabel}</span>}
          </div>
        )}
      </div>

      {showViewSwitcher && (
        <>
          <div
            className="flex border border-line bg-panel-2"
            style={{ marginLeft: 6, flex: "none", borderRadius: 10, padding: 3 }}
          >
            {(["list", "board", "calendar"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className="cursor-pointer font-display font-semibold"
                style={{
                  fontSize: 12.5,
                  padding: "5px 12px",
                  borderRadius: 7,
                  background: view === v ? "var(--w-card)" : "transparent",
                  color: view === v ? "var(--w-ink)" : "var(--w-ink-3)",
                }}
              >
                {viewLabels[v]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={toggleLock}
            title={t("shell.lockView")}
            className="flex shrink-0 cursor-pointer items-center justify-center hover:border-brass"
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              border: `1px solid ${locked ? "var(--w-brass)" : "var(--w-line)"}`,
              background: locked ? "var(--w-brass-soft)" : "transparent",
              color: locked ? "var(--w-brass-text)" : "var(--w-ink-2)",
            }}
          >
            {locked ? (
              <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden>
                <rect x="3" y="7" width="9" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5 7 V5 A2.5 2.5 0 0 1 10 5 V7" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden>
                <rect x="3" y="7" width="9" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M5 7 V5 A2.5 2.5 0 0 1 9.7 4"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
          {locked && (
            <span
              className="inline-flex shrink-0 items-center font-display font-semibold"
              style={{
                gap: 5,
                fontSize: 11,
                color: "var(--w-brass-text)",
                background: "var(--w-brass-soft)",
                borderRadius: 7,
                padding: "4px 9px",
                whiteSpace: "nowrap",
              }}
              title={t("shell.lockView")}
            >
              {t("shell.defaultView")}: {viewLabels[view]}
            </span>
          )}
        </>
      )}

      <div className="ml-auto flex items-center" style={{ gap: 9 }}>
        {/* inline hledání aktuálního seznamu (prototyp searchOpen, ř. 290–296) */}
        {searchOpen && (
          <div
            className="flex items-center border border-line bg-panel-2"
            style={{ gap: 7, borderRadius: 9, padding: "6px 11px", width: 200, minWidth: 120 }}
          >
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none" className="shrink-0 text-ink-3" aria-hidden>
              <circle cx="6.4" cy="6.4" r="4.4" stroke="currentColor" strokeWidth="1.4" />
              <line x1="9.6" y1="9.6" x2="13" y2="13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {/* biome-ignore lint/a11y/noAutofocus: `/` fokusuje inline hledání */}
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setSearchOpen(false);
                }
              }}
              placeholder={t("shell.searchInline")}
              className="w-full border-none bg-transparent font-body text-ink outline-none"
              style={{ fontSize: 13 }}
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => (isWorkspace ? setSearchOpen(!searchOpen) : void navigate({ to: "/hledat" }))}
          title={t("shell.search")}
          aria-label={t("shell.search")}
          className={ICON_BTN}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="butt"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="10.5" cy="10.5" r="6" />
            <line x1="15" y1="15" x2="20" y2="20" />
          </svg>
        </button>

        <button
          type="button"
          onClick={toggleWatson}
          title={t("shell.notifications")}
          aria-label={t("shell.notifications")}
          className={`${ICON_BTN} relative`}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="butt"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M6.6 17 C6.6 11.2 7.8 8.6 12 8.6 C16.2 8.6 17.4 11.2 17.4 17 Z" />
            <line x1="5" y1="17" x2="19" y2="17" />
            <path d="M10.2 20 A2.1 2.1 0 0 0 13.8 20" />
            <line x1="12" y1="6" x2="12" y2="8.6" />
          </svg>
          <span
            className="absolute"
            style={{
              top: 6,
              right: 7,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--w-overdue)",
              boxShadow: "0 0 0 2px var(--w-panel-2)",
            }}
          />
        </button>

        <button
          type="button"
          onClick={toggle}
          title={t("shell.theme")}
          aria-label={t("shell.theme")}
          className={ICON_BTN}
        >
          {isDark ? (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.4" />
              <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <line x1="7.5" y1="1.5" x2="7.5" y2="3" />
                <line x1="7.5" y1="12" x2="7.5" y2="13.5" />
                <line x1="1.5" y1="7.5" x2="3" y2="7.5" />
                <line x1="12" y1="7.5" x2="13.5" y2="7.5" />
              </g>
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
              <path
                d="M11.6 8.9 A4.7 4.7 0 1 1 6.1 3.4 A3.7 3.7 0 0 0 11.6 8.9 Z"
                fill="currentColor"
              />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={toggleWatson}
          title={t("shell.assistant")}
          className="flex h-[34px] items-center rounded-[9px] border border-brass font-display font-bold text-brass-text hover:bg-brass hover:text-white"
          style={{ gap: 7, background: "var(--w-brass-soft)", padding: "0 11px", fontSize: 12.5 }}
        >
          <span
            className="flex items-center justify-center rounded-full"
            style={{
              width: 16,
              height: 16,
              border: "1.6px solid currentColor",
              fontSize: 9,
              fontWeight: 800,
            }}
          >
            W
          </span>
          {t("shell.assistant")}
        </button>

        <button
          type="button"
          onClick={() => openAdd()}
          className="flex h-[34px] items-center rounded-[9px] font-display font-bold text-white hover:brightness-105"
          style={{ gap: 6, background: "var(--w-brass)", padding: "0 13px", fontSize: 12.5 }}
        >
          <svg width="12" height="12" viewBox="0 0 13 13" aria-hidden>
            <line
              x1="6.5"
              y1="2"
              x2="6.5"
              y2="11"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <line
              x1="2"
              y1="6.5"
              x2="11"
              y2="6.5"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          {t("shell.newTask")}
        </button>
      </div>
    </header>
  );
}
