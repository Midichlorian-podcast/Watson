# Runbook: záloha a obnova Watson PostgreSQL (pilot)

**Stav:** drill proveden 2026-07-14 · RPO cíl 15 min · RTO cíl 2 h (§15/11)

## Záloha

- Skript: `./scripts/db-backup.sh` — pg_dump z kontejneru `watson-postgres`, gzip do `backups/` (gitignore), retence 96 souborů (24 h při 15min intervalu).
- **Pilot RPO 15 min:** cron `*/15 * * * * cd <repo> && ./scripts/db-backup.sh`.
- Změřeno: záloha 1 s / 48 KB (dev objem). Roste s daty — přeměřit před pilotem s reálným objemem.
- Serverový per-user export s manifestem a checksumem: `GET /api/export` (CC-P0-14 slice).

## Obnova (drill 2026-07-14 — měřeno)

1. Čistý kontejner: `docker run -d --name watson-pg-drill -e POSTGRES_USER=watson -e POSTGRES_PASSWORD=watson -e POSTGRES_DB=watson -p 5434:5432 postgres:16` (~5 s do pg_isready).
2. Obnova: `gunzip -c backups/watson-<stamp>.sql.gz | docker exec -i watson-pg-drill psql -U watson -d watson -q` — **1 s, 0 chyb**.
3. Integrita: porovnat row counts všech tabulek zdroj ↔ obnova (drill: **43/43 shodných**).
4. Přepnutí provozu: upravit `DATABASE_URL` (port), restartovat API a `docker restart watson-powersync`.

**Měřený RTO drillu:** < 1 min včetně kontejneru a restartu služeb (dev objem) — cíl 2 h splněn s obří rezervou; přeměřit s pilotním objemem.

## Rollback poznámky k migracím

- 0024 (same-project FK): `ALTER TABLE tasks DROP CONSTRAINT tasks_parent_same_project_fk, DROP CONSTRAINT tasks_section_same_project_fk; DROP INDEX tasks_id_project_uq; DROP INDEX sections_id_project_uq;`
- 0025 (audit before/request_id): `ALTER TABLE audit_events DROP COLUMN before, DROP COLUMN request_id;`

## Známé mezery (další krok = F3)

- WAL archiving / PITR zatím nezapnuté — RPO drží frekvence pg_dump, ne kontinuální archiv. Pro pilot do 20 lidí dostačující, pro produkci ne.
- Restore wizard pro per-user export (dry-run, dedup, mapping) neexistuje — obnova zatím jen celé DB.
- Zálohy jsou nešifrované na lokálním disku — pro produkci šifrovat a ukládat mimo stroj.
- **Pozor na port:** `localhost:5432` drží SSH tunel LuckyOS; Watson běží na **5433** (host) — nikdy nespouštět watson migrace proti 5432.
