/**
 * §15 — řadové číslovky v genitivu (pátého, dvacátého…) → den v měsíci (1–39).
 * Pro opakování „každého dvacátého pátého v měsíci". VERBATIM (prototyp ř. 2063–2072).
 */
const U: Record<string, number> = {
  prvn: 1, druh: 2, "třet": 3, tret: 3, "čtvrt": 4, ctvrt: 4, "pát": 5, pat: 5,
  "šest": 6, sest: 6, sedm: 7, osm: 8, "devát": 9, devat: 9,
};
const T: Record<string, number> = { "dvacát": 20, dvacat: 20, "třicát": 30, tricat: 30 };
const D: Record<string, number> = {
  "desát": 10, desat: 10, "jedenáct": 11, jedenact: 11, "dvanáct": 12, dvanact: 12,
  "třináct": 13, trinact: 13, "čtrnáct": 14, ctrnact: 14, "patnáct": 15, "šestnáct": 16,
  sestnact: 16, "sedmnáct": 17, sedmnact: 17, "osmnáct": 18, osmnact: 18, "devatenáct": 19,
  devatenact: 19,
};
const END = "(?:ého|ího|eho|iho)";

/** „dvacátého pátého" → 25, „patnáctého" → 15, „pátého" → 5. null = neznámé. */
export function ordinalDay(s: string): number | null {
  const low = s.toLowerCase();
  for (const t in T) {
    const tv = T[t];
    if (tv == null) continue;
    if (new RegExp(t + END).test(low)) {
      let v = tv;
      for (const u in U) {
        const uv = U[u];
        if (uv != null && new RegExp(`${t}${END}\\s+${u}${END}`).test(low)) {
          v += uv;
          break;
        }
      }
      return v;
    }
  }
  for (const d in D) {
    const dv = D[d];
    if (dv != null && new RegExp(d + END).test(low)) return dv;
  }
  for (const u in U) {
    const uv = U[u];
    if (uv == null) continue;
    try {
      if (new RegExp(`(?<![\\p{L}])${u}${END}`, "u").test(low)) return uv;
    } catch {
      if (new RegExp(u + END).test(low)) return uv;
    }
  }
  return null;
}
