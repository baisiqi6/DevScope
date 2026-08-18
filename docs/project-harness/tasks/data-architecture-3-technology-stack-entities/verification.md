# 技术栈实体分离验证

## 生产只读基线

2026-08-18 在 `main@de3b91722d0b9b120bd6ae7308bbf92af5dc0bdf` 部署后读取生产 PostgreSQL：

- 50 个 repository rows，其中 40 个真实仓库、10 个 `tech-stack/*` reference rows；
- 50 条 watched relations，其中 40 条指向真实仓库、10 条是技术栈伪收藏；
- reference group members 为 0；
- 37 条 dependency edges，其中 34 条指向技术栈 reference，3 条连接真实仓库；
- 34 条技术栈边全部为 `resolvedBy=tech-stack-catalog` 且 packages 为数组，共 203 条包/版本 evidence；
- 10 条技术栈伪收藏均有对应 dependency edge，没有 orphan reference watch。

具体节点为 Axum、Express、FastAPI、Next.js、React、React Native、Svelte、Tauri、Vite、Vue。Spring Boot 是目录支持并需要回归测试的产品语义，但当前生产 SBOM 没有形成该节点，不能伪造为迁移基线。

以上数字是本轮迁移输入的日期化证据，不是长期固定验收常量。实现、隔离 PostgreSQL 演练、PR/CI、分阶段部署和生产 closeout 尚未开始。
