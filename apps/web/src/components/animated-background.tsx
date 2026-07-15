/**
 * @package @devscope/web
 * @description 低干扰页面背景与兼容旧调用的内容容器
 */

/** 使用静态细网格建立轻微空间层次，不占用持续动画资源。 */
export function AnimatedBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background"
    >
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `
            linear-gradient(to right, hsl(var(--foreground)) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--foreground)) 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}

/**
 * 保留现有调用接口。产品页面直接进入任务，不再播放整页入场动画。
 */
export function AnimatedPage({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

/**
 * 保留现有列表调用接口。长列表不逐项播放动画，避免拖慢浏览节奏。
 */
export function FadeInItem({
  children,
  className = "",
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}
