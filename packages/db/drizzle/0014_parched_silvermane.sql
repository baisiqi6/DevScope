CREATE TABLE "external_resource_contents" (
	"resource_id" integer PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"content_type" text NOT NULL,
	"content_text" text NOT NULL,
	"byte_length" integer NOT NULL,
	"content_hash" text NOT NULL,
	"final_url" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"parser_version" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_resource_contents" ADD CONSTRAINT "external_resource_contents_resource_id_external_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."external_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_resource_contents" ADD CONSTRAINT "external_resource_contents_resource_user_fk" FOREIGN KEY ("resource_id","user_id") REFERENCES "public"."external_resources"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_resource_contents_user_id_idx" ON "external_resource_contents" USING btree ("user_id");