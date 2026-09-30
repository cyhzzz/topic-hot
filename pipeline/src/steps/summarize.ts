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

const RELEASE_RE = /(发布|开源|上线|推出|释出|released?|launch(?:es|ed)?|announc|unveil|introduc|open.?sourc)/i;
const NOISE_RE = /(招聘|招人|赞助|广告|sponsored|抽奖|一周要闻|weekly\s?(?:roundup|digest)|newsletter)/i;
const MODEL_HINT_RE = /(模型|model|agent|llm|gpt|claude|gemini|llama|qwen|deepseek|kimi|grok|glm|doubao|混元|通义|智谱)/i;
const POLICY_RE = /(监管|政策|法案|禁令|regulat|ban\b|legislat)/i;

/** 规则模式下分类标签 → 类别 key 的映射（与 taxonomy 的类别词对齐）。 */
const CATEGORY_BY_TAG: Record<string, string> = {
  "模型发布": "ai-models",
  "产品更新": "ai-products",
  "论文/研究": "paper",
  "开源/仓库": "ai-products",
  "教程/实践": "tip",
  "大佬观点": "opinion",
  "现象/趋势": "opinion",
  "评测/基准": "ai-models",
  "安全/对齐": "industry",
  "行业动态": "industry",
  "政策/监管": "industry",
  "非AI/通用工具": "ai-products",
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
  let score = tier === "T1" ? 66 : tier === "T1_5" ? 58 : 46;
  if (matchEntities(hay).length > 0) score += 6;
  if (RELEASE_RE.test(record.title)) score += 5;
  if (MODEL_HINT_RE.test(hay)) score += 3;
  if (NOISE_RE.test(hay)) score -= 15;
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
  if (/\barxiv\b|论文|paper\b|benchmark|评测|基准/i.test(sourceText)) tag = "论文/研究";
  else if (/open.?sourc|开源|github\.com/i.test(sourceText)) tag = "开源/仓库";
  else if (/教程|实践|指南|提示词|how\s?to|prompt|技巧|玩法|用法/i.test(sourceText)) tag = "教程/实践";
  else if (POLICY_RE.test(sourceText)) tag = "政策/监管";
  else if (/融资|收购|并购|裁员|任命|起诉|合作|funding|acquir|merger|layoff|lawsuit|partner/i.test(sourceText)) tag = "行业动态";
  else if (MODEL_HINT_RE.test(sourceText) && RELEASE_RE.test(sourceText)) tag = "模型发布";
  else if (RELEASE_RE.test(sourceText)) tag = "产品更新";
  else if (/观点|评论|趋势|访谈|争论|opinion|trend/i.test(sourceText)) tag = "现象/趋势";
  else tag = "行业动态";

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
