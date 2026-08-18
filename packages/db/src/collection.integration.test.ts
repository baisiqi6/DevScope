import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, like } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema";
import {
  applyRepositoryEmbeddingSnapshot,
  applySbomBackfillIfCurrent,
  claimRepositoryEmbeddingSnapshot,
  commitRepositoryCollectionSnapshot,
  markEmbeddingFailedForVersion,
  poolRepositoryEmbeddingForCurrentVersion,
  reconcileRepositoryEmbeddingStatus,
  updateEmbeddingProgressForVersion,
  type RepositoryCollectionSnapshot,
} from "./collection";

const connectionString = process.env.TEST_DATABASE_URL;
const describeIntegration = connectionString ? describe : describe.skip;
const PREFIX = "atomic-test/";
const VECTOR_DIMENSIONS = 1024;

function release(id: bigint, label: string) {
  return {
    id,
    tagName: `v-${label}`,
    name: label,
    body: null,
    author: "integration",
    createdAt: new Date("2026-08-18T00:00:00.000Z"),
    publishedAt: new Date("2026-08-18T00:00:00.000Z"),
    url: `https://api.github.test/releases/${id}`,
    htmlUrl: `https://github.test/releases/${id}`,
    zipUrl: null,
    tarUrl: null,
    assets: [],
    isPrerelease: false,
  };
}

function snapshot(
  githubRepositoryId: string,
  label: string,
  options: Partial<Pick<RepositoryCollectionSnapshot, "chunks" | "hackernews" | "releases" | "sbom">> = {},
): RepositoryCollectionSnapshot {
  const numericId = BigInt(githubRepositoryId) * 1000n + BigInt(label.charCodeAt(0));
  return {
    repository: {
      githubRepositoryId,
      fullName: `${PREFIX}${githubRepositoryId}`,
      name: githubRepositoryId,
      owner: "atomic-test",
      description: label,
      url: `https://github.test/${githubRepositoryId}`,
      stars: 1,
      forks: 0,
      openIssues: 0,
      language: "TypeScript",
      license: "MIT",
      readme: label,
      readmeUrl: null,
      lastFetchedAt: new Date(),
      isReference: false,
    },
    chunks: options.chunks ?? [{
      content: `chunk-${label}`,
      chunkType: "readme",
      sourceId: null,
      chunkIndex: 0,
      embedding: null,
      tokenCount: 1,
    }],
    hackernews: options.hackernews ?? {
      status: "success",
      items: [{
        type: "story",
        title: `hn-${label}`,
        content: null,
        author: "integration",
        score: 1,
        descendants: 0,
        url: null,
        rawJson: { label },
      }],
    },
    releases: options.releases ?? { status: "success", items: [release(numericId, label)] },
    sbom: options.sbom ?? {
      status: "success",
      packages: [{ name: `pkg-${label}`, version: "1.0.0", system: "npm" }],
    },
    allowNewStableIdentity: true,
  };
}

