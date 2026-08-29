# DevScope 数据领域模型与演进约束

本文是数据库实体边界、已确认数据风险、目标模型和迁移验收条件的唯一事实来源。当前执行状态与依赖顺序只维护在 [Harness checklist](harness-checklist.json)，基线验证结果只维护在 [progress.md](progress.md)，具体实施步骤只维护在对应任务的 `tasks/<item-id>/plan.md`。

## 一、整改范围

当前生产数据整体健康，显式迁移、用户仓库关系、持久任务和 Trending 快照已经形成可继续演进的基础。整改的目标是消除已有证据支持的近期隐患，而不是重写系统。

### 本轮目标

1. 用 GitHub 稳定 ID 识别仓库，正确处理改名和转移；
2. 消除 GitHub Release ID 的 32 位容量风险；
3. 使 chunks、Hacker News 和 Releases 的重采集具备原子性与清晰的空结果语义；
4. 将技术栈节点从伪仓库和伪收藏关系中分离；
5. 区分 deps.dev 的真阴性与临时失败，使失败可恢复；
6. 为迁移、约束、事务和并发建立真实 PostgreSQL 测试门禁；
7. 保留明确 `userId` 边界，但不在本轮提前实现公开多用户产品。

### 非目标

本轮不引入 CQRS、事件溯源、图数据库、第二套任务队列、通用 Repository 框架或插件系统。PostgreSQL、Drizzle、现有 `jobs` 与直接的领域函数足以解决已确认问题。

暂不为当前向量检索强行引入 HNSW。生产最大仓库的 2736 个 chunks 执行 Top-5 查询约为 28 ms；应在出现全局检索或实际延迟证据后再设计索引。

## 二、已确认的 Correctness 风险

详细基线数字和验证日期见 [progress.md](progress.md)。这里仅保留仍影响设计决策的风险事实：

| 编号 | 问题                                   | 当前证据                                                           | 等级     |
| ---- | -------------------------------------- | ------------------------------------------------------------------ | -------- |
| C1   | 仓库只按 `fullName` 识别               | 生产同一 `github_repo_id=1319855210` 已有两个改名前后的 Radar 候选 | 立即处理 |
| C2   | `releases.id` 使用 signed `int4`       | 生产最大 ID 为 1761925622，已占上限 82.0%                          | 立即处理 |
| C3   | 子数据先删后插不在事务中               | 失败可以留下空集或半份数据；多进程也可以互相覆盖                   | 立即处理 |
| C4   | 成功空结果不会清除旧数据               | 当 chunks、HN 或 Releases 返回空数组时，当前路径跳过删除           | 立即处理 |
| C5   | deps.dev 临时失败与真无映射共用 `null` | 生产 12971 条缓存中有 302 条 `source_repo=null`，且无 TTL          | 紧随处理 |

## 三、目标数据边界

整改后仍保持现有包职责，不新建第二套数据模型：

```text
GitHub 稳定身份
  → repositories（全局真实仓库）
  → user_watched_repositories（用户关注、备注、分析设置）

仓库采集结果
  → 网络拉取与转换在事务外完成
  → 最终验证通过后，在短事务中整体替换子数据

SBOM + 技术栈目录
  → technology_stacks
  → repository_technology_stacks（包、版本和解析证据）

仓库之间的关系
  → repo_relationships（相似度和真实仓库依赖）

外部资源（第一阶段）
  → external_resources（文章、论文和网站的预览元数据）
  → external_resource_saves（用户备注、标签、已读与置顶）
  → external_resource_groups / external_resource_group_members（独立资源分组）

用户仓库整理
  → repository_groups（单父级邻接树）
  → group_members（仓库的直接、多分组归属）
```

外部资源与 GitHub 仓库暂时分别管理，不把 URL 伪装成仓库，也不将现有
`group_members` 改造成多态关系。第一阶段所有外部资源保存都使用 `preview_only`，
`content` 模式仅作为未来正文采集的状态预留，不得在本阶段触发网络抓取或 embedding。

语言节点继续由查询时合成，不新增语言表。不建立通用多态 `graph_nodes` 表；当前只有真实仓库和技术栈两种持久化实体，分表更直接。

## 四、整改设计与验收

### 稳定 GitHub 身份与 ID 容量

#### 1A. GitHub Release ID

最小修改：

1. 将 `releases.id` 从 `integer` 改为 `bigint`，Drizzle 使用不丢精度的映射；
2. 删除字符串 ID 的截断/哈希降级，只接受可无损转换的 GitHub ID；
3. 包内使用原生 `bigint`，跨 tRPC/JSON 边界输出正十进制字符串，调用方不得再假定 Release ID 是 JavaScript `number`；
4. 迁移前记录 `min/max/count`，迁移后逐项比对；
5. 增加超过 `2147483647` 的回归测试。

验收：以生产迁移前即时记录的 Releases 行集为基线，行数、ID、仓库归属与 API 输出均不变；大 ID 可正常插入和读取。固定行数只能作为日期化证据，不作为长期验收常量。

#### 1B. GitHub Repository ID

最小模型：

- `repositories.github_repository_id text null`；
- 对非空值建立全局唯一索引；
- Radar 对非空 ID 使用 `(user_id, github_repo_id)` 唯一；
- 只在数据源缺失 ID 时回退到标准化 `fullName`。

迁移分两步：

1. 先添加可空列、部分唯一索引和双读兼容代码；
2. 通过可审计回填任务从 GitHub API 补齐 ID，校验后再切换 upsert 冲突目标。

迁移不在 SQL 中访问外网。改名重复合并必须保留用户已选状态、最早 `firstSeenAt`、最新 GitHub 名称和可解释证据；无法自动确定的冲突停止迁移并输出待审查清单。

