import { useTranslation } from "@watson/i18n";
import { Icon, type IconName } from "@watson/ui";

/** Dočasný obsah obrazovky, než se postaví (nav funguje, design přijde dle screenshotů). */
export function Placeholder({ labelKey, icon }: { labelKey: string; icon: IconName }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brass-soft text-brass-text">
        <Icon name={icon} size={24} />
      </span>
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-navy">{t(labelKey)}</h1>
      <p className="mt-2 text-sm text-ink-3">{t("shell.soon")}</p>
    </div>
  );
}
