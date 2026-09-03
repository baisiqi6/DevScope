ALTER TABLE "external_resource_contents" DROP CONSTRAINT IF EXISTS "external_resource_contents_byte_length_check";
ALTER TABLE "external_resource_contents" DROP CONSTRAINT IF EXISTS "external_resource_contents_content_type_check";
ALTER TABLE "external_resource_contents" DROP CONSTRAINT IF EXISTS "external_resource_contents_user_id_users_id_fk";
