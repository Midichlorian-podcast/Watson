# design-sync — poznámky

- **Shape:** package (hand-authored seed), NE converter. `packages/ui` je malý seed
  (`tokens.css` + `PriorityBadge`, Tailwind-utility styling, žádný `dist`/storybook).
  Bundle v `ds-bundle/` je psaný ručně dle dokumentovaného layoutu.
- **Styling:** v `packages/ui` jsou komponenty stylované Tailwind utilitami + `var(--w-*)`;
  ty nejsou nikde zkompilované do CSS. Pro Claude Design proto `components.css` přepisuje
  vzhled plain CSS třídami `.w-*` (stejný výsledek, self-contained — návrhy dostávají jen
  `@import` uzávěr `styles.css`).
- **tokens.css je PLACEHOLDER.** Po doladění obrazovek na webu se finální tokeny vytáhnou
  zpět a nahradí `packages/ui/src/tokens.css` (+ remap `@theme` v `apps/web/src/index.css`) —
  „design lock" dle CLAUDE.md.
- **Pull-back:** `ds-bundle/tokens/tokens.css` ↔ `packages/ui/src/tokens.css` (názvy `--w-*` se
  shodují); `ds-bundle/components.css` třídy `.w-*` ↔ Tailwind utility přes `@theme`.
- Při příštím sync: pokud `packages/ui` vyroste v reálnou knihovnu (dist/storybook),
  zvážit přechod na converter místo ručního bundlu.
