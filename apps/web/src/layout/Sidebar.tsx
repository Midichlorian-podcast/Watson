import { useQuery as usePsQuery, useStatus } from "@powersync/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type CSSProperties, useMemo } from "react";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { API_URL } from "../lib/api";
import { useSession } from "../lib/auth-client";
import { useProjects } from "../lib/projects";
import { MAIN_NAV, type NavItem } from "./nav";

const pad = (n: number) => String(n).padStart(2, "0");
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

const NAV_BASE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  padding: "7px 10px",
  borderRadius: 9,
  borderLeft: "3px solid transparent",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
const BADGE: CSSProperties = {
  fontFamily: "var(--w-font-mono, ui-monospace, monospace)",
  fontSize: 11,
  opacity: 0.7,
};

function NavRow({
  item,
  active,
  collapsed,
  count,
  marker,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  count?: number;
  marker?: CSSProperties;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={item.to}
      title={collapsed ? t(item.labelKey) : undefined}
      className="font-display"
      style={{
        ...NAV_BASE,
        justifyContent: collapsed ? "center" : undefined,
        background: active ? "rgba(255,255,255,.09)" : "transparent",
        borderLeftColor: active && !collapsed ? "var(--w-brass)" : "transparent",
        boxShadow: active && collapsed ? "inset 2px 0 0 var(--w-brass)" : undefined,
        color: active ? "var(--w-sidebar-ink)" : "var(--w-sidebar-ink-2)",
      }}
    >
      {marker ? (
        <span style={{ width: 9, height: 9, flex: "none", ...marker }} />
      ) : (
        <Icon name={item.icon} size={17} />
      )}
      {!collapsed && <span style={{ flex: 1, minWidth: 0 }}>{t(item.labelKey)}</span>}
      {!collapsed && count != null && <span style={BADGE}>{count}</span>}
    </Link>
  );
}

