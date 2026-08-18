export const fastifyOptions = {
  logger: true,
  bodyLimit: 10 * 1024 * 1024,
  // tRPC batch 把多个 procedure 名放在同一路径参数中；Fastify 默认只允许 100 字符。
  routerOptions: { maxParamLength: 512 },
};
