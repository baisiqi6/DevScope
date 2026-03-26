---
name: repo-analyze
description: GitHub 仓库 AI 健康度分析工具，使用 Claude AI 分析仓库健康度，生成结构化分析报告
user-invocable: true
argument-hint: <owner/repo> [--context <text>] [--batch]
---

# repo-analyze

GitHub 仓库 AI 健康度分析工具。

## 功能描述

使用 Claude AI 分析 GitHub 仓库的健康度，生成结构化分析报告，包括：
- 活跃度评估
- 健康度评分
- 关键指标分析
- 风险因素识别
- 机会因素发现
- 投资建议

## 使用方式

### 直接调用

```bash
npx tsx skills/repo-analyze/index.ts vercel/next.js
```

### 管道模式

```bash
echo "vercel/next.js" | npx tsx skills/repo-analyze/index.ts --batch
```

### 组合使用

```bash
# 与 repo-fetch 组合
npx tsx skills/repo-fetch/index.ts vercel/next.js --include-issues | npx tsx skills/repo-analyze/index.ts

# 完整分析流程
echo "vercel/next.js" \
  | npx tsx skills/repo-fetch/index.ts --include-issues --include-commits \
  | npx tsx skills/repo-analyze/index.ts
```

## 选项

| 选项 | 说明 |
|------|------|
| `--context <text>` | 提供额外上下文信息 |
| `--batch` | 从 stdin 读取多个仓库 |

## 输入格式

- **命令行**: `owner/repo` 格式的仓库标识符
- **stdin**: 每行一个 `owner/repo`，或 JSON 格式的 repo-fetch 输出

## 输出格式 (JSON)

```json
[
  {
    "healthScore": 85,
    "activityLevel": "high",
    "keyMetrics": {
      "starsGrowthRate": 5.2,
      "issueResolutionRate": 78.5,
      "contributorDiversityScore": 72.0
    },
    "riskFactors": [
      {
        "category": "维护风险",
        "description": "核心贡献者较少",
        "severity": 3
      }
    ],
    "opportunities": [
      {
        "category": "增长机会",
        "description": "社区活跃度高",
        "potential": 8
      }
    ],
    "recommendation": "invest",
    "summary": "该项目保持高度活跃，社区健康..."
  }
]
```

## 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Claude API Key | **必需** |

## 错误码

| 代码 | 说明 |
|------|------|
| 0 | 成功 |
| 1 | 输入无效或 API 错误 |

## 分析维度

### 1. 活跃度评估 (activityLevel)

| 级别 | 说明 |
|------|------|
| `high` | 高度活跃，频繁提交和发布 |
| `medium` | 中等活跃，定期维护 |
| `low` | 低活跃，更新缓慢 |
| `dead` | 已停止维护 |

### 2. 健康度评分 (healthScore)

- 范围: 0-100
- 综合考虑：活跃度、社区、代码质量、文档等

### 3. 投资建议 (recommendation)

| 建议 | 说明 |
|------|------|
| `invest` | 建议投资/采用 |
| `watch` | 建议观望 |
| `avoid` | 建议避免 |

## 示例

### 单仓库分析

```bash
npx tsx skills/repo-analyze/index.ts vercel/next.js
```

### 带上下文分析

```bash
npx tsx skills/repo-analyze/index.ts vercel/next.js --context "关注 Next.js 15 的性能改进和 Turbopack 稳定性"
```

### 批量分析

```bash
cat repos.txt | npx tsx skills/repo-analyze/index.ts --batch
```

### 完整管道组合

```bash
echo "vercel/next.js" \
  | npx tsx skills/repo-fetch/index.ts --include-issues --include-commits \
  | npx tsx skills/repo-analyze/index.ts \
  | npx tsx skills/report-generate/index.ts --title "Next.js 分析报告"
```

## 相关 Skill

- [repo-fetch](../repo-fetch/SKILL.md) - 数据采集
- [report-generate](../report-generate/SKILL.md) - 报告生成
