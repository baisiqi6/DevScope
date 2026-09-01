CREATE TYPE "public"."repository_license_status" AS ENUM('standard_open_source', 'source_available', 'no_license', 'unknown');--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "license_status" "repository_license_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_watched_repositories" ADD COLUMN "is_archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "user_watched_repos_user_archived_idx" ON "user_watched_repositories" USING btree ("user_id","is_archived");