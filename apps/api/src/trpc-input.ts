/** 手写 tRPC 适配层的输入解包工具。 */

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapJson(value: unknown): unknown {
  return isRecord(value) && "json" in value ? value.json : value;
}

/**
 * 解包 httpBatchLink 的索引格式，同时兼容单请求和旧版 `{ input }` 包装。
 */
export function unwrapTRPCInput(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const indexedKeys = Object.keys(value)
    .filter((key) => /^\d+$/.test(key))
    .sort((left, right) => Number(left) - Number(right));

  if (indexedKeys.length > 0) {
    const highestIndex = Number(indexedKeys[indexedKeys.length - 1]);
    const inputs = Array.from({ length: highestIndex + 1 }, (_, index) => {
      const key = String(index);
      return key in value ? unwrapJson(value[key]) : undefined;
    });

    // 单请求始终使用索引 0；批量请求保留空索引，确保输入与路径对齐。
    return indexedKeys.length === 1 && indexedKeys[0] === "0" ? inputs[0] : inputs;
  }

  if ("json" in value) {
    return value.json;
  }

  if ("input" in value) {
    return value.input;
  }

  return Object.keys(value).length > 0 ? value : undefined;
}

export function parseTRPCQueryInput(rawInput: unknown): unknown {
  if (typeof rawInput !== "string") {
    return unwrapTRPCInput(rawInput);
  }

  try {
    return unwrapTRPCInput(JSON.parse(rawInput));
  } catch {
    return rawInput;
  }
}
