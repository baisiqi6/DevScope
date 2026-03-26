// 在浏览器 Console 中执行此脚本，批量更新所有仓库的向量化状态
// 这会调用 API 将已向量化的仓库标记为完成

(async function syncEmbeddingStatus() {
  console.log('开始同步向量化状态...');

  // 获取所有仓库
  const reposResponse = await fetch('/api/trpc/getRepositories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const reposData = await reposResponse.json();
  const repos = reposData.result.data;

  console.log(`找到 ${repos.length} 个仓库`);

  let completedCount = 0;
  let pendingCount = 0;

  for (const repo of repos) {
    const statusResponse = await fetch('/api/trpc/getEmbeddingStatus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoId: repo.id })
    });
    const statusData = await statusResponse.json();
    const status = statusData.result.data;

    if (status) {
      if (status.status === 'completed') {
        completedCount++;
        console.log(`✓ ${repo.fullName}: 已完成 (${status.progress}%)`);
      } else if (status.status === 'pending') {
        pendingCount++;
        console.log(`○ ${repo.fullName}: 待处理 (进度: ${status.progress}%)`);
      } else {
        console.log(`⚠ ${repo.fullName}: ${status.status} (${status.progress}%)`);
      }
    }
  }

  console.log(`\n总结:`);
  console.log(`已完成: ${completedCount}`);
  console.log(`待处理: ${pendingCount}`);
  console.log(`\n注意：待处理的仓库需要在数据库中手动更新状态，或重新运行向量化。`);
})();
