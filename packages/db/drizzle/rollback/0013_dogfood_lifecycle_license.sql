DROP INDEX IF EXISTS "user_watched_repos_user_archived_idx";
ALTER TABLE "user_watched_repositories" DROP COLUMN IF EXISTS "is_archived";
ALTER TABLE "repositories" DROP COLUMN IF EXISTS "license_status";
DROP TYPE IF EXISTS "repository_license_status";
