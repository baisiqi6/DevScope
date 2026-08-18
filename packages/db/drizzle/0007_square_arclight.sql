ALTER TABLE "repositories" ADD COLUMN "github_repository_id" text;--> statement-breakpoint
LOCK TABLE "radar_candidates" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "radar_candidates"
    WHERE "github_repo_id" IS NOT NULL
    GROUP BY "user_id", "github_repo_id"
    HAVING count(DISTINCT "status") FILTER (
      WHERE "status" <> 'discovered'::"radar_candidate_status"
    ) > 1
  ) THEN
    RAISE EXCEPTION 'RADAR_IDENTITY_STATUS_CONFLICT: duplicate GitHub repository ID has conflicting non-default states';
  END IF;
END
$$;--> statement-breakpoint
CREATE TEMP TABLE "_radar_identity_merge" ON COMMIT DROP AS
SELECT
  grouped."user_id",
  grouped."github_repo_id",
  (array_agg(grouped."id" ORDER BY grouped."last_seen_at" DESC, grouped."updated_at" DESC, grouped."id" DESC))[1] AS "keeper_id",
  min(grouped."first_seen_at") AS "first_seen_at",
  (array_agg(
    grouped."status"
    ORDER BY
      CASE WHEN grouped."status" <> 'discovered'::"radar_candidate_status" THEN 0 ELSE 1 END,
      grouped."id" DESC
  ))[1] AS "status",
  jsonb_agg(grouped."id" ORDER BY grouped."id") AS "merged_candidate_ids",
  jsonb_agg(grouped."full_name" ORDER BY grouped."id") AS "merged_full_names"
FROM "radar_candidates" grouped
WHERE grouped."github_repo_id" IS NOT NULL
GROUP BY grouped."user_id", grouped."github_repo_id"
HAVING count(*) > 1;--> statement-breakpoint
DELETE FROM "radar_candidates" candidate
USING "_radar_identity_merge" merge
WHERE candidate."user_id" = merge."user_id"
  AND candidate."github_repo_id" = merge."github_repo_id"
  AND candidate."id" <> merge."keeper_id";--> statement-breakpoint
UPDATE "radar_candidates" candidate
SET
  "first_seen_at" = merge."first_seen_at",
  "status" = merge."status",
  "evidence" = candidate."evidence" || jsonb_build_object(
    'repositoryIdentityMerge',
    jsonb_build_object(
      'mergedCandidateIds', merge."merged_candidate_ids",
      'mergedFullNames', merge."merged_full_names"
    )
  ),
  "updated_at" = now()
FROM "_radar_identity_merge" merge
WHERE candidate."id" = merge."keeper_id";--> statement-breakpoint
DROP TABLE "_radar_identity_merge";--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_repository_identity_backfill_active_unique" ON "jobs" USING btree ("type") WHERE "jobs"."type" = 'repository.identity.backfill' AND "jobs"."status" IN ('queued', 'running', 'retry_wait');--> statement-breakpoint
CREATE UNIQUE INDEX "radar_candidates_user_github_repo_id_unique" ON "radar_candidates" USING btree ("user_id","github_repo_id") WHERE "radar_candidates"."github_repo_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_github_repository_id_unique" ON "repositories" USING btree ("github_repository_id") WHERE "repositories"."github_repository_id" IS NOT NULL;
