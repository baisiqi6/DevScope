/**
 * @package @devscope/db
 * @description 同步向量化状态
 *
 * 检查 repo_chunks 表中已有的 embedding 数据，更新 repositories 表的状态字段
 */

import { createDb, reconcileRepositoryEmbeddingStatus, repositories } from "./index";
import { eq } from "drizzle-orm";

/**
 * 同步指定仓库的向量化状态
 * 根据 repo_chunks 表中已有的 embedding 数据更新 repositories 表
 */
export async function syncEmbeddingStatus(repoId: number) {
  const db = createDb();

  const repoList = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
    })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);

  const repo = repoList[0];
  if (!repo) {
    console.log(`Repository ${repoId} not found`);
    return;
  }

  const result = await reconcileRepositoryEmbeddingStatus(db, repoId);
  console.log(`\n=== ${repo.fullName} (${repoId}) ===`);
  console.log(`${result.status}: ${result.completedChunks}/${result.totalChunks}, changed=${result.changed}`);
  return result;
}

/**
 * 同步所有仓库的向量化状态
 */
export async function syncAllEmbeddingStatus() {
  const db = createDb();

  // 获取所有仓库
  const allRepos = await db
    .select({
      id: repositories.id,
      fullName: repositories.fullName,
    })
    .from(repositories);

  console.log(`Found ${allRepos.length} repositories\n`);

  let updatedCount = 0;
  let completedCount = 0;

  for (const repo of allRepos) {
    const result = await reconcileRepositoryEmbeddingStatus(db, repo.id);
    if (result.changed) updatedCount++;
    if (result.status === "completed") completedCount++;
    console.log(`✓ ${repo.fullName}: ${result.status} (${result.completedChunks}/${result.totalChunks})`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total repositories: ${allRepos.length}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Completed: ${completedCount}`);
}

// CLI 运行
if (require.main === module) {
  const args = process.argv.slice(2);
  const repoId = args[0] ? parseInt(args[0], 10) : null;

  (async () => {
    if (repoId) {
      await syncEmbeddingStatus(repoId);
    } else {
      await syncAllEmbeddingStatus();
    }
    process.exit(0);
  })();
}
