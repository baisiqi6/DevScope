-- DevScope 首份显式迁移同时承担现有 db:push 数据库的基线升级。
-- 所有对象都使用幂等创建，既支持现有生产库补齐，也支持空库初始化。
CREATE EXTENSION IF NOT EXISTS "vector";--> statement-breakpoint
DO $$ BEGIN
CREATE TYPE "public"."embedding_status" AS ENUM('pending', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'retry_wait', 'dead', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
CREATE TYPE "public"."radar_candidate_status" AS ENUM('discovered', 'shortlisted', 'researching', 'recommended', 'dismissed', 'watching');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
CREATE TYPE "public"."workflow_execution_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
CREATE TYPE "public"."workflow_report_type" AS ENUM('daily_health_report', 'quick_assessment');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"repo_id" integer NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hackernews_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" serial NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"content" text,
	"author" text,
	"score" integer,
	"descendants" integer,
	"url" text,
	"raw_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp,
	"last_error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "radar_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"github_repo_id" text,
	"full_name" text NOT NULL,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"language" text,
	"stars" integer DEFAULT 0 NOT NULL,
	"forks" integer DEFAULT 0 NOT NULL,
	"open_issues" integer DEFAULT 0 NOT NULL,
	"status" "radar_candidate_status" DEFAULT 'discovered' NOT NULL,
	"source" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"deterministic_score" integer,
	"score_breakdown" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "releases" (
	"id" integer PRIMARY KEY NOT NULL,
	"repo_id" serial NOT NULL,
	"tag_name" text NOT NULL,
	"name" text NOT NULL,
	"body" text,
	"author" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"published_at" timestamp,
	"url" text NOT NULL,
	"html_url" text NOT NULL,
	"zip_url" text,
	"tar_url" text,
	"assets" jsonb NOT NULL,
	"is_prerelease" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repo_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" serial NOT NULL,
	"content" text NOT NULL,
	"chunk_type" text NOT NULL,
	"source_id" text,
	"chunk_index" integer NOT NULL,
	"embedding" vector(1024),
	"token_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"name" text NOT NULL,
	"owner" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"stars" integer DEFAULT 0,
	"forks" integer DEFAULT 0,
	"open_issues" integer DEFAULT 0,
	"language" text,
	"license" text,
	"readme" text,
	"readme_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp,
	"starred_at" timestamp,
	"note" text,
	"embedding_status" "embedding_status" DEFAULT 'pending',
	"embedding_progress" integer DEFAULT 0,
	"embedding_total_chunks" integer DEFAULT 0,
	"embedding_completed_chunks" integer DEFAULT 0,
	"embedding_started_at" timestamp,
	"embedding_completed_at" timestamp,
	"embedding_error" text,
	CONSTRAINT "repositories_full_name_unique" UNIQUE("full_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repository_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"icon" text DEFAULT 'folder' NOT NULL,
	"description" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_watched_repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"repo_id" serial NOT NULL,
	"repo_full_name" text NOT NULL,
	"enable_daily_report" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"execution_id" text NOT NULL,
	"user_id" serial NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_type" text NOT NULL,
	"status" "workflow_execution_status" DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"result" jsonb,
	"error" text,
	"progress_percent" integer DEFAULT 0,
	"current_node" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"estimated_completion_at" timestamp,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_executions_execution_id_unique" UNIQUE("execution_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"user_id" serial NOT NULL,
	"report_type" "workflow_report_type" NOT NULL,
	"report_data" jsonb NOT NULL,
	"summary" text,
	"report_date" text,
	"repo_full_name" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_reports_report_id_unique" UNIQUE("report_id")
);
--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_repository_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."repository_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "hackernews_items" ADD CONSTRAINT "hackernews_items_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "radar_candidates" ADD CONSTRAINT "radar_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "releases" ADD CONSTRAINT "releases_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "repo_chunks" ADD CONSTRAINT "repo_chunks_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "repository_groups" ADD CONSTRAINT "repository_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "user_watched_repositories" ADD CONSTRAINT "user_watched_repositories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "user_watched_repositories" ADD CONSTRAINT "user_watched_repositories_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "workflow_reports" ADD CONSTRAINT "workflow_reports_execution_id_workflow_executions_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_executions"("execution_id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
ALTER TABLE "workflow_reports" ADD CONSTRAINT "workflow_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_members_group_id_idx" ON "group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_members_repo_id_idx" ON "group_members" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_members_group_order_idx" ON "group_members" USING btree ("group_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "group_members_group_repo_unique" ON "group_members" USING btree ("group_id","repo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hn_items_repo_id_idx" ON "hackernews_items" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hn_items_type_idx" ON "hackernews_items" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hn_items_score_idx" ON "hackernews_items" USING btree ("score");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_user_idempotency_key_unique" ON "jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_claim_idx" ON "jobs" USING btree ("status","available_at","priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_lease_expires_at_idx" ON "jobs" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_user_type_idx" ON "jobs" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "radar_candidates_user_repo_unique" ON "radar_candidates" USING btree ("user_id","full_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_candidates_user_status_score_idx" ON "radar_candidates" USING btree ("user_id","status","deterministic_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_candidates_last_seen_at_idx" ON "radar_candidates" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_candidates_github_repo_id_idx" ON "radar_candidates" USING btree ("github_repo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "releases_repo_id_idx" ON "releases" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "releases_tag_name_idx" ON "releases" USING btree ("tag_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "releases_created_at_idx" ON "releases" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_chunks_repo_id_idx" ON "repo_chunks" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_chunks_type_idx" ON "repo_chunks" USING btree ("chunk_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repositories_owner_idx" ON "repositories" USING btree ("owner");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repositories_stars_idx" ON "repositories" USING btree ("stars");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repositories_last_fetched_at_idx" ON "repositories" USING btree ("last_fetched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repositories_embedding_status_idx" ON "repositories" USING btree ("embedding_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_groups_user_id_idx" ON "repository_groups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_groups_order_idx" ON "repository_groups" USING btree ("user_id","order_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_watched_repos_user_id_idx" ON "user_watched_repositories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_watched_repos_repo_id_idx" ON "user_watched_repositories" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_watched_repos_user_repo_unique_idx" ON "user_watched_repositories" USING btree ("user_id","repo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_executions_execution_id_idx" ON "workflow_executions" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_executions_user_id_idx" ON "workflow_executions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_executions_workflow_id_idx" ON "workflow_executions" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_executions_status_idx" ON "workflow_executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_executions_created_at_idx" ON "workflow_executions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_reports_report_id_idx" ON "workflow_reports" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_reports_execution_id_idx" ON "workflow_reports" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_reports_user_id_idx" ON "workflow_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_reports_report_type_idx" ON "workflow_reports" USING btree ("report_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_reports_repo_full_name_idx" ON "workflow_reports" USING btree ("repo_full_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_reports_created_at_idx" ON "workflow_reports" USING btree ("created_at");
