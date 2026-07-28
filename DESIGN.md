---
name: DevScope
description: 深色默认、局部全息、信息密度可调的开源生态研究终端
colors:
  signal-cyan-dark: "oklch(0.77 0.145 203)"
  signal-cyan-light: "oklch(0.58 0.16 205)"
  canvas-dark: "oklch(0.135 0.024 236)"
  surface-dark: "oklch(0.175 0.028 232)"
  canvas-light: "oklch(0.975 0.009 222)"
  surface-light: "oklch(0.995 0.006 220)"
  success: "oklch(0.72 0.12 155)"
  warning: "oklch(0.78 0.14 78)"
  danger: "oklch(0.66 0.18 25)"
typography:
  title:
    fontFamily: '"Geist Variable", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: '"Geist Variable", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Geist Variable", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.25
  mono:
    fontFamily: '"Geist Mono Variable", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace'
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
    backgroundColor: "{colors.signal-cyan-dark}"
    textColor: "{colors.canvas-dark}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.signal-cyan-dark}"
    textColor: "{colors.canvas-dark}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "8px 16px"
  input:
    backgroundColor: "semantic background"
    textColor: "semantic foreground"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "8px 12px"
---

# Design System: DevScope

## 1. Overview

**Creative North Star: “舰桥研究终端”**

DevScope 是一个需要长时间使用的产品界面。视觉系统以深色舰桥终端为默认基线，以偏蓝黑的稳定表面、冷青数据光和有限的琥珀告警承载高密度研究任务；同时保留完整浅色主题，供白天和高环境光场景使用。

系统明确区分“舰桥外壳”和“全息分析视口”。导航、列表、按钮、表单与分组维护继续使用熟悉的产品交互；只有实时分析、关系、风险或采集进度等高价值状态可以使用网格、扫描和信号脉冲。品牌识别来自信息结构与状态反馈，不来自代码雨、伪终端、玻璃拟态或无目的发光。

**Key Characteristics:**

- 深色默认、浅色完整可用的偏冷研究环境。
- 舰桥外壳采用 `Restrained`，局部全息视口采用 `Committed`。
- 冷青表达主操作、当前选择与实时信号，琥珀和红色只表达真实状态。
- 桌面端高效，移动端结构性重排。
- 标准交互优先于新奇表现。

## 2. Colors

调色板使用 OKLCH，由偏蓝黑中性色、冷青信号和语义状态色组成。深色层级依靠表面亮度区分，不依赖阴影；浅色层级依靠冷色画布、纸面和细线边界区分。

**The Semantic Color Rule.** 任意彩色元素必须能回答“它表达了什么状态或操作”；回答不了就改为中性色。

### Primary

- **信号青 `signal-cyan`：** 主按钮、当前导航、链接、焦点环和真实运行信号。
- **信号青柔和层：** 选中背景、全息网格和局部分析视口，不扩散到普通内容区域。

### Neutral

- **深海画布 `canvas-dark`：** 默认页面背景，禁止使用纯黑。
- **舰桥表面 `surface-dark`：** Header、输入、列表与普通内容区域。
- **冷雾画布 `canvas-light`：** 浅色主题背景。
- **纸面层 `surface-light`：** 浅色主题内容表面。
- **语义正文与边界：** 始终通过 token 读取，页面不得硬编码 gray/slate 作为主题结构色。

### Semantic

- **成功 `success`：** 已完成、健康、可用。
- **警告 `warning`：** 需要关注但不阻断的状态。
- **危险 `danger`：** 错误、失败和破坏性操作。

## 3. Typography

正文使用 Geist Variable（经 fontsource 本地打包，构建期不联网），中文回退 PingFang SC / Hiragino Sans GB / Microsoft YaHei，保证 macOS、Windows 与 Linux 上的产品可读性。数字、代码与 ID 场景使用 Geist Mono Variable（`ui-monospace` 回退）。标题通过字重与固定字号建立层级，禁止在产品界面使用流式超大标题、展示字体或渐变文字。

`letter-spacing`（tracking）不应用于中文密集串；现有 `command-kicker` 的 `tracking-[0.12em]` 仅服务拉丁短标签。`tabular-nums` 只允许出现在数字滚动组件（NumberTicker）内部，不做全局开启。

**The Dense Clarity Rule.** 数据区域可以紧凑，解释性正文保持约 65–75ch 行宽；不得通过缩小到难读字号换取密度。

## 4. Elevation

