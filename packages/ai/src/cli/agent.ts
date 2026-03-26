#!/usr/bin/env node
/**
 * @package @devscope/ai/cli
 * @description DevScope Agent CLI 入口
 *
 * 使用方式:
 * npx tsx packages/ai/src/cli/agent.ts "分析 vercel/next.js 的健康度"
 * npx tsx packages/ai/src/cli/agent.ts --stream "获取 facebook/react 的信息"
 */

import { createAgent } from "../agent.js";
import { config } from "dotenv";

// 加载环境变量
config();

// 解析命令行参数
const args = process.argv.slice(2);
const streamMode = args.includes("--stream");
const prompt = args.filter((arg) => !arg.startsWith("--")).join(" ");

if (!prompt) {
  console.log(`
DevScope Agent CLI

使用方式:
  npx tsx packages/ai/src/cli/agent.ts "你的问题"
  npx tsx packages/ai/src/cli/agent.ts --stream "你的问题"

选项:
  --stream    启用流式输出

示例:
  npx tsx packages/ai/src/cli/agent.ts "分析 vercel/next.js 的健康度"
  npx tsx packages/ai/src/cli/agent.ts --stream "获取 facebook/react 的信息并生成报告"
`);
  process.exit(0);
}

async function main() {
  const agent = createAgent({
    model: "claude-sonnet-4-6",
  });

  console.log(`\n用户: ${prompt}\n`);
  console.log("助手: ");

  if (streamMode) {
    // 流式输出
    const result = await agent.stream(prompt, {
      onText: (text) => process.stdout.write(text),
      onToolUse: (name, input) => {
        console.log(`\n\n🔧 使用工具: ${name}`);
        if (Object.keys(input as object).length > 0) {
          console.log(`   输入: ${JSON.stringify(input)}`);
        }
      },
      onToolResult: (name, result) => {
        console.log(`   ✅ 完成`);
      },
    });

    console.log("\n\n---");
    console.log(`Token 使用: 输入 ${result.usage?.inputTokens}, 输出 ${result.usage?.outputTokens}`);
    console.log(`工具调用次数: ${result.toolCalls.length}`);
  } else {
    // 非流式输出
    const result = await agent.run(prompt);

    console.log(result.output);
    console.log("\n---");

    if (result.toolCalls.length > 0) {
      console.log("\n工具调用记录:");
      result.toolCalls.forEach((call, i) => {
        console.log(`  ${i + 1}. ${call.tool}`);
      });
    }

    console.log(`\nToken 使用: 输入 ${result.usage?.inputTokens}, 输出 ${result.usage?.outputTokens}`);
  }
}

main().catch((error) => {
  console.error("错误:", error.message);
  process.exit(1);
});
