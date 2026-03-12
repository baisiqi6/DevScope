# @devscope/web

<div align="center">

**前端应用 - Next.js 15 + Tailwind + shadcn/ui**

[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8)](https://tailwindcss.com/)
[![shadcn/ui](https://img.shields.io/badge/shadcn/ui-latest-000)](https://ui.shadcn.com/)

</div>

## 📦 简介

本包是 DevScope 项目的前端应用，基于 Next.js 15 App Router、Tailwind CSS 和 shadcn/ui 组件库构建。

### 特性

- ⚡ **Next.js 15** - 最新的 App Router 和 Server Components
- 🎨 **Tailwind CSS** - 实用优先的 CSS 框架
- 🧩 **shadcn/ui** - 高质量的可复制组件库
- 🌙 **深色模式** - 内置主题切换支持
- 📱 **响应式设计** - 适配各种设备尺寸

---

## 📂 目录结构

```
apps/web/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── layout.tsx        # 根布局
│   │   ├── page.tsx          # 首页
│   │   └── globals.css       # 全局样式
│   ├── components/           # React 组件
│   │   └── ui/               # shadcn/ui 基础组件
│   │       ├── button.tsx
│   │       └── card.tsx
│   └── lib/                  # 工具函数
│       └── utils.ts          # cn() 类名合并工具
├── public/                   # 静态资源
├── next.config.ts            # Next.js 配置
├── tailwind.config.ts        # Tailwind 配置
└── package.json
```

---

## 🚀 开发

### 启动开发服务器

```bash
pnpm --filter @devscope/web dev
```

访问 http://localhost:3000

### 构建生产版本

```bash
pnpm --filter @devscope/web build
```

### 启动生产服务器

```bash
pnpm --filter @devscope/web start
```

---

## 🎨 UI 组件

### shadcn/ui 组件

项目预装了以下 shadcn/ui 组件：

| 组件 | 文件 | 说明 |
|------|------|------|
| Button | `button.tsx` | 按钮组件 |
| Card | `card.tsx` | 卡片容器 |

### 添加更多组件

```bash
# 在 apps/web 目录下运行
npx shadcn@latest add [组件名]

# 例如：
npx shadcn@latest add dialog
npx shadcn@latest add dropdown-menu
```

---

## 🎯 使用示例

### Button 组件

```tsx
import { Button } from "@/components/ui/button";

export default function Example() {
  return (
    <div className="flex gap-2">
      <Button>默认按钮</Button>
      <Button variant="destructive">删除</Button>
      <Button variant="outline">边框</Button>
      <Button variant="ghost">幽灵</Button>
      <Button size="sm">小</Button>
      <Button size="lg">大</Button>
    </div>
  );
}
```

### Card 组件

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

export default function Example() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>卡片标题</CardTitle>
        <CardDescription>卡片描述</CardDescription>
      </CardHeader>
      <CardContent>
        <p>卡片内容...</p>
      </CardContent>
      <CardFooter>
        <Button>操作</Button>
      </CardFooter>
    </Card>
  );
}
```

### 工具函数 cn()

```tsx
import { cn } from "@/lib/utils";

// 合并类名，避免冲突
className={cn(
  "px-4 py-2 text-sm",
  isActive && "bg-blue-500",
  "hover:bg-blue-600"
)}
```

---

## 🎨 主题定制

### 修改主题颜色

编辑 `src/app/globals.css` 中的 CSS 变量：

```css
:root {
  --primary: 221.2 83.2% 53.3%;  /* 主色调 */
  --secondary: 210 40% 96.1%;    /* 次要色调 */
  --accent: 210 40% 96.1%;       /* 强调色 */
  /* ... */
}

.dark {
  --primary: 217.2 91.2% 59.8%;
  /* ... */
}
```

### 深色模式

项目已配置深色模式支持，可以通过添加 `dark` 类来切换：

```tsx
<html className="dark">
```

---

## 📄 路由

Next.js 15 使用文件系统路由：

```
app/
├── layout.tsx          # 根布局
├── page.tsx            # 首页 (/)
├── about/
│   └── page.tsx        # 关于页面 (/about)
└── dashboard/
    ├── layout.tsx      # Dashboard 布局
    └── page.tsx        # Dashboard 页面 (/dashboard)
```

---

## 🔗 环境变量

在 `.env.local` 中配置：

```bash
# API 地址
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## 📝 代码规范

- 使用 TypeScript 严格模式
- 遵循 ESLint 规则
- 使用 Prettier 格式化代码

```bash
# 检查代码
pnpm --filter @devscope/web lint

# 格式化代码
pnpm prettier --write .
```
