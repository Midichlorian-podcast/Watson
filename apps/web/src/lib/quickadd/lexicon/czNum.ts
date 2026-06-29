/**
 * §13 — základní české číslovky (nominativ + pádové tvary) → číslo.
 * Pro čas (§4d) a trvání (§5b/c/f). Klíče s i bez diakritiky (vědomě, kvůli překlepům).
 * VERBATIM z prototypu (WatsonApp.dc.html ř. 2049–2059).
 */
const tens: Record<string, number> = {
  dvacet: 20, dvaceti: 20, "třicet": 30, "třiceti": 30, tricet: 30, triceti: 30,
  "čtyřicet": 40, "čtyřiceti": 40, ctyricet: 40, "padesát": 50, "padesáti": 50, padesat: 50,
  "šedesát": 60, "šedesáti": 60, sedesat: 60, sedesati: 60,
};
const teens: Record<string, number> = {
  deset: 10, deseti: 10, "desíti": 10, "jedenáct": 11, "jedenácti": 11, "dvanáct": 12,
  "dvanácti": 12, "třináct": 13, "třinácti": 13, "čtrnáct": 14, "čtrnácti": 14, "patnáct": 15,
  "patnácti": 15, patnact: 15, "šestnáct": 16, "šestnácti": 16, "sedmnáct": 17, "sedmnácti": 17,
  "osmnáct": 18, "osmnácti": 18, "devatenáct": 19, "devatenácti": 19,
};
const ones: Record<string, number> = {
  nula: 0, jedna: 1, jeden: 1, jednu: 1, "jedné": 1, dva: 2, "dvě": 2, dve: 2, dvou: 2,
  "tři": 3, "tří": 3, tri: 3, "čtyři": 4, "čtyř": 4, ctyri: 4, "pět": 5, "pěti": 5, pet: 5,
  peti: 5, "šest": 6, "šesti": 6, sest: 6, sedm: 7, sedmi: 7, osm: 8, osmi: 8, "devět": 9,
  "devíti": 9, devet: 9,
};

/** Slovní číslovku → číslo (0–69). Složené „dvacet jedna"=21. null = neznámé. */
export function czNum(s: string): number | null {
  const w = s.toLowerCase().trim().split(/\s+/);
  const a = w[0];
  const b = w[1];
  if (a && b) {
    const ta = tens[a];
    const ob = ones[b];
    if (ta != null && ob != null) return ta + ob;
  }
  for (const x of w) {
    const v = teens[x];
    if (v != null) return v;
  }
  for (const x of w) {
    const v = tens[x];
    if (v != null) return v;
  }
  for (const x of w) {
    const v = ones[x];
    if (v != null) return v;
  }
  return null;
}
