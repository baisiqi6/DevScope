DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM repository_groups WHERE parent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'refusing hierarchy rollback while parent_id data exists';
  END IF;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "repository_groups_hierarchy_guard" ON "repository_groups";--> statement-breakpoint
DROP FUNCTION IF EXISTS "enforce_repository_group_hierarchy"();--> statement-breakpoint
ALTER TABLE "repository_groups" DROP CONSTRAINT IF EXISTS "repository_groups_parent_user_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "repository_groups_sibling_order_idx";--> statement-breakpoint
CREATE INDEX "repository_groups_order_idx" ON "repository_groups" USING btree ("user_id", "order_index");--> statement-breakpoint
DROP INDEX IF EXISTS "repository_groups_id_user_unique";--> statement-breakpoint
ALTER TABLE "repository_groups" DROP COLUMN "parent_id";
