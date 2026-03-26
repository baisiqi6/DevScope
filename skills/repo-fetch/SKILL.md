---
name: repo-fetch
description: GitHub 仓库数据采集工具，从 GitHub API 获取仓库数据，支持基础信息、Issues、Commits
user-invocable: true
argument-hint: <owner/repo> [--include-issues] [--include-commits] [--batch]
---

# repo-fetch

GitHub 仓库数据采集工具。

## 功能描述

从 GitHub API 获取仓库数据，支持：
- 基础仓库信息（stars、forks、语言、许可证等）
- Issues 数据
- Commits 数据

## 使用方式

### 直接调用

```bash
repo-fetch <owner/repo> [options]
```

### 管道模式

```bash
echo "vercel/next.js" | repo-fetch --batch
```

### 批量模式

```bash
cat repos.txt | repo-fetch --batch --include-issues
```

## 选项

| 选项 | 说明 |
|------|------|
| `--include-issues` | 包含 Issues 数据（最近 10 条） |
| `--include-commits` | 包含 Commits 数据（最近 10 条） |
| `--batch` | 从 stdin 读取多个仓库标识符 |

## 输入格式

- **命令行**: `owner/repo` 格式的仓库标识符
- **stdin**: 每行一个 `owner/repo`

## 输出格式 (JSON)

```json
[
  {
    "repository": {
      "fullName": "vercel/next.js",
      "name": "next.js",
      "owner": "vercel",
      "description": "The React Framework",
      "url": "https://github.com/vercel/next.js",
      "stars": 120000,
      "forks": 25000,
      "openIssues": 1500,
      "language": "TypeScript",
      "license": "MIT",
      "createdAt": "2016-10-05T00:00:00Z",
      "updatedAt": "2024-01-15T00:00:00Z",
      "pushedAt": "2024-01-15T00:00:00Z"
    },
    "issues": [...],
    "commits": [...],
    "fetchedAt": "2024-01-15T12:00:00.000Z"
  }
]
```

## 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `GITHUB_TOKEN` | GitHub API Token | 可选 |

> 不提供 Token 时使用匿名请求，速率限制为 60 次/小时。提供 Token 后提升至 5000 次/小时。

## 错误码

| 代码 | 说明 |
|------|------|
| 0 | 成功 |
| 1 | 输入无效或 API 错误 |

## 示例

### 获取基础信息

```bash
npx tsx skills/repo-fetch/index.ts vercel/next.js
```

### 包含 Issues 和 Commits

```bash
npx tsx skills/repo-fetch/index.ts facebook/react --include-issues --include-commits
```

### 批量获取多个仓库

```bash
cat repos.txt | npx tsx skills/repo-fetch/index.ts --batch
```

### 管道组合

```bash
echo "vercel/next.js" | npx tsx skills/repo-fetch/index.ts --include-issues | npx tsx skills/repo-analyze/index.ts
```

## 相关 Skill

- [repo-analyze](../repo-analyze/SKILL.md) - AI 健康度分析
- [report-generate](../report-generate/SKILL.md) - 报告生成
