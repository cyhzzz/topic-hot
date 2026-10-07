// 无 RSS 的网页信源适配器：把没有 feed 的一手/垂直源接进管线。
// 与 rss.ts 一样输出 Candidate，不挂 sourceId/via，由 fetch 步骤补上。
// 两个适配器：
//   csrc     —— 证监会列表页。页面 <meta name="channelid"> 给出栏目 id，据此调站内 JSON 接口取列表
//               （列表由 JS 渲染，静态 HTML 是陈旧页，不可直接用）。
//   stcn-qzs —— 券商中国（qzs.stcn.com）首页。各频道块结构不一，但卡片都是
//               <a href="/article/detail/{id}.html"> 里套一个标题容器，按此统一提取。

import { config } from "../config.ts";
import { decodeBody, guardedFetch } from "./http-fetch.ts";
import { shortHash } from "./ids.ts";
import { collapseWhitespace, guessLanguage, stripTags, truncate } from "./text.ts";
import { identityKeyForUrl, normalizeUrl } from "./url.ts";
import type { Candidate, FeedValidator, SourceRow } from "./types.ts";

const EXCERPT_LENGTH = 500;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CSRC_HOST = "https://www.csrc.gov.cn";
const QZS_HOST = "https://qzs.stcn.com";

type WebSource = Extract<SourceRow, { kind: "web" }>;

/** 适配器统一产出这个中间形态，再转成 Candidate。 */
type RawItem = { title: string; url: string; publishedAt?: string; excerpt?: string };

export type WebFetchResult = { candidates: Candidate[]; validator: FeedValidator };

export async function fetchWeb(source: WebSource, validator: FeedValidator = {}): Promise<WebFetchResult> {
  const limit = source.config.limit ?? 10;
  const items = source.config.adapter === "csrc"
    ? await csrcItems(source.config.url, limit)
    : await qzsItems(source.config.url, limit);
  const configHash = shortHash(`web:${source.config.adapter}:${source.config.url}`, 16);
  return { candidates: toCandidates(items, limit), validator: { configHash } };
}

async function getText(url: string, referer?: string): Promise<string> {
  const response = await guardedFetch(url, {
    headers: { "user-agent": BROWSER_UA, ...(referer ? { referer } : {}) },
    maxBytes: config.maxFeedBytes,
    timeoutMs: config.fetchTimeoutMs,
  });
  if (response.status >= 400) throw new Error(`HTTP ${response.status}：${url}`);
  return decodeBody(response);
}

/* ---------------------------------- 证监会 ---------------------------------- */

async function csrcItems(pageUrl: string, limit: number): Promise<RawItem[]> {
  const html = await getText(pageUrl);
  const channelId = /<meta\s+name="channelid"\s+content="([^"]+)"/iu.exec(html)?.[1];
  if (!channelId) throw new Error(`证监会列表页未提供 channelid（栏目可能已改版）：${pageUrl}`);
  const url = `${CSRC_HOST}/searchList/${channelId}?_isAgg=true&_isJson=true&_pageSize=${limit}&_template=index&_rangeTimeGte=&_channelName=&page=1`;
  const payload = JSON.parse(await getText(url, pageUrl)) as { data?: { results?: unknown } };
  const results = Array.isArray(payload.data?.results) ? (payload.data!.results as Record<string, unknown>[]) : [];
  const items: RawItem[] = [];
  for (const row of results) {
    const title = collapseWhitespace(stripTags(asText(row.title)));
    const link = csrcAbsoluteUrl(asText(row.url));
    if (!title || !link) continue;
    items.push({
      title,
      url: link,
      publishedAt: csrcPublishedAt(row),
      excerpt: collapseWhitespace(stripTags(asText(row.content))),
    });
    if (items.length >= limit) break;
  }
  return items;
}

/**
 * 接口同时给出 publishedTime（毫秒时间戳）和 publishedTimeStr（北京时间字符串）。
 * 实测毫秒时间戳比真实 UTC 早 8 小时（字符串与文章页显示的日期一致），所以以字符串为准；
 * 字符串缺失时宁可报错，也不要落一个错 8 小时的时间。
 */
function csrcPublishedAt(row: Record<string, unknown>): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(asText(row.publishedTimeStr).trim());
  if (!match) throw new Error(`证监会接口缺少可解析的 publishedTimeStr：${asText(row.title).slice(0, 30)}`);
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}+08:00`);
  if (Number.isNaN(date.getTime())) throw new Error(`证监会 publishedTimeStr 无法解析：${asText(row.publishedTimeStr)}`);
  return date.toISOString();
}

function csrcAbsoluteUrl(raw: string): string {
  const url = raw.trim();
  if (/^https?:/iu.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${CSRC_HOST}${url.startsWith("/") ? "" : "/"}${url}`;
}

