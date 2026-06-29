import { useRouterState } from "@tanstack/react-router";
import i18n, { useTranslation } from "@watson/i18n";
import { Button, Icon, type IconName } from "@watson/ui";
import { ALL_NAV } from "./nav";
import { useTheme } from "./useTheme";

function IconBtn({ icon, label, onClick }: { icon: IconName; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-panel-2 hover:text-ink"
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

export function Header() {
  const { t } = useTranslation();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = ALL_NAV.find((n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)));
  const title = active ? t(active.labelKey) : t("app.name");
  const { toggle } = useTheme();
  const toggleLang = () =>
    void i18n.changeLanguage(i18n.language?.startsWith("cs") ? "en" : "cs");

  return (
    <header className="flex items-center gap-3 border-b border-line bg-card/80 px-5 py-3 backdrop-blur">
      <h1 className="font-display text-lg font-extrabold tracking-tight text-navy">{title}</h1>
      <div className="ml-auto flex items-center gap-1.5">
        <IconBtn icon="hledat" label={t("shell.search")} />
        <IconBtn icon="zvonek" label={t("shell.notifications")} />
        <IconBtn icon="motiv" label={t("shell.theme")} onClick={toggle} />
        <button
          type="button"
          onClick={toggleLang}
          className="rounded-full border border-line px-2.5 py-1 font-mono text-xs text-ink-2 hover:border-brass"
        >
          {i18n.language?.startsWith("cs") ? "CS" : "EN"}
        </button>
        <Button className="ml-1 px-3 py-1.5">
          <Icon name="pridat" size={16} />
          {t("shell.newTask")}
        </Button>
      </div>
    </header>
  );
}
