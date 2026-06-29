import { useStatus } from "@powersync/react";
import { Outlet } from "@tanstack/react-router";
import i18n, { useTranslation } from "@watson/i18n";
import { signOut, useSession } from "../lib/auth-client";
import { disconnectPowerSync } from "../lib/powersync/db";

export function AppLayout() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const status = useStatus();

  const toggleLang = () => {
    void i18n.changeLanguage(i18n.language?.startsWith("cs") ? "en" : "cs");
  };

  const onSignOut = async () => {
    await disconnectPowerSync();
    await signOut();
  };

  const synced = status?.connected ? "var(--w-success)" : "var(--w-ink-3)";

  return (
    <div className="min-h-full">
      <header className="border-b border-line bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-navy font-display text-sm font-extrabold text-white">
            W
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight text-navy">
            {t("app.name")}
          </span>
          <span
            className="ml-2 h-2 w-2 rounded-full"
            style={{ background: synced }}
            title={status?.connected ? "Synced" : "Offline"}
          />
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-ink-3 sm:inline">{session?.user.email}</span>
            <button
              type="button"
              onClick={toggleLang}
              className="rounded-full border border-line px-3 py-1 font-mono text-xs text-ink-2 hover:border-brass"
            >
              {i18n.language?.startsWith("cs") ? "CS" : "EN"}
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-full border border-line px-3 py-1 text-xs text-ink-2 hover:border-brass"
            >
              Odhlásit
            </button>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
