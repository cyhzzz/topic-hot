// NewsNow 热榜信源：榜单条目只有标题+链接，没有正文，多数没有发布时间；
// 映射成候选交给既有评分门槛过滤。公共实例在 Cloudflare 后面，
// 必须带浏览器形态的 UA，默认 bot UA 会被拦成 HTML。

import { config } from "../config.ts";
import { decodeBody, guardedFetch } from "./http-fetch.ts";
import { shortHash } from "./ids.ts";
import { collapseWhitespace, guessLanguage, truncate } from "./text.ts";
import { identityKeyForUrl, normalizeUrl } from "./url.ts";
import type { Candidate, FeedValidator, SourceRow } from "./types.ts";

const EXCERPT_LENGTH = 500;
const MAX_ITEMS = 30;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type NewsnowSource = Extract<SourceRow, { kind: "newsnow" }>;

type NewsnowItem = {
  title?: unknown;
  url?: unknown;
  pubDate?: unknown;
  extra?: { info?: unknown; hover?: unknown } | null;
};

type NewsnowPayload = { items?: NewsnowItem[] | null };

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseDate(value: unknown): string | undefined {
  const text = asText(value);
  if (!text) return undefined;
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function candidateFrom(item: NewsnowItem, now: number): Candidate | null {
  const rawUrl = asText(item.url);
  if (!rawUrl || !/^https?:/iu.test(rawUrl)) return null;
  const url = normalizeUrl(rawUrl);
  if (!url) return null;
  const title = collapseWhitespace(asText(item.title) ?? "");
  if (!title) return null;
  // hover 是条目简介（如 GitHub 仓库描述），info 是热度值（如"911 万热度"），简介优先。
  const excerpt = collapseWhitespace(asText(item.extra?.hover) ?? asText(item.extra?.info) ?? "");
  return {
    url,
    title,
    identityKey: identityKeyForUrl(url),
    language: guessLanguage(`${title} ${excerpt}`),
    publishedAt: parseDate(item.pubDate),
    excerpt: excerpt ? truncate(excerpt, EXCERPT_LENGTH) : undefined,
    bodyStatus: "none",
    discoveredAt: new Date(now).toISOString(),
    backfill: true,
  };
}

export type NewsnowFetchResult = {
  candidates: Candidate[];
  validator: FeedValidator;
};

/**
 * 抓取一个平台的热榜。接口按平台全量返回且没有协商缓存凭据，
 * validator 只记 configHash（platform 改了可作废旧游标），控频靠 lastFetchedAt。
 */
export async function fetchNewsnow(source: NewsnowSource, validator: FeedValidator = {}): Promise<NewsnowFetchResult> {
  const platform = source.config.platform;
  const configHash = shortHash(`newsnow:${platform}`, 16);
  const endpoint = `https://newsnow.busiyi.world/api/s?id=${encodeURIComponent(platform)}&latest`;

  const response = await guardedFetch(endpoint, {
    headers: { accept: "application/json", "user-agent": BROWSER_UA },
    maxBytes: config.maxFeedBytes,
    timeoutMs: config.fetchTimeoutMs,
  });
  if (response.status >= 400) throw new Error(`HTTP ${response.status}：${endpoint}`);

  let payload: NewsnowPayload;
  try {
    payload = JSON.parse(decodeBody(response)) as NewsnowPayload;
  } catch {
    throw new Error(`响应不是合法 JSON（可能被风控拦截）：${endpoint}`);
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const now = Date.now();
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const candidate = candidateFrom(item ?? {}, now);
    if (!candidate || seen.has(candidate.identityKey!)) continue;
    seen.add(candidate.identityKey!);
    candidates.push(candidate);
    if (candidates.length >= MAX_ITEMS) break;
  }
  return { candidates, validator: { configHash } };
}
