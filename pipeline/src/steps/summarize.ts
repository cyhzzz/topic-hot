// 第 3 步：打分与内容理解。
// 配了模型（LLM_BASE_URL + LLM_API_KEY）时：注意力分走 prompts/selection-score.md，
// 内容理解走 prompts/content-understanding.md；模型没配、预算耗尽或单次调用失败时，
// 自动降级为规则打分与规则摘要。可理解性分（understand）固定用规则启发式估信息完整度，
// 与注意力分相互独立，门槛判定不变：两分之和 ≥ 2 × 信源门槛才进精选。
import { SELECTION } from "../../../industry/selection.ts";
import {
  CATEGORY_BY_ITEM_TYPE,
  CATEGORY_TAGS,
  CATEGORIES,
  ENTITIES,
  ENTITY_TAGS,
  IDENTITY_LEXICON,
  ITEM_TYPES,
  TAG_SYNONYMS,
  TOPIC_TAGS,
} from "../../../industry/taxonomy.ts";
import { config, llmEnabled } from "../config.ts";
import { chatJson, llmCallsUsed } from "../lib/llm.ts";
import { loadPrompt } from "../lib/prompts.ts";
import { collapseWhitespace, truncate } from "../lib/text.ts";
import type { ItemRecord, SourceRow } from "../lib/types.ts";
import type { LandedItem } from "./triage.ts";

const RELEASE_RE = /(发布|上线|推出|获批|落地|开办|released?|launch(?:es|ed)?|announc|unveil|introduc)/i;
const NOISE_RE = /(招聘|招人|赞助|广告|sponsored|抽奖|一周要闻|weekly\s?(?:roundup|digest)|newsletter|荐股|牛股|翻倍|加群|内部消息)/i;
const MARKET_HINT_RE = /(券商|证券|两融|IPO|证监会|交易所|开户|佣金|经纪|投顾|行情|A股|基金|财富管理)/i;
// 行业相关性闸门词表：标题必须命中证券行业或资本市场的关键词，
// 否则视为与站点主题无关的泛财经（宏观行情、国际市场、社会热点等）。
// 只看标题不看摘要：摘要是全文片段，无关词（如"愿景基金"里的"基金"）误命中率高。
// 上市/发行/公告/披露 是交易所一手源（上交所、深交所公告与规则）标题的必备词：
// 公告标题常常只有公司名加"公告/上市"，没有交易所全称，缺这些词会被误挡。
const RELEVANCE_RE =
  /(券商|证券|证监会|上交所|深交所|港交所|北交所|中证协|新三板|两融|融资融券|转融通|IPO|保荐|承销|做市|经纪|佣金|开户|投行|投顾|投资顾问|财富管理|资管|公募|私募|基金|营业部|(?<![a-zA-Z])A股|港股|打新|新股|中签|减持|增持|回购|停牌|复牌|退市|并购|重组|借壳|定增|警示函|监管函|问询函|罚单|处罚|立案|征求意见|管理办法|管理规定|新规|自律|涨停|跌停|龙虎榜|大宗交易|研报|上市|发行|公告|披露)/i;
const POLICY_RE = /(监管|政策|法案|禁令|regulat|ban\b|legislat)/i;

/** 规则模式下分类标签 → 类别 key 的映射（与 taxonomy 的类别词对齐）。 */
const CATEGORY_BY_TAG: Record<string, string> = {
  "券商经营": "industry",
  "海外同业": "industry",
  "监管政策": "policy",
  "市场动态": "market",
  "数据/榜单": "market",
  "非证券/宏观": "market",
  "获客展业": "acquisition",
  "财富管理": "acquisition",
  "产品更新": "product",
  "金融科技": "product",
  "观点/评论": "opinion",
  "教程/实践": "tip",
};

const CATEGORY_TAG_SET = new Set<string>(CATEGORY_TAGS);
const TOPIC_TAG_LIST = TOPIC_TAGS as readonly string[];
const ENTITY_TAG_LIST = ENTITY_TAGS as readonly string[];
const CATEGORY_KEYS: readonly string[] = CATEGORIES.map((category) => category.key);

export type SummarizeStats = { llmAttention: number; llmUnderstanding: number; degraded: number };

type Understanding = {
  summary: string;
  tags: string[];
  topicTags: string[];
  entityTags: string[];
  category?: string;
  contentType?: string;
  mode: "llm" | "rules";
};

