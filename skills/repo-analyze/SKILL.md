---
name: repo-analyze
description: GitHub 仓库 AI 健康度分析工具，使用已配置的 AI provider 生成结构化分析结果
user-invocable: true
argument-hint: <owner/repo> [--context <text>] [--batch]
---

# repo-analyze

使用项目已配置的 AI provider 分析 GitHub 仓库健康度，输出经过 Zod 校验的 JSON 结果。

## 分析内容

- 活跃度与健康度评分
- 关键指标
- 风险与机会
- `invest` / `watch` / `avoid` 建议
- 中文总结

## 使用方式

单个仓库：

```bash
npx tsx skills/repo-analyze/index.ts vercel/next.js
```

附加上下文：

```bash
npx tsx skills/repo-analyze/index.ts vercel/next.js \
  --context "关注 Next.js 15、Turbopack 和维护活跃度"
```

批量输入：

```bash
printf '%s\n' vercel/next.js facebook/react \
  | npx tsx skills/repo-analyze/index.ts --batch
```

当前批量 stdin 格式是每行一个 `owner/repo`，不能直接接收 `repo-fetch` 输出的 JSON。

## 选项

| 选项               | 说明                       |
| ------------------ | -------------------------- |
| `--context <text>` | 为所有待分析仓库补充上下文 |
| `--batch`          | 从 stdin 读取仓库列表      |

## 环境变量

提供下列任一组配置：

| Provider          | 环境变量                                                        |
| ----------------- | --------------------------------------------------------------- |
| DeepSeek          | `DEEPSEEK_API_KEY`、可选 `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` |
| OpenAI-compatible | `OPENAI_COMPATIBLE_API_KEY`、可选 `OPENAI_COMPATIBLE_BASE_URL`  |

未提供上述任一组 API Key 时，工具会明确报错并退出。

## 输出

成功时向 stdout 输出 JSON 数组：

```json
[
  {
    "repo": "vercel/next.js",
    "healthScore": 85,
    "activityLevel": "high",
    "keyMetrics": {
      "starsGrowthRate": 5.2,
      "issueResolutionRate": 78.5,
      "contributorDiversityScore": 72
    },
    "riskFactors": [],
    "opportunities": [],
    "recommendation": "invest",
    "summary": "项目保持活跃，社区与维护状态良好。"
  }
]
```

日志写入 stderr，便于把 JSON 继续传给报告工具：

```bash
npx tsx skills/repo-analyze/index.ts vercel/next.js \
  | npx tsx skills/report-generate/index.ts --title "Next.js 分析报告"
```

## 退出码

| 代码 | 说明                               |
| ---- | ---------------------------------- |
| `0`  | 成功                               |
| `1`  | 输入、配置、API 调用或结果校验失败 |

## 相关 Skill

- [repo-fetch](../repo-fetch/SKILL.md)：GitHub 数据采集
- [report-generate](../report-generate/SKILL.md)：报告生成
