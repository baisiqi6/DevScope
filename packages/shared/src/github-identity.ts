/**
 * 将 GitHub repository ID 规范化为跨 JSON/数据库边界都无损的十进制字符串。
 * GitHub SDK 当前返回 number，因此必须在转字符串前拒绝 unsafe integer。
 */
export function normalizeGitHubRepositoryId(
  id: number | string | bigint,
): string {
  if (typeof id === "number") {
    if (!Number.isSafeInteger(id)) {
      throw new RangeError("GitHub repository ID number must be a safe integer");
    }
    if (id <= 0) {
      throw new RangeError("GitHub repository ID must be positive");
    }
    return String(id);
  }

  if (typeof id === "bigint") {
    if (id <= 0n) {
      throw new RangeError("GitHub repository ID must be positive");
    }
    return id.toString();
  }

  if (!/^[1-9]\d*$/.test(id)) {
    throw new TypeError("GitHub repository ID string must be a positive decimal integer");
  }
  return id;
}
