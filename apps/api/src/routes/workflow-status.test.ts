import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workflowExecutions } from "@devscope/db";

const { mockGetCurrentUserId, mockWhere, mockDb } = vi.hoisted(() => {
  const mockWhere = vi.fn(() => ({
    limit: vi.fn().mockResolvedValue([]),
  }));

  return {
    mockGetCurrentUserId: vi.fn(),
    mockWhere,
    mockDb: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: mockWhere })),
      })),
    },
  };
});

vi.mock("@devscope/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@devscope/db")>();
  return { ...original, createDb: () => mockDb };
});

vi.mock("../current-user", () => ({
  getOrCreateCurrentUserId: mockGetCurrentUserId,
}));

import { registerWorkflowStatusRoute } from "./workflow-status";

describe("workflow status tenant boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue(7);
  });

  it("查询 execution 时同时加入当前 userId 条件", async () => {
    const fastify = Fastify();
    await registerWorkflowStatusRoute(fastify);

    const response = await fastify.inject({
      method: "GET",
      url: "/api/workflow/status/execution-1",
    });

    expect(response.statusCode).toBe(404);
    expect(mockGetCurrentUserId).toHaveBeenCalledWith(mockDb);
    expect(mockWhere).toHaveBeenCalledOnce();
    expect(containsIdentity(mockWhere.mock.calls[0]?.[0], workflowExecutions.userId)).toBe(true);
    await fastify.close();
  });
});

function containsIdentity(root: unknown, target: unknown, seen = new WeakSet<object>()): boolean {
  if (root === target) return true;
  if (typeof root !== "object" || root === null || seen.has(root)) return false;
  seen.add(root);
  return Reflect.ownKeys(root).some((key) => containsIdentity(
    (root as Record<PropertyKey, unknown>)[key],
    target,
    seen,
  ));
}
