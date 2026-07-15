---
name: DevScope
description: 克制、可信、信息密度可调的开源生态研究工作台
colors:
  accent-blue: "#2563eb"
  accent-blue-hover: "#1d4ed8"
  canvas: "#f8fafc"
  surface: "#fcfdff"
  foreground: "#0f172a"
  muted-foreground: "#64748b"
  border: "#e2e8f0"
  success: "#15803d"
  warning: "#b45309"
  danger: "#dc2626"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-blue-hover}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "8px 12px"
---

# Design System: DevScope

## 1. Overview

**Creative North Star: “研究案头”**

DevScope 是一个需要长时间使用的产品界面。视觉系统以浅色、低干扰的工作环境为基线，让仓库名称、状态、证据与操作自然成为页面重点。界面可以承载较高的信息密度，但每个区域必须有稳定职责，不能依靠不断增加卡片、颜色和动画维持层级。

系统明确拒绝 PRODUCT.md 中的“通用 AI SaaS 模板”“营销页式 Dashboard”和“伪终端或黑客风界面”。品牌识别来自统一的蓝色强调、清晰排版和可靠状态反馈，而不是渐变文字、玻璃拟态或漂浮光斑。

**Key Characteristics:**

- 浅色、克制、偏冷的研究工作环境。
- 一个主强调色，语义色只表达真实状态。
- 桌面端高效，移动端结构性重排。
- 标准交互优先于新奇表现。

## 2. Colors

调色板由偏冷的中性色和单一蓝色强调构成。`accent-blue` 只用于主操作、当前选中、链接和焦点；成功、警告、危险颜色不得作为普通装饰。

**The Semantic Color Rule.** 任意彩色元素必须能回答“它表达了什么状态或操作”；回答不了就改为中性色。

### Primary

- **研究蓝 `accent-blue`：** 主按钮、当前导航、链接与焦点环。
- **深研究蓝 `accent-blue-hover`：** 主操作 hover/active 状态。

### Neutral

- **冷雾画布 `canvas`：** 页面背景。
- **纸面层 `surface`：** Header、输入框和需要与画布区分的内容表面。
- **墨色正文 `foreground`：** 标题、正文和关键数据。
- **石板辅助文字 `muted-foreground`：** 说明、元数据和次级标签。
- **细线边界 `border`：** 区域、输入与列表分隔。

### Semantic

- **成功 `success`：** 已完成、健康、可用。
- **警告 `warning`：** 需要关注但不阻断的状态。
- **危险 `danger`：** 错误、失败和破坏性操作。

## 3. Typography

使用系统无衬线字体栈，保证 macOS、Windows 与 Linux 上的产品可读性。标题通过字重与固定字号建立层级，禁止在产品界面使用流式超大标题、展示字体或渐变文字。

**The Dense Clarity Rule.** 数据区域可以紧凑，解释性正文保持约 65–75ch 行宽；不得通过缩小到难读字号换取密度。

## 4. Elevation

整体采用平面分层：画布、表面、边框三层足以表达绝大多数结构。普通卡片和列表不使用厚重阴影；只有浮层、菜单或正在拖动的元素允许低强度环境阴影。

**The Border Before Shadow Rule.** 先用背景层和 `1px` 边框建立结构，只有确实离开文档流的元素才能获得阴影。

## 5. Components

组件使用现有 `apps/web/src/components/ui` primitives，状态、尺寸和焦点处理必须保持一致。

### Buttons

- **Shape:** 轻微圆角（6px），默认高度 40px。
- **Primary:** 研究蓝背景、浅色文字，只服务当前页面最重要操作。
- **Hover / Focus:** hover 使用深研究蓝；focus 使用清晰的外部焦点环。
- **Secondary / Ghost:** 使用中性色背景或透明背景，不得自行引入渐变。

### Cards / Containers

- **Corner Style:** 轻微圆角（8px）。
- **Background:** 纸面层或透明画布。
- **Shadow Strategy:** 默认无阴影或极弱阴影。
- **Border:** 细线边界（1px）。
- **Internal Padding:** 16–24px，根据内容密度选择。

### Inputs / Fields

- **Style:** 纸面层背景、细线边框、6px 圆角、最小高度 40px。
- **Focus:** 使用研究蓝焦点环，不能只改变边框色。
- **Error / Disabled:** 同时使用文字、图标或说明，不依赖红色本身。

### Navigation

桌面端使用紧凑横向导航，当前项以浅蓝背景和研究蓝文字表达；移动端切换为可展开的纵向导航。品牌 Header 全站唯一，页面内部只保留页面标题、面包屑或返回操作。

## 6. Do's and Don'ts

### Do:

- **Do** 使用语义 token 统一颜色、圆角、焦点和状态。
- **Do** 让页面标题、主要操作和当前状态在首屏清晰可见。
- **Do** 使用标准 Button、Input、Tabs、Table 与 Navigation 交互。
- **Do** 为窄屏重排结构，并支持 `prefers-reduced-motion`。

### Don't:

- **Don't** 使用“通用 AI SaaS 模板”：蓝紫渐变标题、漂浮光斑、玻璃拟态和无目的页面入场动画。
- **Don't** 使用“营销页式 Dashboard”：把所有指标包装成同等强调的彩色大卡片。
- **Don't** 使用“伪终端或黑客风界面”制造技术感。
- **Don't** 使用大于 1px 的彩色侧边条作为卡片装饰。
- **Don't** 展示尚未实现的团队、租户、协作或公开权限入口。
