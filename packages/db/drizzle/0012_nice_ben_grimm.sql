ALTER TABLE "external_resource_group_members" ADD COLUMN "user_id" integer;--> statement-breakpoint
UPDATE "external_resource_group_members" AS m
SET "user_id" = r."user_id"
FROM "external_resources" AS r
WHERE r."id" = m."resource_id";--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM "external_resource_group_members" AS m
    LEFT JOIN "external_resources" AS r ON r."id" = m."resource_id"
    LEFT JOIN "external_resource_groups" AS g ON g."id" = m."group_id"
    WHERE m."user_id" IS NULL OR r."user_id" IS NULL OR g."user_id" IS NULL
      OR m."user_id" <> r."user_id" OR m."user_id" <> g."user_id"
  ) THEN
    RAISE EXCEPTION 'external_resource_group_members contains cross-user or orphaned rows';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "external_resource_group_members" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "external_resource_groups_id_user_unique" ON "external_resource_groups" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_resources_id_user_unique" ON "external_resources" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "external_resource_group_members" ADD CONSTRAINT "external_resource_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_group_members" ADD CONSTRAINT "external_resource_group_members_group_user_fk" FOREIGN KEY ("group_id","user_id") REFERENCES "public"."external_resource_groups"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_group_members" ADD CONSTRAINT "external_resource_group_members_resource_user_fk" FOREIGN KEY ("resource_id","user_id") REFERENCES "public"."external_resources"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_saves" ADD CONSTRAINT "external_resource_saves_resource_user_fk" FOREIGN KEY ("resource_id","user_id") REFERENCES "public"."external_resources"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
