/**
 * @package @devscope/api
 * @description tRPC 配置
 *
 * 初始化 tRPC 实例，配置请求上下文。
 *
 * @module trpc
 */

import { initTRPC } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const publicProcedure = t.procedure;
export const router = t.router;