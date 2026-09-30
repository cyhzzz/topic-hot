// 第六步：收尾发布 —— 清理超期条目与日报、筛掉失效事件组，把站点要读的 SiteData 写进 data/site.json。
import { ABOUT, SITE } from "../../../industry/site.ts";
import { CATEGORIES } from "../../../industry/taxonomy.ts";
import { config } from "../config.ts";
import { cutoffIso, dayKeyInTz } from "../lib/day.ts";
import type { EventGroup, ItemRecord, ReportItem, SiteData, SiteIdentity } from "../lib/types.ts";
import { loadReports, pruneReportFiles, saveItems, saveSiteData } from "../storage.ts";

export function publish(pool: ItemRecord[], groups: EventGroup[], now: Date, llmCalls: number, sourceCount: number): SiteData {
  const cutoffTime = Date.parse(cutoffIso(now, config.retentionDays));
  const cutoffDay = dayKeyInTz(new Date(cutoffTime), config.timezone);

  // 条目按发布时间保留，超期丢掉；池子超上限时丢最旧的。
  const kept = pool
    .filter((item) => {
      const time = Date.parse(item.publishedAt ?? item.firstSeenAt);
      return !Number.isFinite(time) || time >= cutoffTime;
    })
    .sort((a, b) => Date.parse(a.firstSeenAt) - Date.parse(b.firstSeenAt));
  const overflow = kept.length - config.maxItems;
  const live = overflow > 0 ? kept.slice(overflow) : kept;

  // 事件组只保留成员还活着的。
  const liveIds = new Set(live.map((item) => item.id));
  const liveGroups = groups
    .map((group) => ({ ...group, itemIds: group.itemIds.filter((id) => liveIds.has(id)) }))
    .filter((group) => group.itemIds.length >= 2);

  pruneReportFiles(cutoffDay);
  const reports = loadReports(config.retentionDays);

  // 站点条目 = 保留期内各日报精选条目的并集，去重后按分数排。
  const seen = new Set<string>();
  const siteItems: ReportItem[] = [];
  for (const report of reports) {
    for (const section of report.sections) {
      for (const item of section.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          siteItems.push(item);
        }
      }
    }
  }
  siteItems.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const site: SiteData = {
    generatedAt: now.toISOString(),
    today: dayKeyInTz(now, config.timezone),
    site: identity(sourceCount),
    categories: CATEGORIES.map((category) => ({ key: category.key, label: category.label, section: category.section })),
    reports,
    groups: liveGroups,
    items: siteItems,
    meta: { itemCount: live.length, llmCalls },
  };
  saveItems(live);
  saveSiteData(site);
  return site;
}

/** 站点身份：把 industry/site.ts 的文案落进 site.json，前端只认数据不改文案。 */
function identity(sourceCount: number): SiteIdentity {
  return {
    name: SITE.name,
    subject: SITE.subject,
    tagline: SITE.tagline,
    homeTitle: SITE.homeTitle,
    description: SITE.description,
    footerNote: SITE.footerNote,
    about: {
      headline: [...ABOUT.headline],
      lead: ABOUT.lead.replace("{sources}", String(sourceCount)),
      steps: { ...ABOUT.steps },
      copyright: ABOUT.copyright,
      contactEmail: SITE.contactEmail,
    },
  };
}
