ALTER TABLE "task_recurrence_prefixes" DROP CONSTRAINT "task_recurrence_prefixes_rule_object";--> statement-breakpoint
ALTER TABLE "task_recurrence_prefixes" ADD CONSTRAINT "task_recurrence_prefixes_rule_object" CHECK (jsonb_typeof("task_recurrence_prefixes"."recurrence_rule"::jsonb) = 'object'
				and "task_recurrence_prefixes"."recurrence_rule"::jsonb ->> 'kind' in
				('daily', 'weekly', 'biweekly', 'monthly', 'yearly', 'monthly-nth', 'monthly-day'));