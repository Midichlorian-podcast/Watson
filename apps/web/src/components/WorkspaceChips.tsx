import { useTranslation } from "@watson/i18n";
import { useWorkspaces } from "../lib/workspace";

/**
 * Řada workspace chipů Vše / Moje / {tým}… na Dnes a Nadcházejícím (prototyp ř. 342–346,
 * data-wschip): filtr skupin dle prostoru. Aktivní chip = brass-soft + brass okraj.
 */
export function WorkspaceChips({
  value,
  onChange,
}: {
  /** null = Vše. */
  value: string | null;
  onChange: (wsId: string | null) => void;
}) {
  const { t } = useTranslation();
  const { data: workspaces } = useWorkspaces();
  // Jediný osobní prostor → „Moje"; při více osobních nech názvy (jinak duplicitní labely).
  const personalCount = (workspaces ?? []).filter((w) => w.isPersonal).length;
  const chips: { id: string | null; label: string; color?: string }[] = [
    { id: null, label: t("toolbar.allWs") },
    ...(workspaces ?? []).map((w) => ({
      id: w.id,
      label: w.isPersonal && personalCount === 1 ? t("toolbar.myWs") : w.name,
      color: w.color ?? "var(--w-ink-3)",
    })),
  ];
  return (
    <div className="flex flex-wrap" style={{ gap: 7, padding: "8px 4px 2px" }}>
      {chips.map((c) => {
        const on = value === c.id;
        return (
          <button
            key={c.id ?? "all"}
            type="button"
            onClick={() => onChange(c.id)}
            className="inline-flex cursor-pointer items-center font-display font-semibold hover:border-brass"
            style={{
              gap: 6,
              fontSize: 12,
              padding: "5px 11px",
              borderRadius: 999,
              border: `1px solid ${on ? "var(--w-brass)" : "var(--w-line)"}`,
              background: on ? "var(--w-brass-soft)" : "transparent",
              color: on ? "var(--w-brass-text)" : "var(--w-ink-2)",
            }}
          >
            {c.color && (
              <span
                className="shrink-0"
                style={{ width: 7, height: 7, borderRadius: 2, background: c.color }}
              />
            )}
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
