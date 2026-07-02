-- Watson demo seed dle design/handoff_watson/README.md (§Seed data).
-- Idempotentní: pevná UUID + ON CONFLICT / WHERE NOT EXISTS. Relativní termíny od CURRENT_DATE
-- (prototypové „dnes" = čt 25. 6. 2026 ⇒ offsety zachovány). Spouštění: pnpm --filter @watson/db db:seed

BEGIN;

-- ── Lidé (7) ────────────────────────────────────────────────────────────────
INSERT INTO users (id, name, email, email_verified, job_title) VALUES
 ('a1000000-0000-4000-8000-000000000001','Adéla Kučerová','adela.kucerova@firma.cz', true, 'Vedoucí provozu'),
 ('a1000000-0000-4000-8000-000000000002','Tomáš Marek','tomas.marek@firma.cz', true, 'Projektový manažer'),
 ('a1000000-0000-4000-8000-000000000003','Jana Dvořáková','jana.dvorakova@firma.cz', true, 'Obchod'),
 ('a1000000-0000-4000-8000-000000000004','Martin Beneš','martin.benes@firma.cz', true, 'IT a provoz'),
 ('a1000000-0000-4000-8000-000000000005','Petra Nováková','petra.novakova@firma.cz', true, 'Nábor a HR'),
 ('a1000000-0000-4000-8000-000000000006','Lukáš Horák','lukas.horak@firma.cz', true, 'Office manager'),
 ('a1000000-0000-4000-8000-000000000007','Eva Pospíšilová','eva.pospisilova@firma.cz', true, 'Marketing')
ON CONFLICT (email) DO UPDATE SET job_title = EXCLUDED.job_title;

-- ── Prostory ────────────────────────────────────────────────────────────────
-- Kancelář Praha existuje (d1…0001); Sokol přidat, vlastník PN.
INSERT INTO workspaces (id, name, owner_id, is_personal)
SELECT 'd1000000-0000-4000-8000-000000000002','TJ Sokol Praha',
       (SELECT id FROM users WHERE email = 'petra.novakova@firma.cz'), false
WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE name = 'TJ Sokol Praha');

-- ── Členství (Kancelář = 7 lidí + demo; Sokol = PN, EP, JD, LH + demo) ─────
INSERT INTO memberships (user_id, workspace_id, role)
SELECT u.id, 'd1000000-0000-4000-8000-000000000001', 'member'
FROM users u
WHERE u.email LIKE '%@firma.cz'
  AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.workspace_id = 'd1000000-0000-4000-8000-000000000001');

INSERT INTO memberships (user_id, workspace_id, role)
SELECT u.id, w.id, 'member'
FROM users u, workspaces w
WHERE w.name = 'TJ Sokol Praha'
  AND u.email IN ('petra.novakova@firma.cz','eva.pospisilova@firma.cz','jana.dvorakova@firma.cz','lukas.horak@firma.cz','demo@watson.test')
  AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.workspace_id = w.id);

-- ── Projekty (Kancelář 10 · Sokol 3 · barvy dle prototypu) ─────────────────
WITH ws AS (
  SELECT (SELECT id FROM workspaces WHERE name = 'Kancelář Praha' LIMIT 1) AS kancelar,
         (SELECT id FROM workspaces WHERE name = 'TJ Sokol Praha' LIMIT 1) AS klub
), u AS (
  SELECT email, id FROM users
), def(name, color, kind, owner_email, wskey, due_off, dod) AS (VALUES
 ('Q3 plánování',      '#c68a3e', 'goal',  'tomas.marek@firma.cz',     'kancelar',  97, 'Plán Q3 schválen vedením'),
 ('Provoz kanceláře',  '#2e9c6e', 'flow',  'adela.kucerova@firma.cz',  'kancelar', NULL, NULL),
 ('Obchod',            '#2a6fdb', 'flow',  'jana.dvorakova@firma.cz',  'kancelar', NULL, NULL),
 ('Onboarding',        '#7c5cfc', 'goal',  'petra.novakova@firma.cz',  'kancelar',  20, 'Všech 5 nováčků zaškoleno'),
 ('Web redesign',      '#2c9c9c', 'goal',  'adela.kucerova@firma.cz',  'kancelar',  67, 'Nový web spuštěn v produkci'),
 ('Finance',           '#3a7d44', 'cycle', 'martin.benes@firma.cz',    'kancelar',   5, 'Měsíční uzávěrka uzavřena'),
 ('Nábor a HR',        '#b8487e', 'flow',  'petra.novakova@firma.cz',  'kancelar', NULL, NULL),
 ('IT a systémy',      '#5b6cc4', 'flow',  'martin.benes@firma.cz',    'kancelar', NULL, NULL),
 ('Právní a smlouvy',  '#8c6d3f', 'goal',  'tomas.marek@firma.cz',     'kancelar',  23, 'Smlouvy podepsány'),
 ('Interní procesy',   '#6b7280', 'cycle', 'adela.kucerova@firma.cz',  'kancelar', 189, 'Roční revize procesů'),
 ('Firemní akce',      '#caa23f', 'goal',  'petra.novakova@firma.cz',  'klub',      79, 'Letní teambuilding proběhl'),
 ('Marketing',         '#d4663a', 'flow',  'jana.dvorakova@firma.cz',  'klub',    NULL, NULL),
 ('Klientský servis',  '#1f8a8a', 'flow',  'jana.dvorakova@firma.cz',  'klub',    NULL, NULL)
)
INSERT INTO projects (workspace_id, name, color, kind, owner_id, status, delivery_date, definition_of_done)
SELECT CASE def.wskey WHEN 'kancelar' THEN ws.kancelar ELSE ws.klub END,
       def.name, def.color, def.kind::project_kind, u.id, 'active'::project_status,
       CASE WHEN def.due_off IS NULL THEN NULL ELSE CURRENT_DATE + def.due_off END,
       def.dod