/** Levý sidebar — 1:1 dle Cloud Design (brass „Přidat úkol", počty, aktivní brass okraj, footer). */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const status = useStatus();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const projects = useProjects();
  const userId = session?.user?.id;

  const { data: openTasks } = usePsQuery<{
    project_id: string | null;
    due_date: string | null;
    priority: number | null;
    created_by: string | null;
  }>("SELECT project_id, due_date, priority, created_by FROM tasks WHERE completed_at IS NULL");

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/workspaces`, { credentials: "include" });
      if (!r.ok) throw new Error("workspaces");
      return (await r.json()).workspaces as { id: string; name: string; isPersonal: boolean }[];
    },
  });
  const wsName = workspaces?.find((w) => !w.isPersonal)?.name ?? workspaces?.[0]?.name ?? "";

  const counts = useMemo<Record<string, number>>(() => {
    const tasks = openTasks ?? [];
    const today = todayIso();
    const inbox = new Set(
      projects.filter((p) => p.name === "Doručené" || p.name === "Inbox").map((p) => p.id),
    );
    const day = (d: string | null) => d?.slice(0, 10) ?? null;
    return {
      "/schranka": tasks.filter((t) => t.project_id && inbox.has(t.project_id)).length,
      "/": tasks.filter((t) => {
        const dd = day(t.due_date);
        return !dd || dd <= today;
      }).length,
      "/nadchazejici": tasks.filter((t) => {
        const dd = day(t.due_date);
        return dd != null && dd > today;
      }).length,
      "/ukoly": tasks.length,
      "/oblibene/p1": tasks.filter((t) => t.priority === 1).length,
      "/oblibene/me": tasks.filter((t) => t.created_by === userId).length,
    };
  }, [openTasks, projects, userId]);

  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));
  const userName = session?.user?.name ?? "";

  return (
    <aside
      style={{
        width: collapsed ? 62 : 232,
        flex: "none",
        background: "var(--w-sidebar)",
        display: "flex",
        flexDirection: "column",
        padding: collapsed ? "16px 7px" : "16px 12px",
        transition: "width .16s ease",
      }}
    >
      {/* logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "2px 4px 14px" }}>
        <span
          title={status?.connected ? "Synced" : "Offline"}
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            flex: "none",
            background: status?.connected ? "var(--w-brass)" : "var(--w-sidebar-ink-2)",
          }}
        />
        {!collapsed && (
          <span
            className="font-display"
            style={{ fontWeight: 800, fontSize: 18, color: "var(--w-sidebar-ink)", flex: 1 }}
          >
            {t("app.name")}
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          title={t("shell.collapse")}
          aria-label={t("shell.collapse")}
          className="text-[var(--w-sidebar-ink-2)] hover:text-[var(--w-sidebar-ink)]"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: 7,
            flex: "none",
          }}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <rect
              x="2"
              y="2.5"
              width="11"
              height="10"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <line x1="6" y1="2.5" x2="6" y2="12.5" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </div>

      {/* + Přidat úkol */}
      <button
        type="button"
        onClick={() => navigate({ to: "/" })}
        title={t("shell.newTask")}
        className="font-display hover:brightness-105"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : undefined,
          gap: 9,
          background: "var(--w-brass)",
          color: "#fff",
          borderRadius: 10,
          padding: "9px 12px",
          marginBottom: 12,
          fontWeight: 700,
          fontSize: 13.5,
          border: "none",
          cursor: "pointer",
        }}
      >
        <Icon name="pridat" size={collapsed ? 16 : 14} />
        {!collapsed && t("shell.addTask")}
      </button>

      {/* nav */}
      <div style={{ overflow: "auto", flex: 1, margin: "0 -4px", padding: "0 4px" }}>
        {MAIN_NAV.map((item) => (
          <NavRow
            key={item.to}
            item={item}
            active={isActive(item.to)}
            collapsed={collapsed}
            count={item.count ? counts[item.to] : undefined}
          />
        ))}

        {!collapsed && (
          <>
            <div
              className="font-display"
              style={{
                fontWeight: 700,
                fontSize: 10.5,
                letterSpacing: ".07em",
                textTransform: "uppercase",
                color: "var(--w-sidebar-ink-2)",
                padding: "16px 10px 6px",
              }}
            >
              {t("nav.favorites")}
            </div>
            <NavRow
              item={{ to: "/oblibene/p1", icon: "priorita", labelKey: "nav.priority1" }}
              active={isActive("/oblibene/p1")}
              collapsed={false}
              count={counts["/oblibene/p1"]}
              marker={{ borderRadius: 2, background: "var(--w-brass)" }}
            />
            <NavRow
              item={{ to: "/oblibene/me", icon: "prirazeni", labelKey: "nav.assignedToMe" }}
              active={isActive("/oblibene/me")}
              collapsed={false}
              count={counts["/oblibene/me"]}
              marker={{ borderRadius: "50%", background: "#2a6fdb" }}
            />
          </>
        )}
      </div>

      {/* footer — uživatel → Nastavení */}
      <Link
        to="/nastaveni"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "9px 8px 2px",
          marginTop: 8,
          borderTop: "1px solid var(--w-sidebar-line)",
        }}
      >
        <span
          className="font-display"
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--w-brass)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          {initials(userName)}
        </span>
        {!collapsed && (
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="font-display"
              style={{
                fontWeight: 600,
                fontSize: 12.5,
                color: "var(--w-sidebar-ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {userName}
            </div>
            <div className="font-body" style={{ fontSize: 11, color: "var(--w-sidebar-ink-2)" }}>
              {wsName}
            </div>
          </div>
        )}
        {!collapsed && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 15 15"
            fill="none"
            style={{ color: "var(--w-sidebar-ink-2)", flex: "none" }}
            aria-hidden
          >
            <circle cx="7.5" cy="7.5" r="5.3" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="7.5" cy="7.5" r="1.9" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        )}
      </Link>
    </aside>
  );
}
