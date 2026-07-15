/**
 * 当前单用户解析边界。
 *
 * 公开多用户版接入会话鉴权后，只需要替换这里的解析逻辑，业务查询仍然
 * 显式接收并过滤 `userId`，避免把租户边界散落到各个路由中。
 */

import { users, type Db } from "@devscope/db";

const DEFAULT_USER_EMAIL = "default@devscope.local";

export async function findCurrentUserId(db: Db): Promise<number | null> {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  return user?.id ?? null;
}

export async function getOrCreateCurrentUserId(db: Db): Promise<number> {
  const existingUserId = await findCurrentUserId(db);

  if (existingUserId !== null) {
    return existingUserId;
  }

  const [createdUser] = await db
    .insert(users)
    .values({
      name: "default",
      email: DEFAULT_USER_EMAIL,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: { updatedAt: new Date() },
    })
    .returning({ id: users.id });

  if (!createdUser) {
    throw new Error("无法初始化当前用户");
  }

  return createdUser.id;
}
