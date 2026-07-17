-- F8c hotfix for databases that applied 0082 before the workspace-cascade
-- invariant was audited. PostgreSQL can execute the project delete trigger at
-- depth one even after the parent workspace row has disappeared.
CREATE OR REPLACE FUNCTION watson_project_webhook_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	row_data projects%ROWTYPE;
	kind text;
BEGIN
	IF COALESCE(current_setting('watson.suppress_webhook_events', true), 'off') = 'on' THEN
		RETURN COALESCE(NEW, OLD);
	END IF;
	IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
		RETURN OLD;
	END IF;
	row_data := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
	IF TG_OP = 'DELETE' AND NOT EXISTS (
		SELECT 1 FROM workspaces w WHERE w.id = row_data.workspace_id
	) THEN
		RETURN OLD;
	END IF;
	kind := CASE
		WHEN TG_OP = 'INSERT' THEN 'project.created'
		WHEN TG_OP = 'DELETE' THEN 'project.deleted'
		ELSE 'project.updated'
	END;
	INSERT INTO webhook_events (
		workspace_id, event_type, entity_type, entity_id, project_id, payload, occurred_at
	) VALUES (
		row_data.workspace_id,
		kind,
		'project',
		row_data.id,
		row_data.id,
		jsonb_strip_nulls(jsonb_build_object(
			'id', row_data.id,
			'workspace_id', row_data.workspace_id,
			'name', row_data.name,
			'kind', row_data.kind,
			'status', row_data.status,
			'delivery_date', row_data.delivery_date,
			'updated_at', row_data.updated_at
		)),
		now()
	);
	RETURN COALESCE(NEW, OLD);
END;
$$;
