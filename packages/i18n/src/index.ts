import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import cs from "./locales/cs.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };

export const resources = {
  cs: { translation: cs },
  en: { translation: en },
} as const;

export const SUPPORTED_LOCALES = ["cs", "en"] as const;
export const FALLBACK_LOCALE = "cs";

/** Inicializace i18n pro web (volá se jednou v entry pointu). */
export function initI18n() {
  if (i18n.isInitialized) return i18n;
  void i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      fallbackLng: FALLBACK_LOCALE,
      supportedLngs: SUPPORTED_LOCALES as unknown as string[],
      interpolation: { escapeValue: false },
      detection: {
        order: ["localStorage", "navigator"],
        caches: ["localStorage"],
      },
    });
  return i18n;
}

export default i18n;
export { useTranslation, Trans } from "react-i18next";
