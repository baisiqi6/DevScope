import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRunAgentWorkflow, mockGetCurrentUserId, mockDb } = vi.hoisted(() => ({
  mockRunAgentWorkflow: vi.fn(),
  mockGetCurrentUserId: vi.fn(),
  mockDb: {},
}));

vi.mock("@devscope/db", () => ({
  createDb: () => mockDb,
}));

vi.mock("../../current-user", () => ({
  getOrCreateCurrentUserId: mockGetCurrentUserId,
}));

vi.mock("../../services/agent-workflow", () => ({
  runAgentWorkflow: mockRunAgentWorkflow,
}));

import { registerAgentWorkflowSSE } from "./agent-workflow";

describe("Agent workflow SSE route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue(1);
  });

  it("拒绝不符合共享 schema 的请求", async () => {
    const fastify = Fastify();
    await registerAgentWorkflowSSE(fastify);

    const response = await fastify.inject({
      method: "POST",
      url: "/api/agent/workflow/stream",
      payload: { repos: ["not-a-repo"], analysisType: "health_report" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(expect.objectContaining({ error: "Invalid workflow request" }));
    expect(mockRunAgentWorkflow).not.toHaveBeenCalled();
    await fastify.close();
  });

  it("并发请求不会改写进程全局 console", async () => {
    const fastify = Fastify();
    await registerAgentWorkflowSSE(fastify);
    const originalConsoleLog = console.log;
    const releases: Array<() => void> = [];

    mockRunAgentWorkflow.mockImplementation(async (_db, _userId, _input, callbacks) => {
      expect(console.log).toBe(originalConsoleLog);
      await new Promise<void>((resolve) => releases.push(resolve));
      expect(console.log).toBe(originalConsoleLog);
      callbacks.onEvent?.({
        type: "complete",
        data: {
          executionId: "execution-1",
          status: "completed",
          timestamp: new Date().toISOString(),
        },
      });
    });

    const requests = ["owner/one", "owner/two"].map((repo) => fastify.inject({
      method: "POST",
      url: "/api/agent/workflow/stream",
      payload: { repos: [repo], analysisType: "health_report" },
    }));

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(console.log).toBe(originalConsoleLog);
    releases.forEach((release) => release());
    const responses = await Promise.all(requests);

    expect(responses).toHaveLength(2);
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(console.log).toBe(originalConsoleLog);
    await fastify.close();
  });
});
