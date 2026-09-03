import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import * as schema from "@devscope/db";
import { closeDb, createDb } from "@devscope/db";
import { processExternalResourceContent } from "./worker";

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const PREFIX = "worker-content-test/";

describeIntegration("external content stale takeover on PostgreSQL", () => {
  const db = createDb(connectionString);
  let userId: number;

  beforeEach(async () => {
    const [user] = await db.insert(schema.users).values({ email: `${PREFIX}${Date.now()}@test.invalid`, name: "worker content" }).returning({ id: schema.users.id });
    userId = user.id;
  });

  afterAll(async () => {
    await db.delete(schema.jobs).where(eq(schema.jobs.userId, userId));
    await db.delete(schema.externalResources).where(like(schema.externalResources.url, `https://example.com/${PREFIX}%`));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await closeDb();
  });

  it("A 失租约后 B 接管完成，A 迟到写回被拒绝且只保留一份正文", async () => {
    const [resource] = await db.insert(schema.externalResources).values({
      userId,
      resourceType: "article",
      url: `https://example.com/${PREFIX}${Date.now()}`,
      canonicalUrl: `https://example.com/${PREFIX}${Date.now()}`,
      title: "worker content",
      ingestionMode: "content",
    }).returning();
    await db.insert(schema.externalResourceSaves).values({ userId, resourceId: resource.id });
    const now = new Date();
    const [jobA] = await db.insert(schema.jobs).values({
      userId, type: "external-resource.content", idempotencyKey: `${PREFIX}a`, payload: { resourceId: resource.id },
      status: "running", leaseOwner: "worker-a", leaseExpiresAt: new Date(now.getTime() + 60_000),
    }).returning();
    const lateFailure = async () => {
      await db.update(schema.jobs).set({ leaseExpiresAt: new Date(now.getTime() - 1_000) }).where(eq(schema.jobs.id, jobA.id));
      return { status: "failure" as const, errorKind: "transient_failure" as const, error: "late" };
    };
    await expect(processExternalResourceContent(db, userId, jobA.id, "worker-a", resource.id, lateFailure, () => now, 1)).rejects.toThrow(/claim 已失效|租约/);

    await db.update(schema.externalResources).set({ contentProcessingStartedAt: new Date(now.getTime() - 60_000) }).where(eq(schema.externalResources.id, resource.id));
    const [jobB] = await db.insert(schema.jobs).values({
      userId, type: "external-resource.content", idempotencyKey: `${PREFIX}b`, payload: { resourceId: resource.id },
      status: "running", leaseOwner: "worker-b", leaseExpiresAt: new Date(now.getTime() + 60_000),
    }).returning();
    const success = async () => ({ status: "success" as const, contentType: "html" as const, text: "B body", bytes: 6, finalUrl: resource.url, title: "worker content" });
    await expect(processExternalResourceContent(db, userId, jobB.id, "worker-b", resource.id, success, () => now, 1)).resolves.toMatchObject({ status: "completed" });

    await expect(processExternalResourceContent(db, userId, jobA.id, "worker-a", resource.id, success, () => now, 1)).rejects.toThrow(/租约/);
    expect(await db.select().from(schema.externalResourceContents).where(eq(schema.externalResourceContents.resourceId, resource.id))).toHaveLength(1);
    const [stored] = await db.select().from(schema.externalResourceContents).where(eq(schema.externalResourceContents.resourceId, resource.id));
    expect(stored.contentText).toBe("B body");
  });
});
