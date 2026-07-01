/**
 * Tweaks (#39) — hustota řádků + akcent projektů (prototyp data-w-density/data-w-accent, ř. 40-42/77).
 * Atributy na <html> + localStorage; CSS pravidla v index.css.
 */
export type Density = "vzdusne" | "vyvazene" | "kompaktni";
export type Accent = "multi" | "brass";

const D_LS = "watson.density";
const A_LS = "watson.accent";

export function getDensity(): Density {
  const v = localStorage.getItem(D_LS);
  return v === "vzdusne" || v === "vyvazene" ? v : "kompaktni";
}
export function getAccent(): Accent {
  return localStorage.getItem(A_LS) === "brass" ? "brass" : "multi";
}

export function applyTweaks(): void {
  const el = document.documentElement;
  el.setAttribute("data-w-density", getDensity());
  el.setAttribute("data-w-accent", getAccent());
}

export function setDensity(d: Density): void {
  localStorage.setItem(D_LS, d);
  applyTweaks();
}
export function setAccent(a: Accent): void {
  localStorage.setItem(A_LS, a);
  applyTweaks();
}
