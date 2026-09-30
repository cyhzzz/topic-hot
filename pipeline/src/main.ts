// 采集入口：抓取 → 落地去重 → 打分理解 → 事件归组 → 出日报 → 发布站点数据。
// 用法：npm run collect（等价 node --env-file-if-exists=.env pipeline/src/main.ts）。
// 模型可选：没配 LLM_BASE_URL/LLM_API_KEY 时全链路走规则打分与摘要。
import { config } from "./config.ts";
import { llmCallsUsed } from "./lib/llm.ts";
import { groupItems } from "./steps/group.ts";
import { buildReport } from "./steps/report.ts";
import { publish } from "./steps/publish.ts";
import { summarize } from "./steps/summarize.ts";
import { triage } from "./steps/triage.ts";
import { fetchAll } from "./steps/fetch.ts";
import { loadCursors, loadItems, loadSources, saveCursors, saveMeta, saveReport } from "./storage.ts";

async function main(): Promise<void> {
  const startedAt = new Date();
  const sources = loadSources();
  const cursors = loadCursors();
  const items = loadItems();

  let fetchedFeeds = 0;
  let newItems = 0;
  let selectedToday = 0;
  const errors: string[] = [];

  try {
    const fetched = await fetchAll(sources, cursors, startedAt);
    fetchedFeeds = fetched.fetchedFeeds;
    errors.push(...fetched.errors);

    const landed = triage(fetched.materials, items, startedAt.toISOString());
    newItems = landed.length;

    const stats = await summarize(landed, new Map(sources.map((source) => [source.id, source])));

    const pool = new Map(items.map((item) => [item.id, item] as const));
    for (const { record } of landed) pool.set(record.id, record);
    const current = [...pool.values()];

    const groups = groupItems(current, startedAt.toISOString());
    const report = await buildReport(current, sources, startedAt, stats);
    selectedToday = report.stats.selected;

    saveReport(report);
    const site = publish(current, groups, startedAt, llmCallsUsed(), sources.length);
    saveCursors(cursors);
    saveMeta({
      lastRunAt: startedAt.toISOString(),
      lastSuccessAt: new Date().toISOString(),
      llmCallsUsed: llmCallsUsed(),
      fetchedFeeds,
      newItems,
      selectedToday,
      errors,
    });
    console.log(
      `采集完成：抓取 ${fetchedFeeds} 个信源，新增 ${newItems} 条，今日精选 ${selectedToday} 条，` +
        `事件 ${site.groups.length} 组，模型调用 ${llmCallsUsed()} 次；站点数据 ${site.meta.itemCount} 条。`,
    );
    if (errors.length > 0) console.warn(`有 ${errors.length} 个非致命错误：\n${errors.map((line) => `- ${line}`).join("\n")}`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    saveMeta({
      lastRunAt: startedAt.toISOString(),
      llmCallsUsed: llmCallsUsed(),
      fetchedFeeds,
      newItems,
      selectedToday,
      errors,
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
