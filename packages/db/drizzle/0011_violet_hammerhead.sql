ALTER TABLE "repository_groups" ADD COLUMN "parent_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_groups_id_user_unique" ON "repository_groups" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "repository_groups" ADD CONSTRAINT "repository_groups_parent_user_fk" FOREIGN KEY ("parent_id","user_id") REFERENCES "public"."repository_groups"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_groups_sibling_order_idx" ON "repository_groups" USING btree ("user_id","parent_id","order_index");--> statement-breakpoint
DROP INDEX "repository_groups_order_idx";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_repository_group_hierarchy"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  creates_cycle boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('devscope.repository_group_hierarchy'),
    NEW.user_id
  );

  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'repository group cannot be its own parent'
      USING ERRCODE = '23514', CONSTRAINT = 'repository_groups_no_cycle';
  END IF;

  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id
    FROM repository_groups
    WHERE id = NEW.parent_id AND user_id = NEW.user_id

    UNION

    SELECT parent.id, parent.parent_id
    FROM repository_groups parent
    INNER JOIN ancestors child ON parent.id = child.parent_id
    WHERE parent.user_id = NEW.user_id
  )
  SELECT EXISTS (
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) INTO creates_cycle;

  IF creates_cycle THEN
    RAISE EXCEPTION 'repository group hierarchy cannot contain a cycle'
      USING ERRCODE = '23514', CONSTRAINT = 'repository_groups_no_cycle';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "repository_groups_hierarchy_guard"
BEFORE INSERT OR UPDATE OF "parent_id", "user_id"
ON "repository_groups"
FOR EACH ROW
EXECUTE FUNCTION "enforce_repository_group_hierarchy"();
