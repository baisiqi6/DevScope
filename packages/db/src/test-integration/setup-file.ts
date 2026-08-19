// integration project 的 setupFile（每个测试 worker）：
// 兼容层——globalSetup 已把派生测试库连接串写入 process.env.TEST_DATABASE_URL
// （fork worker 继承主进程环境）；CI 必填模式下缺失即 fail closed，防止静默跳过。

if (!process.env.TEST_DATABASE_URL && process.env.INTEGRATION_REQUIRED === "1") {
  throw new Error("INTEGRATION_REQUIRED=1 但未获得测试库连接串：集成用例不允许静默跳过");
}
