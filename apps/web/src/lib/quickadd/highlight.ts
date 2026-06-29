/**
 * §12 — token highlighting. Pro každý rozpoznaný token najde PRVNÍ nepřekrývající
 * výskyt v původním textu (case-insensitive) → rozsah. Overlay nad rawName (editor nedotčen).
 */
import type { Highlight, HighlightKind } from "./types";

export function computeHighlights(raw: string, hits: { t: string; kind: string }[]): Highlight[] {
  if (!raw) return [];
  const low = raw.toLowerCase();
  const ranges: Highlight[] = [];
  const taken = (a: number, b: number) => ranges.some((r) => a < r.end && b > r.start);
  for (const h of hits) {
    const t = (h.t || "").toLowerCase().trim();
    if (!t) continue;
    let from = 0;
    let idx: number;
    while ((idx = low.indexOf(t, from)) !== -1) {
      if (!taken(idx, idx + t.length)) {
        ranges.push({ start: idx, end: idx + t.length, kind: h.kind as HighlightKind });
        break;
      }
      from = idx + 1;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}
