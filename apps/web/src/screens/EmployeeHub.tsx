import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useState } from "react";
import { EmployeeSelfService } from "../components/EmployeeSelfService";
import { syncEmployeeTasks, useEmployeeHub } from "../lib/employee";
import { showToast } from "../lib/toast";

const card = "rounded-2xl border border-line bg-card";

function StatusDot({ status }: { status: "ready" | "pending" | "blocked" }) {
  return (
    <span
      aria-hidden
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{
        background:
          status === "ready"
            ? "var(--w-success)"
            : status === "blocked"
              ? "var(--w-overdue)"
              : "var(--w-p2)",
      }}
    />
  );
}

function formatFetched(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel-2 px-4 py-5 text-center font-body text-xs text-ink-3">
      {children}
    </div>
  );
}

/** Online-only Employee Hub. Účetní a personální autoritou zůstává LuckyOS. */
export function EmployeeHub() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const query = useEmployeeHub();
  const [syncing, setSyncing] = useState(false);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncEmployeeTasks();
      await query.refetch();
      showToast(
        result.created > 0
          ? t("employee.syncCreated", { count: result.created })
          : t("employee.syncNoChange"),
      );
    } catch {
      showToast(t("employee.syncFailed"));
    } finally {
      setSyncing(false);
    }
  };

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-[1080px] px-5 py-8" role="status">
        <div className={`${card} p-6 font-body text-sm text-ink-3`}>{t("employee.loading")}</div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mx-auto max-w-[1080px] px-5 py-8">
        <div className={`${card} p-6`} role="alert">
          <h1 className="font-display text-xl font-extrabold text-ink">{t("employee.title")}</h1>
          <p className="mt-2 font-body text-sm text-ink-3">{t("employee.loadFailed")}</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="mt-4 min-h-11 rounded-lg bg-brass px-4 font-display text-xs font-bold text-white"
          >
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  }

  const data = query.data;
  if (!data?.linked) {
    return (
      <div className="mx-auto max-w-[760px] px-5 py-8">
        <div className={`${card} p-6`}>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brass-soft text-brass-text">
            <Icon name="tym" size={22} />
          </div>
          <h1 className="mt-4 font-display text-xl font-extrabold text-ink">
            {t("employee.title")}
          </h1>
          <p className="mt-2 max-w-[62ch] font-body text-sm leading-relaxed text-ink-3">
            {t(`employee.unlinked.${data?.reason ?? "luckyos_unavailable"}`)}
          </p>
          <button
            type="button"
            onClick={() => void navigate({ to: "/nastaveni", search: { sekce: "integrace" } })}
            className="mt-5 min-h-11 rounded-lg border border-line px-4 font-display text-xs font-bold text-ink-2 hover:border-brass"
          >
            {t("employee.openIntegrations")}
          </button>
        </div>
      </div>
    );
  }

  const { status } = data;
  const readiness = status.readiness.status;
  const progress =
    status.dppProgress.hoursLimit && status.dppProgress.hoursUsed != null
      ? Math.min(
          100,
          Math.round((status.dppProgress.hoursUsed / status.dppProgress.hoursLimit) * 100),
        )
      : null;

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-6 pb-24">
      <header className="mb-5 grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3 sm:flex">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brass-soft text-brass-text">
          <Icon name="tym" size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-extrabold text-ink">{t("employee.title")}</h1>
          <p className="mt-1 font-body text-xs text-ink-3">
            {status.person.fullName ?? t("employee.employeeFallback")} · {t("employee.onlineOnly")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void sync()}
          disabled={syncing}
          className="col-span-2 min-h-11 w-full rounded-lg bg-brass px-4 font-display text-xs font-bold text-white disabled:opacity-50 sm:ml-auto sm:w-auto"
        >
          {syncing ? t("employee.syncing") : t("employee.syncTasks")}
        </button>
      </header>

      <div className="mb-5 rounded-xl border border-brass/30 bg-brass-soft px-4 py-3 font-body text-xs leading-relaxed text-brass-text">
        {t("employee.privacyNotice")} ·{" "}
        {t("employee.fetchedAt", { value: formatFetched(data.fetchedAt, i18n.language) })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <section className={`${card} p-5`} aria-labelledby="employee-readiness-title">
          <div className="flex items-center gap-2">
            <StatusDot status={readiness} />
            <h2 id="employee-readiness-title" className="font-display text-sm font-bold text-ink">
              {t("employee.readinessTitle")}
            </h2>
            <span className="ml-auto rounded-full bg-panel-2 px-2.5 py-1 font-display text-[10px] font-bold text-ink-2">
              {t(`employee.readiness.${readiness}`)}
            </span>
          </div>
          {status.readiness.blockers.length === 0 ? (
            <div className="mt-4">
              <EmptyState>{t("employee.noBlockers")}</EmptyState>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {status.readiness.blockers.map((blocker) => (
                <li
                  key={`${blocker.type}:${blocker.explanation}:${blocker.href ?? ""}`}
                  className="rounded-xl border border-overdue/20 bg-overdue-soft px-3 py-3"
                >
                  <div className="font-display text-xs font-bold text-overdue">
                    {t(`employee.blocker.${blocker.type}`, {
                      defaultValue: blocker.type.replaceAll("_", " "),
                    })}
                  </div>
                  <div className="mt-1 font-body text-xs leading-relaxed text-ink-2">
                    {blocker.explanation}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {status.readiness.missingDocuments.length > 0 && (
            <div className="mt-4 rounded-xl border border-line bg-panel-2 px-3 py-3">
              <div className="font-display text-[10px] font-bold uppercase tracking-wide text-ink-3">
                {t("employee.missingDocuments")}
              </div>
              <div className="mt-1 font-body text-xs text-ink-2">
                {status.readiness.missingDocuments.join(", ")}
              </div>
            </div>
          )}
        </section>

        <section className={`${card} p-5`} aria-labelledby="employee-deadlines-title">
          <h2 id="employee-deadlines-title" className="font-display text-sm font-bold text-ink">
            {t("employee.deadlinesTitle")}
          </h2>
          <div className="mt-4 space-y-2">
            {status.deadlines.countdowns.map((deadline) => (
              <div
                key={deadline.key}
                className="flex items-center gap-3 rounded-xl border border-line bg-panel-2 px-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-display text-xs font-bold text-ink">{deadline.label}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-ink-3">
                    {deadline.due ?? "—"}
                  </div>
                </div>
                {deadline.daysRemaining != null && (
                  <span className="font-mono text-xs text-ink-2">
                    {t("employee.daysRemaining", { count: deadline.daysRemaining })}
                  </span>
                )}
              </div>
            ))}
            {status.deadlines.countdowns.length === 0 && (
              <>
                {status.deadlines.attendanceDueDay && (
                  <div className="rounded-xl border border-line bg-panel-2 px-3 py-3 font-body text-xs text-ink-2">
                    {t("employee.attendanceDueDay", { day: status.deadlines.attendanceDueDay })}
                  </div>
                )}
                {status.deadlines.payrollDay && (
                  <div className="rounded-xl border border-line bg-panel-2 px-3 py-3 font-body text-xs text-ink-2">
                    {t("employee.payrollDay", { day: status.deadlines.payrollDay })}
                  </div>
                )}
                {!status.deadlines.attendanceDueDay && !status.deadlines.payrollDay && (
                  <EmptyState>{t("employee.noDeadlines")}</EmptyState>
                )}
              </>
            )}
          </div>
          {progress != null && (
            <div className="mt-5 border-line border-t pt-4">
              <div className="flex items-center justify-between font-display text-xs font-bold text-ink">
                <span>{t("employee.dppProgress")}</span>
                <span className="font-mono">
                  {status.dppProgress.hoursUsed}/{status.dppProgress.hoursLimit} h
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full rounded-full bg-brass" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </section>
      </div>

      <section className={`${card} mt-4 p-5`} aria-labelledby="employee-notifications-title">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="employee-notifications-title" className="font-display text-sm font-bold text-ink">
            {t("employee.notificationsTitle")}
          </h2>
          <span className="rounded-full bg-panel-2 px-2 py-1 font-mono text-[10px] text-ink-3">
            {status.notifications.length}
          </span>
        </div>
        {status.notifications.length === 0 ? (
          <div className="mt-4">
            <EmptyState>{t("employee.noNotifications")}</EmptyState>
          </div>
        ) : (
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            {status.notifications.map((notification) => (
              <article
                key={notification.id}
                className="rounded-xl border border-line bg-panel-2 px-3 py-3"
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: notification.isRead ? "var(--w-line)" : "var(--w-brass)" }}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-xs font-bold text-ink">
                      {notification.title}
                    </h3>
                    {notification.message && (
                      <p className="mt-1 font-body text-xs leading-relaxed text-ink-2">
                        {notification.message}
                      </p>
                    )}
                    {notification.due && (
                      <div className="mt-2 font-mono text-[10px] text-ink-3">
                        {t("employee.due", { date: notification.due })}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {data.selfService && <EmployeeSelfService />}
    </div>
  );
}
