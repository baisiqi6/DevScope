# Agent 调用接口

DevScope 提供统一 API Client、`devscope` CLI 和 MCP stdio Server。CLI 与 MCP 都是现有 API 的薄适配层，不直接连接 PostgreSQL、GitHub、embedding 服务或 AI Provider。

本文只维护 Agent 接口契约和连接方式。项目范围与鉴权边界以 [Harness scope](project-harness/scope.md) 为准，生产访问控制和隧道操作以 [运行手册](project-harness/runbook.md) 为准。

## 当前边界

- 当前仍是单用户私有版；tRPC 路由中的 `publicProcedure` 不代表适合公开匿名访问。
- 本地开发默认直接访问 `http://localhost:3100`。
- 生产环境仍由 Nginx Basic Auth 保护；CLI/MCP 只是转发对应请求头，不是应用内账号系统。
- Basic Auth 只允许发送到 `https://` 或本机回环地址；公网 `http://` 会被 Client 拒绝，避免密码明文经过网络。
- 不支持 `--password` 参数，避免密码出现在 shell history 或进程列表。
- 健康分析、图谱重建和技术雷达发现任务使用 PostgreSQL 持久队列与独立 Worker；现有仓库采集和向量化路径仍由 API 调度，不应把二者混为同一可靠性等级。

## 连接配置

| 环境变量            | 必需性 | 说明                                               |
| ------------------- | ------ | -------------------------------------------------- |
| `DEVSCOPE_BASE_URL` | 可选   | API 或反向代理根地址，默认 `http://localhost:3100` |
| `DEVSCOPE_USERNAME` | 成对   | Nginx Basic Auth 用户名                            |
| `DEVSCOPE_PASSWORD` | 成对   | Nginx Basic Auth 密码                              |

用户名和密码必须同时设置。它们从调用进程环境读取，不会自动从项目 `.env` 加载。远程访问必须使用 HTTPS；尚未配置 HTTPS 时，应先通过 SSH tunnel 映射到本机回环地址。

本地示例：

```bash
export DEVSCOPE_BASE_URL=http://localhost:3100
```

受保护环境示例：

```bash
export DEVSCOPE_BASE_URL=https://devscope.example.com
export DEVSCOPE_USERNAME='your-username'
export DEVSCOPE_PASSWORD='your-password'
```

不要把真实凭据写进仓库、共享脚本或 MCP 配置模板。实际使用时优先由密码管理器、系统服务或 Agent Host 的密钥配置注入。

## CLI

### 本地运行

```bash
pnpm install
pnpm build
node apps/cli/dist/index.js --help
```

如果希望在本机以 `devscope` 命令调用，可在构建后链接 workspace 包：

```bash
pnpm --dir apps/cli link --global
devscope --help
```

### 命令

```bash
devscope health
devscope repo list --limit 20 --offset 0
devscope repo get 1
devscope repo delete-impact 1
devscope repo archive 1
devscope repo unarchive 1   # 需要从 list/delete-impact 记录 repo-id
devscope repo delete 1 --confirm
devscope repo collect vercel/next.js
devscope repo collect vercel/next.js --wait --timeout-ms 300000
devscope repo collect vercel/next.js --skip-embeddings
devscope repo embedding-status 1
devscope repo note 1 "重要项目"
devscope search vercel/next.js "如何部署" --limit 5
devscope search vercel/next.js "如何部署" --no-answer
devscope group list
devscope group tree
devscope group create "前端框架" --description "前端相关仓库"
devscope group create "Vue 生态" --parent-id 1
devscope group update 1 --name "前端框架" --description "前端相关仓库" --color blue --icon folder
devscope group delete 1 --confirm
devscope group members 1
devscope group aggregate-members 1
devscope group move 2 1
devscope group move 2 root
devscope group reorder 1 4 3 2
devscope group reorder root 5 1
devscope group add 1 5
devscope group remove 1 5
devscope resource list [--type article|paper|website]
devscope resource save https://example.com --type website --title "示例网站" --tags ui,素材
devscope resource get 1
devscope resource update 1 --read --pin
devscope resource remove 1
devscope resource content-request 1
devscope resource content-status 1
devscope resource content-read 1
devscope resource-group list
devscope resource-group create "UI 素材"
devscope resource-group members 1
devscope resource-group add 1 1
devscope resource-group remove 1 1
devscope analyze start vercel/next.js
devscope analyze status <execution-id>
devscope analyze report <execution-id>
devscope analyze report <execution-id> --wait --timeout-ms 300000
```

正常结果以 JSON 写入 stdout。错误以 JSON 写入 stderr：

- `0`：成功；
- `1`：连接、API、校验或业务执行失败；
- `2`：命令或参数错误。

`repo collect --wait` 会轮询向量化状态，默认间隔 `1000ms`、超时 `300000ms`。`--skip-embeddings` 与 `--wait` 不能同时使用。

`analyze report --wait` 会轮询分析执行状态直到完成或失败，默认间隔 `1000ms`、超时 `300000ms`。

`group delete` 是 destructive 操作，必须显式传入 `--confirm`；含子分组的目标会被 API 拒绝。
`group update` 至少传入一个可更新字段（`--name`、`--description`、`--color` 或 `--icon`）。

## MCP Server

### 工具列表

