/**
 * @package @devscope/web
 * @description 环境层（spotlight）强度偏好，供背景层与 Header 开关键共享。
 */

export type AmbientLevel = "off" | "subtle" | "full";

export const AMBIENT_STORAGE_KEY = "devscope-ambient";

/** 同标签页内强度变更广播事件（localStorage 的 storage 事件不覆盖同页） */
export const AMBIENT_CHANGE_EVENT = "devscope-ambient-change";

export const AMBIENT_DEFAULT_LEVEL: AmbientLevel = "subtle";

export function isAmbientLevel(value: unknown): value is AmbientLevel {
  return value === "off" || value === "subtle" || value === "full";
}
