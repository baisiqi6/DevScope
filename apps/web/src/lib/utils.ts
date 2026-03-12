/**
 * @package @devscope/web
 * @description 工具函数库
 *
 * 提供 shadcn/ui 所需的 Tailwind CSS 类名合并工具。
 *
 * @module utils
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 Tailwind CSS 类名
 *
 * 使用 clsx 和 tailwind-merge 的组合来智能合并类名，
 * 避免类名冲突（如 `p-4 p-2` 会被合并为 `p-2`）。
 *
 * @param inputs - 类名数组（可以是字符串、对象、数组等）
 * @returns 合并后的类名字符串
 *
 * @example
 * ```tsx
 * cn("px-2 py-1", "px-4") // "py-1 px-4"
 * cn({ active: true }, "text-lg") // "active text-lg"
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