describeIntegration("atomic repository collection on PostgreSQL", () => {
  const pool = new pg.Pool({ connectionString, max: 8 });
  const db = drizzle(pool, { schema });

  async function clean() {
    const repos = await db.select({ id: schema.repositories.id })
      .from(schema.repositories)
      .where(like(schema.repositories.fullName, `${PREFIX}%`));
    for (const repo of repos) {
      await db.delete(schema.repoChunks).where(eq(schema.repoChunks.repoId, repo.id));
      await db.delete(schema.hackernewsItems).where(eq(schema.hackernewsItems.repoId, repo.id));
      await db.delete(schema.releases).where(eq(schema.releases.repoId, repo.id));
      await db.delete(schema.repositories).where(eq(schema.repositories.id, repo.id));
    }
  }

  beforeAll(async () => {
    await pool.query("select 1");
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await pool.end();
  });

  it("新仓库 token 可无损回传，成功空集清除三类旧数据和 mean", async () => {
    const first = await commitRepositoryCollectionSnapshot(db, snapshot("910001", "A"));
    const micros = await pool.query<{ micros: string }>(
      "select extract(microseconds from updated_at)::text as micros from repositories where id = $1",
      [first.repository.id],
    );
    expect(Number(micros.rows[0].micros) % 1000).toBe(0);

    const claimed = await claimRepositoryEmbeddingSnapshot(db, first.repository.id, first.version);
    expect(claimed.status).toBe("claimed");

    const second = await commitRepositoryCollectionSnapshot(db, snapshot("910001", "B", {
      chunks: [],
      hackernews: { status: "success", items: [] },
      releases: { status: "success", items: [] },
      sbom: { status: "success", packages: [] },
    }));
    expect(second.version.getTime()).toBeGreaterThan(first.version.getTime());

    const [repository] = await db.select().from(schema.repositories)
      .where(eq(schema.repositories.id, first.repository.id));
    expect(repository).toMatchObject({
      embedding: null,
      embeddingStatus: "completed",
      embeddingTotalChunks: 0,
      embeddingCompletedChunks: 0,
    });
    expect(await db.select().from(schema.repoChunks).where(eq(schema.repoChunks.repoId, repository.id))).toHaveLength(0);
    expect(await db.select().from(schema.hackernewsItems).where(eq(schema.hackernewsItems.repoId, repository.id))).toHaveLength(0);
    expect(await db.select().from(schema.releases).where(eq(schema.releases.repoId, repository.id))).toHaveLength(0);
    expect(repository.sbomPackages).toEqual([]);
  });

  it("optional failure/skipped 保留旧来源，但主 chunks 仍整体更新", async () => {
    const first = await commitRepositoryCollectionSnapshot(db, snapshot("910002", "A"));
    await commitRepositoryCollectionSnapshot(db, snapshot("910002", "B", {
      hackernews: { status: "failure", error: "hn down" },
      releases: { status: "skipped" },
      sbom: { status: "failure", error: "sbom down" },
    }));

    const chunks = await db.select().from(schema.repoChunks).where(eq(schema.repoChunks.repoId, first.repository.id));
    const hn = await db.select().from(schema.hackernewsItems).where(eq(schema.hackernewsItems.repoId, first.repository.id));
    const storedReleases = await db.select().from(schema.releases).where(eq(schema.releases.repoId, first.repository.id));
    const [repository] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, first.repository.id));
    expect(chunks.map((row) => row.content)).toEqual(["chunk-B"]);
    expect(hn.map((row) => row.title)).toEqual(["hn-A"]);
    expect(storedReleases.map((row) => row.name)).toEqual(["A"]);
    expect(repository.sbomPackages).toEqual([{ name: "pkg-A", version: "1.0.0", system: "npm" }]);
  });

  it("insert 失败整体回滚，metadata、token 与上一快照不变", async () => {
    const first = await commitRepositoryCollectionSnapshot(db, snapshot("910003", "A"));
    const duplicate = release(910003999n, "duplicate");
    const bad = snapshot("910003", "B", {
      releases: { status: "success", items: [duplicate, duplicate] },
    });

    await expect(commitRepositoryCollectionSnapshot(db, bad)).rejects.toThrow();

    const [repository] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, first.repository.id));
    const chunks = await db.select().from(schema.repoChunks).where(eq(schema.repoChunks.repoId, first.repository.id));
    expect(repository.updatedAt.getTime()).toBe(first.version.getTime());
    expect(repository.description).toBe("A");
    expect(chunks.map((row) => row.content)).toEqual(["chunk-A"]);
  });

  it("并发提交按 stable ID 串行且三来源不交叉", async () => {
    const [a, b] = await Promise.all([
      commitRepositoryCollectionSnapshot(db, snapshot("910004", "A")),
      commitRepositoryCollectionSnapshot(db, snapshot("910004", "B")),
    ]);
    expect(a.version.getTime()).not.toBe(b.version.getTime());
    const latestLabel = a.version > b.version ? "A" : "B";
    const repoId = a.repository.id;
    const chunks = await db.select().from(schema.repoChunks).where(eq(schema.repoChunks.repoId, repoId));
    const hn = await db.select().from(schema.hackernewsItems).where(eq(schema.hackernewsItems.repoId, repoId));
    const storedReleases = await db.select().from(schema.releases).where(eq(schema.releases.repoId, repoId));
    const [repository] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, repoId));
    expect(chunks[0].content).toBe(`chunk-${latestLabel}`);
    expect(hn[0].title).toBe(`hn-${latestLabel}`);
    expect(storedReleases[0].name).toBe(latestLabel);
    expect(repository.description).toBe(latestLabel);
    expect(repository.sbomPackages?.[0]?.name).toBe(`pkg-${latestLabel}`);
  });

  it("claim 将 token 与 chunks 绑定，旧 token 无法覆盖新快照", async () => {
    const first = await commitRepositoryCollectionSnapshot(db, snapshot("910005", "A"));
    const second = await commitRepositoryCollectionSnapshot(db, snapshot("910005", "B"));
    expect(await claimRepositoryEmbeddingSnapshot(db, first.repository.id, first.version))
      .toEqual({ status: "stale" });

    const claim = await claimRepositoryEmbeddingSnapshot(db, second.repository.id, second.version);
    expect(claim.status).toBe("claimed");
    if (claim.status !== "claimed") throw new Error("expected claim");
    expect(claim.chunks.map((chunk) => chunk.content)).toEqual(["chunk-B"]);
    const vector = new Array(VECTOR_DIMENSIONS).fill(1);
    expect(await applyRepositoryEmbeddingSnapshot(db, {
      repoId: second.repository.id,
      expectedVersion: first.version,
      chunks: claim.chunks.map((chunk) => ({ ...chunk, embedding: vector })),
      repositoryEmbedding: vector,
    })).toEqual({ status: "stale" });
    expect((await applyRepositoryEmbeddingSnapshot(db, {
      repoId: second.repository.id,
      expectedVersion: second.version,
      chunks: claim.chunks.map((chunk) => ({ ...chunk, embedding: vector })),
      repositoryEmbedding: vector,
    })).status).toBe("applied");
    const chunks = await db.select().from(schema.repoChunks).where(eq(schema.repoChunks.repoId, second.repository.id));
    expect(chunks.map((chunk) => chunk.content)).toEqual(["chunk-B"]);
    expect(chunks[0].embedding).toHaveLength(VECTOR_DIMENSIONS);
  });

  it("reconcile 不撤销活跃 claim，也不把 failed 变成无人持有的 processing", async () => {
    const active = await commitRepositoryCollectionSnapshot(db, snapshot("910008", "A"));
    const activeClaim = await claimRepositoryEmbeddingSnapshot(db, active.repository.id, active.version);
    if (activeClaim.status !== "claimed") throw new Error("expected active claim");

    expect(await reconcileRepositoryEmbeddingStatus(db, active.repository.id)).toMatchObject({
      status: "processing",
      changed: false,
    });
    expect(await claimRepositoryEmbeddingSnapshot(db, active.repository.id, active.version))
      .toEqual({ status: "not_claimed" });

    const ones = new Array(VECTOR_DIMENSIONS).fill(1);
    expect((await applyRepositoryEmbeddingSnapshot(db, {
      repoId: active.repository.id,
      expectedVersion: active.version,
      chunks: activeClaim.chunks.map((chunk) => ({ ...chunk, embedding: ones })),
      repositoryEmbedding: ones,
    })).status).toBe("applied");

    const failed = await commitRepositoryCollectionSnapshot(db, snapshot("910009", "A", {
      chunks: [
        { content: "ok", chunkType: "readme", sourceId: null, chunkIndex: 0, embedding: null, tokenCount: 1 },
        { content: "failed", chunkType: "issues", sourceId: "1", chunkIndex: 1, embedding: null, tokenCount: 1 },
      ],
    }));
    const failedClaim = await claimRepositoryEmbeddingSnapshot(db, failed.repository.id, failed.version);
    if (failedClaim.status !== "claimed") throw new Error("expected failed claim");
    expect((await applyRepositoryEmbeddingSnapshot(db, {
      repoId: failed.repository.id,
      expectedVersion: failed.version,
      chunks: failedClaim.chunks.map((chunk, index) => ({
        ...chunk,
        embedding: index === 0 ? ones : null,
      })),
      repositoryEmbedding: ones,
      error: "one chunk failed",
    })).status).toBe("failed");
    expect(await reconcileRepositoryEmbeddingStatus(db, failed.repository.id)).toMatchObject({
      status: "failed",
      changed: false,
    });
    expect(await claimRepositoryEmbeddingSnapshot(db, failed.repository.id, failed.version))
      .toEqual({ status: "not_claimed" });
  });

  it("新 token 提交与旧 progress/failure/final 交错时旧 writer 全部零写入", async () => {
    const committed = await commitRepositoryCollectionSnapshot(db, snapshot("910010", "A"));
    const claim = await claimRepositoryEmbeddingSnapshot(db, committed.repository.id, committed.version);
    if (claim.status !== "claimed") throw new Error("expected claim");

    const client = await pool.connect();
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1::integer, hashtext($2))", [0x4453_5643, "910010"]);
    await client.query(
      "update repositories set updated_at = updated_at + interval '1 millisecond', embedding_status = 'pending', embedding_error = null where id = $1",
      [committed.repository.id],
    );

    let progressFinished = false;
    let failureFinished = false;
    let finalFinished = false;
    const progress = updateEmbeddingProgressForVersion(db, committed.repository.id, committed.version, 1, 1)
      .finally(() => { progressFinished = true; });
    const failure = markEmbeddingFailedForVersion(db, committed.repository.id, committed.version, "stale failure")
      .finally(() => { failureFinished = true; });
    const ones = new Array(VECTOR_DIMENSIONS).fill(1);
    const final = applyRepositoryEmbeddingSnapshot(db, {
      repoId: committed.repository.id,
      expectedVersion: committed.version,
      chunks: claim.chunks.map((chunk) => ({ ...chunk, embedding: ones })),
      repositoryEmbedding: ones,
    }).finally(() => { finalFinished = true; });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect([progressFinished, failureFinished, finalFinished]).toEqual([false, false, false]);
    await client.query("commit");
    client.release();

    expect(await progress).toBe(false);
    expect(await failure).toBe(false);
    expect(await final).toEqual({ status: "stale" });
    const [repository] = await db.select().from(schema.repositories)
      .where(eq(schema.repositories.id, committed.repository.id));
    expect(repository.embeddingStatus).toBe("pending");
    expect(repository.embeddingError).toBeNull();
  });

  it("embedding final 写入失败整体回滚，再由当前 token 条件记录 failed", async () => {
    const committed = await commitRepositoryCollectionSnapshot(db, snapshot("910011", "A"));
    const claim = await claimRepositoryEmbeddingSnapshot(db, committed.repository.id, committed.version);
    if (claim.status !== "claimed") throw new Error("expected claim");

    await expect(applyRepositoryEmbeddingSnapshot(db, {
      repoId: committed.repository.id,
      expectedVersion: committed.version,
      chunks: claim.chunks.map((chunk) => ({ ...chunk, embedding: [1, 2] })),
      repositoryEmbedding: [1, 2],
    })).rejects.toThrow();

    const chunksAfterRollback = await db.select().from(schema.repoChunks)
      .where(eq(schema.repoChunks.repoId, committed.repository.id));
    const [processingRepository] = await db.select().from(schema.repositories)
      .where(eq(schema.repositories.id, committed.repository.id));
    expect(chunksAfterRollback.map((chunk) => chunk.content)).toEqual(["chunk-A"]);
    expect(chunksAfterRollback[0].embedding).toBeNull();
    expect(processingRepository.embeddingStatus).toBe("processing");

    expect(await markEmbeddingFailedForVersion(
      db,
      committed.repository.id,
      committed.version,
      "invalid vector",
    )).toBe(true);
    const [failedRepository] = await db.select().from(schema.repositories)
      .where(eq(schema.repositories.id, committed.repository.id));
    expect(failedRepository.embeddingStatus).toBe("failed");
    expect(failedRepository.embeddingError).toBe("invalid vector");
  });

  it("SBOM backfill 的旧 baseline 不能覆盖新采集", async () => {
    const first = await commitRepositoryCollectionSnapshot(db, snapshot("910006", "A", {
      sbom: { status: "success", packages: [] },
    }));
    const second = await commitRepositoryCollectionSnapshot(db, snapshot("910006", "B"));
    expect(await applySbomBackfillIfCurrent(db, {
      repoId: first.repository.id,
      githubRepositoryId: "910006",
      expectedVersion: first.version,
      baseline: [],
      packages: [{ name: "stale", version: "1.0.0", system: "npm" }],
    })).toBe("stale");
    const [repository] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, second.repository.id));
    expect(repository.sbomPackages?.[0]?.name).toBe("pkg-B");
  });

  it("pooling 与 reconcile 等待同一锁，并在锁后读取稳定 chunks", async () => {
    const committed = await commitRepositoryCollectionSnapshot(db, snapshot("910007", "A"));
    const claim = await claimRepositoryEmbeddingSnapshot(db, committed.repository.id, committed.version);
    if (claim.status !== "claimed") throw new Error("expected claim");
    const ones = new Array(VECTOR_DIMENSIONS).fill(1);
    await applyRepositoryEmbeddingSnapshot(db, {
      repoId: committed.repository.id,
      expectedVersion: committed.version,
      chunks: claim.chunks.map((chunk) => ({ ...chunk, embedding: ones })),
      repositoryEmbedding: ones,
    });

    const client = await pool.connect();
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock($1::integer, hashtext($2))", [0x4453_5643, "910007"]);
    const twos = `[${new Array(VECTOR_DIMENSIONS).fill(2).join(",")}]`;
    await client.query("update repo_chunks set embedding = $1::vector where repo_id = $2", [twos, committed.repository.id]);

    let poolFinished = false;
    const pooling = poolRepositoryEmbeddingForCurrentVersion(db, committed.repository.id)
      .finally(() => { poolFinished = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(poolFinished).toBe(false);
    await client.query("commit");
    client.release();
    expect(await pooling).toBe("applied");

    await pool.query(
      "update repositories set embedding_status = 'completed', embedding_progress = 0, embedding_total_chunks = 99, embedding_completed_chunks = 98 where id = $1",
      [committed.repository.id],
    );
    const reconciled = await reconcileRepositoryEmbeddingStatus(db, committed.repository.id);
    expect(reconciled).toMatchObject({ status: "completed", changed: true });
    const [repository] = await db.select().from(schema.repositories).where(eq(schema.repositories.id, committed.repository.id));
    expect(repository.embedding?.[0]).toBeCloseTo(2);
    expect(repository.embeddingStatus).toBe("completed");
    expect(repository.embeddingProgress).toBe(100);
    expect(repository.embeddingTotalChunks).toBe(1);
    expect(repository.embeddingCompletedChunks).toBe(1);
  });
});
