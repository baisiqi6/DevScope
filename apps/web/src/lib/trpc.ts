/**
 * @package @devscope/web
 * @description tRPC 客户端配置
 *
 * 配置 tRPC React Query 客户端，用于调用后端 API。
 *
 * @module trpc
 */

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@devscope/api";

/**
 * tRPC React Query 客户端
 * @description 用于调用后端 tRPC API 的类型安全客户端
 *
 * @example
 * ```tsx
 * const { data, isLoading } = trpc.semanticSearch.useMutation();
 *
 * const handleSearch = () => {
 *   mutate({ repo: "vercel/next.js", query: "How to deploy?" });
 * };
 * ```
 */
export const trpc = createTRPCReact<AppRouter>({
  unstable_overrides: {
    useMutation: undefined,
    useQuery: undefined,
  },
});
