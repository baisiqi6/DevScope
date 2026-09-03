import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { router, publicProcedure } from "../trpc";
import { getOrCreateCurrentUserId } from "../current-user";
import {
  externalResourceGroups,
  externalResourceGroupMembers,
  externalResourceSaves,
  externalResources,
  externalResourceContents,
  enqueueExternalResourceContentJob,
  type Db,
} from "@devscope/db";
import {
  externalResourceGroupMemberOutputSchema,
  externalResourceGroupOutputSchema,
  externalResourceOutputSchema,
  externalResourceTypeSchema,
  saveExternalResourceInputSchema,
  updateExternalResourceInputSchema,
  requestExternalResourceContentInputSchema,
  externalResourceContentStatusOutputSchema,
  externalResourceContentOutputSchema,
} from "@devscope/shared";

export function canonicalizeExternalResourceUrl(value: string): string {
  const url = new URL(value.trim());
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }
  url.hash = "";
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

function serializeResource(row: {
  resource: typeof externalResources.$inferSelect;
  save: typeof externalResourceSaves.$inferSelect;
}) {
  return {
    id: row.resource.id,
    resourceType: row.resource.resourceType,
    url: row.resource.url,
    canonicalUrl: row.resource.canonicalUrl,
    title: row.resource.title,
    description: row.resource.description,
    siteName: row.resource.siteName,
    author: row.resource.author,
    publishedAt: row.resource.publishedAt?.toISOString() ?? null,
    faviconUrl: row.resource.faviconUrl,
    previewImageUrl: row.resource.previewImageUrl,
    metadata: row.resource.metadata,
    ingestionMode: row.resource.ingestionMode,
    contentStatus: row.resource.contentStatus,
    contentFetchedAt: row.resource.contentFetchedAt?.toISOString() ?? null,
    contentError: row.resource.contentError,
    notes: row.save.notes,
    tags: row.save.tags,
    isRead: row.save.isRead,
    isPinned: row.save.isPinned,
    createdAt: row.resource.createdAt.toISOString(),
    updatedAt: row.resource.updatedAt.toISOString(),
  };
}

async function requireOwnedResource(db: Db, userId: number, resourceId: number) {
  const [row] = await db
    .select({ resource: externalResources, save: externalResourceSaves })
    .from(externalResources)
    .innerJoin(
      externalResourceSaves,
      and(
        eq(externalResourceSaves.resourceId, externalResources.id),
        eq(externalResourceSaves.userId, userId),
      ),
    )
    .where(and(eq(externalResources.id, resourceId), eq(externalResources.userId, userId)))
    .limit(1);

  if (!row) {
    throw new Error("外部资源不存在或无权访问");
  }
  return row;
}

async function requireOwnedGroup(db: Db, userId: number, groupId: number) {
  const [group] = await db
    .select()
    .from(externalResourceGroups)
    .where(and(eq(externalResourceGroups.id, groupId), eq(externalResourceGroups.userId, userId)))
    .limit(1);
  if (!group) {
    throw new Error("外部资源分组不存在或无权访问");
  }
  return group;
}

