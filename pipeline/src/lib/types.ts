// 管线里流转的数据结构：信源 → 候选（候选不挂信源字段，落地时补）→ 条目记录 → 事件与日报。

export type MediaItem = { url: string; title?: string };

/** 正文状态：pending 抓到的只是导语（等后续补全文）、ok 全文、unconfirmed 不确定是否全文、none 没有正文。 */
export type BodyStatus = "pending" | "ok" | "unconfirmed" | "none";

/** 从信源解析出的原始资料，落地成条目前的样子。 */
export type MaterialInput = {
  sourceId: string;
  url: string;
  title: string;
  identityKey?: string;
  author?: string;
  language?: string;
  publishedAt?: string;
  sourceUpdatedAt?: string;
  excerpt?: string;
  bodyHtml?: string;
  bodyText?: string;
  bodyStatus?: BodyStatus;
  media?: MediaItem[];
  raw?: Record<string, unknown>;
  via: string;
  discoveredAt?: string;
  backfill?: boolean;
  id?: string;
};

/** 信源产出、还没挂 sourceId/via 的候选。 */
export type Candidate = Omit<MaterialInput, "sourceId" | "via"> & { categories?: string[] };

/** sources.json 里的一条信源：基础字段两种 kind 共用，config 按 kind 取不同形态。 */
export type SourceRow = {
  id: string;
  name: string;
  tier: string;
  first_party: boolean;
  owner_entity_id?: string;
  participation_mode?: string;
  interval_minutes: number;
  tags?: string[];
  site_fulltext: boolean;
  syndicate_fulltext?: boolean;
} & (
  | { kind: "rss"; config: { feedUrl: string; backfillLimit?: number } }
  | { kind: "newsnow"; config: { platform: string } }
);

/** 条件请求用的协商缓存凭据，按信源存在 cursors.json。 */
export type FeedValidator = { etag?: string; lastModified?: string; configHash?: string };

/** 精选门槛的两次独立打分：attention 注意力分、understand 可理解性分，卡片显示平均分。 */
export type ScoreRecord = { attention: number; understand: number; average: number };

/** 落地后的条目记录：原始资料 + 内容理解 + 打分结果。 */
export type ItemRecord = {
  id: string;
  identityKey: string;
  sourceId: string;
  via: string;
  url: string;
  title: string;
  author?: string;
  language?: string;
  publishedAt?: string;
  excerpt?: string;
  media?: MediaItem[];
  tags: string[];
  entityTags: string[];
  category?: string;
  contentType?: string;
  score?: ScoreRecord;
  selected?: boolean;
  summary?: string;
  summaryMode?: "llm" | "rules";
  eventId?: string;
  firstSeenAt: string;
  discoveredAt: string;
};

/** 归组后的事件：同一件事的多条报道聚合在一张事件卡里。 */
export type EventGroup = {
  id: string;
  title: string;
  category?: string;
  tags: string[];
  itemIds: string[];
  updatedAt: string;
};

/** 日报条目：对外展示用的裁剪版条目，不含正文。 */
export type ReportItem = {
  id: string;
  title: string;
  summary?: string;
  url: string;
  sourceId: string;
  sourceName: string;
  publishedAt?: string;
  score?: number;
  category?: string;
  tags: string[];
  entityTags: string[];
};

export type ReportSection = { category: string; title: string; items: ReportItem[] };

export type DailyReport = {
  day: string;
  generatedAt: string;
  lead?: { title: string; paragraph: string; highlights: string[] };
  sections: ReportSection[];
  stats: { total: number; selected: number; llmCalls: number };
};

/** 站点身份与文案：来自 industry/site.ts，前端只认数据不改文案。 */
export type SiteIdentity = {
  name: string;
  subject: string;
  tagline: string;
  homeTitle: string;
  description: string;
  footerNote: string | null;
  about: {
    headline: [string, string];
    lead: string;
    steps: { collect: string; store: string; select: string; publish: string };
    copyright: string;
    contactEmail: string | null;
  };
};

/** 静态站点唯一读取的数据文件（构建后位于 web/dist/data/site.json）。 */
export type SiteData = {
  generatedAt: string;
  today: string;
  site: SiteIdentity;
  categories: { key: string; label: string; section: string }[];
  reports: DailyReport[];
  groups: EventGroup[];
  items: ReportItem[];
  meta: { itemCount: number; llmCalls: number };
};

/** 每次运行结束后写进 meta.json 的运行摘要。 */
export type RunMeta = {
  lastRunAt: string;
  lastSuccessAt?: string;
  llmCallsUsed: number;
  fetchedFeeds: number;
  newItems: number;
  selectedToday: number;
  errors: string[];
};

/** 信源 → 上次抓取的缓存凭据与时间。 */
export type Cursors = Record<string, { etag?: string; lastModified?: string; configHash?: string; lastFetchedAt?: string }>;
