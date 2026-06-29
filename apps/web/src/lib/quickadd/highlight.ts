/**
 * §12 — token highlighting. Pro každý rozpoznaný token najde PRVNÍ nepřekrývající výskyt
 * v původním textu (case-insensitive), PŘEDNOSTNĚ na hranici slova (aby se krátký token
 * jako „p2" nezvýraznil uvnitř cizího slova „stop2line"); fallback na libovolný výskyt.
 */
import type { Highlight, HighlightKind } from "./types";

const isWord = (c: string | undefined) => c != null && /[\p{L}\d]/u.test(c);

export function computeHighlights(raw: string, hits: { t: string; kind: string }[]): Highlight[] {
  if (!raw) return [];
  const low = raw.toLowerCase();
  const ranges: Highlight[] = [];
  const taken = (a: number, b: number) => ranges.some((r) => a < r.end && b > r.start);
  const atBoundary = (i: number, len: number) => !isWord(raw[i - 1]) && !isWord(raw[i + len]);

  for (const h of hits) {
    const t = (h.t || "").toLowerCase().trim();
    if (!t) continue;
    const place = (boundaryOnly: boolean): boolean => {
      let from = 0;
      let idx: number;
      while ((idx = low.indexOf(t, from)) !== -1) {
        if (!taken(idx, idx + t.length) && (!boundaryOnly || atBoundary(idx, t.length))) {
          ranges.push({ start: idx, end: idx + t.length, kind: h.kind as HighlightKind });
          return true;
        }
        from = idx + 1;
      }
      return false;
    };
    // 1) přednostně na hranici slova; 2) fallback libovolný nepřekrývající výskyt
    if (!place(true)) place(false);
  }

  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}
