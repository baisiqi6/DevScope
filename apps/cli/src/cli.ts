import {
  createDevScopeClientFromEnv,
  type DevScopeClient,
  type EmbeddingStatus,
} from '@devscope/client';

export const CLI_VERSION = '0.0.1';

const HELP_TEXT = `DevScope CLI

用法:
  devscope health
  devscope repo list [--limit <1-100>] [--offset <n>]
  devscope repo get <repo-id>
  devscope repo collect <owner/repo> [--skip-embeddings] [--wait]
                        [--poll-interval-ms <ms>] [--timeout-ms <ms>]
  devscope repo embedding-status <repo-id>
  devscope search <owner/repo> <query> [--limit <1-20>] [--no-answer]
  devscope group list
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

  throw new CliUsageError('用法: devscope repo <list|get|collect|embedding-status> ...');
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

  if (scope === 'group' && rest[0] === 'list' && rest.length === 1) {
    return client.listGroups();
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
