-- CC-P0-05/15: deterministický backfill projektů bez managera.
-- Preferuj vlastníka projektu, potom vlastníka workspace, admina, managera a člena.
-- Guest se nikdy automaticky nepovyšuje.
WITH candidate AS (
	SELECT p.id AS project_id, pick.user_id
	FROM projects p
	JOIN workspaces w ON w.id = p.workspace_id
	JOIN LATERAL (
		SELECT m.user_id
		FROM memberships m
		WHERE m.workspace_id = p.workspace_id
		  AND m.role <> 'guest'
		ORDER BY
			CASE
				WHEN m.user_id = p.owner_id THEN 0
				WHEN m.user_id = w.owner_id THEN 1
				WHEN m.role = 'admin' THEN 2
				WHEN m.role = 'manager' THEN 3
				ELSE 4
			END,
			m.created_at,
			m.user_id
		LIMIT 1
	) pick ON true
	WHERE NOT EXISTS (
		SELECT 1 FROM project_members pm
		WHERE pm.project_id = p.id AND pm.role = 'manager'
	)
)
INSERT INTO project_members (id, project_id, user_id, role, created_at)
SELECT gen_random_uuid(), project_id, user_id, 'manager', now()
FROM candidate
ON CONFLICT (project_id, user_id)
DO UPDATE SET role = 'manager';
--> statement-breakpoint

-- Pokud projekt nemá ani jednoho způsobilého workspace člena, deployment musí
-- selhat nahlas; tiché pokračování by zachovalo porušený bezpečnostní invariant.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM projects p
		WHERE NOT EXISTS (
			SELECT 1 FROM project_members pm
			WHERE pm.project_id = p.id AND pm.role = 'manager'
		)
	) THEN
		RAISE EXCEPTION 'project_without_eligible_manager'
			USING ERRCODE = '23514';
	END IF;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION watson_keep_last_project_manager()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.role <> 'manager' THEN
		RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
	END IF;
	IF TG_OP = 'UPDATE'
	   AND NEW.role = 'manager'
	   AND NEW.project_id = OLD.project_id THEN
		RETURN NEW;
	END IF;

	-- Zámek parent řádku serializuje souběžné degradace/smazání dvou managerů.
	-- Při cascade delete projektu parent už neexistuje a child delete se neblokuje.
	PERFORM 1 FROM projects WHERE id = OLD.project_id FOR UPDATE;
	IF NOT FOUND THEN
		RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM project_members pm
		WHERE pm.project_id = OLD.project_id
		  AND pm.role = 'manager'
		  AND pm.id <> OLD.id
	) THEN
		RAISE EXCEPTION 'cannot_remove_last_project_manager'
			USING ERRCODE = '23514';
	END IF;

	RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS keep_last_project_manager ON project_members;
--> statement-breakpoint
CREATE TRIGGER keep_last_project_manager
BEFORE DELETE OR UPDATE OF role, project_id ON project_members
FOR EACH ROW EXECUTE FUNCTION watson_keep_last_project_manager();