export const externalResourcesRouter = router({
  requestContent: publicProcedure
    .input(requestExternalResourceContentInputSchema)
    .output(externalResourceContentStatusOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const row = await requireOwnedResource(ctx.db, userId, input.resourceId);
      if (row.resource.ingestionMode !== "content") throw new Error("该资源未启用正文采集");
      await enqueueExternalResourceContentJob(ctx.db, { userId, resourceId: input.resourceId });
      return { resourceId: input.resourceId, status: "pending" as const, error: null, fetchedAt: null };
    }),

  getContentStatus: publicProcedure
    .input(requestExternalResourceContentInputSchema)
    .output(externalResourceContentStatusOutputSchema)
    .query(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const { resource } = await requireOwnedResource(ctx.db, userId, input.resourceId);
      return { resourceId: resource.id, status: resource.contentStatus, error: resource.contentError, fetchedAt: resource.contentFetchedAt?.toISOString() ?? null };
    }),

  readContent: publicProcedure
    .input(requestExternalResourceContentInputSchema)
    .output(externalResourceContentOutputSchema)
    .query(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const { resource } = await requireOwnedResource(ctx.db, userId, input.resourceId);
      const [content] = await ctx.db.select().from(externalResourceContents)
        .where(and(eq(externalResourceContents.resourceId, resource.id), eq(externalResourceContents.userId, userId))).limit(1);
      if (!content) throw new Error("正文尚未采集");
      return { resourceId: resource.id, status: resource.contentStatus, error: resource.contentError, fetchedAt: resource.contentFetchedAt?.toISOString() ?? null, contentType: content.contentType as "html" | "pdf", text: content.contentText, finalUrl: content.finalUrl };
    }),

  list: publicProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      resourceType: externalResourceTypeSchema.optional(),
    }).default({}))
    .output(externalResourceOutputSchema.array())
    .query(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const rows = await ctx.db
        .select({ resource: externalResources, save: externalResourceSaves })
        .from(externalResources)
        .innerJoin(
          externalResourceSaves,
          and(
            eq(externalResourceSaves.resourceId, externalResources.id),
            eq(externalResourceSaves.userId, userId),
          ),
        )
        .where(and(
          eq(externalResources.userId, userId),
          input.resourceType ? eq(externalResources.resourceType, input.resourceType) : undefined,
        ))
        .orderBy(desc(externalResources.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return rows.map(serializeResource);
    }),

  get: publicProcedure
    .input(z.object({ resourceId: z.number().int().positive() }))
    .output(externalResourceOutputSchema)
    .query(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      return serializeResource(await requireOwnedResource(ctx.db, userId, input.resourceId));
    }),

  save: publicProcedure
    .input(saveExternalResourceInputSchema)
    .output(z.object({ created: z.boolean(), resource: externalResourceOutputSchema }))
    .mutation(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const canonicalUrl = canonicalizeExternalResourceUrl(input.url);
      const title = input.title ?? new URL(canonicalUrl).hostname;

      return ctx.db.transaction(async (tx) => {
        const [resource] = await tx
          .insert(externalResources)
          .values({
            userId,
            resourceType: input.resourceType,
            url: input.url.trim(),
            canonicalUrl,
            title,
            description: input.description,
            siteName: input.siteName,
            author: input.author,
            publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
            faviconUrl: input.faviconUrl,
            previewImageUrl: input.previewImageUrl,
            metadata: input.metadata,
            ingestionMode: "preview_only",
            contentStatus: "not_requested",
          })
          .onConflictDoNothing({ target: [externalResources.userId, externalResources.canonicalUrl] })
          .returning();

        const resourceId = resource?.id ?? (await tx
          .select({ id: externalResources.id })
          .from(externalResources)
          .where(and(eq(externalResources.userId, userId), eq(externalResources.canonicalUrl, canonicalUrl)))
          .limit(1))[0]?.id;
        if (!resourceId) throw new Error("保存外部资源失败");

        await tx
          .insert(externalResourceSaves)
          .values({
            userId,
            resourceId,
            tags: input.tags,
            notes: input.notes,
          })
          .onConflictDoNothing({ target: [externalResourceSaves.userId, externalResourceSaves.resourceId] });

        const [saved] = await tx
          .select({ resource: externalResources, save: externalResourceSaves })
          .from(externalResources)
          .innerJoin(externalResourceSaves, and(
            eq(externalResourceSaves.resourceId, externalResources.id),
            eq(externalResourceSaves.userId, userId),
          ))
          .where(and(eq(externalResources.id, resourceId), eq(externalResources.userId, userId)))
          .limit(1);
        if (!saved) throw new Error("保存外部资源收藏状态失败");
        return { created: Boolean(resource), resource: serializeResource(saved) };
      });
    }),

  update: publicProcedure
    .input(updateExternalResourceInputSchema)
    .output(externalResourceOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      await requireOwnedResource(ctx.db, userId, input.resourceId);
      const { resourceId, notes, tags, isRead, isPinned, ...resourceFields } = input;
      const resourcePatch = {
        ...(resourceFields.title !== undefined ? { title: resourceFields.title } : {}),
        ...(resourceFields.description !== undefined ? { description: resourceFields.description } : {}),
        ...(resourceFields.siteName !== undefined ? { siteName: resourceFields.siteName } : {}),
        ...(resourceFields.author !== undefined ? { author: resourceFields.author } : {}),
        ...(resourceFields.publishedAt !== undefined
          ? { publishedAt: resourceFields.publishedAt === null ? null : new Date(resourceFields.publishedAt) }
          : {}),
        ...(resourceFields.faviconUrl !== undefined ? { faviconUrl: resourceFields.faviconUrl } : {}),
        ...(resourceFields.previewImageUrl !== undefined ? { previewImageUrl: resourceFields.previewImageUrl } : {}),
        ...(resourceFields.metadata !== undefined ? { metadata: resourceFields.metadata } : {}),
      };
      const hasResourceFields = Object.keys(resourcePatch).length > 0;
      if (hasResourceFields) {
        await ctx.db.update(externalResources).set({
          ...resourcePatch,
          updatedAt: new Date(),
        }).where(and(eq(externalResources.id, resourceId), eq(externalResources.userId, userId)));
      }
      if (notes !== undefined || tags !== undefined || isRead !== undefined || isPinned !== undefined) {
        await ctx.db.update(externalResourceSaves).set({
          ...(notes !== undefined ? { notes } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(isRead !== undefined ? { isRead } : {}),
          ...(isPinned !== undefined ? { isPinned } : {}),
          updatedAt: new Date(),
        }).where(and(eq(externalResourceSaves.resourceId, resourceId), eq(externalResourceSaves.userId, userId)));
      }
      return serializeResource(await requireOwnedResource(ctx.db, userId, resourceId));
    }),

  remove: publicProcedure
    .input(z.object({ resourceId: z.number().int().positive() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      await requireOwnedResource(ctx.db, userId, input.resourceId);
      await ctx.db.delete(externalResources).where(and(
        eq(externalResources.id, input.resourceId),
        eq(externalResources.userId, userId),
      ));
      return { success: true };
    }),
});

