-- A manual workflow gate is a security/domain boundary, not a UI convention.
-- Generic PowerSync updates and accidental client repair must not turn a dormant
-- manual step active. The audited API command enables a transaction-local GUC.
CREATE OR REPLACE FUNCTION watson_guard_manual_chain_activation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.gate = 'manual'
	   AND OLD.step_state = 'dormant'
	   AND NEW.step_state = 'active'
	   AND COALESCE(current_setting('watson.allow_manual_chain_activation', true), '') <> 'on' THEN
		RAISE EXCEPTION 'manual_chain_gate_requires_command' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chain_steps_manual_activation_guard ON chain_steps;
CREATE TRIGGER chain_steps_manual_activation_guard
BEFORE UPDATE OF step_state ON chain_steps
FOR EACH ROW EXECUTE FUNCTION watson_guard_manual_chain_activation();
