CREATE TYPE "public"."github_trending_period" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "github_trending_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"rank" integer NOT NULL,
	"full_name" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"language" text,
	"stars" integer NOT NULL,
	"forks" integer NOT NULL,
	"stars_in_period" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_trending_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" "github_trending_period" NOT NULL,
	"language" text DEFAULT 'all' NOT NULL,
	"snapshot_date" text NOT NULL,
	"source_url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"entry_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_trending_entries" ADD CONSTRAINT "github_trending_entries_snapshot_id_github_trending_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."github_trending_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_trending_entries_snapshot_rank_unique" ON "github_trending_entries" USING btree ("snapshot_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "github_trending_entries_snapshot_repo_unique" ON "github_trending_entries" USING btree ("snapshot_id","full_name");--> statement-breakpoint
CREATE INDEX "github_trending_entries_full_name_idx" ON "github_trending_entries" USING btree ("full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "github_trending_snapshots_period_language_date_unique" ON "github_trending_snapshots" USING btree ("period","language","snapshot_date");--> statement-breakpoint
CREATE INDEX "github_trending_snapshots_latest_idx" ON "github_trending_snapshots" USING btree ("period","language","fetched_at");