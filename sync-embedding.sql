-- 同步向量化状态 SQL 脚本
-- 这个脚本会检查 repo_chunks 表中已有的 embedding 数据，并更新 repositories 表的状态

-- 1. 首先查看当前状态
SELECT
  r.id,
  r.full_name,
  r.embedding_status,
  r.embedding_progress,
  r.embedding_total_chunks,
  r.embedding_completed_chunks,
  chunks.total_chunks,
  chunks.with_embedding
FROM repositories r
LEFT JOIN (
  SELECT
    repo_id,
    COUNT(*) as total_chunks,
  COUNT(embedding) as with_embedding
  FROM repo_chunks
  GROUP BY repo_id
) chunks ON r.id = chunks.repo_id
ORDER BY r.id
LIMIT 20;

-- 2. 更新所有 chunks 都有 embedding 的仓库为 completed 状态
UPDATE repositories
SET
  embedding_status = 'completed',
  embedding_progress = 100,
  embedding_total_chunks = subq.total_chunks,
  embedding_completed_chunks = subq.with_embedding,
  embedding_completed_at = NOW(),
  embedding_error = NULL
FROM (
  SELECT
    repo_id,
    COUNT(*) as total_chunks,
    COUNT(embedding) as with_embedding
  FROM repo_chunks
  GROUP BY repo_id
  HAVING COUNT(*) = COUNT(embedding)  -- 所有 chunks 都有 embedding
) subq
WHERE repositories.id = subq.repo_id
  AND repositories.embedding_status != 'completed';

-- 3. 更新部分有 embedding 的仓库为 processing 状态
UPDATE repositories
SET
  embedding_status = 'processing',
  embedding_progress = FLOOR(subq.with_embedding::float / subq.total_chunks * 100),
  embedding_total_chunks = subq.total_chunks,
  embedding_completed_chunks = subq.with_embedding
FROM (
  SELECT
    repo_id,
    COUNT(*) as total_chunks,
    COUNT(embedding) as with_embedding
  FROM repo_chunks
  GROUP BY repo_id
  HAVING COUNT(embedding) > 0  -- 至少有一个 embedding
    AND COUNT(*) > COUNT(embedding)  -- 但不是全部
) subq
WHERE repositories.id = subq.repo_id
  AND repositories.embedding_status = 'pending';

-- 4. 更新没有 embedding 但有 chunks 的仓库的总数
UPDATE repositories
SET
  embedding_total_chunks = subq.total_chunks
FROM (
  SELECT
    repo_id,
    COUNT(*) as total_chunks
  FROM repo_chunks
  GROUP BY repo_id
) subq
WHERE repositories.id = subq.repo_id
  AND repositories.embedding_total_chunks = 0;

-- 5. 验证更新结果
SELECT
  r.id,
  r.full_name,
  r.embedding_status,
  r.embedding_progress,
  r.embedding_total_chunks,
  r.embedding_completed_chunks,
  CASE
    WHEN chunks.total_chunks IS NULL THEN '无 chunks'
    WHEN chunks.with_embedding = chunks.total_chunks THEN '✓ 全部完成'
    WHEN chunks.with_embedding > 0 THEN '⚠ 部分完成'
    ELSE '○ 未开始'
  END as status_note
FROM repositories r
LEFT JOIN (
  SELECT
    repo_id,
    COUNT(*) as total_chunks,
    COUNT(embedding) as with_embedding
  FROM repo_chunks
  GROUP BY repo_id
) chunks ON r.id = chunks.repo_id
ORDER BY r.id
LIMIT 20;
