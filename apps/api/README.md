# @devscope/api

<div align="center">

**后端 API - Fastify + tRPC**

[![Fastify](https://img.shields.io/badge/Fastify-5.2-000)](https://fastify.dev/)
[![tRPC](https://img.shields.io/badge/tRPC-11-2a2042)](https://trpc.io/)

</div>

## 📦 简介

本包是 DevScope 项目的后端 API 服务，基于 Fastify 和 tRPC 构建，提供类型安全的 API 接口。

### 特性

- ⚡ **Fastify** - 高性能 Node.js Web 框架
- 🔗 **tRPC** - 端到端类型安全的 API
- 🛡️ **Zod 验证** - 自动运行时类型验证
- 📝 **自动文档** - 类型自动同步到前端

---

## 📂 目录结构

```
apps/api/
├── src/
│   ├── index.ts          # 服务器入口
│   ├── router.ts         # tRPC 路由定义
│   ├── trpc.ts           # tRPC 配置和适配器
│   └── context.ts        # 请求上下文
├── dist/                 # 构建输出
├── package.json
└── tsconfig.json
```

---

## 🚀 开发

### 启动开发服务器

```bash
pnpm --filter @devscope/api dev
```

服务将在 http://localhost:3001 启动

### 构建生产版本

```bash
pnpm --filter @devscope/api build
```

### 启动生产服务器

```bash
pnpm --filter @devscope/api start
```

---

## 📖 API 文档

### 健康检查

**端点**: `GET /trpc/health`

**响应**:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 问候接口

**端点**: `POST /trpc/greet`

**请求**:
```json
{
  "name": "Alice"
}
```

**响应**:
```json
{
  "message": "Hello, Alice!"
}
```

---

## 🔧 添加新路由

在 `src/router.ts` 中添加新路由：

```typescript
export const appRouter = router({
  // 现有路由...

  // 添加新路由
  getUser: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      // 从数据库获取用户
      const user = await db.select().from(schema.users)
        .where(eq(schema.users.id, input.id));
      return user[0];
    }),

  createUser: publicProcedure
    .input(z.object({
      email: z.string().email(),
      name: z.string(),
    }))
    .mutation(async ({ input }) => {
      // 创建新用户
      const newUser = await db.insert(schema.users)
        .values(input)
        .returning();
      return newUser[0];
    }),
});
```

---

## 🔌 tRPC 客户端使用

### 前端调用

```typescript
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@devscope/api";

const client = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "http://localhost:3001/trpc",
    }),
  ],
});

// 调用 API
const result = await client.greet.query({ name: "Alice" });
console.log(result.message); // "Hello, Alice!"
```

### 类型安全

所有 API 调用都完全类型安全，TypeScript 会自动推断：

```typescript
// ✅ 类型安全：参数自动检查
await client.greet.query({ name: "Alice" });

// ❌ 类型错误：缺少必需参数
await client.greet.query({});

// ❌ 类型错误：参数类型错误
await client.greet.query({ name: 123 });
```

---

## 🔐 中间件

### CORS

已配置 CORS 允许跨域请求：

```typescript
await fastify.register(cors, {
  origin: true,
  credentials: true,
});
```

### 添加认证中间件

```typescript
// 在 trpc.ts 中添加
export const protectedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  // 验证用户身份
  const user = await authenticateUser(ctx.req);

  if (!user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "请先登录",
    });
  }

  return next({ ctx: { ...ctx, user } });
});

// 在 router.ts 中使用
export const appRouter = router({
  secretData: protectedProcedure.query(({ ctx }) => {
    // ctx.user 现在可用
    return { data: "secret" };
  }),
});
```

---

## 🌍 环境变量

```bash
# API 服务端口（默认：3001）
PORT=3001

# 数据库连接
DATABASE_URL=postgresql://localhost:5432/devscope

# Anthropic API Key
ANTHROPIC_API_KEY=sk-ant-xxx
```

---

## 📝 请求流程

```
客户端请求
    ↓
Fastify 服务器
    ↓
/t rpc/:path 路由
    ↓
createTRPCHandle
    ↓
createContext (创建上下文)
    ↓
router.createCaller (创建调用器)
    ↓
对应的 procedure (处理请求)
    ↓
返回响应
```