整体采用平面分层：画布、表面、边框三层足以表达绝大多数结构。普通卡片和列表不使用厚重阴影；只有浮层、菜单或正在拖动的元素允许低强度环境阴影。

**The Border Before Shadow Rule.** 先用背景层和 `1px` 边框建立结构，只有确实离开文档流的元素才能获得阴影。

全息分析视口允许使用低强度内发光和规则网格，但不能通过透明玻璃或大面积模糊制造层级。深色主题中，更高表面必须更亮；浅色主题中，仍以边界和背景差建立结构。

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

桌面端使用紧凑横向导航，当前项以冷青边界、柔和背景和信号青文字表达；移动端切换为可展开的纵向导航。主题切换位于唯一的共享 Header，不允许页面维护各自的主题状态。

### Holographic Analysis

- 只用于分析、风险、关系和真实运行进度。
- 静态区域使用低对比网格和内边界；只有真实运行状态可以播放扫描或脉冲。
- 全息视口不能替换标准按钮、表格、标题和错误反馈。
- 减少动效模式下删除空间移动，保留颜色和文字状态。

## 6. Motion

动效按用途分三类入账，任何新增动效必须先归入其中一类，回答不了"它属于哪类、表达什么状态"就不加。

| 类别 | 内容 | 预算 |
|---|---|---|
| 环境层 | spotlight、静态网格 | 同屏最多 1 类 |
| 运行态指示 | hologram-scan、呼吸、进度脉冲 | 只给真实运行态 |
| 交互 | spring 回弹、焦点环、hover | 即时反馈，不循环 |

### 统一曲线

- **环境层：** 循环型环境动画（呼吸、脉冲）统一 `2s ease-in-out`，opacity 范围 `0.4 ↔ 0.7`。
- **交互层：** spring 两档——snappy `stiffness 300 / damping 30`（导航指示器、卡片抬升），soft `stiffness 180 / damping 20`（数字滚动）。
- 交互动效一律即时反馈，不允许循环播放；hover 微交互统一 `150ms` 过渡曲线。

### 环境层 spotlight

- 全局背景保留静态细网格，叠加鼠标跟随 spotlight：CSS 变量 `--spotlight-x / --spotlight-y` 驱动 `translate3d`，RAF 节流，仅合成器层工作，不触碰布局。
- 强度三档 `off / subtle / full`：`subtle` 默认 opacity ~0.35，数据密集路由（首页列表 `/`、搜索页 `/search`）降亮到 ~0.12；`full` 对应 ~0.55 / ~0.2。
- 偏好持久化在 localStorage（key `devscope-ambient`），开关位于共享 Header，与主题切换并列；SSR 使用默认值渲染，读取在客户端 effect 内完成。

### 运行态指示

- `hologram-panel[data-live="true"]` 的扫描线为 `3.2s linear infinite`（`hologram-scan` keyframes），只在真实运行状态挂载；静态面板不得播放。
- 运行态指示只表达真实状态（采集、分析、进度），不做装饰性常驻动画。

### 降级矩阵

| 条件 | 降级行为 |
|---|---|
| `prefers-reduced-motion: reduce` | 全静态：spotlight 不渲染，扫描线关闭，spring/滚动动画直接呈现终值 |
| 触摸设备（`pointer: coarse`） | spotlight 退化为中心固定渐变，不跟随指针 |

## 7. Do's and Don'ts

### Do:

- **Do** 使用语义 token 统一颜色、圆角、焦点和状态。
- **Do** 把深浅色差异收敛在语义 token，不在页面散落 `dark:` 覆盖。
- **Do** 只在真实分析或采集运行时启用扫描与脉冲。
- **Do** 让页面标题、主要操作和当前状态在首屏清晰可见。
- **Do** 使用标准 Button、Input、Tabs、Table 与 Navigation 交互。
- **Do** 为窄屏重排结构，并支持 `prefers-reduced-motion`。

### Don't:

- **Don't** 使用“通用 AI SaaS 模板”：蓝紫渐变标题、漂浮光斑、玻璃拟态和无目的页面入场动画。
- **Don't** 使用“营销页式 Dashboard”：把所有指标包装成同等强调的彩色大卡片。
- **Don't** 使用“伪终端或黑客风界面”制造技术感。
- **Don't** 使用代码雨、游戏 HUD、持续闪烁或无数据依据的装饰图表。
- **Don't** 把全息材质扩散到导航、标准表单和所有卡片。
- **Don't** 使用大于 1px 的彩色侧边条作为卡片装饰。
- **Don't** 展示尚未实现的团队、租户、协作或公开权限入口。