FROM def
JOIN ws ON true
JOIN u ON u.email = def.owner_email
WHERE NOT EXISTS (
  SELECT 1 FROM projects p
  WHERE p.name = def.name
    AND p.workspace_id = CASE def.wskey WHEN 'kancelar' THEN ws.kancelar ELSE ws.klub END
);

-- ── Členové projektů = členové prostoru ────────────────────────────────────
INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, m.user_id, 'editor'::project_role
FROM projects p
JOIN memberships m ON m.workspace_id = p.workspace_id
WHERE p.workspace_id IN (SELECT id FROM workspaces WHERE name IN ('Kancelář Praha','TJ Sokol Praha'))
  AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = m.user_id);

-- ── Úkoly (reprezentativní výběr seedu prototypu; relativní data) ──────────
WITH pr AS (SELECT name, id FROM projects),
     us AS (SELECT email, id FROM users)
INSERT INTO tasks (id, project_id, name, description, priority, due_date, start_date, duration_min, days, assignment_mode, completed_at, created_at)
SELECT t.id::uuid, pr.id, t.name, t.descr, t.pri,
       CASE WHEN t.due_off IS NULL THEN NULL ELSE CURRENT_DATE + t.due_off END,
       CASE WHEN t.start_min IS NULL THEN NULL ELSE (CURRENT_DATE + t.due_off) + (t.start_min || ' minutes')::interval END,
       t.dur, t.days,
       t.mode::assignment_mode,
       CASE WHEN t.done THEN now() ELSE NULL END,
       now() - interval '3 days'
