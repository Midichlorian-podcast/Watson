/**
 * §12 — RECVOCAB: slovník všech slov, která mohou patřit k opakování.
 * Použit pro vyříznutí opakovacích slov z názvu (jen když bylo rozpoznáno opakování / holý den)
 * a pro sběr tokenů k zvýraznění. VERBATIM z prototypu (getter, ř. 2004).
 * Pozn.: vrací NOVÝ regex při každém volání (globální flag = stavový lastIndex).
 */
export function recVocab(): RegExp {
  return /(?:^|\s)(?:každ\p{L}*|denn[ěe]\p{L}*|denne|týdn[ěe]\p{L}*|tydne|měsí[čc]n[ěe]\p{L}*|mesicne|ro[čc]n[ěe]\p{L}*|rocne|sud\p{L}*|lich\p{L}*|prvn\p{L}*|druh\p{L}*|t[řr]et\p{L}*|posledn\p{L}*|p[řr][íi]št\p{L}*|nejbli[žz]\p{L}*|pond[ěe]l\p{L}*|[úu]ter\p{L}*|st[řr]ed\p{L}*|[čc]tvrt\p{L}*|p[áa]t(?:ek|ku|ky)|sobot\p{L}*|ned[ěe]l\p{L}*|t[ýy]dn\p{L}*|t[ýy]den|m[ěe]s[íi]ci|m[ěe]s[íi]c\p{L}*|den|dny|dn[íi]|rok|roce|roky|hodin\p{L}*|minut\p{L}*|po dobu)(?=\s|$)/giu;
}
