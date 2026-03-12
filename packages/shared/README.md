# @devscope/shared

<div align="center">

**共享类型定义包**

[![Zod](https://img.shields.io/badge/Zod-3.24-green)](https://zod.dev/)

</div>

## 📦 简介

本包是 DevScope 项目的共享类型定义库，包含所有应用和包之间共享的数据结构。

### 特性

- 🛡️ **类型安全** — 使用 Zod 进行运行时类型验证
- 🔗 **端到端类型** — TypeScript 类型自动推断
- 📝 **文档化** — JSDoc 注释提供完整的类型文档

---

## 📋 包含的类型

### 用户类型

```typescript
// 用户 Schema
userSchema: ZodObject<User>

// TypeScript 类型
type User {
  id?: number;
  email: string;
  name?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

type NewUser = Omit<User, "id" | "createdAt" | "updatedAt">
```

### 文档类型

```typescript
// 文档 Schema（含向量嵌入支持）
documentSchema: ZodObject<Document>

// TypeScript 类型
type Document {
  id?: number;
  userId: number;
  title: string;
  content: string;
  embedding?: number[];  // 向量嵌入
  createdAt?: Date;
  updatedAt?: Date;
}
```

### AI 类型

```typescript
// 消息类型
type Message = {
  role: "user" | "assistant" | "system";
  content: string;
}

// AI 请求类型
type CompletionRequest = {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

// AI 响应类型
type CompletionResponse = {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}
```

### 分页类型

```typescript
// 分页参数
type Pagination = {
  page: number;
  limit: number;
}

// 分页响应
type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

## 🚀 使用方法

### 导入类型

```typescript
import { userSchema, type User, type NewUser } from "@devscope/shared";
```

### 验证数据

```typescript
import { userSchema } from "@devscope/shared";

// 验证用户数据
const result = userSchema.safeParse(userData);

if (result.success) {
  console.log("有效的用户数据:", result.data);
} else {
  console.error("验证失败:", result.error);
}
```

### 类型推断

```typescript
import { documentSchema } from "@devscope/shared";

// 自动推断 TypeScript 类型
type Document = z.infer<typeof documentSchema>;
```

---

## 📂 文件结构

```
packages/shared/
├── src/
│   └── index.ts     # 类型定义主文件
├── dist/            # 构建输出
├── package.json
└── tsconfig.json
```

---

## 🔧 开发

```bash
# 构建
pnpm --filter @devscope/shared build

# 开发模式（监听文件变化）
pnpm --filter @devscope/shared dev

# 类型检查
pnpm --filter @devscope/shared lint
```
