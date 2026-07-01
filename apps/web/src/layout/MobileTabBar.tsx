import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon, type IconName } from "@watson/ui";
import { useWatson } from "../lib/watson";

const TABS: { to: "/" | "/ukoly" | "/nadchazejici" | "/projekty"; icon: IconName; labelKey: string }[] = [
  { to: "/", icon: "dnes", labelKey: "nav.today" },
  { to: "/ukoly", icon: "ukoly", labelKey: "nav.tasks" },
  { to: "/nadchazejici", icon: "nadchazejici", labelKey: "nav.upcoming" },
  { to: "/projekty", icon: "projekty", labelKey: "nav.projects" },
];

/** Mobilní spodní lišta (prototyp MOBILE BOTTOM BAR, ř. 961-975): 4 navigace + Watson. */
export function MobileTabBar() {
  const { t } = useTranslation();
  const { toggleWatson } = useWatson();
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div
      className="fixed right-0 bottom-0 left-0 flex border-line border-t bg-card"
      style={{ zIndex: 35 }}
    >
      {TABS.map((tab) => {
        const active = tab.to === "/" ? path === "/" : path.startsWith(tab.to);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className="flex flex-1 flex-col items-center"
            style={{
              gap: 3,
              padding: "9px 0",
              color: active ? "var(--w-brass-text)" : "var(--w-ink-3)",
            }}
          >
            <Icon name={tab.icon} size={20} />
            <span className="font-display font-semibold" style={{ fontSize: 10 }}>
              {t(tab.labelKey)}
            </span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={toggleWatson}
        className="flex flex-1 flex-col items-center text-brass-text"
        style={{ gap: 3, padding: "9px 0" }}
      >
        <span
          className="flex items-center justify-center rounded-full font-display font-extrabold"
          style={{ width: 18, height: 18, border: "1.6px solid currentColor", fontSize: 9 }}
        >
          W
        </span>
        <span className="font-display font-semibold" style={{ fontSize: 10 }}>
          Watson
        </span>
      </button>
    </div>
  );
}
