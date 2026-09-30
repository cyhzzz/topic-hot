// 第 1 步：按信源抓 RSS。间隔没到的源直接跳过；条件请求凭据写回 cursors。
import { config } from "../config.ts";
import { fetchRss } from "../lib/rss.ts";
import type { Cursors, MaterialInput, SourceRow } from "../lib/types.ts";

export type FetchOutcome = { materials: MaterialInput[]; fetchedFeeds: number; errors: string[] };

export async function fetchAll(sources: SourceRow[], cursors: Cursors, now: Date): Promise<FetchOutcome> {
  const outcome: FetchOutcome = { materials: [], fetchedFeeds: 0, errors: [] };
  if (!config.collectEnabled) return outcome;
  for (const source of sources) {
    const cursor = cursors[source.id] ?? {};
    if (cursor.lastFetchedAt) {
      const elapsed = now.getTime() - Date.parse(cursor.lastFetchedAt);
      if (Number.isFinite(elapsed) && elapsed < source.interval_minutes * 60_000) continue;
    }
    try {
      const result = await fetchRss(source, cursor, {});
      cursors[source.id] = { ...result.validator, lastFetchedAt: now.toISOString() };
      outcome.fetchedFeeds += 1;
      for (const candidate of result.candidates) {
        outcome.materials.push({ ...candidate, sourceId: source.id, via: `rss:${source.id}` });
      }
    } catch (error) {
      outcome.errors.push(`fetch ${source.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return outcome;
}
