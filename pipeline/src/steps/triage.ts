// 第 2 步：落地。按 identityKey 对老条目和本批内去重，把候选转成条目记录；正文只在本批内存里传给理解步。
import { newArticleId } from "../lib/ids.ts";
import { collapseWhitespace, stripTags } from "../lib/text.ts";
import type { ItemRecord, MaterialInput } from "../lib/types.ts";
import { identityKeyForUrl } from "../lib/url.ts";

export type LandedItem = { record: ItemRecord; body: string };

export function triage(materials: MaterialInput[], existing: ItemRecord[], nowIso: string): LandedItem[] {
  const seen = new Set(existing.map((item) => item.identityKey));
  const landed: LandedItem[] = [];
  for (const material of materials) {
    const title = collapseWhitespace(material.title);
    if (!title) continue;
    const identityKey = material.identityKey ?? identityKeyForUrl(material.url);
    if (!identityKey || seen.has(identityKey)) continue;
    seen.add(identityKey);
    const discoveredAt = material.discoveredAt ?? nowIso;
    const body = collapseWhitespace(material.bodyText ?? (material.bodyHtml ? stripTags(material.bodyHtml) : ""));
    landed.push({
      record: {
        id: material.id ?? newArticleId(),
        identityKey,
        sourceId: material.sourceId,
        via: material.via,
        url: material.url,
        title,
        author: material.author,
        language: material.language,
        publishedAt: material.publishedAt,
        excerpt: material.excerpt,
        media: material.media,
        tags: [],
        entityTags: [],
        firstSeenAt: discoveredAt,
        discoveredAt,
      },
      body: body || collapseWhitespace(material.excerpt ?? ""),
    });
  }
  return landed;
}
