import { useEffect } from "react";
import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { useProjects } from "../lib/projects";
import { QuickAdd } from "./QuickAdd";

/** Globální modal „Přidat úkol" — obaluje QuickAdd parser; Esc/klik mimo zavře. */
export function AddTaskModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const projects = useProjects();
  const inboxId = projects[0]?.id;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="fixed inset-0 z-50"
        style={{ background: "rgba(10,14,20,.34)" }}
      />
      <div
        className="fixed left-1/2 z-50 w-full max-w-xl rounded-2xl border border-line bg-card p-4"
        style={{ top: 96, transform: "translateX(-50%)", boxShadow: "var(--w-shadow)" }}
      >
        <div className="mb-3 flex items-center gap-2">
          <Icon name="pridat" size={16} />
          <span className="font-display font-bold text-navy" style={{ fontSize: 15 }}>
            {t("shell.addTask")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="ml-auto grid h-8 w-8 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
          >
            <Icon name="zavrit" size={16} />
          </button>
        </div>
        <QuickAdd
          projects={projects.map((p) => ({ id: p.id, name: p.name ?? "" }))}
          inboxId={inboxId}
          onDone={onClose}
          autoFocus
        />
      </div>
    </>
  );
}
