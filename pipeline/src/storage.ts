// data/ 目录下的 JSON 持久化：信源、条目池、抓取游标、运行摘要、日报文件。
// 这些文件直接提交进仓库，GitHub Actions 每次运行后提交回去，就是“数据库”。
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.ts";
import type { Cursors, DailyReport, ItemRecord, RunMeta, SiteData, SourceRow } from "./lib/types.ts";

const dataDir = config.dataDir;
const itemsPath = join(dataDir, "items.json");
const cursorsPath = join(dataDir, "cursors.json");
const metaPath = join(dataDir, "meta.json");
const sitePath = join(dataDir, "site.json");
const reportsDir = join(dataDir, "reports");
const sourcesPath = fileURLToPath(new URL("../../industry/sources.json", import.meta.url));

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function loadSources(): SourceRow[] {
  const parsed = readJson<{ sources?: SourceRow[] }>(sourcesPath, {});
  return Array.isArray(parsed.sources) ? parsed.sources : [];
}

export function loadItems(): ItemRecord[] {
  const parsed = readJson<ItemRecord[] | { items?: ItemRecord[] }>(itemsPath, []);
  return Array.isArray(parsed) ? parsed : (parsed.items ?? []);
}

export function saveItems(items: ItemRecord[]): void {
  writeJson(itemsPath, items);
}

export function loadCursors(): Cursors {
  return readJson<Cursors>(cursorsPath, {});
}

export function saveCursors(cursors: Cursors): void {
  writeJson(cursorsPath, cursors);
}

export function loadMeta(): RunMeta | null {
  return readJson<RunMeta | null>(metaPath, null);
}

export function saveMeta(meta: RunMeta): void {
  writeJson(metaPath, meta);
}

export function saveReport(report: DailyReport): void {
  writeJson(join(reportsDir, `${report.day}.json`), report);
}

/** 站点数据文件：web 构建时整体拷进 web/dist/data/，是站点唯一读取的入口。 */
export function saveSiteData(site: SiteData): void {
  writeJson(sitePath, site);
}

/** 读最近 keepDays 天的日报，按日期倒序。 */
export function loadReports(keepDays: number): DailyReport[] {
  if (!existsSync(reportsDir)) return [];
  const days = readdirSync(reportsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort()
    .reverse()
    .slice(0, keepDays);
  const reports: DailyReport[] = [];
  for (const day of days) {
    const report = readJson<DailyReport | null>(join(reportsDir, `${day}.json`), null);
    if (report) reports.push(report);
  }
  return reports;
}

/** 删除日期早于 cutoffDay 的日报文件。 */
export function pruneReportFiles(cutoffDay: string): void {
  if (!existsSync(reportsDir)) return;
  for (const name of readdirSync(reportsDir)) {
    const day = name.replace(/\.json$/, "");
    if (day < cutoffDay) unlinkSync(join(reportsDir, name));
  }
}
