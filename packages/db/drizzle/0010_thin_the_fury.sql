CREATE TABLE IF NOT EXISTS "technology_stack_baseline_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"github_repository_id" text NOT NULL,
	"slug" text NOT NULL,
	"packages_digest" text NOT NULL,
	"frozen_at" timestamp NOT NULL,
	CONSTRAINT "technology_stack_baseline_receipts_user_repo_stack_unique" UNIQUE ("user_id","github_repository_id","slug")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "technology_stack_cleanup_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"executed_at" timestamp NOT NULL,
	"legacy_stack_edges" integer NOT NULL,
	"pseudo_watched" integer NOT NULL,
	"pseudo_repositories" integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "technology_stack_baseline_receipts_user_repo_stack_unique" ON "technology_stack_baseline_receipts" USING btree ("user_id","github_repository_id","slug");--> statement-breakpoint
DO $$
BEGIN
  -- Phase C：DROP COLUMN is_reference 只在 cleanup receipt 已落盘（维护窗口
  -- cleanup 脚本执行过）且列仍存在时执行；常规 migrate 与 fresh 重放均 no-op。
  IF to_regclass('public.technology_stack_cleanup_receipts') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.technology_stack_cleanup_receipts LIMIT 1)
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'repositories'
         AND column_name = 'is_reference'
     )
  THEN
    EXECUTE 'ALTER TABLE "repositories" DROP COLUMN "is_reference"';
  END IF;
END $$;
