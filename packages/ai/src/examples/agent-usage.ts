/**
 * @package @devscope/ai/examples
 * @description DevScopeAgent 使用示例
 *
 * 运行方式:
 * npx tsx packages/ai/src/examples/agent-usage.ts
 */

import { createAgent } from "../agent.js";
import { config } from "dotenv";

// 加载环境变量
config();

async function main() {
  console.log("=== DevScopeAgent 使用示例 ===\n");

  // 创建 Agent 实例
  const agent = createAgent({
    model: "claude-sonnet-4-6",
    systemPrompt: `你是一个专业的开源项目分析师助手。

你可以使用以下工具来帮助用户分析 GitHub 项目：

1. **repo_fetch**: 获取 GitHub 仓库的基础数据（stars、forks、issues、commits 等）
2. **repo_analyze**: 使用 AI 分析仓库的健康度，返回结构化评估
3. **report_generate**: 基于分析结果生成综合报告

请根据用户的需求，自主决定使用哪些工具。`,
  });

  // 示例 1: 简单查询
  console.log("示例 1: 简单查询\n");
  console.log("用户: 你好，请介绍一下你自己\n");

  const result1 = await agent.run("你好，请介绍一下你自己");
  console.log(`助手: ${result1.output}\n`);
  console.log(`Token 使用: 输入 ${result1.usage?.inputTokens}, 输出 ${result1.usage?.outputTokens}\n`);

  // 示例 2: 获取仓库信息
  console.log("---\n");
  console.log("示例 2: 获取仓库信息\n");
  console.log("用户: 获取 vercel/next.js 的基础信息\n");

  const result2 = await agent.run("获取 vercel/next.js 的基础信息");
  console.log(`助手: ${result2.output}\n`);
  console.log(`工具调用: ${result2.toolCalls.map(t => t.tool).join(", ")}\n`);

  // 示例 3: 分析仓库健康度
  console.log("---\n");
  console.log("示例 3: 分析仓库健康度\n");
  console.log("用户: 分析 facebook/react 的健康度\n");

  const result3 = await agent.run("分析 facebook/react 的健康度");
  console.log(`助手: ${result3.output}\n`);
  console.log(`工具调用: ${result3.toolCalls.map(t => t.tool).join(", ")}\n`);

  // 示例 4: 流式输出
  console.log("---\n");
  console.log("示例 4: 流式输出\n");
  console.log("用户: 分析 vercel/next.js 并生成报告\n");

  const result4 = await agent.stream("分析 vercel/next.js 并生成报告", {
    onText: (text) => process.stdout.write(text),
    onToolUse: (name, input) => console.log(`\n[使用工具: ${name}]`),
    onToolResult: (name, result) => console.log(`[工具完成: ${name}]`),
  });

  console.log("\n\n最终结果:\n");
  console.log(result4.output);

  // 示例 5: 自定义工具
  console.log("\n---\n");
  console.log("示例 5: 注册自定义工具\n");

  const customAgent = createAgent();

  customAgent.registerTool({
    name: "search_trending",
    description: "搜索当前热门的开源项目",
    inputSchema: {
      parse: (input: any) => input,
    } as any,
    handler: async (input: { language?: string }) => {
      // 模拟返回热门项目
      return {
        projects: [
          { name: "vercel/next.js", stars: 100000, trend: "+500 today" },
          { name: "facebook/react", stars: 200000, trend: "+300 today" },
        ],
        language: input.language || "all",
      };
    },
  });

  console.log("已注册自定义工具: search_trending");

  // 示例 6: 批量分析
  console.log("\n---\n");
  console.log("示例 6: 批量分析多个仓库\n");

  const result6 = await agent.run(`
请分析以下仓库的健康度并生成对比报告：
1. vercel/next.js
2. facebook/react
3. vuejs/vue

请先获取每个仓库的信息，然后进行分析，最后生成对比报告。
`);

  console.log(`助手: ${result6.output}\n`);
  console.log(`工具调用记录:`);
  result6.toolCalls.forEach((call, i) => {
    console.log(`  ${i + 1}. ${call.tool}`);
  });
}

main().catch(console.error);
