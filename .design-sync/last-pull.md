# design-sync — záznam stažení (pull)

**Zdroj pravdy designu = Claude Design (cloud), projekt „Watson".** `ds-bundle/` je
**lokální zrcadlo (snapshot)** tohoto projektu, ne originál. Když se na claude.ai/design
něco změní, snapshot se sem znovu „pullne" a commitne — git pak drží historii.

## Poslední pull
- **Datum:** 2026-06-29
- **Projekt:** Watson · `projectId d19e3c1a-5ff1-47e1-a699-2227ff30b7ff`
- **Remote `updatedAt`:** 2026-06-29T00:43:41Z
- **Nástroj:** `DesignSync` (claude.ai/design), metoda `get_file` po souborech

## Co je v snapshotu (textové artefakty)
| Soubor | Velikost | Pozn. |
|---|---|---|
| `templates/watson-app/WatsonApp.dc.html` | 262 144 B | ⚠️ **UŘÍZNUTÉ** na 256 KiB (strop `get_file`) — viz níže |
| `templates/watson-app/support.js` | 57 767 B | runtime harness Claude Designu |
| `templates/watson-app/ds-base.js` | 941 B | |
| `templates/watson-directions/WatsonDirections.dc.html` | 66 784 B | kompletní |
| `templates/watson-directions/support.js` | 57 318 B | |
| `templates/watson-directions/ds-base.js` | 941 B | |
| `proposals/Watson-Ikony.html` | 24 038 B | kompletní |
| `_ds_manifest.json` | 5 572 B | mapa komponent/templates/tokenů |
| `_ds_bundle.js`, `_adherence.oxlintrc.json` | | generované Claude Designem |
| `components.css`, `styles.css`, `tokens/tokens.css`, `README.md` | | globální styly + seed |
| `components/Components/{PriorityBadge,TaskCard}/*` | | seed komponenty |
| `guidelines/{brand,hard-rules}.html` | | foundations |

## Nemirrorováno (záměrně)
- `templates/*/.thumbnail` — binární náhledy (negenerujeme do repa).
- `uploads/*.png` (screenshoty, draw-*.png) — vstupní reference, binární.
- `uploads/TODOIST_KOMPLETNI_ANALYZA.md.txt` — referenční analýza, zůstává v Claude Design.

## ⚠️ Truncation: `WatsonApp.dc.html`
`get_file` vrací max 256 KiB; tenhle prototyp je větší, takže lokální kopie končí
uprostřed JS dat (ne `</html>`). **Markup a styly (= celá struktura obrazovek) jsou ale
v prvních 256 KiB**, takže pro pochopení/plánování je úplná; chybí jen konec mock dat
a zavírací boilerplate. **Pro byte-perfect kopii** exportovat prototyp přímo z UI
Claude Designu a nahradit tento soubor. Kanonická verze je vždy v Claude Design.

## App shell (z aktuálního pullu)
Boční navigace `WatsonApp` už obsahuje: **Hledat · Schránka (s počítadlem) · Dnes ·
Nadcházející · Seznam · Projekty · Cíle · Reporty · Postupy · Oblíbené** + detail úkolu,
board, kalendář, tým. Pozn.: **„Schránka" = už existující vstupní bod pro mail** (v datech
`group:'inbox', screen:'schranka'`) → návazný bod pro mailovou vrstvu ze specu.
