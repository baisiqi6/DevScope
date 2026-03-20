/**
 * @package @devscope/web
 * @description 动画背景组件
 *
 * 提供渐变背景和浮动几何图形装饰效果。
 */

"use client";

import { motion } from "framer-motion";

/**
 * 浮动几何图形组件
 */
function FloatingShape({
  className,
  delay = 0,
}: {
  className: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      animate={{
        y: [0, -30, 0],
        rotate: [0, 360],
        scale: [1, 1.1, 1],
      }}
      transition={{
        duration: 20,
        repeat: Infinity,
        delay,
        ease: "easeInOut",
      }}
    />
  );
}

/**
 * 动画背景组件
 * 包含渐变背景和多个浮动的几何图形装饰
 */
export function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {/* 渐变背景 */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100" />

      {/* 网格图案 */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(to right, #000 1px, transparent 1px),
            linear-gradient(to bottom, #000 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px'
        }}
      />

      {/* 浮动圆形装饰 */}
      <FloatingShape
        className="absolute top-20 left-10 w-64 h-64 bg-blue-400/10 rounded-full blur-3xl"
        delay={0}
      />
      <FloatingShape
        className="absolute top-40 right-20 w-96 h-96 bg-indigo-400/10 rounded-full blur-3xl"
        delay={2}
      />
      <FloatingShape
        className="absolute bottom-20 left-1/4 w-80 h-80 bg-purple-400/10 rounded-full blur-3xl"
        delay={4}
      />
      <FloatingShape
        className="absolute bottom-40 right-1/3 w-72 h-72 bg-cyan-400/10 rounded-full blur-3xl"
        delay={6}
      />

      {/* 浮动三角形装饰 */}
      <motion.div
        className="absolute top-1/4 right-1/4 w-20 h-20 border-2 border-blue-200/20 rotate-45"
        animate={{
          rotate: [45, 225, 45],
          scale: [1, 1.2, 1],
        }}
        transition={{
          duration: 15,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="absolute bottom-1/3 left-20 w-16 h-16 border-2 border-indigo-200/20 rotate-12"
        animate={{
          rotate: [12, 192, 12],
          y: [0, -20, 0],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1,
        }}
      />
      <motion.div
        className="absolute top-1/2 right-10 w-12 h-12 bg-gradient-to-br from-blue-200/10 to-indigo-200/10 rounded-lg"
        animate={{
          rotate: [0, 180, 360],
          scale: [1, 1.3, 1],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 0.5,
        }}
      />

      {/* 光效装饰 */}
      <motion.div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-blue-400/5 rounded-full blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
    </div>
  );
}

/**
 * 页面容器组件，提供页面进入动画
 */
export function AnimatedPage({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/**
 * 列表项淡入动画组件
 */
export function FadeInItem({
  children,
  index = 0,
  className = "",
}: {
  children: React.ReactNode;
  index?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: index * 0.05,
        ease: "easeOut",
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
