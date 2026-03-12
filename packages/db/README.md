# @devscope/db

<div align="center">

**数据库包 - Drizzle ORM + PostgreSQL**

[![Drizzle](https://img.shields.io/badge/Drizzle-ORM-blue)](https://orm.drizzle.team/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-blue)](https://www.postgresql.org/)
[![pgvector](https://img.shields.io/badge/pgvector-0.5-green)](https://github.com/pgvector/pgvector)

</div>

## 📦 简介

本包提供 DevScope 项目的数据库操作接口，基于 Drizzle ORM 和 PostgreSQL，支持向量嵌入存储和语义搜索。

### 特性

- 🗄️ **类型安全** - Drizzle ORM 提供完整的 TypeScript 类型推断
- 🔍 **向量搜索** - 集成 pgvector 实现语义搜索
- 📝 **自动迁移** - Drizzle Kit 管理数据库迁移
- ⚡ **高性能** - 基于 node-postgres 的连接池

---

## 🗂️ 数据模型

### users 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `serial` | 主键 |
| `email` | `text` | 邮箱（唯一） |
| `name` | `text` | 用户名 |
| `created_at` | `timestamp` | 创建时间 |
| `updated_at` | `timestamp` | 更新时间 |

### documents 表

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `serial` | 主键 |
| `user_id` | `serial` | 用户 ID（外键） |
| `title` | `text` | 文档标题 |
| `content` | `text` | 文档内容 |
| `embedding` | `vector(1536)` | 向量嵌入 |
| `created_at` | `timestamp` | 创建时间 |
| `updated_at` | `timestamp` | 更新时间 |

---

## 🚀 使用方法

### 创建数据库连接

```typescript
import { createDb } from "@devscope/db";

// 使用连接字符串
const db = createDb("postgresql://localhost:5432/devscope");

// 或使用环境变量 DATABASE_URL
const db = createDb();
```

### 查询数据

```typescript
import { createDb, schema } from "@devscope/db";

const db = createDb();

// 查询所有用户
const allUsers = await db.select().from(schema.users);

// 条件查询
const user = await db.select()
  .from(schema.users)
  .where(eq(schema.users.email, "user@example.com"));

// 关联查询
const userDocs = await db.select()
  .from(schema.documents)
  .innerJoin(schema.users, eq(schema.documents.userId, schema.users.id));
```

### 插入数据

```typescript
import { createDb, schema } from "@devscope/db";

const db = createDb();

// 插入新用户
const newUser: NewUser = {
  email: "newuser@example.com",
  name: "New User",
};

await db.insert(schema.users).values(newUser);

// 插入新文档
const newDoc: NewDocument = {
  userId: 1,
  title: "我的文档",
  content: "这是一份文档内容...",
};

await db.insert(schema.documents).values(newDoc);
```

### 向量搜索

```typescript
import { createDb, schema, sql } from "@devscope/db";

const db = createDb();

// 计算相似度并搜索
const queryEmbedding = [0.1, 0.2, ...]; // 1536 维向量

const results = await db.execute(sql`
  SELECT
    id,
    title,
    content,
    1 - (embedding <=> ${queryEmbedding}) as similarity
  FROM documents
  ORDER BY embedding <=> ${queryEmbedding}
  LIMIT 10
`);
```

---

## 🔧 数据库管理

### 生成迁移文件

```bash
pnpm db:generate
```

### 执行迁移

```bash
pnpm db:migrate
```

### 推送 schema（开发环境）

```bash
pnpm db:push
```

### 打开数据库管理界面

```bash
pnpm db:studio
```

---

## 📂 文件结构

```
packages/db/
├── src/
│   ├── schema/
│   │   └── index.ts     # 数据表定义
│   └── index.ts         # 数据库连接和导出
├── drizzle/             # 迁移文件
├── drizzle.config.ts    # Drizzle Kit 配置
├── package.json
└── tsconfig.json
```

---

## 🗄️ 数据库设置

### 安装 pgvector 扩展

```sql
-- 连接到 PostgreSQL
psql -d devscope

-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;
```

### 环境变量

```bash
# 数据库连接 URL
DATABASE_URL=postgresql://user:password@localhost:5432/devscope
```

---

## 📝 类型定义

```typescript
// 从 schema 自动推断的类型
type User = {
  id: number;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type NewUser = {
  id?: number;
  email: string;
  name?: string;
  createdAt?: Date;
  updatedAt?: Date;
};
```
