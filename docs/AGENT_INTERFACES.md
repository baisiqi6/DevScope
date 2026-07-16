# Agent 调用接口

DevScope 提供统一 API Client、`devscope` CLI 和 MCP stdio Server。CLI 与 MCP 都是现有 API 的薄适配层，不直接连接 PostgreSQL、GitHub、embedding 服务或 AI Provider。

## 当前边界

- 当前仍是单用户私有版；tRPC 路由中的 `publicProcedure` 不代表适合公开匿名访问。
- 本地开发默认直接访问 `http://localhost:3100`。
- 生产环境仍由 Nginx Basic Auth 保护；CLI/MCP 只是转发对应请求头，不是应用内账号系统。
- Basic Auth 只允许发送到 `https://` 或本机回环地址；公网 `http://` 会被 Client 拒绝，避免密码明文经过网络。
- 不支持 `--password` 参数，避免密码出现在 shell history 或进程列表。
- 技术雷达发现任务使用 PostgreSQL 持久队列与独立 Worker；现有仓库采集和向量化路径仍由 API 调度，不应把二者混为同一可靠性等级。

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
devscope repo collect vercel/next.js
devscope repo collect vercel/next.js --wait --timeout-ms 300000
devscope repo collect vercel/next.js --skip-embeddings
devscope repo embedding-status 1
devscope search vercel/next.js "如何部署" --limit 5
devscope search vercel/next.js "如何部署" --no-answer
devscope group list
```

正常结果以 JSON 写入 stdout。错误以 JSON 写入 stderr：

- `0`：成功；
- `1`：连接、API、校验或业务执行失败；
- `2`：命令或参数错误。

`repo collect --wait` 会轮询向量化状态，默认间隔 `1000ms`、超时 `300000ms`。`--skip-embeddings` 与 `--wait` 不能同时使用。

## MCP Server

### 工具列表

| 工具名称                        | 行为      | 说明                         |
| ------------------------------- | --------- | ---------------------------- |
| `devscope_health`               | 只读      | 检查 API 状态                |
| `devscope_list_repositories`    | 只读      | 列出已采集仓库               |
| `devscope_get_repository`       | 只读      | 读取仓库详情                 |
| `devscope_collect_repository`   | 写入/外部 | 采集 GitHub 数据并写入数据库 |
| `devscope_get_embedding_status` | 只读      | 查询向量化进度               |
| `devscope_semantic_search`      | 只读      | 搜索仓库内容，可生成 AI 回答 |
| `devscope_list_groups`          | 只读      | 列出当前用户的仓库分组       |

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

技术雷达的 `jobs` 与 `radar_candidates` 当前是内部执行基础，尚未暴露 CLI/MCP 工具。
后续增加 `radar run/status/candidates/feedback/digest` 时仍应先建立按 `userId` 隔离的
API 契约，再映射到 Client、CLI 和 MCP。