/* --------------------------------- 券商中国 --------------------------------- */

async function qzsItems(pageUrl: string, limit: number): Promise<RawItem[]> {
  const html = await getText(pageUrl);
  // 列表只给到 HH:mm，日期藏在封面图路径 /upload/wechat/YYYYMMDD/（整页同一发布日），
  // 快讯块没有封面图，退回页头"2026-10-07 星期三"里的日期。
  const headerDate = /class="top_right"[^>]*>([^<]*)</iu.exec(html)?.[1] ?? "";
  const day = /upload\/wechat\/(\d{4})(\d{2})(\d{2})\//u.exec(html) ?? /(\d{4})-(\d{2})-(\d{2})/u.exec(headerDate);

  // 同一篇文章会在不同频道块里重复出现（头条与图文列表）。按首次出现定序，缺时间的用后面的副本补齐。
  const cards = new Map<string, { title: string; hour?: string; minute?: string }>();
  for (const card of html.matchAll(/<a[^>]*href="\/article\/detail\/(\d+)\.html"[^>]*>([\s\S]*?)<\/a>/giu)) {
    const id = card[1]!;
    const titleBlock = /class="(?:img_title|mid_title|single_title|info_title|ellipsis_item2)[^"]*"[^>]*>([\s\S]*?)<\/div>/iu.exec(card[2]!)?.[1];
    if (!titleBlock) continue;
    const title = qzsTitle(titleBlock);
    if (!title) continue;
    const end = card.index + card[0].length;
    // 时间要么在卡片里（快讯），要么在其后的 single_info 里（图文卡）。
    const time = /(\d{1,2}):(\d{2})/u.exec(card[2]!) ?? /(\d{1,2}):(\d{2})/u.exec(html.slice(end, end + 400));
    const entry = cards.get(id);
    if (entry) {
      entry.hour ??= time?.[1];
      entry.minute ??= time?.[2];
    } else {
      cards.set(id, { title, hour: time?.[1], minute: time?.[2] });
    }
  }

  return [...cards]
    .slice(0, limit)
    .map(([id, card]) => ({
      title: card.title,
      url: new URL(`/article/detail/${id}.html`, QZS_HOST).href,
      publishedAt: day ? beijingIso(day[1]!, day[2]!, day[3]!, card.hour, card.minute) : undefined,
    }));
}

/** 标题容器里除标题外还有"热点/看点"标签、快讯时间等 span，取最后一个非空 span。 */
function qzsTitle(block: string): string {
  const spans = [...block.matchAll(/<span(?:\s[^>]*)?>([\s\S]*?)<\/span>/giu)]
    .map((match) => collapseWhitespace(stripTags(match[1]!)))
    .filter(Boolean);
  return spans.length > 0 ? spans[spans.length - 1]! : collapseWhitespace(stripTags(block));
}

/* ---------------------------------- 公共 ---------------------------------- */

function toCandidates(items: RawItem[], limit: number): Candidate[] {
  const now = Date.now();
  // 稀疏栏目的最新 N 条可能横跨数周（证监会要闻的 10 条能跨三周）。超出保留期的条目入库后会被
  // publish 按发布时间清掉，下一轮又会被当成"新条目"重新落地、再次出现在当日日报里，来回循环。
  // 这里按保留期直接过滤，让日报只收真正新的内容。
  const cutoff = now - config.retentionDays * 24 * 60 * 60 * 1000;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.publishedAt && Date.parse(item.publishedAt) < cutoff) continue;
    const url = normalizeUrl(item.url);
    if (!url) continue;
    const identityKey = identityKeyForUrl(url);
    if (seen.has(identityKey)) continue;
    seen.add(identityKey);
    const excerpt = item.excerpt ? truncate(item.excerpt, EXCERPT_LENGTH) : undefined;
    const backfill = item.publishedAt ? now - Date.parse(item.publishedAt) > 48 * 60 * 60 * 1000 : true;
    candidates.push({
      url,
      title: item.title,
      identityKey,
      language: guessLanguage(`${item.title} ${excerpt ?? ""}`),
      publishedAt: item.publishedAt,
      excerpt,
      bodyStatus: excerpt ? "unconfirmed" : "none",
      discoveredAt: new Date(now).toISOString(),
      backfill,
    });
    if (candidates.length >= limit) break;
  }
  return candidates;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function beijingIso(year: string, month: string, day: string, hour?: string, minute?: string): string | undefined {
  const hh = hour ? hour.padStart(2, "0") : "00";
  const mm = minute ?? "00";
  const date = new Date(`${year}-${month}-${day}T${hh}:${mm}:00+08:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}