export const externalResourceGroupsRouter = router({
  list: publicProcedure.output(externalResourceGroupOutputSchema.array()).query(async ({ ctx }) => {
    const userId = await getOrCreateCurrentUserId(ctx.db);
    const rows = await ctx.db
      .select({
        id: externalResourceGroups.id,
        userId: externalResourceGroups.userId,
        name: externalResourceGroups.name,
        color: externalResourceGroups.color,
        icon: externalResourceGroups.icon,
        description: externalResourceGroups.description,
        orderIndex: externalResourceGroups.orderIndex,
        createdAt: externalResourceGroups.createdAt,
        updatedAt: externalResourceGroups.updatedAt,
        resourceCount: sql<unknown>`count(distinct ${externalResources.id})`,
      })
      .from(externalResourceGroups)
      .leftJoin(externalResourceGroupMembers, and(
        eq(externalResourceGroupMembers.groupId, externalResourceGroups.id),
        eq(externalResourceGroupMembers.userId, userId),
      ))
      .leftJoin(externalResources, and(
        eq(externalResources.id, externalResourceGroupMembers.resourceId),
        eq(externalResources.userId, userId),
      ))
      .where(eq(externalResourceGroups.userId, userId))
      .groupBy(externalResourceGroups.id)
      .orderBy(externalResourceGroups.orderIndex);
    return rows.map((row) => ({
      ...row,
      resourceCount: Number(row.resourceCount ?? 0),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }),

  create: publicProcedure
    .input(z.object({ name: z.string().trim().min(1).max(50), description: z.string().trim().max(500).optional() }))
    .output(externalResourceGroupOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      const [group] = await ctx.db.insert(externalResourceGroups).values({ userId, ...input }).returning();
      if (!group) throw new Error("创建外部资源分组失败");
      return { ...group, resourceCount: 0, createdAt: group.createdAt.toISOString(), updatedAt: group.updatedAt.toISOString() };
    }),

  members: publicProcedure
    .input(z.object({ groupId: z.number().int().positive() }))
    .output(externalResourceGroupMemberOutputSchema.array())
    .query(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      await requireOwnedGroup(ctx.db, userId, input.groupId);
      const rows = await ctx.db
        .select({ member: externalResourceGroupMembers, resource: externalResources, save: externalResourceSaves })
        .from(externalResourceGroupMembers)
        .innerJoin(externalResources, eq(externalResources.id, externalResourceGroupMembers.resourceId))
        .innerJoin(externalResourceSaves, and(
          eq(externalResourceSaves.resourceId, externalResources.id),
          eq(externalResourceSaves.userId, userId),
        ))
        .where(and(
          eq(externalResourceGroupMembers.groupId, input.groupId),
          eq(externalResourceGroupMembers.userId, userId),
          eq(externalResources.userId, userId),
        ))
        .orderBy(externalResourceGroupMembers.orderIndex);
      return rows.map((row) => ({
        id: row.member.id,
        groupId: row.member.groupId,
        resourceId: row.member.resourceId,
        orderIndex: row.member.orderIndex,
        createdAt: row.member.createdAt.toISOString(),
        resource: serializeResource({ resource: row.resource, save: row.save }),
      }));
    }),

  add: publicProcedure
    .input(z.object({ groupId: z.number().int().positive(), resourceId: z.number().int().positive() }))
    .output(externalResourceGroupMemberOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      await requireOwnedGroup(ctx.db, userId, input.groupId);
      await requireOwnedResource(ctx.db, userId, input.resourceId);
      const [maxOrder] = await ctx.db.select({ max: sql<number>`max(${externalResourceGroupMembers.orderIndex})` })
        .from(externalResourceGroupMembers).where(and(
          eq(externalResourceGroupMembers.groupId, input.groupId),
          eq(externalResourceGroupMembers.userId, userId),
        ));
      const [member] = await ctx.db.insert(externalResourceGroupMembers).values({
        userId,
        groupId: input.groupId,
        resourceId: input.resourceId,
        orderIndex: (maxOrder?.max ?? -1) + 1,
      }).onConflictDoNothing({ target: [externalResourceGroupMembers.groupId, externalResourceGroupMembers.resourceId] }).returning();
      const savedMember = member ?? (await ctx.db.select().from(externalResourceGroupMembers).where(and(
        eq(externalResourceGroupMembers.groupId, input.groupId),
        eq(externalResourceGroupMembers.resourceId, input.resourceId),
        eq(externalResourceGroupMembers.userId, userId),
      )).limit(1))[0];
      if (!savedMember) throw new Error("添加外部资源到分组失败");
      return {
        id: savedMember.id,
        groupId: savedMember.groupId,
        resourceId: savedMember.resourceId,
        orderIndex: savedMember.orderIndex,
        createdAt: savedMember.createdAt.toISOString(),
        resource: serializeResource(await requireOwnedResource(ctx.db, userId, input.resourceId)),
      };
    }),

  remove: publicProcedure
    .input(z.object({ groupId: z.number().int().positive(), resourceId: z.number().int().positive() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = await getOrCreateCurrentUserId(ctx.db);
      await requireOwnedGroup(ctx.db, userId, input.groupId);
      await ctx.db.delete(externalResourceGroupMembers).where(and(
        eq(externalResourceGroupMembers.groupId, input.groupId),
        eq(externalResourceGroupMembers.resourceId, input.resourceId),
        eq(externalResourceGroupMembers.userId, userId),
      ));
      return { success: true };
    }),
});
