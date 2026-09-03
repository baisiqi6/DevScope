import {
  createDevScopeClientFromEnv,
  type DevScopeClient,
  type EmbeddingStatus,
} from '@devscope/client';
import { externalResourceTypeSchema, groupColorEnum } from '@devscope/shared';

export const CLI_VERSION = '0.0.1';

const HELP_TEXT = `DevScope CLI

用法:
  devscope health
  devscope repo list [--limit <1-100>] [--offset <n>]
  devscope repo get <repo-id>
  devscope repo delete-impact <repo-id>
  devscope repo archive <repo-id>       # 归档；恢复使用 unarchive
  devscope repo unarchive <repo-id>     # 通过 repo-id 恢复归档仓库
  devscope repo delete <repo-id> --confirm
  devscope repo collect <owner/repo> [--skip-embeddings] [--wait]
                        [--poll-interval-ms <ms>] [--timeout-ms <ms>]
  devscope repo embedding-status <repo-id>
  devscope repo note <repo-id> <text>
  devscope search <owner/repo> <query> [--limit <1-20>] [--no-answer]
  devscope group list
  devscope group tree
  devscope group create <name> [--description <text>] [--parent-id <group-id>]
  devscope group update <group-id> [--name <text>] [--description <text>]
                           [--color <color>] [--icon <icon>]
  devscope group delete <group-id> --confirm
  devscope group members <group-id>
  devscope group aggregate-members <group-id>
  devscope group move <group-id> <parent-id|root>
  devscope group reorder <parent-id|root> <group-id> [<group-id>...]
  devscope group add <group-id> <repo-id>
  devscope group remove <group-id> <repo-id>
  devscope resource list [--type article|paper|website]
  devscope resource save <url> --type article|paper|website [--title <text>]
                          [--description <text>] [--notes <text>] [--tags a,b]
  devscope resource get <resource-id>
  devscope resource update <resource-id> [--title <text>] [--notes <text>]
  devscope resource remove <resource-id>
  devscope resource content-request <resource-id>
  devscope resource content-enable <resource-id>
  devscope resource content-status <resource-id>
  devscope resource content-read <resource-id>
  devscope resource-group list
  devscope resource-group create <name> [--description <text>]
  devscope resource-group members <group-id>
  devscope resource-group add <group-id> <resource-id>
  devscope resource-group remove <group-id> <resource-id>
  devscope analyze start <owner/repo>
  devscope analyze status <execution-id>
  devscope analyze report <execution-id> [--wait]
                          [--poll-interval-ms <ms>] [--timeout-ms <ms>]
  devscope --help
  devscope --version

环境变量:
  DEVSCOPE_BASE_URL   API 地址，默认 http://localhost:3100
  DEVSCOPE_USERNAME   Basic Auth 用户名（与密码同时设置，仅 HTTPS/本机回环）
  DEVSCOPE_PASSWORD   Basic Auth 密码（与用户名同时设置，仅 HTTPS/本机回环）`;

class CliUsageError extends Error {}

export interface CliOutput {
  write(value: string): void;
}

export interface CliDependencies {
  createClient?: () => DevScopeClient;
  stdout?: CliOutput;
  stderr?: CliOutput;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface ParsedOptions {
  positionals: string[];
  values: Map<string, string>;
  flags: Set<string>;
}

function parseOptions(
  args: string[],
  valueOptions: ReadonlySet<string>,
  flagOptions: ReadonlySet<string>
): ParsedOptions {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      positionals.push(argument);
      continue;
    }

    if (flagOptions.has(argument)) {
      flags.add(argument);
      continue;
    }

    if (valueOptions.has(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new CliUsageError(`${argument} 缺少参数值`);
      }
      values.set(argument, value);
      index += 1;
      continue;
    }

    throw new CliUsageError(`未知参数: ${argument}`);
  }

  return { positionals, values, flags };
}

