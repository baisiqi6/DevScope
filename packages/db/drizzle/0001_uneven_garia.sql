CREATE TYPE "public"."repo_relationship_type" AS ENUM('similarity', 'dependency');--> statement-breakpoint
CREATE TABLE "package_repo_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"system" text NOT NULL,
	"package_name" text NOT NULL,
	"package_version" text NOT NULL,
	"source_repo" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_repo_id" integer NOT NULL,
	"target_repo_id" integer NOT NULL,
	"edge_type" "repo_relationship_type" NOT NULL,
	"score" real,
	"evidence" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
ALTER TABLE "repo_relationships" ADD CONSTRAINT "repo_relationships_source_repo_id_repositories_id_fk" FOREIGN KEY ("source_repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_relationships" ADD CONSTRAINT "repo_relationships_target_repo_id_repositories_id_fk" FOREIGN KEY ("target_repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "package_repo_mappings_system_name_version_unique" ON "package_repo_mappings" USING btree ("system","package_name","package_version");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_relationships_source_target_type_unique" ON "repo_relationships" USING btree ("source_repo_id","target_repo_id","edge_type");--> statement-breakpoint
CREATE INDEX "repo_relationships_target_repo_id_idx" ON "repo_relationships" USING btree ("target_repo_id");