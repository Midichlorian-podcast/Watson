import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";

/** „?" tahák klávesových zkratek — 1:1 dle Cloud Design (4 sekce, klik mimo / Esc zavře). */
export function Cheatsheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  const sections: { title: string; rows: [string, string[]][] }[] = [
    {
      title: t("cheat.global"),
      rows: [
        [t("cheat.search"), ["/"]],
        [t("cheat.newTask"), ["Q"]],
        [t("cheat.jump"), ["⌘ K"]],
        [t("cheat.goto"), ["G", "D/U/N/P"]],
        [t("cheat.undo"), ["⌘ Z", "⌘ ⇧ Z"]],
        [t("cheat.close"), ["Esc"]],
        [t("cheat.help"), ["?"]],
      ],
    },
    {
      title: t("cheat.list"),
      rows: [
        [t("cheat.move"), ["↑", "↓", "J", "K"]],
        [t("cheat.openDetail"), ["Enter"]],
        [t("cheat.detailNav"), ["↑", "↓"]],
        [t("cheat.check"), ["Space"]],
        [t("cheat.priority"), ["1–4"]],
        [t("cheat.delete"), ["⌫"]],
      ],
    },
    {
      title: t("cheat.calendar"),
      rows: [
        [t("cheat.prevNext"), ["←", "→"]],
        [t("cheat.today"), ["D"]],
        [t("cheat.dwm"), ["1", "2", "3"]],
      ],
    },
    {
      title: t("cheat.form"),
      rows: [
        [t("cheat.menuSelect"), ["↑", "↓"]],
        [t("cheat.confirm"), ["Enter"]],
        [t("cheat.saveTask"), ["⌘ Enter"]],
      ],
    },
  ];

  return (
    <>
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="fixed inset-0"
        style={{ background: "rgba(10,14,20,.5)", zIndex: 70 }}
      />
      <div
        data-esc-layer
        className="pointer-events-none fixed inset-0 flex items-center justify-center"
        style={{ zIndex: 71, padding: 24 }}
      >
      <div
        className="pointer-events-auto max-h-[84vh] overflow-auto rounded-2xl border border-line bg-card"
        style={{ width: 640, maxWidth: "94vw", boxShadow: "var(--w-shadow)", padding: "22px 24px" }}
      >
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex-1 font-display font-bold text-navy" style={{ fontSize: 17 }}>
            {t("cheat.title")}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="grid h-7 w-7 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink"
          >
            <Icon name="zavrit" size={15} />
          </button>
        </div>
        <div className="grid grid-cols-2" style={{ gap: "22px 28px" }}>
          {sections.map((sec) => (
            <div key={sec.title}>
              <div
                className="mb-2.5 font-display font-bold text-brass-text uppercase"
                style={{ fontSize: 10.5, letterSpacing: ".06em" }}
              >
                {sec.title}
              </div>
              {sec.rows.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between py-1">
                  <span className="font-body text-ink-2" style={{ fontSize: 13 }}>
                    {label}
                  </span>
                  <span className="flex items-center gap-1">
                    {keys.map((k) => (
                      <kbd
                        key={k}
                        className="rounded border border-line bg-panel-2 font-mono text-ink-2"
                        style={{ padding: "2px 6px", fontSize: 11 }}
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      </div>
    </>
  );
}