function parseInteger(
  value: string | undefined,
  name: string,
  defaultValue?: number,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (value === undefined && defaultValue !== undefined) {
    return defaultValue;
  }
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new CliUsageError(`${name} 必须是整数`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CliUsageError(`${name} 必须在 ${minimum} 到 ${maximum} 之间`);
  }
  return parsed;
}

function expectPositionals(positionals: string[], count: number, usage: string): void {
  if (positionals.length !== count) {
    throw new CliUsageError(`用法: ${usage}`);
  }
}

function writeJson(output: CliOutput, value: unknown): void {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function waitForEmbedding(
  client: DevScopeClient,
  repoId: number,
  pollIntervalMs: number,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>
): Promise<EmbeddingStatus> {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const status = await client.getEmbeddingStatus(repoId);
    if (status.status === 'completed') {
      return status;
    }
    if (status.status === 'failed') {
      throw new Error(status.error ?? '仓库向量化失败');
    }
    if (Date.now() >= deadline) {
      throw new Error(`等待向量化超时（${timeoutMs}ms）`);
    }
    await sleep(pollIntervalMs);
  }
}

async function waitForAnalysis(
  client: DevScopeClient,
  executionId: string,
  pollIntervalMs: number,
  timeoutMs: number,
  sleep: (milliseconds: number) => Promise<void>
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const status = await client.getAnalysisStatus(executionId);
    if (status.status === 'completed') {
      return;
    }
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new Error(status.error ?? '分析执行失败');
    }
    if (Date.now() >= deadline) {
      throw new Error(`等待分析完成超时（${timeoutMs}ms）`);
    }
    await sleep(pollIntervalMs);
  }
}

async function runGroupCommand(
  args: string[],
  client: DevScopeClient,
): Promise<unknown> {
  const [command, ...rest] = args;

  if (command === 'list') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 0, 'devscope group list');
    return client.listGroups();
  }

  if (command === 'tree') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 0, 'devscope group tree');
    return client.getGroupTree();
  }

  if (command === 'create') {
    const parsed = parseOptions(rest, new Set(['--description', '--parent-id']), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope group create <name> [--description <text>] [--parent-id <group-id>]');
    return client.createGroup({
      name: parsed.positionals[0],
      description: parsed.values.get('--description'),
      parentId: parsed.values.has('--parent-id')
        ? parseInteger(parsed.values.get('--parent-id'), '--parent-id', undefined, 1)
        : undefined,
    });
  }

  if (command === 'update') {
    const parsed = parseOptions(
      rest,
      new Set(['--name', '--description', '--color', '--icon']),
      new Set(),
    );
    expectPositionals(parsed.positionals, 1, 'devscope group update <group-id> [options]');
    if (parsed.values.size === 0) {
      throw new CliUsageError('group update 至少需要一个可更新字段');
    }
    return client.updateGroup({
      groupId: parseInteger(parsed.positionals[0], 'group-id', undefined, 1),
      name: parsed.values.get('--name'),
      description: parsed.values.get('--description'),
      color: parseGroupColor(parsed.values.get('--color')),
      icon: parsed.values.get('--icon'),
    });
  }

  if (command === 'delete') {
    const parsed = parseOptions(rest, new Set(), new Set(['--confirm']));
    expectPositionals(parsed.positionals, 1, 'devscope group delete <group-id> --confirm');
    if (!parsed.flags.has('--confirm')) {
      throw new CliUsageError('group delete 需要显式 --confirm');
    }
    return client.deleteGroup(parseInteger(parsed.positionals[0], 'group-id', undefined, 1), true);
  }

  if (command === 'members') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope group members <group-id>');
    const groupId = parseInteger(parsed.positionals[0], 'group-id', undefined, 1);
    return client.getGroupWithMembers(groupId);
  }

  if (command === 'aggregate-members') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope group aggregate-members <group-id>');
    const groupId = parseInteger(parsed.positionals[0], 'group-id', undefined, 1);
    return client.getAggregateGroupWithMembers(groupId);
  }

  if (command === 'move') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 2, 'devscope group move <group-id> <parent-id|root>');
    const groupId = parseInteger(parsed.positionals[0], 'group-id', undefined, 1);
    const parentId = parsed.positionals[1] === 'root'
      ? null
      : parseInteger(parsed.positionals[1], 'parent-id', undefined, 1);
    return client.moveGroup(groupId, parentId);
  }

  if (command === 'reorder') {
    const parsed = parseOptions(rest, new Set(), new Set());
    if (parsed.positionals.length < 2) {
      throw new CliUsageError('用法: devscope group reorder <parent-id|root> <group-id> [<group-id>...]');
    }
    const parentId = parsed.positionals[0] === 'root'
      ? null
      : parseInteger(parsed.positionals[0], 'parent-id', undefined, 1);
    const groupIds = parsed.positionals.slice(1).map((value) =>
      parseInteger(value, 'group-id', undefined, 1));
    return client.reorderGroupSiblings(parentId, groupIds);
  }

  if (command === 'add') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 2, 'devscope group add <group-id> <repo-id>');
    const groupId = parseInteger(parsed.positionals[0], 'group-id', undefined, 1);
    const repoId = parseInteger(parsed.positionals[1], 'repo-id', undefined, 1);
    return client.addRepoToGroup(groupId, repoId);
  }

  if (command === 'remove') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 2, 'devscope group remove <group-id> <repo-id>');
    const groupId = parseInteger(parsed.positionals[0], 'group-id', undefined, 1);
    const repoId = parseInteger(parsed.positionals[1], 'repo-id', undefined, 1);
    return client.removeRepoFromGroup(groupId, repoId);
  }

  throw new CliUsageError('用法: devscope group <list|tree|create|update|delete|members|aggregate-members|move|reorder|add|remove> ...');
}

