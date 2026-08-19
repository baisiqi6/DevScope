CREATE TYPE "public"."package_resolution_status" AS ENUM('resolved', 'not_found', 'error');--> statement-breakpoint
CREATE TABLE "github_repo_name_canonicalizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"canonical_full_name" text,
	"resolution_status" "package_resolution_status" DEFAULT 'error' NOT NULL,
	"retry_after" timestamp,
	"last_error" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "progress" jsonb;--> statement-breakpoint
ALTER TABLE "package_repo_mappings" ADD COLUMN "resolution_status" "package_resolution_status" DEFAULT 'error' NOT NULL;--> statement-breakpoint
ALTER TABLE "package_repo_mappings" ADD COLUMN "retry_after" timestamp;--> statement-breakpoint
ALTER TABLE "package_repo_mappings" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "package_repo_mappings" ADD COLUMN "last_resolved_repo" text;--> statement-breakpoint
-- 历史行确定性回填（plan 拍板语义）：
-- 1) 非空 source_repo 行 → resolved（权威结论已存在）；
-- 2) 历史 source_repo=null 行缺少权威证据 → 保守 error + 以迁移执行时间为基准的短退避，
--    禁止解释为 not_found；重复执行只影响仍未回填的行，不产生漂移。
UPDATE "package_repo_mappings" SET "resolution_status" = 'resolved', "retry_after" = now() + interval '30 days' WHERE "source_repo" IS NOT NULL AND "resolution_status" <> 'resolved';--> statement-breakpoint
UPDATE "package_repo_mappings" SET "retry_after" = now() + interval '15 minutes' WHERE "source_repo" IS NULL AND "retry_after" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "github_repo_name_canonicalizations_full_name_unique" ON "github_repo_name_canonicalizations" USING btree ("full_name");--> statement-breakpoint
ALTER TABLE "package_repo_mappings" ADD CONSTRAINT "package_repo_mappings_resolved_source_check" CHECK ((resolution_status = 'resolved') = (source_repo IS NOT NULL));