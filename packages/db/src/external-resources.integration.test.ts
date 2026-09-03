import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;

describeIntegration("external resources tenant constraints on PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString, max: 4 });
  const db = drizzle(pool, { schema });
  let userA: number;
  let userB: number;

  beforeAll(async () => {
    const [a] = await db.insert(schema.users).values({ email: `external-resource-a-${Date.now()}@test.invalid`, name: "resource A" }).returning({ id: schema.users.id });
    const [b] = await db.insert(schema.users).values({ email: `external-resource-b-${Date.now()}@test.invalid`, name: "resource B" }).returning({ id: schema.users.id });
    userA = a.id;
    userB = b.id;
  });

  beforeEach(async () => {
    await cleanResources();
  });

  async function cleanResources() {
    await db.delete(schema.externalResourceGroupMembers);
    await db.delete(schema.externalResourceContents);
    await db.delete(schema.externalResourceSaves);
    await db.delete(schema.externalResources);
    await db.delete(schema.externalResourceGroups);
  }

  afterAll(async () => {
    await cleanResources();
    await db.delete(schema.users).where(eq(schema.users.id, userA));
    await db.delete(schema.users).where(eq(schema.users.id, userB));
    await pool.end();
  });

  it("rejects cross-user save and group-member rows at the database boundary", async () => {
    const [resource] = await db.insert(schema.externalResources).values({
      userId: userA,
      resourceType: "website",
      url: "https://example.com/resource",
      canonicalUrl: "https://example.com/resource",
      title: "Resource",
    }).returning();
    const [group] = await db.insert(schema.externalResourceGroups).values({ userId: userA, name: "A group" }).returning();

    await expect(db.insert(schema.externalResourceSaves).values({ userId: userB, resourceId: resource.id })).rejects.toThrow();
    await expect(db.insert(schema.externalResourceGroupMembers).values({
      userId: userB,
      groupId: group.id,
      resourceId: resource.id,
    })).rejects.toThrow();
  });

  it("cascades saves and members when the owned resource is removed", async () => {
    const [resource] = await db.insert(schema.externalResources).values({
      userId: userA,
      resourceType: "article",
      url: "https://example.com/article",
      canonicalUrl: "https://example.com/article",
      title: "Article",
    }).returning();
    const [group] = await db.insert(schema.externalResourceGroups).values({ userId: userA, name: "Articles" }).returning();
    await db.insert(schema.externalResourceSaves).values({ userId: userA, resourceId: resource.id });
    await db.insert(schema.externalResourceGroupMembers).values({ userId: userA, groupId: group.id, resourceId: resource.id });
    await db.insert(schema.externalResourceContents).values({
      resourceId: resource.id,
      userId: userA,
      contentType: "html",
      contentText: "article body",
      byteLength: 12,
      contentHash: "hash",
      finalUrl: resource.url,
      parserVersion: "test",
    });

    await db.delete(schema.externalResources).where(eq(schema.externalResources.id, resource.id));
    expect(await db.select().from(schema.externalResourceSaves).where(eq(schema.externalResourceSaves.resourceId, resource.id))).toHaveLength(0);
    expect(await db.select().from(schema.externalResourceGroupMembers).where(eq(schema.externalResourceGroupMembers.resourceId, resource.id))).toHaveLength(0);
    expect(await db.select().from(schema.externalResourceContents).where(eq(schema.externalResourceContents.resourceId, resource.id))).toHaveLength(0);
  });

  it("enforces bounded preview metadata and tag shapes at the database boundary", async () => {
    const oversizedMetadata = { payload: "x".repeat(20_001) };
    const [resource] = await db.insert(schema.externalResources).values({
      userId: userA,
      resourceType: "website",
      url: "https://example.com/constraints",
      canonicalUrl: "https://example.com/constraints",
      title: "Constraint checks",
    }).returning();

    await expect(db.update(schema.externalResources)
      .set({ metadata: oversizedMetadata })
      .where(eq(schema.externalResources.id, resource.id))).rejects.toThrow();

    await expect(db.insert(schema.externalResourceSaves).values({
      userId: userA,
      resourceId: resource.id,
      tags: Array.from({ length: 31 }, (_, index) => `tag-${index}`),
    })).rejects.toThrow();
  });
});
