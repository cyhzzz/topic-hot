// 第五步：把当天入选的条目编成日报 —— 按行业分类分节，头部导语优先用模型写、不可用就退回规则拼装。
import { CATEGORIES } from "../../../industry/taxonomy.ts";
import { config, llmEnabled } from "../config.ts";
import { dayKeyInTz } from "../lib/day.ts";
import { chatJson, llmCallsUsed } from "../lib/llm.ts";
import { loadPrompt } from "../lib/prompts.ts";
import { truncate } from "../lib/text.ts";
import type { DailyReport, ItemRecord, ReportItem, ReportSection, SourceRow } from "../lib/types.ts";
import type { SummarizeStats } from "./summarize.ts";

type Lead = NonNullable<DailyReport["lead"]>;

function toReportItem(record: ItemRecord, sourceNames: Map<string, string>): ReportItem {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    url: record.url,
    sourceId: record.sourceId,
    sourceName: sourceNames.get(record.sourceId) ?? record.sourceId,
    publishedAt: record.publishedAt,
    score: record.score?.average,
    category: record.category,
    tags: record.tags,
    entityTags: record.entityTags,
  };
}

/** 按 taxonomy 里的 section 分节：共用一节的类别合并，没归上类的放进 industry 所在节（没有就单开“其他”）。 */
function buildSections(items: ReportItem[]): ReportSection[] {
  const sections: ReportSection[] = [];
  const bySection = new Map<string, ReportSection>();
  let fallback: ReportSection | undefined;
  for (const category of CATEGORIES) {
    const inCategory = items.filter((item) => item.category === category.key);
    if (inCategory.length === 0) continue;
    let section = bySection.get(category.section);
    if (!section) {
      section = { category: category.key, title: category.section, items: [] };
      bySection.set(category.section, section);
      sections.push(section);
    }
    section.items.push(...inCategory);
    if (category.key === "industry") fallback = section;
  }
  const rest = items.filter((item) => !CATEGORIES.some((category) => category.key === item.category));
  if (rest.length > 0) {
    if (fallback) fallback.items.push(...rest);
    else sections.push({ category: "other", title: "其他", items: rest });
  }
  return sections;
}

/** 模型写头部：输入是排好序的入选条目，输出 {title, leadParagraph, highlights}；任何异常都不该挡住日报。 */
async function llmLead(items: ReportItem[], nowIso: string): Promise<Lead | undefined> {
  if (items.length === 0 || !llmEnabled() || llmCallsUsed() >= config.llm.maxCallsPerRun) return undefined;
  const payload = items.slice(0, 40).map((item) => ({
    title: item.title,
    summary: item.summary,
    score: item.score,
    tags: item.tags,
    entityTags: item.entityTags,
    sourceName: item.sourceName,
  }));
  try {
    const parsed = await chatJson<{ title?: unknown; leadParagraph?: unknown; highlights?: unknown }>(
      [
        { role: "system", content: loadPrompt("report-daily-lead.md") },
        { role: "user", content: JSON.stringify({ generatedAt: nowIso, items: payload }) },
      ],
      { jsonMode: config.llm.jsonMode, maxTokens: 800 },
    );
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const paragraph = typeof parsed.leadParagraph === "string" ? parsed.leadParagraph.trim() : "";
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights.filter((line): line is string => typeof line === "string" && line.trim() !== "").map((line) => line.trim()).slice(0, 5)
      : [];
    if (title === "" || paragraph === "" || highlights.length === 0) return undefined;
    return { title, paragraph, highlights };
  } catch {
    return undefined;
  }
}

/** 规则兜底头部：拿分数最高的条目当主角。 */
function rulesLead(items: ReportItem[]): Lead | undefined {
  if (items.length === 0) return undefined;
  const head = items[0];
  const highlights = items.slice(1, 4).map((item) => truncate(item.title, 40));
  return {
    title: truncate(head.title, 30),
    paragraph: head.summary ? truncate(head.summary, 140) : `今日共精选 ${items.length} 条内容，重点关注「${head.title}」。`,
    highlights,
  };
}

/** 当天的口径：按发现时间落在今天的条目（回填的旧闻在发现当天展示）。 */
export async function buildReport(pool: ItemRecord[], sources: SourceRow[], now: Date, stats: SummarizeStats): Promise<DailyReport> {
  const today = dayKeyInTz(now, config.timezone);
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
  const seenToday = pool.filter((item) => {
    const time = Date.parse(item.discoveredAt);
    return Number.isFinite(time) && dayKeyInTz(new Date(time), config.timezone) === today;
  });
  const selected = seenToday
    .filter((item) => item.selected === true)
    .sort((a, b) => (b.score?.average ?? 0) - (a.score?.average ?? 0));
  const items = selected.map((item) => toReportItem(item, sourceNames));
  const lead = (await llmLead(items, now.toISOString())) ?? rulesLead(items);
  return {
    day: today,
    generatedAt: now.toISOString(),
    lead,
    sections: buildSections(items),
    stats: { total: seenToday.length, selected: items.length, llmCalls: stats.llmAttention + stats.llmUnderstanding },
  };
}
