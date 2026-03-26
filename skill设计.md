CLI Skill 设计 + Claude Code 深度使用
上午：理论（2h）
4.1 Skill 设计哲学
Unix哲学在Agent中的实践：
•	少即是多：内置工具只有 read / write / edit / bash
•	一切皆文件：Agent通过文件系统交换信息
•	CLI First：所有Skill都是可以独立运行的CLI程序+最佳实践
好的 Skill 设计原则：
1.	单一职责：一个Skill只做一件事
2.	可组合：可以通过管道 | 与其他工具组合
3.	幂等性：多次调用结果一致
4.	快速失败：输入验证在第一步，错误信息明确
5.	机器友好：输出JSON
4.2 Claude Code 深度使用技巧
CLAUDE.md 文件（项目级配置）：
•	项目架构说明
•	开发约定（ORM使用、输入验证、测试要求）
•	常用命令
•	注意事项
SKILL.md 文件（技能配置）：
•	功能描述
•	使用方式
•	输出格式说明
•	依赖环境
•	使用示例
________________________________________
下午：实战（4h）
任务4.1：设计并实现 3 个核心 CLI Skill
Skill 1：repo-fetch — GitHub数据采集
•	接受 owner/repo 参数
•	可选：包含issues、commits
•	输出JSON格式
Skill 2：repo-analyze — LLM健康度分析
•	从stdin读取repo-fetch的输出
•	调用Claude分析
•	输出结构化分析结果
Skill 3：report-generate — 报告生成
•	接收分析结果
•	支持多种模板：daily/weekly/investment
•	生成markdown或HTML报告
管道组合使用：
echo "vercel/next.js" \
  | ./skills/repo-fetch --include-issues \
  | ./skills/repo-analyze \
  | ./skills/report-generate --template investment
任务4.2：用 Claude Code 进行 Vibe Coding
提示词示例：
"帮我为DevScope项目实现一个健康度趋势图组件。
1. 使用Recharts展示过去30天的健康度变化
2. 支持多个仓库对比显示
3. 有工具提示显示详细数据
4. 用Tailwind CSS样式，暗色主题
5. 数据通过tRPC从API获取

请先阅读 apps/web/src/components 下的现有组件，保持风格一致"
 交付物：
•	[ ] 3个完整CLI Skill，有输入输出规范文档
•	[ ] Skill的TDD测试
•	[ ] CLAUDE.md和SKILL.md文件完整
•	[ ] 至少一个通过Claude Code实现的前端组件

---

## 现有实现

项目已完成三个核心 Skill 的实现：

| Skill | 路径 | 状态 |
|-------|------|------|
| repo-fetch | skills/repo-fetch/index.ts | ✅ 已实现 |
| repo-analyze | skills/repo-analyze/index.ts | ✅ 已实现 |
| report-generate | skills/report-generate/index.ts | ✅ 已实现 |

每个 Skill 目录下都有 SKILL.md 文档说明使用方式。

### 管道组合示例

```bash
# 完整分析流程
echo "vercel/next.js" \
  | skills/repo-fetch/index.ts --include-issues \
  | skills/repo-analyze/index.ts \
  | skills/report-generate/index.ts --title "投资分析报告"
```

### 功能对照

| 设计要求 | 实现状态 | 说明 |
|---------|---------|------|
| `--include-issues` | ✅ | repo-fetch 支持 |
| `--include-commits` | ✅ | repo-fetch 支持 |
| 三种报告模板 | ⚠️ | summary/detailed/comparison（文档要求 daily/weekly/investment） |
| 管道组合 | ✅ | 所有 Skill 支持 stdin/stdout |
| SKILL.md 文档 | ✅ | 已创建 |
