/**
 * §21 — datové funkce opakování/termínů, počítané z REÁLNÉHO `today` (ne z fixního recBase).
 * Sémantika dle prototypu: „nejbližší budoucí" (weekdayDate přeskakuje dnešek), ISO-týden parita.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** „YYYY-MM-DD" → Date (lokální půlnoc). */
export function fromISO(s: string): Date {
  const p = s.split("-").map(Number);
  return new Date(p[0] ?? 1970, (p[1] ?? 1) - 1, p[2] ?? 1);
}

/** Date → „YYYY-MM-DD" lokálně (bez timezone posunu). */
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** ISO 8601 číslo týdne (čtvrtek-pravidlo). */
export function isoWeek(dt: Date): number {
  const d = new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Nejbližší BUDOUCÍ výskyt dne `wd` (dnešní den → příští týden), +N týdnů. (§9/§11 start) */
export function weekdayDate(wd: number, weeksAhead: number, today: string): string {
  const d = fromISO(today);
  let add = (wd - d.getDay() + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add + 7 * (weeksAhead || 0));
  return toISO(d);
}

/** Nejbližší budoucí `wd` v týdnu se správnou ISO-paritou (even=sudé číslo, odd=liché). */
export function weekdayParityISO(wd: number, parity: "even" | "odd", today: string): string {
  const d = fromISO(today);
  let add = (wd - d.getDay() + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  const want = parity === "even" ? 0 : 1;
  if (isoWeek(d) % 2 !== want) d.setDate(d.getDate() + 7);
  return toISO(d);
}

/** N-tý výskyt dne `wd` v měsíci (nth=-1 = poslední), první budoucí ≥ today. */
export function nthWeekdayISO(nth: number, wd: number, today: string): string | null {
  const b = fromISO(today);
  const find = (y: number, m: number): Date | null => {
    if (nth === -1) {
      let dd = new Date(y, m + 1, 0).getDate();
      while (new Date(y, m, dd).getDay() !== wd) dd--;
      return new Date(y, m, dd);
    }
    let c = 0;
    for (let dd = 1; dd <= 31; dd++) {
      const dt = new Date(y, m, dd);
      if (dt.getMonth() !== m) break;
      if (dt.getDay() === wd && ++c === nth) return dt;
    }
    return null;
  };
  // hledej první budoucí výskyt napříč měsíci (nth=5 nemusí existovat v každém měsíci)
  let y = b.getFullYear();
  let m = b.getMonth();
  for (let k = 0; k < 14; k++) {
    const dt = find(y, m);
    if (dt && dt >= b) return toISO(dt);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return null;
}

/** Nejbližší `day`-tý den v měsíci ≥ today (clamp na délku měsíce). */
export function nextMonthDayISO(day: number, today: string): string {
  const b = fromISO(today);
  const clamp = (y: number, m: number) => Math.min(day, new Date(y, m + 1, 0).getDate());
  let y = b.getFullYear();
  let m = b.getMonth();
  let dd = clamp(y, m);
  if (new Date(y, m, dd) < b) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    dd = clamp(y, m);
  }
  return toISO(new Date(y, m, dd));
}
