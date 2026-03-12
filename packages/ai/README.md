# @devscope/ai

<div align="center">

**AI 服务包 - Anthropic Claude SDK 封装**

[![Anthropic](https://img.shields.io/badge/Anthropic-Claude-purple)](https://www.anthropic.com/)

</div>

## 📦 简介

本包封装了 Anthropic Claude API，为 DevScope 项目提供统一的 AI 服务接口。

### 特性

- 🤖 **Claude 集成** - 支持最新的 Claude 3.5 Sonnet 模型
- 🌊 **流式输出** - 支持实时流式响应
- 🛡️ **类型安全** - 完整的 TypeScript 类型支持
- ⚙️ **灵活配置** - 支持自定义模型和参数

---

## 🚀 快速开始

### 基础使用

```typescript
import { createAI } from "@devscope/ai";

// 创建 AI 实例
const ai = createAI({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultModel: "claude-3-5-sonnet-20241022",
});

// 非流式补全
const response = await ai.complete("你好，请介绍一下自己");
console.log(response);
```

### 流式输出

```typescript
await ai.stream(
  "请写一个短篇故事",
  (chunk) => {
    // 实时处理每个文本块
    process.stdout.write(chunk);
  },
  {
    temperature: 0.8,
    maxTokens: 2000,
  }
);
```

---

## 📖 API 文档

### `AIProvider`

AI 服务的核心类。

#### 构造函数

```typescript
constructor(config?: AIConfig)
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `apiKey` | `string` | `process.env.ANTHROPIC_API_KEY` | Anthropic API Key |
| `baseURL` | `string` | - | 自定义 API URL |
| `defaultModel` | `string` | `"claude-3-5-sonnet-20241022"` | 默认模型 |
| `maxTokens` | `number` | `4096` | 默认最大 token 数 |

#### 方法

##### `complete()`

非流式文本补全。

```typescript
async complete(
  prompt: string,
  options?: CompletionOptions
): Promise<string>
```

**示例：**

```typescript
const text = await ai.complete("解释什么是量子计算", {
  model: "claude-3-opus-20240229",
  maxTokens: 1000,
  temperature: 0.5,
});
```

##### `stream()`

流式文本补全。

```typescript
async stream(
  prompt: string,
  onChunk: (text: string) => void,
  options?: CompletionOptions
): Promise<void>
```

**示例：**

```typescript
await ai.stream(
  "写一段代码：快速排序算法",
  (chunk) => console.log(chunk),
  {
    system: "你是一个专业的编程助手",
  }
);
```

---

## 🔧 配置选项

### `CompletionOptions`

| 选项 | 类型 | 说明 |
|------|------|------|
| `model` | `string` | 使用的模型 |
| `maxTokens` | `number` | 最大生成 token 数 |
| `system` | `string` | 系统提示词 |
| `temperature` | `number` | 温度参数（0-1） |

### 支持的模型

- `claude-3-5-sonnet-20241022` - 最新的 Sonnet 3.5 模型（推荐）
- `claude-3-opus-20240229` - Opus 模型（最强性能）
- `claude-3-sonnet-20240229` - Sonnet 模型（平衡性能）
- `claude-3-haiku-20240307` - Haiku 模型（最快响应）

---

## 📂 文件结构

```
packages/ai/
├── src/
│   └── index.ts     # AIProvider 类和工厂函数
├── dist/            # 构建输出
├── package.json
└── tsconfig.json
```

---

## 🔐 环境变量

```bash
# 必需：Anthropic API Key
ANTHROPIC_API_KEY=sk-ant-xxx
```

---

## 📝 注意事项

1. **嵌入 API**: Anthropic 目前不提供向量嵌入 API，请使用其他提供商（如 OpenAI、Cohere）。
2. **API 限流**: 注意 API 调用频率限制，建议在客户端实现请求队列。
3. **错误处理**: 建议在生产环境中添加完善的错误处理和重试逻辑。
