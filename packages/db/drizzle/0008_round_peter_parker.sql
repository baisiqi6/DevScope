CREATE TABLE "repository_technology_stacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"technology_stack_id" integer NOT NULL,
	"packages" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technology_stacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_technology_stacks" ADD CONSTRAINT "repository_technology_stacks_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_technology_stacks" ADD CONSTRAINT "repository_technology_stacks_technology_stack_id_technology_stacks_id_fk" FOREIGN KEY ("technology_stack_id") REFERENCES "public"."technology_stacks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_technology_stacks_repository_stack_unique" ON "repository_technology_stacks" USING btree ("repository_id","technology_stack_id");--> statement-breakpoint
CREATE INDEX "repository_technology_stacks_repository_id_idx" ON "repository_technology_stacks" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "repository_technology_stacks_technology_stack_id_idx" ON "repository_technology_stacks" USING btree ("technology_stack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "technology_stacks_slug_unique" ON "technology_stacks" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_technology_stack_entities_backfill_active_unique" ON "jobs" USING btree ("type") WHERE "jobs"."type" = 'technology_stack.entities.backfill' AND "jobs"."status" IN ('queued', 'running', 'retry_wait');--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_technology_stack_entities_backfill_version_unique" ON "jobs" USING btree ("type","idempotency_key") WHERE "jobs"."type" = 'technology_stack.entities.backfill';