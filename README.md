# Watson

Offline-first, real-time **týmový nástroj** — úkoly + projekty + kalendář + spolupráce + AI asistent.
Obecný jako Todoist, ale kvalitnější a šitý na míru. CZ + EN, PWA + (později) desktop.

> Kompletní zadání a rozhodnutí jsou ve složce [`files/`](files/) — začni souborem
> [`files/CLAUDE.md`](files/CLAUDE.md). `MASTER §11/§12` mají přednost před vším ostatním.

## Struktura (pnpm + Turborepo)

```
apps/
  web/        React + Vite + PWA + Tailwind v4 + TanStack + i18next
  api/        Hono (AI, integrace, webhooky, workery)
  desktop/    Tauri (placeholder, v2)
packages/
  shared/     Zod typy + invarianty R1–R9
  db/         Postgres + Drizzle (schéma v kroku 2)
  ui/         sdílené komponenty + design tokeny
  i18n/       i18next (cs default, en plně)
```

## Vývoj

```bash
# 1) nainstaluj závislosti
pnpm install

# 2) nastav prostředí
cp .env.example .env

# 3) lokální databáze (Colima/Docker musí běžet)
pnpm db:up

# 4) spusť vše (web + api)
pnpm dev
```

- Web: http://localhost:5173
- API health: http://localhost:8787/health

## Stav

**Krok 1 — scaffold monorepa: hotovo.** Další na řadě podle `files/CLAUDE.md`:
schéma + migrace (krok 2) → auth/workspaces (krok 3) → **sync vertikální průřez (krok 4 = největší riziko)**.