function llmReady(): boolean {
  return llmEnabled() && llmCallsUsed() < config.llm.maxCallsPerRun;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeWord(word: string): string {
  return TAG_SYNONYMS[word] ?? TAG_SYNONYMS[word.toLowerCase()] ?? word;
}

function normalizeTagList(raw: unknown, allowed: ReadonlySet<string> | readonly string[]): string[] {
  const words = Array.isArray(raw) ? raw.filter((word): word is string => typeof word === "string") : [];
  const allowedSet = allowed instanceof Set ? allowed : new Set<string>(allowed);
  const tags: string[] = [];
  for (const word of words) {
    const tag = normalizeWord(word.trim());
    if (tag && allowedSet.has(tag) && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

// ── 规则降级路径 ────────────────────────────────────────────────────────────────────────

function ruleAttention(record: ItemRecord, tier: string): number {
  const hay = `${record.title} ${record.excerpt ?? ""}`;
  // 行业相关性闸门：噪声、或标题既未命中行业词表也不在券商名录里的条目，注意力分直接归零——
  // 两分平均最高只有可理解性上限的一半（92/2 = 46），必然低于所有档位的精选门槛。
  if (
    NOISE_RE.test(hay) ||
    !(RELEVANCE_RE.test(record.title) || matchEntities(record.title).length > 0)
  ) {
    return 0;
  }
  let score = tier === "T1" ? 66 : tier === "T1_5" ? 58 : 56;
  if (matchEntities(hay).length > 0) score += 6;
  if (RELEASE_RE.test(record.title)) score += 5;
  if (MARKET_HINT_RE.test(hay)) score += 3;
  return clampScore(score);
}

function ruleUnderstand(record: ItemRecord, body: string): number {
  const length = body.length || (record.excerpt ?? "").length;
  let score = length > 800 ? 82 : length > 300 ? 70 : length > 120 ? 55 : 40;
  if (record.title.length >= 12 && record.title.length <= 90) score += 6;
  if (record.excerpt) score += 4;
  return clampScore(score);
}

function matchEntities(text: string): string[] {
  const lowered = text.toLowerCase();
  const tags: string[] = [];
  for (const entity of Object.values(ENTITIES)) {
    if (!entity.displayTag) continue;
    if (entity.aliases.some((alias) => lowered.includes(alias.toLowerCase())) && !tags.includes(entity.displayTag)) {
      tags.push(entity.displayTag);
    }
  }
  return tags.slice(0, 3);
}

function ruleUnderstanding(record: ItemRecord, sourceText: string): Understanding {
  let tag: string;
  if (/证监会|交易所|协会|监管|处罚|新规|罚单|立案|征求意见/i.test(sourceText)) tag = "监管政策";
  else if (/获客|开户|私域|直播|客户经理|展业|营销|转化|引流/i.test(sourceText)) tag = "获客展业";
  else if (/财富管理|基金投顾|代销|买方投顾/i.test(sourceText)) tag = "财富管理";
  else if (/教程|实操|案例|指南|技巧|打法|方法论/i.test(sourceText)) tag = "教程/实践";
  else if (/两融|IPO|再融资|成交|行情|牛市|资金流|降息|印花税/i.test(sourceText)) tag = "市场动态";
  else if (/业绩|财报|净利润|营收|增资|融资|并购|重组|人事|任命|离职|裁员|营业部|牌照|合资/i.test(sourceText)) tag = "券商经营";
  else if (/App|产品|上线|改版|新功能|版本更新/i.test(sourceText)) tag = "产品更新";
  else if (/排名|榜单|市场份额|市占率/i.test(sourceText)) tag = "数据/榜单";
  else if (/研报|观点|评论|趋势|访谈|展望/i.test(sourceText)) tag = "观点/评论";
  else tag = "市场动态";

  const lowered = sourceText.toLowerCase();
  const topicTags = TOPIC_TAG_LIST.filter((word) => lowered.includes(word.toLowerCase())).slice(0, 2);
  return {
    summary: "",
    tags: [tag],
    topicTags,
    entityTags: matchEntities(sourceText),
    category: CATEGORY_BY_TAG[tag],
    mode: "rules",
  };
}

function ruleSummary(record: ItemRecord): string {
  return truncate(collapseWhitespace(record.excerpt ?? "") || record.title, 80);
}

// ── 模型路径 ────────────────────────────────────────────────────────────────────────────

async function llmAttention(record: LandedItem, source: SourceRow | undefined, tier: string): Promise<number> {
  const result = await chatJson<{ attentionScore: number }>([
    { role: "system", content: loadPrompt("selection-score.md") },
    {
      role: "user",
      content: JSON.stringify({
        source: source?.name ?? record.record.sourceId,
        tier,
        publishedAt: record.record.publishedAt ?? null,
        title: record.record.title,
        excerpt: truncate(record.record.excerpt ?? "", 400),
        body: truncate(record.body, 2000),
      }),
    },
  ]);
  const score = clampScore(Number(result.attentionScore));
  if (Number(result.attentionScore) !== score || (score === 0 && Number(result.attentionScore) !== 0)) {
    throw new Error("attentionScore 不是数值");
  }
  return score;
}

/** 防张冠李戴：摘要里出现的公司必须在原文（标题+正文）里也出现，否则判为编造。 */
function fabricatedIdentity(summary: string, sourceText: string): string | null {
  for (const entry of IDENTITY_LEXICON) {
    if (!entry.patterns.some((pattern) => pattern.test(summary))) continue;
    if (!entry.patterns.some((pattern) => pattern.test(sourceText))) return entry.name;
  }
  return null;
}

async function llmUnderstanding(record: LandedItem, source: SourceRow | undefined, sourceText: string): Promise<Understanding> {
  const result = await chatJson<{
    summary: string;
    tags: string[];
    topicTags: string[];
    entityTags: string[];
    category: string;
    contentType?: string;
  }>([
    { role: "system", content: loadPrompt("content-understanding.md") },
    {
      role: "user",
      content: JSON.stringify({
        source: source?.name ?? record.record.sourceId,
        title: record.record.title,
        language: record.record.language ?? null,
        publishedAt: record.record.publishedAt ?? null,
        text: truncate(record.body, 2400),
      }),
    },
  ]);
  const summary = collapseWhitespace(typeof result.summary === "string" ? result.summary : "");
  return {
    summary: summary && !fabricatedIdentity(summary, sourceText) ? summary : "",
    tags: normalizeTagList(result.tags, [...CATEGORY_TAG_SET, ...TOPIC_TAG_LIST]),
    topicTags: normalizeTagList(result.topicTags, TOPIC_TAG_LIST).slice(0, 2),
    entityTags: normalizeTagList(result.entityTags, ENTITY_TAG_LIST).slice(0, 3),
    category: CATEGORY_KEYS.includes(result.category) ? result.category : undefined,
    contentType: (ITEM_TYPES as readonly string[]).includes(result.contentType ?? "") ? result.contentType : undefined,
    mode: "llm",
  };
}

// ── 主流程 ──────────────────────────────────────────────────────────────────────────────

function applyUnderstanding(record: ItemRecord, understanding: Understanding): void {
  const tags = [...understanding.tags];
  if (!tags.some((tag) => CATEGORY_TAG_SET.has(tag))) {
    tags.unshift((understanding.contentType && CATEGORY_BY_ITEM_TYPE[understanding.contentType]) || "其他");
  }
  record.tags = tags.slice(0, 3);
  record.entityTags = understanding.entityTags;
  record.category = understanding.category;
  record.contentType = understanding.contentType;
  if (understanding.summary) {
    record.summary = understanding.summary;
    record.summaryMode = understanding.mode;
  } else {
    record.summary = ruleSummary(record);
    record.summaryMode = "rules";
  }
}

export async function summarize(items: LandedItem[], sources: Map<string, SourceRow>): Promise<SummarizeStats> {
  const stats: SummarizeStats = { llmAttention: 0, llmUnderstanding: 0, degraded: 0 };
  for (const item of items) {
    const source = sources.get(item.record.sourceId);
    const tier = source?.tier ?? "T2";
    const threshold = SELECTION.thresholds[tier] ?? SELECTION.thresholds.T2;
    const sourceText = `${item.record.title}\n${item.body}`;

    let attention: number;
    if (llmReady()) {
      try {
        attention = await llmAttention(item, source, tier);
        stats.llmAttention += 1;
      } catch {
        attention = ruleAttention(item.record, tier);
        stats.degraded += 1;
      }
    } else {
      attention = ruleAttention(item.record, tier);
    }

    const understand = ruleUnderstand(item.record, item.body);
    let understanding: Understanding;
    if (attention >= SELECTION.understandFloor && llmReady()) {
      try {
        understanding = await llmUnderstanding(item, source, sourceText);
        stats.llmUnderstanding += 1;
      } catch {
        understanding = ruleUnderstanding(item.record, sourceText);
        stats.degraded += 1;
      }
    } else {
      understanding = ruleUnderstanding(item.record, sourceText);
    }

    applyUnderstanding(item.record, understanding);
    const average = Math.round((attention + understand) / 2);
    item.record.score = { attention, understand, average };
    item.record.selected = average >= threshold;
  }
  return stats;
}
