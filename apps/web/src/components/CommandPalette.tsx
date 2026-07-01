import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, useMemo, useState } from "react";
import { useTranslation } from "@watson/i18n";
import { useProjectDetail } from "../lib/projectDetail";
import { useProjects } from "../lib/projects";

type Route = "/" | "/ukoly" | "/nadchazejici" | "/projekty" | "/nastaveni";
interface PalItem {
  key: string;
  kind: string;
  label: string;
  color?: string;
  run: () => void;
}

/** ⌘K command palette — 1:1 dle Cloud Design: fuzzy (substring) přes obrazovky + projekty. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projects = useProjects();
  const projectDetail = useProjectDetail();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const go = (to: Route) => () => {
    onClose();
    void navigate({ to });
  };

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    const screens: PalItem[] = (
      [
        [t("nav.today"), "/"],
        [t("nav.upcoming"), "/nadchazejici"],
        [t("nav.tasks"), "/ukoly"],
        [t("nav.projects"), "/projekty"],
        [t("nav.settings"), "/nastaveni"],
      ] as [string, Route][]
    ).map(([label, to]) => ({
      key: `s:${to}`,
      kind: t("palette.kindGoto"),
      label,
      run: go(to),
    }));
    const projItems: PalItem[] = projects.map((p) => ({
      key: `p:${p.id}`,
      kind: t("palette.kindProject"),
      label: p.name ?? "",
      color: p.color ?? undefined,
      run: () => {
        onClose();
        projectDetail.open(p.id);
      },
    }));
    const all = [...screens, ...projItems];
    return (query ? all.filter((it) => it.label.toLowerCase().includes(query)) : all).slice(0, 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, projects, t]);

  const activeIdx = Math.min(idx, Math.max(0, items.length - 1));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[activeIdx]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="fixed inset-0"
        style={{ background: "rgba(10,14,20,.5)", zIndex: 72 }}
      />
      <div
        className="pointer-events-none fixed inset-0 flex items-start justify-center"
        style={{ zIndex: 73, paddingTop: "11vh" }}
      >
        <div
          className="pointer-events-auto overflow-hidden rounded-[14px] border border-line bg-card"
          style={{ width: 560, maxWidth: "94vw", boxShadow: "var(--w-shadow)" }}
        >
          <div className="flex items-center gap-2.5 border-line border-b" style={{ padding: "13px 16px" }}>
            <svg width="16" height="16" viewBox="0 0 15 15" fill="none" className="shrink-0 text-ink-3" aria-hidden>
              <circle cx="6.4" cy="6.4" r="4.4" stroke="currentColor" strokeWidth="1.4" />
              <line x1="9.6" y1="9.6" x2="13" y2="13" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            {/* biome-ignore lint/a11y/noAutofocus: palette input se má fokusovat při otevření */}
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setIdx(0);
              }}
              onKeyDown={onKey}
              placeholder={t("palette.placeholder")}
              className="flex-1 border-none bg-transparent font-display font-semibold text-ink outline-none"
              style={{ fontSize: 15 }}
            />
            <kbd
              className="rounded border border-line bg-panel-2 font-mono text-ink-3"
              style={{ padding: "2px 6px", fontSize: 11 }}
            >
              Esc
            </kbd>
          </div>
          <div style={{ maxHeight: "50vh", overflow: "auto", padding: 6 }}>
            {items.length === 0 ? (
              <div className="py-4 text-center font-body text-ink-3" style={{ fontSize: 13 }}>
                {t("palette.empty")}
              </div>
            ) : (
              items.map((it, i) => (
                <button
                  key={it.key}
                  type="button"
                  onClick={it.run}
                  onMouseEnter={() => setIdx(i)}
                  className="flex w-full items-center gap-2.5 rounded-[9px] text-left"
                  style={{
                    padding: "9px 11px",
                    background: i === activeIdx ? "var(--w-panel-2)" : "transparent",
                  }}
                >
                  {it.color && (
                    <span
                      className="shrink-0 rounded-full"
                      style={{ width: 16, height: 16, background: it.color }}
                    />
                  )}
                  <span className="flex-1 font-display font-semibold text-ink" style={{ fontSize: 13.5 }}>
                    {it.label}
                  </span>
                  <span
                    className="font-mono text-ink-3 uppercase"
                    style={{ fontSize: 10, letterSpacing: ".04em" }}
                  >
                    {it.kind}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
