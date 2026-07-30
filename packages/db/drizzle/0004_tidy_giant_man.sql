DROP INDEX "repo_relationships_source_target_type_unique";--> statement-breakpoint
DROP INDEX "user_watched_repos_user_repo_unique_idx";--> statement-breakpoint

-- 这些外键历史上误用了 serial。先移除默认 sequence，再保留普通 integer 外键。
ALTER TABLE "documents" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "hackernews_items" ALTER COLUMN "repo_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "releases" ALTER COLUMN "repo_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "repo_chunks" ALTER COLUMN "repo_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_watched_repositories" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_watched_repositories" ALTER COLUMN "repo_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_executions" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "workflow_reports" ALTER COLUMN "user_id" DROP DEFAULT;--> statement-breakpoint
DROP SEQUENCE IF EXISTS "documents_user_id_seq";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "hackernews_items_repo_id_seq";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "releases_repo_id_seq";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "repo_chunks_repo_id_seq";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "user_watched_repositories_user_id_seq";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "user_watched_repositories_repo_id_seq";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "workflow_executions_user_id_seq";--> statement-breakpoint
DROP SEQUENCE IF EXISTS "workflow_reports_user_id_seq";--> statement-breakpoint

ALTER TABLE "repo_relationships" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "user_watched_repositories" ADD COLUMN "starred_at" timestamp;--> statement-breakpoint

-- 生产基线仍是单用户。仅在已有仓库数据但 users 为空时补建默认用户，保证回填可完成。
INSERT INTO "users" ("email", "name")
SELECT 'default@devscope.local', 'default'
WHERE NOT EXISTS (SELECT 1 FROM "users")
  AND EXISTS (SELECT 1 FROM "repositories")
ON CONFLICT ("email") DO NOTHING;--> statement-breakpoint

-- 历史索引不是唯一约束；保留 updated_at 最新（并以较大 id 破平局）的关联后建立真实唯一边界。
DELETE FROM "user_watched_repositories" duplicate
USING "user_watched_repositories" retained
WHERE duplicate."user_id" = retained."user_id"
  AND duplicate."repo_id" = retained."repo_id"
  AND (
    duplicate."updated_at" < retained."updated_at"
    OR (duplicate."updated_at" = retained."updated_at" AND duplicate."id" < retained."id")
  );--> statement-breakpoint
CREATE UNIQUE INDEX "user_watched_repos_user_repo_unique_idx"
  ON "user_watched_repositories" USING btree ("user_id", "repo_id");--> statement-breakpoint

-- 把现有全局仓库、备注和 star 时间归入当前单用户关联，保持升级后数据可见。
INSERT INTO "user_watched_repositories" (
  "user_id",
  "repo_id",
  "repo_full_name",
  "enable_daily_report",
  "notes",
  "starred_at"
)
SELECT default_user."id",
       repo."id",
       repo."full_name",
       NOT repo."is_reference",
       repo."note",
       repo."starred_at"
FROM "repositories" repo
CROSS JOIN LATERAL (SELECT "id" FROM "users" ORDER BY "id" LIMIT 1) default_user
ON CONFLICT ("user_id", "repo_id") DO UPDATE SET
  "repo_full_name" = EXCLUDED."repo_full_name",
  "notes" = COALESCE("user_watched_repositories"."notes", EXCLUDED."notes"),
  "starred_at" = COALESCE("user_watched_repositories"."starred_at", EXCLUDED."starred_at"),
  "updated_at" = now();--> statement-breakpoint

UPDATE "repo_relationships" edge
SET "user_id" = default_user."id"
FROM (SELECT "id" FROM "users" ORDER BY "id" LIMIT 1) default_user
WHERE edge."user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "repo_relationships" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_relationships"
  ADD CONSTRAINT "repo_relationships_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repo_relationships_user_source_target_type_unique"
  ON "repo_relationships" USING btree ("user_id", "source_repo_id", "target_repo_id", "edge_type");--> statement-breakpoint
CREATE INDEX "repo_relationships_user_id_idx"
  ON "repo_relationships" USING btree ("user_id");--> statement-breakpoint

ALTER TABLE "repositories" DROP COLUMN "starred_at";--> statement-breakpoint
ALTER TABLE "repositories" DROP COLUMN "note";