| 工具名称                               | 行为      | 说明                             |
| -------------------------------------- | --------- | -------------------------------- |
| `devscope_health`                      | 只读      | 检查 API 状态                    |
| `devscope_list_repositories`           | 只读      | 列出已采集仓库                   |
| `devscope_get_repository`              | 只读      | 读取仓库详情                     |
| `devscope_get_repository_delete_impact` | 只读     | 预览删除影响（含技术栈关系）     |
| `devscope_archive_repository`          | 写入      | 归档当前用户的仓库收藏           |
| `devscope_unarchive_repository`        | 写入      | 按 repoId 恢复归档仓库           |
| `devscope_delete_repository`           | 破坏性写入 | 需 `confirm=true` 的永久删除     |
| `devscope_collect_repository`          | 写入/外部 | 采集 GitHub 数据并写入数据库     |
| `devscope_get_embedding_status`        | 只读      | 查询向量化进度                   |
| `devscope_semantic_search`             | 只读      | 搜索仓库内容，可生成 AI 回答     |
| `devscope_list_groups`                 | 只读      | 列出当前用户的仓库分组           |
| `devscope_get_group_tree`              | 只读      | 读取单父级分组树与聚合计数       |
| `devscope_update_repo_note`            | 写入      | 更新仓库备注                     |
| `devscope_get_group_members`           | 只读      | 读取分组成员及关联仓库           |
| `devscope_get_aggregate_group_members` | 只读      | 读取分组及后代仓库与直接归属来源 |
| `devscope_create_group`                | 写入      | 创建仓库分组                     |
| `devscope_update_group`                | 写入      | 更新分组名称、样式和说明         |
| `devscope_delete_group`               | 破坏性写入 | 需 `confirm=true`，仅允许叶子组   |
| `devscope_move_group`                  | 写入      | 移动分组到父级或根级             |
| `devscope_reorder_group_siblings`      | 写入      | 按完整 ID 排列事务化重排同级分组 |
| `devscope_add_repo_to_group`           | 写入      | 添加仓库到分组                   |
| `devscope_remove_repo_from_group`      | 写入      | 从分组移除仓库                   |
| `devscope_list_external_resources`     | 只读      | 列出文章、论文和网站预览卡片     |
| `devscope_save_external_resource`      | 写入      | 保存外部资源 URL（当前 `preview_only`） |
| `devscope_get_external_resource`       | 只读      | 读取外部资源预览卡片             |
| `devscope_update_external_resource`    | 写入      | 更新外部资源备注、标签和阅读状态 |
| `devscope_remove_external_resource`    | 写入      | 删除外部资源                     |
| `devscope_request_external_resource_content` | 写入/外部 | 显式异步请求采集外部资源正文 |
| `devscope_get_external_resource_content_status` | 只读 | 查询正文采集状态与脱敏错误 |
| `devscope_read_external_resource_content` | 只读 | 读取已完成的 HTML/PDF 正文 |
| `devscope_list_external_resource_groups` | 只读    | 列出外部资源专用分组             |
| `devscope_create_external_resource_group` | 写入    | 创建外部资源专用分组             |
| `devscope_get_external_resource_group_members` | 只读 | 读取外部资源分组成员      |
| `devscope_add_external_resource_to_group` | 写入   | 添加外部资源到专用分组           |
| `devscope_remove_external_resource_from_group` | 写入 | 从专用分组移除外部资源    |
| `devscope_start_health_analysis`       | 写入/外部 | 启动后台 Agent 健康度分析        |
| `devscope_get_analysis_status`         | 只读      | 查询分析执行状态                 |
| `devscope_get_health_report`           | 只读      | 获取健康度报告                   |

### 本地 MCP 配置

先运行 `pnpm build`，再让 MCP Host 通过 Node.js 启动构建产物。以下是通用配置结构；把路径和环境值替换为实际内容：

```json
{
  "mcpServers": {
    "devscope": {
      "command": "node",
      "args": ["/absolute/path/to/DevScope/apps/mcp/dist/index.js"],
      "env": {
        "DEVSCOPE_BASE_URL": "http://localhost:3100"
      }
    }
  }
}
```

连接受保护环境时由 MCP Host 安全注入 `DEVSCOPE_USERNAME` 与 `DEVSCOPE_PASSWORD`。MCP 使用 stdio 传输，stdout 只能承载协议消息；启动失败信息写入 stderr。

## 开发与验证

```bash
pnpm --filter @devscope/client typecheck
pnpm --filter @devscope/client test
pnpm --filter @devscope/cli test
pnpm --filter @devscope/mcp test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

新增 Agent 能力时，先在 API 中建立经过 Zod 校验的稳定业务接口，再扩展 `packages/client` facade，最后分别映射到 CLI 命令和 MCP tool。不要让 CLI/MCP 形成第二套业务逻辑或数据访问模型。

旧的原始 tRPC mutation `groups.reorder` 现按根级同级重排处理，并要求提交完整、无重复的根分组
ID 集合；原先只提交部分 ID 的请求会明确失败。新调用方应使用 `groups.reorderSiblings`（Client、
CLI 与 MCP 已统一映射到该契约），不要依赖旧的部分重排行为。

技术雷达的 `jobs` 与 `radar_candidates` 当前是内部执行基础，尚未暴露 CLI/MCP 工具。
后续增加 `radar run/status/candidates/feedback/digest` 时仍应先建立按 `userId` 隔离的
API 契约，再映射到 Client、CLI 和 MCP。