验收：用同一 GitHub ID 的旧名和新名各同步一次，数据库始终只有一个实体，用户状态不丢失。

### 单父级仓库分组树

`repository_groups.parent_id` 表示同一用户内的可空父级：`null` 是根级，一个分组最多一个父级，
不支持多父级 DAG。`group_members` 仍只保存仓库的直接归属，同一仓库可以直接属于多个分组；
父级看到的后代仓库合集是查询结果，不写入派生成员。

数据库约束是层级正确性的最终边界：

- `(id, user_id)` 唯一键与 `(parent_id, user_id) -> (id, user_id)` 组合外键拒绝跨用户父子关系，
  `ON DELETE RESTRICT` 阻止删除仍有子组的分组；
- 层级写入先取得按 `userId` 的 transaction advisory lock，再由递归 CTE trigger 拒绝自循环与
  后代循环，避免两个连接并发形成循环；
- `(user_id, parent_id, order_index)` 定义同级顺序。重排必须在一个事务内提交该父级下完整、
  无重复的 ID 排列，不对跨父级节点做隐式移动。

读取契约区分直接与聚合语义：兼容字段 `repoCount` 继续表示直接成员数，`directRepoCount` 与其
一致；`aggregateRepoCount` 是自身及全部后代中、当前用户仍关注可见的仓库去重数，与聚合
成员列表使用同一可见性口径。聚合成员必须同时返回每个仓库的真实直接 membership 来源，任何
移除操作都作用于该来源，而不是父级查询视图。

迁移 `0011_violet_hammerhead.sql` 只为既有行增加可空父级和约束，因此旧分组自然保持根级，
`group_members` 不变。受保护回滚只允许在所有 `parent_id` 均为空时执行，禁止静默丢失层级。

### 采集结果原子替换

网络请求、分块、embedding 计算和结构验证都在事务外完成。只有最终的“删除旧行 + 插入新行 + 更新状态”位于同一个短事务。

每个来源必须区分两类结果：

- `success(items)`：即使 `items=[]` 也是有效快照，应清除旧数据；
- `failure(error)`：保留上一份成功数据，记录失败，不执行替换。

并发控制不再只依赖 API 进程内 `Set`。首选复用现有持久 `jobs` 与仓库稳定 ID 构造幂等键；如果本阶段暂不迁移采集入 Worker，则使用 PostgreSQL advisory lock 作为最小跨进程保护，不新建队列。

验收：

- 任意一次插入失败后，上一份快照仍完整可读；
- 成功空结果能清除过时行；
- 两个并发采集不产生交叉快照、重复行或错误 embedding 状态；
- 事务内不包含 GitHub、HN、deps.dev 或 embedding 网络等待。

### 技术栈节点脱离仓库收藏

新增两个直接领域表：

- `technology_stacks`：`id`、稳定 `slug`、`name`、`url`、`description`、时间字段；
- `repository_technology_stacks`：`repository_id`、`technology_stack_id`、包/版本证据与更新时间，以两个 ID 建立唯一约束。

迁移顺序：

1. 从 `repositories.is_reference=true` 回填技术栈和当前 dependency evidence；
2. 图查询在一个过渡批次内同时验证新旧结果节点/边数与语义；
3. 切换为新表后，删除 reference 的伪 `user_watched_repositories` 关系；
4. 确认无其他读路径后，再移除 `repositories.is_reference` 和对应伪仓库行。

验收：仓库列表中只存在真实 GitHub 仓库；用户收藏数等于真实关注数；图中 Vue、React、Spring Boot 等技术栈节点和边保持完整。

### deps.dev 映射缓存可恢复化

`package_repo_mappings` 增加最小必要状态：

- `resolution_status`：`resolved | not_found | error`；
- `retry_after`：只对可重试结果生效；
- `last_error`：只保留简短、可脱敏的错误摘要；
- `fetched_at`：继续作为证据时间。

`not_found` 使用较长 TTL 后复查，`error` 使用短退避并可重试，`resolved` 只在到期或规范名称校正时更新。不再把网络异常写成永久无映射。

验收：模拟超时后首次记录 `error`，到达 `retry_after` 后能重试并转为 `resolved`；真无映射不会在每次图重建时请求外部 API。

### 真实 PostgreSQL 集成门禁

在保留现有快速单元测试的同时，增加独立 `test:integration`。使用临时数据库或 CI PostgreSQL service，不连接本地开发库和生产库。具体容器工具在实现时选择，本文档不预先锁定新框架。

最低覆盖：

1. 空库从 `0000` 迁移到最新版；
2. 具有历史数据的 `0004` 基线升级；
3. GitHub 仓库改名去重和 Release 大 ID；
4. chunks/HN/releases 替换回滚、成功空结果和并发竞争；
5. 技术栈节点回填与边一致性；
6. deps.dev 状态与 TTL 转移；
7. jobs 的 `FOR UPDATE SKIP LOCKED`、租约与恢复。

### 公开多用户加固（独立里程碑）

只在用户决定开放他人访问时启动：

- 使用经过验证的会话身份取代“首个用户”；
- 全路由授权审计与多用户数据演练；
- 用户删除、级联策略和 workflow report/execution 复合归属约束；
- 根据威胁模型评估 RLS，不把 RLS 当作应用授权的替代品；
- 配额、限流、审计和任务运行历史。

## 五、执行边界

整改项的依赖、优先级与当前状态只维护在 [Harness checklist](harness-checklist.json)。具体任务的实施步骤只写入该 item 的 canonical plan；生产备份、迁移、验证和回滚操作只遵循 [运行手册](runbook.md)。

任何无法自动确认的数据冲突都必须 fail closed 并输出可审查清单。数据设计文档不授予生产写入、部署或删除权限。
