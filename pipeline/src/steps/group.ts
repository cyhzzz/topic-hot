// 第 4 步：事件归组。同一天里讲同一件事的多条报道合成一张事件卡（标题 3-gram 相似度 + 标签/实体重合）。
// 不调模型；只保留 ≥2 条报道的组，单条报道自成一条不需要归组。
import { shortHash } from "../lib/ids.ts";
import { truncate } from "../lib/text.ts";
import type { EventGroup, ItemRecord } from "../lib/types.ts";

function trigrams(input: string): Set<string> {
  const compact = input.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= compact.length; i++) grams.add(compact.slice(i, i + 3));
  return grams;
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function sameEvent(a: ItemRecord, b: ItemRecord, gramsA: Set<string>, gramsB: Set<string>): boolean {
  if ((a.category ?? "") !== (b.category ?? "")) return false;
  const sharedTags = a.tags.filter((tag) => b.tags.includes(tag)).length;
  const sharedEntities = a.entityTags.filter((tag) => b.entityTags.includes(tag)).length;
  const similar = similarity(gramsA, gramsB);
  if (sharedEntities >= 1 && similar >= 0.25) return true;
  if (sharedTags + sharedEntities >= 2 && similar >= 0.2) return true;
  return similar >= 0.5;
}

export function groupItems(items: ItemRecord[], nowIso: string): EventGroup[] {
  const ranked = [...items].sort((a, b) => (b.score?.average ?? 0) - (a.score?.average ?? 0));
  const parent = ranked.map((_, index) => index);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };

  const grams = ranked.map((item) => trigrams(item.title));
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      if (find(i) !== find(j) && sameEvent(ranked[i], ranked[j], grams[i], grams[j])) union(i, j);
    }
  }

  const buckets = new Map<number, ItemRecord[]>();
  ranked.forEach((item, index) => {
    const root = find(index);
    const bucket = buckets.get(root) ?? [];
    bucket.push(item);
    buckets.set(root, bucket);
  });

  const groups: EventGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    const head = bucket[0];
    groups.push({
      id: `ev_${shortHash(head.id, 10)}`,
      title: truncate(head.title, 60),
      category: head.category,
      tags: [...new Set(bucket.flatMap((item) => item.tags))].slice(0, 6),
      itemIds: bucket.map((item) => item.id),
      updatedAt: nowIso,
    });
  }
  return groups;
}
