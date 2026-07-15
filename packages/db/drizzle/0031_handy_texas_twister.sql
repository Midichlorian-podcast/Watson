CREATE TABLE "api_rate_limits" (
	"key" varchar(160) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_rate_limits_count_positive" CHECK ("api_rate_limits"."count" > 0)
);
--> statement-breakpoint
CREATE INDEX "api_rate_limits_expires_idx" ON "api_rate_limits" USING btree ("expires_at");