FROM (VALUES
 ('b2000000-0000-4000-8000-000000000001','Provoz kanceláře','Odeslat podklady k auditu','Finální podklady pro externí audit za 1. pololetí.',1,-1,NULL,NULL,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000002','Obchod','Odpovědět na nabídku Zeman & spol.',NULL,2,-2,NULL,NULL,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000003','Q3 plánování','Dodat ceník pro Q3',NULL,2,-1,NULL,NULL,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000004','Q3 plánování','Připravit podklady pro čtvrtletní report','Čtvrtletní report pro vedení — tržby, náklady, odchylky od plánu.',1,0,540,90,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000005','Provoz kanceláře','Revize smlouvy s dodavatelem IT',NULL,2,0,660,30,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000006','Obchod','Schválit fakturace za květen',NULL,2,0,840,30,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000007','Q3 plánování','Hluboká práce — report',NULL,2,0,870,90,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000008','Obchod','Sjednotit šablony nabídek',NULL,2,1,NULL,NULL,NULL,'shared_all',false),
 ('b2000000-0000-4000-8000-000000000009','Provoz kanceláře','Objednat kávu a papír',NULL,4,1,NULL,NULL,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000010','Onboarding','Připravit onboarding balíček',NULL,2,2,NULL,NULL,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000011','Web redesign','Wireframy podstránek',NULL,2,4,NULL,NULL,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000012','Finance','Měsíční uzávěrka',NULL,1,5,NULL,NULL,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000013','Firemní akce','Mistrovství světa v aranžování',NULL,3,1,NULL,NULL,4,'single',false),
 ('b2000000-0000-4000-8000-000000000014','IT a systémy','Migrace CRM — příprava dat',NULL,2,7,NULL,NULL,NULL,'single',false),
 ('b2000000-0000-4000-8000-000000000015','Provoz kanceláře','Zaplatit fakturu dodavateli ABC',NULL,3,NULL,NULL,NULL,NULL,'single',true),
 ('b2000000-0000-4000-8000-000000000016','Finance','Faktura za nájem – úhrada',NULL,3,NULL,NULL,NULL,NULL,'single',true),
 ('b2000000-0000-4000-8000-000000000017','Web redesign','Návrh hlavičky webu',NULL,3,NULL,NULL,NULL,NULL,'single',true),
 ('b2000000-0000-4000-8000-000000000018','Nábor a HR','Pohovor – trenér gymnastiky',NULL,2,NULL,NULL,NULL,NULL,'single',true)
) AS t(id, project, name, descr, pri, due_off, start_min, dur, days, mode, done)
JOIN pr ON pr.name = t.project
ON CONFLICT (id) DO NOTHING;

-- Opakovaný úkol (týdenní reporting)
INSERT INTO tasks (id, project_id, name, priority, due_date, recurrence, recurrence_rule)
SELECT 'b2000000-0000-4000-8000-000000000019', p.id, 'Týdenní reporting', 3, CURRENT_DATE + 1,
       'Každý týden', '{"kind":"weekly","label":"Každý týden","endKind":"never","showAll":true}'
FROM projects p WHERE p.name = 'Q3 plánování'
ON CONFLICT (id) DO NOTHING;

-- Přiřazení (výběr) + komentář
INSERT INTO assignments (task_id, project_id, user_id)
SELECT t.tid::uuid, tk.project_id, u.id
FROM (VALUES
 ('b2000000-0000-4000-8000-000000000001','martin.benes@firma.cz'),
 ('b2000000-0000-4000-8000-000000000002','jana.dvorakova@firma.cz'),
 ('b2000000-0000-4000-8000-000000000004','adela.kucerova@firma.cz'),
 ('b2000000-0000-4000-8000-000000000005','martin.benes@firma.cz'),
 ('b2000000-0000-4000-8000-000000000006','jana.dvorakova@firma.cz'),
 ('b2000000-0000-4000-8000-000000000008','jana.dvorakova@firma.cz'),
 ('b2000000-0000-4000-8000-000000000008','eva.pospisilova@firma.cz'),
 ('b2000000-0000-4000-8000-000000000010','petra.novakova@firma.cz'),
 ('b2000000-0000-4000-8000-000000000011','adela.kucerova@firma.cz')
) AS t(tid, email)
JOIN tasks tk ON tk.id = t.tid::uuid
JOIN users u ON u.email = t.email
ON CONFLICT (task_id, user_id) DO NOTHING;

INSERT INTO comments (id, task_id, project_id, author_id, body)
SELECT 'b2000000-0000-4000-8000-000000000101', tk.id, tk.project_id, u.id, 'Data z účetnictví už mám, zítra dodělám grafy.'
FROM tasks tk, users u
WHERE tk.id = 'b2000000-0000-4000-8000-000000000004' AND u.email = 'adela.kucerova@firma.cz'
ON CONFLICT (id) DO NOTHING;

-- ── Postup „Plakát na červnovou show" (5 kroků, Firemní akce / Sokol) ──────
INSERT INTO chains (id, project_id, workspace_id, name, anchor_date, state, sched_mode, skip_weekend)
SELECT 'c3000000-0000-4000-8000-000000000001', p.id, p.workspace_id, 'Plakát na červnovou show', CURRENT_DATE - 2, 'active', 'chain', 0
FROM projects p WHERE p.name = 'Firemní akce'
ON CONFLICT (id) DO NOTHING;

WITH p AS (SELECT id, workspace_id FROM projects WHERE name = 'Firemní akce' LIMIT 1)
INSERT INTO tasks (id, project_id, name, priority, due_date, completed_at)
SELECT s.id::uuid, p.id, s.name, s.pri, CURRENT_DATE + s.off, CASE WHEN s.done THEN now() ELSE NULL END
FROM (VALUES
 ('c3000000-0000-4000-8000-000000000011','Udělat návrh plakátu',2,-2,true),
 ('c3000000-0000-4000-8000-000000000012','Poptávka do tisku',2,0,false),
 ('c3000000-0000-4000-8000-000000000013','Zadat do tisku',3,2,false),
 ('c3000000-0000-4000-8000-000000000014','Vyzvednout tisk',3,3,false),
 ('c3000000-0000-4000-8000-000000000015','Pohlídat platbu faktury',3,5,false)
) AS s(id, name, pri, off, done)
JOIN p ON true
ON CONFLICT (id) DO NOTHING;

WITH p AS (SELECT id FROM projects WHERE name = 'Firemní akce' LIMIT 1)
INSERT INTO chain_steps (id, chain_id, task_id, project_id, position, gate, step_state, anchor_offset, gap_days, activated_at)
SELECT s.sid::uuid, 'c3000000-0000-4000-8000-000000000001', s.tid::uuid, p.id, s.pos, s.gate::chain_gate, s.state::chain_step_state, s.aoff, s.gap,
       CASE WHEN s.state = 'active' THEN now() ELSE NULL END
FROM (VALUES
 ('c3000000-0000-4000-8000-000000000021','c3000000-0000-4000-8000-000000000011',0,'after_previous','done',0,0),
 ('c3000000-0000-4000-8000-000000000022','c3000000-0000-4000-8000-000000000012',1,'after_previous','active',2,2),
 ('c3000000-0000-4000-8000-000000000023','c3000000-0000-4000-8000-000000000013',2,'manual','dormant',4,2),
 ('c3000000-0000-4000-8000-000000000024','c3000000-0000-4000-8000-000000000014',3,'after_previous','dormant',5,1),
 ('c3000000-0000-4000-8000-000000000025','c3000000-0000-4000-8000-000000000015',4,'after_previous','dormant',7,2)
) AS s(sid, tid, pos, gate, state, aoff, gap)
JOIN p ON true
ON CONFLICT (id) DO NOTHING;

INSERT INTO assignments (task_id, project_id, user_id)
SELECT t.tid::uuid, tk.project_id, u.id
FROM (VALUES
 ('c3000000-0000-4000-8000-000000000011','eva.pospisilova@firma.cz'),
 ('c3000000-0000-4000-8000-000000000012','jana.dvorakova@firma.cz'),
 ('c3000000-0000-4000-8000-000000000013','jana.dvorakova@firma.cz'),
 ('c3000000-0000-4000-8000-000000000015','demo@watson.test')
) AS t(tid, email)
JOIN tasks tk ON tk.id = t.tid::uuid
JOIN users u ON u.email = t.email
ON CONFLICT (task_id, user_id) DO NOTHING;

-- ── Cíle (metriky nad reálnými daty) ───────────────────────────────────────
WITH ws AS (SELECT id FROM workspaces WHERE name = 'Kancelář Praha' LIMIT 1),
     us AS (SELECT email, id FROM users)
INSERT INTO goals (id, workspace_id, name, scope, metric, target, due_date, owner_id)
SELECT g.gid::uuid, ws.id, g.name, g.scope::goal_scope, g.metric::goal_metric, g.target, CURRENT_DATE + g.due_off, u.id
FROM (VALUES
 ('e4000000-0000-4000-8000-000000000001','Spustit nový web do konce Q3','project','project',100,67,'adela.kucerova@firma.cz'),
 ('e4000000-0000-4000-8000-000000000002','Odbavit 200 úkolů toto čtvrtletí','team','count',200,97,'jana.dvorakova@firma.cz'),
 ('e4000000-0000-4000-8000-000000000003','Úkoly odbavené včas ≥ 90 %','team','ontime',90,189,'petra.novakova@firma.cz'),
 ('e4000000-0000-4000-8000-000000000004','Onboarding nových členů dokončen','project','completion',100,20,'petra.novakova@firma.cz')
) AS g(gid, name, scope, metric, target, due_off, owner_email)
JOIN ws ON true
JOIN us u ON u.email = g.owner_email
ON CONFLICT (id) DO NOTHING;

INSERT INTO goal_projects (goal_id, project_id, workspace_id)
SELECT g.gid::uuid, p.id, p.workspace_id
FROM (VALUES
 ('e4000000-0000-4000-8000-000000000001','Web redesign'),
 ('e4000000-0000-4000-8000-000000000004','Onboarding')
) AS g(gid, pname)
JOIN projects p ON p.name = g.pname
WHERE NOT EXISTS (SELECT 1 FROM goal_projects gp WHERE gp.goal_id = g.gid::uuid AND gp.project_id = p.id);

COMMIT;
