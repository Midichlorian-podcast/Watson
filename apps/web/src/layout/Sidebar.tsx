import { useStatus } from "@powersync/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon, cn } from "@watson/ui";
import { signOut, useSession } from "../lib/auth-client";
import { disconnectPowerSync } from "../lib/powersync/db";
import { FAV_NAV, MAIN_NAV, type NavItem, SETTINGS_NAV } from "./nav";

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = item.to === "/" ? path === "/" : path.startsWith(item.to);
  return (
    <Link
      to={item.to}
      title={collapsed ? t(item.labelKey) : undefined}
      className={cn(
        "flex items-center gap-3 rounded-[9px] px-2.5 py-[7px] font-display text-[13px] font-semibold transition",
        active ? "text-sidebar-ink" : "text-[var(--w-sidebar-ink-2)] hover:text-sidebar-ink",
      )}
      style={{
        background: active ? "rgba(255,255,255,.08)" : undefined,
        boxShadow: active ? "inset 2px 0 0 var(--w-brass)" : undefined,
      }}
    >
      <Icon name={item.icon} size={18} />
      {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
    </Link>
  );
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const status = useStatus();
  const onSignOut = async () => {
    await disconnectPowerSync();
    await signOut();
  };

  return (
    <aside
      className="flex shrink-0 flex-col gap-1 px-2.5 py-3 text-sidebar-ink"
      style={{ width: collapsed ? 60 : 232, background: "var(--w-sidebar)", transition: "width .15s ease" }}
    >
      <div className="flex items-center gap-2 px-1.5 py-1">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] font-display text-sm font-extrabold"
          style={{ background: "var(--w-brass)", color: "var(--w-navy)" }}
        >
          W
        </span>
        {!collapsed && (
          <span className="font-display text-lg font-extrabold tracking-tight">{t("app.name")}</span>
        )}
        <button
          type="button"
          onClick={onToggle}
          title={t("shell.collapse")}
          aria-label={t("shell.collapse")}
          className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[var(--w-sidebar-ink-2)] hover:text-sidebar-ink"
        >
          <Icon name="vice" size={18} />
        </button>
      </div>

      <nav className="mt-2 flex flex-col gap-0.5">
        {MAIN_NAV.map((it) => (
          <NavLink key={it.to} item={it} collapsed={collapsed} />
        ))}
      </nav>

      {!collapsed && (
        <div className="mt-4 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--w-sidebar-ink-2)]">
          {t("nav.favorites")}
        </div>
      )}
      <nav className="flex flex-col gap-0.5">
        {FAV_NAV.map((it) => (
          <NavLink key={it.to} item={it} collapsed={collapsed} />
        ))}
      </nav>

      <div
        className="mt-auto flex flex-col gap-1 border-t pt-2"
        style={{ borderColor: "var(--w-sidebar-line)" }}
      >
        <NavLink item={SETTINGS_NAV} collapsed={collapsed} />
        <div className="flex items-center gap-2 px-2.5 py-1">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: status?.connected ? "var(--w-success)" : "var(--w-sidebar-ink-2)" }}
            title={status?.connected ? "Synced" : "Offline"}
          />
          {!collapsed && (
            <>
              <span className="truncate text-[11px] text-[var(--w-sidebar-ink-2)]">
                {session?.user.email}
              </span>
              <button
                type="button"
                onClick={onSignOut}
                className="ml-auto text-[11px] text-[var(--w-sidebar-ink-2)] hover:text-sidebar-ink"
              >
                {t("common.signOut")}
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
