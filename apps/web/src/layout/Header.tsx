import { useQuery as usePsQuery } from "@powersync/react";
import { useRouterState } from "@tanstack/react-router";
import i18n, { useTranslation } from "@watson/i18n";
import { useAddTask } from "../lib/addTask";
import { ALL_NAV } from "./nav";
import { useTheme } from "./useTheme";

const ICON_BTN =
  "grid h-[34px] w-[34px] place-items-center rounded-[9px] border border-line bg-panel-2 text-ink-2 hover:border-brass hover:text-brass-text";

/** Horní header — 1:1 dle Cloud Design (square ikon-buttony, Watson pill, brass „+ Úkol"). */
export function Header() {
  const { t } = useTranslation();
  const { openAdd } = useAddTask();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = ALL_NAV.find((n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)));
  const title = active ? t(active.labelKey) : t("app.name");
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  const toggleLang = () => void i18n.changeLanguage(i18n.language?.startsWith("cs") ? "en" : "cs");

  // Podtitulek „{n} úkolů" jen na Dnes (dle designu — meta řádek titulku).
  const { data: openCount } = usePsQuery<{ n: number }>(
    "SELECT count(*) AS n FROM tasks WHERE completed_at IS NULL",
  );
  const showSubtitle = path === "/";

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
        {showSubtitle && (
          <div className="mt-0.5 font-mono text-ink-3" style={{ fontSize: 11.5 }}>
            {t("shell.taskCount", { count: openCount?.[0]?.n ?? 0 })}
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center" style={{ gap: 9 }}>
        <button
          type="button"
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
          onClick={toggleLang}
          title="CS / EN"
          className="grid h-[34px] place-items-center rounded-[9px] border border-line bg-panel-2 px-2.5 font-mono text-ink-2 text-xs hover:border-brass"
        >
          {i18n.language?.startsWith("cs") ? "CS" : "EN"}
        </button>

        <button
          type="button"
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
          onClick={openAdd}
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