function parseExternalResourceType(value: string | undefined): 'article' | 'paper' | 'website' | undefined {
  if (value === undefined) return undefined;
  const parsed = externalResourceTypeSchema.safeParse(value);
  if (!parsed.success) throw new CliUsageError('--type 必须是 article、paper 或 website');
  return parsed.data;
}

function parseGroupColor(value: string | undefined): 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'pink' | undefined {
  if (value === undefined) return undefined;
  const parsed = groupColorEnum.safeParse(value);
  if (!parsed.success) throw new CliUsageError('--color 必须是 blue、green、purple、orange、red 或 pink');
  return parsed.data;
}

function parseTags(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))];
}

function parseMetadata(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('metadata 必须是 JSON 对象');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new CliUsageError(`--metadata-json 不是有效的 JSON 对象: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runResourceCommand(args: string[], client: DevScopeClient): Promise<unknown> {
  const [command, ...rest] = args;

  if (command === 'list') {
    const parsed = parseOptions(rest, new Set(['--limit', '--offset', '--type']), new Set());
    expectPositionals(parsed.positionals, 0, 'devscope resource list [options]');
    return client.listExternalResources({
      limit: parseInteger(parsed.values.get('--limit'), '--limit', 50, 1, 100),
      offset: parseInteger(parsed.values.get('--offset'), '--offset', 0),
      resourceType: parseExternalResourceType(parsed.values.get('--type')),
    });
  }

  if (command === 'save') {
    const parsed = parseOptions(
      rest,
      new Set(['--type', '--title', '--description', '--site-name', '--author', '--published-at', '--favicon-url', '--preview-image-url', '--metadata-json', '--notes', '--tags']),
      new Set(),
    );
    expectPositionals(parsed.positionals, 1, 'devscope resource save <url> --type <article|paper|website> [options]');
    const resourceType = parseExternalResourceType(parsed.values.get('--type'));
    if (!resourceType) throw new CliUsageError('resource save 必须指定 --type');
    return client.saveExternalResource({
      url: parsed.positionals[0],
      resourceType,
      title: parsed.values.get('--title'),
      description: parsed.values.get('--description'),
      siteName: parsed.values.get('--site-name'),
      author: parsed.values.get('--author'),
      publishedAt: parsed.values.get('--published-at'),
      faviconUrl: parsed.values.get('--favicon-url'),
      previewImageUrl: parsed.values.get('--preview-image-url'),
      metadata: parseMetadata(parsed.values.get('--metadata-json')),
      notes: parsed.values.get('--notes'),
      tags: parseTags(parsed.values.get('--tags')),
    });
  }

  if (command === 'get') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope resource get <resource-id>');
    return client.getExternalResource(parseInteger(parsed.positionals[0], 'resource-id', undefined, 1));
  }

  if (command === 'update') {
    const parsed = parseOptions(
      rest,
      new Set(['--title', '--description', '--site-name', '--author', '--published-at', '--favicon-url', '--preview-image-url', '--metadata-json', '--notes', '--tags']),
      new Set(['--read', '--unread', '--pin', '--unpin']),
    );
    expectPositionals(parsed.positionals, 1, 'devscope resource update <resource-id> [options]');
    if (parsed.flags.has('--read') && parsed.flags.has('--unread')) {
      throw new CliUsageError('--read 与 --unread 不能同时使用');
    }
    if (parsed.flags.has('--pin') && parsed.flags.has('--unpin')) {
      throw new CliUsageError('--pin 与 --unpin 不能同时使用');
    }
    const input: Parameters<DevScopeClient['updateExternalResource']>[0] = {
      resourceId: parseInteger(parsed.positionals[0], 'resource-id', undefined, 1),
      title: parsed.values.get('--title'),
      description: parsed.values.get('--description'),
      siteName: parsed.values.get('--site-name'),
      author: parsed.values.get('--author'),
      publishedAt: parsed.values.get('--published-at'),
      faviconUrl: parsed.values.get('--favicon-url'),
      previewImageUrl: parsed.values.get('--preview-image-url'),
      metadata: parsed.values.has('--metadata-json') ? parseMetadata(parsed.values.get('--metadata-json')) : undefined,
      notes: parsed.values.get('--notes'),
      tags: parsed.values.has('--tags') ? parseTags(parsed.values.get('--tags')) : undefined,
      isRead: parsed.flags.has('--read') ? true : parsed.flags.has('--unread') ? false : undefined,
      isPinned: parsed.flags.has('--pin') ? true : parsed.flags.has('--unpin') ? false : undefined,
    };
    return client.updateExternalResource(input);
  }

  if (command === 'remove') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope resource remove <resource-id>');
    return client.removeExternalResource(parseInteger(parsed.positionals[0], 'resource-id', undefined, 1));
  }

  if (command === 'content-enable' || command === 'content-request' || command === 'content-status' || command === 'content-read') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, `devscope resource ${command} <resource-id>`);
    const resourceId = parseInteger(parsed.positionals[0], 'resource-id', undefined, 1);
    if (command === 'content-enable') return client.enableExternalResourceContent(resourceId);
    if (command === 'content-request') return client.requestExternalResourceContent(resourceId);
    if (command === 'content-status') return client.getExternalResourceContentStatus(resourceId);
    return client.readExternalResourceContent(resourceId);
  }

  throw new CliUsageError('用法: devscope resource <list|save|get|update|remove|content-enable|content-request|content-status|content-read> ...');
}

async function runResourceGroupCommand(args: string[], client: DevScopeClient): Promise<unknown> {
  const [command, ...rest] = args;
  if (command === 'list') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 0, 'devscope resource-group list');
    return client.listExternalResourceGroups();
  }
  if (command === 'create') {
    const parsed = parseOptions(rest, new Set(['--description']), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope resource-group create <name> [--description <text>]');
    return client.createExternalResourceGroup({ name: parsed.positionals[0], description: parsed.values.get('--description') });
  }
  if (command === 'members') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope resource-group members <group-id>');
    return client.getExternalResourceGroupMembers(parseInteger(parsed.positionals[0], 'group-id', undefined, 1));
  }
  if (command === 'add') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 2, 'devscope resource-group add <group-id> <resource-id>');
    return client.addExternalResourceToGroup(
      parseInteger(parsed.positionals[0], 'group-id', undefined, 1),
      parseInteger(parsed.positionals[1], 'resource-id', undefined, 1),
    );
  }
  if (command === 'remove') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 2, 'devscope resource-group remove <group-id> <resource-id>');
    return client.removeExternalResourceFromGroup(
      parseInteger(parsed.positionals[0], 'group-id', undefined, 1),
      parseInteger(parsed.positionals[1], 'resource-id', undefined, 1),
    );
  }
  throw new CliUsageError('用法: devscope resource-group <list|create|members|add|remove> ...');
}

async function runAnalyzeCommand(
  args: string[],
  client: DevScopeClient,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<unknown> {
  const [command, ...rest] = args;

  if (command === 'start') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope analyze start <owner/repo>');
    return client.startHealthAnalysis(parsed.positionals[0]);
  }

  if (command === 'status') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope analyze status <execution-id>');
    return client.getAnalysisStatus(parsed.positionals[0]);
  }

  if (command === 'report') {
    const parsed = parseOptions(
      rest,
      new Set(['--poll-interval-ms', '--timeout-ms']),
      new Set(['--wait']),
    );
    expectPositionals(parsed.positionals, 1, 'devscope analyze report <execution-id> [options]');
    const executionId = parsed.positionals[0];

    if (parsed.flags.has('--wait')) {
      await waitForAnalysis(
        client,
        executionId,
        parseInteger(parsed.values.get('--poll-interval-ms'), '--poll-interval-ms', 1000, 1),
        parseInteger(parsed.values.get('--timeout-ms'), '--timeout-ms', 300_000, 1),
        sleep,
      );
    }

    return client.getHealthReport(executionId);
  }

  throw new CliUsageError('用法: devscope analyze <start|status|report> ...');
}

async function runRepoCommand(
  args: string[],
  client: DevScopeClient,
  sleep: (milliseconds: number) => Promise<void>
): Promise<unknown> {
  const [command, ...rest] = args;

  if (command === 'list') {
    const parsed = parseOptions(rest, new Set(['--limit', '--offset']), new Set());
    expectPositionals(parsed.positionals, 0, 'devscope repo list [--limit <1-100>] [--offset <n>]');
    return client.listRepositories({
      limit: parseInteger(parsed.values.get('--limit'), '--limit', 50, 1, 100),
      offset: parseInteger(parsed.values.get('--offset'), '--offset', 0),
    });
  }

  if (command === 'get') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope repo get <repo-id>');
    return client.getRepository(parseInteger(parsed.positionals[0], 'repo-id', undefined, 1));
  }

  if (command === 'delete-impact') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope repo delete-impact <repo-id>');
    return client.getRepositoryDeleteImpact(parseInteger(parsed.positionals[0], 'repo-id', undefined, 1));
  }

  if (command === 'archive' || command === 'unarchive') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, `devscope repo ${command} <repo-id>`);
    const repoId = parseInteger(parsed.positionals[0], 'repo-id', undefined, 1);
    return command === 'archive'
      ? client.archiveRepository(repoId)
      : client.unarchiveRepository(repoId);
  }

  if (command === 'delete') {
    const parsed = parseOptions(rest, new Set(), new Set(['--confirm']));
    expectPositionals(parsed.positionals, 1, 'devscope repo delete <repo-id> --confirm');
    if (!parsed.flags.has('--confirm')) throw new CliUsageError('repo delete 需要显式 --confirm');
    return client.deleteRepository(
      parseInteger(parsed.positionals[0], 'repo-id', undefined, 1),
      true,
    );
  }

  if (command === 'embedding-status') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 1, 'devscope repo embedding-status <repo-id>');
    return client.getEmbeddingStatus(parseInteger(parsed.positionals[0], 'repo-id', undefined, 1));
  }

  if (command === 'collect') {
    const parsed = parseOptions(
      rest,
      new Set(['--poll-interval-ms', '--timeout-ms']),
      new Set(['--skip-embeddings', '--wait'])
    );
    expectPositionals(parsed.positionals, 1, 'devscope repo collect <owner/repo> [options]');

    const skipEmbeddings = parsed.flags.has('--skip-embeddings');
    const shouldWait = parsed.flags.has('--wait');
    if (skipEmbeddings && shouldWait) {
      throw new CliUsageError('--skip-embeddings 与 --wait 不能同时使用');
    }

    const collection = await client.collectRepository({
      repo: parsed.positionals[0],
      skipEmbeddings,
    });
    if (!shouldWait) {
      return { collection };
    }

    const repoId = collection.repository?.id;
    if (!repoId) {
      throw new Error('采集结果缺少仓库 ID，无法等待向量化');
    }

    const embeddingStatus = await waitForEmbedding(
      client,
      repoId,
      parseInteger(parsed.values.get('--poll-interval-ms'), '--poll-interval-ms', 1000, 1),
      parseInteger(parsed.values.get('--timeout-ms'), '--timeout-ms', 300_000, 1),
      sleep
    );
    return { collection, embeddingStatus };
  }

  if (command === 'note') {
    const parsed = parseOptions(rest, new Set(), new Set());
    expectPositionals(parsed.positionals, 2, 'devscope repo note <repo-id> <text>');
    const repoId = parseInteger(parsed.positionals[0], 'repo-id', undefined, 1);
    return client.updateRepoNote(repoId, parsed.positionals[1]);
  }

  throw new CliUsageError('用法: devscope repo <list|get|delete-impact|archive|unarchive|delete|collect|embedding-status|note> ...');
}

async function dispatch(
  argv: string[],
  client: DevScopeClient,
  sleep: (milliseconds: number) => Promise<void>
): Promise<unknown> {
  const [scope, ...rest] = argv;

  if (scope === 'health') {
    expectPositionals(rest, 0, 'devscope health');
    return client.health();
  }

  if (scope === 'repo') {
    return runRepoCommand(rest, client, sleep);
  }

  if (scope === 'search') {
    const parsed = parseOptions(rest, new Set(['--limit']), new Set(['--no-answer']));
    expectPositionals(parsed.positionals, 2, 'devscope search <owner/repo> <query> [options]');
    return client.semanticSearch({
      repo: parsed.positionals[0],
      query: parsed.positionals[1],
      limit: parseInteger(parsed.values.get('--limit'), '--limit', 5, 1, 20),
      generateAnswer: !parsed.flags.has('--no-answer'),
    });
  }

  if (scope === 'group') {
    return runGroupCommand(rest, client);
  }

  if (scope === 'resource') {
    return runResourceCommand(rest, client);
  }

  if (scope === 'resource-group') {
    return runResourceGroupCommand(rest, client);
  }

  if (scope === 'analyze') {
    return runAnalyzeCommand(rest, client, sleep);
  }

  throw new CliUsageError('未知命令，请运行 devscope --help 查看用法');
}

export async function runCli(argv: string[], dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
    stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }

  try {
    const client = (dependencies.createClient ?? createDevScopeClientFromEnv)();
    const result = await dispatch(
      argv,
      client,
      dependencies.sleep ??
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    );
    writeJson(stdout, result);
    return 0;
  } catch (error) {
    const usageError = error instanceof CliUsageError;
    writeJson(stderr, {
      error: {
        code: usageError ? 'INVALID_ARGUMENT' : 'COMMAND_FAILED',
        message: errorMessage(error),
      },
    });
    return usageError ? 2 : 1;
  }
}
