CREATE TYPE "public"."external_resource_content_status" AS ENUM('not_requested', 'pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."external_resource_ingestion_mode" AS ENUM('preview_only', 'content');--> statement-breakpoint
CREATE TYPE "public"."external_resource_type" AS ENUM('article', 'paper', 'website');--> statement-breakpoint
CREATE TABLE "external_resource_group_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"resource_id" integer NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_resource_groups" (
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
CREATE TABLE "external_resource_saves" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"resource_id" integer NOT NULL,
	"notes" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_resource_saves_tags_shape_check" CHECK (jsonb_typeof("external_resource_saves"."tags") = 'array' AND jsonb_array_length("external_resource_saves"."tags") <= 30)
);
--> statement-breakpoint
CREATE TABLE "external_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"resource_type" "external_resource_type" NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"site_name" text,
	"author" text,
	"published_at" timestamp,
	"favicon_url" text,
	"preview_image_url" text,
	"metadata" jsonb,
	"ingestion_mode" "external_resource_ingestion_mode" DEFAULT 'preview_only' NOT NULL,
	"content_status" "external_resource_content_status" DEFAULT 'not_requested' NOT NULL,
	"content_fetched_at" timestamp,
	"content_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_resources_metadata_size_check" CHECK ("external_resources"."metadata" IS NULL OR octet_length("external_resources"."metadata"::text) <= 20000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "external_resource_groups_id_user_unique" ON "external_resource_groups" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_resources_id_user_unique" ON "external_resources" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "external_resource_group_members" ADD CONSTRAINT "external_resource_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_group_members" ADD CONSTRAINT "external_resource_group_members_group_id_external_resource_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."external_resource_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_group_members" ADD CONSTRAINT "external_resource_group_members_resource_id_external_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."external_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_group_members" ADD CONSTRAINT "external_resource_group_members_group_user_fk" FOREIGN KEY ("group_id","user_id") REFERENCES "public"."external_resource_groups"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_group_members" ADD CONSTRAINT "external_resource_group_members_resource_user_fk" FOREIGN KEY ("resource_id","user_id") REFERENCES "public"."external_resources"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_groups" ADD CONSTRAINT "external_resource_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_saves" ADD CONSTRAINT "external_resource_saves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_saves" ADD CONSTRAINT "external_resource_saves_resource_id_external_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."external_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_saves" ADD CONSTRAINT "external_resource_saves_resource_user_fk" FOREIGN KEY ("resource_id","user_id") REFERENCES "public"."external_resources"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resources" ADD CONSTRAINT "external_resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_resource_group_members_group_id_idx" ON "external_resource_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "external_resource_group_members_resource_id_idx" ON "external_resource_group_members" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "external_resource_group_members_user_group_order_idx" ON "external_resource_group_members" USING btree ("user_id","group_id","order_index");--> statement-breakpoint
CREATE INDEX "external_resource_group_members_user_resource_idx" ON "external_resource_group_members" USING btree ("user_id","resource_id");--> statement-breakpoint
CREATE INDEX "external_resource_group_members_group_order_idx" ON "external_resource_group_members" USING btree ("group_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "external_resource_group_members_group_resource_unique" ON "external_resource_group_members" USING btree ("group_id","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_resource_groups_user_name_unique" ON "external_resource_groups" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "external_resource_groups_user_id_idx" ON "external_resource_groups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "external_resource_groups_order_idx" ON "external_resource_groups" USING btree ("user_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "external_resource_saves_user_resource_unique" ON "external_resource_saves" USING btree ("user_id","resource_id");--> statement-breakpoint
CREATE INDEX "external_resource_saves_user_id_idx" ON "external_resource_saves" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "external_resource_saves_resource_id_idx" ON "external_resource_saves" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "external_resource_saves_user_status_updated_idx" ON "external_resource_saves" USING btree ("user_id","is_pinned","is_read","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_resources_user_canonical_url_unique" ON "external_resources" USING btree ("user_id","canonical_url");--> statement-breakpoint
CREATE INDEX "external_resources_user_id_idx" ON "external_resources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "external_resources_type_idx" ON "external_resources" USING btree ("user_id","resource_type");--> statement-breakpoint
CREATE INDEX "external_resources_updated_at_idx" ON "external_resources" USING btree ("user_id","updated_at");--> statement-breakpoint
