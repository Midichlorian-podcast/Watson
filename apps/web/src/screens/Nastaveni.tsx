import { useQuery } from "@tanstack/react-query";
import { type CSSProperties, type ReactNode, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { useTheme } from "../layout/useTheme";
import { API_URL } from "../lib/api";
import { signOut, useSession } from "../lib/auth-client";
import { disconnectPowerSync } from "../lib/powersync/db";

type Workspace = { id: string; name: string; isPersonal: boolean; role: string };
type Member = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  isOwner: boolean;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase() || "?";

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
const ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" };

/** Nastavení — 1:1 dle design handoffu (sekce Vzhled / Účet / Tým a role / Oznámení). */
export function Nastaveni() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const { data: session } = useSession();
  const [openRoleId, setOpenRoleId] = useState<string | null>(null);

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/workspaces`, { credentials: "include" });
      if (!r.ok) throw new Error("workspaces");
      return (await r.json()).workspaces as Workspace[];
    },
  });
  const teamWs = workspaces?.find((w) => !w.isPersonal);
  const accountWsName = teamWs?.name ?? workspaces?.[0]?.name ?? "";

  const { data: team, refetch } = useQuery({
    queryKey: ["wsMembers", teamWs?.id],
    enabled: !!teamWs,
    queryFn: async () => {
      const r = await fetch(`${API_URL}/api/workspaces/${teamWs?.id}/members`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("members");
      return (await r.json()) as { workspace: { name: string }; members: Member[] };
    },
  });

  const onSignOut = async () => {
    await disconnectPowerSync();
    await signOut();
  };

  async function setRole(userId: string, role: "admin" | "member" | "guest") {
    setOpenRoleId(null);
    await fetch(`${API_URL}/api/workspaces/${teamWs?.id}/members/${userId}/role`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    void refetch();
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
                marginLeft: theme === "dark" ? 18 : 0,
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
          <span
            className="font-display"
            style={{
              fontWeight: 600,
              fontSize: 11,
              padding: "5px 11px",
              borderRadius: 999,
              background: "var(--w-brass-soft)",
              color: "var(--w-brass-text)",
            }}
          >
            {t("settings.tweaks")}
          </span>
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

      {/* TÝM A ROLE */}
      {teamWs && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
            <span className="font-display" style={{ ...SECTION_LABEL, margin: 0 }}>
              {t("settings.team")}
            </span>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 2,
                flex: "none",
                background: "var(--w-brass)",
              }}
            />
            <span
              className="font-display"
              style={{ fontWeight: 600, fontSize: 11.5, color: "var(--w-ink-3)" }}
            >
              {teamWs.name}
            </span>
          </div>
          <div style={{ ...CARD, overflow: "visible", marginBottom: 10 }}>
            {(team?.members ?? []).map((m) => {
              const label = roleLabel(m, t);
              const menuOpen = openRoleId === m.id;
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--w-line)",
                  }}
                >
                  <Avatar text={initials(m.name)} size={36} bg="var(--w-navy)" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      className="font-display"
                      style={{ fontWeight: 700, fontSize: 13.5, color: "var(--w-ink)" }}
                    >
                      {m.name}
                    </div>
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
                      {m.email}
                    </div>
                  </div>
                  <div style={{ position: "relative", flex: "none" }}>
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
              );
            })}
            {/* Pozvat člena */}
            <div
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
                style={{ fontWeight: 700, fontSize: 13, color: "var(--w-brass-text)" }}
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
    </div>
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
    <div style={{ ...ROW, borderBottom: divider ? "1px solid var(--w-line)" : undefined }}>
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
          style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", marginLeft: 18 }}
        />
      </div>
    </div>
  );
}
