// 各类 ID 与内容指纹的生成。

import { createHash, randomBytes } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";

/** 条目 ID：cuid2，按时间有序，适合做文件名与去重键。 */
export function newArticleId(): string {
  return createId();
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function shortHash(input: string, length = 10): string {
  return sha256(input).slice(0, length);
}

export function newToken(bytes = 12): string {
  return randomBytes(bytes).toString("base64url");
}

/** 稳定序列化：键排序后再 stringify，用于给任意结构算哈希。 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
