---
name: report-generate
description: 分析报告生成工具，基于仓库分析数据生成综合报告，支持多种报告类型和输出格式
user-invocable: true
argument-hint: "[--title <text>] [--type summary|detailed|comparison] [--format markdown|json|html]"
---

# report-generate

分析报告生成工具。

## 功能描述

基于仓库分析数据生成综合报告，支持：
- 多种报告类型（汇总、详细、对比）
- 多种输出格式（Markdown、JSON、HTML）
- 自动统计和排名

## 使用方式

### 管道模式（推荐）

```bash
npx tsx skills/repo-analyze/index.ts vercel/next.js | npx tsx skills/report-generate/index.ts --title "分析报告"
```

### 从文件读取

```bash
cat analysis.json | npx tsx skills/report-generate/index.ts --type detailed
```

### 完整管道组合

```bash
echo "vercel/next.js" \
  | npx tsx skills/repo-fetch/index.ts --include-issues \
  | npx tsx skills/repo-analyze/index.ts \
  | npx tsx skills/report-generate/index.ts --title "Next.js 分析报告" --type detailed
```

## 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--title <text>` | 报告标题 | "Open Source Analysis Report" |
| `--type <type>` | 报告类型 | summary |
| `--format <format>` | 输出格式 | markdown |

### 报告类型

| 类型 | 说明 |
|------|------|
| `summary` | 汇总报告，适合快速浏览 |
| `detailed` | 详细报告，包含完整分析内容 |
| `comparison` | 对比报告，适合多仓库比较 |

### 输出格式

| 格式 | 说明 |
|------|------|
| `markdown` | Markdown 格式（默认） |
| `json` | JSON 结构化格式 |
| `html` | HTML 格式 |

## 输入格式

stdin 接收 JSON 格式的分析结果数组：

```json
[
  {
    "healthScore": 85,
    "activityLevel": "high",
    "recommendation": "invest",
    "repository": { "fullName": "vercel/next.js" }
  }
]
```

## 输出格式

### Markdown 格式（默认）

```markdown
# Open Source Analysis Report

**生成时间**: 2024-01-15T12:00:00.000Z

---

# 执行摘要

本报告分析了 3 个开源仓库。整体表现良好，平均健康度为 78.5 分。

投资建议分布：
- 建议投资: 2 个
- 建议观望: 1 个
- 建议避免: 0 个

# 总体统计

总仓库数: 3
平均健康度: 78.5

# 仓库详情

- **vercel/next.js**: 评分 85, 活跃度 high, 建议 invest
- **facebook/react**: 评分 82, 活跃度 high, 建议 invest
- **vuejs/vue**: 评分 68, 活跃度 medium, 建议 watch

---

**元数据**
- 总仓库数: 3
- 平均健康度: 78.5
- 顶级仓库: vercel/next.js, facebook/react, vuejs/vue
```

### JSON 格式

```json
{
  "title": "Open Source Analysis Report",
  "type": "summary",
  "summary": "本报告分析了 3 个开源仓库...",
  "sections": [...],
  "generatedAt": "2024-01-15T12:00:00.000Z",
  "metadata": {
    "totalRepositories": 3,
    "topPerformers": ["vercel/next.js", "facebook/react"],
    "averageHealthScore": 78.5
  }
}
```

## 错误码

| 代码 | 说明 |
|------|------|
| 0 | 成功 |
| 1 | 输入无效 |

## 示例

### 生成汇总报告

```bash
cat analysis.json | npx tsx skills/report-generate/index.ts --title "Q1 开源生态报告"
```

### 生成详细报告

```bash
cat analysis.json | npx tsx skills/report-generate/index.ts --type detailed --title "详细分析报告"
```

### 生成对比报告

```bash
echo -e "vercel/next.js\nfacebook/react" \
  | npx tsx skills/repo-analyze/index.ts --batch \
  | npx tsx skills/report-generate/index.ts --type comparison --title "框架对比分析"
```

### 输出 JSON 格式

```bash
cat analysis.json | npx tsx skills/report-generate/index.ts --format json > report.json
```

### 完整工作流

```bash
cat repos.txt \
  | npx tsx skills/repo-fetch/index.ts --batch --include-issues \
  | npx tsx skills/repo-analyze/index.ts --batch \
  | npx tsx skills/report-generate/index.ts --title "开源生态月报" --type detailed \
  > monthly-report.md
```

## 相关 Skill

- [repo-fetch](../repo-fetch/SKILL.md) - 数据采集
- [repo-analyze](../repo-analyze/SKILL.md) - AI 健康度分析
